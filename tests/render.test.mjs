import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {createHostedServer} from '../online/node-server.mjs';
import {createOnlineHandler} from '../online/worker.mjs';

const origin='https://demo.onrender.com';
const env={RENDER_EXTERNAL_URL:origin,DEEPSEEK_API_KEY:'test-render-key-not-real',DEMO_SESSION_SECRET:'test-render-session-not-real'};
const payload={message:'四层，做十块',params:{},rows:[],history:[]};
async function fixture(t,chat=async()=>({reply:'test'})){
  const handler=createOnlineHandler({assets:{'/index.html':{content:'<h1>Demo</h1>',type:'text/html; charset=utf-8'}},chat});
  const server=createHostedServer({handler,env});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base='http://127.0.0.1:'+server.address().port;
  // Match the HTTPS proxy's actual HTTP Host header. Native fetch owns Host
  // itself, so use node:http for these reverse-proxy integration requests.
  const send=(route,init={})=>new Promise((resolve,reject)=>{
    const req=request(base+route,{method:init.method||'GET',headers:{Host:new URL(origin).host,...init.headers}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
      res.on('end',()=>{const headers=new Headers();for(let i=0;i<res.rawHeaders.length;i+=2)headers.append(res.rawHeaders[i],res.rawHeaders[i+1]);resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}));});
    });req.on('error',reject);req.end(init.body);
  });
  return {send};
}

test('Render HTTP：页面、健康检查、HEAD 与配置可用，密钥和服务端文件不可下载',async t=>{
  let calls=0;const {send}=await fixture(t,async()=>{calls++;return {};});
  assert.equal(await (await send('/')).text(),'<h1>Demo</h1>');
  assert.equal(await (await send('/',{method:'HEAD'})).text(),'');
  assert.deepEqual(await (await send('/healthz')).json(),{ok:true});
  for(const route of ['/.env','/server.mjs','/dist/server/index.js','/online/node-server.mjs','/render.yaml'])assert.equal((await send(route)).status,404);
  const config=await send('/api/config'),text=await config.text();
  assert.equal(JSON.parse(text).configured,true);assert.equal(JSON.parse(text).hosted,true);
  assert.ok(!text.includes(env.DEEPSEEK_API_KEY));assert.ok(!text.includes(env.DEMO_SESSION_SECRET));
  assert.match(config.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);assert.equal(calls,0);
});

test('Render HTTP：真实 HTTP 桥保留会话与同源校验，合法请求才调用模型',async t=>{
  let calls=0;const {send}=await fixture(t,async input=>{calls++;assert.equal(input.message,payload.message);return {reply:'已收到',intent:'collect',updates:{layers:'4层',quantity:'10'}};});
  const cookie=(await send('/api/config')).headers.get('set-cookie').split(';')[0];
  const post=(headers={},body=payload)=>({method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...headers},body:JSON.stringify(body)});
  assert.equal((await send('/api/chat',post())).status,401);
  assert.equal((await send('/api/chat',post({cookie,Origin:'https://other.example'}))).status,403);
  assert.equal((await send('/api/chat',post({cookie},{...payload,params:{quantity:'-1'}}))).status,400);
  assert.equal(calls,0);
  const response=await send('/api/chat',post({cookie}));assert.equal(response.status,200);
  assert.equal((await response.json()).updates.quantity,'10');assert.equal(calls,1);
  assert.equal((await send('/api/chat',post({cookie},{...payload,message:'x'.repeat(300000)}))).status,413);assert.equal(calls,1);
});

test('Render HTTP：伪造 Host、上游错误与客户端 IP 头不能绕过演示边界',async t=>{
  let calls=0;const {send}=await fixture(t,async()=>{calls++;throw Error(env.DEEPSEEK_API_KEY);});
  assert.equal((await send('/',{headers:{Host:'other.example','X-Forwarded-Host':new URL(origin).host}})).status,403);
  const cookie=(await send('/api/config')).headers.get('set-cookie').split(';')[0];
  const post=()=>({method:'POST',headers:{'Content-Type':'application/json',cookie,'cf-connecting-ip':String(calls),'x-forwarded-for':String(calls)},body:JSON.stringify(payload)});
  const error=await send('/api/chat',post());assert.equal(error.status,500);assert.ok(!(await error.text()).includes(env.DEEPSEEK_API_KEY));
  for(let i=1;i<40;i++){
    const newCookie=(await send('/api/config')).headers.get('set-cookie').split(';')[0];
    const init=post();init.headers.cookie=newCookie;assert.equal((await send('/api/chat',init)).status,500);
  }
  const freshCookie=(await send('/api/config')).headers.get('set-cookie').split(';')[0];
  const limited=post();limited.headers.cookie=freshCookie;assert.equal((await send('/api/chat',limited)).status,429);assert.equal(calls,40);
});

test('Render 启动拒绝缺失或不安全的公共域名配置',()=>{
  for(const value of ['', 'http://demo.onrender.com','https://demo.onrender.com/path','https://user:pass@demo.onrender.com','https://demo.onrender.com/?x=1'])assert.throws(()=>createHostedServer({handler:{},env:{PUBLIC_ORIGIN:value}}));
});
