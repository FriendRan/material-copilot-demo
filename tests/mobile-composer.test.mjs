import test from 'node:test';
import assert from 'node:assert/strict';
import {mount,flush,waitFor} from './ui-harness.mjs';

test('手机输入：焦点展开，模拟视口缩小及偏移，键盘关闭后恢复且草稿保留',async()=>{
 const page=await mount({viewport:{width:390,height:844}});
 try{
  const {$,win}=page,input=$('#chat-input'),workspace=$('#workspace'),vv=win.visualViewport;
  assert.equal(input.closest('.mobile-composer-dock')!==null,true);
  assert.equal(workspace.classList.contains('is-editing'),false);
  input.value='四层板，10块';input.dispatchEvent(new win.Event('input',{bubbles:true}));input.focus();
  assert.equal(workspace.classList.contains('is-editing'),true);assert.equal(workspace.classList.contains('is-composing'),true);
  assert.equal($('#messages').inert,true);
  vv.height=510;vv.dispatchEvent(new win.Event('resize'));
  await waitFor(()=>win.document.documentElement.style.getPropertyValue('--mobile-viewport-height')==='510px');
  assert.equal(win.document.activeElement,input);assert.equal(input.value,'四层板，10块');
  vv.offsetTop=12;vv.dispatchEvent(new win.Event('scroll'));
  await waitFor(()=>win.document.documentElement.style.getPropertyValue('--mobile-viewport-height')==='522px');
  vv.height=844;vv.offsetTop=0;vv.dispatchEvent(new win.Event('resize'));
  await waitFor(()=>!workspace.classList.contains('is-editing'));
  assert.equal(input.value,'四层板，10块');assert.equal($('#messages').inert,false);
 }finally{await page.close();}
});

test('手机输入：缩放不误判键盘关闭，发送后消息与参数确认仍可操作',async()=>{
 const page=await mount({viewport:{width:390,height:844}});
 try{
  const {$,win}=page,input=$('#chat-input'),vv=win.visualViewport;
  input.focus();vv.height=500;vv.dispatchEvent(new win.Event('resize'));
  await waitFor(()=>win.document.documentElement.style.getPropertyValue('--mobile-viewport-height')==='500px');
  vv.scale=1.5;vv.height=844;vv.dispatchEvent(new win.Event('resize'));await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(win.document.activeElement,input);assert.equal(win.document.documentElement.style.getPropertyValue('--mobile-viewport-height'),'500px');
  vv.scale=1;vv.height=500;page.submit('4层，100x80mm，10块，沉金，7天');await flush();
  assert.equal($('#workspace').classList.contains('is-composing'),false);assert.equal($('#messages').inert,false);
  $('#confirm-params').click();assert.equal(page.state().params.quantity,'10');
  input.value='下一条草稿';input.dispatchEvent(new win.Event('input',{bubbles:true}));
  win.happyDOM.setWindowSize({width:1440,height:900});win.dispatchEvent(new win.Event('resize'));await flush();
  assert.equal(input.closest('.mobile-composer-dock'),null);assert.equal($('#chat-form').parentElement.classList.contains('chat-card'),true);
  assert.equal($('#workspace').classList.contains('is-editing'),false);assert.equal(input.value,'下一条草稿');
  assert.equal(win.document.documentElement.style.getPropertyValue('--mobile-viewport-height'),'');
 }finally{await page.close();}
});

test('键盘连续 resize：不重写导航，同帧合并视口变化，重复尺寸不重写样式',async()=>{
 const page=await mount({viewport:{width:390,height:844}});
 try{
  const {$,win}=page,vv=win.visualViewport,root=win.document.documentElement;
  $('#chat-input').focus();await flush();
  let titleWrites=0,heightWrites=0;
  const titleObserver=new win.MutationObserver(events=>{titleWrites+=events.length;});
  const heightObserver=new win.MutationObserver(events=>{heightWrites+=events.length;});
  titleObserver.observe($('#current-view-name'),{childList:true,characterData:true,subtree:true});
  heightObserver.observe(root,{attributes:true,attributeFilter:['style']});
  for(let i=0;i<24;i++){vv.height=730-i*10;win.dispatchEvent(new win.Event('resize'));vv.dispatchEvent(new win.Event('resize'));}
  await waitFor(()=>root.style.getPropertyValue('--mobile-viewport-height')==='500px');await flush();
  assert.equal(titleWrites,0);assert.equal(heightWrites,1);
  for(let i=0;i<12;i++)vv.dispatchEvent(new win.Event('resize'));
  await new Promise(resolve=>setTimeout(resolve,30));await flush();assert.equal(heightWrites,1);
  titleObserver.disconnect();heightObserver.disconnect();
 }finally{await page.close();}
});

test('键盘收起：失焦先保持展开布局，视口恢复后再回位且不丢草稿',async()=>{
 const page=await mount({viewport:{width:390,height:844}});
 try{
  const {$,win}=page,input=$('#chat-input'),workspace=$('#workspace'),vv=win.visualViewport;
  input.value='保留这条草稿';input.dispatchEvent(new win.Event('input',{bubbles:true}));input.focus();
  vv.height=500;vv.dispatchEvent(new win.Event('resize'));await waitFor(()=>win.document.documentElement.style.getPropertyValue('--mobile-viewport-height')==='500px');
  input.blur();await flush();assert.equal(workspace.classList.contains('is-closing'),true);
  assert.equal(workspace.classList.contains('is-editing'),true);assert.equal($('#messages').inert,true);
  vv.height=650;vv.dispatchEvent(new win.Event('resize'));await waitFor(()=>win.document.documentElement.style.getPropertyValue('--mobile-viewport-height')==='650px');
  assert.equal(workspace.classList.contains('is-editing'),true);
  vv.height=844;vv.dispatchEvent(new win.Event('resize'));await waitFor(()=>!workspace.classList.contains('is-closing'));
  assert.equal(workspace.classList.contains('is-editing'),false);assert.equal($('#messages').inert,false);
  assert.equal(input.value,'保留这条草稿');assert.equal(page.state().composer,'保留这条草稿');
 }finally{await page.close();}
});

test('键盘收起中重新输入：取消旧收尾，焦点与草稿不会被迟到的回调清除',async()=>{
 const page=await mount({viewport:{width:390,height:844}});
 try{
  const {$,win}=page,input=$('#chat-input'),workspace=$('#workspace'),vv=win.visualViewport;
  input.value='继续输入';input.dispatchEvent(new win.Event('input',{bubbles:true}));input.focus();
  vv.height=500;vv.dispatchEvent(new win.Event('resize'));await waitFor(()=>win.document.documentElement.style.getPropertyValue('--mobile-viewport-height')==='500px');
  input.blur();await flush();assert.equal(workspace.classList.contains('is-closing'),true);
  input.focus();assert.equal(workspace.classList.contains('is-closing'),false);
  await new Promise(resolve=>setTimeout(resolve,350));
  assert.equal(win.document.activeElement,input);assert.equal(workspace.classList.contains('is-editing'),true);assert.equal(input.value,'继续输入');
 }finally{await page.close();}
});
