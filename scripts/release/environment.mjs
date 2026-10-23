import {pathToFileURL} from 'node:url';
export function validateEnvironment(env) {
  const target=env.PIDEYA_ENV;
  if (!['staging','production'].includes(target)) throw new Error('PIDEYA_ENV must be staging or production');
  const url=new URL(env.VITE_SUPABASE_URL || env.SUPABASE_URL || '');
  const production=env.PRODUCTION_SUPABASE_REF;
  const expected=env.EXPECTED_SUPABASE_REF;
  if (!production || !expected || !/^[a-z0-9]{20}$/.test(production) || !/^[a-z0-9]{20}$/.test(expected)) throw new Error('Explicit project references required');
  if (url.protocol!=='https:' || url.hostname!==`${expected}.supabase.co` || url.username || url.password || url.port || url.pathname!=='/' || url.search || url.hash) throw new Error('Unexpected Supabase endpoint');
  if ((target==='staging' && expected===production) || (target==='production' && expected!==production)) throw new Error('Environment isolation violation');
  if (!env.VITE_SUPABASE_ANON_KEY) throw new Error('Public API key required');
  const key=env.VITE_SUPABASE_ANON_KEY;
  if (!key.startsWith('sb_publishable_')) {
    let payload; try {payload=JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());} catch {throw new Error('Invalid public API key');}
    if(payload.role!=='anon' || payload.ref!==expected) throw new Error('API key belongs to a different project or privileged role');
  }
  return {target,project:expected};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {validateEnvironment(process.env);console.log('Environment isolation validated');}
  catch(error){console.error(error.message);process.exitCode=1;}
}
