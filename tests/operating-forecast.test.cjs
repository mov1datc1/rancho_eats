const {test}=require('node:test'),assert=require('node:assert/strict');
test('price targets margin on collected revenue, not a markup on costs',async()=>{
 const {forecast}=await import('../ops/load/operating-forecast.mjs');const f=forecast();
 assert.equal(f.infrastructureMxn,3900);assert.equal(f.totalCostMxn,21735);
 assert.equal(f.suggestedWholeFeeMxn,11);assert.equal(f.profitAtFeeMxn,12465);
 assert.ok(f.marginAtFee>.36&&f.marginAtFee<.37);
 const withQuote=forecast({fee:f.minimumFeeMxn});assert.ok(withQuote.marginAtFee>=.30);
 const markup=forecast({fee:f.totalCostMxn*1.30/(f.monthlyOrders*.95)});assert.ok(markup.marginAtFee<.25);
});
test('low volume, subscriptions and invalid assumptions remain explicit',async()=>{
 const {forecast}=await import('../ops/load/operating-forecast.mjs');const low=forecast({dailyOrders:30});
 assert.equal(low.suggestedWholeFeeMxn,35);assert.equal(low.profitAtFeeMxn,-10555);
 assert.equal(forecast({dailyOrders:1000}).totalCostMxn,60720);
 assert.ok(forecast({monthlySubscriptionBilled:5000}).minimumFeeMxn<forecast().minimumFeeMxn);
 assert.throws(()=>forecast({margin:1}));assert.throws(()=>forecast({collectionRate:0}));assert.throws(()=>forecast({operationsMxn:-1}));
});
test('monthly Google queries do not imply an order count; 12500 explicit orders reconcile the USD480 example',async()=>{
 const {forecast}=await import('../ops/load/operating-forecast.mjs');
 const r=forecast({dailyOrders:12500/30,routeRequestsMonthly:100000,staticRequestsMonthly:25000});
 assert.equal(r.googleUsd,480);assert.equal(r.googleMxn,9600);assert.equal(r.monthlyOrders,12500);
 assert.equal(r.grossRevenueMxn,150000);assert.equal(r.afterGoogleGrossMxn,140400);
 assert.equal(r.revenueAtFeeMxn,142500);assert.equal(r.afterGoogleCollectedMxn,132900);
 assert.equal(r.totalCostMxn,39074.7);assert.equal(r.profitAtFeeMxn,103425.3);
 assert.throws(()=>forecast({routeRequestsMonthly:-1}));
});

test('operating budget grows smoothly and caps at 30000 without capping explicit budgets',async()=>{
 const {forecast,operatingBudget}=await import('../ops/load/operating-forecast.mjs');
 assert.equal(operatingBudget(100),15000);assert.equal(operatingBudget(1000),30000);assert.equal(operatingBudget(10000),30000);
 for(let n=101;n<=1001;n++)assert.ok(operatingBudget(n)-operatingBudget(n-1)<=17);
 assert.equal(forecast({dailyOrders:500}).operationsMxn,21667);
 assert.equal(forecast({dailyOrders:1000,operationsMxn:15000}).operationsMxn,15000);
 assert.equal(forecast({dailyOrders:1000,operationsMxn:40000}).operationsMxn,40000);
});
test('standalone simulator recalculates profit and supports gradual and fixed operation',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const html=fs.readFileSync(require('node:path').resolve(__dirname,'../../release-artifacts/2026-11-01-forecast/forecast-operativo.html'),'utf8');
 assert.ok(html.includes('Cuánto gano al mes*'));
 const elements={};for(const match of html.matchAll(/<input id="([^"]+)"[^>]*value="([^"]+)"/g))elements[match[1]]={id:match[1],value:match[2],checkValidity:()=>true,addEventListener(){}};
 const inputs=Object.values(elements);elements.operationsMode={value:'auto',addEventListener(){}};elements.manualGoogle={value:'0',addEventListener(){}};
 const document={querySelectorAll:()=>inputs,querySelector:s=>elements[s.slice(1)]??=( {textContent:'',classList:{toggle(){}}})};
 const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
 const context=vm.createContext({document});vm.runInContext(script,context);
 assert.equal(elements.operationsMxn.value,15000);
 elements.dailyOrders.value='1000';elements.supabaseUsd.value='150';vm.runInContext('render()',context);
 assert.equal(elements.operationsMxn.value,30000);assert.ok(elements.profit.textContent.includes('281,280'));
 elements.operationsMode.value='fixed';elements.operationsMxn.value='15000';vm.runInContext('render()',context);
 assert.equal(elements.operationsMxn.readOnly,false);assert.ok(elements.profit.textContent.includes('298,530'));
 assert.equal(elements.error.textContent,'');
});
