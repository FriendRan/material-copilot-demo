import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const allowed=['index.html','style.css','app.js','core.js','handoff.js','proposals.js','showcase.js','connection.js'];
await mkdir(path.join(root,'dist/static'),{recursive:true});
for(const file of allowed)await writeFile(path.join(root,'dist/static',file),await readFile(path.join(root,'public',file)));
console.log('Built static frontend: '+allowed.length+' public files; no environment files or server code.');
