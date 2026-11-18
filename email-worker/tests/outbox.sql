\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.check_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label;END IF;RAISE NOTICE 'PASS: %',label;END $$;
INSERT INTO auth.users VALUES('00000000-0000-0000-0000-000000000001','verified@example.com',now()),('00000000-0000-0000-0000-000000000002','unverified@example.com',NULL);
INSERT INTO restaurants VALUES('00000000-0000-0000-0000-000000000010','Prueba');
INSERT INTO orders(id,client_user_id,restaurant_id,status,reference_code,order_number,items,total,delivery_amount,commission_amount,payment_method)
SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','READY','PY-TEST'||i,i,
 '[{"name":"Pizza","qty":1,"unit_price":100,"options":[{"label":"Extra","price":10}],"notes":"PRIVATE NOTE"}]',145,20,15,'cash' FROM generate_series(100,110) i;
UPDATE orders SET status='DELIVERED' WHERE order_number=100;
SELECT pg_temp.check_true((SELECT count(*)=0 FROM order_receipt_emails),'capture disabled by default');
UPDATE order_email_channel SET capture_enabled=true;
UPDATE orders SET status='DELIVERED' WHERE order_number=101;
SELECT pg_temp.check_true((SELECT count(*)=1 FROM order_receipt_emails),'delivered transition captures verified account');
SELECT pg_temp.check_true((SELECT snapshot->'items'->0->>'amount'='110.00' AND snapshot->>'total'='145' AND snapshot::text NOT LIKE '%PRIVATE NOTE%' FROM order_receipt_emails),'extras included; private notes omitted');
UPDATE orders SET status='DELIVERED' WHERE order_number=101;
UPDATE orders SET status='READY' WHERE order_number=101;
UPDATE orders SET status='DELIVERED' WHERE order_number=101;
SELECT pg_temp.check_true((SELECT count(*)=1 FROM order_receipt_emails),'replayed transitions do not duplicate');
UPDATE orders SET client_user_id='00000000-0000-0000-0000-000000000002',status='DELIVERED' WHERE order_number=102;
UPDATE orders SET client_user_id=NULL,status='DELIVERED' WHERE order_number=103;
SELECT pg_temp.check_true((SELECT count(*)=1 FROM order_receipt_emails),'unverified and guest accounts skipped');
SELECT pg_temp.check_true(claim_order_receipt_emails()='[]','send disabled by default');
UPDATE order_email_channel SET send_enabled=true;
CREATE TEMP TABLE claimed AS SELECT value job FROM jsonb_array_elements(claim_order_receipt_emails());
SELECT pg_temp.check_true((SELECT count(*)=1 FROM claimed),'claim returns ready job');
SELECT pg_temp.check_true(claim_order_receipt_emails()='[]','active lease cannot be claimed twice');
SELECT pg_temp.check_true(prepare_order_receipt_email((job->>'id')::uuid,gen_random_uuid(),jsonb_build_object('to',jsonb_build_array('verified@example.com'))) IS NULL,'stale lease cannot prepare') FROM claimed;
SELECT prepare_order_receipt_email((job->>'id')::uuid,(job->>'lease_id')::uuid,'{"to":["verified@example.com"],"html":"frozen"}') FROM claimed;
SELECT pg_temp.check_true(prepare_order_receipt_email((job->>'id')::uuid,(job->>'lease_id')::uuid,'{"to":["verified@example.com"],"html":"changed"}')->>'html'='frozen','retry request remains immutable') FROM claimed;
SELECT pg_temp.check_true(NOT finish_order_receipt_email((job->>'id')::uuid,gen_random_uuid(),'accepted'),'stale ack rejected') FROM claimed;
SELECT finish_order_receipt_email((job->>'id')::uuid,(job->>'lease_id')::uuid,'accepted',NULL,'provider-test') FROM claimed;
SELECT pg_temp.check_true(claim_order_receipt_emails()='[]','accepted mail not resent');
-- Final picking prices replace requested products/quantities and original total.
INSERT INTO order_picking_items(order_id,requested_name,substitute_name,picked_quantity,picked_price,status)
VALUES('00000000-0000-0000-0000-000000000104','Requested','Substitute',0.5,50,'SUBSTITUTED'),
('00000000-0000-0000-0000-000000000104','Unavailable',NULL,0,0,'UNAVAILABLE');
UPDATE orders SET adjusted_total=85,status='DELIVERED' WHERE order_number=104;
SELECT pg_temp.check_true((SELECT snapshot->>'total'='85' AND snapshot->>'subtotal'='50' AND jsonb_array_length(snapshot->'items')=1 AND snapshot->'items'->0->>'name'='Substitute' FROM order_receipt_emails WHERE order_id='00000000-0000-0000-0000-000000000104'),'picking uses final actual products and total');
UPDATE auth.users SET email='changed@example.com' WHERE id='00000000-0000-0000-0000-000000000001';
SELECT pg_temp.check_true(claim_order_receipt_emails()='[]','changed account address not redirected');
SELECT pg_temp.check_true((SELECT state='skipped' FROM order_receipt_emails WHERE order_id='00000000-0000-0000-0000-000000000104'),'changed recipient recorded as skipped');
UPDATE orders SET status='DELIVERED' WHERE order_number BETWEEN 105 AND 107;
UPDATE order_receipt_emails SET state='sending',first_attempt_at=now()-interval '24 hours',lease_until=now()-interval '1 minute' WHERE order_id='00000000-0000-0000-0000-000000000105';
UPDATE order_receipt_emails SET attempts=8 WHERE order_id='00000000-0000-0000-0000-000000000106';
UPDATE order_receipt_emails SET state='sending',attempts=1,first_attempt_at=now()-interval '1 hour',lease_until=now()-interval '1 minute' WHERE order_id='00000000-0000-0000-0000-000000000107';
SELECT pg_temp.check_true(jsonb_array_length(claim_order_receipt_emails())=1,'abandoned lease recovers, exhausted and old jobs stop');
SELECT pg_temp.check_true((SELECT count(*)=2 FROM order_receipt_emails WHERE state='dead'),'attempt and idempotency horizons enforced');
UPDATE orders SET items='[{"name":"Bad","qty":"invalid"}]',status='DELIVERED' WHERE order_number=108;
SELECT pg_temp.check_true((SELECT status='DELIVERED' FROM orders WHERE order_number=108) AND (SELECT capture_errors=1 FROM order_email_channel),'capture error never blocks order and records alert');
SELECT pg_temp.check_true(NOT has_table_privilege('anon','order_receipt_emails','SELECT') AND NOT has_table_privilege('authenticated','order_receipt_emails','SELECT'),'private queue inaccessible to app roles');
SELECT pg_temp.check_true(NOT has_function_privilege('authenticated','claim_order_receipt_emails()','EXECUTE') AND has_function_privilege('service_role','claim_order_receipt_emails()','EXECUTE'),'claim restricted to server service role');
ROLLBACK;
