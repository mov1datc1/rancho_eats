import http from 'k6/http';
import {check,sleep,fail} from 'k6';
import encoding from 'k6/encoding';
import exec from 'k6/execution';
import {Rate,Counter} from 'k6/metrics';
import {SharedArray} from 'k6/data';
const target='https://rganzksyljjerfuowodi.supabase.co';
if(__ENV.STAGING_URL!==target||!__ENV.LOAD_SESSIONS_FILE)throw Error('Isolated staging and private session file required');
const fixture=JSON.parse(open(__ENV.LOAD_SESSIONS_FILE));
if(fixture.ref!=='rganzksyljjerfuowodi'||!fixture.anon)throw Error('Invalid staging fixture');
const claims=token=>JSON.parse(encoding.b64decode(token.split('.')[1],'rawurl','s'));
if(claims(fixture.anon).ref!==fixture.ref||claims(fixture.anon).role!=='anon')throw Error('Staging anon key required');
const sessions=new SharedArray('synthetic shoppers',()=>fixture.sessions);
for(const s of sessions){const c=claims(s.token);if(c.iss!==target+'/auth/v1'||c.role!=='authenticated'||c.sub!==s.id)throw Error('Authenticated staging shoppers required');}
const profile=__ENV.CHECKOUT_PROFILE||'smoke',writers=profile==='smoke'?5:50,readers=profile==='smoke'?10:100;
if(!['smoke','mixed'].includes(profile)||sessions.length<50)throw Error('Bounded profile and 50 test accounts required');
const invalid=new Rate('invalid_response'),created=new Counter('orders_created'),cancelled=new Counter('orders_cancelled');
export const options={
 dns:{ttl:'5m',select:'first',policy:'onlyIPv4'},hosts:{'rganzksyljjerfuowodi.supabase.co':'172.64.149.246'},
 setupTimeout:'30s',scenarios:{
  menus:{executor:'ramping-vus',exec:'browse',startVUs:0,stages:[{duration:'15s',target:readers},{duration:'60s',target:readers},{duration:'10s',target:0}],gracefulRampDown:'10s',gracefulStop:'10s'},
  buyers:{executor:'per-vu-iterations',exec:'checkout',startTime:'25s',vus:writers,iterations:1,maxDuration:'60s',gracefulStop:'10s'},
 },thresholds:{
  http_req_failed:[{threshold:'rate<0.01',abortOnFail:true,delayAbortEval:'15s'}],
  invalid_response:[{threshold:'rate<0.01',abortOnFail:true,delayAbortEval:'15s'}],
  'http_req_duration{operation:menu}':['p(95)<1500'],
  'http_req_duration{operation:checkout}':['p(95)<2000'],
  checks:['rate>0.99'],orders_created:[`count==${writers}`],orders_cancelled:[`count==${writers}`],
 },
};
const params=(token,operation,extra={})=>({headers:{apikey:fixture.anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json',...extra},tags:{operation},timeout:'12s',redirects:0});
function inspect(r,name,predicate){let d;try{d=r.json();}catch{}const valid=predicate(r,d);invalid.add(!valid);check(r,{[name]:()=>valid});if(!valid)console.warn(JSON.stringify({check:name,status:r.status,errorCode:r.error_code||0,durationMs:r.timings.duration,at:new Date().toISOString()}));return valid?d:null;}
export function setup(){
 const r=http.post(target+'/rest/v1/rpc/customer_businesses','{}',params(sessions[0].token,'preflight'));
 const rows=inspect(r,'synthetic catalog visible',(r,d)=>r.status===200&&Array.isArray(d)&&d.some(b=>b.id===fixture.shop));
 if(!rows)fail('Prepared staging shop not visible');
}
export function browse(){
 const s=sessions[(__VU-1)%sessions.length];
 inspect(http.post(target+'/rest/v1/rpc/customer_businesses','{}',params(s.token,'catalog')),'authenticated catalog',(r,d)=>r.status===200&&Array.isArray(d)&&d.length>=100);
 sleep(1);
 inspect(http.get(`${target}/rest/v1/menu_items?select=*&restaurant_id=eq.${fixture.shop}&available=eq.true&order=sort_order.asc,category.asc`,params(s.token,'menu')),'nonempty authenticated menu',(r,d)=>r.status===200&&Array.isArray(d)&&d.length===30);
 sleep(3);
}
export function checkout(){
 const buyer=sessions[exec.scenario.iterationInTest];
 if(!buyer)fail('Synthetic buyer allocation exceeded');
 const quote=inspect(http.post(target+'/rest/v1/rpc/quote_delivery',JSON.stringify({p_restaurant:fixture.shop,p_type:'delivery',p_lat:fixture.lat,p_lng:fixture.lng}),params(buyer.token,'quote')),'delivery quote',(r,d)=>r.status===200&&Number.isFinite(d?.fee));
 if(!quote)return;
 const amount=fixture.price+fixture.commission+quote.fee;
 const body={restaurant_id:fixture.shop,client_user_id:buyer.id,client_name:'Comprador sintético QA',client_phone:'0000000000',client_lat:fixture.lat,client_lng:fixture.lng,client_location_note:'Prueba aislada de carga',items:[{id:fixture.item,name:'Producto sintético 0',price:fixture.price,quantity:1,options:[]}],subtotal:fixture.price,commission_amount:fixture.commission,delivery_amount:quote.fee,total:amount,payment_method:'cash',delivery_type:'delivery',status:'PENDING'};
 // Exactly the app's public insert, using a buyer JWT, never service_role.
 const order=inspect(http.post(target+'/rest/v1/orders',JSON.stringify(body),params(buyer.token,'checkout',{Prefer:'return=representation'})),'order created with correct price and owner',(r,d)=>r.status===201&&Array.isArray(d)&&d.length===1&&d[0].client_user_id===buyer.id&&d[0].total===amount&&d[0].delivery_amount===quote.fee&&d[0].delivery_pricing_snapshot?.version===quote.version);
 if(!order)return;created.add(1);
 const id=order[0].id;
 inspect(http.get(`${target}/rest/v1/orders?select=id,total,status&id=eq.${id}`,params(buyer.token,'read_order')),'buyer reads own order',(r,d)=>r.status===200&&Array.isArray(d)&&d.length===1&&d[0].id===id);
 const other=sessions.find(u=>u.id!==buyer.id);
 inspect(http.get(`${target}/rest/v1/orders?select=id&id=eq.${id}`,params(other.token,'isolation')),'other buyer cannot read order',(r,d)=>r.status===200&&Array.isArray(d)&&d.length===0);
 sleep(2);
 const result=inspect(http.post(target+'/rest/v1/rpc/client_cancel_order',JSON.stringify({p_order_id:id}),params(buyer.token,'cancel')),'buyer cancellation',(r,d)=>r.status===200&&(Array.isArray(d)?d[0]:d)?.status==='CANCELLED');
 if(result)cancelled.add(1);
}
export function handleSummary(data){return {[__ENV.SUMMARY_PATH||'checkout-summary.json']:JSON.stringify({date:new Date().toISOString(),target,profile,writers,readers,scope:'authenticated menus + simultaneous cash-order creation/reads/isolation/client-cancellation',metrics:data.metrics},null,2)};}
