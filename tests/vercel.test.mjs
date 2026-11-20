import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import configRoute from '../api/config.mjs';
import chatRoute from '../api/chat.mjs';
test('Vercel：公开目录仅为 public，密钥仍从服务端运行环境读取',async()=>{
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.equal(config.outputDirectory,'public');assert.ok(!config.env);assert.ok(!config.build?.env);
  const oldKey=process.env.DEEPSEEK_API_KEY,oldSecret=process.env.DEMO_SESSION_SECRET;
  process.env.DEEPSEEK_API_KEY='test-vercel-key-not-real';process.env.DEMO_SESSION_SECRET='test-vercel-session-not-real';
  try{
    const r=await configRoute.fetch(new Request('https://demo.vercel.app/api/config'));const body=await r.json();
    assert.equal(body.configured,true);assert.equal(body.hosted,true);assert.ok(!JSON.stringify(body).includes(process.env.DEEPSEEK_API_KEY));assert.match(r.headers.get('set-cookie'),/HttpOnly/);
    const cookie=r.headers.get('set-cookie').split(';')[0];
    const input={message:'test',params:{quantity:'-1'},rows:[],history:[]};
    const headers={'Content-Type':'application/json',cookie};
    const bad=await chatRoute.fetch(new Request('https://demo.vercel.app/api/chat',{method:'POST',headers,body:JSON.stringify(input)}));assert.equal(bad.status,400);
    const noSession=await chatRoute.fetch(new Request('https://demo.vercel.app/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}));assert.equal(noSession.status,401);
  }finally{if(oldKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=oldKey;if(oldSecret===undefined)delete process.env.DEMO_SESSION_SECRET;else process.env.DEMO_SESSION_SECRET=oldSecret;}
});
