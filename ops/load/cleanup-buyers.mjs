import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {STAGING_REF,STAGING_URL,stagingCredentials} from './staging-credentials.mjs';
export async function cleanupBuyers(receiptPath,service){
 const receipt=JSON.parse(fs.readFileSync(receiptPath));
 if(receipt.ref!==STAGING_REF||!Array.isArray(receipt.users)||receipt.users.length>50)throw Error('Invalid synthetic buyer receipt');
 const request=async(id,method)=>{
  if(!/^[0-9a-f-]{36}$/.test(id))throw Error('Invalid buyer ID');
  for(let attempt=0;attempt<5;attempt++){
   try{const r=await fetch(`${STAGING_URL}/auth/v1/admin/users/${id}`,{method,headers:{apikey:service,Authorization:`Bearer ${service}`},signal:AbortSignal.timeout(12000)});
    if(r.status===404)return null;
    if(r.ok)return r.status===204?{}:await r.json();
    if(r.status<500&&r.status!==429)throw Error('Synthetic buyer cleanup rejected');
   }catch{if(attempt===4)throw Error('Synthetic buyer cleanup transport failed');}
   await delay(500*(attempt+1));
  }
  throw Error('Synthetic buyer cleanup exhausted retries');
 };
 receipt.deletedUsers??=[];
 for(const id of receipt.users){
  const found=await request(id,'GET'),user=found?.user||found;
  if(user){if(user.user_metadata?.synthetic_checkout_load!==true||!/^checkout-[0-9a-f-]+@example\.invalid$/.test(user.email))throw Error('Synthetic buyer ownership mismatch');await request(id,'DELETE');}
  if(!receipt.deletedUsers.includes(id))receipt.deletedUsers.push(id);
  fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2));
 }
 receipt.cleanedAt=new Date().toISOString();fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2));
 console.log(JSON.stringify({buyersCleanup:true,verifiedRemoved:receipt.deletedUsers.length}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const {service}=stagingCredentials();await cleanupBuyers(process.env.BUYER_RECEIPT,service);if(fs.existsSync('/private/tmp/pideya-checkout-load-sessions.json'))fs.unlinkSync('/private/tmp/pideya-checkout-load-sessions.json');}
 catch{console.log(JSON.stringify({buyersCleanup:false,message:'Review synthetic buyer receipt; private output suppressed'}));process.exitCode=1;}
}
