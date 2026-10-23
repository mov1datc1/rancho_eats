BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
CREATE OR REPLACE FUNCTION public.platform_health_snapshot() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
  'sampled_at',extract(epoch FROM now()),
  'db_connections',(SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend'),
  'db_max_connections',current_setting('max_connections')::integer,
  'queue_pending',(SELECT count(*) FROM notification_deliveries WHERE state IN ('pending','sending')),
  'queue_oldest_operational_seconds',coalesce((SELECT greatest(0,extract(epoch FROM now()-min(e.created_at))) FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id WHERE d.state IN ('pending','sending') AND e.campaign_id IS NULL AND e.expires_at>now()),0),
  'queue_dead_1h',(SELECT count(*) FROM notification_deliveries WHERE state='dead' AND updated_at>now()-interval '1 hour'),
  'queue_expired_leases',(SELECT count(*) FROM notification_deliveries WHERE state IN ('sending','receipt') AND lease_until<now())
 );
$$;
REVOKE ALL ON FUNCTION public.platform_health_snapshot() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_health_snapshot() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
