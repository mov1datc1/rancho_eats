-- STAGING ONLY. No real lead, contact or administrator is retained.
BEGIN;
SET LOCAL statement_timeout='20s';
INSERT INTO auth.users(id,email)VALUES('f4000000-0000-0000-0000-000000000001','landing-admin@example.invalid');
INSERT INTO admin_profiles(id,email)VALUES('f4000000-0000-0000-0000-000000000001','landing-admin@example.invalid');
SET LOCAL ROLE anon;
DO $$DECLARE a jsonb;b jsonb;payload jsonb:='{"business_name":"QA_LANDING_ROLLBACK","contact_name":"Contacto QA","email":"landing-check@example.invalid","phone":"3300000000","city":"Arandas","category":"pizza","delivery":"own_team","message":"Solicitud sintética, revertida","consent":true,"website":""}';BEGIN
 a:=submit_business_enquiry(payload,'f4000000-0000-0000-0000-000000000090');
 b:=submit_business_enquiry(payload,'f4000000-0000-0000-0000-000000000090');
 IF a IS DISTINCT FROM b OR(a->>'received')::boolean IS DISTINCT FROM true OR a->>'reference' IS NULL THEN RAISE EXCEPTION 'anonymous request or idempotency failed';END IF;
 BEGIN PERFORM count(*) FROM business_enquiries;RAISE EXCEPTION 'public contacts were readable';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f4000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$DECLARE listing jsonb;item business_enquiries;BEGIN
 listing:=admin_business_enquiries((now() AT TIME ZONE 'America/Mexico_City')::date,(now() AT TIME ZONE 'America/Mexico_City')::date,'NEW',0);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(listing->'rows') r WHERE r->>'business_name'='QA_LANDING_ROLLBACK') THEN RAISE EXCEPTION 'admin inbox missing lead';END IF;
 SELECT * INTO item FROM business_enquiries WHERE request_id='f4000000-0000-0000-0000-000000000090';
 IF item.phone<>'3300000000' OR item.state<>'NEW' OR item.privacy_version<>'2026-10-29' THEN RAISE EXCEPTION 'stored contact mismatch';END IF;
 PERFORM admin_update_business_enquiry(item.id,item.version,'CONTACTED','Prueba transaccional de seguimiento');
 IF NOT EXISTS(SELECT 1 FROM business_enquiry_updates WHERE enquiry_id=item.id AND actor=auth.uid() AND new_state='CONTACTED') THEN RAISE EXCEPTION 'audit entry missing';END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','f4000000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM business_enquiries) THEN RAISE EXCEPTION 'non-admin read allowed';END IF;
 BEGIN PERFORM admin_business_enquiries(current_date,current_date,'',0);RAISE EXCEPTION 'non-admin inbox allowed';EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'not_authorized' THEN RAISE;END IF;END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'hosted_landing_enquiry_passed_and_rolled_back' AS result;
