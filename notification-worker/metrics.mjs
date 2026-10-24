import {timingSafeEqual} from 'node:crypto';
const names={technical_errors_1h:'pideya_technical_errors_last_hour',technical_affected_users_1h:'pideya_technical_affected_users_last_hour',technical_incidents_open:'pideya_technical_incidents_open',checkout_errors_15m:'pideya_checkout_errors_last_15m',sampled_at:'pideya_snapshot_timestamp_seconds',db_connections:'pideya_db_connections',db_max_connections:'pideya_db_max_connections',queue_pending:'pideya_queue_pending',queue_oldest_operational_seconds:'pideya_queue_oldest_operational_seconds',queue_dead_1h:'pideya_queue_dead_last_hour',queue_expired_leases:'pideya_queue_expired_leases'};
export function authorizedMetrics(header,token){
 if(!token || token.length<32 || typeof header!=='string')return false;
 const actual=Buffer.from(header);const expected=Buffer.from(`Bearer ${token}`);
 return actual.length===expected.length && timingSafeEqual(actual,expected);
}
export function renderMetrics(snapshot,now=Date.now()){
 if(!snapshot || !Number.isFinite(snapshot.sampled_at) || now/1000-snapshot.sampled_at>150 || snapshot.sampled_at>now/1000+30)throw new Error('Metrics snapshot stale');
 return Object.entries(names).map(([key,name])=>{
  const value=snapshot[key];if(!Number.isFinite(value)||value<0)throw new Error('Invalid metrics snapshot');
  return `# TYPE ${name} gauge\n${name} ${value}\n`;
 }).join('');
}
export function startMetrics({rpc,log=console.error}){
 let snapshot=null;let running=false;
 const refresh=async()=>{if(running)return;running=true;try{const data=await rpc('platform_health_snapshot',{});renderMetrics(data);snapshot=data;}catch{log(JSON.stringify({type:'metrics_refresh_failed'}));}finally{running=false;}};
 void refresh();const timer=setInterval(refresh,60000);timer.unref();
 return {read:()=>renderMetrics(snapshot),stop:()=>clearInterval(timer)};
}
