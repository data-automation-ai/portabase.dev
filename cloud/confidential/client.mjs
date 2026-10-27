// Shared browser/native verifier. Its approved policy must be obtained and
// pinned independently of the untrusted operator for operator-resistant trust.
import {CompactEncrypt,compactDecrypt,base64url} from 'jose';
import {verifyOffer,validatePolicy} from './attestation.mjs';
const TYPE='portabase-confidential-command-v1';
const nonce=()=>base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
export function confidentialClient({url,policy,getAuthorization,fetchImpl=fetch,verify=verifyOffer}) {
  validatePolicy(policy);
  const endpoint=new URL(url);
  if(endpoint.protocol!=='https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !['','/'].includes(endpoint.pathname))throw new Error('secure_controller_url_required');
  const approvedPolicy=Object.freeze({...policy});
  let lastEvidence=null;
  async function request(path,body,method='POST') {
    const response=await fetchImpl(endpoint.origin+path,{method,headers:{Authorization:await getAuthorization(),'content-type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(70000)});
    const result=await response.json();
    if(!response.ok)throw new Error(/^[a-z0-9_]{3,80}$/.test(result.error||'')?result.error:'confidential_request_failed');
    return result;
  }
  return {
    session:requestId=>request('/session',{requestId}),
    terminate:()=>request('/session',null,'DELETE'),
    evidence:()=>lastEvidence,
    async command(operation,input={}) {
      const challenge=nonce(),responseKey=crypto.getRandomValues(new Uint8Array(32));
      try {
        const offer=await request('/attest',{challenge});
        const {encryptionKey,evidence}=await verify(offer,challenge,approvedPolicy);
        // No customer input or recovery key leaves this process before verification.
        const plaintext=new TextEncoder().encode(JSON.stringify({sessionId:offer.sessionId,challenge,
          responseKey:base64url.encode(responseKey),operation,input}));
        const envelope=await new CompactEncrypt(plaintext).setProtectedHeader({alg:'RSA-OAEP-256',enc:'A256GCM',typ:TYPE}).encrypt(encryptionKey);
        plaintext.fill(0);
        const reply=await request('/command',{sessionId:offer.sessionId,envelope});
        if(typeof reply.envelope!=='string' || reply.envelope.length>8*1024*1024)throw new Error('invalid_encrypted_response');
        const decoded=await compactDecrypt(reply.envelope,responseKey,{keyManagementAlgorithms:['dir'],contentEncryptionAlgorithms:['A256GCM']});
        if(decoded.protectedHeader.typ!==TYPE)throw new Error('invalid_encrypted_response');
        const result=JSON.parse(new TextDecoder().decode(decoded.plaintext));decoded.plaintext.fill(0);
        if(result.sessionId!==offer.sessionId || result.challenge!==challenge)throw new Error('response_binding_mismatch');
        lastEvidence=Object.freeze({...evidence,verifiedAt:new Date().toISOString()});
        if(result.ok!==true)throw new Error(/^[a-z0-9_]{3,80}$/.test(result.error||'')?result.error:'confidential_operation_failed');
        return result.data;
      } finally {responseKey.fill(0);}
    },
  };
}
