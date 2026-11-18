const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('ops/load/browse.js','utf8').replace(/^import .+$/gm,'').replace('export default function','function journey').replace(/\bexport /g,'')+'\n;options';
const jwt=claims=>'header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature';
function options(env={}){
 const context={__ENV:{STAGING_URL:'https://rganzksyljjerfuowodi.supabase.co',STAGING_ANON_KEY:jwt({ref:'rganzksyljjerfuowodi',role:'anon'}),...env},
  Rate:class {},require:name=>{assert.equal(name,'k6/encoding');return {b64decode:s=>Buffer.from(s,'base64url').toString()};}};
 return vm.runInNewContext(source,context);
}
test('load generator refuses production, absent keys, privileged keys and other projects before setup',()=>{
 assert.throws(()=>options({STAGING_URL:'https://apnxrbuqwgnfuelqjjfy.supabase.co'}),/isolated staging/);
 assert.throws(()=>options({STAGING_ANON_KEY:''}),/public key/);
 assert.throws(()=>options({STAGING_ANON_KEY:jwt({ref:'rganzksyljjerfuowodi',role:'service_role'})}),/anon key/);
 assert.throws(()=>options({STAGING_ANON_KEY:jwt({ref:'other',role:'anon'})}),/anon key/);
 assert.throws(()=>options({LOAD_PROFILE:'unbounded'}),/Unknown load profile/);
 assert.throws(()=>options({STAGING_HOST_IP:'127.0.0.1'}),/Unreviewed DNS/);
});
test('load is bounded and automatically stops on HTTP or content failures',()=>{
 const small=options(),large=options({LOAD_PROFILE:'ramp'});
 assert.equal(Math.max(...small.scenarios.browse.stages.map(s=>s.target)),5);
 assert.equal(Math.max(...large.scenarios.browse.stages.map(s=>s.target)),100);
 assert.equal(large.thresholds.http_req_failed[0].abortOnFail,true);
 assert.equal(large.thresholds.invalid_response[0].abortOnFail,true);
 assert.equal(large.dns.policy,'onlyIPv4');
 assert.notEqual(large.insecureSkipTLSVerify,true);
});
