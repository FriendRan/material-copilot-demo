import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import * as core from '../public/core.js';
import * as handoff from '../public/handoff.js';
import * as proposals from '../public/proposals.js';
import * as showcase from '../public/showcase.js';
import * as connection from '../public/connection.js';

export const baseParams={layers:'4层',size:'100 × 80 mm',quantity:'10',process:'沉金',delivery:'7天'};
export async function flush(){for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));}
export async function waitFor(check,timeout=4000){const start=Date.now();while(!check()){if(Date.now()-start>timeout)throw Error('Timed out waiting for page state');await new Promise(resolve=>setTimeout(resolve,10));}}
export async function mount({seed={},reply,live=false,configFetch,confirmations='auto',viewport}={}){
  const win=new Window({url:'http://127.0.0.1:4173/'});
  if(viewport){
    win.happyDOM.setWindowSize({width:viewport.width,height:viewport.height});
    const visual=new win.EventTarget();Object.assign(visual,{width:viewport.width,height:viewport.height,offsetTop:0,scale:1});
    Object.defineProperty(win,'visualViewport',{value:visual,configurable:true});
  }
  const state={params:{},rows:structuredClone(core.sampleRows),messages:[{role:'assistant',text:'这次打样需要几层板？'}],mode:'rules',...seed};
  win.localStorage.setItem('material-demo-v1',JSON.stringify(state));
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  win.document.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,''));
  // document.write does not reliably transfer body attributes in Happy DOM.
  win.document.body.className=html.match(/<body[^>]*class="([^"]*)"/)?.[1]||'';
  const bodyView=html.match(/<body[^>]*data-view="([^"]*)"/)?.[1];if(bodyView)win.document.body.dataset.view=bodyView;
  win.confirm=()=>true;win.structuredClone=structuredClone;
  const nativeShowModal=win.HTMLDialogElement.prototype.showModal;
  win.HTMLDialogElement.prototype.showModal=function(){nativeShowModal.call(this);if(this.id==='confirmation-dialog'&&confirmations==='auto')this.querySelector(win.confirm(this.querySelector('#confirmation-description').textContent)?'#accept-confirmation':'#cancel-confirmation').click();};
  win.AbortController=AbortController;
  win.HTMLElement.prototype.scrollIntoView=function(){this.__scrolled=true;};
  const requests=[],downloads=[];const blobs=new Map();
  win.URL.createObjectURL=blob=>{const url='blob:local-test-'+blobs.size;blobs.set(url,blob);return url;};
  win.URL.revokeObjectURL=url=>blobs.delete(url);
  const nativeAnchorClick=win.HTMLAnchorElement.prototype.click;
  win.HTMLAnchorElement.prototype.click=function(){if(this.hasAttribute('download'))downloads.push({name:this.download,blob:blobs.get(this.href)});else nativeAnchorClick.call(this);};
  win.fetch=async(url,options)=>{
    if(url==='/api/config')return configFetch?configFetch(options):new Response(JSON.stringify({configured:true,model:'test-model'}));
    if(url!=='/api/chat')throw Error('Unexpected fetch '+url);
    const input=JSON.parse(options.body);requests.push(input);
    if(live)return fetch('http://127.0.0.1:4173/api/chat',options);
    if(!reply)throw Error('No model fixture');return new Response(JSON.stringify(await reply(input)),{status:200});
  };
  win.__modules={'./core.js':core,'./handoff.js':handoff,'./proposals.js':proposals,'./showcase.js':showcase,'./connection.js':connection};
  let source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  source=source.replace(/^import\s*\{([^}]+)\}\s*from\s*'([^']+)';/gm,(_match,names,file)=>`const {${names}}=window.__modules['${file}'];`);
  win.eval(source);await flush();
  const $=selector=>win.document.querySelector(selector);
  function submit(text){$('#chat-input').value=text;$('#chat-input').dispatchEvent(new win.Event('input',{bubbles:true}));$('#chat-form').dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));}
  function edit(row,key,value){const input=$(`[data-row="${row-1}"][data-key="${key}"]`);input.value=value;input.dispatchEvent(new win.Event('change',{bubbles:true}));}
  return {win,$,requests,downloads,submit,edit,state:()=>JSON.parse(win.localStorage.getItem('material-demo-v1')),close:async()=>{await win.happyDOM.abort();win.close();}};
}
