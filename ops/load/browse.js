// Read-only hosted staging test. Never calls Maps, Auth, checkout or notifications.
import http from 'k6/http';
import {check, sleep, fail} from 'k6';
import {Rate} from 'k6/metrics';
const target = 'https://rganzksyljjerfuowodi.supabase.co';
if (__ENV.STAGING_URL !== target || !__ENV.STAGING_ANON_KEY) throw Error('Explicit isolated staging URL and public key required');
const key = __ENV.STAGING_ANON_KEY;
// Legacy public JWTs identify their project; reject service-role or production tokens.
if (!key.startsWith('sb_publishable_')) {
  const encoding = require('k6/encoding');
  const claims = JSON.parse(encoding.b64decode(key.split('.')[1], 'rawurl', 's'));
  if (claims.role !== 'anon' || claims.ref !== 'rganzksyljjerfuowodi') throw Error('Staging anon key required');
}
const profile = __ENV.LOAD_PROFILE || 'smoke';
const profiles = {
  smoke: [{duration:'20s',target:5},{duration:'20s',target:5},{duration:'5s',target:0}],
  ramp: [{duration:'20s',target:10},{duration:'30s',target:10},{duration:'20s',target:25},{duration:'30s',target:25},{duration:'20s',target:50},{duration:'30s',target:50},{duration:'20s',target:100},{duration:'30s',target:100},{duration:'10s',target:0}],
};
if (!profiles[profile]) throw Error('Unknown load profile');
const invalid = new Rate('invalid_response');
const hostIp=__ENV.STAGING_HOST_IP;
if(hostIp && !['104.18.38.10','172.64.149.246'].includes(hostIp))throw Error('Unreviewed DNS override');
export const options = {
  scenarios:{browse:{executor:'ramping-vus',startVUs:0,stages:profiles[profile],gracefulRampDown:'10s',gracefulStop:'10s'}},
  dns:{ttl:'5m',select:'first',policy:'onlyIPv4'},
  ...(hostIp?{hosts:{'rganzksyljjerfuowodi.supabase.co':hostIp}}:{}),
  setupTimeout:'120s',
  thresholds:{
    http_req_failed:[{threshold:'rate<0.01',abortOnFail:true,delayAbortEval:'20s'}],
    invalid_response:[{threshold:'rate<0.01',abortOnFail:true,delayAbortEval:'20s'}],
    http_req_duration:['p(95)<1500'], checks:['rate>0.99'],
  },
};
const params = operation => ({headers:{apikey:key,...(!key.startsWith('sb_publishable_')?{Authorization:`Bearer ${key}`}:{}) ,'Content-Type':'application/json'},timeout:'10s',redirects:0,tags:{operation}});
function rows(response, name) {
  let data;try {data=response.json();} catch {}
  const valid=response.status===200 && Array.isArray(data) && data.length>0;
  invalid.add(!valid);
  check(response,{[name]:()=>valid});
  return valid?data:null;
}
export function setup() {
  const businesses=rows(http.post(`${target}/rest/v1/rpc/customer_businesses`,'{}',params('catalog')),'nonempty catalog');
  if (!businesses) fail('Nonempty representative staging catalog required');
  // Collect IDs, never customer/driver data. Reject an empty menu test.
  const ids=[];
  for (const business of businesses.slice(0,20)) {
    if (!/^[0-9a-f-]{36}$/i.test(business.id)) continue;
    const r=http.get(`${target}/rest/v1/menu_items?select=id&restaurant_id=eq.${business.id}&available=eq.true&limit=1`,params('preflight'));
    if (r.status===200 && Array.isArray(r.json()) && r.json().length) ids.push(business.id);
  }
  if (!ids.length) fail('Seed synthetic available menus before measuring capacity');
  console.log(JSON.stringify({profile,businesses:businesses.length,businessesWithMenus:ids.length,maxVUs:profile==='ramp'?100:5}));
  return {ids};
}
export default function({ids}) {
  rows(http.post(`${target}/rest/v1/rpc/customer_businesses`,'{}',params('catalog')),'catalog available');
  sleep(2);
  const id=ids[(__VU+__ITER)%ids.length];
  rows(http.get(`${target}/rest/v1/menu_items?select=*&restaurant_id=eq.${id}&available=eq.true&order=sort_order.asc,category.asc`,params('menu')),'menu available');
  sleep(8);
}
export function handleSummary(data) {
  // Aggregates only: no request headers, API keys, bodies or personal data.
  const report={date:new Date().toISOString(),tool:'k6',profile,target,scope:'anonymous catalog/menu HTTP only',maxVUs:profile==='ramp'?100:5,metrics:data.metrics};
  return {[__ENV.SUMMARY_PATH || 'load-summary.json']:JSON.stringify(report,null,2)};
}
