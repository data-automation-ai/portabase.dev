import {build} from 'vite';
import {fileURLToPath} from 'node:url';
await build({configFile:false,define:{'process.env.NODE_ENV':'"production"'},build:{
  outDir:fileURLToPath(new URL('./evidence/ui',import.meta.url)),emptyOutDir:true,
  lib:{entry:fileURLToPath(new URL('./scope-modal.jsx',import.meta.url)),formats:['iife'],name:'PortabaseScope',fileName:()=> 'scope-ui.js'},
  minify:true,
}});
