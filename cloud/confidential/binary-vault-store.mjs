// Bounded opaque ciphertext objects only. No manifest contents or source names
// are sent in remote paths. Each request is bounded; capsules are handled elsewhere.
import {createHash} from 'node:crypto';
import {resolveS3Credentials, signS3Request, buildS3Url} from './s3-vault.mjs';
import {resolveDropboxAccessToken} from '../../utility/cloud-storage-connectors.mjs';
const MAX=12*1024*1024;
const valid=key=>typeof key==='string' && /^(?:[a-f0-9]{64}\/)?(?:objects|manifests)\/[a-f0-9-]{36}$/.test(key);
const fail=()=>{throw Error('binary_vault_unavailable');};
async function bytes(response){
  if(!response.ok)fail();
  if(Number(response.headers.get('content-length'))>MAX)fail();
  const parts=[];let size=0;
  for await(const part of response.body){size+=part.length;if(size>MAX)fail();parts.push(part);}
  return Buffer.concat(parts);
}
const xml=value=>value.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
export function binaryVaultStore(provider,{fetchImpl=fetch}={}) {
  if(!['s3','r2','dropbox'].includes(provider?.type))throw Error('durable_binary_vault_required');
  if(provider.type!=='dropbox'){
    if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(provider.bucket||''))throw Error('invalid_binary_vault_bucket');
    if(provider.endpoint){let endpoint;try{endpoint=new URL(provider.endpoint);}catch{throw Error('invalid_binary_vault_endpoint');}
      if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.port||endpoint.search||endpoint.hash||!['','/'].includes(endpoint.pathname)||
        !(provider.type==='r2'&&/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname)))throw Error('invalid_binary_vault_endpoint');}
    if(provider.type==='r2'&&!provider.endpoint)throw Error('invalid_binary_vault_endpoint');
  }
  const prefix=String(provider.prefix||provider.folderPath||'Portabase').replace(/^\/+|\/+$/g,'')+'/.binary-v1/';
  if(prefix.includes('..')||/[\x00-\x1f\\]/.test(prefix))throw Error('invalid_binary_vault_prefix');
  let dropboxToken, tokenAt=0;
  async function dbHeaders(){
    if(!dropboxToken||Date.now()-tokenAt>30*60_000){dropboxToken=await resolveDropboxAccessToken({...provider,fetchImpl});tokenAt=Date.now();}
    return {Authorization:'Bearer '+dropboxToken};
  }
  async function request(key,method,body){
    if(!valid(key))throw Error('invalid_binary_vault_key');
    if(body&&body.length>MAX)throw Error('binary_record_too_large');
    if(provider.type==='dropbox'){
      const action=method==='PUT'?'upload':'download';
      const headers={...await dbHeaders(),'Dropbox-API-Arg':JSON.stringify({path:'/'+prefix+key,...(method==='PUT'?{mode:'add',autorename:false,mute:true,strict_conflict:true}:{})})};
      if(method==='PUT')headers['Content-Type']='application/octet-stream';
      return fetchImpl('https://content.dropboxapi.com/2/files/'+action,{method:'POST',headers,...(body?{body}:{}),redirect:'error',signal:AbortSignal.timeout(60000)});
    }
    const url=buildS3Url(provider,'/'+(prefix+key).split('/').map(encodeURIComponent).join('/'));
    const headers=signS3Request({method,url,body:body||Buffer.alloc(0),...await resolveS3Credentials(provider)});
    if(method==='PUT')headers['If-None-Match']='*';
    return fetchImpl(url,{method,headers,...(body?{body}:{}),redirect:'error',signal:AbortSignal.timeout(60000)});
  }
  return {
    async get(key){return bytes(await request(key,'GET'));},
    async has(key){
      if(!valid(key))throw Error('invalid_binary_vault_key');
      if(provider.type!=='dropbox'){const response=await request(key,'HEAD');if(response.status===404)return false;if(!response.ok)fail();return true;}
      const response=await fetchImpl('https://api.dropboxapi.com/2/files/get_metadata',{method:'POST',headers:{...await dbHeaders(),'content-type':'application/json'},body:JSON.stringify({path:'/'+prefix+key}),redirect:'error',signal:AbortSignal.timeout(30000)});
      if(response.status===409){const value=await response.json();if(value.error?.['.tag']==='path'&&value.error?.path?.['.tag']==='not_found')return false;fail();}
      if(!response.ok)fail();return (await response.json())['.tag']==='file';
    },
    async put(key,body){
      const response=await request(key,'PUT',body);if(!response.ok)fail();
      const received=await bytes(await request(key,'GET'));
      if(!createHash('sha256').update(received).digest().equals(createHash('sha256').update(body).digest()))throw Error('binary_vault_readback_failed');
    },
    async list(namespace){
      if(!/^[a-f0-9]{64}$/.test(namespace))throw Error('invalid_binary_namespace');
      const wanted=prefix+namespace+'/manifests/',keys=[];let cursor='';
      for(let pages=0;pages<1000;pages++){
        if(provider.type==='dropbox'){
          const response=await fetchImpl('https://api.dropboxapi.com/2/files/list_folder'+(cursor?'/continue':''),{method:'POST',headers:{...await dbHeaders(),'content-type':'application/json'},body:JSON.stringify(cursor?{cursor}:{path:'/'+wanted.replace(/\/$/,''),recursive:false,limit:1000}),redirect:'error',signal:AbortSignal.timeout(30000)});
          if(response.status===409){const data=await response.json();if(!cursor&&data.error?.['.tag']==='path'&&data.error?.path?.['.tag']==='not_found')return [];fail();}
          if(!response.ok)fail();const data=await response.json();
          for(const entry of data.entries||[])if(entry['.tag']==='file'){const key=namespace+'/manifests/'+entry.name;if(!valid(key))throw Error('invalid_binary_catalog_entry');keys.push(key);}
          if(!data.has_more)return keys;cursor=data.cursor;
        }else{
          const query=new URLSearchParams({'list-type':'2',prefix:wanted,'max-keys':'1000',...(cursor?{'continuation-token':cursor}:{})});
          const url=buildS3Url(provider,'/?'+query),headers=signS3Request({method:'GET',url,...await resolveS3Credentials(provider)});
          const response=await fetchImpl(url,{headers,redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)fail();
          const data=(await bytes(response)).toString('utf8');
          for(const match of data.matchAll(/<Key>([^<]+)<\/Key>/g)){const full=xml(match[1]);if(!full.startsWith(wanted))throw Error('binary_catalog_scope_mismatch');const key=full.slice(prefix.length);if(!valid(key))throw Error('invalid_binary_catalog_entry');keys.push(key);}
          if(!/<IsTruncated>true<\/IsTruncated>/.test(data))return keys;
          const next=data.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];if(!next)fail();cursor=xml(next);
        }
        if(!cursor||keys.length>100000)throw Error('binary_catalog_limit');
      }
      throw Error('binary_catalog_limit');
    },
  };
}
