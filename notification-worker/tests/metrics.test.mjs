import {test} from 'node:test';import assert from 'node:assert/strict';
import {authorizedMetrics,renderMetrics} from '../metrics.mjs';
test('metrics require an explicit strong bearer token',()=>{
 const t='x'.repeat(32);assert.ok(authorizedMetrics(`Bearer ${t}`,t));
 for(const h of [undefined,'','Bearer wrong',`Bearer ${t}x`])assert.equal(authorizedMetrics(h,t),false);
 assert.equal(authorizedMetrics('Bearer tiny','tiny'),false);
 assert.equal(authorizedMetrics('Bearer undefined',undefined),false);
});
test('exporter fails closed on missing, stale, or invalid samples and omits extra data',()=>{
 const s={sampled_at:1000,db_connections:5,db_max_connections:60,queue_pending:0,queue_oldest_operational_seconds:0,queue_dead_1h:0,queue_expired_leases:0,secret:'do-not-export'};
 const result=renderMetrics(s,1000000);assert.match(result,/pideya_db_connections 5/);assert.ok(!result.includes('do-not-export'));
 assert.throws(()=>renderMetrics(s,1200000));assert.throws(()=>renderMetrics(null));
 assert.throws(()=>renderMetrics({...s,db_connections:NaN},1000000));
});
