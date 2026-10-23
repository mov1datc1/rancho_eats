-- Disposable local database only. No outbound provider calls. Entire fixture rolls back.
BEGIN;
CREATE FUNCTION pg_temp.assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',msg;END IF;END$$;
INSERT INTO auth.users(id,email) SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'qa'||i||'@test.invalid' FROM generate_series(1,5)i;
INSERT INTO admin_profiles(id,email) VALUES('00000000-0000-0000-0000-000000000001','qa1@test.invalid');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
INSERT INTO app_categories(name,emoji,flow_type,is_active,release_mode,sort_order) VALUES('Restaurantes','','prepared',true,'public',10);
INSERT INTO restaurants(id,name,phone,email,type,lat,lng,address,owner_id) SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'QA Shop '||i,'3300000000','shop'||i||'@test.invalid','Restaurantes',20,-102,'Prueba domicilio 123','00000000-0000-0000-0000-000000000001' FROM generate_series(10,11)i;
UPDATE restaurants SET location_verified_at=now(),status='ACTIVE',is_open=true;
INSERT INTO notification_endpoints(app,user_id,provider,token,active) SELECT 'client',id,'expo','ExpoPushToken[qa'||right(id::text,1)||']',true FROM auth.users WHERE id<>'00000000-0000-0000-0000-000000000001';
INSERT INTO client_addresses(user_id,label,address_text,latitude,longitude,is_default) SELECT id,'QA','Domicilio QA',20,-102,true FROM auth.users WHERE id<>'00000000-0000-0000-0000-000000000001';
-- Historical delivered fixtures bypass order-admission triggers only in this disposable transaction.
ALTER TABLE orders DISABLE TRIGGER USER;
ALTER TABLE orders ALTER COLUMN client_lat SET DEFAULT 20;
ALTER TABLE orders ALTER COLUMN client_lng SET DEFAULT -102;
ALTER TABLE orders ALTER COLUMN reference_code SET DEFAULT gen_random_uuid()::text;
INSERT INTO orders(restaurant_id,client_user_id,client_name,client_phone,status,subtotal,commission_amount,delivery_amount,total,items,created_at,delivered_at,delivery_type,client_lat,client_lng)
SELECT '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','QA','3300000000','DELIVERED',200,8,0,208,'[]',now()-make_interval(days=>i),now()-make_interval(days=>i),'delivery',20,-102 FROM generate_series(1,3)i;
INSERT INTO orders(restaurant_id,client_user_id,client_name,client_phone,status,subtotal,total,items,created_at,delivered_at)
VALUES('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000003','QA','3300000000','DELIVERED',100,100,'[]',now()-interval '40 days',now()-interval '40 days'),('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000004','QA','3300000000','CANCELLED',100,100,'[]',now()-interval '1 day',NULL);
ALTER TABLE orders ENABLE TRIGGER USER;
SELECT pg_temp.assert(marketing_matches('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000010','frequent',30,3,500),'frequent three delivered');
SELECT pg_temp.assert(NOT marketing_matches('00000000-0000-0000-0000-000000000002',NULL,'occasional',30,3,500),'frequent and occasional disjoint');
SELECT pg_temp.assert(marketing_matches('00000000-0000-0000-0000-000000000002',NULL,'high_value',30,3,500),'spend threshold products only');
SELECT pg_temp.assert(NOT marketing_matches('00000000-0000-0000-0000-000000000002',NULL,'high_value',30,3,610),'exclude fees from spend');
SELECT pg_temp.assert(marketing_matches('00000000-0000-0000-0000-000000000003',NULL,'lapsed',30,3,500),'lapsed known purchaser');
SELECT pg_temp.assert(NOT marketing_matches('00000000-0000-0000-0000-000000000005',NULL,'lapsed',30,3,500),'never is not lapsed');
SELECT pg_temp.assert(marketing_matches('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000010','never',30,3,500),'never scoped to business');
SELECT pg_temp.assert(marketing_matches('00000000-0000-0000-0000-000000000004',NULL,'never',30,3,500),'cancelled order is not purchase');
SELECT pg_temp.assert((admin_campaign_preview(NULL,'never')->>'eligible')::int=2,'global never count');
SELECT pg_temp.assert((admin_campaign_preview('00000000-0000-0000-0000-000000000010','never')->>'eligible')::int=3,'business never count');
UPDATE client_addresses SET latitude=25 WHERE user_id='00000000-0000-0000-0000-000000000005';
SELECT pg_temp.assert(marketing_exclusion('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000010')='outside_coverage','coverage');
DELETE FROM client_addresses WHERE user_id='00000000-0000-0000-0000-000000000005';
SELECT pg_temp.assert(marketing_exclusion('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000010')='unknown_location','no invented address');
INSERT INTO marketing_preferences(user_id,enabled) VALUES('00000000-0000-0000-0000-000000000004',false);
SELECT pg_temp.assert(marketing_exclusion('00000000-0000-0000-0000-000000000004',NULL)='opted_out','opt out');
SELECT admin_schedule_targeted_campaign('QA','No enviar','00000000-0000-0000-0000-000000000010','frequent',((now() AT TIME ZONE 'America/Mexico_City')::date+1+time '12:00') AT TIME ZONE 'America/Mexico_City',1,7,30,3,500,100);
SELECT pg_temp.assert((SELECT min_orders=3 AND sponsor_fee=100 FROM marketing_campaigns),'target parameters persisted');
INSERT INTO marketing_contacts(campaign_id,user_id,run_number) SELECT id,'00000000-0000-0000-0000-000000000002',1 FROM marketing_campaigns;
SELECT pg_temp.assert(marketing_exclusion('00000000-0000-0000-0000-000000000002',NULL)='frequency_cap','frequency global');
SELECT pg_temp.assert(marketing_exclusion('00000000-0000-0000-0000-000000000002',NULL,false) IS NULL,'own reservation does not suppress dispatch');
SELECT pg_temp.assert(jsonb_array_length(admin_campaign_report())=1,'campaign outcome report executes');
-- Exercise the actual batching body, replacing only the clock gate in a temporary copy.
DO $test$DECLARE source text;BEGIN
 source=pg_get_functiondef('process_marketing_campaigns()'::regprocedure);
 source=replace(source,'public.process_marketing_campaigns()','pg_temp.process_marketing_campaigns_test()');
 source=replace(source,'IF h<9 OR h>=20 THEN RETURN;END IF;','');
 EXECUTE source;
