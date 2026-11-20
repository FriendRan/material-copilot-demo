import {fields,mergeBom} from './core.js';
export function handoffChanged(ticket,state,reason,note){
  if(!ticket||ticket.status!=='local-draft')return true;
  return JSON.stringify([ticket.params,ticket.rows,ticket.messages,ticket.reason,ticket.note])!==JSON.stringify([state.params,state.rows,state.messages,reason,note.trim()]);
}
export function handoffReason(text, failures=0) {
  const negative=/(?:不需要|不用|不要|别|不想).{0,4}(?:人工|客服|工程师)/.test(text);
  if(!negative && /转人工|人工客服|找.{0,3}(?:人工|客服|工程师)|联系.{0,3}(?:人工|客服|工程师)|真人|人工服务|^人工$/.test(text)) return {direct:true,reason:'用户主动申请人工协助'};
  if(/没解决|未解决|答非所问|听不懂|投诉|不满意/.test(text)) return {direct:false,reason:'用户反馈问题尚未解决'};
  if(failures>=2) return {direct:false,reason:'连续两次未能理解需求'};
  return null;
}
export function buildHandoff(state,reason,note='',id='DEMO-'+Date.now()) {
  const result=mergeBom(state.rows);
  return {id,status:'local-draft',createdAt:new Date().toISOString(),reason,note,
    params:structuredClone(state.params),missing:Object.keys(fields).filter(key=>!state.params[key]).map(key=>fields[key]),
    rows:structuredClone(state.rows),issues:result.issues,merged:result.merged,
    messages:structuredClone(state.messages),notice:'仅保存在本机，未发送至客服后台，无真实客服接入'};
}
