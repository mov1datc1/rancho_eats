const {test}=require('node:test'),assert=require('node:assert/strict');
test('monthly SKU allowances and progressive bands are applied once, not per project or order',async()=>{
 const {directionsCost,staticCost,geocodingCost}=await import('../ops/load/maps-cost-model.mjs');
 assert.equal(directionsCost(10000),0);assert.equal(directionsCost(10001),.01);
 assert.equal(directionsCost(100000),450);assert.equal(directionsCost(126000),554);
 assert.equal(directionsCost(630000),2570);assert.equal(staticCost(30000),40);
 assert.equal(geocodingCost(6000),0);assert.throws(()=>directionsCost(-1));
});
test('same order volume and GPS quality are used in route optimization comparison',async()=>{
 const {estimate}=await import('../ops/load/maps-cost-model.mjs');
 const r=estimate();assert.equal(r.orders,3000);assert.equal(r.currentRoutes,126000);
 assert.equal(r.proposedRoutes,18000);assert.equal(r.currentUsd,554);assert.equal(r.proposedUsd,40);
 assert.equal(r.gpsWrites,363000);assert.equal(r.realtimeDeliveriesEstimate,726000);
 assert.equal(estimate({dailyOrders:500}).currentUsd,2610);
 assert.equal(estimate({dailyOrders:1000}).proposedUsd,870);
});
