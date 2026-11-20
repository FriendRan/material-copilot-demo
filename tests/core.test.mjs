import test from 'node:test';
import assert from 'node:assert/strict';
import {extract,classify,mergeBom,parseCsv,makeOrder,sampleRows,csvCell} from '../public/core.js';
const params={layers:'4层',size:'100 × 80 mm',quantity:'10',process:'沉金',delivery:'7天'};
test('一句话提取五项参数，后续覆盖只更新已有字段',()=>{
  assert.deepEqual(extract('4层，100x80mm，10块，沉金，7天'),params);
  assert.deepEqual({...params,...extract('改成20块')},{...params,quantity:'20'});
});
test('四类意图与不确定意图',()=>{
  for(const [text,expected] of [['4层板','报参数'],['沉金和喷锡有什么区别','问参数'],['AMS1117有替料吗','查替料'],['导出需求单','要出单'],['你好','待确认'],['4层，帮我出单','待确认']])assert.equal(classify(text),expected);
});
test('合并键包含封装，数量和位号守恒',()=>{
  const result=mergeBom(sampleRows);assert.equal(result.merged.length,6);assert.equal(result.inputTotal,9);assert.equal(result.outputTotal,9);assert.equal(result.uniqueRefs,9);assert.equal(result.issues.length,2);
  assert.equal(result.merged[0].quantity,3);assert.deepEqual(result.merged[0].refs,['R1','R2','R3']);
});
test('重复位号、缺失位号、非法数量都被阻止',()=>{
  assert.match(mergeBom([{model:'X',package:'0603',quantity:2,refs:'R1,R1'}]).issues.map(x=>x.message).join(),/重复/);
  for(const quantity of ['',0,-1,'NaN',1.5])assert.ok(mergeBom([{model:'X',package:'0603',quantity,refs:''}]).issues.length);
  assert.ok(mergeBom([]).issues.length);
});
test('CSV 支持带引号的位号、BOM 标记与 Windows 换行',()=>{
  const rows=parseCsv('\uFEFF型号,封装,数量,位号\r\nX,0603,2,"R1,R2"\r\n');assert.equal(rows[0].refs,'R1,R2');assert.equal(mergeBom(rows).issues.length,0);
  assert.throws(()=>parseCsv('型号,数量\nX,2'));assert.throws(()=>parseCsv('型号,封装,数量,位号\n"X'));
});
test('出单拦截未齐参数与异常，并按板数计算元件需求',()=>{
  assert.throws(()=>makeOrder(sampleRows,params,'立创'));
  const rows=[{model:'X',package:'0603',quantity:2,refs:'R1,R2'}];
  assert.throws(()=>makeOrder(rows,{},'立创'));
  const csv=makeOrder(rows,params,'立创');assert.match(csv,/"X","0603","R1,R2","2","20"/);
  assert.match(makeOrder(rows,params,'嘉立创'),/"R1,R2","2","X","0603","20"/);
});
test('CSV 导出防止常见公式注入',()=>{assert.equal(csvCell('=1+1'),'"\'=1+1"');});
