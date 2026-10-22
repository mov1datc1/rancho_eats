-- Local disposable database only. No provider calls. All fixture data is rolled back.
BEGIN;
CREATE FUNCTION pg_temp.assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',msg;END IF;END;$$;
CREATE FUNCTION pg_temp.reject(statement text) RETURNS void LANGUAGE plpgsql AS $$BEGIN BEGIN EXECUTE statement;EXCEPTION WHEN OTHERS THEN RETURN;END;RAISE EXCEPTION 'Expected rejection: %',statement;END;$$;
INSERT INTO auth.users(id,email) VALUES('00000000-0000-0000-0000-000000000001','admin@test.invalid'),('00000000-0000-0000-0000-000000000002','buyer@test.invalid');
INSERT INTO admin_profiles(id,email) VALUES('00000000-0000-0000-0000-000000000001','admin@test.invalid');
INSERT INTO restaurants(id,name,phone,email,type,owner_id,lat,lng,is_open,status) VALUES('00000000-0000-0000-0000-000000000010','QA','1234567890','qa@test.invalid','Restaurantes','00000000-0000-0000-0000-000000000001',20,-102,true,'ACTIVE');
ALTER TABLE orders DISABLE TRIGGER USER;
INSERT INTO orders(id,restaurant_id,client_user_id,client_name,client_phone,client_lat,client_lng,items,subtotal,commission_amount,delivery_amount,total,status,payment_method,delivery_type,created_at)
VALUES('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','QA','3300000000',20,-102,'[]',100,8,20,128,'DELIVERED','cash','delivery','2026-10-16 12:00-06');
ALTER TABLE orders ENABLE TRIGGER USER;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.reject($q$SELECT admin_commission_statement('2026-10-01','2026-10-31')$q$);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.assert((admin_commission_statement('2026-10-01','2026-10-31')->'balances'->0->>'due')::numeric=8,'only commission, not shipping');
SELECT pg_temp.reject($q$SELECT admin_collect_commissions('00000000-0000-0000-0000-000000000010','2026-10-01','2026-10-31',9,'QA receipt')$q$);
SELECT admin_collect_commissions('00000000-0000-0000-0000-000000000010','2026-10-01','2026-10-31',8,'QA receipt');
SELECT pg_temp.assert((admin_commission_statement('2026-10-01','2026-10-31')->'balances'->0->>'due')::numeric=0,'paid removed from balance');
SELECT pg_temp.reject($q$SELECT admin_collect_commissions('00000000-0000-0000-0000-000000000010','2026-10-16','2026-10-31',8,'duplicate overlapping cut')$q$);
SELECT pg_temp.assert((SELECT count(*)=1 FROM commission_payments),'one immutable receipt');
SELECT pg_temp.reject($q$SELECT admin_schedule_campaign('QA','test',NULL,'all',now()-interval '1 hour',1,7)$q$);
INSERT INTO notification_endpoints(app,user_id,provider,token) VALUES('client','00000000-0000-0000-0000-000000000002','expo','ExpoPushToken[local-test]');
INSERT INTO marketing_campaigns(id,title,body,audience,scheduled_at,created_by) VALUES('00000000-0000-0000-0000-000000000080','QA','test','all',now()-interval '1 minute','00000000-0000-0000-0000-000000000001');
SELECT process_marketing_campaigns();
DO $$BEGIN IF extract(hour FROM now() AT TIME ZONE 'America/Mexico_City') BETWEEN 9 AND 19 THEN
 PERFORM pg_temp.assert((SELECT count(*)=1 FROM marketing_contacts),'one account one promotion');
 INSERT INTO marketing_campaigns(title,body,audience,scheduled_at,created_by) VALUES('QA2','test2','all',now()-interval '1 minute','00000000-0000-0000-0000-000000000001');
 PERFORM process_marketing_campaigns();PERFORM pg_temp.assert((SELECT count(*)=1 FROM marketing_contacts),'global cap across campaigns');
 UPDATE notification_routes SET enabled=true WHERE app='client';
 PERFORM pg_temp.assert(jsonb_array_length(claim_notifications('client'))=1,'orderless campaign can be claimed');
END IF;END $$;
SELECT admin_cancel_campaign('00000000-0000-0000-0000-000000000080');
ROLLBACK;
