import test from 'node:test';
import assert from 'node:assert/strict';
import { backoff, classify, expoProvider, fcmProvider, jsonRequest, messageFor, validWebEndpoint } from '../providers.mjs';
import { eligible, runBatch, rpcClient } from '../worker.mjs';
import { generateKeyPairSync, createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';

const now = Date.now();
function job(id = 1) {
  return { id, lease_id: 'lease', attempts: 1, configured_provider: 'expo', current_status: 'ACCEPTED', current_revision: 2,
    endpoint: { active: true, app: 'client', provider: 'expo', token: 'ExpoPushToken[test]', user_id: 'u' },
    event: { id: `event-${id}`, audience: 'client', user_id: 'u', order_id: 'order-uuid', revision: 2, kind: 'order.accepted', title: 'Pedido aceptado', body: 'Revisa tu pedido', created_at: new Date(now).toISOString(), expires_at: new Date(now + 1800_000).toISOString() },
  };
}
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });

test('backoff is bounded and jittered', () => {
  assert.equal(backoff(1, () => 0), 1);
  assert.equal(backoff(99, () => 1), 900);
});
test('invalid tokens disable only that device; configuration errors are not retried endlessly', () => {
  assert.deepEqual(classify('DeviceNotRegistered'), { state: 'dead', disable: true });
  assert.equal(classify('UNREGISTERED').disable, true);
  assert.equal(classify('InvalidCredentials').disable, false);
  assert.equal(classify('InvalidCredentials').state, 'dead');
  assert.equal(classify(null, 429).state, 'pending');
  assert.equal(classify(null, 503).state, 'pending');
});
test('push payload carries event UUID and actual order UUID, with bounded TTL', () => {
  const m = messageFor(job(), now);
  assert.equal(m.ttl, 1800); assert.equal(m.data.orderId, 'order-uuid'); assert.equal(m.data.eventId, 'event-1');
  assert.equal(m.channelId, 'default');
});
test('private networks and attacker-controlled Web Push destinations are rejected', () => {
  for (const url of ['http://fcm.googleapis.com/a', 'https://127.0.0.1/a', 'https://fcm.googleapis.com.evil.test/a', 'https://fcm.googleapis.com:8443/a', 'https://user@fcm.googleapis.com/a']) assert.equal(validWebEndpoint(url), false);
  assert.equal(validWebEndpoint('https://fcm.googleapis.com/fcm/send/a'), true);
  assert.equal(validWebEndpoint('https://updates.push.services.mozilla.com/wpush/v2/a'), true);
});
test('Expo batches preserve ticket mapping and invalidate unregistered devices', async () => {
  let sent;
  const provider = expoProvider('server-secret', async (_url, opts) => {
    sent = JSON.parse(opts.body);
    return response({ data: [{ status: 'ok', id: 'ticket-1' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] });
  });
  const results = await provider.send([job(1), job(2)]);
  assert.equal(sent.length, 2); assert.equal(results[0].state, 'receipt'); assert.equal(results[0].delay, 900);
  assert.equal(results[1].disable, true);
});
test('Expo rejects mixed app batches before network I/O', async () => {
  const other = job(2); other.endpoint.app = 'restaurant';
  await assert.rejects(expoProvider(null, () => { throw new Error('Unexpected network'); }).send([job(), other]), /one app/);
});
test('missing Expo receipts are queried again without resending the notification', async () => {
  const provider = expoProvider(null, async () => response({ data: {} }));
  assert.equal((await provider.receipts([{ ...job(), ticket_id: 'ticket' }]))[0].state, 'receipt');
});
test('429 respects Retry-After', async () => {
  await assert.rejects(jsonRequest('https://provider.test', {}, async () => response({}, 429, { 'retry-after': '120' })), e => e.retryAfter === 120 && e.status === 429);
});
test('queued jobs expire for changed account, disabled token, old status and handled restaurant order', () => {
  const a = job(); a.endpoint.user_id = 'other'; assert.equal(eligible(a, false).code, 'OWNER_CHANGED');
  const b = job(); b.endpoint.active = false; assert.equal(eligible(b, false).code, 'ENDPOINT_DISABLED');
  const c = job(); c.current_status = 'DELIVERED'; assert.equal(eligible(c, false).code, 'SUPERSEDED');
  const d = job(); d.event.audience = 'restaurant'; d.event.kind = 'order.created'; assert.equal(eligible(d, false).code, 'ORDER_ALREADY_HANDLED');
});
test('receipts remain queryable after message TTL; eventually become an explicit dead letter', () => {
  const a = job(); a.event.expires_at = new Date(now - 1000).toISOString();
  assert.equal(eligible(a, false, now).state, 'expired'); assert.equal(eligible(a, true, now), null);
  assert.equal(eligible(a, true, now + 24 * 3600_000).code, 'RECEIPT_TIMEOUT');
});
test('timeout batches all retry results; failed acknowledgement leaves leases recoverable', async () => {
  const acknowledgements = [];
  const rpc = async (name, args) => {
    if (name === 'claim_notifications') return [job(1), job(2)];
    acknowledgements.push(...args.p_results);
    throw new Error('DB unavailable');
  };
  await assert.rejects(runBatch({ rpc, app: 'client', provider: { send: async () => { throw new Error('timeout'); } }, log: () => {} }), /acknowledgement/);
  assert.equal(acknowledgements.length, 2);
  assert.ok(acknowledgements.every(a => a.p_state === 'pending' && a.p_delay > 0));
});
test('max retries end in dead letter and no send occurs for expired jobs', async () => {
  const expired = job(1); expired.event.expires_at = new Date(now - 1000).toISOString();
  const last = job(2); last.attempts = 8;
  const acks = []; let sent;
  await runBatch({ app: 'client', rpc: async (name, args) => { if (name === 'claim_notifications') return [expired, last]; acks.push(...args.p_results); return args.p_results.map(r => ({ id: r.p_id, ack: true })); },
    provider: { send: async jobs => { sent = jobs; return [{ state: 'pending', code: 'HTTP_503' }]; } }, log: () => {} });
  assert.equal(sent.length, 1); assert.equal(acks[0].p_state, 'expired'); assert.equal(acks[1].p_state, 'dead');
});
test('FCM shares one OAuth refresh and emits notification payload with an event tag', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let oauthCalls = 0; const messages = [];
  const provider = fcmProvider({ project_id: 'test-project', client_email: 'test@test.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }, async (url, opts) => {
    if (url.includes('oauth2')) { oauthCalls++; return response({ access_token: 'fake-access', expires_in: 3600 }); }
    messages.push(JSON.parse(opts.body).message); return response({ name: 'projects/test/messages/id' });
  });
  await Promise.all([provider.send([job(1)]), provider.send([job(2)])]);
  assert.equal(oauthCalls, 1); assert.equal(messages.length, 2);
  assert.equal(messages[0].android.notification.tag, 'event-1');
});
test('Web Push library encrypts the payload and signs VAPID without exposing cleartext', () => {
  const client = createECDH('prime256v1'); client.generateKeys();
  const keys = webpush.generateVAPIDKeys();
  const request = webpush.generateRequestDetails({ endpoint: 'https://fcm.googleapis.com/fcm/send/test',
    keys: { p256dh: client.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } },
    'pedido-privado-de-prueba', { vapidDetails: { subject: 'mailto:test@example.com', ...keys } });
  assert.equal(request.headers['Content-Encoding'], 'aes128gcm');
  assert.ok(request.headers.Authorization.startsWith('vapid '));
  assert.ok(!request.body.toString().includes('pedido-privado-de-prueba'));
});

test('void maintenance RPC accepts HTTP 204 while malformed JSON fails', async () => {
 assert.equal(await rpcClient('https://example.test','server',async()=>new Response(null,{status:204}))('maintain_notifications',{}),null);
 await assert.rejects(()=>rpcClient('https://example.test','server',async()=>new Response('{bad',{status:200}))('claim_notifications',{}));
});
test('pending time proposal remains eligible until accepted or expired', () => {
 const j=job();j.current_status='PENDING';j.event.kind='order.time_proposal';assert.equal(eligible(j,false,now),null);
 j.current_status='ACCEPTED';assert.equal(eligible(j,false,now).code,'ORDER_ALREADY_HANDLED');
});
