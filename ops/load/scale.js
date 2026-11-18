// Staging-only capacity search for anonymous catalog/menu HTTP (no writes, Maps, push or email).
// Uses arrival rate (requests/s) so a saturated backend shows up as latency/drops, not as fewer requests.
// User equivalence assumption: one active app user ≈ 0.2 req/s (2 requests per ~10 s browsing).
import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';
const target = 'https://rganzksyljjerfuowodi.supabase.co';
if (__ENV.STAGING_URL !== target || !__ENV.STAGING_ANON_KEY) throw Error('Explicit isolated staging URL and public key required');
const key = __ENV.STAGING_ANON_KEY;
if (!key.startsWith('sb_publishable_')) {
  const encoding = require('k6/encoding');
  const claims = JSON.parse(encoding.b64decode(key.split('.')[1], 'rawurl', 's'));
  if (claims.role !== 'anon' || claims.ref !== 'rganzksyljjerfuowodi') throw Error('Staging anon key required');
}
const ids = JSON.parse(open(__ENV.FIXTURE_PATH)).businesses;
if (!Array.isArray(ids) || ids.length !== 100) throw Error('Synthetic fixture receipt required');
// Requests/s per stage. 200≈1k users, 400≈2k, 700≈3.5k, 1000≈5k (0.2 req/s per user).
const steps = (__ENV.STEPS || '20,50,100,200,400,700,1000').split(',').map(Number);
if (steps.some(s => !(s > 0 && s <= 1200))) throw Error('Step outside reviewed range');
const holdSeconds = Number(__ENV.HOLD_SECONDS || 90), hold = `${holdSeconds}s`;
const stages = steps.flatMap(rate => [{ duration: '30s', target: rate }, { duration: hold, target: rate }]);
const perStep = {};
for (const rate of steps) { perStep[`http_req_duration{step:${rate}}`] = ['p(95)<1500']; perStep[`http_req_failed{step:${rate}}`] = ['rate<0.01']; }
stages.push({ duration: '10s', target: 0 });
const invalid = new Rate('invalid_response');
const catalogMs = new Trend('catalog_ms', true), menuMs = new Trend('menu_ms', true);
export const options = {
  scenarios: { scale: { executor: 'ramping-arrival-rate', startRate: 5, timeUnit: '1s', preAllocatedVUs: 300, maxVUs: Number(__ENV.MAX_VUS || 3000), stages } },
  dns: { ttl: '5m', select: 'roundRobin', policy: 'preferIPv4' },
  discardResponseBodies: false,
  thresholds: {
    // Safety stop: abort the whole run if staging starts failing broadly.
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' }],
    invalid_response: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' }],
    http_req_duration: ['p(95)<1500'],
    ...perStep,
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};
const params = (operation, step) => ({ headers: { apikey: key, ...(!key.startsWith('sb_publishable_') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip' }, timeout: '15s', redirects: 0, tags: { operation, step: String(step) }, responseType: 'text' });
function valid(r, name) {
  const ok = r.status === 200 && typeof r.body === 'string' && r.body.length > 2 && r.body[0] === '[';
  invalid.add(!ok); check(r, { [name]: () => ok }); return ok;
}
export function setup() { return { t0: Date.now() }; }
export default function ({ t0 }) {
  const step = steps[Math.min(steps.length - 1, Math.floor((Date.now() - t0) / 1000 / (30 + holdSeconds)))];
  if (Math.random() < 0.35) {
    const r = http.post(`${target}/rest/v1/rpc/customer_businesses`, '{}', params('catalog', step));
    catalogMs.add(r.timings.duration); valid(r, 'catalog ok');
  } else {
    const id = ids[Math.floor(Math.random() * ids.length)];
    const r = http.get(`${target}/rest/v1/menu_items?select=*&restaurant_id=eq.${id}&available=eq.true&order=sort_order.asc,category.asc`, params('menu', step));
    menuMs.add(r.timings.duration); valid(r, 'menu ok');
  }
}
export function handleSummary(data) {
  const report = { date: new Date().toISOString(), tool: 'k6', target, scope: 'anonymous catalog/menu HTTP, arrival-rate', steps, holdSeconds, metrics: data.metrics, state: data.state };
  return { [__ENV.SUMMARY_PATH || 'scale-summary.json']: JSON.stringify(report, null, 2), stdout: '' };
}