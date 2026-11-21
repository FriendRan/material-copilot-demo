import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createOnlineHandler} from '../online/worker.mjs';
const env={DEEPSEEK_API_KEY:'test-key-not-real',DEMO_SESSION_SECRET:'test-session-secret-not-real',LLM_MODEL:'deepseek-flash'};
const payload={message:'4层',params:{},rows:[],history:[]};
const assets={'/index.html':{content:'<h1>Demo</h1>',type:'text/html; charset=utf-8'}};
const root='https://demo.example';
const send=(cookie,body=payload,headers={})=>new Request(root+'/api/chat',{method:'POST',headers:{'content-type':'application/json',cookie,...headers},body:JSON.stringify(body)});
async function cookieFor(handler,environment=env){const r=await handler.fetch(new Request(root+'/api/config'),environment);return r.headers.get('set-cookie')?.split(';')[0];}
test('在线：静态资源白名单不包含密钥和服务端文件，配置只返回公开字段',async()=>{
  const app=createOnlineHandler({assets});
  assert.equal((await app.fetch(new Request(root+'/'),env)).status,200);
  for(const path of ['/.env','/llm.mjs','/online/worker.mjs','/server.mjs'])assert.equal((await app.fetch(new Request(root+path),env)).status,404);
  const r=await app.fetch(new Request(root+'/api/config'),env),data=await r.json();
  assert.equal(data.hosted,true);assert.equal(data.configured,true);assert.ok(!JSON.stringify(data).includes(env.DEEPSEEK_API_KEY));assert.ok(!JSON.stringify(data).includes(env.DEMO_SESSION_SECRET));
  assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
});
test('在线：无有效会话、伪造签名、跨站请求不能调用模型',async()=>{
  let calls=0;const app=createOnlineHandler({assets,chat:async()=>{calls++;return {};}}),cookie=await cookieFor(app);
  assert.equal((await app.fetch(send(''),env)).status,401);
  assert.equal((await app.fetch(send(cookie+'fake'),env)).status,401);
  assert.equal((await app.fetch(send(cookie,payload,{origin:'https://other.example'}),env)).status,403);
  assert.equal((await app.fetch(send(cookie,payload,{'sec-fetch-site':'cross-site'}),env)).status,403);assert.equal(calls,0);
  assert.equal((await app.fetch(send(cookie),env)).status,200);assert.equal(calls,1);
});
test('在线：单会话上限、过期和不完整配置均阻止额外费用请求',async()=>{
  let time=1795200000000,calls=0;const app=createOnlineHandler({assets,now:()=>time,chat:async()=>{calls++;return {reply:'test'};}}),cookie=await cookieFor(app);
  for(let i=0;i<20;i++)assert.equal((await app.fetch(send(cookie),env)).status,200);
  const limited=await app.fetch(send(cookie),env);assert.equal(limited.status,429);assert.equal((await limited.json()).code,'DEMO_LIMIT');assert.equal(calls,20);
  time+=31*60*1000;assert.equal((await app.fetch(send(cookie),env)).status,401);
  const missing=await app.fetch(new Request(root+'/api/config'),{});assert.equal((await missing.json()).configured,false);assert.equal((await app.fetch(send(cookie),{})).status,503);
});

test('在线：静态前端代理保留严格会话，仅放行明确配置的 Origin，不开放跨域',async()=>{
  let calls=0;const app=createOnlineHandler({assets,chat:async()=>{calls++;return {reply:'ok'};}});
  const frontend='https://material-copilot-demo-ui.onrender.com',environment={...env,FRONTEND_ORIGIN:frontend};
  const config=await app.fetch(new Request(root+'/api/config',{headers:{origin:frontend,'sec-fetch-site':'same-origin'}}),environment);
  assert.equal(config.status,200);assert.match(config.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
  assert.equal(config.headers.get('access-control-allow-origin'),null);
  const cookie=config.headers.get('set-cookie').split(';')[0];
  assert.equal((await app.fetch(send(cookie,payload,{origin:frontend,'sec-fetch-site':'same-origin'}),environment)).status,200);
  for(const origin of ['https://evil.example',frontend+'.evil.example',frontend+'/path'])assert.equal((await app.fetch(send(cookie,payload,{origin}),environment)).status,403);
  assert.equal((await app.fetch(send(cookie,payload,{origin:frontend,'sec-fetch-site':'cross-site'}),environment)).status,403);
  assert.equal((await app.fetch(send(cookie,payload,{origin:frontend}),{...env,FRONTEND_ORIGIN:frontend+'/'})).status,403);
  assert.equal((await app.fetch(send('',payload,{origin:frontend}),environment)).status,401);assert.equal(calls,1);
});
test('在线：过大请求、非法参数和内部错误不外泄，不调用模型',async()=>{
  let calls=0;const app=createOnlineHandler({assets,chat:async()=>{calls++;throw Error(env.DEEPSEEK_API_KEY);}}),cookie=await cookieFor(app);
  assert.equal((await app.fetch(send(cookie,{...payload,params:{quantity:'-1'}}),env)).status,400);assert.equal(calls,0);
  assert.equal((await app.fetch(send(cookie,{...payload,message:'a'.repeat(300000)}),env)).status,413);assert.equal(calls,0);
  const broken=await app.fetch(send(cookie),env);assert.equal(broken.status,500);assert.ok(!(await broken.text()).includes(env.DEEPSEEK_API_KEY));
});
test('在线构建脚本只读取公开资源和代码，不读取任何环境文件',async()=>{
  const source=await readFile(new URL('../scripts/build-online.mjs',import.meta.url),'utf8');
  assert.ok(!/loadEnvFile|readFile\([^\n]*['"]\.env/.test(source));
});
