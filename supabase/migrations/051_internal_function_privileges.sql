-- Supabase may grant anon/authenticated explicitly through default privileges.
-- REVOKE FROM PUBLIC alone does not remove those explicit grants.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
REVOKE ALL ON FUNCTION
 public.marketing_matches(uuid,uuid,text,integer,integer,numeric,timestamptz),
 public.marketing_exclusion(uuid,uuid,boolean,timestamptz),
 public.process_marketing_campaigns(),
 public.send_scheduled_promotions()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_marketing_campaigns(), public.send_scheduled_promotions() TO service_role;
-- Helpers run as the owner inside SECURITY DEFINER entry points, never as a client.
-- Keep driver token entry points and catalog functions compatible with installed apps.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'admin\_%' ESCAPE '\'
 LOOP
  EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.signature);
 END LOOP;
END $$;
-- Future application functions require explicit grants. The global PUBLIC default
-- must also be removed: schema-local REVOKE cannot override a global grant.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
