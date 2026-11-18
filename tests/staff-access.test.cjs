const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(file){const m={exports:{}};new Function('exports','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(m.exports,require);return m.exports;}
const {normalizeStaffPermissions,staffError,boundedStaffAccess}=load('src/lib/staffAccess.ts');
const {staffOrderActions}=load('src/lib/staffOrders.ts');
test('write permissions always include read, reject unknown codes, and deduplicate',()=>{
 assert.deepEqual(normalizeStaffPermissions(['orders.write','commissions.collect','unknown','orders.write']),['commissions.collect','commissions.read','orders.read','orders.write']);
 assert.deepEqual(normalizeStaffPermissions([]),[]);
 assert.equal(normalizeStaffPermissions(['admin.full']).includes('admin.full'),true);
});
test('operation UI never offers delivery completion for home delivery or bypasses picking',()=>{
 assert.deepEqual(staffOrderActions({status:'READY',delivery_type:'delivery',prepared:true}),[]);
 assert.deepEqual(staffOrderActions({status:'READY',delivery_type:'pickup',prepared:true}),['DELIVERED']);
 assert.deepEqual(staffOrderActions({status:'ACCEPTED',delivery_type:'delivery',prepared:false}),[]);
 for(const status of ['PICKING','ADJUSTED','ON_THE_WAY','DELIVERED','CANCELLED','REJECTED'])assert.deepEqual(staffOrderActions({status,delivery_type:'delivery',prepared:true}),[]);
});
test('staff errors explain conflicts without exposing server details',()=>{
 assert.match(staffError('member_changed_refresh'),/Actualiza/);
 assert.match(staffError('email_rate_limit'),/90 segundos/);
 assert.ok(!staffError('private SQL credential failure').includes('credential'));
});
test('unresponsive identity checks time out without granting access',async()=>{
 await assert.rejects(boundedStaffAccess(()=>new Promise(()=>{}),5),/ACCESS_TIMEOUT/);
 assert.deepEqual(await boundedStaffAccess(async()=>({active:false}),100),{active:false});
 await assert.rejects(boundedStaffAccess(async()=>{throw Error('denied');},100),/denied/);
});
