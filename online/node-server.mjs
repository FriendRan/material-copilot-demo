import http from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// Render terminates HTTPS. Use its configured public origin, never a forwarded
// host supplied by a visitor, when validating same-origin API requests.
export function createHostedServer({handler,env=process.env}){
  const origin=new URL(env.RENDER_EXTERNAL_URL||env.PUBLIC_ORIGIN||'');
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('A public HTTPS origin is required');
  return http.createServer(async(req,res)=>{
    const fail=status=>{if(!res.headersSent){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify({error:'请求无效或服务暂时不可用'}));}else res.destroy();};
    const controller=new AbortController();
    const closed=()=>{if(!res.writableEnded)controller.abort();};
    res.on('close',closed);
    try{
      if(req.headers.host!==origin.host)return fail(403);
      if(!req.url?.startsWith('/')||req.url.startsWith('//'))return fail(400);
      const url=new URL(req.url,origin);
      if(url.origin!==origin.origin)return fail(400);
      // Health probes must never consume model tokens or expose configuration.
      if(url.pathname==='/healthz'&&['GET','HEAD'].includes(req.method)){
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
        res.end(req.method==='HEAD'?undefined:'{"ok":true}');return;
      }
      const headers=new Headers();
      for(let i=0;i<req.rawHeaders.length;i+=2)headers.append(req.rawHeaders[i],req.rawHeaders[i+1]);
      // This host does not authenticate Cloudflare/Vercel client-IP headers.
      // Keep a conservative shared address bucket instead of trusting them.
      for(const key of ['cf-connecting-ip','x-vercel-forwarded-for','x-forwarded-for'])headers.delete(key);
      const hasBody=!['GET','HEAD'].includes(req.method);
      const request=new Request(url,{method:req.method,headers,signal:controller.signal,...(hasBody?{body:Readable.toWeb(req),duplex:'half'}:{})});
      const result=await handler.fetch(request,env);
      if(res.destroyed){await result.body?.cancel();return;}
      res.statusCode=result.status;
      for(const [key,value] of result.headers)if(key!=='set-cookie')res.setHeader(key,value);
      const cookies=result.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies);
      if(req.method==='HEAD'||!result.body){await result.body?.cancel();res.end();}
      else await pipeline(Readable.fromWeb(result.body),res);
    }catch{if(!res.destroyed)fail(500);}
    finally{res.off('close',closed);}
  });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  // The build contains only allowlisted app assets/code. Secrets are read at
  // runtime from Render environment variables; no .env files are loaded.
  const {default:handler}=await import('../dist/server/index.js');
  const port=Number(process.env.PORT)||10000;
  const server=createHostedServer({handler});
  server.listen(port,'0.0.0.0',()=>console.log('Hosted demo listening on port '+port));
  process.on('SIGTERM',()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),10000).unref();});
}
