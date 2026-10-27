// Ordinary control plane: it manages compute and relays encrypted commands.
// It has no permission to read the OAuth app secret and never decrypts a JWE.
import {createServer} from 'node:http';
import {customerIdentity} from './customer-identity.mjs';
import {computeControl} from './compute-control.mjs';
const reply=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));};
export function controllerServer({compute=computeControl({image:process.env.APPLICATION_IMAGE}),authenticate=customerIdentity,
  fetchImpl=fetch,admit,allowedCustomers}={}) {
  const locks=new Set();
  const server=createServer(async(req,res)=>{
    const origin=req.headers.origin;
    if(origin && origin!=='https://portabase.dev')return reply(res,403,{error:'origin_not_allowed'});
    if(origin){res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','origin');}
    if(req.method==='OPTIONS'){
      res.writeHead(204,{'access-control-allow-methods':'POST, DELETE, OPTIONS','access-control-allow-headers':'authorization, content-type','access-control-max-age':'600'});return res.end();
    }
    if(req.method==='GET' && req.url==='/health')return reply(res,200,{service:'portabase-confidential-controller',protocol:1});
    const valid=(req.method==='POST' && ['/session','/attest','/command'].includes(req.url)) || (req.method==='DELETE' && req.url==='/session');
    if(!valid)return reply(res,404,{error:'not_found'});
    let identity;
    try{identity=await authenticate(req.headers.authorization);}catch{return reply(res,401,{error:'sign_in_required'});}
    if(allowedCustomers && !allowedCustomers.has(identity.id))return reply(res,403,{error:'isolated_validation_only'});
    try {
      let instance=await compute.get(identity.owner);
      if(req.method==='DELETE'){await compute.remove(identity.owner);return reply(res,200,{terminated:true});}
      if(!req.headers['content-type']?.startsWith('application/json'))return reply(res,415,{error:'json_required'});
      let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>300000){reply(res,413,{error:'request_too_large'});req.destroy();return;}}
      const body=JSON.parse(raw);
      if(!body || typeof body!=='object' || Array.isArray(body))return reply(res,400,{error:'invalid_request'});
      if(req.url==='/session'){
        if(Object.keys(body).some(k=>k!=='requestId') || !/^[a-f0-9-]{36}$/i.test(body.requestId||''))return reply(res,400,{error:'invalid_request'});
        if(!instance){
          if(locks.has(identity.owner))return reply(res,202,{state:'starting'});
          locks.add(identity.owner);
          try{
            if(typeof admit!=='function')throw new Error('runner_admission_unavailable');
            await admit({authorization:req.headers.authorization,requestId:body.requestId});
            await compute.create(identity.owner);
          }finally{locks.delete(identity.owner);}
          return reply(res,202,{state:'starting'});
        }
        if(instance.status!=='RUNNING' || !instance.address)return reply(res,202,{state:'starting',expiresAt:instance.expiresAt});
        let ready=false;
        try{const health=await fetchImpl(`http://${instance.address}:8080/health`,{redirect:'error',signal:AbortSignal.timeout(2000)});
          const value=await health.json();ready=health.ok && value.service==='portabase-confidential-runner' && value.protocol===1;}catch{}
        return reply(res,ready?200:202,{state:ready?'ready':'starting',expiresAt:instance.expiresAt});
      }
      if(!instance?.address || instance.status!=='RUNNING')return reply(res,409,{error:'runner_not_ready'});
      const keys=req.url==='/attest'?['challenge']:['sessionId','envelope'];
      if(Object.keys(body).some(k=>!keys.includes(k)))return reply(res,400,{error:'encrypted_payload_required'});
      const response=await fetchImpl(`http://${instance.address}:8080${req.url}`,{method:'POST',
        headers:{Authorization:req.headers.authorization,'content-type':'application/json'},body:raw,
        redirect:'error',signal:AbortSignal.timeout(60000)});
      const data=await response.json();
      if(!response.ok)return reply(res,response.status===401?401:400,{error:'encrypted_request_rejected'});
      // Permit only the protocol envelope; never propagate arbitrary upstream logs.
      const output=req.url==='/attest'?{sessionId:data.sessionId,publicKey:data.publicKey,attestation:data.attestation}:{envelope:data.envelope};
      return reply(res,200,output);
    }catch{return reply(res,503,{error:'confidential_service_unavailable'});}
  });
  server.requestTimeout=70000;server.headersTimeout=10000;
  return server;
}
