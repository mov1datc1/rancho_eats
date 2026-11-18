import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createClient} from '@supabase/supabase-js';
import {STAGING_URL,STAGING_REF,stagingCredentials} from './staging-credentials.mjs';
import {cleanupBuyers} from './cleanup-buyers.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..');
const out=path.join(root,'release-artifacts/2026-11-01-checkout-load');fs.mkdirSync(out,{recursive:true});
const fixturePath=path.join(out,'catalog-fixtures.json'),receiptPath=path.join(out,'buyers-receipt.json');
const privatePath='/private/tmp/pideya-checkout-load-sessions.json';
if(fs.existsSync(receiptPath)||fs.existsSync(privatePath)||fs.existsSync(fixturePath))throw Error('Previous test receipt exists; review cleanup before another run');
const {service,anon}=stagingCredentials();
const boundedFetch=(url,options={})=>fetch(url,{...options,signal:options.signal||AbortSignal.timeout(15000)});
const db=createClient(STAGING_URL,service,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:boundedFetch}});
const publicDb=createClient(STAGING_URL,anon,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:boundedFetch}});
const ok=r=>{if(r.error)throw Error(r.error.message);return r.data;};
function child(command,args,env={}){return new Promise((resolve,reject)=>{
 const p=spawn(command,args,{cwd:path.resolve(here,'../..'),env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
 // All child scripts suppress credentials. Do not log raw child-process error objects.
 let log='';p.stdout.on('data',b=>{log+=b.toString();});p.stderr.on('data',b=>{log+=b.toString();});
 p.on('error',()=>reject(Error('Unable to launch load tool')));p.on('close',code=>resolve({code,log}));
 });}
let buyers={ref:STAGING_REF,createdAt:new Date().toISOString(),users:[]},samples=[],monitoring=false,monitorPromise;
const save=()=>fs.writeFileSync(receiptPath,JSON.stringify(buyers,null,2));
async function collect(){
 const when=new Date().toISOString(),sample={at:when};
 try{sample.health=ok(await db.rpc('platform_health_snapshot'));}catch{sample.healthUnavailable=true;}
 // Keep only numeric infrastructure aggregates; never persist raw metrics labels.
 try{
  const response=await fetch(STAGING_URL+'/customer/v1/privileged/metrics',{headers:{Authorization:'Basic '+Buffer.from('service_role:'+service).toString('base64')},signal:AbortSignal.timeout(8000)});
  sample.metricsHttp=response.status;
  if(response.ok){const text=await response.text();sample.infrastructure={};
   for(const line of text.split('\n')){
    const m=line.match(/^(node_memory_MemTotal_bytes|node_memory_MemAvailable_bytes|node_load1|node_load5|pg_stat_database_deadlocks|pg_stat_database_xact_commit|pg_stat_database_xact_rollback|pg_stat_database_numbackends|pg_settings_max_connections|pg_up)(?:\{[^}]*\})?\s+([0-9.eE+-]+)(?:\s+\d+)?$/);
    if(m&&Number.isFinite(Number(m[2])))sample.infrastructure[m[1]]=(sample.infrastructure[m[1]]||0)+Number(m[2]);
    const c=line.match(/^node_cpu_seconds_total\{[^}]*mode="([^"]+)"[^}]*\}\s+([0-9.eE+-]+)/);
    if(c){sample.cpuSeconds??={};sample.cpuSeconds[c[1]]=(sample.cpuSeconds[c[1]]||0)+Number(c[2]);}
   }
  }
 }catch{sample.metricsUnavailable=true;}
 samples.push(sample);fs.writeFileSync(path.join(out,'monitoring.json'),JSON.stringify(samples,null,2));
}
async function monitor(){while(monitoring){await collect();if(monitoring)await delay(5000);}}
async function cleanup(){
 if(fs.existsSync(fixturePath)){
  const catalog=JSON.parse(fs.readFileSync(fixturePath));
  const orders=ok(await db.from('orders').select('id,client_user_id').in('restaurant_id',catalog.businesses));
  if(orders.some(o=>!buyers.users.includes(o.client_user_id)))throw Error('Cleanup stopped: unexpected order owner');
  if(orders.length){const ids=orders.map(o=>o.id);ok(await db.from('operation_audit').delete().in('order_id',ids));ok(await db.from('orders').delete().in('id',ids));}
  const result=await child(process.execPath,[path.join(here,'fixtures.mjs'),'cleanup'],{STAGING_URL,FIXTURE_PATH:fixturePath});
  if(result.code!==0)throw Error('Catalog cleanup failed; receipt retained');
 }
 await cleanupBuyers(receiptPath,service);
 if(fs.existsSync(privatePath))fs.unlinkSync(privatePath);
 console.log(JSON.stringify({cleanup:true,syntheticBuyersRemoved:buyers.users.length}));
}
try{
 save();
 const seeded=await child(process.execPath,[path.join(here,'fixtures.mjs'),'seed'],{STAGING_URL,FIXTURE_PATH:fixturePath});
 if(seeded.code!==0)throw Error('Catalog preparation failed; receipt retained');
 console.log(JSON.stringify({prepared:'catalog',businesses:100,menuItems:3000}));
 const catalog=JSON.parse(fs.readFileSync(fixturePath)),shop=catalog.businesses[0];
 const business=ok(await db.from('restaurants').select('lat,lng').eq('id',shop).single());
 const item=ok(await db.from('menu_items').select('id,price').eq('restaurant_id',shop).eq('sort_order',0).single());
 const config=ok(await db.from('app_settings').select('value').eq('setting_key','commission_config').maybeSingle());
 const tiers=config?.value?.commission_tiers||[{up_to:100,fee:8},{up_to:150,fee:10},{up_to:200,fee:12},{up_to:300,fee:15},{up_to:500,fee:18},{up_to:null,fee:20}];
 const commission=Number([...tiers].sort((a,b)=>(a.up_to??Infinity)-(b.up_to??Infinity)).find(t=>t.up_to==null||item.price<=t.up_to).fee);
 const sessions=[];
 for(let i=0;i<50;i++){
  const email=`checkout-${randomUUID()}@example.invalid`,password=randomUUID()+randomUUID();
  const user=ok(await db.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{synthetic_checkout_load:true}})).user;
  buyers.users.push(user.id);save();
  let signed;
  for(let attempt=0;attempt<5;attempt++){signed=await publicDb.auth.signInWithPassword({email,password});if(!signed.error||signed.error.status!==429)break;await delay(2500);}
  const auth=ok(signed);sessions.push({id:user.id,token:auth.session.access_token});
  if((i+1)%10===0)console.log(JSON.stringify({preparedBuyers:i+1}));await delay(250);
 }
 const ids=[catalog.owner,...buyers.users];
 const endpoints=ok(await db.from('notification_endpoints').select('id').in('user_id',ids));
 if(endpoints.length)throw Error('Synthetic account unexpectedly has notification endpoints');
 fs.writeFileSync(privatePath,JSON.stringify({ref:STAGING_REF,anon,sessions,shop,item:item.id,price:item.price,commission,lat:business.lat,lng:business.lng}),{mode:0o600});
 monitoring=true;monitorPromise=monitor();
 const runs=[];
 for(const profile of ['smoke','mixed']){
  const startedAt=new Date().toISOString();console.log(JSON.stringify({running:profile,startedAt}));
  const run=await child('/private/tmp/pideya-k6/k6-v2.3.0-macos-arm64/k6',['run','--quiet','--no-usage-report',path.join(here,'checkout.js')],{STAGING_URL,LOAD_SESSIONS_FILE:privatePath,CHECKOUT_PROFILE:profile,SUMMARY_PATH:path.join(out,profile+'.json')});
  // The script never logs response bodies, tokens or passwords.
  fs.writeFileSync(path.join(out,profile+'.log'),run.log);
  const orders=ok(await db.from('orders').select('id,order_number,status,client_user_id,total,subtotal,commission_amount,delivery_amount,delivery_pricing_snapshot').in('restaurant_id',catalog.businesses));
  const events=ok(await db.from('notification_events').select('id').in('order_id',orders.map(o=>o.id)));
  const deliveries=events.length?ok(await db.from('notification_deliveries').select('id,state').in('event_id',events.map(e=>e.id))):[];
  if(deliveries.length)throw Error('Unexpected provider deliveries for fixture accounts');
  const data={profile,startedAt,finishedAt:new Date().toISOString(),exitCode:run.code,cumulativeOrders:orders.length,uniqueIds:new Set(orders.map(o=>o.id)).size,uniqueOrderNumbers:new Set(orders.map(o=>o.order_number)).size,owners:new Set(orders.map(o=>o.client_user_id)).size,statuses:orders.reduce((a,o)=>(a[o.status]=(a[o.status]||0)+1,a),{}),totalsConsistent:orders.every(o=>o.total===o.subtotal+o.commission_amount+o.delivery_amount),outboundDeliveries:deliveries.length};
  runs.push(data);fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(runs,null,2));console.log(JSON.stringify(data));
  if(run.code!==0)throw Error('Load thresholds failed; mixed run blocked or interrupted');
 }
}catch(e){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({at:new Date().toISOString(),message:e instanceof Error?e.message:'Test failure'},null,2));console.log(JSON.stringify({failed:true,message:e instanceof Error?e.message:'Test failure'}));process.exitCode=1;}
finally{monitoring=false;if(monitorPromise)await monitorPromise;try{await cleanup();}catch{console.log(JSON.stringify({cleanup:false,message:'Cleanup needs review; fixture receipts retained'}));process.exitCode=1;}}
