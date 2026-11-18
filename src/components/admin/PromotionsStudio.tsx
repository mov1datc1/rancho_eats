import ConsoleTable from './ConsoleTable';
import {useEffect,useState} from 'react';
import {supabase} from '../../lib/supabase';

// Advertising v1 (migration 064): offers, featured placements and the marketing charges ledger.
const money=(n:unknown)=>Number(n||0).toLocaleString('es-MX',{style:'currency',currency:'MXN'});
const cdmx=(iso:string)=>new Date(iso).toLocaleString('es-MX',{timeZone:'America/Mexico_City',dateStyle:'medium',timeStyle:'short'});
const toIso=(local:string)=>new Date(local+':00-06:00').toISOString();
const DAYS=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const AUDIENCE:Record<string,string>={all:'Todos',new:'Primera compra',lapsed:'Clientes que regresan'};
const STATE:Record<string,string>={active:'Activa',paused:'Pausada',cancelled:'Cancelada',pending:'Pendiente',paid:'Pagado'};
const SOURCE:Record<string,string>={offer:'Oferta',placement:'Destacado',campaign:'Campaña push'};

export default function PromotionsStudio(){
 const [shops,setShops]=useState<any[]>([]),[data,setData]=useState<any>({offers:[],placements:[],charges:[]}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 // Offer form
 const [oShop,setOShop]=useState(''),[oTitle,setOTitle]=useState(''),[kind,setKind]=useState('percent'),[value,setValue]=useState(15),[maxDiscount,setMaxDiscount]=useState(''),[minSubtotal,setMinSubtotal]=useState(150),
  [audience,setAudience]=useState('all'),[lapsedDays,setLapsedDays]=useState(30),[funded,setFunded]=useState('business'),[oStart,setOStart]=useState(''),[oEnd,setOEnd]=useState(''),[days,setDays]=useState<number[]>([0,1,2,3,4,5,6]),
  [hFrom,setHFrom]=useState(''),[hTo,setHTo]=useState(''),[perUser,setPerUser]=useState(1),[maxRedemptions,setMaxRedemptions]=useState(''),[budget,setBudget]=useState(''),[oFee,setOFee]=useState(0);
 // Placement form
 const [pShop,setPShop]=useState(''),[pLabel,setPLabel]=useState('Destacado'),[pStart,setPStart]=useState(''),[pEnd,setPEnd]=useState(''),[pPriority,setPPriority]=useState(0),[pPrice,setPPrice]=useState(0);
 const load=async()=>{const r=await supabase.rpc('admin_marketing_overview');if(r.error)setError(r.error.message);else setData(r.data??{offers:[],placements:[],charges:[]});};
 useEffect(()=>{void load();void supabase.from('restaurants').select('id,name').eq('status','ACTIVE').order('name').then(r=>{if(r.error)setError(r.error.message);else setShops(r.data??[]);});},[]);
 const run=async(fn:()=>Promise<any>,ok:string)=>{setBusy(true);setError('');setMessage('');try{const r=await fn();if(r?.error)throw r.error;setMessage(ok);await load();}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 const saveOffer=()=>run(async()=>{
  if(!oStart||!oEnd)throw Error('Selecciona inicio y fin de la oferta.');
  if(funded==='business'&&!oShop)throw Error('Una oferta pagada por el negocio necesita un negocio.');
  if((hFrom&&!hTo)||(!hFrom&&hTo))throw Error('Indica las dos horas del horario o deja ambas vacías.');
  const r=await supabase.rpc('admin_save_offer',{p:{restaurant_id:oShop||null,title:oTitle,kind,value,max_discount:maxDiscount||null,min_subtotal:minSubtotal,audience,lapsed_days:lapsedDays,funded_by:funded,
   starts_at:toIso(oStart),ends_at:toIso(oEnd),days_of_week:days,start_time:hFrom||null,end_time:hTo||null,per_user_limit:perUser,max_redemptions:maxRedemptions||null,budget:budget||null,fee:oShop?oFee:0}});
  if(!r.error){setOTitle('');}return r;
 },'Oferta creada. Se muestra en la app y se valida en el servidor al pagar.');
 const savePlacement=()=>run(async()=>{
  if(!pShop||!pStart||!pEnd)throw Error('Selecciona negocio, inicio y fin.');
  return supabase.rpc('admin_save_placement',{p_restaurant:pShop,p_label:pLabel,p_starts:toIso(pStart),p_ends:toIso(pEnd),p_priority:pPriority,p_price:pPrice});
 },'Destacado programado.');
 const pending=data.charges.filter((c:any)=>c.state==='pending').reduce((s:number,c:any)=>s+Number(c.amount),0);
 return <>
 <article className="admin-card console-card"><div className="console-heading"><div><span className="eyebrow">CRECIMIENTO / OFERTAS</span><h3>Ofertas que se aplican al pagar</h3><p>Descuento en porcentaje o monto fijo, para todos, primera compra o clientes que regresan. El servidor valida la oferta en cada pedido: vigencia, día y hora, límite por cliente, cupo y presupuesto.</p></div><span className="state-pill">Horario CDMX</span></div>
  <div className="console-filters">
   <label>Negocio<select value={oShop} onChange={e=>{setOShop(e.target.value);if(!e.target.value)setFunded('platform');}}><option value="">PideYa · todos los negocios</option>{shops.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <label>Lo paga<select value={funded} onChange={e=>setFunded(e.target.value)}><option value="business" disabled={!oShop}>El negocio (recibe menos)</option><option value="platform">PideYa</option></select></label>
   <label>Audiencia<select value={audience} onChange={e=>setAudience(e.target.value)}><option value="all">Todos</option><option value="new">Primera compra</option><option value="lapsed">Clientes que regresan</option></select></label>
   {audience==='lapsed'&&<label>Días sin comprar<input type="number" min={7} max={365} value={lapsedDays} onChange={e=>setLapsedDays(Number(e.target.value))}/></label>}
  </div>
  <label className="console-field">Nombre visible<input value={oTitle} maxLength={60} onChange={e=>setOTitle(e.target.value)} placeholder="Martes de tacos"/></label>
  <div className="console-filters">
   <label>Tipo<select value={kind} onChange={e=>setKind(e.target.value)}><option value="percent">Porcentaje</option><option value="amount">Monto fijo MXN</option></select></label>
   <label>{kind==='percent'?'Porcentaje (máx. 90)':'Monto MXN'}<input type="number" min={1} max={kind==='percent'?90:100000} value={value} onChange={e=>setValue(Number(e.target.value))}/></label>
   {kind==='percent'&&<label>Tope de descuento MXN<input type="number" min={1} value={maxDiscount} onChange={e=>setMaxDiscount(e.target.value)} placeholder="Sin tope"/></label>}
   <label>Compra mínima MXN<input type="number" min={0} value={minSubtotal} onChange={e=>setMinSubtotal(Number(e.target.value))}/></label>
  </div>
  <div className="console-filters">
   <label>Inicio<input type="datetime-local" value={oStart} onChange={e=>setOStart(e.target.value)}/></label>
   <label>Fin<input type="datetime-local" value={oEnd} onChange={e=>setOEnd(e.target.value)}/></label>
   <label>Desde (opcional)<input type="time" value={hFrom} onChange={e=>setHFrom(e.target.value)}/></label>
   <label>Hasta<input type="time" value={hTo} onChange={e=>setHTo(e.target.value)}/></label>
  </div>
  <div className="console-filters" role="group" aria-label="Días de la semana">{DAYS.map((d,i)=><label key={d}><input type="checkbox" checked={days.includes(i)} onChange={e=>setDays(e.target.checked?[...days,i].sort():days.filter(x=>x!==i))}/>{d}</label>)}</div>
  <div className="console-filters">
   <label>Usos por cliente<input type="number" min={1} max={100} value={perUser} onChange={e=>setPerUser(Number(e.target.value))}/></label>
   <label>Cupo total de pedidos<input type="number" min={1} value={maxRedemptions} onChange={e=>setMaxRedemptions(e.target.value)} placeholder="Sin cupo"/></label>
   <label>Presupuesto de descuento MXN<input type="number" min={1} value={budget} onChange={e=>setBudget(e.target.value)} placeholder="Sin tope"/></label>
   {oShop&&<label>Cobro de PideYa al negocio MXN<input type="number" min={0} value={oFee} onChange={e=>setOFee(Number(e.target.value))}/><small>Genera un cargo pendiente.</small></label>}
  </div>
  <p className="console-note">v1: solo negocios de comida preparada (no tiendas con surtido). El cliente ve la oferta en el inicio y en el negocio; el descuento aparece en «Terminar y pagar». Requiere la versión de la app con ofertas.</p>
  <button className="btn" disabled={busy||oTitle.trim().length<3||!days.length} onClick={()=>void saveOffer()}>{busy?'Guardando…':'Crear oferta'}</button>
  {error&&<p role="alert" className="console-error">{error}</p>}{message&&<p role="status">{message}</p>}
 </article>

 <article className="admin-card console-card"><div className="console-toolbar"><h3>Ofertas y resultados</h3><button className="btn ghost" disabled={busy} onClick={()=>void load()}>Actualizar</button></div>
  <ConsoleTable><table><thead><tr><th>Oferta</th><th>Descuento</th><th>Vigencia CDMX</th><th>Audiencia</th><th>Estado</th><th>Usos</th><th>Descuento dado</th><th>Ventas entregadas</th><th>Acción</th></tr></thead><tbody>
   {data.offers.map((o:any)=><tr key={o.id}><td><strong>{o.title}</strong><small>{o.business||'PideYa'} · lo paga {o.funded_by==='business'?'el negocio':'PideYa'}</small></td>
    <td>{o.kind==='percent'?`${Number(o.value)}%`:money(o.value)}{o.max_discount?<small>tope {money(o.max_discount)}</small>:null}<small>mín. {money(o.min_subtotal)}</small></td>
    <td>{cdmx(o.starts_at)}<small>a {cdmx(o.ends_at)}</small>{o.start_time&&<small>{o.start_time.slice(0,5)}–{o.end_time.slice(0,5)}</small>}<small>{(o.days_of_week as number[]).length===7?'Todos los días':(o.days_of_week as number[]).map(d=>DAYS[d]).join(' ')}</small></td>
    <td>{AUDIENCE[o.audience]}</td><td><span className="state-pill">{STATE[o.state]}</span></td><td>{o.redemptions}{o.max_redemptions?` / ${o.max_redemptions}`:''}</td><td>{money(o.discount_given)}{o.budget?<small>de {money(o.budget)}</small>:null}</td><td>{money(o.delivered_sales)}</td>
    <td>{o.state==='active'&&<button className="btn ghost" disabled={busy} onClick={()=>void run(()=>supabase.rpc('admin_set_offer_state',{p_id:o.id,p_state:'paused'}) as any,'Oferta pausada.')}>Pausar</button>}
     {o.state==='paused'&&<button className="btn ghost" disabled={busy} onClick={()=>void run(()=>supabase.rpc('admin_set_offer_state',{p_id:o.id,p_state:'active'}) as any,'Oferta reactivada.')}>Reactivar</button>}
     {o.state!=='cancelled'&&<button className="btn ghost" disabled={busy} onClick={()=>{if(confirm('¿Cancelar la oferta? Su cargo pendiente también se cancela.'))void run(()=>supabase.rpc('admin_set_offer_state',{p_id:o.id,p_state:'cancelled'}) as any,'Oferta cancelada.');}}>Cancelar</button>}</td></tr>)}
  </tbody></table>{!data.offers.length&&<div className="console-empty">Aún no hay ofertas.</div>}</ConsoleTable>
 </article>

 <article className="admin-card console-card"><div className="console-heading"><div><span className="eyebrow">CRECIMIENTO / DESTACADOS</span><h3>Negocios destacados en el inicio</h3><p>El negocio aparece primero en el carrusel del inicio, con su etiqueta, durante las fechas contratadas (solo si está abierto y dentro de la cobertura del cliente).</p></div></div>
  <div className="console-filters">
   <label>Negocio<select value={pShop} onChange={e=>setPShop(e.target.value)}><option value="">Selecciona</option>{shops.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <label>Etiqueta<input value={pLabel} maxLength={30} onChange={e=>setPLabel(e.target.value)}/></label>
   <label>Inicio<input type="datetime-local" value={pStart} onChange={e=>setPStart(e.target.value)}/></label>
   <label>Fin<input type="datetime-local" value={pEnd} onChange={e=>setPEnd(e.target.value)}/></label>
   <label>Prioridad (0–100)<input type="number" min={0} max={100} value={pPriority} onChange={e=>setPPriority(Number(e.target.value))}/></label>
   <label>Precio MXN<input type="number" min={0} value={pPrice} onChange={e=>setPPrice(Number(e.target.value))}/><small>Genera un cargo pendiente.</small></label>
  </div>
  <button className="btn" disabled={busy||!pShop} onClick={()=>void savePlacement()}>{busy?'Guardando…':'Programar destacado'}</button>
  <ConsoleTable><table><thead><tr><th>Negocio</th><th>Etiqueta</th><th>Vigencia CDMX</th><th>Prioridad</th><th>Precio</th><th>Estado</th><th>Acción</th></tr></thead><tbody>
   {data.placements.map((p:any)=><tr key={p.id}><td>{p.business}</td><td>{p.label}</td><td>{cdmx(p.starts_at)}<small>a {cdmx(p.ends_at)}</small></td><td>{p.priority}</td><td>{money(p.price)}</td><td><span className="state-pill">{p.state==='active'?(new Date(p.ends_at)<new Date()?'Terminado':'Activo'):'Cancelado'}</span></td>
    <td>{p.state==='active'&&new Date(p.ends_at)>new Date()&&<button className="btn ghost" disabled={busy} onClick={()=>{if(confirm('¿Cancelar el destacado y su cargo pendiente?'))void run(()=>supabase.rpc('admin_cancel_placement',{p_id:p.id}) as any,'Destacado cancelado.');}}>Cancelar</button>}</td></tr>)}
  </tbody></table>{!data.placements.length&&<div className="console-empty">Aún no hay destacados.</div>}</ConsoleTable>
 </article>

 <article className="admin-card console-card"><div className="console-toolbar"><h3>Cobros de publicidad · pendiente {money(pending)}</h3><button className="btn ghost" disabled={busy} onClick={()=>void load()}>Actualizar</button></div>
  <p>Se generan al crear ofertas o destacados con precio y campañas push patrocinadas. Cancelar el servicio cancela el cargo pendiente. Marca como pagado al recibir el dinero.</p>
  <ConsoleTable><table><thead><tr><th>Negocio</th><th>Concepto</th><th>Monto</th><th>Fecha</th><th>Estado</th><th>Acción</th></tr></thead><tbody>
   {data.charges.map((c:any)=><tr key={c.id}><td>{c.business}</td><td>{SOURCE[c.source]}<small>{c.description}</small></td><td>{money(c.amount)}</td><td>{c.due_on}</td><td><span className="state-pill">{STATE[c.state]}</span>{c.paid_reference&&<small>{c.paid_reference}</small>}</td>
    <td>{c.state==='pending'&&<button className="btn ghost" disabled={busy} onClick={()=>{const ref=prompt('Referencia del pago (transferencia, recibo, etc.)');if(ref)void run(()=>supabase.rpc('admin_mark_charge_paid',{p_id:c.id,p_reference:ref}) as any,'Cobro registrado.');}}>Marcar pagado</button>}</td></tr>)}
  </tbody></table>{!data.charges.length&&<div className="console-empty">Sin cobros de publicidad.</div>}</ConsoleTable>
 </article></>;
}
