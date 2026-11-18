export type DeliveryZone={name:string;lat:number;lng:number;radius_km:number;fee:number};
export type DeliveryTariff={base_fee:number;included_km:number;per_km:number;max_fee:number;zones:DeliveryZone[]};
/** Admin preview only. Checkout always requests the authoritative server quote. */
export function previewDeliveryFee(c:DeliveryTariff,km:number){
 if(!Number.isFinite(km)||km<0)return NaN;
 return Math.round(Math.min(c.max_fee,c.base_fee+Math.ceil(Math.max(0,Math.round(km*1e6)/1e6-c.included_km))*c.per_km)*100)/100;
}
