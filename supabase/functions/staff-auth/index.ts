import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const origins=new Set(['https://www.pide-ya.app','https://pide-ya.app','http://localhost:5173','http://127.0.0.1:5173']);
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const cors={'Access-Control-Allow-Origin':origins.has(origin)?origin:'https://www.pide-ya.app','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
 const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({error:'method_not_allowed'},405);
 const header=req.headers.get('Authorization');
 if(!header?.startsWith('Bearer '))return json({error:'not_authenticated'},401);
 const url=Deno.env.get('SUPABASE_URL')!;
 const user=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:header}},auth:{persistSession:false,autoRefreshToken:false}});
 const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 let requestId:string|null=null;
 try{
  const identity=await user.auth.getUser();
  if(identity.error||!identity.data.user)return json({error:'not_authenticated'},401);
  const access=await user.rpc('staff_is_owner');
  if(access.error||access.data!==true)return json({error:'not_authorized'},403);
  const readiness=await admin.from('app_settings').select('value').eq('setting_key','staff_auth_email_ready').maybeSingle();
  if(readiness.error||readiness.data?.value!==true)return json({error:'auth_email_not_configured'},503);
  const body=await req.json();
  if(!['invite','recovery'].includes(body.action)||typeof body.email!=='string')return json({error:'invalid_action'},400);
  const reserved=await user.rpc('staff_reserve_email',{p_action:body.action,p_email:body.email,p_name:typeof body.name==='string'?body.name:'',p_role:typeof body.role==='string'?body.role:null});
  if(reserved.error){const code=reserved.error.message;return json({error:['email_rate_limit','account_exists_use_existing','active_staff_required','invalid_invitation'].includes(code)?code:'invalid_request'},code==='email_rate_limit'?429:400);}
  requestId=reserved.data;
  // Redirect is fixed server-side: never accept a caller-provided callback URL.
  const base=Deno.env.get('STAFF_AUTH_REDIRECT_BASE')||'https://www.pide-ya.app';
  if(!origins.has(base))throw Error('INVALID_REDIRECT_CONFIGURATION');
  const redirectTo=`${base}/administrador/acceso?flow=${body.action}`;
  const sent=body.action==='invite'
   ?await admin.auth.admin.inviteUserByEmail(body.email.trim().toLowerCase(),{redirectTo,data:{display_name:body.name}})
   :await user.auth.resetPasswordForEmail(body.email.trim().toLowerCase(),{redirectTo});
  if(sent.error){
   const code=sent.error.status===429?'auth_rate_limit':'auth_email_failed';
   await admin.rpc('staff_finish_email',{p_request:requestId,p_success:false,p_code:code});
   return json({error:code},sent.error.status===429?429:502);
  }
  const invitedId=body.action==='invite'?(sent.data as {user?:{id:string}})?.user?.id:null;
  const completed=await admin.rpc('staff_finish_email',{p_request:requestId,p_user:invitedId,p_success:true});
  if(completed.error)return json({error:'email_requested_access_pending_review'},409);
  return json({ok:true,status:'email_requested'});
 }catch{
  if(requestId)await admin.rpc('staff_finish_email',{p_request:requestId,p_success:false,p_code:'SERVER_ERROR'});
  return json({error:'server_error'},500);
 }
});
