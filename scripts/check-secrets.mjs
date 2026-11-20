import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';

// Examine the index rather than the working tree: check exactly what will be pushed.
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const files=git('ls-files','--cached','-z').split('\0').filter(Boolean);
if(!files.length)throw Error('No tracked files to check');
let localKey='';
try{
  const env=await readFile(new URL('../.env',import.meta.url),'utf8');
  const match=env.match(/^\s*DEEPSEEK_API_KEY\s*=\s*(.*?)\s*$/m);
  localKey=(match?.[1]||'').replace(/^(['"])(.*)\1$/,'$2');
}catch(error){if(error.code!=='ENOENT')throw error;}
const failures=[];
for(const file of files){
  if(/(^|\/)(node_modules|\.codex|\.agents)\//.test(file)||/(^|\/)\.env(?:\..*)?$/.test(file)&&file!=='.env.example')failures.push(file+': local-only path');
  const body=git('show',':'+file);
  if(localKey.length>=8&&body.includes(localKey))failures.push(file+': matches local secret');
  if(/\bsk-[A-Za-z0-9_-]{20,}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(body))failures.push(file+': credential-like content');
}
if(failures.length){console.error('Secret check failed (values redacted):\n'+failures.join('\n'));process.exitCode=1;}
else console.log(`PASS: ${files.length} tracked files checked; local-only paths, the configured local key and credential patterns are absent.`);
