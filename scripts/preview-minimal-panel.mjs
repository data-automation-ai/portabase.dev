// Local synthetic UI preview. No provider calls or recovery operations.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {renderDryRunPage} from '../cloud/confidential/dry-run-gui.mjs';
const fixture={status:{state:'preflight_passed',mode:'temporary_runner',allowOverwrite:false,
  connections:{source:true,target:true,dropbox:true},
  accounts:{source:{verified:true,email:'owner@example.test'},target:{verified:true,email:'recovery@example.test'}},
  preflight:{source:{name:'Main project'},target:{name:'Recovery project',blank:true}},
  inventory:{ref:'source-demo',tables:[{name:'public.orders',schema:'public',table:'orders',bytes:11.34*1024**3,estimatedRows:120,selectable:true}],buckets:[],authUsers:0,functions:0},
  scope:{tables:['public.orders'],buckets:[],auth:true,functions:true},capsules:['example-backup']},
  projects:{source:[{name:'Main project',ref:'source-demo'},{name:'Second project',ref:'source-second'}],target:[{name:'Recovery project',ref:'target-demo'},{name:'Second destination',ref:'target-second'}]},
  selection:{source:'source-demo',target:'target-demo'},links:{},nonce:'preview-only'};
fixture.status.selection=fixture.selection;
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(req.method==='POST'){
      let body='';for await(const chunk of req)body+=chunk;
      const form=new URLSearchParams(body);
      if(form.get('nonce')!==fixture.nonce){res.writeHead(403);return res.end('Invalid preview session. Reload the page.');}
      if(url.pathname==='/mode')fixture.status.mode=form.get('mode');
      else if(url.pathname==='/select'){
        const slot=form.get('slot'),ref=form.get('ref');
        if(!fixture.projects[slot]?.some(p=>p.ref===ref)){res.writeHead(400);return res.end('Unknown sample project.');}
        fixture.selection[slot]=ref;
        if(slot==='source')fixture.status.inventory.ref=ref;
        else fixture.status.allowOverwrite=form.get('allowOverwrite')==='yes';
      }
      else if(url.pathname==='/select-batch'){
        const sources=form.getAll('sourceRefs');
        if(!sources.length||sources.some(ref=>!fixture.projects.source.some(p=>p.ref===ref))){res.writeHead(400);return res.end('Choose sample source projects.');}
        const targetMap={};
        for(const ref of sources){const target=form.get('targetFor_'+ref);if(target)targetMap[ref]=target;}
        fixture.selection.sources=sources;fixture.selection.targetMap=targetMap;
        fixture.selection.source=sources[0];fixture.status.inventory.ref=sources[0];
      }
      else if(url.pathname==='/vault-provider')fixture.status.activeVault=form.get('provider');
      else if(url.pathname==='/scope'){
        const {inventory}=fixture.status;
        const selected=(key,rows,field)=>form.getAll(key).map(value=>{
          if(!/^(0|[1-9][0-9]*)$/.test(value)||!rows[Number(value)])throw new Error('Invalid object selection');
          return rows[Number(value)][field];
        });
        let scope;
        try{
          const tables=selected('tableIndex',inventory.tables,'name');
          scope={tables,excludedTables:selected('excludedTableIndex',inventory.tables,'name').filter(name=>!tables.includes(name)),
            buckets:selected('bucketIndex',inventory.buckets,'id'),auth:form.get('auth')==='yes',functions:form.get('functions')==='yes'};
        }catch{res.writeHead(400);return res.end('Invalid preview object selection.');}
        fixture.status.scope=scope;
      }
      else {
        res.writeHead(403,{'content-type':'text/html'});
        return res.end('<h1>Sample-data preview</h1><p>Account authorization, credentials and recovery runs require the connected runner. Nothing was sent to a provider.</p><a href="/">Return to panel</a>');
      }
      res.writeHead(303,{location:'/'});return res.end();
    }
    if(url.pathname==='/status'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(fixture.status));}
    if(['/scope-ui.js','/gcp-logo.png','/intel-tdx-logo.png'].includes(url.pathname)){
      res.setHeader('content-type',url.pathname.endsWith('.js')?'text/javascript':'image/png');
      return res.end(await readFile(new URL('../cloud/confidential/evidence/ui'+url.pathname,import.meta.url)));
    }
    res.setHeader('content-type','text/html');
    res.end(renderDryRunPage(fixture).replace('<h1>Recovery connection check</h1>','<h1>Recovery connection check <small style="display:inline;font-size:12px">Local preview · sample data</small></h1>'));
  }catch{res.writeHead(500);res.end('Preview error');}
});
server.listen(4197,'127.0.0.1',()=>console.log('Synthetic preview: http://127.0.0.1:4197'));
