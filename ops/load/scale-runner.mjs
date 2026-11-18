// Orchestrates the 2026-11-17 scale audit against STAGING only.
// Credentials stay in memory / child env; outputs keep aggregates only.
// Usage: STAGING_URL=https://rganzksyljjerfuowodi.supabase.co node ops/load/scale-runner.mjs [smoke|full|realtime|http]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createClient} from '@supabase/supabase-js';
import {STAGING_URL,stagingCredentials} from './staging-credentials.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..');
const mode=process.argv[2]||'smoke';
if(!['smoke','full','realtime','http'].includes(mode))throw Error('Use smoke|full|realtime|http');
const out=path.join(root,'release-artifacts/2026-11-17-scale-audit',mode);
fs.mkdirSync(out,{recursive:true});
const fixturePath=path.join(out,'catalog-fixtures.json');
if(fs.existsSync(fixturePath)&&!JSON.parse(fs.readFileSync(fixturePath)).cleanedAt)throw Error('Uncleaned fixture receipt exists; review before another run');
if(fs.existsSync(fixturePath))fs.renameSync(fixturePath,fixturePath+'.'+Date.now()+'.prev');
const {service,anon}=stagingCredentials();
const boundedFetch=(url,options={})=>fetch(url,{...options,signal:options.signal||AbortSignal.timeout(8000)});
const db=createClient(STAGING_URL,service,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:boundedFetch}});
const ok=r=>{if(r.error)throw Error(r.error.message);return r.data;};
const log=(o)=>{const line=JSON.stringify({at:new Date().toISOString(),...o});console.log(line);fs.appendFileSync(path.join(out,'runner.log'),line+'\n');};
function child(command,args,env={},label='child'){return new Promise((resolve,reject)=>{
  const p=spawn(command,args,{cwd:path.resolve(here,'../..'),env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  // Never echo raw child output containing env; k6 output here is metrics/progress only.
  const file=fs.createWriteStream(path.join(out,`${label}.log`));
  const scrub=b=>b.toString().split(anon).join('<anon>').split(service).join('<service>');
  p.stdout.on('data',b=>file.write(scrub(b)));p.stderr.on('data',b=>file.write(scrub(b)));
  p.on('error',()=>reject(Error('Unable to launch '+label)));p.on('close',code=>{file.end();resolve(code);});
});}
let samples=[],monitoring=false,phase='prepare';
async function collect(){
  const sample={at:new Date().toISOString(),phase};
  const t=Date.now();
  try{sample.health=ok(await db.rpc('platform_health_snapshot'));sample.healthMs=Date.now()-t;}catch{sample.healthUnavailable=true;sample.healthMs=Date.now()-t;}
  try{
    const r=await fetch(STAGING_URL+'/customer/v1/privileged/metrics',{headers:{Authorization:'Basic '+Buffer.from('service_role:'+service).toString('base64')},signal:AbortSignal.timeout(8000)});
    sample.metricsHttp=r.status;
    if(r.ok){const text=await r.text();sample.infra={};
      for(const line of text.split('\n')){
        const m=line.match(/^(node_memory_MemTotal_bytes|node_memory_MemAvailable_bytes|node_load1|pg_stat_database_numbackends|pg_settings_max_connections|pg_stat_database_xact_commit|pgrst_db_pool_available|pgrst_db_pool_waiting|pgrst_db_pool_max|realtime_connections_connected|supavisor_connections_active)(?:\{[^}]*\})?\s+([0-9.eE+-]+)(?:\s+\d+)?$/);
        if(m&&Number.isFinite(Number(m[2])))sample.infra[m[1]]=(sample.infra[m[1]]||0)+Number(m[2]);
        const c=line.match(/^node_cpu_seconds_total\{[^}]*mode="([^"]+)"[^}]*\}\s+([0-9.eE+-]+)/);
        if(c){sample.cpu??={};sample.cpu[c[1]]=(sample.cpu[c[1]]||0)+Number(c[2]);}
      }}
  }catch{sample.metricsUnavailable=true;}
  samples.push(sample);fs.writeFileSync(path.join(out,'monitoring.json'),JSON.stringify(samples,null,2));
}
async function monitor(){while(monitoring){await collect();if(monitoring)await delay(5000);}}
function summarizeMonitoring(){
  const s=samples,cpuPct=[];
  for(let i=1;i<s.length;i++){const a=s[i-1].cpu,b=s[i].cpu;if(!a||!b)continue;
    const tot=Object.keys(b).reduce((x,k)=>x+(b[k]-(a[k]||0)),0),idle=(b.idle-(a.idle||0))+((b.iowait||0)-(a.iowait||0));
    if(tot>0)cpuPct.push({phase:s[i].phase,v:100*(1-idle/tot)});}
  const byPhase={};
  for(const x of s){const p=byPhase[x.phase]??={samples:0,healthFailures:0,maxHealthMs:0,maxDbConnections:0,maxLoad1:0,maxMemPct:0,maxCpuPct:0};
    p.samples++;if(x.healthUnavailable)p.healthFailures++;p.maxHealthMs=Math.max(p.maxHealthMs,x.healthMs||0);
    if(x.health)p.maxDbConnections=Math.max(p.maxDbConnections,x.health.db_connections||0),p.dbMax=x.health.db_max_connections;
    if(x.infra){p.maxLoad1=Math.max(p.maxLoad1,x.infra.node_load1||0);
      if(x.infra.node_memory_MemTotal_bytes)p.maxMemPct=Math.max(p.maxMemPct,100*(1-x.infra.node_memory_MemAvailable_bytes/x.infra.node_memory_MemTotal_bytes));
      if(x.infra.realtime_connections_connected!=null)p.maxRealtimeConnected=Math.max(p.maxRealtimeConnected||0,x.infra.realtime_connections_connected);
      if(x.infra.pgrst_db_pool_waiting!=null)p.maxPostgrestPoolWaiting=Math.max(p.maxPostgrestPoolWaiting||0,x.infra.pgrst_db_pool_waiting);}
  }
  for(const c of cpuPct)byPhase[c.phase].maxCpuPct=Math.max(byPhase[c.phase].maxCpuPct,Math.round(c.v*10)/10);
  fs.writeFileSync(path.join(out,'monitoring-summary.json'),JSON.stringify(byPhase,null,2));return byPhase;
}
const k6=process.env.K6_BIN||'k6';
const env={STAGING_URL,STAGING_ANON_KEY:anon,FIXTURE_PATH:fixturePath,K6_NO_USAGE_REPORT:'true'};
let seeded=false;
try{
  log({mode,step:'seed'});
  const code=await child(process.execPath,[path.join(here,'fixtures.mjs'),'seed'],{STAGING_URL,FIXTURE_PATH:fixturePath},'seed');
  if(code!==0)throw Error('Seed failed; receipt retained');seeded=true;
  log({seeded:true});
  monitoring=true;const mon=monitor();
  phase='baseline';await delay(15000);
  if(mode!=='realtime'){
    phase='http';
    const httpEnv=mode==='smoke'?{STEPS:'5,10',HOLD_SECONDS:'20'}:{STEPS:process.env.STEPS||'20,50,100,200,400,700,1000',HOLD_SECONDS:process.env.HOLD_SECONDS||'90'};
    log({step:'k6 http',...httpEnv});
    const c=await child(k6,['run','--no-usage-report','--quiet',path.join(here,'scale.js')],{...env,...httpEnv,SUMMARY_PATH:path.join(out,'http-summary.json')},'k6-http');
    log({k6HttpExit:c});
    phase='cooldown-http';await delay(20000);
  }
  if(mode!=='http'){
    phase='realtime';
    const rtEnv=mode==='smoke'?{PEAK:'30',HOLD_SECONDS:'60'}:{PEAK:process.env.PEAK||'1500',HOLD_SECONDS:process.env.RT_HOLD||'150'};
    log({step:'k6 realtime',...rtEnv});
    const c=await child(k6,['run','--no-usage-report','--quiet',path.join(here,'realtime.js')],{...env,...rtEnv,SUMMARY_PATH:path.join(out,'realtime-summary.json')},'k6-realtime');
    log({k6RealtimeExit:c});
    phase='cooldown-realtime';await delay(20000);
  }
  monitoring=false;await mon;
  log({monitoring:summarizeMonitoring()});
}catch(e){log({error:e.message});monitoring=false;}
finally{
  if(seeded||fs.existsSync(fixturePath)){
    for(let attempt=1;attempt<=3;attempt++){
      const c=await child(process.execPath,[path.join(here,'fixtures.mjs'),'cleanup'],{STAGING_URL,FIXTURE_PATH:fixturePath},'cleanup');
      log({cleanupAttempt:attempt,exit:c});if(c===0)break;await delay(10000);
    }
  }
}

