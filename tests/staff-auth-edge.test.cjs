const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync('supabase/functions/staff-auth/index.ts','utf8').replace(/^import[^\n]*\n/,'');
function setup({owner=true,ready=true,valid=true,reserveError=null,emailError=null,finishError=null}={}){
 const calls=[];let handler;
 const user={auth:{getUser:async()=>({data:{user:valid?{id:'owner'}:null},error:valid?null:Error('invalid')}),resetPasswordForEmail:async(...args)=>{calls.push(['recovery',...args]);return {error:emailError};}},rpc:async(name,args)=>{calls.push([name,args]);return name==='staff_is_owner'?{data:owner,error:null}:{data:'request-1',error:reserveError&&{message:reserveError}};}};
 const admin={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{value:ready},error:null})})})}),auth:{admin:{inviteUserByEmail:async(...args)=>{calls.push(['invite',...args]);return {data:{user:{id:'invited-user'}},error:emailError};}}},rpc:async(name,args)=>{calls.push([name,args]);return {error:finishError};}};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,{Request,Response,URL,createClient:(url,key)=>key==='server-key'?admin:user,Deno:{env:{get:key=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public-key',SUPABASE_SERVICE_ROLE_KEY:'server-key'}[key])},serve:fn=>{handler=fn;}}});
 return {calls,invoke:(body,authorization='Bearer valid')=>handler(new Request('https://test.supabase.co/functions/v1/staff-auth',{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify(body)}))};
}
test('email endpoint rejects absent/invalid identity and non-owner before sending',async()=>{
 for(const options of [{valid:false},{owner:false}]){const e=setup(options);assert.ok([401,403].includes((await e.invoke({action:'invite',email:'worker@example.invalid'})).status));assert.ok(!e.calls.some(c=>c[0]==='invite'));}
 const e=setup();assert.equal((await e.invoke({},'')).status,401);
});
test('unconfigured SMTP is explicit and does not reserve or send mail',async()=>{
 const e=setup({ready:false}),response=await e.invoke({action:'invite',email:'worker@example.invalid'});
 assert.equal(response.status,503);assert.equal((await response.json()).error,'auth_email_not_configured');assert.ok(!e.calls.some(c=>c[0]==='staff_reserve_email'||c[0]==='invite'));
});
test('rate limits are enforced before provider calls',async()=>{
 const e=setup({reserveError:'email_rate_limit'});assert.equal((await e.invoke({action:'recovery',email:'worker@example.invalid'})).status,429);assert.ok(!e.calls.some(c=>c[0]==='recovery'));
});
test('invitation normalizes address, fixes callback destination and finalizes verified Auth identity',async()=>{
 const e=setup();const r=await e.invoke({action:'invite',email:'Worker@Example.invalid',name:'QA Worker',role:'operations',redirectTo:'https://attacker.invalid'});
 assert.equal(r.status,200);const invite=e.calls.find(c=>c[0]==='invite');assert.equal(invite[1],'worker@example.invalid');assert.equal(invite[2].redirectTo,'https://www.pide-ya.app/administrador/acceso?flow=invite');
 const finish=e.calls.find(c=>c[0]==='staff_finish_email');assert.equal(finish[1].p_user,'invited-user');assert.equal(finish[1].p_success,true);
 const output=await r.text();assert.ok(!output.includes('server-key'));assert.ok(!output.includes('access_token'));
});
test('recovery goes to Auth and never accepts or sends a new password',async()=>{
 const e=setup();const r=await e.invoke({action:'recovery',email:'worker@example.invalid',password:'NeverUseThisAsAnAdmin'});
 assert.equal(r.status,200);const call=e.calls.find(c=>c[0]==='recovery');assert.equal(call[2].redirectTo,'https://www.pide-ya.app/administrador/acceso?flow=recovery');assert.ok(!JSON.stringify(e.calls).includes('NeverUseThisAsAnAdmin'));
});
test('SMTP failure marks failure and cannot finalize access as successful',async()=>{
 const e=setup({emailError:{status:500,message:'private SMTP credential'}});const r=await e.invoke({action:'invite',email:'worker@example.invalid'});
 assert.equal(r.status,502);assert.equal(e.calls.find(c=>c[0]==='staff_finish_email')[1].p_success,false);assert.ok(!(await r.text()).includes('credential'));
});
test('ambiguous finalization requires review instead of reporting access created',async()=>{
 const e=setup({finishError:Error('conflict')});const r=await e.invoke({action:'invite',email:'worker@example.invalid'});assert.equal(r.status,409);assert.equal((await r.json()).error,'email_requested_access_pending_review');
});
