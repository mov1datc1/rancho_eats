export type CollectionFrequency='weekly'|'fortnightly'|'monthly';
export const frequencyLabel=(v:string)=>({weekly:'Semanal',fortnightly:'Quincenal',monthly:'Mensual'}[v]||'Mensual');
export const commissionMoney=(v:unknown)=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',minimumFractionDigits:2}).format(Number(v)||0);
export function centralToday(){const p=new Intl.DateTimeFormat('en',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(k=>p.find(v=>v.type===k)?.value).join('-');}
export function commissionPeriod(kind:CollectionFrequency,anchor:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(anchor))throw Error('Fecha inválida');
 const [y,m,d]=anchor.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));
 if(date.toISOString().slice(0,10)!==anchor)throw Error('Fecha inválida');
 const day=(yy:number,mm:number,dd:number)=>new Date(Date.UTC(yy,mm,dd)).toISOString().slice(0,10);
 if(kind==='weekly'){const start=d-((date.getUTCDay()+6)%7);return {from:day(y,m-1,start),to:day(y,m-1,start+6)};}
 if(kind==='fortnightly')return {from:day(y,m-1,d<=15?1:16),to:day(y,m-1,d<=15?15:new Date(Date.UTC(y,m,0)).getUTCDate())};
 return {from:day(y,m-1,1),to:day(y,m,0)};
}
export const adjacentCommissionPeriod=(from:string,to:string,direction:number)=>new Date(Date.parse((direction<0?from:to)+'T12:00:00Z')+(direction<0?-1:1)*86400000).toISOString().slice(0,10);
export const receiptFolio=(r:any)=>r.folio||('PY-COM-'+String(r.receipt_number).padStart(8,'0'));
const methodLabel=(v:string)=>({cash:'Efectivo',transfer:'Transferencia',other:'Otro',unspecified:'Sin registro histórico'}[v]||v);
export function commissionReceiptText(r:any){return ['PideYa · Comprobante de recepción',receiptFolio(r),r.business_name||r.name||'Negocio',`Corte: ${r.period_start} al ${r.period_end}`,`Recibido: ${commissionMoney(r.total_commission)}`,`Pedidos: ${r.orders_count}`,`Fecha: ${new Date(r.paid_at).toLocaleString('es-MX',{timeZone:'America/Mexico_City',dateStyle:'medium',timeStyle:'short'})}`,`Recibió: ${r.received_by||'Sin registro histórico'}`,`Forma: ${methodLabel(r.collection_method)}`,`Referencia: ${r.notes||'Sin referencia'}`,`Acuerdo: ${r.historical?'Sin registro histórico':frequencyLabel(r.collection_frequency)}`,'Comisiones PideYa confirmadas como recibidas.'].join('\n');}
export function commissionReceiptHtml(r:any){const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(receiptFolio(r))}</title><style>body{font-family:Arial,sans-serif;color:#182235;margin:32px auto;padding:24px;max-width:600px}h1{color:#7640c4;font-size:28px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:16px/1.8 Arial,sans-serif;border:1px solid #e4d6f8;border-radius:16px;padding:24px}@media print{body{margin:0}}</style></head><body><h1>PideYa</h1><pre>${escape(commissionReceiptText(r))}</pre></body></html>`;}
