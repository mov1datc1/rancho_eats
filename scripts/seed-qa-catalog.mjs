import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { catalog } from './qa-catalog-data.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uid=(key)=>{const h=createHash('sha256').update('pideya-qa-catalog-20261021:'+key).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const plan=catalog.map(b=>({id:uid(b.slug),name:b.name,products:b.items.length,options:b.items.reduce((n,i)=>n+(i.options?.length||0),0)}));
if(!process.argv.includes('--apply')) {console.log(JSON.stringify({mode:'dry-run',businesses:plan},null,2));process.exit(0);}
const {SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,QA_OWNER_SOURCE_ID}=process.env;
if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY||!QA_OWNER_SOURCE_ID)throw Error('Missing server credentials or QA_OWNER_SOURCE_ID. Never put service credentials in EXPO_PUBLIC/VITE.');
const s=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const check=({data,error})=>{if(error)throw Error(error.message);return data;};
const owner=check(await s.from('restaurants').select('owner_id,lat,lng').eq('id',QA_OWNER_SOURCE_ID).single());
if(!owner.owner_id||!Number.isFinite(owner.lat)||!Number.isFinite(owner.lng))throw Error('Source business needs owner and coordinates');
check(await s.from('menu_item_options').select('option_type').limit(1));
// Refuse to overwrite unrelated records, even if a deterministic ID collides.
for(const b of catalog) {const r=check(await s.from('restaurants').select('id,email').eq('id',uid(b.slug)).maybeSingle());if(r&&r.email!==`${b.slug}@qa.pideya.invalid`)throw Error('ID collision');}
const photos={};
for(const name of [...new Set(catalog.flatMap(b=>[b.image,...b.items.map(i=>i.image)]).filter(Boolean))]) {
 const bytes=fs.readFileSync(path.join(root,'public/qa-catalog',name+'.jpg'));
 const hash=createHash('sha256').update(bytes).digest('hex').slice(0,12);
 const file=`qa-catalog/2026-10/${name}-${hash}.jpg`;
 check(await s.storage.from('menu-images').upload(file,bytes,{contentType:'image/jpeg',upsert:true,cacheControl:'31536000'}));
 photos[name]=s.storage.from('menu-images').getPublicUrl(file).data.publicUrl;
}
for(const [index,b] of catalog.entries()) {
 const id=uid(b.slug);
 const restaurant={id,name:b.name,email:`${b.slug}@qa.pideya.invalid`,phone:'0000000000',description:b.description,type:b.type,owner_id:owner.owner_id,lat:owner.lat+index*.001,lng:owner.lng+index*.001,address:'Zona de pruebas · Arandas, Jalisco',zones:['Arandas'],delivery_radius_km:15,open_time:'00:00',close_time:'23:59',is_open:true,status:'ACTIVE',photo_url:photos[b.image],cover_url:photos[b.image]};
 check(await s.from('restaurants').upsert(restaurant,{onConflict:'id'}));
 for(const [j,item] of b.items.entries()) {
  const itemId=uid(b.slug+':'+j);
  check(await s.from('menu_items').upsert({id:itemId,restaurant_id:id,name:item.name,description:item.description,category:item.category,price:item.price,photo_url_1:item.image?photos[item.image]:null,available:false,sort_order:j,sell_by_weight:false,unit_type:'unit',min_quantity:1,step_quantity:1,allow_substitution:item.substitution??false},{onConflict:'id'}));
  if(item.options?.length)check(await s.from('menu_item_options').upsert(item.options.map(([label,price,option_type],k)=>({id:uid(b.slug+':'+j+':'+k),menu_item_id:itemId,label,price,option_type,sort_order:k,available:true})),{onConflict:'id'}));
  check(await s.from('menu_items').update({available:true}).eq('id',itemId).select('id').single());
 }
 console.log(`Ready: ${b.name}, ${b.items.length} products`);
}
const result=check(await s.from('restaurants').select('id,name,type,menu_items(id,name,price,menu_item_options(id,option_type,price))').in('id',plan.map(b=>b.id)));
fs.mkdirSync(path.join(root,'docs'),{recursive:true});
fs.writeFileSync(path.join(root,'docs/QA_CATALOG_RESULT.json'),JSON.stringify({createdAt:new Date().toISOString(),businesses:result},null,2));
console.log('Verified '+result.length+' businesses. No orders created and no push sent by this script.');
