// Only readiness requests retry. A model message is never resent automatically.
function pause(ms,signal){
  return new Promise((resolve,reject)=>{
    const stop=()=>{clearTimeout(timer);reject(signal.reason||new DOMException('Stopped','AbortError'));};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},ms);
    if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true});
  });
}
export function waitForConnection(promise,signal){
  if(!signal)return promise;
  return new Promise((resolve,reject)=>{
    const stop=()=>reject(signal.reason||new DOMException('Stopped','AbortError'));
    if(signal.aborted){stop();return;}
    signal.addEventListener('abort',stop,{once:true});
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));
  });
}
export async function connectBackend({fetchImpl=fetch,signal,onWait=()=>{},attempts=7,timeoutMs=15000,delayMs=2500,sleep=pause}={}){
  for(let attempt=1;attempt<=attempts;attempt++){
    if(signal?.aborted)throw signal.reason||new DOMException('Stopped','AbortError');
    onWait(attempt);
    const controller=new AbortController(),stop=()=>controller.abort(signal.reason);
    signal?.addEventListener('abort',stop,{once:true});
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetchImpl('/api/config',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
      // A sleeping host can return its HTML loading page with status 200.
      if(!response.ok)throw Error('Backend is not ready');
      const config=await response.json();
      if(!config||typeof config.configured!=='boolean')throw Error('Invalid readiness response');
      return config;
    }catch(error){if(signal?.aborted)throw signal.reason||error;}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);}
    if(attempt<attempts)await sleep(delayMs,signal);
  }
  throw Error('对话服务暂未连接成功。输入内容已保留，可以重试连接，或先使用离线规则演示。');
}
