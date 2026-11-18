import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReceipt } from '../template.mjs';
import { emailConfig,resendProvider,runEmailBatch } from '../worker.mjs';
const summary={reference:'PY-TEST01',restaurant:'Prueba <script>alert(1)</script>',delivered_at:'2026-10-30T21:30:00Z',
 items:[{name:'Pizza <img src=x>',qty:1,amount:189}],subtotal:189,delivery:20,fee:15,total:224,payment_method:'cash'};
test('receipt escapes content, uses MXN and final adjusted totals, no customer phone/address',()=>{
 const r=renderReceipt(summary);assert.ok(!r.html.includes('<script>'));assert.ok(!r.html.includes('<img src=x>'));
 assert.ok(r.html.includes('&lt;script&gt;'));assert.ok(r.text.includes('$224.00 MXN'));assert.ok(r.text.includes('Efectivo'));
 assert.ok(r.html.includes('max-width:560px'));assert.ok(r.html.includes('https://www.pide-ya.app/'));
 assert.throws(()=>renderReceipt({...summary,total:220}),/INVALID_SUMMARY/);
 assert.throws(()=>renderReceipt({...summary,items:[{name:'Wrong',qty:1,amount:1}]}),/ITEM_TOTAL_MISMATCH/);
 assert.throws(()=>renderReceipt({...summary,total:null}),/INVALID_SUMMARY/);
});
test('configuration stays disabled by default and rejects unsafe mail headers',()=>{
 assert.throws(()=>emailConfig({}),/DISABLED/);
 assert.throws(()=>emailConfig({ORDER_EMAIL_ENABLED:'true',RESEND_API_KEY:'x',ORDER_EMAIL_FROM:'PideYa <a@example.com>\nBcc: a@x.com',ORDER_EMAIL_REPLY_TO:'help@example.com'}),/invalid/);
});
test('provider always uses stable idempotency key; no real network',async()=>{
 const calls=[];const send=resendProvider('secret',async(url,opts)=>{calls.push({url,opts});return new Response('{"id":"provider-1"}',{status:200});});
 const body={to:['verified@example.com'],html:'same'};
 assert.equal((await send('id-1',body)).state,'accepted');await send('id-1',body);
 assert.equal(calls[0].opts.headers['Idempotency-Key'],calls[1].opts.headers['Idempotency-Key']);
 assert.equal(calls[0].opts.body,calls[1].opts.body);
});
test('network/429/5xx retry, invalid credentials stop, conflict classification',async()=>{
 assert.equal((await resendProvider('x',async()=>{throw Error('secret response');})('1',{})).state,'pending');
 for(const status of [429,500,503])assert.equal((await resendProvider('x',async()=>new Response('',{status,headers:{'Retry-After':'120'}}))('1',{})).state,'pending');
 assert.equal((await resendProvider('x',async()=>new Response('',{status:403}))('1',{})).state,'dead');
 assert.equal((await resendProvider('x',async()=>new Response('{"name":"concurrent_idempotent_requests"}',{status:409}))('1',{})).state,'pending');
 assert.equal((await resendProvider('x',async()=>new Response('{"name":"invalid_idempotent_request"}',{status:409}))('1',{})).state,'dead');
});
test('exact request is persisted before send, retries reuse it despite config changes',async()=>{
 const events=[];const stored={to:['verified@example.com'],from:'old@example.com',subject:'old',html:'frozen',text:'frozen'};
 const rpc=async(name,args)=>{events.push(name);if(name==='claim_order_receipt_emails')return [{id:'1',lease_id:'lease',recipient:'verified@example.com',attempts:1,snapshot:summary}];
 if(name==='prepare_order_receipt_email')return stored;return true;};
 let actual;
 await runEmailBatch({rpc,send:async(id,body)=>{events.push('send');actual=body;return {state:'accepted',providerId:'p'};},config:{from:'new@example.com',replyTo:'help@example.com'},wait:async()=>{},log:()=>{}});
 assert.deepEqual(actual,stored);assert.ok(events.indexOf('prepare_order_receipt_email')<events.indexOf('send'));
});
test('lost preparation lease never sends; ack failure leaves recoverable lease',async()=>{
 let sends=0;
 await runEmailBatch({rpc:async name=>name==='claim_order_receipt_emails'?[{id:'1',lease_id:'l',recipient:'x@example.com',snapshot:summary}]:null,
 send:async()=>{sends++;},config:{},wait:async()=>{},log:()=>{}});assert.equal(sends,0);
 await assert.rejects(runEmailBatch({rpc:async name=>name==='claim_order_receipt_emails'?[{id:'1',lease_id:'l',request:{to:['x@example.com']}}]:false,
 send:async()=>({state:'accepted'}),config:{},wait:async()=>{},log:()=>{}}),/ACK_LEASE_LOST/);
});
test('invalid summaries go to review without external send or personal logs',async()=>{
 const logs=[];let state;
 await runEmailBatch({rpc:async(name,args)=>{if(name==='claim_order_receipt_emails')return [{id:'private-id',recipient:'private@example.com',snapshot:{},attempts:1}];state=args.p_state;return true;},
 send:async()=>{throw Error('must not send');},config:{},wait:async()=>{},log:s=>logs.push(s)});
 assert.equal(state,'dead');assert.ok(!logs.join('').includes('private'));
});
test('recovered requests reuse stored recipient and content without rendering again',async()=>{
 const stored={to:['original@example.com'],from:'original@example.org',html:'frozen',text:'frozen',subject:'frozen'};
 let actual;
 await runEmailBatch({rpc:async(name)=>{
   if(name==='claim_order_receipt_emails')return [{id:'stable',lease_id:'new-lease',attempts:2,request:stored,snapshot:{}}];
   assert.equal(name,'finish_order_receipt_email');return true;
 },send:async(id,body)=>{actual=body;return {state:'accepted'};},config:{from:'changed@example.org'},wait:async()=>{},log:()=>{}});
 assert.deepEqual(actual,stored);
});
