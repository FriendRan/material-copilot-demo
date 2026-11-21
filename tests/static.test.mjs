import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

test('静态构建：只发布公开资源，保留相对 API 请求，不包含密钥和服务端文件',async()=>{
  const root=new URL('../',import.meta.url);
  execFileSync(process.execPath,['scripts/build-static.mjs'],{cwd:root});
  const files=await readdir(new URL('../dist/static/',import.meta.url));
  assert.deepEqual(files.sort(),['app.js','connection.js','core.js','handoff.js','index.html','proposals.js','showcase.js','style.css'].sort());
  for(const file of files)assert.deepEqual(await readFile(new URL('../dist/static/'+file,import.meta.url)),await readFile(new URL('../public/'+file,import.meta.url)));
  const app=await readFile(new URL('../dist/static/app.js',import.meta.url),'utf8');
  assert.match(app,/fetch\('\/api\/chat'/);assert.ok(!app.includes('DEEPSEEK_API_KEY'));
  const source=await readFile(new URL('../scripts/build-static.mjs',import.meta.url),'utf8');
  assert.ok(!/loadEnvFile|readFile\([^\n]*['"]\.env/.test(source));
});
