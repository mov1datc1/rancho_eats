export interface OperationalOrder {
 id:string; restaurant_id:string; order_number:number; status:string; created_at:string;
 delivery_started_at?:string|null; delivered_at?:string|null;
 driver_location_updated_at?:string|null; rejection_reason?:string|null;
}
export function operationalAlerts(o:OperationalOrder,now=Date.now()):string[]{
 const age=(s?:string|null)=>s&&Number.isFinite(Date.parse(s))?Math.max(0,now-Date.parse(s))/60000:null;
 if(['DELIVERED','CANCELLED','REJECTED'].includes(o.status))return [];
 if(o.status==='PENDING')return (age(o.created_at)??0)>=10?['Sin respuesta ≥10 min']:[];
 if(o.status==='ON_THE_WAY'){
  const alerts=[];
  if((age(o.delivery_started_at)??0)>=120)alerts.push('Recorrido ≥2 h: revisar');
  if(age(o.driver_location_updated_at)===null)alerts.push('Sin ubicación registrada');
  else if((age(o.driver_location_updated_at) ?? 0)>=10)alerts.push('Ubicación sin actualizar ≥10 min');
  return alerts;
 }
 return (age(o.created_at)??0)>=120?['Pedido abierto ≥2 h: revisar']:[];
}
export function deliveryMetrics(rows:OperationalOrder[],now=Date.now()){
 const times=rows.filter(o=>o.status==='DELIVERED').map(o=>({start:Date.parse(o.delivery_started_at||''),end:Date.parse(o.delivered_at||'')}))
 .filter(x=>Number.isFinite(x.start)&&Number.isFinite(x.end)&&x.end>=x.start).map(x=>(x.end-x.start)/60000);
 return {counts:Object.fromEntries(['PENDING','ON_THE_WAY','DELIVERED','CANCELLED','REJECTED'].map(s=>[s,rows.filter(o=>o.status===s).length])),
 alerts:rows.filter(o=>operationalAlerts(o,now).length).length,timed:times.length,average:times.length?Math.round(times.reduce((a,b)=>a+b,0)/times.length):null};
}
