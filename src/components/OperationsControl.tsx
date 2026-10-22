import {useEffect,useState} from 'react';
import {supabase} from '../lib/supabase';
export default function OperationsControl({restaurantId}:{restaurantId?:string}){
 const [incidents,setIncidents]=useState<any[]>([]),[cycles,setCycles]=useState<any[]>([]),[categories,setCategories]=useState<any[]>([]),[businesses,setBusinesses]=useState<any[]>([]);
 const [error,setError]=useState(''),[note,setNote]=useState(''),[cash,setCash]=useState(''),[goods,setGoods]=useState(false),[busy,setBusy]=useState(false),[category,setCategory]=useState(''),[business,setBusiness]=useState(''),[email,setEmail]=useState('');
 const load=async()=>{try{
  let iq=supabase.from('order_incidents').select('*,orders!inner(restaurant_id,order_number)').order('created_at',{ascending:false}).limit(100);
  let cq=supabase.from('delivery_cycles').select('*,orders(order_number)').is('closed_at',null).order('started_at').limit(100);
  if(restaurantId){iq=iq.eq('orders.restaurant_id',restaurantId);cq=cq.eq('restaurant_id',restaurantId);}
  const [i,c]=await Promise.all([iq,cq]);if(i.error)throw i.error;if(c.error)throw c.error;setIncidents(i.data??[]);setCycles(c.data??[]);
  if(!restaurantId){const [cats,shops]=await Promise.all([supabase.from('app_categories').select('*').order('sort_order'),supabase.from('restaurants').select('id,name,type').order('name')]);if(cats.error)throw cats.error;if(shops.error)throw shops.error;setCategories(cats.data??[]);setBusinesses(shops.data??[]);}
  setError('');
 }catch(e:any){setError(e.message);}};
 useEffect(()=>{void load();},[restaurantId]);
 const act=async(name:string,args:Record<string,unknown>)=>{setBusy(true);try{const r=await supabase.rpc(name,args);if(r.error)throw r.error;await load();}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 return <article className="admin-card"><h4>Incidencias y liquidaciones</h4><button className="btn ghost" disabled={busy} onClick={()=>void load()}>Actualizar</button>{!!error&&<p role="alert">{error}</p>}
 <label>Acción o resolución<textarea className="fi" value={note} onChange={e=>setNote(e.target.value)} placeholder="Qué se comprobó, quién recibió y qué se resolvió"/></label>
 <p>Últimas 100 incidencias; resolver el expediente no cancela el pedido ni perdona un saldo.</p>
 {incidents.map(i=><div className="admin-restaurant-row" key={i.id}><div><strong>#{i.orders.order_number} · {i.cause} · {i.status}</strong><p>{i.description}</p><p>{i.resolution}</p></div>{i.status!=='RESOLVED'&&<div>{['IN_PROGRESS','WAITING_RETURN','RESOLVED'].map((s,n)=><button className="btn ghost" disabled={busy||note.trim().length<5} key={s} onClick={()=>void act('manage_order_incident',{p_id:i.id,p_status:s,p_note:note})}>{['Atender','Esperar retorno','Resolver'][n]}</button>)}</div>}</div>)}
 <h4>Recepción de efectivo y mercancía</h4><label>Efectivo realmente recibido<input className="fi" inputMode="decimal" value={cash} onChange={e=>setCash(e.target.value)}/></label><label><input type="checkbox" checked={goods} onChange={e=>setGoods(e.target.checked)}/> Recibí la mercancía no entregada</label>
 {cycles.map(c=><div className="admin-restaurant-row" key={c.id}><span>#{c.orders?.order_number} · {c.state} · cobrado reportado: {c.cash_collected??'Sin entrega confirmada'}</span><button className="btn" disabled={busy||!cash.trim()||note.trim().length<5||c.state==='OUT'} onClick={()=>void act('merchant_settle_cycle',{p_id:c.id,p_cash:Number(cash.replace(',','.')),p_note:note,p_returned_goods:goods})}>Confirmar recepción</button></div>)}
 {!restaurantId&&<><h4>Lanzamiento de categorías</h4><p>Cerrada bloquea compras nuevas. Piloto solo permite compradores y negocios autorizados; no interrumpe pedidos existentes.</p>
 {categories.map(c=><div key={c.id} className="admin-restaurant-row"><span>{c.name}</span><select className="fi" value={!c.is_active?'closed':c.release_mode} disabled={busy} onChange={async e=>{setBusy(true);try{const r=await supabase.from('app_categories').update({release_mode:e.target.value,is_active:e.target.value!=='closed'}).eq('id',c.id);if(r.error)throw r.error;await load();}catch(err:any){setError(err.message);}finally{setBusy(false);}}}><option value="closed">Cerrada</option><option value="pilot">Piloto</option><option value="public">Pública</option></select></div>)}
 <h4>Autorizar comprador de prueba</h4><select className="fi" value={category} onChange={e=>{setCategory(e.target.value);setBusiness('');}}><option value="">Selecciona categoría</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
 <select className="fi" value={business} onChange={e=>setBusiness(e.target.value)}><option value="">Selecciona negocio</option>{businesses.filter(b=>b.type===categories.find(c=>c.id===category)?.name).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>
 <input className="fi" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Correo de su cuenta de cliente"/>
 {[true,false].map(enabled=><button key={String(enabled)} className="btn ghost" disabled={busy||!category||!business||!email.trim()} onClick={()=>void act('admin_pilot_member',{p_category:category,p_restaurant:business,p_email:email,p_enabled:enabled})}>{enabled?'Autorizar prueba':'Retirar autorización'}</button>)}</>}
 </article>;
}
