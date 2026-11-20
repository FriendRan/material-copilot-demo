import {modelConfig,validateInput,chatWithModel,ServiceError} from '../llm.mjs';

const ONLINE_HEADERS={
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com; base-uri 'none'; form-action 'self'"
};
const encoder=new TextEncoder();
const base64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
async function signature(secret,text){
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return base64(await crypto.subtle.sign('HMAC',key,encoder.encode(text)));
}
async function validSession(request,secret,now){
  const token=request.headers.get('cookie')?.match(/(?:^|;\s*)demo_session=([^;]+)/)?.[1];
  if(!token||!secret)return null;
  const parts=token.split('.');
  if(parts.length!==3||!/^[a-f0-9]{32}$/.test(parts[0])||!/^\d{13}$/.test(parts[1])||Number(parts[1])<=now)return null;
  return await signature(secret,parts.slice(0,2).join('.'))===parts[2]?{token,id:parts[0],expires:Number(parts[1])}:null;
}
async function newSession(secret,now){
  const id=[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const expires=now+30*60*1000,body=id+'.'+expires;
  return {id,expires,token:body+'.'+await signature(secret,body)};
}
async function requestJson(request){
  const reader=request.body?.getReader();if(!reader)throw new ServiceError('BAD_REQUEST','请求为空',400);
  let size=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256*1024){await reader.cancel();throw new ServiceError('TOO_LARGE','演示请求过大，请减少 BOM 行数',413);}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ServiceError('BAD_JSON','请求格式不正确',400);}
}
export function createOnlineHandler({assets,chat=chatWithModel,now=Date.now}={}){
  const sessions=new Map(),addresses=new Map();let active=0,windowStart=0,windowCalls=0;
  const response=(status,data,extra={})=>new Response(JSON.stringify(data),{status,headers:{...ONLINE_HEADERS,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra}});
  return {
    async fetch(request,env){
      const url=new URL(request.url),time=now();
      try{
        if(!url.pathname.startsWith('/api/')){
          if(!['GET','HEAD'].includes(request.method))return response(405,{error:'不支持此方法'});
          const path=url.pathname==='/'?'/index.html':url.pathname;
          const asset=assets[path];if(!asset)return response(404,{error:'页面不存在'});
          return new Response(request.method==='HEAD'?null:asset.content,{headers:{...ONLINE_HEADERS,'Content-Type':asset.type,'Cache-Control':'no-cache'}});
        }
        const origin=request.headers.get('origin');
        if(origin&&origin!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')return response(403,{error:'请从演示页面发起请求',code:'ORIGIN_DENIED'});
        const config=modelConfig(env),ready=config.configured&&Boolean(env.DEMO_SESSION_SECRET);
        if(url.pathname==='/api/config'&&request.method==='GET'){
          const headers={};
          if(ready){const session=await validSession(request,env.DEMO_SESSION_SECRET,time)||await newSession(env.DEMO_SESSION_SECRET,time);headers['Set-Cookie']=`demo_session=${session.token}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=1800`;}
          return response(200,{configured:ready,provider:'DeepSeek',model:config.model,hosted:true,sessionLimit:20,sessionMinutes:30},headers);
        }
        if(url.pathname!=='/api/chat'||request.method!=='POST')return response(404,{error:'接口不存在'});
        if(!ready)return response(503,{error:'在线模型暂不可用，可切换离线规则演示继续体验。',code:'NOT_CONFIGURED'});
        const session=await validSession(request,env.DEMO_SESSION_SECRET,time);
        if(!session)return response(401,{error:'演示会话已过期，请点“检查连接配置”后重试。',code:'SESSION_EXPIRED'});
        if(!request.headers.get('content-type')?.startsWith('application/json'))return response(415,{error:'需要 JSON 请求'});
        const input=validateInput(await requestJson(request));
        for(const [id,bucket] of sessions)if(bucket.expires<=time)sessions.delete(id);
        for(const [id,bucket] of addresses)if(bucket.expires<=time)addresses.delete(id);
        const address=env.VERCEL?(request.headers.get('x-vercel-forwarded-for')||request.headers.get('x-forwarded-for')?.split(',')[0].trim()||'unknown'):(request.headers.get('cf-connecting-ip')||'unknown');
        const bucket=sessions.get(session.id)||{calls:0,expires:session.expires};
        const ipBucket=addresses.get(address)||{calls:0,expires:time+30*60*1000};
        if(time-windowStart>=60*60*1000){windowStart=time;windowCalls=0;}
        // Lightweight isolate-local demo limits, not a global billing guarantee.
        if(bucket.calls>=20||ipBucket.calls>=40||windowCalls>=200)return response(429,{error:'本轮模型体验次数已用完，可切换离线规则演示继续操作。',code:'DEMO_LIMIT'},{'Retry-After':'1800'});
        if(active>=2||sessions.size>=2000||addresses.size>=2000)return response(429,{error:'演示服务忙，请稍后重试或切换离线模式。',code:'BUSY'},{'Retry-After':'10'});
        sessions.set(session.id,bucket);addresses.set(address,ipBucket);bucket.calls++;ipBucket.calls++;windowCalls++;active++;
        try{return response(200,await chat(input,{config,signal:request.signal}));}finally{active--;}
      }catch(error){return error instanceof ServiceError?response(error.status,{error:error.message,code:error.code}):response(500,{error:'演示服务暂时不可用，请稍后重试。',code:'INTERNAL_ERROR'});}
    }
  };
}
export default createOnlineHandler({assets:typeof STATIC_ASSETS==='undefined'?{}:STATIC_ASSETS});
