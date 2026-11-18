const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const target='https://rganzksyljjerfuowodi.supabase.co',ref='rganzksyljjerfuowodi';
const jwt=c=>'header.'+Buffer.from(JSON.stringify(c)).toString('base64url')+'.signature';
const source=fs.readFileSync('ops/load/checkout.js','utf8').replace(/^import .+$/gm,'').replace(/\bexport /g,'')+'\n;options';
function config({env={},claims={}}={}){
 const sessions=Array.from({length:50},(_,i)=>({id:`synthetic-${i}`,token:jwt({iss:target+'/auth/v1',role:'authenticated',sub:`synthetic-${i}`,...claims})}));
 const fixture={ref,anon:jwt({ref,role:'anon'}),sessions};
 return vm.runInNewContext(source,{__ENV:{STAGING_URL:target,LOAD_SESSIONS_FILE:'/private/tmp/fake.json',...env},open:()=>JSON.stringify(fixture),SharedArray:class{constructor(_name,build){return build();}},Rate:class{},Counter:class{},encoding:{b64decode:s=>Buffer.from(s,'base64url').toString()}});
}
test('buyer sessions use exact staging issuer and authenticated identity, not legacy API-key ref claim',()=>{
 assert.equal(config().scenarios.buyers.vus,5);
 assert.throws(()=>config({claims:{iss:'https://apnxrbuqwgnfuelqjjfy.supabase.co/auth/v1'}}),/Authenticated staging/);
 assert.throws(()=>config({claims:{role:'service_role'}}),/Authenticated staging/);
 assert.throws(()=>config({claims:{sub:'different'}}),/Authenticated staging/);
 assert.throws(()=>config({env:{STAGING_URL:'https://apnxrbuqwgnfuelqjjfy.supabase.co'}}),/Isolated staging/);
});
test('mixed load caps buyers and readers and requires exact completed order counts',()=>{
 const c=config({env:{CHECKOUT_PROFILE:'mixed'}});
 assert.equal(c.scenarios.buyers.vus,50);assert.equal(c.scenarios.buyers.iterations,1);
 assert.equal(Math.max(...c.scenarios.menus.stages.map(s=>s.target)),100);
 assert.equal(c.thresholds.orders_created[0],'count==50');assert.equal(c.thresholds.orders_cancelled[0],'count==50');
 assert.equal(c.thresholds.invalid_response[0].abortOnFail,true);
});
