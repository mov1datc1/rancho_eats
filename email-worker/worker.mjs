import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { rpcClient } from '../notification-worker/worker.mjs';
import { renderReceipt } from './template.mjs';

export function emailConfig(env) {
  if (env.ORDER_EMAIL_ENABLED !== 'true') throw new Error('ORDER_EMAIL_DISABLED');
  for (const name of ['RESEND_API_KEY','ORDER_EMAIL_FROM','ORDER_EMAIL_REPLY_TO']) if (!env[name]?.trim() || /[\r\n]/.test(env[name])) throw new Error(`Missing or invalid ${name}`);
  if (!/^[^<>\s]+@[^<>\s]+\.[^<>\s]+$/.test(env.ORDER_EMAIL_REPLY_TO)) throw new Error('INVALID_REPLY_TO');
  if (!/^PideYa <[^<>\s]+@[^<>\s]+\.[^<>\s]+>$/.test(env.ORDER_EMAIL_FROM)) throw new Error('INVALID_FROM');
  return { apiKey:env.RESEND_API_KEY, from:env.ORDER_EMAIL_FROM, replyTo:env.ORDER_EMAIL_REPLY_TO };
}
export function resendProvider(apiKey, fetcher=fetch) {
  return async (id,body) => {
    let response;
    try {
      response=await fetcher('https://api.resend.com/emails', { method:'POST',
        headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':`order-delivered/${id}`},
        body:JSON.stringify(body),signal:AbortSignal.timeout(15_000) });
    } catch { return {state:'pending',code:'PROVIDER_NETWORK'}; }
    if (response.ok) {
      let result; try { result=await response.json(); } catch { return {state:'pending',code:'INVALID_PROVIDER_RESPONSE'}; }
      return typeof result.id === 'string' && result.id ? {state:'accepted',providerId:result.id} : {state:'pending',code:'INVALID_PROVIDER_RESPONSE'};
    }
    const retry=response.status===429 || response.status>=500;
    // A concurrent same-key request may return 409. Other conflicts need review.
    if(response.status===409) {
      let data;try{data=await response.json();}catch{}
      return {state:data?.name==='concurrent_idempotent_requests'?'pending':'dead',code:'HTTP_409'};
    }
    const header=response.headers.get('retry-after');
    const seconds=header ? (/^\d+$/.test(header)?Number(header):Math.ceil((Date.parse(header)-Date.now())/1000)) : 0;
    return {state:retry?'pending':'dead',code:`HTTP_${response.status}`,delay:Number.isFinite(seconds)?Math.min(3600,Math.max(30,seconds)):60};
  };
}
export async function runEmailBatch({rpc,send,config,wait=sleep,log=console.log}) {
  const jobs=await rpc('claim_order_receipt_emails',{});
  const counts={};
  for(const job of jobs) {
    let body=job.request;
    if(!body) {
      try { body={from:config.from,to:[job.recipient],reply_to:config.replyTo,...renderReceipt(job.snapshot)}; }
      catch { await finish(job,{state:'dead',code:'INVALID_SUMMARY'});continue; }
      body=await rpc('prepare_order_receipt_email',{p_id:job.id,p_lease:job.lease_id,p_request:body});
      if(!body)continue; // Lost lease: never send.
    }
    const result=await send(job.id,body);
    await finish(job,result);
    await wait(600); // Single worker stays below the standard 2 requests/sec limit.
  }
  async function finish(job,result) {
    const ack=await rpc('finish_order_receipt_email',{p_id:job.id,p_lease:job.lease_id,p_state:result.state,
      p_code:result.code||null,p_provider_id:result.providerId||null,
      p_delay:Math.max(result.delay||0,Math.min(3600,30*2**Math.min(job.attempts,7)))});
    if(!ack)throw new Error('EMAIL_ACK_LEASE_LOST');
    counts[result.state]=(counts[result.state]||0)+1;
  }
  if(jobs.length)log(JSON.stringify({type:'order_email_batch',count:jobs.length,results:counts}));
  return jobs.length;
}
async function main() {
  const config=emailConfig(process.env);
  const rpc=rpcClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const send=resendProvider(config.apiKey);
  let stopping=false;
  process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
  while(!stopping) {
    try { await runEmailBatch({rpc,send,config}); }
    catch { console.error(JSON.stringify({type:'order_email_error',code:'BATCH_FAILED'})); }
    if(!stopping)await sleep(5000);
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Order email startup failed: check server-only configuration.');process.exitCode=1;});
