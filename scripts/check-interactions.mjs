// Opt-in live acceptance. Uses synthetic data in memory; never reads browser sessions.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {mount,waitFor} from '../tests/ui-harness.mjs';
const page=await mount({seed:{mode:'deepseek'},live:true});
const checks=[];
async function ask(message,label){
  page.submit(message);
  await waitFor(()=>page.$('#model-progress').classList.contains('hidden'),60000);
  if(!page.$('#model-error').classList.contains('hidden'))throw Error(page.$('#model-error-text').textContent);
  const state=page.state();checks.push({message,route:state.route.label,reply:state.messages.at(-1).text,proposal:state.proposal||null});
  assert.equal(state.route.label,label,JSON.stringify(checks.at(-1)));console.log('PASS '+label+' | '+message);
}
try{
  await ask('四层板，长十厘米宽八厘米，先做十块，工艺和交期我下一条再告诉你。','报参数');
  assert.deepEqual(page.state().params,{});assert.ok(page.$('#confirm-params'));page.$('#confirm-params').click();
  assert.deepEqual(page.state().params,{layers:'4层',size:'100 × 80 mm',quantity:'10'});assert.match(page.$('#messages').textContent,/接下来请补充工艺/);
  await ask('工艺用沉金。','报参数');page.$('#confirm-params').click();assert.match(page.$('#messages').textContent,/接下来请补充交期/);
  await ask('交期七天。','报参数');page.$('#confirm-params').click();assert.equal(page.state().params.delivery,'7天');
  await ask('沉金和喷锡有什么区别？只是咨询，不要修改。','问参数');assert.ok(!page.state().proposal);
  await ask('AMS1117 有替代料吗？先给我核对思路。','问替代料');assert.ok(!page.state().proposal);
  await ask('数量改成二十块，其它不变。','报参数');assert.equal(page.state().params.quantity,'10');page.$('#confirm-params').click();assert.equal(page.state().params.quantity,'20');
  await ask('数量再改成三十块。','报参数');assert.equal(page.state().params.quantity,'20');page.$('#reject-params').click();assert.equal(page.state().params.quantity,'20');
  await ask('如果改成六层有什么影响？先不要改。','问参数');assert.equal(page.state().params.layers,'4层');assert.ok(!page.state().proposal);
  page.$('#load-merge').click();assert.equal(page.$('#merged-body').children.length,3);assert.match(page.$('#conservation').textContent,/数量：6 \/ 6/);
  page.$('#merged-body [data-locate="2"]').click();assert.equal(page.win.document.activeElement.getAttribute('aria-label'),'第 2 行型号');
  page.$('#load-anomalies').click();assert.equal(page.$('#export').disabled,true);
  await ask('帮我导出打样需求单。','要出单');assert.equal(page.$('#export').disabled,true);
  for(const [line,field] of [[2,'位号'],[3,'封装'],[4,'数量']]){page.$(`#issues [data-locate="${line}"]`).click();assert.equal(page.win.document.activeElement.getAttribute('aria-label'),`第 ${line} 行${field}`);}
  page.$('#repair').click();assert.equal(page.$('#export').disabled,false);page.$('#export').click();assert.equal(page.downloads.length,1);
  const csv=await page.downloads[0].blob.text();assert.match(csv,/"DEMO-RES-10K","0603","R1,R2,R4","3","60"/);
  page.$('#template').value='嘉立创';page.$('#export').click();const other=await page.downloads[1].blob.text();assert.match(other,/"R1,R2,R4","3","DEMO-RES-10K","0603","60"/);
  await ask('我还没想清楚要做哪一步。','待确认');assert.equal(page.$('.clarification').children.length,4);
  const records={checkedAt:new Date().toISOString(),environment:'Happy DOM events + real local API + real DeepSeek; synthetic in-memory session. No graphical browser or OS download verification.',checks,bom:{mergeRows:3,anomaliesLocated:true,repair:true,exportTemplates:2,totalBoards:20},result:'passed'};
  await mkdir(new URL('../docs/acceptance/',import.meta.url),{recursive:true});
  await writeFile(new URL('../docs/acceptance/interactions.json',import.meta.url),JSON.stringify(records,null,2));
  await writeFile(new URL('../docs/acceptance/打样需求单_立创.csv',import.meta.url),csv);
  await writeFile(new URL('../docs/acceptance/打样需求单_嘉立创.csv',import.meta.url),other);
  console.log('PASS merge, anomaly focus, repair, export CSV content in both templates.');
}finally{await page.close();}
