export function staffOrderActions(order:{status:string;delivery_type:string;prepared?:boolean}){
 if(order.status==='PENDING')return ['ACCEPTED','REJECTED'];
 if(order.status==='ACCEPTED'&&order.prepared)return ['PREPARING','READY'];
 if(order.status==='PREPARING'&&order.prepared)return ['READY'];
 if(order.status==='READY'&&order.delivery_type==='pickup')return ['DELIVERED'];
 return [];
}
export const staffOrderStatus:Record<string,string>={PENDING:'Pendiente',ACCEPTED:'Aceptado',PREPARING:'En preparación',PICKING:'En surtido',ADJUSTED:'Ajustado',READY:'Listo',ON_THE_WAY:'En camino',DELIVERED:'Entregado',CANCELLED:'Cancelado',REJECTED:'Rechazado'};
