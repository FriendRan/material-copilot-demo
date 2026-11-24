import {fields,sampleRows,extract,classify,mergeBom,parseCsv,csvCell,makeOrder} from './core.js';
import {handoffReason,buildHandoff,handoffChanged} from './handoff.js';
import {makeProposal,applyProposal} from './proposals.js';
import {connectBackend,waitForConnection} from './connection.js';
import {intentLabels,routeActions,mergeExample,anomalyExample,repairedAnomaly} from './showcase.js';
const $=selector=>document.querySelector(selector);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const welcome={role:'assistant',text:'有什么物料问题需要帮忙？\n工艺、物料、打样需求，都可以直接问。'};
const actionIcon=name=>'<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+({headset:'<path d="M4 13v-1a8 8 0 0 1 16 0v1M6 12H4v7h3v-7ZM18 12h2v7h-3v-7ZM17 19c0 2-2 2-5 2"/>',chip:'<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3M10 10h4v4h-4z"/>'}[name]||'')+'</svg>';
const boardArtwork='<svg class="board-art" viewBox="0 0 148 124" fill="none" aria-hidden="true"><path d="m14 78 60 33 60-33-60-33-60 33Z" fill="#edf2f7" stroke="#b6c7d7"/><path d="m14 67 60 33 60-33-60-33-60 33Z" fill="#f6f9fc" stroke="#a0b6cc"/><path d="m14 54 60 33 60-33-60-33-60 33Z" fill="#e4eef7" stroke="#7c9bb7" stroke-width="1.5"/><path d="m47 52 27-15 27 15-27 15-27-15Z" fill="#345f82"/><path d="m55 52 19-10 19 10-19 10-19-10Z" fill="#547d9b"/><g stroke="#6b8faa" stroke-width="1.5" stroke-linecap="round"><path d="m48 43 8 4m-16 1 8 4m-7 5 8 4m44-18-8 4m16 1-8 4m7 5-8 4M61 66v8m13-6v10m13-12v8M37 65l-8 5m82-5 8 5M60 30l-9-5m37 5 9-5"/></g><g fill="#fff" stroke="#91abc1"><ellipse cx="29" cy="54" rx="4" ry="2.4"/><ellipse cx="119" cy="54" rx="4" ry="2.4"/><ellipse cx="74" cy="29" rx="4" ry="2.4"/><ellipse cx="74" cy="79" rx="4" ry="2.4"/></g></svg>';
const fresh=()=>({params:{},rows:structuredClone(sampleRows),messages:[welcome]});
let state=fresh();
let mobileLayout=null;
let modelInfo={configured:false,loading:true},modelBusy=false,modelController=null,requestSequence=0,retryText=null;
try { const saved=JSON.parse(localStorage.getItem('material-demo-v1')); if(saved && Array.isArray(saved.rows)&&Array.isArray(saved.messages)&&saved.params)state=saved; }catch{}
const entries=[
  {title:'沉金与喷锡：如何选择？',text:'沉金通常有较好的表面平整度，适合细间距焊盘；喷锡的平整度与工艺条件有关。选择时还需核对成本、焊接要求和板厂能力。',source:'内置演示知识 KB-001 · PCB 表面处理基础',keys:/沉金|喷锡|工艺/},
  {title:'AMS1117 替代料需要核对什么？',text:'不能仅凭“3.3V 稳压器”判断可替换。请逐项核对引脚定义、输入电压、压差、电流、散热、输出电容与稳定性要求。本演示不推荐未经验证的具体替代型号。',source:'内置演示知识 KB-002 · LDO 替代核对清单',keys:/AMS1117|稳压|替代|替料/i},
  {title:'为什么相同型号也可能不合并？',text:'BOM 使用“型号＋封装”作为合并键，只有两者一致才累计数量并收集位号。不同封装独立保留；重复位号、数量不符或缺失字段需要先修复。',source:'内置演示知识 KB-003 · BOM 合并规则',keys:/封装|合并|BOM/i}
];
let toastTimer;
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.remove('hidden');toastTimer=setTimeout(()=>$('#toast').classList.add('hidden'),3500);}
function save(){try{localStorage.setItem('material-demo-v1',JSON.stringify(state));}catch{toast('浏览器无法保存，当前会话仍可使用');}}
function message(role,text){state.messages.push({role,text,time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'})});if(state.messages.length>100)state.messages=state.messages.slice(-100);}
function recordRoute(intent,source){state.route={label:intentLabels[intent]|| (intent==='查替料'?'问替代料':intent),source};}
function recordParams(before,after){
  state.paramChanges=Object.keys(fields).filter(key=>before[key]!==after[key]).map(key=>({key,before:before[key]||'未填写',after:after[key]||'待补充'}));
}
function renderRouting(){
  const route=state.route;
  $('#routing').innerHTML='<div class="route-label">'+(modelBusy?'正在判断意图…':route?'当前分流：<b>'+escape(route.label)+'</b>':'等待输入需求')+'</div><details class="route-details"><summary>分流说明</summary><div class="floating-panel route-panel"><div class="route-options">'+['问参数','报参数','问替代料','要出单'].map(label=>`<span class="${route?.label===label?'selected':''}">${label}</span>`).join('')+'</div><p>'+escape(route?routeActions[route.label]||'确认需求后继续处理':'意图不明确时先反问确认，不直接进入后续流程。')+'</p>'+(route?'<small>判断来源：'+escape(route.source)+'</small>':'')+'</div></details>';
}
function renderMessages(){
  $('#workspace').classList.toggle('is-opening',state.messages.length===1&&state.messages[0]?.role==='assistant');
  $('#messages').innerHTML=state.messages.map((m,index)=>{
    const opening=index===0&&state.messages.length===1&&m.role==='assistant';
    return `<div class="message ${m.role==='user'?'user':'assistant'}${opening?' intro-message':''}">${opening?boardArtwork:`<div class="avatar">${m.role==='user'?'你':actionIcon('chip')}</div>`}<div class="bubble">${opening?'<h3>你好，我是料知</h3>':''}${escape(m.text).replaceAll('\n','<br>')}<div class="message-meta">${m.role==='user'?'你':escape(m.source||'料知 · 自动助手')}${m.time?' · '+escape(m.time):''}</div>${m.role==='assistant'&&index>0?`<div class="feedback"><button data-feedback="${index}" data-value="yes" ${m.feedback?'disabled':''}>${m.feedback==='yes'?'✓ 已帮助到我':'有帮助'}</button><button data-feedback="${index}" data-value="no" ${m.feedback?'disabled':''}>${m.feedback==='no'?'已记录未解决':'未解决'}</button></div>`:''}</div></div>`;
  }).join('');
  if(state.pending){const wrap=document.createElement('div');wrap.className='clarification';['问参数','报参数','问替代料','要出单'].forEach(label=>{const button=document.createElement('button');button.textContent=label;button.onclick=()=>{const pending=state.pending,engine=state.pendingEngine;delete state.pending;delete state.pendingEngine;if(engine==='deepseek'){send(`我确认刚才的意图是“${label}”，原话是：${pending}`);}else{message('user',label);respond(pending,label==='问替代料'?'查替料':label);}};wrap.append(button);});$('#messages').append(wrap);}
  $('#messages').scrollTop=$('#messages').scrollHeight;
}
function render(){
  const complete=Object.keys(fields).filter(key=>state.params[key]).length;
  $('#progress').textContent=`${complete} / 5 已填`;
  $('#parameter-progress').value=complete;
  $('#last-update').textContent=state.updatedAt?'最近更新：'+state.updatedAt:complete?'已恢复浏览器中保存的需求':'等待填写需求';
  $('#params').innerHTML=Object.entries(fields).map(([key,label])=>`<div class="param-row"><span>${label}</span><strong class="${state.params[key]?'':'missing'}">${escape(state.params[key]||'待补充')}${key==='quantity'&&state.params[key]?' 块':''}</strong><i>${state.params[key]?'✓':'—'}</i></div>`).join('');
  const missing=Object.keys(fields).filter(key=>!state.params[key]);
  $('#compact-progress').textContent=`${complete} / 5 项`;
  $('#compact-next').textContent=missing.length?`下一项补充：${fields[missing[0]]}`:'五项参数已确认齐全';
  $('#missing-summary').textContent=missing.length?`还缺：${missing.map(key=>fields[key]).join('、')}。下一项补充：${fields[missing[0]]}。`:'五项参数已确认齐全，可以继续检查 BOM。';
  $('#param-changes').innerHTML=state.paramChanges?.length?'<h3>最近一次已确认变更</h3>'+state.paramChanges.map(change=>`<p>${escape(fields[change.key])}：${escape(change.before)} → <b>${escape(change.after)}</b></p>`).join(''):'<p>确认参数后，这里会展示本次变更；其他字段保持原值。</p>';
  const result=mergeBom(state.rows);
  $('#row-count').textContent=`${state.rows.length} 行原始物料`;
  $('#bom-stats').innerHTML=[['原始行 → 合并项',`${state.rows.length} → ${result.merged.length}`],['单板有效数量',result.inputTotal],['异常项',result.issues.length],['出单状态',result.issues.length?'待修复':'规则通过']].map(([label,value])=>`<div><span>${label}</span><b>${value}</b></div>`).join('');
  const rowIssues=line=>result.issues.filter(issue=>issue.line===line||issue.relatedLines?.includes(line));
  $('#bom-body').innerHTML=state.rows.map((row,index)=>`<tr id="bom-row-${index+1}" class="${rowIssues(index+1).length?'invalid':''}"><td>${index+1}</td>${['model','package','quantity','refs'].map(key=>`<td><input class="${rowIssues(index+1).some(issue=>issue.field===key)?'field-error':''}" aria-invalid="${rowIssues(index+1).some(issue=>issue.field===key)}" title="${escape(rowIssues(index+1).filter(issue=>issue.field===key).map(issue=>issue.message).join('；'))}" aria-label="第 ${index+1} 行${{model:'型号',package:'封装',quantity:'数量',refs:'位号'}[key]}" data-row="${index}" data-key="${key}" value="${escape(row[key])}" ${key==='quantity'?'type="number" min="1" step="1"':''}></td>`).join('')}<td><span class="status ${rowIssues(index+1).length?'warn':''}">${rowIssues(index+1).length?'待修复':'未检出异常'}</span></td><td><button class="delete" data-delete="${index}" aria-label="删除第 ${index+1} 行">×</button></td></tr>`).join('');
  $('#merged-body').innerHTML=result.merged.map(row=>`<tr class="${row.lines.some(line=>rowIssues(line).length)?'invalid':''}"><td>${escape(row.model||'缺型号')}</td><td>${escape(row.package||'缺封装')}</td><td>${row.quantity}</td><td>${escape(row.refs.join(', ')||'无位号')}</td><td>${row.lines.map(line=>`<button class="source-line" data-locate="${line}" data-field="model" aria-label="定位原始第 ${line} 行">${line}</button>`).join(' ')}${row.lines.length>1?'<span class="merge-label">已合并</span>':''}</td></tr>`).join('');
  $('#conservation').innerHTML=`<span>数量：${result.inputTotal} / ${result.outputTotal} <b>${result.quantityConserved?'一致':'不一致'}</b></span><span>位号条目：${result.beforeRefCount} / ${result.afterRefCount} <b>${result.refsConserved?'保留一致':'不一致'}</b></span><span>唯一位号：${result.uniqueRefs}</span><small>${result.issues.length?'存在异常；非法数量未计入有效数量合计。保留一致不代表无重复或可出单。':'合并前后数量合计与位号内容一致，规则未检出异常。'}</small>`;
  $('#issues').innerHTML=result.issues.length?'<h3>异常清单 · 点击定位原始行</h3>'+result.issues.map(issue=>`<div class="issue-item"><button class="text-button" data-locate="${issue.line}" data-field="${issue.field||'model'}">${issue.line?'第 '+issue.line+' 行':'BOM 为空'}</button><span>${escape(issue.message)}</span>${issue.relatedLines?.map(line=>`<button class="text-button" data-locate="${line}" data-field="refs">关联第 ${line} 行</button>`).join('')||''}</div>`).join(''):'<div class="success">✓ 本轮规则未检出异常，可结合已确认参数生成需求单。</div>';
  $('#bom-caption').textContent=state.bomDemo==='merge'?'构造示例：第 1、2 行同型号同封装合并；第 3 行封装不同，独立保留。':state.bomDemo==='anomalies'?'构造示例：重复位号、型号封装不匹配、数量缺失。可手动修改或应用示例修复。':'仅展示已配置规则，不代表真实规格书认证。';
  $('#export').disabled=complete<5||result.issues.length>0||modelBusy||Boolean(state.proposal);
  $('#export-status').textContent=modelBusy?'正在理解本次需求，请等待完成后再出单。':state.proposal?'有待确认的参数变更，请确认或选择暂不修改后再出单。':complete<5?`还缺 ${5-complete} 项打样参数，请先在对话中补齐。`:result.issues.length?`打样参数已齐全，尚有 ${result.issues.length} 项 BOM 异常待处理。`:`需求已就绪：${state.params.quantity} 块板，${result.merged.length} 类物料，共 ${result.inputTotal*Number(state.params.quantity)} 个元件。`;
  renderMessages();renderSupport();renderModel();renderRouting();syncShell();updateExampleSelection();positionOpenPanels();save();
}
function respond(text,forced){
  const intent=forced||classify(text);
  recordRoute(intent,'本地规则'+(forced?' · 用户反问确认':''));
  if(intent==='待确认'){
    state.failures=(state.failures||0)+1;
    const escalation=handoffReason(text,state.failures);if(escalation)state.offer=escalation.reason;
    message('assistant','我还不能确定你想执行哪一步。请选择：问参数、报参数、查替料、要出单。也可以换一种说法，例如“4层，10块”。');
    state.pending=text;
    state.pendingEngine='rules';
    render();return;
  }
  state.failures=0;
  if(intent==='报参数'){
    const updates=extract(text),previous={...state.params};
    state.proposal=makeProposal(previous,{updates,clear_fields:[]});
    const changed=Object.entries(updates).map(([key,value])=>previous[key]&&previous[key]!==value?`${fields[key]}从 ${previous[key]} 改为 ${value}`:`${fields[key]}：${value}`);
    const missing=Object.keys(fields).find(key=>!state.params[key]);
    message('assistant',`【报参数】${state.proposal?'建议 '+changed.join('；')+'。请在下方确认后写入需求清单。':changed.length?'这些参数与已确认值一致，无需重复修改。':'未提取到有效参数，请用“4层 / 100x80mm / 10块 / 沉金 / 7天”这样的格式。'}${state.proposal?'':missing?'\n接下来请补充'+fields[missing]+'。':'\n五项参数已齐全，请继续核对 BOM。'}`);
  }else if(intent==='要出单'){
    const result=mergeBom(state.rows),missing=Object.keys(fields).filter(key=>!state.params[key]);
    message('assistant',missing.length?`【要出单】还缺${missing.map(key=>fields[key]).join('、')}。请先补充${fields[missing[0]]}。`:result.issues.length?`【要出单】发现 ${result.issues.length} 项 BOM 异常，请先修复，避免错误物料进入订单。`:'【要出单】参数与 BOM 均已通过校验。请进入“BOM 校验”页，选择字段顺序并导出需求单。');
  }else{
    const entry=entries.find(entry=>entry.keys.test(text));
    if(!entry)state.offer='知识库未找到可靠答案';
    if(intent==='查替料')state.offer='替代料兼容性需要工程师核对';
    message('assistant',`【${intent}】${entry?entry.text+'\n来源：'+entry.source:'当前演示知识库没有足够信息回答这个问题，请补充具体型号或问题。不会据此生成未经验证的工程结论。'}`);
  }
  render();
}
async function send(text){text=text.trim();if(!text||modelBusy)return;const escalation=handoffReason(text);if(state.proposal&&!escalation?.direct){toast('请先确认本次变更，或选择“暂不修改”；输入内容已保留。');return;}delete state.pending;delete state.pendingEngine;retryText=null;message('user',text);if(escalation?.direct){recordRoute('handoff','用户主动要求');state.offer=escalation.reason;message('assistant','已打开人工协助面板，当前对话和需求会一起整理。此处仍是本地交接流程，尚未连接真人客服。');render();openSupport();return;}if($('#model-mode').value==='rules'){respond(text);return;}await requestModel(text);}
$('#chat-input').value=state.composer||'';
$('#chat-input').oninput=()=>{state.composer=$('#chat-input').value;updateExampleSelection();save();};
$('#chat-form').onsubmit=e=>{e.preventDefault();if(modelBusy)return;const text=$('#chat-input').value;if(state.proposal&&!handoffReason(text)?.direct){toast('请先确认本次变更，或选择“暂不修改”；输入内容已保留。');return;}$('#chat-input').value='';state.composer='';send(text);save();};
$('#chat-input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#chat-form').requestSubmit();}};
document.querySelectorAll('[data-prompt]').forEach(button=>button.onclick=()=>send(button.dataset.prompt));
$('#bom-body').onchange=e=>{if(e.target.dataset.key){state.rows[+e.target.dataset.row][e.target.dataset.key]=e.target.value;render();}};
let deletedRow=null;
$('#bom-body').onclick=e=>{if(e.target.dataset.delete!==undefined){const index=+e.target.dataset.delete;deletedRow={index,row:state.rows[index]};state.rows.splice(index,1);render();$('#undo-row').hidden=false;}};
$('#add-row').onclick=()=>{state.rows.push({model:'',package:'',quantity:'1',refs:''});render();};
$('#repair').onclick=()=>{
  let count=0;if(state.bomDemo==='anomalies'){if(!mergeBom(state.rows).issues.length){toast('当前 BOM 已通过规则检查，无需重复修复。');return;}if(JSON.stringify(state.rows)!==JSON.stringify(anomalyExample)){toast('此示例已编辑，请手动修复剩余异常，或重新加载示例。');return;}state.rows=structuredClone(repairedAnomaly);render();toast('已修复示例：R2 改为 R4、封装修正为 0603、数量补为 1');return;}state.rows.forEach(row=>{if(row.model==='LED-GREEN'&&!row.package){row.package='0603';count++;}if(row.model==='RC0603FR-0710KL'&&row.package==='0805'){row.package='0603';count++;}});
  render();toast(count?`已修复 ${count} 处示例封装问题`:'没有可应用的示例修复，请直接编辑实际异常');
};
function download(name,content,type='text/csv;charset=utf-8'){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#sample-download').onclick=()=>download('BOM示例.csv','\uFEFF'+[['型号','封装','数量','位号'],...sampleRows.map(row=>[row.model,row.package,row.quantity,row.refs])].map(row=>row.map(csvCell).join(',')).join('\r\n'));
$('#import').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>1024*1024)throw Error('演示版支持 1MB 以内的 CSV');const rows=parseCsv(await file.text());if(rows.length>1000)throw Error('演示版最多支持 1000 行');state.rows=rows;delete state.bomDemo;deletedRow=null;$("#undo-row").hidden=true;render();toast(`已导入 ${rows.length} 行物料`);}catch(error){toast(error.message);}e.target.value='';};
$('#export').onclick=()=>{try{if(modelBusy||state.proposal)throw Error('请先处理当前需求变更');download(`打样需求单_${$('#template').value}.csv`,makeOrder(state.rows,state.params,$('#template').value));toast('打样需求单已导出');}catch(error){toast(error.message);}};
$('#reset').onclick=()=>{if(confirm('重置为示例数据？当前对话、BOM、输入草稿与本地交接单将被清除。')){cancelModel(false);const mode=$('#model-mode').value;state=fresh();state.mode=mode;retryText=null;deletedRow=null;$('#undo-row').hidden=true;$('#chat-input').value='';$('#model-error').classList.add('hidden');setRequirements(false);render();showView('workspace');}};
function showView(id){
  if(!document.getElementById(id)?.classList.contains('view'))return;
  document.querySelectorAll('.view').forEach(view=>view.classList.toggle('hidden',view.id!==id));
  document.querySelectorAll('.nav').forEach(nav=>{const active=nav.dataset.view===id;nav.classList.toggle('active',active);if(active)nav.setAttribute('aria-current','page');else nav.removeAttribute('aria-current');});
  document.body.dataset.view=id;setNavigation(false,false);syncShell();
  window.scrollTo?.({top:0,behavior:'instant'});
}
document.querySelectorAll('button[data-view]').forEach(button=>button.onclick=()=>showView(button.dataset.view));
$('#knowledge-cards').innerHTML=entries.map(entry=>`<article class="card knowledge-entry"><span class="tag">演示条目</span><h2>${escape(entry.title)}</h2><p>${escape(entry.text)}</p><small>${escape(entry.source)}</small></article>`).join('');
// Always-visible entry and an explicit local handoff flow. No external submission.
$('.sidebar-footer').insertAdjacentHTML('afterbegin','<button id="human-support" class="secondary support-entry" aria-keyshortcuts="Alt+Shift+H" title="快捷键 Alt + Shift + H">人工协助 <span>Alt ⇧ H</span></button>');
$('.chat-card .card-heading .tag').id='assistant-status';
$('#messages').insertAdjacentHTML('afterend','<div id="support-offer" class="support-offer hidden" role="status"><div><strong>需要工程师一起看？</strong><p id="offer-reason"></p></div><div class="actions"><button id="offer-accept" class="primary">转人工</button><button id="offer-dismiss" class="text-button">继续自助</button></div></div>');
document.body.insertAdjacentHTML('beforeend',`<dialog id="support-dialog" aria-labelledby="support-title" aria-describedby="support-dialog-description"><div class="support-heading"><div><div class="eyebrow">HUMAN SUPPORT</div><h2 id="support-title">人工协助</h2><p class="support-subtitle">关闭窗口会保留草稿，可随时继续自助。</p></div><button id="close-support" class="secondary" aria-label="关闭人工协助">关闭</button></div><p id="support-dialog-description" class="support-disclaimer">当前为本地演示：未连接客服后台，不会真实排队或发送消息。</p><div id="support-ticket-status" role="status"></div><form id="support-form"><div class="support-fields"><label for="support-reason">协助原因</label><select id="support-reason"><option>用户主动申请人工协助</option><option>连续两次未能理解需求</option><option>知识库未找到可靠答案</option><option>用户反馈问题尚未解决</option><option>替代料兼容性需要工程师核对</option><option>BOM 异常需要人工核对</option></select><label for="support-note">补充说明 <span>（选填）</span></label><textarea id="support-note" rows="3" maxlength="1000" placeholder="例如：请帮我核对 U2 的替代型号是否兼容。"></textarea></div><div class="support-review"><div id="handoff-preview" class="handoff-preview"></div><p class="snapshot-note">保存时包含当前参数、完整 BOM、异常项及最近最多 100 条对话。保存后如有修改，可更新交接单。</p></div><div class="dialog-actions"><button id="save-handoff" class="primary" type="submit">保存本地交接单</button><button id="download-handoff" class="secondary" type="button">下载交接单 JSON</button><button id="resume-assistant" class="text-button" type="button">继续自助</button></div></form></dialog>`);
function renderSupport(){
  const active=state.ticket?.status==='local-draft';
  $('#support-offer').classList.toggle('hidden',!state.offer||active);
  $('#offer-reason').textContent=(state.offer||'')+'。已填参数和对话会随交接单保留。';
  $('#human-support').innerHTML=actionIcon('headset')+(active?'查看人工协助 <span>交接单已保存</span>':'人工协助 <span>Alt ⇧ H</span>');
  $('#assistant-status').textContent=active?'自助可继续 · 交接单已保存':modelBusy?'DeepSeek 正在思考':$('#model-mode').value==='rules'?'离线规则模式':modelInfo.loading?'对话服务连接中':modelInfo.configured?'DeepSeek · 自然对话':'对话服务暂未连接';
}
function refreshSupportDialog(){
  const result=mergeBom(state.rows),active=state.ticket?.status==='local-draft';
  const dirty=handoffChanged(state.ticket,state,$('#support-reason').value,$('#support-note').value);
  $('#support-ticket-status').textContent=active?`交接单 ${state.ticket.id} · ${dirty?'内容已变更，请更新交接单后下载':'已保存本机，未发送'}`:state.ticket?'上一份交接单已结束 · 可重新整理本次需求':'尚未生成交接单 · 填写内容会自动保存为草稿';
  $('#save-handoff').textContent=active?'更新本地交接单':'保存本地交接单';
  $('#save-handoff').disabled=!dirty;
  $('#download-handoff').disabled=!state.ticket||dirty;
  $('#support-draft-status').textContent=`草稿已保留在当前浏览器 · ${$('#support-note').value.length}/1000`;
  $('#handoff-preview').innerHTML=`<h3>当前交接内容预览</h3><dl>${Object.entries(fields).map(([key,label])=>`<div><dt>${label}</dt><dd>${escape(state.params[key]||'待补充')}</dd></div>`).join('')}</dl><p>${state.rows.length} 行 BOM · ${result.issues.length} 项异常 · ${state.messages.length} 条对话</p>${result.issues.length?'<ul>'+result.issues.map(issue=>`<li>第 ${issue.line} 行：${escape(issue.message)}</li>`).join(''):'<p>未发现规则校验异常。</p>'}`;
}
let supportOpener=null,supportReturnToConversation=false;
function openSupport(reason){
  if($('#support-dialog').open)return;
  setNavigation(false,false);
  cancelModel(true);
  supportOpener=document.activeElement;
  const requested=reason||state.supportDraft?.reason||state.offer||state.ticket?.reason||'用户主动申请人工协助';
  $('#support-reason').value=requested;
  if(!$('#support-reason').value)$('#support-reason').selectedIndex=0;
  $('#support-note').value=state.supportDraft?.note??state.ticket?.note??'';
  refreshSupportDialog();if(!$('#support-dialog').open)$('#support-dialog').showModal();
}
$('#human-support').onclick=()=>openSupport();
$('#offer-accept').onclick=()=>openSupport();
function preserveSupportDraft(){state.supportDraft={reason:$('#support-reason').value,note:$('#support-note').value};save();}
function closeSupport(){preserveSupportDraft();$('#support-dialog').close();}
$('#close-support').onclick=closeSupport;
$('#support-dialog').addEventListener('cancel',e=>{e.preventDefault();closeSupport();});
$('#support-dialog').addEventListener('close',()=>{const resume=supportReturnToConversation;supportReturnToConversation=false;if(resume){showView('workspace');$('#chat-input').focus();}else if(supportOpener?.isConnected)supportOpener.focus();});
let backdropDown=false;
function outsideDialog(e){const rect=$('#support-dialog').getBoundingClientRect();return e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom;}
$('#support-dialog').addEventListener('pointerdown',e=>{backdropDown=e.target===$('#support-dialog')&&outsideDialog(e);});
$('#support-dialog').addEventListener('pointerup',e=>{if(backdropDown&&e.target===$('#support-dialog')&&outsideDialog(e))closeSupport();backdropDown=false;});
$('#support-note').oninput=()=>{preserveSupportDraft();refreshSupportDialog();};
$('#support-reason').onchange=()=>{preserveSupportDraft();refreshSupportDialog();};
$('#offer-dismiss').onclick=()=>{delete state.offer;state.failures=0;render();};
$('#resume-assistant').onclick=()=>{preserveSupportDraft();if(state.ticket)state.ticket.status='closed-locally';delete state.offer;state.failures=0;supportReturnToConversation=true;$('#support-dialog').close();render();showView('workspace');$('#chat-input').focus();toast('已继续自助，草稿与历史交接单仍保留');};
$('#support-form').onsubmit=e=>{e.preventDefault();if(!handoffChanged(state.ticket,state,$('#support-reason').value,$('#support-note').value))return;const id=state.ticket?.status==='local-draft'?state.ticket.id:undefined;const createdAt=state.ticket?.status==='local-draft'?state.ticket.createdAt:null;state.ticket=buildHandoff(state,$('#support-reason').value,$('#support-note').value.trim(),id);if(createdAt)state.ticket.createdAt=createdAt;state.ticket.updatedAt=new Date().toISOString();preserveSupportDraft();delete state.offer;render();refreshSupportDialog();toast('交接单已保存本机，尚未发送给客服');};
$('#download-handoff').onclick=()=>{if(state.ticket&&!handoffChanged(state.ticket,state,$('#support-reason').value,$('#support-note').value))download(`${state.ticket.id}.json`,JSON.stringify(state.ticket,null,2),'application/json;charset=utf-8');};
$('#messages').onclick=e=>{const button=e.target.closest('[data-feedback]');if(!button)return;const entry=state.messages[Number(button.dataset.feedback)];if(entry.feedback)return;entry.feedback=button.dataset.value;if(entry.feedback==='no')state.offer='用户反馈问题尚未解决';render();toast(entry.feedback==='yes'?'感谢反馈':'已记录，你可以补充问题或转人工');};
document.addEventListener('keydown',e=>{if(e.altKey&&e.shiftKey&&e.code==='KeyH'){e.preventDefault();openSupport();}});
$('.bom-footer').insertAdjacentHTML('beforeend','<button id="bom-support" class="text-button">请工程师核对</button>');
$('#bom-support').onclick=()=>openSupport('BOM 异常需要人工核对');
$('.bom-footer').insertAdjacentHTML('beforeend','<button id="undo-row" class="secondary" hidden>撤销删除物料</button>');
$('#undo-row').onclick=()=>{if(deletedRow){state.rows.splice(deletedRow.index,0,deletedRow.row);deletedRow=null;render();$('#undo-row').hidden=true;toast('已恢复刚才删除的物料');}};
$('#support-note').insertAdjacentHTML('afterend','<p id="support-draft-status" class="draft-status" role="status"></p>');
$('#close-support').className='icon-close';
$('#close-support').innerHTML='<span aria-hidden="true">×</span>';
$('#close-support').title='关闭窗口，保留草稿（Esc）';
$('#close-support').setAttribute('aria-label','关闭人工协助，保留草稿');
$('.dialog-actions').insertAdjacentHTML('beforebegin','<p class="close-hint">“继续自助”会结束本次本地协助状态，并返回对话输入框。</p>');
$('.header-tools').insertAdjacentHTML('afterbegin','<details class="assistant-settings"><summary>对话设置</summary><div class="floating-panel settings-panel"><div class="model-toolbar"><label for="model-mode">对话模式</label><select id="model-mode"><option value="deepseek">DeepSeek 自然对话</option><option value="rules">离线规则演示</option></select><button id="refresh-model" class="text-button">检查模型配置</button></div><div id="model-config" class="model-config" role="status"></div></div></details>');
$('#model-mode').value=state.mode||'deepseek';
state.mode=$('#model-mode').value;
$('#chat-input').maxLength=4000;
$('.chat-card .card-heading').insertAdjacentHTML('afterend','<div id="backend-status" class="backend-status hidden" role="status" aria-live="polite"><span id="backend-status-text"></span><div class="actions"><button id="retry-connection" class="text-button" type="button" hidden>重新连接</button><button id="use-offline" class="text-button" type="button">先用离线演示</button></div></div>');
$('#chat-form').insertAdjacentHTML('beforebegin','<div id="model-progress" class="model-progress hidden" role="status"><span id="model-progress-text">正在理解需求…</span><button id="cancel-model" class="text-button" type="button">停止等待</button></div><div id="model-error" class="model-error hidden" role="alert"><span id="model-error-text"></span><div class="actions"><button id="retry-model" class="secondary" type="button">重试上一条</button><button id="error-support" class="text-button" type="button">转人工</button></div></div><div id="parameter-proposal" class="parameter-proposal hidden"></div>');
let connectionPromise=null;
function renderModel(){
  $('#model-progress').classList.toggle('hidden',!modelBusy);
  $('#chat-form button[type="submit"]').disabled=modelBusy;
  $('#model-mode').disabled=modelBusy;
  document.querySelectorAll('[data-prompt]').forEach(button=>button.disabled=modelBusy);
  const offline=$('#model-mode').value==='rules';
  $('#model-config').textContent=offline?'离线演示，不调用模型。需求变更仍经你确认后生效。':modelInfo.loading?'正在连接对话服务…':modelInfo.configured?'对话与必要需求信息会发送给 DeepSeek，参数变更经你确认后生效。':modelInfo.connectionError?'连接尚未完成，可重新连接或先使用离线演示。':modelInfo.hosted?'在线模型暂不可用，可切换离线规则演示继续体验。':'DeepSeek 尚未配置。可先切换离线规则演示，配置方法见项目说明。';
  $('.mode').textContent=offline?'离线规则模式':modelInfo.loading?'对话服务连接中':modelInfo.configured?'DeepSeek 已配置':modelInfo.connectionError?'对话服务未连接':'DeepSeek 待配置';
  $('#backend-status').classList.toggle('hidden',offline||(!modelInfo.loading&&!modelInfo.connectionError));
  $('#backend-status-text').textContent=modelInfo.loading?'正在连接对话服务。免费后端若已休眠，唤醒通常需要约 1 分钟；你可以先查看 BOM，输入内容会保留。':modelInfo.connectionError||'';
  $('#retry-connection').hidden=modelInfo.loading||!modelInfo.connectionError;
  $('#use-offline').disabled=modelBusy||Boolean(state.proposal);
  $('#model-progress-text').textContent=modelInfo.loading?'正在等待对话服务就绪，输入已保留；连接后将发送本次需求。':'正在理解需求…';
  const proposal=state.proposal;
  $('#parameter-proposal').classList.toggle('hidden',!proposal);
  if(!proposal)$('#parameter-proposal').replaceChildren();
  if(proposal){
    $('#parameter-proposal').innerHTML='<strong>请确认本次需求变更</strong><p>确认后才写入右侧清单。</p>'+Object.entries(proposal.updates).map(([key,value])=>`<div>${escape(fields[key])}：<span>${escape(state.params[key]||'未填写')}</span> → <b>${escape(value)}</b></div>`).join('')+proposal.clear.map(key=>`<div>${escape(fields[key])}：${escape(state.params[key])} → <b>清空，重新确认</b></div>`).join('')+'<div class="actions"><button id="confirm-params" class="primary" type="button">确认更新</button><button id="reject-params" class="text-button" type="button">暂不修改</button></div>';
    $('#confirm-params').onclick=()=>{try{const previous={...state.params};state.params=applyProposal(state.params,state.proposal);recordParams(previous,state.params);delete state.proposal;state.updatedAt=new Date().toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai'});const missing=Object.keys(fields).find(k=>!state.params[k]);message('assistant',missing?'已确认更新。接下来请补充'+fields[missing]+'。':'需求已确认更新。请核对 BOM，异常修复后可导出需求单。');state.messages.at(-1).source='系统 · 参数确认';render();}catch(error){delete state.proposal;render();toast(error.message);}};
    $('#reject-params').onclick=()=>{delete state.proposal;message('assistant','本次建议未应用，保留原有需求。你可以继续说明希望怎样修改。');state.messages.at(-1).source='系统 · 参数确认';render();};
  }
}
function cancelModel(notify){if(!modelBusy)return;requestSequence++;modelController?.abort();modelBusy=false;if(notify){$('#model-error-text').textContent='已停止等待，现有参数未改变。';$('#model-error').classList.remove('hidden');}render();}
async function requestModel(text){
  const seq=++requestSequence;modelBusy=true;retryText=text;modelController=new AbortController();$('#model-error').classList.add('hidden');render();
  const activeController=modelController;
  let timer;
  const history=state.messages.slice(-13,-1).map(({role,text})=>({role,text}));
  try{
    if(modelInfo.loading||!modelInfo.configured){
      const ready=await waitForConnection(refreshModel(),activeController.signal);
      if(seq!==requestSequence)return;
      if(!ready)throw Error(modelInfo.connectionError||'在线模型暂不可用，可切换离线规则演示继续体验。');
    }
    timer=setTimeout(()=>activeController.abort(),60000);
    const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,history,params:state.params,rows:state.rows}),signal:modelController.signal});
    const data=await response.json();if(seq!==requestSequence)return;
    if(!response.ok)throw new Error(data.error||'模型服务未响应，请重试');
    delete state.pending;recordRoute(data.intent,'DeepSeek · '+data.model);state.proposal=makeProposal(state.params,data);
    if(data.intent==='clarify'){state.pending=text;state.pendingEngine='deepseek';}
    message('assistant',data.reply);state.messages.at(-1).source='DeepSeek · '+data.model;
    if(data.handoff!=='none')state.offer=data.handoff_reason||'用户反馈问题尚未解决';
    modelBusy=false;retryText=null;render();if(data.handoff==='direct')openSupport();
  }catch(error){if(seq!==requestSequence)return;modelBusy=false;$('#model-error-text').textContent=error.name==='AbortError'?'请求已超时，现有参数未改变。可以重试或转人工。':error.message;$('#model-error').classList.remove('hidden');render();}
  finally{clearTimeout(timer);}
}
function refreshModel(){
  if(connectionPromise)return connectionPromise;
  modelInfo={...modelInfo,configured:false,loading:true,connectionError:null};render();
  connectionPromise=(async()=>{
    try{
      modelInfo={...await connectBackend({fetchImpl:(...args)=>fetch(...args)}),loading:false,connectionError:null};
      if(modelInfo.hosted&&!$('#online-note'))$('.footnote').insertAdjacentHTML('afterend','<p id="online-note" class="online-note">在线面试体验 · 无需安装。请使用构造示例数据；对话草稿保留在当前浏览器。模型体验达到限制后，可选择离线规则演示继续操作。</p>');
      return modelInfo.configured;
    }catch(error){modelInfo={...modelInfo,configured:false,loading:false,connectionError:error.message};return false;}
    finally{connectionPromise=null;render();}
  })();
  return connectionPromise;
}
$('#model-mode').onchange=()=>{if(state.proposal){$('#model-mode').value=state.mode||'deepseek';toast('请先确认或放弃待处理的参数变更，再切换模式。');return;}state.mode=$('#model-mode').value;delete state.pending;delete state.pendingEngine;delete state.route;$('#model-error').classList.add('hidden');render();};
$('#refresh-model').onclick=refreshModel;
$('#retry-connection').onclick=refreshModel;
$('#use-offline').onclick=()=>{$('#model-mode').value='rules';$('#model-mode').dispatchEvent(new Event('change'));};
$('#cancel-model').onclick=()=>cancelModel(true);
$('#retry-model').onclick=()=>{if(retryText&&!modelBusy)requestModel(retryText);};
$('#error-support').onclick=()=>openSupport('用户反馈问题尚未解决');

