export const fields = {layers:'板层',size:'尺寸',quantity:'数量',process:'工艺',delivery:'交期'};
export const sampleRows = [
  {model:'RC0603FR-0710KL',package:'0603',quantity:'2',refs:'R1,R2'},
  {model:'RC0603FR-0710KL',package:'0603',quantity:'1',refs:'R3'},
  {model:'GRM188R71C104KA01',package:'0603',quantity:'2',refs:'C1,C2'},
  {model:'STM32F103C8T6',package:'LQFP-48',quantity:'1',refs:'U1'},
  {model:'AMS1117-3.3',package:'SOT-223',quantity:'1',refs:'U2'},
  {model:'LED-GREEN',package:'',quantity:'1',refs:'D1'},
  {model:'RC0603FR-0710KL',package:'0805',quantity:'1',refs:'R4'}
];
export function extract(text) {
  const out = {};
  const layer = text.match(/([1-9]\d*)\s*层/); if(layer) out.layers = layer[1]+'层';
  const size = text.match(/(\d+(?:\.\d+)?)\s*[*xX×]\s*(\d+(?:\.\d+)?)(?:\s*mm)?/); if(size && +size[1]>0 && +size[2]>0) out.size = `${size[1]} × ${size[2]} mm`;
  const qty = text.match(/([1-9]\d*)\s*(?:块|片|套)/); if(qty) out.quantity = qty[1];
  const process = text.match(/沉金|无铅喷锡|有铅喷锡|喷锡|OSP/i); if(process) out.process = process[0];
  const delivery = text.match(/([1-9]\d*)\s*(?:个工作日|工作日|天)/); if(delivery) out.delivery = delivery[0];
  return out;
}
export function classify(text) {
  const hits = [];
  if(/替代|替料|替换/.test(text)) hits.push('查替料');
  if(/出单|导出|下单|需求单/.test(text)) hits.push('要出单');
  const question=/怎么|什么|多少|区别|是否|支持|吗|？|\?/.test(text);
  if(Object.keys(extract(text)).length && !question) hits.push('报参数');
  if((question||/要求|封装|工艺/.test(text)) && !hits.includes('报参数') && !hits.includes('查替料') && !hits.includes('要出单')) hits.push('问参数');
  return hits.length === 1 ? hits[0] : '待确认';
}
export function mergeBom(rows) {
  const groups = new Map(), issues = [], owners = new Map();
  rows.forEach((row,index) => {
    const line = index+1, model=String(row.model||'').trim().toUpperCase(), pkg=String(row.package||'').trim().toUpperCase();
    const refs=String(row.refs||'').split(/[,，;；\s]+/).filter(Boolean).map(x=>x.toUpperCase());
    const quantity=Number(row.quantity);
    if(!model || !pkg) issues.push({line,field:!model?'model':'package',message:'型号或封装缺失'});
    if(!Number.isSafeInteger(quantity) || quantity<=0) issues.push({line,field:'quantity',message:'数量必须为正整数'});
    if(!refs.length) issues.push({line,field:'refs',message:'位号缺失'});
    if(refs.length !== quantity) issues.push({line,field:'quantity',message:'数量与位号数量不一致'});
    for(const ref of refs) {
      if(owners.has(ref)) issues.push({line,field:'refs',relatedLines:[owners.get(ref)],message:`位号 ${ref} 重复（第 ${owners.get(ref)} 行）`});
      else owners.set(ref,line);
    }
    if(/^RC0603/.test(model) && pkg && pkg!=='0603') issues.push({line,field:'package',message:'演示规则：RC0603 型号应匹配 0603 封装'});
    const key=JSON.stringify([model,pkg]);
    if(!groups.has(key)) groups.set(key,{model,package:pkg,quantity:0,refs:[],lines:[]});
    const group=groups.get(key); group.quantity+=Number.isSafeInteger(quantity)&&quantity>0?quantity:0; group.refs.push(...refs);group.lines.push(line);
  });
  if(!rows.length) issues.push({line:0,message:'BOM 为空，请导入或添加物料'});
  const merged=[...groups.values()];
  const inputTotal=rows.reduce((sum,row)=>sum+(Number.isSafeInteger(Number(row.quantity))&&Number(row.quantity)>0?Number(row.quantity):0),0);
  const outputTotal=merged.reduce((sum,row)=>sum+row.quantity,0);
  const beforeRefs=rows.flatMap(row=>String(row.refs||'').split(/[,，;；\s]+/).filter(Boolean).map(ref=>ref.toUpperCase())).sort();
  const afterRefs=merged.flatMap(row=>row.refs).sort();
  return {merged,issues,inputTotal,outputTotal,uniqueRefs:owners.size,
    beforeRefCount:beforeRefs.length,afterRefCount:afterRefs.length,
    quantityConserved:inputTotal===outputTotal,refsConserved:JSON.stringify(beforeRefs)===JSON.stringify(afterRefs)};
}
export function parseCsv(text) {
  const records=[];let row=[],cell='',quoted=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(ch==='"') { if(quoted && text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted; }
    else if(ch===','&&!quoted){row.push(cell);cell='';}
    else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++; row.push(cell);if(row.some(x=>x.trim()))records.push(row);row=[];cell='';}
    else cell+=ch;
  }
  if(quoted)throw new Error('CSV 引号未闭合');
  row.push(cell);if(row.some(x=>x.trim()))records.push(row);
  const head=records.shift();
  const aliases=[['型号','model'],['封装','package'],['数量','quantity'],['位号','refs']];
  const indexes=aliases.map(names=>head?.findIndex(x=>names.includes(x.trim()))??-1);
  if(indexes.some(x=>x<0))throw new Error('表头需要包含：型号、封装、数量、位号');
  return records.map(r=>Object.fromEntries(['model','package','quantity','refs'].map((key,i)=>[key,r[indexes[i]]||''])));
}
export function csvCell(value) { const text=String(value??'');return '"'+(/^[=+@\-\t\r]/.test(text)?"'":'')+text.replaceAll('"','""')+'"'; }
export function makeOrder(rows,params,template) {
  const result=mergeBom(rows);
  if(result.issues.length || Object.keys(fields).some(key=>!params[key])) throw new Error('请先补齐打样参数并修复所有 BOM 异常');
  const keys=template==='嘉立创'?['refs','quantity','model','package']:['model','package','refs','quantity'];
  const labels={model:'型号',package:'封装',refs:'位号',quantity:'单板数量'};
  const lines=[['打样需求单（演示模板）',template],...Object.entries(fields).map(([key,label])=>[label,params[key]]),[],[...keys.map(key=>labels[key]),'总需求数量']];
  result.merged.forEach(row=>lines.push([...keys.map(key=>key==='refs'?row.refs.join(','):row[key]),row.quantity*Number(params.quantity)]));
  return '\uFEFF'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
