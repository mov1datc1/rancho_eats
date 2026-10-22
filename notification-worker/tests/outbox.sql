\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
INSERT INTO restaurants VALUES ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
INSERT INTO driver_profiles VALUES ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','driver-test-token-not-a-secret',true);
UPDATE notification_routes SET capture_enabled=true,enabled=true;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SELECT register_notification_endpoint('client','expo','ExpoPushToken[client-test]');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SELECT register_notification_endpoint('restaurant','expo','ExpoPushToken[restaurant-test]');
SET LOCAL request.jwt.claim.sub='';
SELECT register_notification_endpoint('driver','expo','ExpoPushToken[driver-test]',NULL,'driver-test-token-not-a-secret');
INSERT INTO orders(id,restaurant_id,client_user_id,status) VALUES('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','PENDING');
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM notification_deliveries; ASSERT n=1,'New order must enqueue restaurant';
 UPDATE orders SET driver_last_lat=21.4;
 SELECT count(*) INTO n FROM notification_events; ASSERT n=1,'GPS must not emit notices';
 UPDATE orders SET status='ACCEPTED';
 SELECT count(*) INTO n FROM notification_deliveries; ASSERT n=2,'Status must enqueue client';
 UPDATE orders SET status='ACCEPTED';
 SELECT count(*) INTO n FROM notification_events; ASSERT n=2,'Repeated status must not enqueue';
 UPDATE orders SET delivery_driver_id='20000000-0000-0000-0000-000000000001';
 SELECT count(*) INTO n FROM notification_events WHERE audience='driver'; ASSERT n=1,'Assignment must enqueue driver';
 UPDATE orders SET delivery_driver_id=NULL;
 SELECT count(*) INTO n FROM notification_events WHERE kind='driver.unassigned'; ASSERT n=1,'Unassignment must enqueue previous driver';
END $$;
DO $$ DECLARE jobs jsonb; again jsonb; j jsonb; ok boolean; BEGIN
 jobs:=claim_notifications('client'); ASSERT jsonb_array_length(jobs)=1,'Must claim exactly one client job';
 again:=claim_notifications('client'); ASSERT jsonb_array_length(again)=0,'Lease and throttle prevent duplicate claims';
 j:=jobs->0;
 ok:=finish_notification((j->>'id')::bigint,gen_random_uuid(),'accepted'); ASSERT NOT ok,'Wrong lease must not acknowledge';
 ok:=finish_notification((j->>'id')::bigint,(j->>'lease_id')::uuid,'receipt',NULL,'ticket-test',0); ASSERT ok;
 jobs:=claim_notifications('client',true); ASSERT jsonb_array_length(jobs)=1,'Receipt jobs remain durable';
 j:=jobs->0;
 ok:=finish_notification((j->>'id')::bigint,(j->>'lease_id')::uuid,'dead','DeviceNotRegistered',NULL,0,true); ASSERT ok;
 ASSERT NOT (SELECT active FROM notification_endpoints WHERE token='ExpoPushToken[client-test]'),'Invalid token disabled';
END $$;
DO $$ DECLARE jobs jsonb; j jsonb; result jsonb; BEGIN
 jobs:=claim_notifications('restaurant'); j:=jobs->0;
 result:=finish_notifications(jsonb_build_array(jsonb_build_object('p_id',j->>'id','p_lease',j->>'lease_id','p_state','accepted')));
 ASSERT (result->0->>'ack')::boolean,'Batch acknowledgement must persist results';
END $$;
-- Users cannot access another user's inbox or any delivery token.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM notification_events WHERE audience<>'client')=0,'Inbox RLS isolation';
 BEGIN PERFORM * FROM notification_endpoints; RAISE EXCEPTION 'Token exposure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM claim_notifications('client'); RAISE EXCEPTION 'Worker RPC exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM register_notification_endpoint('restaurant','expo','ExpoPushToken[attack]'); RAISE EXCEPTION 'Owner bypass'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Owner bypass' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
-- Event and order roll back together.
SAVEPOINT before_order;
INSERT INTO orders(restaurant_id,status) VALUES('10000000-0000-0000-0000-000000000001','PENDING');
ROLLBACK TO before_order;
DO $$ BEGIN ASSERT (SELECT count(*) FROM notification_events)=4,'Rollback must not leave ghost events'; END $$;
-- Reminders are based on business acknowledgement, not provider acceptance.
UPDATE orders SET status='PENDING',created_at=now()-interval '8 minutes';
SELECT maintain_notifications();
SELECT maintain_notifications();
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM notification_events WHERE kind='order.reminder')=1,'Reminder must be unique';
 ASSERT (SELECT count(*) FROM notification_incidents WHERE resolved_at IS NULL)=1,'Unaccepted order must escalate';
END $$;
UPDATE orders SET status='ACCEPTED';
SELECT maintain_notifications();
DO $$ BEGIN ASSERT (SELECT count(*) FROM notification_incidents WHERE resolved_at IS NULL)=0,'Acceptance resolves incident'; END $$;
ROLLBACK;