END $test$;
UPDATE marketing_contacts SET reserved_at=now()-interval '8 days';
-- Prior contact belongs to an earlier repetition; allow this run to reserve a new contact.
UPDATE marketing_contacts SET run_number=0;
UPDATE marketing_campaigns SET scheduled_at=now()-interval '1 minute';
SELECT pg_temp.process_marketing_campaigns_test();
SELECT pg_temp.assert((SELECT count(*)=1 FROM notification_events WHERE kind='marketing.campaign'),'one eligible account queued');
SELECT pg_temp.assert((SELECT count(*)=1 FROM notification_deliveries),'one endpoint per account');
SELECT pg_temp.process_marketing_campaigns_test();
SELECT pg_temp.assert((SELECT count(*)=1 FROM notification_events WHERE kind='marketing.campaign'),'completed batch is idempotent');
-- This is only a local provider receipt fixture; no provider request is made.
UPDATE notification_deliveries SET state='accepted',updated_at=now()-interval '1 hour';
ALTER TABLE orders DISABLE TRIGGER USER;
INSERT INTO orders(restaurant_id,client_user_id,client_name,client_phone,status,subtotal,total,items,created_at,delivered_at) VALUES('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','QA','3300000000','DELIVERED',100,100,'[]',now()-interval '30 minutes',now());
ALTER TABLE orders ENABLE TRIGGER USER;
SELECT pg_temp.assert((admin_campaign_report()->0->>'associated_orders')::int=1,'post-contact delivered order associated once');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','marketing_matches(uuid,uuid,text,integer,integer,numeric,timestamptz)','EXECUTE'),'private history helper');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
DO $$BEGIN PERFORM admin_campaign_preview(NULL,'all');RAISE EXCEPTION 'unauthorized preview allowed';EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'No autorizado' THEN RAISE;END IF;END$$;
ROLLBACK;
