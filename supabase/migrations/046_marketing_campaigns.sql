BEGIN;
CREATE TABLE marketing_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 100), body text NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 300),
 restaurant_id uuid REFERENCES restaurants(id), audience text NOT NULL CHECK(audience IN ('all','inactive30','never','business')),
 scheduled_at timestamptz NOT NULL, repetitions integer NOT NULL DEFAULT 1 CHECK(repetitions BETWEEN 1 AND 4), interval_days integer NOT NULL DEFAULT 7 CHECK(interval_days BETWEEN 7 AND 90),
 state text NOT NULL DEFAULT 'scheduled' CHECK(state IN ('scheduled','running','completed','cancelled')), run_number integer NOT NULL DEFAULT 1,
 cursor_user uuid, queued integer NOT NULL DEFAULT 0, created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(audience<>'business' OR restaurant_id IS NOT NULL)
);
CREATE TABLE marketing_contacts (campaign_id uuid REFERENCES marketing_campaigns(id),user_id uuid REFERENCES auth.users(id),run_number integer NOT NULL,event_id uuid REFERENCES notification_events(id),reserved_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(campaign_id,user_id,run_number));
CREATE INDEX marketing_contact_frequency ON marketing_contacts(user_id,reserved_at DESC);
CREATE TABLE marketing_preferences(user_id uuid PRIMARY KEY REFERENCES auth.users(id),enabled boolean NOT NULL DEFAULT true,updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE marketing_campaigns ENABLE ROW LEVEL SECURITY;ALTER TABLE marketing_contacts ENABLE ROW LEVEL SECURITY;ALTER TABLE marketing_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_read ON marketing_campaigns FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()));
CREATE POLICY owner_preferences ON marketing_preferences FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
GRANT SELECT ON marketing_campaigns TO authenticated;GRANT SELECT,INSERT,UPDATE ON marketing_preferences TO authenticated;
ALTER TABLE notification_events ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE notification_events ADD COLUMN campaign_id uuid REFERENCES marketing_campaigns(id);
ALTER TABLE notification_events ADD CONSTRAINT notification_event_source CHECK(order_id IS NOT NULL OR (campaign_id IS NOT NULL AND kind='marketing.campaign'));
CREATE FUNCTION admin_schedule_campaign(p_title text,p_body text,p_restaurant uuid,p_audience text,p_at timestamptz,p_repetitions integer,p_interval integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE id uuid;h integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
 h=extract(hour FROM p_at AT TIME ZONE 'America/Mexico_City');
 IF p_at<now() OR p_at>now()+interval '1 year' OR h<9 OR h>=20 THEN RAISE EXCEPTION 'schedule_between_09_and_20_future'; END IF;
 INSERT INTO marketing_campaigns(title,body,restaurant_id,audience,scheduled_at,repetitions,interval_days) VALUES(trim(p_title),trim(p_body),p_restaurant,p_audience,p_at,p_repetitions,p_interval) RETURNING marketing_campaigns.id INTO id;
 RETURN id;
END $$;
CREATE FUNCTION admin_cancel_campaign(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
 UPDATE marketing_campaigns SET state='cancelled' WHERE id=p_id AND state IN ('scheduled','running');
 UPDATE notification_deliveries SET state='expired',error_code='CAMPAIGN_CANCELLED' WHERE state='pending' AND event_id IN(SELECT id FROM notification_events WHERE campaign_id=p_id);
END $$;
CREATE FUNCTION process_marketing_campaigns() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c marketing_campaigns; u record; ev uuid;n integer:=0;h integer;
BEGIN
 IF NOT pg_try_advisory_xact_lock(7110846) THEN RETURN; END IF;
 h=extract(hour FROM now() AT TIME ZONE 'America/Mexico_City');IF h<9 OR h>=20 THEN RETURN;END IF;
 SELECT * INTO c FROM marketing_campaigns WHERE state IN ('scheduled','running') AND scheduled_at<=now() ORDER BY scheduled_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE marketing_campaigns SET state='running' WHERE id=c.id;
 FOR u IN SELECT DISTINCT e.user_id FROM notification_endpoints e WHERE e.app='client' AND e.active AND e.user_id IS NOT NULL AND (c.cursor_user IS NULL OR e.user_id>c.cursor_user) AND e.updated_at<=now() ORDER BY e.user_id LIMIT 500 LOOP
 n=n+1;c.cursor_user=u.user_id;
 IF EXISTS(SELECT 1 FROM marketing_preferences WHERE user_id=u.user_id AND NOT enabled) THEN CONTINUE;END IF;
 IF EXISTS(SELECT 1 FROM marketing_contacts WHERE user_id=u.user_id AND reserved_at>now()-interval '72 hours') OR (SELECT count(*) FROM marketing_contacts WHERE user_id=u.user_id AND reserved_at>now()-interval '7 days')>=2 THEN CONTINUE;END IF;
 IF c.audience='inactive30' AND EXISTS(SELECT 1 FROM orders WHERE client_user_id=u.user_id AND created_at>now()-interval '30 days') THEN CONTINUE;END IF;
 IF c.audience='never' AND EXISTS(SELECT 1 FROM orders WHERE client_user_id=u.user_id) THEN CONTINUE;END IF;
 IF c.audience='business' AND NOT EXISTS(SELECT 1 FROM orders WHERE client_user_id=u.user_id AND restaurant_id=c.restaurant_id) THEN CONTINUE;END IF;
 INSERT INTO notification_events(revision,audience,user_id,kind,title,body,priority,expires_at,campaign_id) VALUES(c.run_number,'client',u.user_id,'marketing.campaign',c.title,c.body,9,least(now()+interval '2 hours',((now() AT TIME ZONE 'America/Mexico_City')::date+time '20:00') AT TIME ZONE 'America/Mexico_City'),c.id) RETURNING id INTO ev;
 INSERT INTO marketing_contacts(campaign_id,user_id,run_number,event_id) VALUES(c.id,u.user_id,c.run_number,ev);
 -- Exactly one device per account for advertising; order alerts retain their existing routing.
 INSERT INTO notification_deliveries(event_id,endpoint_id,app,priority) SELECT ev,id,'client',9 FROM notification_endpoints WHERE app='client' AND active AND user_id=u.user_id ORDER BY updated_at DESC,id LIMIT 1;
 UPDATE marketing_campaigns SET queued=queued+1 WHERE id=c.id;
 END LOOP;
 UPDATE marketing_campaigns SET cursor_user=c.cursor_user WHERE id=c.id;
 IF n<500 THEN
 IF c.run_number>=c.repetitions THEN UPDATE marketing_campaigns SET state='completed' WHERE id=c.id;
 ELSE UPDATE marketing_campaigns SET state='scheduled',cursor_user=NULL,run_number=run_number+1,scheduled_at=greatest(scheduled_at+make_interval(days=>interval_days),now()+make_interval(days=>interval_days)) WHERE id=c.id;END IF;
 END IF;
END $$;
-- Retire the legacy broadcast path; campaigns now use the durable queue and frequency caps.
CREATE OR REPLACE FUNCTION send_scheduled_promotions() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN RETURN; END $$;
REVOKE ALL ON FUNCTION admin_schedule_campaign(text,text,uuid,text,timestamptz,integer,integer),admin_cancel_campaign(uuid),process_marketing_campaigns() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_schedule_campaign(text,text,uuid,text,timestamptz,integer,integer),admin_cancel_campaign(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION process_marketing_campaigns() TO service_role;
CREATE OR REPLACE FUNCTION public.claim_notifications(p_app text,p_receipts boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r notification_routes; result jsonb;
BEGIN
 SELECT * INTO r FROM notification_routes WHERE app=p_app AND enabled FOR UPDATE SKIP LOCKED;
 IF NOT FOUND OR (NOT p_receipts AND r.next_send_at>clock_timestamp()) THEN RETURN '[]'; END IF;
 IF NOT p_receipts THEN UPDATE notification_routes SET next_send_at=clock_timestamp()+make_interval(secs=>r.interval_ms/1000.0) WHERE app=p_app; END IF;
 WITH candidates AS (
   SELECT d.id FROM notification_deliveries d JOIN notification_endpoints ep ON ep.id=d.endpoint_id
   JOIN notification_events ev ON ev.id=d.event_id
   WHERE d.app=p_app AND d.available_at<=now() AND (d.lease_until IS NULL OR d.lease_until<now())
   AND ((p_receipts AND d.state='receipt') OR (NOT p_receipts AND d.state IN ('pending','sending')))
   ORDER BY d.priority,d.available_at,d.id LIMIT r.batch_size FOR UPDATE OF d SKIP LOCKED
 ), claimed AS (
   UPDATE notification_deliveries d SET lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',
     attempts=CASE WHEN p_receipts THEN attempts ELSE attempts+1 END,
     state=CASE WHEN p_receipts THEN 'receipt' ELSE 'sending' END,updated_at=now()
   FROM candidates c WHERE d.id=c.id RETURNING d.*
 ) SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('endpoint',to_jsonb(ep),'event',to_jsonb(ev),'configured_provider',r.provider,
   'campaign_state',mc.state,'marketing_enabled',coalesce(mp.enabled,true),'current_status',o.status::text,'current_revision',o.notification_revision,'current_driver_id',o.delivery_driver_id)),'[]') INTO result
 FROM claimed c JOIN notification_endpoints ep ON ep.id=c.endpoint_id JOIN notification_events ev ON ev.id=c.event_id
 LEFT JOIN orders o ON o.id=ev.order_id LEFT JOIN marketing_campaigns mc ON mc.id=ev.campaign_id LEFT JOIN marketing_preferences mp ON mp.user_id=ev.user_id;
 RETURN result;
END $$;


CREATE FUNCTION admin_campaign_report() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'not_authorized';END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM (SELECT c.*,
 (SELECT count(*) FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id WHERE e.campaign_id=c.id AND d.state='accepted') accepted,
 (SELECT count(*) FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id WHERE e.campaign_id=c.id AND d.state IN ('dead','expired')) failed
 FROM marketing_campaigns c ORDER BY c.created_at DESC LIMIT 100) r);
END $$;
REVOKE ALL ON FUNCTION admin_campaign_report() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_campaign_report() TO authenticated;
CREATE INDEX notification_event_campaign ON notification_events(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.register_notification_endpoint(p_app text,p_provider text,p_token text,p_subscription jsonb DEFAULT NULL,p_driver_token text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_user uuid:=auth.uid(); v_driver uuid; v_id uuid;
BEGIN
 IF p_app NOT IN ('client','restaurant','driver','web') OR p_provider NOT IN ('expo','fcm','webpush') THEN RAISE EXCEPTION 'Invalid route'; END IF;
 IF p_app='driver' THEN
   SELECT id INTO v_driver FROM driver_profiles WHERE is_active AND
     ((v_user IS NOT NULL AND user_id=v_user) OR (length(p_driver_token)>=16 AND access_token=p_driver_token)) LIMIT 1;
   IF v_driver IS NULL THEN RAISE EXCEPTION 'Driver authentication required'; END IF;
   SELECT user_id INTO v_user FROM driver_profiles WHERE id=v_driver;
 ELSIF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required';
 ELSIF p_app IN ('restaurant','web') AND NOT EXISTS(SELECT 1 FROM restaurants WHERE owner_id=v_user) THEN
   RAISE EXCEPTION 'Restaurant owner required';
 END IF;
 IF (p_app='web') <> (p_provider='webpush') THEN RAISE EXCEPTION 'Invalid provider'; END IF;
 IF p_provider='expo' AND p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' THEN RAISE EXCEPTION 'Invalid Expo token'; END IF;
 IF p_provider='webpush' AND (p_token !~ '^https://(fcm.googleapis.com|[a-z0-9.-]+\.push.services.mozilla.com|web.push.apple.com|[a-z0-9.-]+\.notify.windows.com)/' OR
   p_subscription->>'endpoint' IS DISTINCT FROM p_token OR
   coalesce(length(p_subscription->'keys'->>'p256dh'),0) NOT BETWEEN 80 AND 200 OR
   coalesce(length(p_subscription->'keys'->>'auth'),0) NOT BETWEEN 16 AND 100) THEN RAISE EXCEPTION 'Invalid Web Push subscription'; END IF;
 -- Serialize registrations per identity to bound device proliferation.
 PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(v_driver,v_user)::text,0));
 IF (SELECT count(*) FROM notification_endpoints WHERE app=p_app AND active AND
     (user_id=v_user OR driver_id=v_driver) AND token<>p_token)>=10 THEN RAISE EXCEPTION 'Device limit reached'; END IF;
 INSERT INTO notification_endpoints(app,user_id,driver_id,provider,token,subscription)
 VALUES(p_app,v_user,v_driver,p_provider,p_token,p_subscription)
 ON CONFLICT(app,provider,token) DO UPDATE SET user_id=EXCLUDED.user_id,driver_id=EXCLUDED.driver_id,
   subscription=EXCLUDED.subscription,active=true,updated_at=now()
 RETURNING id INTO v_id;
 -- A newly registered device can recover recent durable events after reconnecting.
 INSERT INTO notification_deliveries(event_id,endpoint_id,app,priority)
 SELECT e.id,v_id,p_app,e.priority FROM notification_events e JOIN notification_routes r ON r.app=p_app
 WHERE r.capture_enabled AND r.provider=p_provider AND e.expires_at>now() AND e.kind<>'marketing.campaign'
 AND (e.audience=p_app OR (p_app='web' AND e.audience='restaurant'))
 AND ((p_app='driver' AND e.driver_id=v_driver) OR (p_app<>'driver' AND e.user_id=v_user))
 ON CONFLICT DO NOTHING;
 RETURN v_id;
END $$;


COMMIT;
