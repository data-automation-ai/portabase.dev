// The bootstrap envelope contains cipher parameters only. Every user manifest,
// including the outer capsule metadata, is authenticated ciphertext at rest.
import {createCipheriv,createDecipheriv,hkdfSync,randomBytes} from 'node:crypto';
const derive=recoveryKey=>{
  if(!/^[A-Za-z0-9_-]{43}$/.test(recoveryKey||''))throw Error('recovery_key_required');
  const bytes=Buffer.from(recoveryKey,'base64url');
  try{return Buffer.from(hkdfSync('sha256',bytes,Buffer.from('portabase.manifest.v1'),Buffer.from('capsule-envelope'),32));}finally{bytes.fill(0);}
};
export function sealManifest(value,recoveryKey){const key=derive(recoveryKey),iv=randomBytes(12),plain=Buffer.from(JSON.stringify(value));try{const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('portabase.manifest.v1'));return {encryptedManifestVersion:1,iv:iv.toString('base64url'),payload:Buffer.concat([cipher.update(plain),cipher.final()]).toString('base64url'),tag:cipher.getAuthTag().toString('base64url')};}finally{key.fill(0);plain.fill(0);}}
export function openManifest(value,recoveryKey){
  const key=derive(recoveryKey);let plain;
  try{if(value?.encryptedManifestVersion!==1||typeof value.payload!=='string'||value.payload.length>16*1024*1024||!/^[-_A-Za-z0-9]{16}$/.test(value.iv||'')||!/^[-_A-Za-z0-9]{22}$/.test(value.tag||''))throw Error();const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'base64url'));decipher.setAAD(Buffer.from('portabase.manifest.v1'));decipher.setAuthTag(Buffer.from(value.tag,'base64url'));plain=Buffer.concat([decipher.update(Buffer.from(value.payload,'base64url')),decipher.final()]);return JSON.parse(plain.toString());}
  catch{throw Error('manifest_authentication_failed');}finally{key.fill(0);plain?.fill(0);}
}
