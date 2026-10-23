const {test}=require('node:test');const assert=require('node:assert/strict');
const prod='a'.repeat(20),stage='b'.repeat(20);
const key=(ref,role='anon')=>'header.'+Buffer.from(JSON.stringify({ref,role})).toString('base64url')+'.signature';
const env=()=>({PIDEYA_ENV:'staging',PRODUCTION_SUPABASE_REF:prod,EXPECTED_SUPABASE_REF:stage,VITE_SUPABASE_URL:`https://${stage}.supabase.co`,VITE_SUPABASE_ANON_KEY:key(stage)});
test('staging validates an isolated project, rejects production and privileged keys',async()=>{
 const {validateEnvironment:v}=await import('../scripts/release/environment.mjs');
 assert.equal(v(env()).target,'staging');
 assert.throws(()=>v({...env(),EXPECTED_SUPABASE_REF:prod,VITE_SUPABASE_URL:`https://${prod}.supabase.co`,VITE_SUPABASE_ANON_KEY:key(prod)}));
 assert.throws(()=>v({...env(),VITE_SUPABASE_ANON_KEY:key(stage,'service_role')}));
 assert.throws(()=>v({...env(),VITE_SUPABASE_ANON_KEY:key(prod)}));
 assert.throws(()=>v({...env(),VITE_SUPABASE_URL:`https://${stage}.supabase.co.attacker.test`}));
 assert.throws(()=>v({...env(),PRODUCTION_SUPABASE_REF:''}));
 assert.equal(v({...env(),PIDEYA_ENV:'production',EXPECTED_SUPABASE_REF:prod,VITE_SUPABASE_URL:`https://${prod}.supabase.co`,VITE_SUPABASE_ANON_KEY:key(prod)}).target,'production');
});
