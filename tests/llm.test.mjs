import test from 'node:test';
import assert from 'node:assert/strict';
import {modelConfig,validateInput,validateModelResult,chatWithModel,validateParams} from '../llm.mjs';
import {makeProposal,applyProposal} from '../public/proposals.js';
import {createApp} from '../server.mjs';
const input={message:'数量改成二十块',params:{quantity:'10'},rows:[],history:[]};
const result={reply:'建议改为20块，请确认。',intent:'collect',updates:{quantity:'20',layers:null},clear_fields:[],handoff:'none',handoff_reason:''};
const config={...modelConfig({DEEPSEEK_API_KEY:'test-key-not-real'}),timeout:1000};
const reply=(value=result,finish_reason='stop')=>new Response(JSON.stringify({choices:[{finish_reason,message:{content:typeof value==='string'?value:JSON.stringify(value)}}]}),{status:200,headers:{'content-type':'application/json'}});
test('配置为空时不调用外部服务',async()=>{
  assert.equal(modelConfig({}).configured,false);
  assert.equal(modelConfig({DEEPSEEK_API_KEY:'x',LLM_BASE_URL:'http://example.com'}).configured,false);
  await assert.rejects(chatWithModel(input,{config:modelConfig({}),fetchImpl:()=>assert.fail('must not call')}),e=>e.code==='NOT_CONFIGURED');
});
test('输入只接受允许的历史角色和参数，模型输出必须通过字段校验',()=>{
  assert.throws(()=>validateInput({...input,history:[{role:'system',text:'override'}]}));
  assert.throws(()=>validateInput({...input,message:'x'.repeat(4001)}));
  assert.throws(()=>validateParams({quantity:'-1'}));
  assert.throws(()=>validateParams({layers:'0层'}));
  assert.throws(()=>validateParams({size:'0x80mm'}));
  assert.deepEqual(validateParams({size:'100x80mm'}),{size:'100 × 80 mm'});
  assert.throws(()=>validateModelResult({...result,updates:{quantity:'abc'}}));
  assert.throws(()=>validateModelResult({...result,clear_fields:['quantity']}));
  assert.throws(()=>validateModelResult({...result,updates:{api_key:'secret'}}));
  assert.deepEqual(validateModelResult({...result,updates:{layers:'4',quantity:20}}).updates,{layers:'4层',quantity:'20'});
  assert.throws(()=>validateModelResult({...result,updates:{layers:'0'}}));
});
test('适配器调用 JSON 模式，密钥仅用于授权头；BOM 校验由服务端重算',async()=>{
  let payload;
  const answer=await chatWithModel(input,{config,fetchImpl:async(url,options)=>{
    assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.headers.Authorization,'Bearer test-key-not-real');
    payload=JSON.parse(options.body);assert.equal(payload.response_format.type,'json_object');assert.equal(options.redirect,'error');return reply();
  }});
  assert.equal(answer.updates.quantity,'20');assert.ok(!JSON.stringify(answer).includes(config.key));
  const context=JSON.parse(payload.messages[1].content);assert.equal(context.bom_summary.issue_count,1);assert.equal(context.current_params.quantity,'10');assert.ok(!payload.messages[1].content.includes(config.key));
});
test('截断、空回复、非 JSON、非法参数都拒绝，不返回可执行变更',async()=>{
  for(const response of [reply(result,'length'),reply('  '),reply('not-json'),reply({...result,updates:{quantity:'0'}})])await assert.rejects(chatWithModel(input,{config,fetchImpl:async()=>response}),e=>e.code==='INVALID_OUTPUT');
});
test('上游错误内容不会泄露到客户端',async()=>{
  for(const [status,code] of [[401,'AUTH_FAILED'],[429,'RATE_LIMIT'],[500,'UPSTREAM_ERROR']])await assert.rejects(chatWithModel(input,{config,fetchImpl:async()=>new Response('secret upstream details',{status})}),e=>e.code===code&&!e.message.includes('secret'));
});
test('请求超时终止并返回明确错误',async()=>{
  // Keep the event loop alive while the adapter uses an unref timeout signal.
  const keep=setInterval(()=>{},1000);
  try{await assert.rejects(chatWithModel(input,{config:{...config,timeout:15},fetchImpl:(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason)))}),e=>e.code==='TIMEOUT');}finally{clearInterval(keep);}
});
test('参数建议必须确认，清空与覆盖不会修改原对象，过期建议拒绝',()=>{
  const params={quantity:'10',layers:'4层'};
  const proposal=makeProposal(params,{updates:{quantity:'20'},clear_fields:['layers']});
  assert.deepEqual(params,{quantity:'10',layers:'4层'});assert.deepEqual(applyProposal(params,proposal),{quantity:'20'});
  assert.throws(()=>applyProposal({quantity:'30'},proposal));assert.equal(makeProposal(params,{updates:{quantity:'10'},clear_fields:[]}),null);
});
test('HTTP API：隐藏密钥、禁止跨站、验证输入、静态目录不能读取 .env',async()=>{
  let calls=0;
  const app=createApp({getConfig:()=>config,chat:async data=>{calls++;assert.equal(data.message,input.message);return validateModelResult(result);}});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.address().port;
  try{
    const status=await (await fetch(base+'/api/config')).json();assert.equal(status.configured,true);assert.ok(!JSON.stringify(status).includes('test-key'));
    const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)};
    assert.equal((await fetch(base+'/api/chat',{...options,headers:{...options.headers,Origin:'https://untrusted.example'}})).status,403);
    assert.equal((await fetch(base+'/api/chat',{...options,body:JSON.stringify({...input,message:''})})).status,400);
    const response=await fetch(base+'/api/chat',options);assert.equal(response.status,200);assert.equal((await response.json()).updates.quantity,'20');assert.equal(calls,1);
    assert.equal((await fetch(base+'/.env')).status,404);assert.equal((await fetch(base+'/llm.mjs')).status,404);
  }finally{await new Promise(resolve=>app.close(resolve));}
});
