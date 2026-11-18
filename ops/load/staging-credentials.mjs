import {execFileSync} from 'node:child_process';
export const STAGING_REF='rganzksyljjerfuowodi';
export const STAGING_URL=`https://${STAGING_REF}.supabase.co`;
export function stagingCredentials(){
 if(process.env.STAGING_URL!==STAGING_URL)throw Error('Explicit isolated staging target required');
 let output;
 try{output=execFileSync('supabase',['projects','api-keys','--project-ref',STAGING_REF,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:35000});}
 catch(e){try{JSON.parse(e.stdout);output=e.stdout;}catch{throw Error('Staging credential lookup failed; private output suppressed');}}
 const keys=JSON.parse(output),service=keys.find(k=>k.name==='service_role')?.api_key,anon=keys.find(k=>k.name==='anon')?.api_key;
 if(!service||!anon)throw Error('Staging credentials unavailable');
 for(const [token,role] of [[service,'service_role'],[anon,'anon']]){
  let c;try{c=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));}catch{throw Error('Unsupported credential format');}
  if(c.ref!==STAGING_REF||c.role!==role)throw Error('Credential project/role mismatch');
 }
 return {service,anon};
}
