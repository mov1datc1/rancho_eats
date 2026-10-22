import {useEffect,useMemo,useState} from 'react';
import {statusLabel} from '../lib/utils';
import {supabase} from '../lib/supabase';
import {operationalAlerts} from '../lib/deliveryOperations';
import type {OperationalOrder} from '../lib/deliveryOperations';
type Business={id:string;name:string;type:string};
export default function DeliveryOperations({restaurantId}:{restaurantId?:string}){
 const [serverMetrics,setServerMetrics]=useState<any>(null),[metricsError,setMetricsError]=useState('');
 const [businesses,setBusinesses]=useState<Business[]>([]),[orders,setOrders]=useState<OperationalOrder[]>([]);
 const [business,setBusiness]=useState(''),[category,setCategory]=useState(''),[status,setStatus]=useState('');
 const [days,setDays]=useState('7'),[alertsOnly,setAlertsOnly]=useState(false),[page,setPage]=useState(0);
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[sampledAt,setSampledAt]=useState(0),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let disposed=false;setLoading(true);setError('');setSampledAt(0);setOrders([]);setPage(0);
  (async()=>{
   const directory:Business[]=[];
   for(let offset=0;;offset+=500){
    let q=supabase.from('restaurants').select('id,name,type').order('id').range(offset,offset+499);
    if(restaurantId)q=q.eq('id',restaurantId);
    const {data,error}=await q;if(error)throw error;if(disposed)return;
    directory.push(...(data??[]));if((data?.length??0)<500)break;
   }
   const rows:OperationalOrder[]=[];
   const cutoff=new Date(Date.now()-Number(days)*86400000).toISOString();
   for(let offset=0;offset<5000;offset+=500){
    let q=supabase.from('orders').select('id,restaurant_id,order_number,status,created_at,delivery_started_at,delivered_at,driver_location_updated_at,rejection_reason')
    .gte('created_at',cutoff).order('created_at',{ascending:false}).order('id').range(offset,offset+499);
    if(restaurantId||business)q=q.eq('restaurant_id',restaurantId||business);
    if(category)q=q.in('restaurant_id',directory.filter(b=>b.type===category).map(b=>b.id));
    if(status)q=q.eq('status',status);
    const {data,error}=await q;if(error)throw error;if(disposed)return;
    rows.push(...(data??[]));if((data?.length??0)<500)break;
   }
   if(!disposed){setBusinesses(directory);setOrders(rows);setSampledAt(Date.now());}
  })().catch(e=>{if(!disposed)setError(e.message||'Error al consultar operación.');}).finally(()=>{if(!disposed)setLoading(false);});
  return()=>{disposed=true;};
 },[restaurantId,days,refresh,business,category,status]);
 useEffect(()=>{let alive=true;setServerMetrics(null);setMetricsError('');
 void supabase.rpc('operations_metrics',{p_days:Number(days),p_restaurant:restaurantId||business||null,p_category:category||null,p_status:status||null}).then(({data,error})=>{if(!alive)return;if(error)setMetricsError(error.message);else setServerMetrics(data);});
 return()=>{alive=false;};
 },[restaurantId,days,business,category,status,refresh]);
 const byId=useMemo(()=>new Map(businesses.map(b=>[b.id,b])),[businesses]);
 const filtered=orders.filter(o=>(!business||o.restaurant_id===business)&&(!category||byId.get(o.restaurant_id)?.type===category)&&(!status||o.status===status));
 const visible=alertsOnly?filtered.filter(o=>operationalAlerts(o,sampledAt).length):filtered;
 const filter=(label:string,value:string,set:(v:string)=>void,options:{value:string;label:string}[])=><label>{label}<select className="fi" value={value} onChange={e=>{set(e.target.value);setPage(0);}}><option value="">Todos</option>{options.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></label>;
 return <article className="admin-card"><h4>Operación de entregas {restaurantId?'del negocio':'de PideYa'}</h4>
 <p>Pedidos creados en el período. Las alertas indican revisión; no confirman abandono ni la causa de una desconexión.</p>
 <div className="frow" style={{flexWrap:'wrap'}}><label>Período<select className="fi" value={days} onChange={e=>setDays(e.target.value)}>{[1,7,30].map(d=><option key={d} value={d}>Últimos {d} días</option>)}</select></label>
 {!restaurantId&&<>{filter('Negocio',business,setBusiness,businesses.map(b=>({value:b.id,label:b.name})))}{filter('Categoría',category,setCategory,[...new Set(businesses.map(b=>b.type))].sort().map(c=>({value:c,label:c})))}</>}
 {filter('Estado',status,setStatus,[...new Set(orders.map(o=>o.status))].sort().map(s=>({value:s,label:statusLabel(s)})))}
 <button className="btn ghost" disabled={loading} onClick={()=>setRefresh(x=>x+1)}>Actualizar</button></div>
 {loading&&<p role="status">Consultando…</p>}{metricsError&&<p role="alert">Métricas: {metricsError}</p>}{error&&<p role="alert">{error}</p>}
 {sampledAt>0&&<><p>Consulta: {new Date(sampledAt).toLocaleString()}. {orders.length===5000?'Detalle limitado a 5.000 pedidos; las métricas del servidor sí incluyen todos. Reduce el período para explorar el detalle.':'Registros recuperados del período seleccionado.'}</p>
 <div className="admin-stats">{Object.entries({'Total':serverMetrics?.total??'—','Pendientes':serverMetrics?.pending??'—','En camino':serverMetrics?.on_the_way??'—','Entregados':serverMetrics?.delivered??'—','Cancelados':serverMetrics?.cancelled??'—','Rechazados':serverMetrics?.rejected??'—','Incidencias abiertas':serverMetrics?.open_incidents??'—','Por liquidar':serverMetrics?.unsettled_cycles??'—'}).map(([label,value])=><article className="admin-stat-card" key={label}><strong>{value}</strong><span>{label}</span></article>)}</div>
 <p>Métricas calculadas en servidor sobre todos los pedidos del período y filtros. Promedio salida → entrega: {serverMetrics?.average_delivery_minutes??'Sin datos'} min. Promedio de aceptación: {serverMetrics?.average_response_minutes??'Sin datos'} min. Efectivo pendiente: ${serverMetrics?.cash_pending??'—'}.</p>

 <label><input type="checkbox" checked={alertsOnly} onChange={e=>{setAlertsOnly(e.target.checked);setPage(0);}}/> Solo con alertas</label>
 <div className="admin-orders-table-wrap"><table className="spam-table"><thead><tr><th>Pedido</th><th>Negocio / categoría</th><th>Estado</th><th>Alerta / motivo registrado</th><th>Última ubicación</th></tr></thead><tbody>{visible.slice(page*25,page*25+25).map(o=><tr key={o.id}><td>#{o.order_number}</td><td>{byId.get(o.restaurant_id)?.name??'No disponible'} / {byId.get(o.restaurant_id)?.type??'—'}</td><td>{statusLabel(o.status)}</td><td>{[...operationalAlerts(o,sampledAt),o.rejection_reason].filter(Boolean).join(' · ')||'Sin alerta ni motivo registrado'}</td><td>{o.driver_location_updated_at?new Date(o.driver_location_updated_at).toLocaleString():'Sin registro'}</td></tr>)}</tbody></table></div>
 {!visible.length&&<p>Sin pedidos para estos filtros.</p>}<button className="btn ghost" disabled={page===0} onClick={()=>setPage(x=>x-1)}>Anterior</button> <span>Página {page+1}</span> <button className="btn ghost" disabled={(page+1)*25>=visible.length} onClick={()=>setPage(x=>x+1)}>Siguiente</button>
 <p>Las alertas no cancelan pedidos. Consulta el expediente y registra la recepción de efectivo en Incidencias y liquidaciones.</p></>}
 </article>;
}
