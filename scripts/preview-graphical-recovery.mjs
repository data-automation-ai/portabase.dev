// Isolated visual recovery fixture. Never contacts a provider or runs recovery.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {renderDryRunPage} from '../cloud/confidential/dry-run-gui.mjs';
const status={state:'select_projects',operatingMode:'development',mode:'dropbox',activeVault:'dropbox',
  executing:false,allowOverwrite:false,connections:{source:true,target:true,dropbox:false,s3:false},
  accounts:{},accountConfirmation:{confirmed:true},selection:{source:'source_preview',target:'target_preview'},
  inventory:{ref:'source_preview',tables:[
    {name:'public.accounts',schema:'public',table:'accounts',rows:5,bytes:1048576,selectable:true},
    {name:'public.orders',schema:'public',table:'orders',rows:10,bytes:2097152,selectable:true}],
    buckets:[{id:'images',objects:2,bytes:3145728}],authUsers:0,functions:0},
  scope:{tables:['public.accounts','public.orders'],excludedTables:[],buckets:['images'],auth:true,functions:true}};
const projects={source:[{ref:'source_preview',name:'Source preview (synthetic)'}],target:[{ref:'target_preview',name:'Destination preview (synthetic)'}]};
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.headers.host!=='127.0.0.1:58453'){res.writeHead(400);return res.end();}
  try{
    const url=new URL(req.url,'http://127.0.0.1:58453');
    if(req.method==='POST'){
      if(url.pathname!=='/scope'){res.writeHead(409);return res.end('Visual fixture only. No provider operations are enabled.');}
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>100000)throw Error('too_large');}
      const form=new URLSearchParams(raw);
      if(form.get('nonce')!=='visual-preview'){res.writeHead(403);return res.end();}
      status.scope.tables=form.getAll('tableIndex').map(i=>status.inventory.tables[Number(i)]?.name).filter(Boolean);
      status.scope.excludedTables=form.getAll('excludedTableIndex').map(i=>status.inventory.tables[Number(i)]?.name).filter(Boolean);
      status.scope.buckets=form.getAll('bucketIndex').map(i=>status.inventory.buckets[Number(i)]?.id).filter(Boolean);
      res.writeHead(303,{location:'/'});return res.end();
    }
    if(url.pathname==='/status'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(status));}
    if(['/scope-ui.js','/gcp-logo.png','/intel-tdx-logo.png'].includes(url.pathname)){
      res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':'image/png');
      return res.end(await readFile(new URL('../cloud/confidential/evidence/ui'+url.pathname,import.meta.url)));
    }
    if(url.pathname!=='/'){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type','text/html; charset=utf-8');
    const page=renderDryRunPage({status,projects,selection:status.selection,links:{},nonce:'visual-preview'});
    res.end(page.replace('<body','<body').replace(/(<body[^>]*>)/,'$1<div style="padding:8px;background:#fff3cd;color:#332700;font-weight:bold">Recovery preview — synthetic data only; no live jobs or cloud connections.</div>'));
  }catch{res.writeHead(500);res.end('Preview asset unavailable');}
});
server.listen(58453,'127.0.0.1',()=>console.log('Graphical recovery preview: http://127.0.0.1:58453'));
