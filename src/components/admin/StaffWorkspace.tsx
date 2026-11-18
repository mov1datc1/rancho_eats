import {useEffect,useRef,useState} from 'react';
import {supabase} from '../../lib/supabase';
import {staffError,type StaffAccess} from '../../lib/staffAccess';
import {staffOrderActions,staffOrderStatus} from '../../lib/staffOrders';
import {mexicoToday,periodRange,formatMoney} from '../../lib/adminPeriods';
import CommissionLedger from './CommissionLedger';
import ConsoleTable from './ConsoleTable';
import PeriodFilter from './PeriodFilter';
import '../../index.css';
import './staff.css';
const modules=[['orders','Pedidos','orders.read'],['incidents','Incidencias de pedidos','incidents.read'],['commissions','Comisiones','commissions.read'],['businesses','Negocios','businesses.read'],['leads','Solicitudes de negocios','leads.read']] as const;
export default function StaffWorkspace({access}:{access:StaffAccess}){
 const available=modules.filter(m=>access.permissions.includes(m[2]));
 const [module,setModule]=useState<string>(available[0]?.[0]||''),[period,setPeriod]=useState(()=>periodRange('month',mexicoToday())),[search,setSearch]=useState(''),[page,setPage]=useState(0),[data,setData]=useState<any>({rows:[],count:0}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [selected,setSelected]=useState<any>(null),[status,setStatus]=useState(''),[note,setNote]=useState('');
 const seq=useRef(0),dialog=useRef<HTMLDialogElement>(null);
 const active=available.some(m=>m[0]===module)?module:available[0]?.[0]||'';
 const load=async()=>{if(!active||active==='commissions')return;const n=++seq.current;setBusy(true);setError('');try{
  const r=await supabase.rpc('staff_workspace',{p_module:active,p_from:period.from,p_to:period.to,p_search:search,p_page:page});
  if(r.error)throw r.error;if(n===seq.current)setData(r.data);
 }catch{if(n===seq.current){setData({rows:[],count:0});setError('No se pudo consultar este módulo. Revisa tu acceso o tu conexión.');}}finally{if(n===seq.current)setBusy(false);}};
 useEffect(()=>{setData({rows:[],count:0});const timer=setTimeout(()=>void load(),250);return()=>{seq.current++;clearTimeout(timer);};},[active,period.from,period.to,search,page]);
 useEffect(()=>{if(selected&&!dialog.current?.open)dialog.current?.showModal();},[selected]);
 const update=async(e:React.FormEvent)=>{e.preventDefault();if(!selected)return;setBusy(true);setError('');try{
  const r=await supabase.rpc('staff_update_order',{p_order:selected.id,p_expected:selected.status,p_status:status,p_note:note});
  if(r.error)throw Error(r.error.message);setSelected(null);setNotice('Estado actualizado. El cambio quedó registrado.');await load();
 }catch(e){setError(staffError(e instanceof Error?e.message:''));}finally{setBusy(false);}};
 const date=(value:string)=>new Date(value).toLocaleString('es-MX',{timeZone:'America/Mexico_City',dateStyle:'medium',timeStyle:'short'});
 return <main className="staff-workspace"><header className="staff-workspace-header"><div><span className="eyebrow">PIDEYA / EQUIPO</span><h1>Hola, {access.name}</h1><p>{access.role}</p></div><button className="btn ghost" onClick={()=>void supabase.auth.signOut()}>Cerrar sesión</button></header>
 <label className="console-field staff-workspace-select">Tu espacio de trabajo<select value={active} onChange={e=>{setModule(e.target.value);setPage(0);setSearch('');setSelected(null);setNotice('');}}>{available.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
 {!available.length&&<article className="admin-card"><h3>Aún no tienes módulos asignados</h3><p>Pide al superadmin que revise los permisos de tu perfil.</p></article>}
 {active==='commissions'?<CommissionLedger limited canCollect={access.permissions.includes('commissions.collect')}/>:active&&<article className="admin-card"><div className="console-heading"><div><h3>{available.find(m=>m[0]===active)?.[1]}</h3><p>{active==='orders'?'Actualiza la preparación sin saltar el surtido, la entrega ni la custodia de efectivo.':'Información disponible para tu perfil.'}</p></div><button className="btn ghost" disabled={busy} onClick={()=>void load()}>Actualizar</button></div>
 <div className="console-filters"><label>Buscar<input value={search} maxLength={100} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label>{active!=='businesses'&&<PeriodFilter value={period} onChange={p=>{setPeriod(p);setPage(0);}}/>}</div>
 {error&&<p className="console-error" role="alert">{error}</p>}{notice&&<p className="staff-notice" role="status">{notice}</p>}
 <ConsoleTable><table><thead><tr>{(active==='orders'?['Pedido / negocio','Cliente','Estado','Total','Fecha','Acción']:active==='incidents'?['Pedido / negocio','Motivo','Estado','Descripción','Fecha']:active==='businesses'?['Negocio','Categoría','Estado']:['Negocio','Contacto','Localidad','Estado','Fecha']).map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{data.rows.map((r:any)=><tr key={r.id}>
 {active==='orders'?<><td><strong>{r.reference_code||`#${r.order_number}`}</strong><small>{r.business}</small></td><td>{r.client_name||'Cliente'}</td><td>{staffOrderStatus[r.status]||r.status}</td><td>{formatMoney(r.total)}</td><td>{date(r.created_at)}</td><td>{access.permissions.includes('orders.write')&&staffOrderActions(r).length?<button className="btn ghost" disabled={busy} onClick={()=>{setSelected(r);setStatus(staffOrderActions(r)[0]);setNote('');setError('');}}>Cambiar estado</button>:<span>{access.permissions.includes('orders.write')?'Sigue el flujo de entrega o surtido':'Solo consulta'}</span>}</td></>:
 active==='incidents'?<><td>#{r.order_number}<small>{r.business}</small></td><td>{r.cause}</td><td>{r.status}</td><td>{r.description}<small>{r.resolution}</small></td><td>{date(r.created_at)}</td></>:
 active==='businesses'?<><td><strong>{r.name}</strong></td><td>{r.type}</td><td>{r.status}</td></>:
 <><td><strong>{r.business_name}</strong><small>PY-NEG-{r.lead_number}</small></td><td>{r.contact_name}<small>{r.email}</small><small>{r.phone}</small></td><td>{r.city}</td><td>{r.state}</td><td>{date(r.created_at)}</td></>}
 </tr>)}</tbody></table>{!busy&&!data.rows.length&&!error&&<p className="console-empty">Sin resultados para estos filtros.</p>}</ConsoleTable><div className="console-toolbar"><span>{data.count} resultados · Página {page+1}</span><div><button className="btn ghost" disabled={busy||page===0} onClick={()=>setPage(p=>p-1)}>Anterior</button><button className="btn ghost" disabled={busy||(page+1)*25>=data.count} onClick={()=>setPage(p=>p+1)}>Siguiente</button></div></div></article>}
 {selected&&<dialog ref={dialog} className="commission-dialog" aria-labelledby="staff-order-title" onCancel={e=>{if(busy)e.preventDefault();else setSelected(null);}}><form onSubmit={update}><h3 id="staff-order-title">Actualizar {selected.reference_code||`#${selected.order_number}`}</h3><p>{selected.business} · {staffOrderStatus[selected.status]}</p><label className="console-field">Nuevo estado<select value={status} disabled={busy} onChange={e=>setStatus(e.target.value)}>{staffOrderActions(selected).map(s=><option value={s} key={s}>{staffOrderStatus[s]}</option>)}</select></label><label className="console-field">Motivo del cambio<textarea required minLength={10} maxLength={500} rows={3} value={note} disabled={busy} onChange={e=>setNote(e.target.value)}/></label><p className="console-note">Las entregas a domicilio se completan desde el flujo del repartidor. Este control no liquida efectivo ni modifica importes.</p>{error&&<p className="console-error" role="alert">{error}</p>}<div className="staff-actions"><button className="btn" disabled={busy}>Guardar estado</button><button type="button" className="btn ghost" disabled={busy} onClick={()=>setSelected(null)}>Cancelar</button></div></form></dialog>}
 </main>;
}
