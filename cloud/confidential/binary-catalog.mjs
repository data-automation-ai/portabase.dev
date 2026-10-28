import {createCipheriv,createDecipheriv,createHash,createHmac,hkdfSync,randomBytes,randomUUID} from 'node:crypto';
import {open,mkdir,rename,rm} from 'node:fs/promises';
import {dirname,resolve,sep} from 'node:path';
const CHUNK=8*1024*1024,MAX_MANIFEST=8*1024*1024;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const strongEtag=value=>typeof value==='string'&&/^"[\x21\x23-\x7e]{1,200}"$/.test(value)?value:null;
export {strongEtag};
export function encryptedBinaryCatalog({store,recoveryKey,owner,sourceRef,now=Date.now,onTransfer=async()=>{}}){
  if(!/^[A-Za-z0-9_-]{43}$/.test(recoveryKey||'')||!/^[a-f0-9]{64}$/.test(owner||'')||!/^[a-z0-9]{20}$/.test(sourceRef||''))throw Error('invalid_binary_catalog_identity');
  const root=Buffer.from(recoveryKey,'base64url');
  const key=Buffer.from(hkdfSync('sha256',root,Buffer.from(owner),Buffer.from('portabase.binary.v1:'+sourceRef),32));root.fill(0);
  // Stable lookup namespace permits a wrong key to fail authentication instead
  // of silently appearing to be a brand-new empty vault.
  const namespace=createHmac('sha256',Buffer.from(owner,'hex')).update('portabase.binary.v1:'+sourceRef).digest('hex');
  let prior=null,pending=null,outboundBytes=0,restoredBytes=0,writeQueue=Promise.resolve(),selectedBuckets=null;
  const retainedObjects=new Map(),ownedEntries=new Set();
  const path=(type,id)=>namespace+'/'+type+'/'+id;
  function seal(bytes,location){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(location));return Buffer.concat([Buffer.from('PBB1'),iv,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]);}
  function unseal(bytes,location){
    try{if(bytes.length<32||bytes.subarray(0,4).toString()!=='PBB1')throw Error();const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(4,16));decipher.setAAD(Buffer.from(location));decipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([decipher.update(bytes.subarray(16,-16)),decipher.final()]);}
    catch{throw Error('binary_catalog_authentication_failed');}
  }
  function validate(manifest,id){
    if(manifest?.version!==1||manifest.owner!==owner||manifest.sourceRef!==sourceRef||manifest.id!==id||!uuid(id)||!uuid(manifest.baselineId)||!Array.isArray(manifest.objects)||!Array.isArray(manifest.tombstones)||!Number.isFinite(Date.parse(manifest.createdAt)))throw Error('invalid_binary_manifest');
    const names=new Set();
    for(const entry of manifest.objects){
      if(typeof entry.bucket!=='string'||!entry.bucket||typeof entry.name!=='string'||!entry.name||names.has(entry.bucket+'\0'+entry.name)||!/^[a-f0-9]{64}$/.test(entry.sha256)||!Number.isSafeInteger(entry.size)||entry.size<0||!Array.isArray(entry.chunks))throw Error('invalid_binary_manifest');
      names.add(entry.bucket+'\0'+entry.name);
      let total=0;for(const chunk of entry.chunks){if(!uuid(chunk.id)||!/^[a-f0-9]{64}$/.test(chunk.sha256)||!Number.isSafeInteger(chunk.size)||chunk.size<0||chunk.size>CHUNK)throw Error('invalid_binary_manifest');total+=chunk.size;}
      if(total!==entry.size)throw Error('invalid_binary_manifest');
    }
    return manifest;
  }
  const api={
    namespace,
    async load(){
      const records=[];let totalBytes=0;const locations=await store.list(namespace);
      if(locations.length>2000)throw Error('binary_catalog_index_required');
      for(const location of locations){
        const id=location.split('/').at(-1),raw=unseal(await store.get(location),location);
        if(raw.length>MAX_MANIFEST)throw Error('binary_manifest_too_large');
        totalBytes+=raw.length;if(totalBytes>64*1024*1024)throw Error('binary_catalog_index_required');
        let manifest;try{manifest=JSON.parse(raw.toString());}finally{raw.fill(0);}
        records.push(validate(manifest,id));
      }
      const ids=new Set(records.map(r=>r.id));
      if(records.some(r=>!ids.has(r.baselineId)))throw Error('binary_baseline_missing');
      records.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||b.id.localeCompare(a.id));prior=records[0]||null;
      retainedObjects.clear();ownedEntries.clear();
      for(const record of records)for(const object of record.objects){ownedEntries.add(object);const name=object.bucket+'\0'+object.name;if(!retainedObjects.has(name))retainedObjects.set(name,object);}
      return {count:records.length,latest:prior,manifests:records};
    },
    begin(){const id=randomUUID();pending={version:1,id,baselineId:prior?.baselineId||id,owner,sourceRef,createdAt:new Date(now()).toISOString(),objects:[],tombstones:[],capsuleId:null};outboundBytes=0;return {id,baselineId:pending.baselineId,initial:!prior};},
    setScope(buckets){selectedBuckets=new Set(buckets);},
    previous(bucket,name){return retainedObjects.get(bucket+'\0'+name)||null;},
    async reuse(entry){
      if(!pending||!ownedEntries.has(entry))throw Error('binary_reference_not_owned');
      // Previously authenticated immutable references need no binary transfer.
      // Check existence now; authenticate/hash bytes again during recovery.
      for(const chunk of entry.chunks)if(!await store.has(path('objects',chunk.id)))throw Error('binary_reference_missing');
      const result=structuredClone(entry);pending.objects.push(result);return result;
    },
    async capture({bucket,name,file,etag}){
      if(!pending)throw Error('binary_snapshot_not_started');
      const input=await open(file,'r');
      try{
        const before=await input.stat(),size=before.size,hash=createHash('sha256'),buffer=Buffer.alloc(CHUNK);let offset=0;
        while(offset<size){const {bytesRead}=await input.read(buffer,0,Math.min(CHUNK,size-offset),offset);if(!bytesRead)throw Error('binary_source_truncated');hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead;}
        const sha256=hash.digest('hex'),old=api.previous(bucket,name);
        if(old?.size===size&&old.sha256===sha256){buffer.fill(0);const copy=await api.reuse(old);copy.etag=strongEtag(etag);return copy;}
        const chunks=[],secondHash=createHash('sha256');offset=0;
        do{
          const {bytesRead}=await input.read(buffer,0,Math.min(CHUNK,size-offset),offset),plain=buffer.subarray(0,bytesRead),id=randomUUID(),location=path('objects',id),ciphertext=seal(plain,location);
          if(!bytesRead&&offset<size)throw Error('binary_source_truncated');secondHash.update(plain);
          const write=writeQueue.then(async()=>{
            await onTransfer({binaryBytes:outboundBytes+ciphertext.length,initial:!prior,phase:'reserve'});
            outboundBytes+=ciphertext.length;await store.put(location,ciphertext);
          });writeQueue=write;await write;
          chunks.push({id,size:bytesRead,sha256:digest(plain)});offset+=bytesRead;
        }while(offset<size);
        buffer.fill(0);const after=await input.stat();if(secondHash.digest('hex')!==sha256||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ino!==before.ino)throw Error('binary_source_changed_during_capture');
        const entry={bucket,name,size,sha256,etag:strongEtag(etag),chunks};pending.objects.push(entry);return entry;
      }finally{await input.close();}
    },
    snapshot(){if(!pending)throw Error('binary_snapshot_not_started');const names=new Set(pending.objects.map(r=>r.bucket+'\0'+r.name));pending.tombstones=(prior?.objects||[]).filter(r=>(!selectedBuckets||selectedBuckets.has(r.bucket))&&!names.has(r.bucket+'\0'+r.name)).map(r=>({bucket:r.bucket,name:r.name}));return structuredClone(pending);},
    transferred(){return {binaryBytes:outboundBytes};},
    async commit(capsuleId){
      const manifest=api.snapshot();manifest.capsuleId=String(capsuleId);validate(manifest,manifest.id);
      const raw=Buffer.from(JSON.stringify(manifest));if(raw.length>MAX_MANIFEST)throw Error('binary_manifest_too_large');
      const location=path('manifests',manifest.id),encrypted=seal(raw,location);raw.fill(0);
      await onTransfer({binaryBytes:outboundBytes,otherBytes:encrypted.length,initial:!prior,phase:'reserve'});
      await store.put(location,encrypted);prior=manifest;pending=null;
      return {manifestVerified:true,binarySnapshotId:manifest.id,binaryBaselineId:manifest.baselineId,initialBinarySnapshot:manifest.id===manifest.baselineId,binaryBytes:outboundBytes,otherBytes:encrypted.length};
    },
    async restore(manifest,directory){
      validate(manifest,manifest.id);const root=resolve(directory);
      for(const entry of manifest.objects){
        const target=resolve(root,entry.bucket,entry.name);if(!target.startsWith(root+sep)||entry.bucket.includes('/')||entry.bucket.includes('\\')||entry.name.includes('\\')||entry.name.split('/').some(p=>p==='..'||p==='.'||!p))throw Error('unsafe_binary_path');
        await mkdir(dirname(target),{recursive:true});const tmp=target+'.'+randomUUID()+'.part',output=await open(tmp,'wx',0o600),hash=createHash('sha256');
        try{for(const chunk of entry.chunks){const location=path('objects',chunk.id),plain=unseal(await store.get(location),location);if(plain.length!==chunk.size||digest(plain)!==chunk.sha256)throw Error('binary_chunk_mismatch');let offset=0;while(offset<plain.length){const {bytesWritten}=await output.write(plain,offset,plain.length-offset);if(!bytesWritten)throw Error('binary_restore_write_failed');offset+=bytesWritten;}hash.update(plain);restoredBytes+=plain.length;plain.fill(0);}if(hash.digest('hex')!==entry.sha256)throw Error('binary_object_mismatch');await output.close();await rename(tmp,target);}
        catch(error){await output.close().catch(()=>{});await rm(tmp,{force:true});throw error;}
      }
      return {objects:manifest.objects.length,bytes:restoredBytes};
    },
    close(){key.fill(0);},
  };return api;
}
