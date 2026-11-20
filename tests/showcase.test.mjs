import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeBom,makeOrder} from '../public/core.js';
import {mergeExample,anomalyExample,repairedAnomaly,intentLabels} from '../public/showcase.js';
test('面试样例：同型号同封装合并，不同封装独立，数量与位号可追溯',()=>{
  const result=mergeBom(mergeExample);
  assert.equal(result.issues.length,0);assert.equal(result.merged.length,3);
  assert.deepEqual(result.merged[0],{model:'DEMO-RES-10K',package:'0603',quantity:3,refs:['R1','R2','R3'],lines:[1,2]});
  assert.equal(result.merged[1].package,'0805');assert.equal(result.merged[1].quantity,1);
  assert.equal(result.inputTotal,6);assert.equal(result.outputTotal,6);assert.equal(result.beforeRefCount,6);assert.equal(result.afterRefCount,6);
  assert.equal(result.quantityConserved,true);assert.equal(result.refsConserved,true);
});
test('异常样例：重复位号关联两行，缺失数量与封装冲突定位到字段，保留守恒但阻止出单',()=>{
  const result=mergeBom(anomalyExample);
  const duplicate=result.issues.find(issue=>issue.message.includes('重复'));
  assert.equal(duplicate.line,2);assert.deepEqual(duplicate.relatedLines,[1]);assert.equal(duplicate.field,'refs');
  assert.ok(result.issues.some(issue=>issue.line===3&&issue.field==='package'));
  assert.ok(result.issues.some(issue=>issue.line===4&&issue.field==='quantity'));
  assert.equal(result.refsConserved,true);assert.equal(result.uniqueRefs,4);assert.equal(result.beforeRefCount,5);
  assert.throws(()=>makeOrder(anomalyExample,{layers:'4层',size:'100 × 80 mm',quantity:'10',process:'沉金',delivery:'7天'},'立创'));
  assert.equal(mergeBom(repairedAnomaly).issues.length,0);
});
test('模型意图映射为四类业务分流，澄清和人工协助保持独立',()=>{
  assert.deepEqual(['question','collect','substitute','order'].map(key=>intentLabels[key]),['问参数','报参数','问替代料','要出单']);
  assert.equal(intentLabels.clarify,'待确认');assert.equal(intentLabels.handoff,'人工协助');
});
