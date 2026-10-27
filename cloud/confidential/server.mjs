import { createServer } from 'node:http';
import { customerIdentity } from './customer-identity.mjs';
import { commandChannel } from './command-channel.mjs';
import { confidentialApplication } from './application.mjs';
const reply=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
export function applicationServer({oauthConfig,admit,authenticate=customerIdentity,dispatch,attest}={}) {
  const channel=commandChannel({dispatch:dispatch||confidentialApplication({oauthConfig,admit}),...(attest?{attest}:{})});
  const server=createServer(async(req,res)=>{
    if(req.method==='GET' && req.url==='/health') return reply(res,200,{service:'portabase-confidential-runner',ready:true,protocol:1});
    if(req.method!=='POST' || !['/attest','/command'].includes(req.url) || !req.headers['content-type']?.startsWith('application/json')) return reply(res,404,{error:'not_found'});
    let identity;
    try { identity=await authenticate(req.headers.authorization); } catch { return reply(res,401,{error:'sign_in_required'}); }
    try {
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>300000){reply(res,413,{error:'request_too_large'});req.destroy();return;}}
      const input=JSON.parse(body);
      const result=req.url==='/attest'?await channel.offer(identity.owner,input.challenge):await channel.execute(identity.owner,input,req.headers.authorization);
      reply(res,200,result);
    } catch { reply(res,400,{error:'encrypted_request_rejected'}); }
  });
  server.requestTimeout=60000;server.headersTimeout=10000;
  return server;
}
