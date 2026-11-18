// Synthetic catalog for isolated load testing; service credentials stay in memory.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const ref='rganzksyljjerfuowodi',url=`https://${ref}.supabase.co`;
if(process.env.STAGING_URL!==url)throw Error('Staging target required');
const mode=process.argv[2],file=process.env.FIXTURE_PATH;
if(!['seed','activate','cleanup'].includes(mode)||!file)throw Error('Use seed|activate|cleanup with FIXTURE_PATH');
let output;
try{output=execFileSync('supabase',['projects','api-keys','--project-ref',ref,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:35000});}
catch(e){
 // Some CLI versions finish JSON output before a slow update check times out.
 // Never propagate child-process error objects: they contain credential stdout.
 try{JSON.parse(e.stdout);output=e.stdout;}catch{throw Error('Staging credential lookup failed; output suppressed');}
}
const keys=JSON.parse(output);
const key=keys.find(k=>k.name==='service_role')?.api_key;
if(!key)throw Error('Staging service credential unavailable');
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const ok=r=>{if(r.error)throw Error(r.error.message);return r.data;};
if(mode==='seed'){
 if(fs.existsSync(file))throw Error('Fixture receipt already exists; clean it first');
 const receipt={ref,createdAt:new Date().toISOString(),category:`QA_LOAD_${randomUUID()}`,owner:null,categoryId:null,businesses:Array.from({length:100},()=>randomUUID())};
 const save=()=>fs.writeFileSync(file,JSON.stringify(receipt,null,2));save();
 // Admin createUser does not send invitation/confirmation mail. No password or worker access is assigned.
 const user=ok(await db.auth.admin.createUser({email:`load-${randomUUID()}@example.invalid`,email_confirm:true,user_metadata:{synthetic_load_test:true}}));
 receipt.owner=user.user.id;save();
 receipt.categoryId=ok(await db.from('app_categories').insert({name:receipt.category,emoji:'QA',flow_type:'prepared',is_active:true,release_mode:'public'}).select('id').single()).id;save();
 const shops=receipt.businesses.map((id,i)=>({id,name:`QA carga ${String(i).padStart(3,'0')}`,email:`load-${id}@example.invalid`,phone:'0000000000',owner_id:receipt.owner,type:receipt.category,status:'ACTIVE',is_open:true,lat:20.7+(i%10)*0.003,lng:-102.35+Math.floor(i/10)*0.003,address:'Dirección sintética para carga',delivery_radius_km:15}));
 ok(await db.from('restaurants').insert(shops));
 ok(await db.from('restaurants').update({location_verified_at:new Date().toISOString(),location_verified_by:receipt.owner}).in('id',receipt.businesses));
 ok(await db.from('restaurants').update({status:'ACTIVE',is_open:true}).in('id',receipt.businesses));
 const items=shops.flatMap(s=>Array.from({length:30},(_,i)=>({id:randomUUID(),restaurant_id:s.id,name:`Producto sintético ${i}`,description:'Fixture de carga sin venta real.',price:100+i,available:true,category:'QA',sort_order:i})));
 for(let i=0;i<items.length;i+=300)ok(await db.from('menu_items').insert(items.slice(i,i+300)));
 console.log(JSON.stringify({seeded:true,businesses:shops.length,menuItems:items.length,ordersCreated:0,emailsSent:0}));
}else{
 const r=JSON.parse(fs.readFileSync(file,'utf8'));
 if(r.ref!==ref||!r.category.startsWith('QA_LOAD_')||r.businesses.length!==100)throw Error('Invalid fixture receipt');
 // Since 068 the e-mail lives in restaurant_private; older databases still have it in restaurants.
 const existing=ok(await db.from('restaurants').select('id,email,owner_id,type,restaurant_private(email)').in('id',r.businesses));
 const mail=b=>(Array.isArray(b.restaurant_private)?b.restaurant_private[0]?.email:b.restaurant_private?.email)??b.email;
 if(existing.some(b=>b.owner_id!==r.owner||b.type!==r.category||mail(b)!==`load-${b.id}@example.invalid`))throw Error('Fixture ownership mismatch');
 if(mode==='activate'){
  ok(await db.from('restaurants').update({location_verified_at:new Date().toISOString(),location_verified_by:r.owner}).in('id',r.businesses));
  ok(await db.from('restaurants').update({status:'ACTIVE',is_open:true}).in('id',r.businesses));
  console.log(JSON.stringify({activated:true,businesses:existing.length}));process.exit(0);
 }
 ok(await db.from('menu_items').delete().in('restaurant_id',r.businesses));
 ok(await db.from('restaurants').delete().in('id',r.businesses));
 if(r.categoryId)ok(await db.from('app_categories').delete().eq('id',r.categoryId).eq('name',r.category));
 if(r.owner){
  const owner=ok(await db.auth.admin.getUserById(r.owner)).user;
  if(!/^load-[0-9a-f-]+@example\.invalid$/.test(owner.email)||owner.user_metadata?.synthetic_load_test!==true)throw Error('Synthetic owner verification failed');
  ok(await db.auth.admin.deleteUser(r.owner));
 }
 const remaining=ok(await db.from('restaurants').select('id').in('id',r.businesses));
 if(remaining.length)throw Error('Fixture cleanup incomplete');
 r.cleanedAt=new Date().toISOString();fs.writeFileSync(file,JSON.stringify(r,null,2));
 console.log(JSON.stringify({cleaned:true,businessesRemoved:existing.length,syntheticOwnerRemoved:!!r.owner}));
}
