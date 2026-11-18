const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const m={exports:{}};
new Function('exports','module',ts.transpileModule(fs.readFileSync('src/lib/appRoutes.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m.exports,m);
test('admin aliases and trailing slash always resolve to administration before App mounts',()=>{
 for(const path of ['/administracion','/administracion/','/admin','/admin/','/administrador/'])assert.deepEqual(m.exports.resolveAppRoute(path),{canonical:'/administrador',redirect:true,kind:'app'});
 assert.deepEqual(m.exports.resolveAppRoute('/administrador'),{canonical:'/administrador',redirect:false,kind:'app'});
 assert.equal(m.exports.resolveAppRoute('/').kind,'landing');
 assert.equal(m.exports.resolveAppRoute('/unknown').kind,'missing');
 for(const path of ['/restaurantes','/pruebas','/repartidor','/privacy','/aviso-privacidad','/delete-account'])assert.equal(m.exports.resolveAppRoute(path).kind,'app');
 const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));
 assert.equal(config.redirects.find(r=>r.source==='/administracion').destination,'/administrador');
});
function sw({fetcher=async()=>{throw Error('offline');},cached,cacheFailure=false}={}){
 const handlers={},writes=[];
 vm.runInNewContext(fs.readFileSync('public/sw.js','utf8'),{
  self:{location:{origin:'https://www.pide-ya.app'},addEventListener:(name,fn)=>handlers[name]=fn},URL,Response,
  caches:{match:async()=>{if(cacheFailure)throw Error('storage');return cached;},open:async()=>({put:async(...args)=>writes.push(args)})},fetch:fetcher
 });
 return {writes,request(path,mode='navigate',destination='document'){
  let result;handlers.fetch({request:{url:`https://www.pide-ya.app${path}`,method:'GET',mode,destination},respondWith:p=>{result=p;},waitUntil:()=>{}});return result;
 }};
}
test('offline navigation without cached shell returns a visible response even if storage fails',async()=>{
 for(const cacheFailure of [false,true]){
  const response=await sw({cacheFailure}).request('/administracion');
  assert.equal(response.status,503);assert.match(await response.text(),/No pudimos conectar/);
 }
});
test('offline shell recovers known routes; failed pages never overwrite the app shell',async()=>{
 const cached=new Response('cached shell');assert.equal(await (await sw({cached}).request('/administrador')).text(),'cached shell');
 const worker=sw({fetcher:async()=>new Response('upstream error',{status:503})});
 assert.equal((await worker.request('/administrador')).status,503);assert.equal(worker.writes.length,0);
});
test('static network failures settle without an unhandled rejection; API responses are not cached',async()=>{
 const worker=sw();assert.equal((await worker.request('/assets/missing.js','cors','script')).status,503);
 assert.equal(worker.request('/api/private','cors',''),undefined);
});
