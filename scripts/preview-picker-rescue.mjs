// Isolated browser fixture: no real customer session, no backend writes.
import {createServer} from 'node:http';
const origin='https://6ae1e92f86a13c701e2fe143--portabase-dev.netlify.app';
const db={id:'db_fixture',projectRef:'fixture',projectName:'Picker verification fixture',name:'Picker verification fixture',databaseName:'postgres',enabled:true,mode:'structure_and_data',estimatedSizeMb:6,
 tables:['accounts','orders'].map((name,i)=>({name:'public.'+name,schema:'public',objectName:name,objectType:'TABLE',mode:'structure_and_data',sizeMb:i+1,structureSizeMb:0})),
 binaries:['alpha.png','beta.png'].map(name=>({name:'images/'+name,bucket:'images',schema:'images',objectName:name,objectType:'BINARY',mode:'include',sizeMb:1}))};
createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1:58449');
 if(req.method!=='GET'){res.writeHead(405);return res.end('Fixture blocks writes');}
 if(url.pathname.startsWith('/api/')){res.setHeader('content-type','application/json');return res.end(JSON.stringify(url.pathname==='/api/cloud/oauth'?{ok:true,connected:true,databases:[db],projects:[]}:{connectors:[],access:{hasAccess:false},subscription:null}));}
 const path=url.pathname.startsWith('/assets/')?url.pathname:'/index.html';
 const r=await fetch(origin+path);res.writeHead(r.status,{'content-type':r.headers.get('content-type')||'text/plain'});res.end(Buffer.from(await r.arrayBuffer()));
}catch{res.writeHead(502);res.end('Preview unavailable');}}).listen(58449,'127.0.0.1',()=>console.log('Picker fixture http://127.0.0.1:58449/app?demo=1'));
