import test from 'node:test';
import assert from 'node:assert/strict';
import {handoffReason,buildHandoff,handoffChanged} from '../public/handoff.js';
import {sampleRows} from '../public/core.js';
test('明确请求人工优先，否定语句不会直接转人工',()=>{
  for(const text of ['转人工','我要找工程师','联系人工客服','人工服务在哪里'])assert.equal(handoffReason(text)?.direct,true);
  for(const text of ['不用转人工','不需要人工客服','不要找工程师'])assert.equal(handoffReason(text),null);
});
test('连续两次理解失败才建议升级，反馈未解决可立即建议',()=>{
  assert.equal(handoffReason('不明白',1),null);
  assert.equal(handoffReason('不明白',2)?.direct,false);
  assert.match(handoffReason('你答非所问')?.reason,/未解决/);
});
test('交接单保留独立上下文快照、缺项、异常与真实状态',()=>{
  const state={params:{layers:'4层'},rows:structuredClone(sampleRows),messages:[{role:'user',text:'帮我核对'}]};
  const ticket=buildHandoff(state,'人工核对','核对封装','DEMO-test');
  assert.equal(ticket.status,'local-draft');assert.equal(ticket.id,'DEMO-test');assert.equal(ticket.issues.length,2);
  assert.deepEqual(ticket.missing,['尺寸','数量','工艺','交期']);
  state.params.layers='6层';state.rows[0].model='changed';state.messages[0].text='changed';
  assert.equal(ticket.params.layers,'4层');assert.equal(ticket.rows[0].model,sampleRows[0].model);assert.equal(ticket.messages[0].text,'帮我核对');
  assert.match(ticket.notice,/未发送/);
});
test('未改动的交接单不会重复保存，变更原因或备注后必须更新',()=>{
  const state={params:{layers:'4层'},rows:structuredClone(sampleRows),messages:[]};
  const ticket=buildHandoff(state,'核对封装','备注','DEMO-test');
  assert.equal(handoffChanged(ticket,state,'核对封装','备注'),false);
  assert.equal(handoffChanged(ticket,state,'核对封装',' 备注 '),false);
  assert.equal(handoffChanged(ticket,state,'查替料','备注'),true);
  assert.equal(handoffChanged(ticket,state,'核对封装','新备注'),true);
  assert.equal(handoffChanged(null,state,'核对封装','备注'),true);
});
test('参数、BOM、对话变更和已结束的交接单不能下载为当前快照',()=>{
  const state={params:{layers:'4层'},rows:structuredClone(sampleRows),messages:[]};
  const ticket=buildHandoff(state,'原因','备注');
  for(const change of [s=>s.params.layers='6层',s=>s.rows.pop(),s=>s.messages.push({role:'user',text:'新需求'})]){
    const modified=structuredClone(state);change(modified);assert.equal(handoffChanged(ticket,modified,'原因','备注'),true);
  }
  ticket.status='closed-locally';assert.equal(handoffChanged(ticket,state,'原因','备注'),true);
});
