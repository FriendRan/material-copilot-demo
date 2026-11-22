import test from 'node:test';
import assert from 'node:assert/strict';
import {mount,baseParams,flush,waitFor} from './ui-harness.mjs';
const answer=(overrides={})=>({reply:'请确认本次建议。',intent:'collect',updates:{},clear_fields:[],handoff:'none',handoff_reason:'',model:'test-model',...overrides});

test('页面：胶囊示例只填入草稿并标记选择，编辑或发送后取消选择',async()=>{
  const page=await mount();try{
    const choices=[...page.win.document.querySelectorAll('[data-example-prompt]')],before=page.state().messages.length;
    choices[0].click();assert.equal(page.$('#chat-input').value,choices[0].dataset.examplePrompt);assert.equal(choices[0].getAttribute('aria-pressed'),'true');assert.equal(page.state().messages.length,before);assert.equal(page.requests.length,0);
    page.$('#chat-input').value+='，沉金';page.$('#chat-input').dispatchEvent(new page.win.Event('input'));assert.equal(choices[0].getAttribute('aria-pressed'),'false');
    choices[1].click();assert.equal(choices[1].getAttribute('aria-pressed'),'true');assert.equal(choices[0].getAttribute('aria-pressed'),'false');
    page.submit(choices[1].dataset.examplePrompt);assert.equal(choices[1].getAttribute('aria-pressed'),'false');
  }finally{await page.close();}
});

test('页面：对话与 BOM 分页切换保留待确认变更、输入草稿及当前参数',async()=>{
  const page=await mount({seed:{params:baseParams}});try{
    assert.equal(page.$('#bom-view').classList.contains('hidden'),true);
    page.submit('改成20块');page.$('#chat-input').value='交期再讨论';page.$('#chat-input').dispatchEvent(new page.win.Event('input'));
    page.$('.next-step [data-view="bom-view"]').click();
    assert.equal(page.$('#workspace').classList.contains('hidden'),true);assert.equal(page.$('#bom-view').classList.contains('hidden'),false);
    assert.equal(page.$('.nav[data-view="bom-view"]').getAttribute('aria-current'),'page');
    assert.equal(page.state().params.quantity,'10');assert.equal(page.state().proposal.updates.quantity,'20');assert.equal(page.$('#export').disabled,true);
    page.$('.nav[data-view="workspace"]').click();assert.equal(page.$('#chat-input').value,'交期再讨论');page.$('#confirm-params').click();assert.equal(page.state().params.quantity,'20');
  }finally{await page.close();}
});

test('页面：BOM 示例切到独立校验页，继续自助回到可见的对话输入',async()=>{
  const page=await mount({seed:{params:baseParams}});try{
    page.$('#load-anomalies').click();assert.equal(page.$('#bom-view').classList.contains('hidden'),false);
    assert.equal(page.$('#export').disabled,true);page.$('#repair').click();assert.equal(page.$('#export').disabled,false);
    page.$('#human-support').click();page.$('#resume-assistant').click();
    assert.equal(page.$('#workspace').classList.contains('hidden'),false);assert.equal(page.win.document.activeElement.id,'chat-input');assert.deepEqual(page.state().params,baseParams);
  }finally{await page.close();}
});

