import {readFile,mkdir,writeFile,copyFile,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const allowed=['index.html','style.css','app.js','core.js','handoff.js','proposals.js','showcase.js'];
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const assets={};
for(const file of allowed)assets['/'+file]={content:await readFile(path.join(root,'public',file),'utf8'),type:types[path.extname(file)]};
const strip=source=>source.replace(/^import .*?;\s*$/gm,'').replace(/^export (?=(?:async )?(?:function|class|const))/gm,'');
const source='// Generated from allowlisted sources. Runtime secrets are never bundled.\nconst STATIC_ASSETS='+JSON.stringify(assets)+';\n'+
  strip(await readFile(path.join(root,'public/core.js'),'utf8'))+'\n'+strip(await readFile(path.join(root,'llm.mjs'),'utf8'))+'\n'+strip(await readFile(path.join(root,'online/worker.mjs'),'utf8'));
await mkdir(path.join(root,'dist/server'),{recursive:true});
await writeFile(path.join(root,'dist/server/index.js'),source);
try{await access(path.join(root,'.openai/hosting.json'));await mkdir(path.join(root,'dist/.openai'),{recursive:true});await copyFile(path.join(root,'.openai/hosting.json'),path.join(root,'dist/.openai/hosting.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
console.log('Built online Worker with '+allowed.length+' allowlisted public assets; no environment files included.');
