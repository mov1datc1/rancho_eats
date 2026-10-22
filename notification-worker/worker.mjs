import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { backoff, classify, expoProvider, fcmProvider, webPushProvider } from './providers.mjs';

export function rpcClient(url, secret, fetcher = fetch) {
  if (!url || !secret) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  return async (name, args) => {
    const response = await fetcher(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`RPC ${name}: HTTP ${response.status}`);
    if (response.status === 204) return null;
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  };
}

export function eligible(job, receipts, now = Date.now()) {
  if (receipts) return Date.parse(job.event.created_at) + 23 * 3600_000 > now ? null : { state: 'dead', code: 'RECEIPT_TIMEOUT' };
  if (!job.endpoint.active) return { state: 'expired', code: 'ENDPOINT_DISABLED' };
  // Account changes must never redirect a queued notification to the next login.
  if (job.event.audience === 'driver' ? job.endpoint.driver_id !== job.event.driver_id : job.endpoint.user_id !== job.event.user_id) return { state: 'expired', code: 'OWNER_CHANGED' };
  if (Date.parse(job.event.expires_at) <= now) return { state: 'expired', code: 'TTL_EXPIRED' };
  if (['order.created','order.reminder'].includes(job.event.kind) && job.current_status !== 'PENDING') return { state: 'expired', code: 'ORDER_ALREADY_HANDLED' };
  if (job.event.kind === 'driver.assigned' && (job.current_driver_id !== job.event.driver_id || ['DELIVERED','CANCELLED','REJECTED'].includes(job.current_status))) return { state: 'expired', code: 'ASSIGNMENT_CHANGED' };
  if (job.event.kind === 'order.time_proposal' && job.current_status !== 'PENDING') return { state: 'expired', code: 'ORDER_ALREADY_HANDLED' };
  if (job.event.kind === 'marketing.campaign') {
    if (job.campaign_state === 'cancelled' || job.marketing_enabled === false) return { state: 'expired', code: 'MARKETING_DISABLED' };
    const hour = Number(new Intl.DateTimeFormat('en-GB', {timeZone:'America/Mexico_City',hour:'2-digit',hourCycle:'h23'}).format(new Date(now)));
    if (hour < 9 || hour >= 20) return { state: 'expired', code: 'QUIET_HOURS' };
    return job.attempts > 8 ? {state:'dead',code:'MAX_ATTEMPTS'} : null;
  }
  if (job.event.audience === 'client' && job.event.kind !== 'order.time_proposal' && job.event.kind !== `order.${String(job.current_status).toLowerCase()}`) return { state: 'expired', code: 'SUPERSEDED' };
  if (job.attempts > 8) return { state: 'dead', code: 'MAX_ATTEMPTS' };
  return null;
}

export async function runBatch({ rpc, provider, app, receipts = false, now = Date.now, log = console.log }) {
  const jobs = await rpc('claim_notifications', { p_app: app, p_receipts: receipts });
  if (!jobs.length) return 0;
  const ready = []; const results = new Map();
  for (const job of jobs) {
    const rejection = eligible(job, receipts, now());
    if (rejection) results.set(job.id, rejection); else ready.push(job);
  }
  // Provider transitions drain existing Expo receipts even after switching to FCM.
  if (ready.length) {
    try {
      const responses = receipts ? await provider.receipts(ready) : await provider.send(ready);
      if (responses.length !== ready.length) throw new Error('Provider result count mismatch');
      ready.forEach((job, i) => results.set(job.id, responses[i]));
    } catch (error) {
      for (const job of ready) results.set(job.id, receipts
        ? { state: 'receipt', code: error.code || 'RECEIPT_NETWORK', delay: Math.max(300, error.retryAfter || 0) }
        : { ...classify(error.code, error.status), code: error.code || 'PROVIDER_NETWORK', delay: error.retryAfter });
    }
  }
  // One RPC per batch, not one network/database request per recipient.
  // A failed ack leaves leases recoverable. External delivery remains at-least-once.
  const acknowledgements = jobs.map(job => {
    const r = results.get(job.id);
    if (r.state === 'pending' && job.attempts >= 8) { r.state = 'dead'; r.code ||= 'MAX_ATTEMPTS'; }
    return {
      p_id: job.id, p_lease: job.lease_id, p_state: r.state, p_code: r.code || null,
      p_ticket: r.ticket || null, p_delay: r.state === 'pending' ? Math.max(r.delay || 0, backoff(job.attempts)) : r.delay || 0,
      p_disable: !!r.disable,
    };
  });
  let confirmations;
  try { confirmations = await rpc('finish_notifications', { p_results: acknowledgements }); }
  catch { throw new Error('Delivery acknowledgement failed; leases will recover'); }
  log(JSON.stringify({ type: 'notification_batch', app, count: jobs.length,
    results: acknowledgements.reduce((counts, r) => { counts[r.p_state] = (counts[r.p_state] || 0) + 1; return counts; }, {}),
    staleLeases: confirmations.filter(r => !r.ack).length }));
  return jobs.length;
}

async function main() {
  const rpc = rpcClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const app = process.env.NOTIFICATION_APP;
  if (!['client', 'restaurant', 'driver', 'web'].includes(app)) throw new Error('Set NOTIFICATION_APP to one app');
  const expo = expoProvider(process.env.EXPO_ACCESS_TOKEN);
  const mode = process.env.NOTIFICATION_PROVIDER || (app === 'web' ? 'webpush' : 'expo');
  let provider;
  if (mode === 'expo') provider = expo;
  else if (mode === 'fcm') provider = fcmProvider(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}'));
  else if (mode === 'webpush') provider = await webPushProvider({ subject: process.env.VAPID_SUBJECT, publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY });
  else throw new Error('Unknown provider');
  // Fail closed before claiming jobs if worker and database routes disagree.
  const guarded = { send: jobs => {
    if (jobs.some(j => j.configured_provider !== mode || j.endpoint.provider !== mode)) throw Object.assign(new Error('Provider configuration mismatch'), { code: 'CONFIG_MISMATCH' });
    return provider.send(jobs);
  } };
  let stopping = false;
  process.on('SIGTERM', () => { stopping = true; });
  process.on('SIGINT', () => { stopping = true; });
  let lastReceipts = 0;
  let lastMaintenance = 0;
  while (!stopping) {
    try {
      await runBatch({ rpc, provider: guarded, app });
      if (Date.now() - lastMaintenance >= 10_000) {
        await rpc('maintain_notifications', {});
        if (app === 'client') await rpc('process_marketing_campaigns', {});
        lastMaintenance = Date.now();
      }
      if (Date.now() - lastReceipts >= 10_000) {
        await runBatch({ rpc, provider: expo, app, receipts: true });
        lastReceipts = Date.now();
      }
      process.send?.({ type: 'progress' });
      await sleep(mode === 'expo' ? 250 : 250);
    } catch (error) {
      // Do not log tokens, service credentials, addresses or provider response bodies.
      console.error(JSON.stringify({ type: 'worker_error', app, message: error.message }));
      await sleep(2000);
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
