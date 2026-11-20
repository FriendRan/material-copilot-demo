export const intentLabels={collect:'报参数',question:'问参数',substitute:'问替代料',order:'要出单',clarify:'待确认',handoff:'人工协助'};
export const routeActions={
  '报参数':'提取参数变更，补齐五项需求',
  '问参数':'解释参数；不把咨询误写为已确认需求',
  '问替代料':'识别替料需求；提供核对说明或人工协助入口',
  '要出单':'先检查参数完整性与 BOM 异常，再允许导出',
  '待确认':'先反问确认意图，避免进入错误分支',
  '人工协助':'保留上下文，打开本地交接单'
};
// Constructed fixtures: demonstrate the merge key, never imply real compatibility.
export const mergeExample=[
  {model:'DEMO-RES-10K',package:'0603',quantity:'2',refs:'R1,R2'},
  {model:'DEMO-RES-10K',package:'0603',quantity:'1',refs:'R3'},
  {model:'DEMO-RES-10K',package:'0805',quantity:'1',refs:'R4'},
  {model:'DEMO-CAP-100N',package:'0603',quantity:'2',refs:'C1,C2'}
];
export const anomalyExample=[
  {model:'DEMO-RES-10K',package:'0603',quantity:'2',refs:'R1,R2'},
  {model:'DEMO-RES-10K',package:'0603',quantity:'1',refs:'R2'},
  {model:'RC0603FR-0710KL',package:'0805',quantity:'1',refs:'R3'},
  {model:'DEMO-CAP-100N',package:'0603',quantity:'',refs:'C1'}
];
export const repairedAnomaly=anomalyExample.map((row,index)=>({...row,...(index===1?{refs:'R4'}:index===2?{package:'0603'}:index===3?{quantity:'1'}:{})}));
