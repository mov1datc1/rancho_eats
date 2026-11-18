// Prints compact per-step results from scale/realtime k6 summaries. Usage: node summarize-scale.mjs <dir>
import fs from 'node:fs';
import path from 'node:path';
const dir=process.argv[2];
const read=f=>{try{return JSON.parse(fs.readFileSync(path.join(dir,f)));}catch{return null;}};
const r=n=>n==null?null:Math.round(n*10)/10;
const http=read('http-summary.json'),rt=read('realtime-summary.json'),mon=read('monitoring-summary.json');
const result={};
if(http){
  const m=http.metrics,steps=[];
  for(const s of http.steps){
    const d=m[`http_req_duration{step:${s}}`]?.values,f=m[`http_req_failed{step:${s}}`]?.values;
    if(!d)continue;
    steps.push({reqPerSec:s,usersEquiv:s*5,p50:r(d.med),p95:r(d['p(95)']),p99:r(d['p(99)']),max:r(d.max),failRate:f?r(f.rate*100):null});
  }
  result.http={steps,totalRequests:m.http_reqs?.values.count,achievedRps:r(m.http_reqs?.values.rate),failedPct:r(m.http_req_failed?.values.rate*100),
    invalidPct:r(m.invalid_response?.values.rate*100),dropped:m.dropped_iterations?.values.count||0,maxVUs:m.vus_max?.values.max,
    catalogP95:r(m.catalog_ms?.values['p(95)']),menuP95:r(m.menu_ms?.values['p(95)']),dataMB:r(m.data_received?.values.count/1e6),
    aborted:http.state?.testRunDurationMs,durationS:r(http.state?.testRunDurationMs/1000)};
}
if(rt){
  const m=rt.metrics;
  result.realtime={peak:rt.peak,joinOkPct:r(m.rt_join_ok?.values.rate*100),joinAttempts:(m.rt_join_ok?.values.passes||0)+(m.rt_join_ok?.values.fails||0),
    joinsOk:m.rt_join_ok?.values.passes,joinsFailed:m.rt_join_ok?.values.fails,rejections:m.rt_rejections?.values.count||0,closedEarly:m.rt_closed_early?.values.count||0,
    joinP95:r(m.rt_join_ms?.values['p(95)']),connectP95:r(m.ws_connecting?.values['p(95)']),wsSessions:m.ws_sessions?.values.count,maxVUs:m.vus_max?.values.max};
  result.realtime.rejectionReasons=Object.entries(m).filter(([k])=>k.startsWith('rt_rejections{')).map(([k,v])=>[k,v.values.count]);
}
result.monitoring=mon;
console.log(JSON.stringify(result,null,2));