test('页面：四类意图去向正确，问参数/替料不改需求，缺项或异常拦截出单',async()=>{
  const page=await mount();try{
    for(const [text,label] of [['沉金和喷锡有什么区别？','问参数'],['AMS1117有替料吗','问替代料'],['导出需求单','要出单'],['4层，100x80mm，10块','报参数']]){
      page.submit(text);assert.match(page.$('#routing').textContent,new RegExp('当前分流：'+label));assert.deepEqual(page.state().params,{});assert.equal(page.$('#export').disabled,true);
    }
    assert.ok(page.$('#confirm-params'));page.$('#confirm-params').click();
    assert.deepEqual(page.state().params,{layers:'4层',size:'100 × 80 mm',quantity:'10'});
    assert.match(page.$('#missing-summary').textContent,/工艺、交期/);
    assert.match(page.$('#messages').textContent,/接下来请补充工艺/);
  }finally{await page.close();}
});
test('页面：分步补齐只追问缺项；改口确认前后保留其他字段，拒绝后不修改',async()=>{
  const page=await mount({seed:{params:{layers:'4层',size:'100 × 80 mm',quantity:'10'}}});try{
    page.submit('沉金');page.$('#confirm-params').click();assert.match(page.$('#messages').textContent,/接下来请补充交期/);
    page.submit('7天');page.$('#confirm-params').click();assert.deepEqual(page.state().params,baseParams);
    page.submit('改成20块');assert.equal(page.state().params.quantity,'10');assert.match(page.$('#parameter-proposal').textContent,/10.*20/s);
    page.$('#confirm-params').click();assert.deepEqual(page.state().params,{...baseParams,quantity:'20'});assert.match(page.$('#param-changes').textContent,/数量：10.*20/s);
    page.submit('改成30块');page.$('#reject-params').click();assert.equal(page.state().params.quantity,'20');
  }finally{await page.close();}
});
test('页面：未确认建议不会被下一条消息或切换模式丢弃，输入草稿保留',async()=>{
  const page=await mount({seed:{params:baseParams}});try{
    page.submit('改成20块');page.submit('尺寸改成120x80mm');assert.equal(page.$('#chat-input').value,'尺寸改成120x80mm');assert.equal(page.state().proposal.updates.quantity,'20');assert.equal(page.state().params.quantity,'10');
    page.$('#model-mode').value='deepseek';page.$('#model-mode').dispatchEvent(new page.win.Event('change'));assert.equal(page.$('#model-mode').value,'rules');assert.ok(page.$('#confirm-params'));
  }finally{await page.close();}
});
test('页面：离线不明意图反问可选，模型澄清也显示四类快捷入口并回到模型',async()=>{
  const rules=await mount();try{rules.submit('我还没想好');assert.equal(rules.$('.clarification').children.length,4);[...rules.$('.clarification').children].find(b=>b.textContent==='要出单').click();assert.equal(rules.state().route.label,'要出单');}finally{await rules.close();}
  const page=await mount({seed:{mode:'deepseek'},reply:input=>input.message.startsWith('我确认')?answer({intent:'order'}):answer({intent:'clarify',reply:'你想先问参数还是出单？'})});try{
    page.submit('我还没想好');await waitFor(()=>page.$('.clarification'));assert.equal(page.$('.clarification').children.length,4);
    [...page.$('.clarification').children].find(b=>b.textContent==='要出单').click();await waitFor(()=>page.state().route?.label==='要出单');assert.equal(page.requests.length,2);assert.match(page.requests[1].message,/我确认刚才的意图是“要出单”/);assert.match(page.state().route.source,/DeepSeek/);
  }finally{await page.close();}
});
test('页面：DeepSeek 建议确认、取消和模型请求错误均不绕过需求状态',async()=>{
  const page=await mount({seed:{mode:'deepseek',params:baseParams},reply:input=>answer({updates:{quantity:String(Number(input.params.quantity)*2)}})});try{
    page.submit('数量翻倍');await waitFor(()=>page.$('#confirm-params'));assert.equal(page.state().params.quantity,'10');assert.equal(page.$('#export').disabled,true);assert.equal(page.requests[0].params.quantity,'10');
    page.$('#confirm-params').click();assert.equal(page.state().params.quantity,'20');assert.equal(page.state().route.label,'报参数');
    page.submit('再翻倍');await waitFor(()=>page.$('#reject-params'));page.$('#reject-params').click();assert.equal(page.state().params.quantity,'20');
    page.win.fetch=async()=>{throw Error('模拟网络错误');};page.submit('改成30块');await waitFor(()=>!page.$('#model-error').classList.contains('hidden'));assert.equal(page.state().params.quantity,'20');
  }finally{await page.close();}
});
test('页面：同键合并预览、不同封装独立、原始行链接能正确聚焦',async()=>{
  const page=await mount({seed:{params:baseParams}});try{
    page.$('#load-merge').click();assert.equal(page.$('#bom-body').children.length,4);assert.equal(page.$('#merged-body').children.length,3);
    const first=page.$('#merged-body tr');assert.match(first.textContent,/DEMO-RES-10K/);assert.match(first.textContent,/R1, R2, R3/);assert.equal(first.children[2].textContent,'3');
    assert.equal(page.$('#merged-body').children[1].children[1].textContent,'0805');
    page.$('#merged-body [data-locate="2"]').click();assert.equal(page.win.document.activeElement.getAttribute('aria-label'),'第 2 行型号');assert.equal(page.$('#bom-row-2 [data-key="model"]').__scrolled,true);
    assert.match(page.$('#conservation').textContent,/数量：6 \/ 6/);assert.match(page.$('#conservation').textContent,/位号条目：6 \/ 6/);
  }finally{await page.close();}
});
test('页面：异常两端标记，定位到正确字段；预设修复解除拦截且导出内容正确',async()=>{
  const page=await mount({seed:{params:baseParams}});try{
    page.$('#load-anomalies').click();assert.equal(page.$('#export').disabled,true);
    assert.equal(page.$('[data-row="0"][data-key="refs"]').getAttribute('aria-invalid'),'true');assert.equal(page.$('[data-row="1"][data-key="refs"]').getAttribute('aria-invalid'),'true');
    page.$('#issues [data-locate="3"]').click();assert.equal(page.win.document.activeElement.getAttribute('aria-label'),'第 3 行封装');
    page.$('#issues [data-locate="1"]').click();assert.equal(page.win.document.activeElement.getAttribute('aria-label'),'第 1 行位号');
    page.$('#issues [data-locate="4"]').click();assert.equal(page.win.document.activeElement.getAttribute('aria-label'),'第 4 行数量');
    page.$('#repair').click();assert.match(page.$('#issues').textContent,/未检出异常/);assert.equal(page.$('#export').disabled,false);
    page.$('#repair').click();assert.match(page.$('#toast').textContent,/无需重复修复/);
    page.$('#export').click();assert.equal(page.downloads.length,1);const csv=await page.downloads[0].blob.text();assert.match(csv,/"DEMO-RES-10K","0603","R1,R2,R4","3","30"/);assert.match(csv,/"数量","10"/);
    page.$('#template').value='嘉立创';page.$('#export').click();assert.match(await page.downloads[1].blob.text(),/"R1,R2,R4","3","DEMO-RES-10K","0603","30"/);
  }finally{await page.close();}
});
test('页面：手动修复每个异常后重新校验；再引入错误会重新禁用导出',async()=>{
  const page=await mount({seed:{params:baseParams}});try{
    page.$('#load-anomalies').click();page.edit(2,'refs','R4');assert.equal(page.$('#export').disabled,true);
    page.edit(3,'package','0603');assert.equal(page.$('#export').disabled,true);page.edit(4,'quantity','1');assert.equal(page.$('#export').disabled,false);
    page.edit(4,'quantity','2');assert.equal(page.$('#export').disabled,true);assert.match(page.$('#issues').textContent,/数量与位号数量不一致/);
    page.$('#export').click();assert.equal(page.downloads.length,0);
  }finally{await page.close();}
});
test('页面：参数不足和参数待确认均阻止导出，职责边界入口可打开',async()=>{
  const page=await mount();try{
    page.$('#load-merge').click();assert.equal(page.$('#export').disabled,true);
    page.submit('4层，100x80mm，10块，沉金，7天');assert.equal(page.$('#export').disabled,true);page.$('#confirm-params').click();assert.equal(page.$('#export').disabled,false);
    page.submit('改成20块');assert.equal(page.$('#export').disabled,true);page.$('#reject-params').click();assert.equal(page.$('#export').disabled,false);
    page.$('#scope-link').click();assert.equal(page.$('#about').classList.contains('hidden'),false);assert.match(page.$('#about').textContent,/本人负责：结尾的 BOM 合并与异常标记/);
  }finally{await page.close();}
});
test('页面：停止模型等待后，迟到的回复不会改动参数或重新出现确认卡片',async()=>{
  let finish;
  const page=await mount({seed:{mode:'deepseek',params:baseParams},reply:()=>new Promise(resolve=>{finish=resolve;})});try{
    page.submit('数量翻倍');await waitFor(()=>finish);assert.equal(page.$('#model-progress').classList.contains('hidden'),false);
    page.$('#cancel-model').click();assert.equal(page.$('#model-progress').classList.contains('hidden'),true);
    finish(answer({updates:{quantity:'20'}}));await flush();assert.equal(page.state().params.quantity,'10');assert.ok(!page.state().proposal);assert.equal(page.$('#confirm-params'),null);
  }finally{await page.close();}
});
