import test from 'node:test';
import assert from 'node:assert/strict';
import {connectBackend,waitForConnection} from '../public/connection.js';
import {mount,baseParams,waitFor,flush} from './ui-harness.mjs';

test('连接：休眠 HTML、网关错误后重试配置，不调用模型接口',async()=>{
  const paths=[];let calls=0;
  const config=await connectBackend({sleep:async()=>{},fetchImpl:async path=>{
    paths.push(path);calls++;
    if(calls===1)return new Response('<html>Starting service</html>');
    if(calls===2)return new Response('',{status:503});
    return new Response(JSON.stringify({configured:true,hosted:true}));
  }});
  assert.equal(config.configured,true);assert.deepEqual(paths,['/api/config','/api/config','/api/config']);
});
test('连接：超时与重试有上限，主动停止不会发送迟到的需求',async()=>{
  let calls=0;
  await assert.rejects(connectBackend({attempts:2,timeoutMs:5,sleep:async()=>{},fetchImpl:async(path,{signal})=>{
    calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  }}),/输入内容已保留/);
  assert.equal(calls,2);
  let finish;const waiting=new Promise(resolve=>{finish=resolve;}),controller=new AbortController();
  const stopped=waitForConnection(waiting,controller.signal);controller.abort();
  await assert.rejects(stopped,{name:'AbortError'});finish({configured:true});
});
test('页面：服务未就绪时先显示界面，BOM 与离线补齐仍可操作，草稿不丢失',async()=>{
  let finish;const page=await mount({seed:{mode:'deepseek'},configFetch:()=>new Promise(resolve=>{finish=resolve;})});
  try{
    assert.equal(page.$('#backend-status').classList.contains('hidden'),false);
    assert.match(page.$('#backend-status').textContent,/唤醒通常需要约 1 分钟/);
    page.$('#chat-input').value='稍后补交期';page.$('#chat-input').dispatchEvent(new page.win.Event('input'));
    page.$('.nav[data-view="bom-view"]').click();page.$('#load-merge').click();
    assert.equal(page.state().rows.length,4);page.$('.nav[data-view="workspace"]').click();
    assert.equal(page.$('#chat-input').value,'稍后补交期');
    page.$('#use-offline').click();page.submit('4层，100x80mm，10块，沉金，7天');page.$('#confirm-params').click();
    assert.deepEqual(page.state().params,baseParams);assert.equal(page.$('#export').disabled,false);
    finish(new Response(JSON.stringify({configured:true,hosted:true})));await flush();
    assert.equal(page.$('#model-mode').value,'rules');assert.equal(page.requests.length,0);
  }finally{await page.close();}
});
test('页面：等待就绪后只发送一次需求，停止等待后迟到的连接结果不会发送',async()=>{
  for(const stop of [false,true]){
    let finish;const page=await mount({seed:{mode:'deepseek'},configFetch:()=>new Promise(resolve=>{finish=resolve;}),reply:async()=>({reply:'请确认数量。',intent:'collect',updates:{quantity:'20'},clear_fields:[],handoff:'none',handoff_reason:'',model:'fixture'})});
    try{
      page.submit('20块');await flush();assert.equal(page.requests.length,0);assert.equal(page.state().messages.at(-1).text,'20块');
      if(stop)page.$('#cancel-model').click();
      finish(new Response(JSON.stringify({configured:true,hosted:true})));await flush();
      if(stop){assert.equal(page.requests.length,0);assert.equal(page.state().proposal,undefined);}
      else{await waitFor(()=>page.$('#confirm-params'));assert.equal(page.requests.length,1);assert.deepEqual(page.state().params,{});page.$('#confirm-params').click();assert.equal(page.state().params.quantity,'20');}
    }finally{await page.close();}
  }
});
