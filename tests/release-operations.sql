-- Disposable PostgreSQL only; rollback all QA records.
BEGIN;
ALTER TABLE orders DISABLE TRIGGER trg_notify_driver_assignment;
ALTER TABLE orders DISABLE TRIGGER trg_order_status_push;
CREATE FUNCTION pg_temp.assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',msg;END IF;END;$$;
CREATE FUNCTION pg_temp.reject(statement text,pattern text) RETURNS void LANGUAGE plpgsql AS $$BEGIN BEGIN EXECUTE statement;EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT ILIKE '%'||pattern||'%' THEN RAISE EXCEPTION 'Unexpected error: %',SQLERRM;END IF;RETURN;END;RAISE EXCEPTION 'Expected rejection: %',pattern;END;$$;
INSERT INTO auth.users(id,email) VALUES('00000000-0000-0000-0000-000000000001','owner@test.invalid'),('00000000-0000-0000-0000-000000000002','client@test.invalid'),('00000000-0000-0000-0000-000000000003','other@test.invalid');
INSERT INTO restaurants(id,name,phone,email,type,owner_id,lat,lng,is_open,status) VALUES('00000000-0000-0000-0000-000000000010','QA','1234567890','qa@test.invalid','Restaurantes','00000000-0000-0000-0000-000000000001',20,-102,true,'ACTIVE');
INSERT INTO app_categories(id,name,emoji,release_mode,is_active) VALUES('00000000-0000-0000-0000-000000000011','Restaurantes','R','public',true);
INSERT INTO menu_items(id,restaurant_id,name,price) VALUES('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000010','QA Pizza',100);
INSERT INTO driver_profiles(id,restaurant_id,name,phone,access_token) VALUES('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010','QA Driver','3312345678','qa-driver-code-12345678901234567890');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
INSERT INTO orders(id,restaurant_id,client_user_id,client_name,client_phone,client_lat,client_lng,items,subtotal,commission_amount,delivery_amount,total,status,payment_method,delivery_type) VALUES('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','QA','3300000000',20,-102,'[{"id":"00000000-0000-0000-0000-000000000012","name":"QA Pizza","price":100,"quantity":1}]',100,8,0,108,'PENDING','cash','delivery');
SELECT pg_temp.assert((SELECT response_deadline-created_at=interval '10 minutes' FROM orders LIMIT 1),'10 minute deadline');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT merchant_propose_time('00000000-0000-0000-0000-000000000030',now()+interval '30 minutes',now()+interval '50 minutes');
SELECT pg_temp.reject($q$UPDATE orders SET status='ACCEPTED' WHERE id='00000000-0000-0000-0000-000000000030'$q$,'aprobación');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT client_accept_time('00000000-0000-0000-0000-000000000030');
SELECT pg_temp.reject($q$SELECT client_cancel_order('00000000-0000-0000-0000-000000000030')$q$,'ya respondió');
SELECT driver_set_shift('qa-driver-code-12345678901234567890',now()+interval '4 hours');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
UPDATE orders SET delivery_driver_id='00000000-0000-0000-0000-000000000020' WHERE id='00000000-0000-0000-0000-000000000030';
SELECT (driver_take_order('qa-driver-code-12345678901234567890','00000000-0000-0000-0000-000000000030')).status;
-- A second reservation cannot become a second physical delivery.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
INSERT INTO orders(id,restaurant_id,client_user_id,client_name,client_phone,client_lat,client_lng,items,subtotal,commission_amount,delivery_amount,total,status,payment_method,delivery_type)
SELECT '00000000-0000-0000-0000-000000000034',restaurant_id,client_user_id,client_name,client_phone,client_lat,client_lng,items,100,8,0,108,'PENDING','cash','delivery' FROM orders LIMIT 1;
SELECT pg_temp.reject($q$INSERT INTO orders(restaurant_id,client_user_id,client_name,client_phone,client_lat,client_lng,items,subtotal,commission_amount,delivery_amount,total,status,payment_method,delivery_type) SELECT restaurant_id,client_user_id,client_name,client_phone,client_lat,client_lng,items,100,8,0,108,'PENDING','card','delivery' FROM orders LIMIT 1$q$,'efectivo');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
UPDATE orders SET status='ACCEPTED',delivery_driver_id='00000000-0000-0000-0000-000000000020' WHERE id='00000000-0000-0000-0000-000000000034';
SELECT pg_temp.reject($q$SELECT driver_take_order('qa-driver-code-12345678901234567890','00000000-0000-0000-0000-000000000034')$q$,'liquida');
UPDATE courier_shifts SET available_until=now()-interval '1 second';
SELECT expire_courier_shifts();
SELECT pg_temp.assert((SELECT delivery_driver_id IS NULL FROM orders WHERE id='00000000-0000-0000-0000-000000000034'),'expired shift releases reservations');
SELECT pg_temp.assert((SELECT delivery_driver_id IS NOT NULL AND status='ON_THE_WAY' FROM orders WHERE id='00000000-0000-0000-0000-000000000030'),'expiry preserves active custody');
SELECT driver_set_shift('qa-driver-code-12345678901234567890',now()+interval '4 hours');
SELECT pg_temp.reject($q$SELECT driver_complete_cash('qa-driver-code-12345678901234567890','00000000-0000-0000-0000-000000000030',0)$q$,'no coincide');
SELECT driver_complete_cash('qa-driver-code-12345678901234567890','00000000-0000-0000-0000-000000000030',108);
SELECT pg_temp.assert(EXISTS(SELECT 1 FROM delivery_cycles WHERE state='RETURNING' AND closed_at IS NULL),'delivered is not settled');
SELECT driver_complete_cash('qa-driver-code-12345678901234567890','00000000-0000-0000-0000-000000000030',108);
SELECT pg_temp.reject($q$SELECT driver_return_order('qa-driver-code-12345678901234567890','00000000-0000-0000-0000-000000000030','Intento de devolución después de cobrar')$q$,'cobrada');
SELECT merchant_settle_cycle((SELECT id FROM delivery_cycles LIMIT 1),100,'Faltan ocho pesos');
SELECT pg_temp.assert(EXISTS(SELECT 1 FROM order_incidents WHERE cause='CASH'),'cash discrepancy incident');
SELECT pg_temp.assert(EXISTS(SELECT 1 FROM delivery_cycles WHERE closed_at IS NULL),'difference blocks release');
SELECT merchant_settle_cycle((SELECT id FROM delivery_cycles LIMIT 1),108,'Recibido exacto por caja');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM delivery_cycles WHERE closed_at IS NULL),'settlement closes custody');
UPDATE app_categories SET release_mode='pilot';
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
SELECT pg_temp.assert(NOT can_order_business('00000000-0000-0000-0000-000000000010'),'pilot denies unlisted users');
INSERT INTO category_pilots VALUES('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000003');
SELECT pg_temp.assert(can_order_business('00000000-0000-0000-0000-000000000010'),'pilot allows exact user and business');
SELECT cancel_orphan_orders();
SELECT pg_temp.assert((SELECT status='DELIVERED' FROM orders WHERE id='00000000-0000-0000-0000-000000000030'),'completed order never expires');
-- A new pending request expires, while an active route becomes an incident.
UPDATE app_categories SET release_mode='public';
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
INSERT INTO orders(id,restaurant_id,client_user_id,client_name,client_phone,client_lat,client_lng,items,subtotal,commission_amount,delivery_amount,total,status,payment_method,delivery_type)
SELECT '00000000-0000-0000-0000-000000000031',restaurant_id,client_user_id,client_name,client_phone,client_lat,client_lng,items,100,8,0,108,'PENDING','cash','delivery' FROM orders LIMIT 1;
UPDATE orders SET response_deadline=now()-interval '1 second' WHERE id='00000000-0000-0000-0000-000000000031';
SELECT pg_temp.reject($q$UPDATE orders SET status='ACCEPTED' WHERE id='00000000-0000-0000-0000-000000000031'$q$,'Venció');
SELECT cancel_orphan_orders();
SELECT pg_temp.assert((SELECT status='CANCELLED' FROM orders WHERE id='00000000-0000-0000-0000-000000000031'),'pending expiration');
-- Missing inventory must not dispatch an empty basket or charge its fees.
INSERT INTO app_categories(name,emoji,flow_type,release_mode,is_active) VALUES('Frutería','F','picked','public',true);
UPDATE restaurants SET type='Frutería';
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
INSERT INTO orders(id,restaurant_id,client_user_id,client_name,client_phone,client_lat,client_lng,items,subtotal,commission_amount,delivery_amount,total,status,payment_method,delivery_type)
SELECT '00000000-0000-0000-0000-000000000032',restaurant_id,client_user_id,client_name,client_phone,client_lat,client_lng,items,100,8,0,108,'PENDING','cash','delivery' FROM orders LIMIT 1;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
UPDATE orders SET status='ACCEPTED' WHERE id='00000000-0000-0000-0000-000000000032';
SELECT count(*) FROM merchant_start_picking('00000000-0000-0000-0000-000000000032');
SELECT pg_temp.reject(format($fmt$SELECT merchant_pick_item(%L,'SUBSTITUTED',NULL,'Otra cosa',100)$fmt$,(SELECT id FROM order_picking_items LIMIT 1)),'piloto');
SELECT (merchant_pick_item((SELECT id FROM order_picking_items LIMIT 1),'UNAVAILABLE')).status;
SELECT merchant_finish_picking('00000000-0000-0000-0000-000000000032');
SELECT pg_temp.assert((SELECT status='CANCELLED' AND total=0 AND delivery_amount=0 FROM orders WHERE id='00000000-0000-0000-0000-000000000032'),'empty basket cancels without fees');

