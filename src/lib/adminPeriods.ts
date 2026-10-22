export function periodRange(kind:string, anchor:string){
 const [y,m,d]=anchor.split('-').map(Number);const day=(yy:number,mm:number,dd:number)=>new Date(Date.UTC(yy,mm,dd)).toISOString().slice(0,10);
 switch(kind){
 case 'day':return {from:anchor,to:anchor};
 case 'fortnight':return {from:day(y,m-1,d<=15?1:16),to:day(y,m-1,d<=15?15:new Date(Date.UTC(y,m,0)).getUTCDate())};
 case 'month':return {from:day(y,m-1,1),to:day(y,m,0)};
 case 'quarter':{const q=Math.floor((m-1)/3)*3;return {from:day(y,q,1),to:day(y,q+3,0)};}
 case 'year':return {from:`${y}-01-01`,to:`${y}-12-31`};
 default:return {from:anchor,to:anchor};
 }
}
export const mexicoToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const dateBounds=(from:string,to:string)=>({start:from+'T00:00:00-06:00',end:new Date(Date.parse(to+'T00:00:00-06:00')+86400000).toISOString()});
export function downloadCSV(name:string,rows:unknown[][]){const cell=(v:unknown)=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}

export const formatMoney=(v:unknown)=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',minimumFractionDigits:2}).format(Number(v)||0);
