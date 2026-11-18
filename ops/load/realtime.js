// Staging-only Realtime connection ceiling test. Mirrors the client Home screen: one WebSocket per
// user with a filtered postgres_changes subscription on orders. No rows are written.
import ws from 'k6/ws';
import {check,sleep} from 'k6';
import {Counter,Rate,Trend} from 'k6/metrics';
const ref='rganzksyljjerfuowodi',target=`https://${ref}.supabase.co`;
if(__ENV.STAGING_URL!==target||!__ENV.STAGING_ANON_KEY)throw Error('Explicit isolated staging URL and public key required');
const key=__ENV.STAGING_ANON_KEY;
if(!key.startsWith('sb_publishable_')){
  const encoding=require('k6/encoding');
  const claims=JSON.parse(encoding.b64decode(key.split('.')[1],'rawurl','s'));
  if(claims.role!=='anon'||claims.ref!==ref)throw Error('Staging anon key required');
}
const peak=Number(__ENV.PEAK||1500);
if(!(peak>0&&peak<=3000))throw Error('Peak outside reviewed range');
const holdSeconds=Number(__ENV.HOLD_SECONDS||150);
const joined=new Rate('rt_join_ok'),rejected=new Counter('rt_rejections'),closedEarly=new Counter('rt_closed_early');
const joinMs=new Trend('rt_join_ms',true);
const reject=(reason)=>{rejected.add(1);console.log(`RT_REJECT ${String(reason).slice(0,80)}`);};
export const options={
  scenarios:{realtime:{executor:'ramping-vus',startVUs:0,stages:[
    {duration:'60s',target:Math.round(peak/3)},{duration:'60s',target:Math.round(peak*2/3)},{duration:'60s',target:peak},{duration:'60s',target:peak},{duration:'15s',target:0}],
    gracefulRampDown:'5s',gracefulStop:'20s'}},
  summaryTrendStats:['avg','med','p(95)','p(99)','max'],
};
export default function(){
  const url=`wss://${ref}.supabase.co/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`;
  const topic=`realtime:k6-load-${__VU}-${__ITER}`;
  let start=Date.now(),isJoined=false,refN=1;
  const res=ws.connect(url,{tags:{operation:'realtime'}},socket=>{
    socket.on('open',()=>{
      start=Date.now();
      socket.send(JSON.stringify({topic,event:'phx_join',ref:'1',join_ref:'1',payload:{config:{broadcast:{self:false},presence:{key:''},
        postgres_changes:[{event:'*',schema:'public',table:'orders',filter:`client_phone=eq.k6-${__VU}`}]},access_token:key}}));
      socket.setInterval(()=>socket.send(JSON.stringify({topic:'phoenix',event:'heartbeat',payload:{},ref:String(++refN)})),25000);
      socket.setTimeout(()=>socket.close(),holdSeconds*1000);
    });
    socket.on('message',raw=>{
      let m;try{m=JSON.parse(raw);}catch{return;}
      if(m.topic===topic&&m.event==='phx_reply'&&m.ref==='1'){
        const ok=m.payload&&m.payload.status==='ok';
        joined.add(ok);joinMs.add(Date.now()-start);
        if(ok)isJoined=true;else{reject(m.payload?.response?.reason||JSON.stringify(m.payload?.response||{}));socket.close();}
      }
      if(m.event==='system'&&m.payload&&m.payload.status==='error'){reject('system:'+(m.payload.message||''));socket.close();}
      if(m.event==='phx_error'||m.event==='phx_close'){if(!isJoined)reject(m.event);}
    });
    socket.on('close',()=>{if(Date.now()-start<holdSeconds*1000-2000)closedEarly.add(1);});
    socket.on('error',()=>{});
  });
  check(res,{'ws upgraded (101)':r=>r&&r.status===101});
  if(!res||res.status!==101){joined.add(false);reject(`http_${res?res.status:0}`);}
  // Back off after any short-lived/failed session so rejections do not become a reconnect storm.
  sleep(5);
}
export function handleSummary(data){
  return {[__ENV.SUMMARY_PATH||'realtime-summary.json']:JSON.stringify({date:new Date().toISOString(),tool:'k6',target,peak,holdSeconds,metrics:data.metrics,state:data.state},null,2),stdout:''};
}