SELECT pg_temp.assert((operations_metrics(7)->>'total')::integer=4,'server metrics count the full filtered set');
SELECT pg_temp.assert((operations_metrics(7)->>'cash_pending')::numeric=0,'settled cash is excluded');
-- Exercise direct merchant transitions under the actual authenticated role.
UPDATE restaurants SET type='Restaurantes';
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
INSERT INTO orders(id,restaurant_id,client_user_id,client_name,client_phone,client_lat,client_lng,items,subtotal,commission_amount,delivery_amount,total,status,payment_method,delivery_type)
SELECT '00000000-0000-0000-0000-000000000035',restaurant_id,client_user_id,client_name,client_phone,client_lat,client_lng,items,100,8,0,108,'PENDING','cash','delivery' FROM orders LIMIT 1;
-- Access checks use real SQL roles, not only owner-executed functions.
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
UPDATE orders SET status='ACCEPTED' WHERE id='00000000-0000-0000-0000-000000000035';
UPDATE orders SET status='READY' WHERE id='00000000-0000-0000-0000-000000000035';
SELECT pg_temp.assert((SELECT status='READY' AND accepted_at IS NOT NULL FROM orders WHERE id='00000000-0000-0000-0000-000000000035'),'merchant accepts and prepares through real RLS');
SELECT pg_temp.reject($q$UPDATE orders SET commission_amount=0 WHERE id='00000000-0000-0000-0000-000000000030'$q$,'operaciones autorizadas');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.reject($q$SELECT operations_metrics(7)$q$,'No autorizado');
SELECT pg_temp.assert((SELECT count(*) FROM orders)=0,'another customer cannot read orders');
RESET ROLE;
SELECT 'PASS: deadline, consent, cancellation, shifts, cash, discrepancy, settlement, pilot, expiry, RLS' AS result;
ROLLBACK;
