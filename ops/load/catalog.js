// k6 run ops/load/catalog.js; pass STAGING_URL, STAGING_ANON_KEY via environment.
import http from 'k6/http';
import {check,sleep,fail} from 'k6';
const expected='https://rganzksyljjerfuowodi.supabase.co';
const target=__ENV.STAGING_URL;
if(target!==expected || !__ENV.STAGING_ANON_KEY)throw new Error('Only the isolated PideYa staging project is allowed');
const vus=Number(__ENV.VUS||10);
if(!Number.isInteger(vus)||vus<1||vus>1000)throw new Error('Run 1–1000 VUs; larger runs require a reviewed scenario');
export const options={vus,duration:__ENV.DURATION||'1m',thresholds:{http_req_failed:[{threshold:'rate<0.01',abortOnFail:true,delayAbortEval:'20s'}],http_req_duration:['p(95)<1000'],checks:['rate>0.99']}};
const params={headers:{apikey:__ENV.STAGING_ANON_KEY,Authorization:`Bearer ${__ENV.STAGING_ANON_KEY}`,'Content-Type':'application/json'},tags:{operation:'catalog'},timeout:'10s'};
export function setup(){
 const r=http.post(`${target}/rest/v1/rpc/customer_businesses`,'{}',params);
 if(r.status!==200 || !Array.isArray(r.json()) || r.json().length===0)fail('Seed a representative synthetic catalog first; an empty database is not a capacity test');
}
export default function(){const r=http.post(`${target}/rest/v1/rpc/customer_businesses`,'{}',params);check(r,{'catalog available':r=>r.status===200});sleep(10);}
