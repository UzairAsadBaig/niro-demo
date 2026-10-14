import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
let html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
const model=fs.readFileSync(path.join(root,'public/dark-city.glb')).toString('base64');
html=html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/,(_,src)=>{
 const js=fs.readFileSync(path.join(root,'dist',src.replace(/^\//,'')),'utf8').replace(/<\/script/gi,'<\\/script');
 return `<script>window.__CITY_MODEL_URL="data:model/gltf-binary;base64,${model}";</script><script type="module">${js}</script>`;
});
html=html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/,(_,src)=>`<style>${fs.readFileSync(path.join(root,'dist',src.replace(/^\//,'')),'utf8')}</style>`);
fs.writeFileSync(path.join(root,'OPEN-CITY.html'),html);
console.log('Standalone React Three Fiber viewer written: OPEN-CITY.html');
