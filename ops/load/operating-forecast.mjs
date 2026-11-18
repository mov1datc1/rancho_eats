import {estimate,directionsCost,staticCost} from './maps-cost-model.mjs';
export function operatingBudget(dailyOrders){return Math.round(15000+15000*Math.min(1,Math.max(0,(dailyOrders-100)/900)));}
export const defaultVolumes=[30,100,300,500,1000];
export function forecast({dailyOrders=100,days=30,mxnPerUsd=20,margin=.30,collectionRate=.95,reserveRate=.15,fee=12,operationsMxn,supabaseUsd,vercelUsd=20,resendUsd=20,workersUsd=25,monitoringUsd=50,domainStoresUsd=5,expoUsd=0,monthlySubscriptionBilled=0,optimizedRoutes=6,staticPerOrder=2,routeRequestsMonthly,staticRequestsMonthly}={}){
 const fields={dailyOrders,days,mxnPerUsd,margin,collectionRate,reserveRate,fee,vercelUsd,resendUsd,workersUsd,monitoringUsd,domainStoresUsd,expoUsd,monthlySubscriptionBilled,optimizedRoutes,staticPerOrder};
 if(Object.values(fields).some(v=>!Number.isFinite(v)||v<0)||dailyOrders===0||days===0||mxnPerUsd===0||margin>=1||collectionRate===0||collectionRate>1)throw Error('Invalid forecast assumptions');
 const operations=operationsMxn??operatingBudget(dailyOrders);
 const supabase=supabaseUsd??(dailyOrders<=100?35:dailyOrders<=500?85:150);
 if(!Number.isFinite(operations)||operations<0||!Number.isFinite(supabase)||supabase<0)throw Error('Invalid operating/provider budget');
 if([routeRequestsMonthly,staticRequestsMonthly].some(v=>v!==undefined&&(!Number.isFinite(v)||v<0)))throw Error('Invalid monthly query counts');
 const routeQueries=routeRequestsMonthly??dailyOrders*days*optimizedRoutes;
 const staticQueries=staticRequestsMonthly??dailyOrders*days*staticPerOrder;
 const maps=directionsCost(routeQueries)+staticCost(staticQueries);
 const others=resendUsd+workersUsd+monitoringUsd+domainStoresUsd+expoUsd;
 const infrastructure=(maps+supabase+vercelUsd+others)*mxnPerUsd;
 const totalCost=Math.round((infrastructure+operations)*(1+reserveRate)*100)/100;
 const orders=dailyOrders*days,subscriptionCollected=monthlySubscriptionBilled*collectionRate;
 const minimumFee=Math.max(0,(totalCost/(1-margin)-subscriptionCollected)/(orders*collectionRate));
 const received=(orders*fee+monthlySubscriptionBilled)*collectionRate;
 const grossRevenue=orders*fee+monthlySubscriptionBilled;
 return {dailyOrders,monthlyOrders:orders,routeQueries,staticQueries,googleUsd:maps,googleMxn:maps*mxnPerUsd,supabaseUsd:supabase,supabaseMxn:supabase*mxnPerUsd,vercelMxn:vercelUsd*mxnPerUsd,otherTechnologyMxn:others*mxnPerUsd,infrastructureMxn:infrastructure,operationsMxn:operations,contingencyMxn:Math.round((infrastructure+operations)*reserveRate*100)/100,totalCostMxn:totalCost,minimumFeeMxn:Math.ceil(minimumFee*100)/100,suggestedWholeFeeMxn:Math.ceil(minimumFee),grossRevenueMxn:grossRevenue,afterGoogleGrossMxn:grossRevenue-maps*mxnPerUsd,afterGoogleCollectedMxn:received-maps*mxnPerUsd,revenueAtFeeMxn:received,profitAtFeeMxn:Math.round((received-totalCost)*100)/100,marginAtFee:received?(received-totalCost)/received:null,monthlyRevenueForTarget:totalCost/(1-margin),assumptions:{days,mxnPerUsd,margin,collectionRate,reserveRate,fee,monthlySubscriptionBilled,optimizedRoutes,staticPerOrder}};
}
