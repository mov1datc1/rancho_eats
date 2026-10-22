// Deliberately hardcoded to the throwaway local PostgreSQL fixture, never production.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
const args = ['-h', '/private/tmp', '-p', '55439', '-d', 'pideya_notification_qa', '-v', 'ON_ERROR_STOP=1', '-At'];
const sql = async query => (await exec('/opt/homebrew/opt/postgresql@14/bin/psql', [...args, '-c', query], { maxBuffer: 32 * 1024 * 1024 })).stdout.trim();
const started = Date.now();
await sql(`
 INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000002');
 INSERT INTO restaurants VALUES ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
 SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
 SELECT register_notification_endpoint('restaurant','expo','ExpoPushToken[load-test]');
 UPDATE notification_routes SET capture_enabled=true,enabled=true;
 INSERT INTO orders(restaurant_id,status) SELECT '10000000-0000-0000-0000-000000000001','PENDING' FROM generate_series(1,50000);
`);
const insertedMs = Date.now() - started;
assert.equal(await sql('SELECT count(*) FROM notification_deliveries'), '50000');
const startClaims = Date.now();
const waves = await Promise.all(Array.from({ length: 8 }, () => sql("SELECT claim_notifications('restaurant')").then(JSON.parse)));
const jobs = waves.flat();
assert.ok(jobs.length >= 100 && jobs.length <= 800);
assert.equal(new Set(jobs.map(j => j.id)).size, jobs.length, 'Concurrent workers must never share a leased job');
const old = jobs[0];
await sql(`UPDATE notification_deliveries SET lease_until=now()-interval '1 second' WHERE state='sending'; UPDATE notification_routes SET next_send_at=now();`);
const recovered = JSON.parse(await sql("SELECT claim_notifications('restaurant')"));
assert.equal(recovered[0].id, old.id);
assert.notEqual(recovered[0].lease_id, old.lease_id);
assert.equal(await sql(`SELECT finish_notification(${old.id},'${old.lease_id}','accepted')`), 'f');
// Acknowledging with the new fence succeeds; rate-limit error pauses the whole route.
assert.equal(await sql(`SELECT finish_notification(${recovered[0].id},'${recovered[0].lease_id}','pending','HTTP_429',NULL,120)`), 't');
assert.equal(await sql("SELECT next_send_at>now()+interval '110 seconds' FROM notification_routes WHERE app='restaurant'"), 't');
console.log(JSON.stringify({ syntheticOrders: 50000, durableDeliveries: 50000, insertionMs: insertedMs, concurrentWorkers: 8, uniqueClaimed: jobs.length, claimsAndRecoveryMs: Date.now() - startClaims, staleLeaseRejected: true, sharedThrottle: true }));
await sql("DELETE FROM orders; DELETE FROM notification_endpoints; DELETE FROM restaurants; DELETE FROM auth.users; UPDATE notification_routes SET enabled=false,capture_enabled=false;");
