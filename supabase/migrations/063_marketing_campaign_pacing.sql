-- 063 · Pace marketing campaigns so recipients do not all open the app at once (capacity audit 2026-11-17).
--
-- Before: process_marketing_campaigns() queued up to 500 recipients per worker tick (~every 10 s),
-- i.e. ~3,000/min, all deliverable immediately. A campaign to 5,000 clients reached every phone within
-- seconds and produced a synchronized burst of catalog/menu reads.
--
-- After: at most v_rate_per_min recipients are queued per rolling minute per campaign, and each delivery's
-- available_at is spaced evenly (60/v_rate_per_min s apart). Targeting, exclusions, one-device-per-account,
-- expiry window, cursor and repetition semantics are unchanged.
-- 300/min => 5,000 recipients in ~17 min, well inside the 2 h expiry. Adjust v_rate_per_min to tune.
BEGIN;

DO $guard$
DECLARE def text := pg_get_functiondef('public.process_marketing_campaigns()'::regprocedure);
BEGIN
  IF position('LIMIT 500' IN def) = 0 OR position('marketing_contacts(campaign_id,user_id,run_number,event_id)' IN def) = 0 THEN
    RAISE EXCEPTION '063: process_marketing_campaigns differs from the reviewed 050 version; review before pacing';
  END IF;
END $guard$;

CREATE INDEX IF NOT EXISTS marketing_contacts_campaign_recent ON marketing_contacts (campaign_id, reserved_at DESC);

CREATE OR REPLACE FUNCTION public.process_marketing_campaigns() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  c marketing_campaigns; u record; ev uuid;
  n integer := 0;              -- candidates scanned this tick
  q integer := 0;              -- recipients queued this tick
  h integer;
  v_rate_per_min constant integer := 300;
  v_quota integer;
  v_spacing interval;
  v_hit_quota boolean := false;
BEGIN
 IF NOT pg_try_advisory_xact_lock(7110846) THEN RETURN; END IF;
 h=extract(hour FROM now() AT TIME ZONE 'America/Mexico_City');IF h<9 OR h>=20 THEN RETURN;END IF;
 SELECT * INTO c FROM marketing_campaigns WHERE state IN ('scheduled','running') AND scheduled_at<=now() ORDER BY scheduled_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE marketing_campaigns SET state='running' WHERE id=c.id;

 -- Rolling one-minute budget, independent of how often the worker calls this function.
 v_quota := v_rate_per_min - (SELECT count(*) FROM marketing_contacts mc
                              WHERE mc.campaign_id=c.id AND mc.reserved_at > now()-interval '1 minute');
 IF v_quota <= 0 THEN RETURN; END IF;
 v_spacing := make_interval(secs => 60.0 / v_rate_per_min);

 FOR u IN SELECT DISTINCT e.user_id FROM notification_endpoints e WHERE e.app='client' AND e.active AND e.user_id IS NOT NULL AND (c.cursor_user IS NULL OR e.user_id>c.cursor_user) AND e.updated_at<=now() ORDER BY e.user_id LIMIT 500 LOOP
  n=n+1;c.cursor_user=u.user_id;
  IF NOT marketing_matches(u.user_id,c.restaurant_id,c.audience,c.lookback_days,c.min_orders,c.min_spend) OR marketing_exclusion(u.user_id,c.restaurant_id) IS NOT NULL THEN CONTINUE;END IF;
  INSERT INTO notification_events(revision,audience,user_id,kind,title,body,priority,expires_at,campaign_id) VALUES(c.run_number,'client',u.user_id,'marketing.campaign',c.title,c.body,9,least(now()+interval '2 hours',((now() AT TIME ZONE 'America/Mexico_City')::date+time '20:00') AT TIME ZONE 'America/Mexico_City'),c.id) RETURNING id INTO ev;
  INSERT INTO marketing_contacts(campaign_id,user_id,run_number,event_id) VALUES(c.id,u.user_id,c.run_number,ev);
  -- Exactly one device per account for advertising; spaced so phones are not woken simultaneously.
  INSERT INTO notification_deliveries(event_id,endpoint_id,app,priority,available_at)
    SELECT ev,id,'client',9,now()+v_spacing*q FROM notification_endpoints WHERE app='client' AND active AND user_id=u.user_id ORDER BY updated_at DESC,id LIMIT 1;
  q=q+1;
  UPDATE marketing_campaigns SET queued=queued+1 WHERE id=c.id;
  IF q >= v_quota THEN v_hit_quota := true; EXIT; END IF;
 END LOOP;
 UPDATE marketing_campaigns SET cursor_user=c.cursor_user WHERE id=c.id;
 -- Finished only when the candidate scan is exhausted (not when the per-minute budget stopped it).
 IF n<500 AND NOT v_hit_quota THEN
  IF c.run_number>=c.repetitions THEN UPDATE marketing_campaigns SET state='completed' WHERE id=c.id;
  ELSE UPDATE marketing_campaigns SET state='scheduled',cursor_user=NULL,run_number=run_number+1,scheduled_at=greatest(scheduled_at+make_interval(days=>interval_days),now()+make_interval(days=>interval_days)) WHERE id=c.id;END IF;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.process_marketing_campaigns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_marketing_campaigns() TO service_role;

COMMIT;
