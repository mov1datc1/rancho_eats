-- Run after 051. Metadata checks only: no push, orders, or customer data writes.
DO $$ DECLARE signature text; role_name text; BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.marketing_matches(uuid,uuid,text,integer,integer,numeric,timestamptz)',
  'public.marketing_exclusion(uuid,uuid,boolean,timestamptz)',
  'public.process_marketing_campaigns()', 'public.send_scheduled_promotions()',
  'public.claim_notifications(text,boolean)', 'public.maintain_notifications()'
 ] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF has_function_privilege(role_name,signature,'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected client access: % -> %',role_name,signature;
   END IF;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'admin\_%' ESCAPE '\'
  AND (has_function_privilege('anon',p.oid,'EXECUTE') OR NOT has_function_privilege('authenticated',p.oid,'EXECUTE'))) THEN
  RAISE EXCEPTION 'Admin RPC privilege regression';
 END IF;
 IF NOT has_function_privilege('service_role','public.process_marketing_campaigns()','EXECUTE')
 OR NOT has_function_privilege('service_role','public.claim_notifications(text,boolean)','EXECUTE')
 OR NOT has_function_privilege('anon','public.driver_get_session(text)','EXECUTE')
 OR NOT has_function_privilege('anon','public.driver_orders_secure(text,uuid,boolean)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.client_cancel_order(uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'Installed app or worker access regression';
 END IF;
END $$;
