import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {modelConfig,validateInput,chatWithModel,ServiceError} from './llm.mjs';
const root=path.resolve(fileURLToPath(new URL('./public/',import.meta.url)));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.csv':'text/csv; charset=utf-8'};
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
async function bodyJson(req){let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>512*1024)throw new ServiceError('TOO_LARGE','请求过大，请缩减 BOM 或对话',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ServiceError('BAD_JSON','请求格式不正确',400);}}
export function createApp({getConfig=modelConfig,chat=chatWithModel}={}){
  let active=0;
  return http.createServer(async(req,res)=>{
    try{
      const host=req.headers.host||'';
      if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))return json(res,403,{error:'只允许本机访问'});
      const pathname=decodeURIComponent(new URL(req.url,'http://'+host).pathname);
      if(pathname.startsWith('/api/')){
        if(req.headers.origin&&req.headers.origin!=='http://'+host)return json(res,403,{error:'不接受跨站请求'});
        if(pathname==='/api/config'&&req.method==='GET'){const config=getConfig();return json(res,200,{configured:config.configured,provider:'DeepSeek',model:config.model});}
        if(pathname!=='/api/chat'||req.method!=='POST')return json(res,404,{error:'接口不存在'});
        if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'需要 application/json'});
        const input=validateInput(await bodyJson(req));
        if(active>=2)return json(res,429,{error:'已有请求正在处理，请稍后重试',code:'BUSY'});
        active++;const controller=new AbortController();const closed=()=>{if(!res.writableEnded)controller.abort();};res.on('close',closed);
        try{const result=await chat(input,{config:getConfig(),signal:controller.signal});if(!res.destroyed)json(res,200,result);}finally{active--;res.off('close',closed);}return;
      }
      if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'不支持此方法'});
      const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
      if(!file.startsWith(root+path.sep))return json(res,403,{error:'禁止访问'});
      const data=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:data);
    }catch(error){if(res.destroyed||res.headersSent)return;json(res,error instanceof ServiceError?error.status:404,{error:error instanceof ServiceError?error.message:'资源不存在或请求无效',code:error instanceof ServiceError?error.code:'NOT_FOUND'});}
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.loadEnvFile(fileURLToPath(new URL('./.env',import.meta.url)));}catch(error){if(error.code!=='ENOENT')throw error;}
  const port=Number(process.env.PORT)||4173;
  createApp().listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port} | DeepSeek: ${modelConfig().configured?'configured':'not configured'}`));
}