function loadBomExample(kind){
  if(!confirm('加载示例将替换当前 BOM（对话和参数保留），是否继续？'))return;
  state.rows=structuredClone(kind==='merge'?mergeExample:anomalyExample);state.bomDemo=kind;deletedRow=null;$('#undo-row').hidden=true;render();showView('bom-view');$('.bom-card').scrollIntoView({behavior:'smooth',block:'start'});
}
$('#load-merge').onclick=()=>loadBomExample('merge');
$('#load-anomalies').onclick=()=>loadBomExample('anomalies');
$('#scope-link').onclick=()=>document.querySelector('.nav[data-view="about"]').click();
function locateBom(event){
  const button=event.target.closest('[data-locate]');if(!button)return;
  const row=$('#bom-row-'+button.dataset.locate);if(!row){toast('请先添加物料');return;}
  const field=row.querySelector('[data-key="'+button.dataset.field+'"]');
  const rect=field.getBoundingClientRect(),distant=rect.bottom < -innerHeight||rect.top > innerHeight*2;
  field.scrollIntoView({behavior:distant||matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center',inline:'center'});
  field.focus({preventScroll:true});
}
$('#issues').onclick=locateBom;$('#merged-body').onclick=locateBom;
// Fill examples for deliberate sending; do not spend API calls on guide clicks.
// The shell displays current confirmed state; no extra history or service is implied.
function setRequirements(expanded){
  $('.params-card').dataset.expanded=String(expanded);
  $('.work-grid').classList.toggle('has-requirements',expanded);
  $('#toggle-params').setAttribute('aria-expanded',String(expanded));
  $('#parameter-toggle-text').textContent=expanded?'收起清单':'查看清单';
  syncShell();
}
$('#toggle-params').onclick=()=>{
  const expanded=$('#toggle-params').getAttribute('aria-expanded')!=='true';
  setRequirements(expanded);
  if(matchMedia('(min-width:601px) and (max-width:1199px)').matches)(expanded?$('.params-card'):$('#chat-form')).scrollIntoView({behavior:'auto',block:expanded?'start':'end'});
};
function setNavigation(open,restoreFocus=true){
  document.body.classList.toggle('navigation-open',open);
  $('#menu-toggle').setAttribute('aria-expanded',String(open));
  $('#navigation-backdrop').hidden=!open;
  const compact=matchMedia('(max-width:900px)').matches;
  $('#app-sidebar').inert=compact&&!open;
  $('main').inert=compact&&open;
  if(open)$('#close-navigation').focus();
  else if(restoreFocus&&compact)$('#menu-toggle').focus();
}
$('#menu-toggle').onclick=()=>setNavigation($('#menu-toggle').getAttribute('aria-expanded')!=='true');
$('#close-navigation').onclick=()=>setNavigation(false);
$('#navigation-backdrop').onclick=()=>setNavigation(false);
document.addEventListener('keydown',event=>{
  if(!document.body.classList.contains('navigation-open'))return;
  if(event.key==='Escape'){event.preventDefault();setNavigation(false);}
  if(event.key==='Tab'){
    const items=[...$('#app-sidebar').querySelectorAll('a[href],button:not(:disabled)')].filter(e=>e.getClientRects().length);
    const first=items[0],last=items.at(-1);
    if(event.shiftKey&&(document.activeElement===first||!$('#app-sidebar').contains(document.activeElement))){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||!$('#app-sidebar').contains(document.activeElement))){event.preventDefault();first?.focus();}
  }
});
function syncShell(){
  const complete=Object.keys(fields).filter(key=>state.params[key]).length;
  const next=Object.keys(fields).find(key=>!state.params[key]);
  const collecting=complete>0||Boolean(state.proposal)||state.route?.label==='报参数';
  $('.sidebar-context>span').textContent=collecting?'当前需求':'服务范围';
  document.querySelectorAll('.example-question').forEach(button=>button.hidden=collecting);
  document.querySelectorAll('.example-parameter').forEach(button=>button.hidden=!collecting);
  $('.quick-label').textContent=collecting?'继续说明':'你可以这样问';
  $('#compact-progress').hidden=!collecting;
  $('#sidebar-demand-state').textContent=collecting?`${complete} / 5 项已确认`:'PCB 打样 · 工艺咨询';
  $('#sidebar-demand-next').textContent=collecting?(next?`下一项补充：${fields[next]}`:'参数已齐全，可以核对 BOM'):'物料问题 · 需求协助';
  $('#toggle-params').setAttribute('aria-label',`${$('#toggle-params').getAttribute('aria-expanded')==='true'?'收起':'查看'}已确认需求清单，已确认 ${complete} / 5 项`);
  $('#toggle-params').hidden=document.body.dataset.view!=='workspace';
  $('#current-view-name').textContent=({workspace:'智能客服','bom-view':'BOM 校验',about:'项目说明',knowledge:'辅助问答'})[document.body.dataset.view]||'需求对话';
  $('.mode').dataset.status=$('#model-mode').value==='rules'?'offline':modelInfo.loading?'connecting':modelInfo.configured?'ready':'unavailable';
  const compact=matchMedia('(max-width:900px)').matches,entry=$('#human-support');
  if(compact&&document.body.dataset.view==='workspace')$('#current-view-name').textContent='料知 · 智能客服';
  const destination=compact?$('header'):$('.sidebar-footer');
  if(entry.parentElement!==destination)destination.append(entry);
  if(!compact&&document.body.classList.contains('navigation-open'))setNavigation(false,false);
  $('#app-sidebar').inert=compact&&!document.body.classList.contains('navigation-open');
  $('main').inert=compact&&document.body.classList.contains('navigation-open');
  mobileLayout?.sync();
}
window.addEventListener('resize',syncShell);
function updateExampleSelection(){for(const button of document.querySelectorAll('[data-example-prompt]'))button.setAttribute('aria-pressed',String($('#chat-input').value===button.dataset.examplePrompt));}
for(const button of document.querySelectorAll('[data-example-prompt]'))button.onclick=()=>{$('#chat-input').value=button.dataset.examplePrompt;state.composer=button.dataset.examplePrompt;updateExampleSelection();save();$('#chat-input').scrollIntoView({behavior:'auto',block:'nearest'});$('#chat-input').focus({preventScroll:true});};
// Keep disclosure panels anchored to their controls and inside the visible area.
$('.more-examples>div').classList.add('floating-panel','example-panel');
const floatingDetails='.assistant-settings,.route-details,.more-examples';
function positionOpenPanels(event){
  if(event?.type==='scroll'&&event.target?.closest?.('.floating-panel'))return;
  for(const details of document.querySelectorAll(floatingDetails)){
    if(!details.open)continue;
    const panel=details.querySelector('.floating-panel'),summary=details.querySelector('summary');if(!panel||!summary)continue;
    const inHeader=Boolean(details.closest('.app-header'));
    const anchor=summary.getBoundingClientRect(),visual=window.visualViewport;
    const leftBound=(visual?.offsetLeft||0)+12,rightBound=Math.min(innerWidth,(visual?.offsetLeft||0)+(visual?.width||innerWidth))-12;
    const topBound=Math.max(document.querySelector('header').getBoundingClientRect().bottom,visual?.offsetTop||0)+8;
    const bottomBound=Math.min(innerHeight,(visual?.offsetTop||0)+(visual?.height||innerHeight))-8;
    if(!inHeader&&(anchor.bottom<topBound||anchor.top>bottomBound)){details.open=false;continue;}
    panel.style.maxWidth=Math.max(0,rightBound-leftBound)+'px';
    const anchorBottom=inHeader?Math.max(anchor.bottom,document.querySelector('header').getBoundingClientRect().bottom):anchor.bottom;
    const below=bottomBound-anchorBottom-8,above=anchor.top-topBound-8,natural=panel.scrollHeight;
    const useBelow=below>=natural||below>=above;
    panel.style.maxHeight=Math.max(0,useBelow?below:above)+'px';
    const box=panel.getBoundingClientRect(),top=useBelow?anchorBottom+8:anchor.top-box.height-8;
    panel.style.left=Math.max(leftBound,Math.min(anchor.right-box.width,rightBound-box.width))+'px';
    panel.style.top=Math.max(topBound,Math.min(top,bottomBound-box.height))+'px';
  }
}
document.addEventListener('toggle',event=>{
  const details=event.target;if(!details.matches?.(floatingDetails)||!details.open)return;
  for(const other of document.querySelectorAll(floatingDetails))if(other!==details)other.open=false;
  positionOpenPanels();
},true);
document.addEventListener('pointerdown',event=>{for(const details of document.querySelectorAll(floatingDetails))if(details.open&&!details.contains(event.target))details.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape')for(const details of document.querySelectorAll(floatingDetails))details.open=false;});
window.addEventListener('resize',positionOpenPanels);
window.addEventListener('scroll',positionOpenPanels,true);
window.visualViewport?.addEventListener('resize',positionOpenPanels);
// Mobile composition reuses the desktop state, confirmation flow and controls.
function mountMobileLayout(){
  const mobile=matchMedia('(max-width:600px)'),panel=$('.params-card'),grid=$('.work-grid');
  const toggle=$('#toggle-params'),settings=$('.assistant-settings'),headerTools=$('.header-tools');
  const tools=document.createElement('div');tools.className='mobile-chat-tools';
  tools.innerHTML='<span class="mobile-confirm-note">确认后更新</span>';
  $('#chat-form').before(tools);
  const dialog=document.createElement('dialog');dialog.id='mobile-params-dialog';
  dialog.setAttribute('aria-labelledby','mobile-params-title');
  const close=document.createElement('button');close.type='button';close.className='mobile-sheet-close';close.setAttribute('aria-label','关闭需求清单');
  close.innerHTML='<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
  close.onclick=()=>setRequirements(false);
  panel.querySelector('.card-heading').append(close);panel.querySelector('h2').id='mobile-params-title';grid.append(dialog);
  dialog.addEventListener('cancel',event=>{event.preventDefault();setRequirements(false);});
  dialog.addEventListener('click',event=>{if(event.target===dialog)setRequirements(false);});
  dialog.addEventListener('close',()=>{if(mobile.matches&&panel.dataset.expanded==='true')setRequirements(false);});
  panel.querySelector('[data-view="bom-view"]').addEventListener('click',()=>setRequirements(false));
  const privacy=$('.composer-privacy'),desktopPrivacy=privacy.textContent,input=$('#chat-input'),desktopPlaceholder=input.placeholder;
  const caption=$('.service-caption'),desktopCaption=caption.textContent;
  let wasMobile=false;
  function sizeInput(){
    if(mobile.matches){input.style.height='0px';input.style.height=Math.min(108,Math.max(36,input.scrollHeight))+'px';}
    else input.style.removeProperty('height');
  }
  input.addEventListener('input',sizeInput);$('#chat-form').addEventListener('submit',()=>queueMicrotask(sizeInput));
  function sync(){
    const isMobile=mobile.matches;
    if(isMobile){
      if(toggle.parentElement!==tools)tools.prepend(toggle);
      if(settings.parentElement!==$('.sidebar-footer'))$('.sidebar-footer').prepend(settings);
      if(document.body.dataset.view==='workspace')$('#current-view-name').textContent='料知';
      caption.textContent='工业物料智能客服';
      privacy.textContent='仅将必要需求信息发送给 DeepSeek';input.placeholder='说说你的物料问题或打样需求…';
      const expanded=panel.dataset.expanded==='true'&&document.body.dataset.view==='workspace';
      if(panel.parentElement!==dialog)dialog.append(panel);
      if(expanded&&!dialog.open){document.querySelectorAll('.floating-panel').forEach(p=>{if(p.parentElement.tagName==='DETAILS')p.parentElement.open=false;});dialog.showModal();close.focus({preventScroll:true});}
      else if(!expanded&&dialog.open){dialog.close();toggle.focus({preventScroll:true});}
    }else{
      if(dialog.open)dialog.close();
      if(panel.parentElement!==grid)grid.append(panel);
      if(toggle.parentElement!==headerTools)headerTools.append(toggle);
      if(settings.parentElement!==headerTools)headerTools.prepend(settings);
      privacy.textContent=desktopPrivacy;input.placeholder=desktopPlaceholder;caption.textContent=desktopCaption;
    }
    if(isMobile!==wasMobile){wasMobile=isMobile;sizeInput();}
  }
  return {sync};
}
mobileLayout=mountMobileLayout();
render();
refreshModel();
