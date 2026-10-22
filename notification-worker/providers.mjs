import { createSign } from 'node:crypto';

export const backoff = (attempt, random = Math.random) => Math.ceil(Math.min(900, 2 ** Math.min(attempt, 10)) * (0.5 + random() / 2));
export function classify(code, status = 0) {
  if (['DeviceNotRegistered', 'UNREGISTERED'].includes(code) || status === 410) return { state: 'dead', disable: true };
  if (['MessageTooBig', 'INVALID_ARGUMENT', 'InvalidCredentials', 'MismatchSenderId', 'SENDER_ID_MISMATCH'].includes(code) || [400, 401, 403, 404].includes(status)) return { state: 'dead', disable: false };
  return { state: 'pending', disable: false };
}
export function messageFor(job, now = Date.now()) {
  const event = job.event;
  const merchantSound = job.endpoint.app === 'restaurant' && process.env.PIDEYA_MERCHANT_SOUND_V3 === 'true';
  const ttl = Math.max(1, Math.floor((Date.parse(event.expires_at) - now) / 1000));
  return {
    title: event.title, body: event.body, ttl, sound: merchantSound ? 'pideya_order.wav' : 'default',
    data: { eventId: event.kind === 'marketing.campaign' ? undefined : event.id, orderId: event.order_id, kind: event.kind, campaignId: event.campaign_id ?? null, revision: String(event.revision) },
    channelId: job.endpoint.app === 'driver' ? 'deliveries' : job.endpoint.app === 'restaurant' ? (merchantSound ? 'kds_new_order_alarm_v3' : 'kds_new_order_alarm_v2') : 'default',
  };
}

export async function jsonRequest(url, options, fetcher = fetch) {
  const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(15_000) });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after');
    const error = new Error('Provider request failed');
    error.status = response.status;
    error.code = data.error?.details?.find?.(d => d.errorCode)?.errorCode || data.error?.status || data.errors?.[0]?.code || `HTTP_${response.status}`;
    error.retryAfter = retryAfter ? Math.max(0, Number(retryAfter) || (Date.parse(retryAfter) - Date.now()) / 1000) : 0;
    throw error;
  }
  return data;
}

export function expoProvider(accessToken, fetcher = fetch) {
  const headers = { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
  return {
    async send(jobs) {
      if (jobs.length > 100 || new Set(jobs.map(j => j.endpoint.app)).size > 1) throw new Error('Expo batch must contain <=100 messages from one app');
      const payload = jobs.map(job => ({ ...messageFor(job), to: job.endpoint.token, priority: job.event.kind === 'marketing.campaign' ? 'normal' : 'high' }));
      const response = await jsonRequest('https://exp.host/--/api/v2/push/send', { method: 'POST', headers, body: JSON.stringify(payload) }, fetcher);
      if (!Array.isArray(response.data) || response.data.length !== jobs.length) throw new Error('Malformed Expo tickets');
      return response.data.map(t => t.status === 'ok' && t.id
        ? { state: 'receipt', ticket: t.id, delay: 900 }
        : { ...classify(t.details?.error), code: t.details?.error || 'INVALID_TICKET' });
    },
    async receipts(jobs) {
      const response = await jsonRequest('https://exp.host/--/api/v2/push/getReceipts', { method: 'POST', headers, body: JSON.stringify({ ids: jobs.map(j => j.ticket_id) }) }, fetcher);
      return jobs.map(job => {
        const r = response.data?.[job.ticket_id];
        if (!r) return { state: 'receipt', delay: 300, code: 'RECEIPT_PENDING' };
        if (r.status === 'ok') return { state: 'accepted' };
        return { ...classify(r.details?.error), code: r.details?.error || 'RECEIPT_ERROR' };
      });
    },
  };
}

// One Firebase service account per app; keys stay in worker secrets, never in mobile/web.
export function fcmProvider(account, fetcher = fetch) {
  let cachedToken; let expires = 0;
  let refreshing;
  async function accessToken() {
    if (cachedToken && expires > Date.now() + 60_000) return cachedToken;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const now = Math.floor(Date.now() / 1000);
      const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
      const payload = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
      const signature = createSign('RSA-SHA256').update(payload).sign(account.private_key).toString('base64url');
      const result = await jsonRequest('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${payload}.${signature}` }) }, fetcher);
      if (!result.access_token) throw new Error('Missing OAuth token');
      cachedToken = result.access_token; expires = Date.now() + result.expires_in * 1000;
      return cachedToken;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  return {
    async send(jobs) {
      const token = await accessToken();
      // Batch size and fleet-wide pacing are enforced by claim_notifications.
      return Promise.all(jobs.map(async job => {
        const m = messageFor(job);
        try {
          await jsonRequest(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: { token: job.endpoint.token, notification: { title: m.title, body: m.body }, data: m.data,
              android: { priority: 'HIGH', ttl: `${m.ttl}s`, notification: { channel_id: m.channelId, sound: m.sound, tag: m.data.eventId } } } }),
          }, fetcher);
          return { state: 'accepted' };
        } catch (e) { return { ...classify(e.code, e.status), code: e.code || 'NETWORK', delay: e.retryAfter }; }
      }));
    },
  };
}

export function validWebEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      /^(fcm\.googleapis\.com|(?:[a-z0-9-]+\.)+push\.services\.mozilla\.com|web\.push\.apple\.com|(?:[a-z0-9-]+\.)+notify\.windows\.com)$/.test(url.hostname);
  } catch { return false; }
}
export async function webPushProvider(config) {
  const { default: webpush } = await import('web-push');
  return {
    async send(jobs) {
      return Promise.all(jobs.map(async job => {
        if (!validWebEndpoint(job.endpoint.token)) return { state: 'dead', code: 'INVALID_ENDPOINT', disable: true };
        const m = messageFor(job);
        try {
          await webpush.sendNotification(job.endpoint.subscription, JSON.stringify({ title: m.title, body: m.body, data: m.data }), {
            TTL: m.ttl, urgency: 'high', timeout: 15_000,
            vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
          });
          return { state: 'accepted' };
        } catch (e) { return { ...classify(null, e.statusCode), code: `WEB_${e.statusCode || 'NETWORK'}`, delay: Number(e.headers?.['retry-after']) || 0 }; }
      }));
    },
  };
}
