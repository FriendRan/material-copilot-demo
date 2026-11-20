export function makeProposal(params,result){
  const updates=Object.fromEntries(Object.entries(result.updates).filter(([key,value])=>params[key]!==value));
  const clear=result.clear_fields.filter(key=>Object.hasOwn(params,key));
  return Object.keys(updates).length||clear.length?{base:JSON.stringify(params),updates,clear}:null;
}
export function applyProposal(params,proposal){
  if(!proposal||JSON.stringify(params)!==proposal.base)throw new Error('需求已发生变化，请重新描述本次修改。');
  const next={...params,...proposal.updates};for(const key of proposal.clear)delete next[key];return next;
}
