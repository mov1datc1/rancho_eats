// Public global pay-as-you-go list checked 2026-11-01. Estimates, not billing data.
export const source='https://developers.google.com/maps/billing-and-pricing/pricing';
export function tierCost(events, free, tiers) {
 if(!Number.isFinite(events)||events<0)throw Error('Invalid event count');
 let last=free,total=0;
 for(const [ceiling,price] of tiers){total+=Math.max(0,Math.min(events,ceiling)-last)*price/1000;last=ceiling;}
 return Math.round(total*100)/100;
}
export const directionsCost=n=>tierCost(n,10000,[[100000,5],[Infinity,4]]);
export const staticCost=n=>tierCost(n,10000,[[100000,2],[500000,1.6],[1000000,1.2],[5000000,.6],[Infinity,.15]]);
export const geocodingCost=n=>tierCost(n,10000,[[100000,5],[500000,4],[1000000,3],[5000000,1.5],[Infinity,.38]]);
export function estimate({dailyOrders=100,days=30,trackingMinutes=20,staticPerOrder=2,googleGeocodesPerOrder=0,optimizedRoutes=6,mxnPerUsd=20,gpsSeconds=10,viewers=2}={}) {
 const orders=dailyOrders*days;
 // One initial moving-origin route + one reference route + timer calls, including final boundary.
 const routesPerOrder=2+Math.floor(trackingMinutes*60/30);
 const currentRoutes=orders*routesPerOrder,proposedRoutes=orders*optimizedRoutes;
 const staticEvents=orders*staticPerOrder,geocodes=orders*googleGeocodesPerOrder;
 const other=staticCost(staticEvents)+geocodingCost(geocodes);
 const gpsWrites=orders*(1+Math.floor(trackingMinutes*60/gpsSeconds));
 return {orders,routesPerOrder,currentRoutes,proposedRoutes,staticEvents,geocodes,gpsWrites,realtimeDeliveriesEstimate:gpsWrites*viewers,
 currentUsd:Math.round((directionsCost(currentRoutes)+other)*100)/100,
 proposedUsd:Math.round((directionsCost(proposedRoutes)+other)*100)/100,
 currentMxn:Math.round((directionsCost(currentRoutes)+other)*mxnPerUsd),
 proposedMxn:Math.round((directionsCost(proposedRoutes)+other)*mxnPerUsd)};
}
