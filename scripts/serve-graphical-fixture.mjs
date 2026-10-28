import {createServer} from 'vite';
const server=await createServer({configFile:false,appType:'custom',cacheDir:'.portabase/graphical-vite-cache',root:process.cwd(),server:{host:'127.0.0.1',port:58454,strictPort:true,hmr:false}});
server.middlewares.use((req,res,next)=>{
  if(req.url!=='/graphical-fixture')return next();
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Graphical recovery acceptance fixture</title></head><body style="margin:0"><div id="root"></div><script type="module" src="/scripts/graphical-recovery-fixture.jsx"></script></body></html>');
});
await server.listen();console.log('Graphical acceptance fixture: http://127.0.0.1:58454/graphical-fixture');
