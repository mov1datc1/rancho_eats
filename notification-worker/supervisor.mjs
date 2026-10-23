// One always-on process supervises isolated app/provider workers and a health endpoint.
import {fork} from 'node:child_process';
import {createServer} from 'node:http';
import {rpcClient} from './worker.mjs';
import {authorizedMetrics,startMetrics} from './metrics.mjs';
const metricsToken=process.env.METRICS_TOKEN;
if(metricsToken && metricsToken.length<32) throw new Error('METRICS_TOKEN must have at least 32 characters');
const metrics=metricsToken?startMetrics({rpc:rpcClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY)}):null;
const apps=['client','restaurant','driver',...(process.env.VAPID_PRIVATE_KEY?['web']:[])];
const children=new Map();let stopping=false;
for(const app of apps){
 const child=fork(new URL('./worker.mjs',import.meta.url),[],{env:{...process.env,NOTIFICATION_APP:app,NOTIFICATION_PROVIDER:app==='web'?'webpush':'expo'},stdio:['ignore','inherit','inherit','ipc']});
 children.set(app,{child,lastProgress:Date.now()});
 child.on('message',message=>{if(message?.type==='progress')children.get(app).lastProgress=Date.now();});
 child.on('exit',()=>{if(!stopping){console.error('Notification worker stopped:',app);shutdown(1);}});
}
const server=createServer((req,res)=>{
 if(req.url==='/metrics'){
  if(!metrics){res.writeHead(404);res.end();return;}
  if(req.method!=='GET'||!authorizedMetrics(req.headers.authorization,metricsToken)){res.writeHead(401,{'Cache-Control':'no-store'});res.end();return;}
  try{const body=metrics.read();res.writeHead(200,{'Content-Type':'text/plain; version=0.0.4','Cache-Control':'no-store'});res.end(body);}catch{res.writeHead(503,{'Cache-Control':'no-store'});res.end('Metrics unavailable');}return;
 }
 if(req.url!=='/healthz'){res.writeHead(404);res.end();return;}const ok=[...children.values()].every(x=>x.child.exitCode===null&&Date.now()-x.lastProgress<90000);res.writeHead(ok?200:503,{'Content-Type':'application/json'});res.end(JSON.stringify({healthy:ok}));}).listen(Number(process.env.PORT||10000),'0.0.0.0');
function shutdown(code=0){if(stopping)return;stopping=true;metrics?.stop();server.close();for(const {child} of children.values())child.kill('SIGTERM');setTimeout(()=>process.exit(code),15000).unref();}
process.on('SIGTERM',()=>shutdown());process.on('SIGINT',()=>shutdown());
