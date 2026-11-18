export type AdminPanelKey = 'solicitudes' | 'envios' | 'incidencias' | 'operacion' | 'dashboard' | 'restaurantes' | 'comisiones' | 'pedidos' | 'antispam' | 'mapa' | 'reportes' | 'promociones' | 'config' | 'categorias';
export const ADMIN_PANELS: {key:AdminPanelKey;label:string;group:string}[] = [
 {key:'dashboard',label:'Resumen',group:'General'}, {key:'solicitudes',label:'Solicitudes de negocios',group:'General'}, {key:'restaurantes',label:'Negocios',group:'General'},
 {key:'pedidos',label:'Pedidos',group:'Operación'}, {key:'envios',label:'Tarifas de envío',group:'Operación'},
 {key:'mapa',label:'Mapa en vivo',group:'Operación'}, {key:'operacion',label:'Control de entregas',group:'Operación'},
 {key:'comisiones',label:'Comisiones',group:'Finanzas y crecimiento'}, {key:'reportes',label:'Reportes',group:'Finanzas y crecimiento'},
 {key:'promociones',label:'Promociones',group:'Finanzas y crecimiento'}, {key:'categorias',label:'Categorías',group:'Administración'},
 {key:'incidencias',label:'Incidencias técnicas',group:'Administración'}, {key:'antispam',label:'Anti-spam',group:'Administración'},
 {key:'config',label:'Configuración',group:'Administración'}
];

export default function AdminNavigation({value,onChange}:{value:AdminPanelKey;onChange:(value:AdminPanelKey)=>void}){
 return <nav className="admin-mobile-nav" aria-label="Secciones de administración">
  <label htmlFor="admin-section">¿Qué quieres gestionar?</label>
  <select id="admin-section" value={value} onChange={e=>{onChange(e.target.value as AdminPanelKey);window.scrollTo({top:0,behavior:'instant'});}}>
   {[...new Set(ADMIN_PANELS.map(p=>p.group))].map(group=><optgroup key={group} label={group}>{ADMIN_PANELS.filter(p=>p.group===group).map(panel=><option key={panel.key} value={panel.key}>{panel.label}</option>)}</optgroup>)}
  </select>
 </nav>;
}
