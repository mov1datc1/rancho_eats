export const enquiryCategories=[['restaurant','Restaurante'],['pizza','Pizzería'],['burgers','Hamburguesas'],['cafe','Cafetería'],['retail','Tienda / abarrotes'],['other','Otro negocio']] as const;
export const enquiryDelivery=[['own_team','Tengo equipo de reparto'],['need_help','Quiero conocer las opciones'],['pickup_only','Solo recogida en el negocio'],['undecided','Aún lo estoy definiendo']] as const;
export function normalizeMXPhone(value:string){let digits=value.replace(/\D/g,'');if(digits.length===12&&digits.startsWith('52'))digits=digits.slice(2);return /^\d{10}$/.test(digits)?digits:null;}
export const enquiryStates={NEW:'Nueva',CONTACTED:'En contacto',CONVERTED:'Alta completada',CLOSED:'Cerrada'} as const;
