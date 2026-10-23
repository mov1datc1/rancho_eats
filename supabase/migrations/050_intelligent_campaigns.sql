BEGIN;
ALTER TABLE marketing_campaigns DROP CONSTRAINT marketing_campaigns_audience_check;
ALTER TABLE marketing_campaigns ADD CONSTRAINT marketing_campaigns_audience_check CHECK(audience IN('all','inactive30','never','business','lapsed','occasional','frequent','high_value'));
ALTER TABLE marketing_campaigns ADD COLUMN lookback_days integer NOT NULL DEFAULT 30 CHECK(lookback_days BETWEEN 7 AND 365);
ALTER TABLE marketing_campaigns ADD COLUMN min_orders integer NOT NULL DEFAULT 3 CHECK(min_orders BETWEEN 2 AND 100);
ALTER TABLE marketing_campaigns ADD COLUMN min_spend numeric NOT NULL DEFAULT 500 CHECK(min_spend BETWEEN 1 AND 100000);
ALTER TABLE marketing_campaigns ADD COLUMN sponsor_fee numeric NOT NULL DEFAULT 0 CHECK(sponsor_fee BETWEEN 0 AND 1000000);
CREATE INDEX marketing_delivered_history ON orders(client_user_id,restaurant_id,created_at DESC) WHERE status='DELIVERED';

-- Internal helpers never expose individual purchase histories through the API.
CREATE FUNCTION marketing_matches(p_user uuid,p_shop uuid,p_segment text,p_days integer,p_count integer,p_spend numeric,p_now timestamptz DEFAULT now()) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH history AS(SELECT count(*) lifetime,max(coalesce(delivered_at,created_at)) last_purchase,count(*) FILTER(WHERE coalesce(delivered_at,created_at)>p_now-make_interval(days=>p_days)) recent,coalesce(sum(subtotal) FILTER(WHERE coalesce(delivered_at,created_at)>p_now-make_interval(days=>p_days)),0) spend FROM orders WHERE client_user_id=p_user AND status='DELIVERED' AND (p_shop IS NULL OR restaurant_id=p_shop))
 SELECT CASE p_segment WHEN 'all' THEN true WHEN 'never' THEN lifetime=0 WHEN 'business' THEN lifetime>0 WHEN 'inactive30' THEN lifetime>0 AND last_purchase<=p_now-interval '30 days' WHEN 'lapsed' THEN lifetime>0 AND last_purchase<=p_now-make_interval(days=>p_days) WHEN 'occasional' THEN recent BETWEEN 1 AND p_count-1 WHEN 'frequent' THEN recent>=p_count WHEN 'high_value' THEN recent>=1 AND spend>=p_spend ELSE false END FROM history;
$$;
CREATE FUNCTION marketing_exclusion(p_user uuid,p_shop uuid,p_frequency boolean DEFAULT true,p_now timestamptz DEFAULT now()) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r restaurants; a record;km float;
BEGIN
 IF EXISTS(SELECT 1 FROM marketing_preferences WHERE user_id=p_user AND NOT enabled) THEN RETURN 'opted_out';END IF;
 IF EXISTS(SELECT 1 FROM account_restrictions WHERE user_id=p_user AND revoked_at IS NULL AND expires_at>p_now) OR EXISTS(SELECT 1 FROM client_profiles WHERE user_id=p_user AND is_blocked) THEN RETURN 'restricted';END IF;
 IF EXISTS(SELECT 1 FROM orders WHERE client_user_id=p_user AND status NOT IN('DELIVERED','REJECTED','CANCELLED')) OR EXISTS(SELECT 1 FROM order_incidents i JOIN orders o ON o.id=i.order_id WHERE o.client_user_id=p_user AND i.status<>'RESOLVED') THEN RETURN 'active_service';END IF;
 IF p_shop IS NOT NULL THEN
 SELECT * INTO r FROM restaurants WHERE id=p_shop;
 IF NOT FOUND OR r.status<>'ACTIVE' OR NOT EXISTS(SELECT 1 FROM app_categories c WHERE lower(trim(c.name))=lower(trim(r.type)) AND c.is_active AND(c.release_mode='public' OR (c.release_mode='pilot' AND EXISTS(SELECT 1 FROM category_pilots p WHERE p.category_id=c.id AND p.restaurant_id=r.id AND p.user_id=p_user)))) THEN RETURN 'business_unavailable';END IF;
 -- Use the default saved address; fall back to the latest known delivery location, never phone inference.
 SELECT lat,lng INTO a FROM(SELECT latitude lat,longitude lng,0 rank,updated_at ts FROM client_addresses WHERE user_id=p_user AND is_default UNION ALL SELECT client_lat,client_lng,1,created_at FROM orders WHERE client_user_id=p_user AND delivery_type='delivery' AND client_lat IS NOT NULL AND client_lng IS NOT NULL) x ORDER BY rank,ts DESC LIMIT 1;
 IF a.lat IS NULL OR a.lng IS NULL OR r.lat IS NULL OR r.lng IS NULL OR NOT(a.lat BETWEEN 14 AND 33.5) OR NOT(a.lng BETWEEN -119 AND -86) OR coalesce(r.delivery_radius_km,0)<=0 THEN RETURN 'unknown_location';END IF;
 km=6371*2*asin(sqrt(least(1.0,power(sin(radians(a.lat-r.lat)/2),2)+cos(radians(r.lat))*cos(radians(a.lat))*power(sin(radians(a.lng-r.lng)/2),2))));
 IF km>r.delivery_radius_km THEN RETURN 'outside_coverage';END IF;
 END IF;
 IF p_frequency AND (EXISTS(SELECT 1 FROM marketing_contacts WHERE user_id=p_user AND reserved_at>p_now-interval '72 hours') OR (SELECT count(*) FROM marketing_contacts WHERE user_id=p_user AND reserved_at>p_now-interval '7 days')>=2) THEN RETURN 'frequency_cap';END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION admin_campaign_preview(p_restaurant uuid,p_audience text,p_days integer DEFAULT 30,p_count integer DEFAULT 3,p_spend numeric DEFAULT 500) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'No autorizado';END IF;
 IF p_audience NOT IN('all','inactive30','never','business','lapsed','occasional','frequent','high_value') OR p_days NOT BETWEEN 7 AND 365 OR p_count NOT BETWEEN 2 AND 100 OR p_spend NOT BETWEEN 1 AND 100000 OR (p_audience='business' AND p_restaurant IS NULL) THEN RAISE EXCEPTION 'Segmento inválido';END IF;
 WITH candidates AS MATERIALIZED(SELECT DISTINCT user_id FROM notification_endpoints WHERE app='client' AND active AND user_id IS NOT NULL), matched AS MATERIALIZED(SELECT user_id FROM candidates WHERE marketing_matches(user_id,p_restaurant,p_audience,p_days,p_count,p_spend)), checks AS MATERIALIZED(SELECT marketing_exclusion(user_id,p_restaurant) reason FROM matched)
 SELECT jsonb_build_object('push_accounts',(SELECT count(*) FROM candidates),'matched',(SELECT count(*) FROM matched),'eligible',(SELECT count(*) FROM checks WHERE reason IS NULL),'exclusions',coalesce((SELECT jsonb_object_agg(reason,n) FROM(SELECT reason,count(*) n FROM checks WHERE reason IS NOT NULL GROUP BY reason)x),'{}'::jsonb),'as_of',now(),'unidentified_delivered',(SELECT count(*) FROM orders WHERE status='DELIVERED' AND client_user_id IS NULL AND(p_restaurant IS NULL OR restaurant_id=p_restaurant))) INTO result;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION admin_schedule_campaign(p_title text,p_body text,p_restaurant uuid,p_audience text,p_at timestamptz,p_repetitions integer,p_interval integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result_id uuid;h integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
 h=extract(hour FROM p_at AT TIME ZONE 'America/Mexico_City');
 IF p_at<now() OR p_at>now()+interval '1 year' OR h<9 OR h>=20 THEN RAISE EXCEPTION 'schedule_between_09_and_20_future'; END IF;
 INSERT INTO marketing_campaigns(title,body,restaurant_id,audience,scheduled_at,repetitions,interval_days) VALUES(trim(p_title),trim(p_body),p_restaurant,p_audience,p_at,p_repetitions,p_interval) RETURNING marketing_campaigns.id INTO result_id;
 RETURN result_id;
END $$;

CREATE FUNCTION admin_schedule_targeted_campaign(p_title text,p_body text,p_restaurant uuid,p_audience text,p_at timestamptz,p_repetitions integer,p_interval integer,p_days integer,p_count integer,p_spend numeric,p_fee numeric DEFAULT 0) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result uuid;preview jsonb;
BEGIN
 preview=admin_campaign_preview(p_restaurant,p_audience,p_days,p_count,p_spend);
 IF (preview->>'eligible')::integer=0 THEN RAISE EXCEPTION 'No hay destinatarios elegibles. Revisa el segmento y las exclusiones.';END IF;
 IF p_fee IS NULL OR p_fee<0 OR p_fee>1000000 OR(p_fee>0 AND p_restaurant IS NULL) THEN RAISE EXCEPTION 'Importe del patrocinio inválido';END IF;
 result=admin_schedule_campaign(p_title,p_body,p_restaurant,p_audience,p_at,p_repetitions,p_interval);
 UPDATE marketing_campaigns SET lookback_days=p_days,min_orders=p_count,min_spend=p_spend,sponsor_fee=p_fee WHERE id=result;
 INSERT INTO operation_audit(actor,action,details) VALUES(auth.uid(),'TARGETED_CAMPAIGN_SCHEDULED',jsonb_build_object('campaign_id',result,'preview',preview,'sponsor_fee',p_fee));RETURN result;
END $$;
REVOKE ALL ON FUNCTION marketing_matches(uuid,uuid,text,integer,integer,numeric,timestamptz),marketing_exclusion(uuid,uuid,boolean,timestamptz),admin_campaign_preview(uuid,text,integer,integer,numeric),admin_schedule_targeted_campaign(text,text,uuid,text,timestamptz,integer,integer,integer,integer,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_campaign_preview(uuid,text,integer,integer,numeric),admin_schedule_targeted_campaign(text,text,uuid,text,timestamptz,integer,integer,integer,integer,numeric,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION process_marketing_campaigns() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c marketing_campaigns; u record; ev uuid;n integer:=0;h integer;
BEGIN
 IF NOT pg_try_advisory_xact_lock(7110846) THEN RETURN; END IF;
 h=extract(hour FROM now() AT TIME ZONE 'America/Mexico_City');IF h<9 OR h>=20 THEN RETURN;END IF;
 SELECT * INTO c FROM marketing_campaigns WHERE state IN ('scheduled','running') AND scheduled_at<=now() ORDER BY scheduled_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE marketing_campaigns SET state='running' WHERE id=c.id;
 FOR u IN SELECT DISTINCT e.user_id FROM notification_endpoints e WHERE e.app='client' AND e.active AND e.user_id IS NOT NULL AND (c.cursor_user IS NULL OR e.user_id>c.cursor_user) AND e.updated_at<=now() ORDER BY e.user_id LIMIT 500 LOOP
 n=n+1;c.cursor_user=u.user_id;
 IF NOT marketing_matches(u.user_id,c.restaurant_id,c.audience,c.lookback_days,c.min_orders,c.min_spend) OR marketing_exclusion(u.user_id,c.restaurant_id) IS NOT NULL THEN CONTINUE;END IF;
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
   'campaign_state',mc.state,'marketing_enabled',coalesce(mp.enabled,true),'marketing_target_valid',CASE WHEN mc.id IS NULL THEN true ELSE marketing_matches(ev.user_id,mc.restaurant_id,mc.audience,mc.lookback_days,mc.min_orders,mc.min_spend) AND marketing_exclusion(ev.user_id,mc.restaurant_id,false) IS NULL END,'current_status',o.status::text,'current_revision',o.notification_revision,'current_driver_id',o.delivery_driver_id)),'[]') INTO result
 FROM claimed c JOIN notification_endpoints ep ON ep.id=c.endpoint_id JOIN notification_events ev ON ev.id=c.event_id
 LEFT JOIN orders o ON o.id=ev.order_id LEFT JOIN marketing_campaigns mc ON mc.id=ev.campaign_id LEFT JOIN marketing_preferences mp ON mp.user_id=ev.user_id;
 RETURN result;
END $$;



CREATE OR REPLACE FUNCTION admin_campaign_report() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'not_authorized';END IF;
 RETURN (WITH associated AS MATERIALIZED(
 SELECT DISTINCT ON(o.id) o.id,e.campaign_id
 FROM notification_events e JOIN notification_deliveries d ON d.event_id=e.id AND d.state='accepted'
 JOIN marketing_campaigns c ON c.id=e.campaign_id
 JOIN orders o ON o.client_user_id=e.user_id AND o.status='DELIVERED' AND o.created_at>=d.updated_at AND o.created_at<d.updated_at+interval '7 days' AND(c.restaurant_id IS NULL OR c.restaurant_id=o.restaurant_id)
 WHERE e.kind='marketing.campaign' ORDER BY o.id,d.updated_at DESC,e.id DESC
 ), totals AS(SELECT campaign_id,count(*) n FROM associated GROUP BY campaign_id)
 SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM(SELECT c.*,coalesce(t.n,0) associated_orders,
 (SELECT count(*) FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id WHERE e.campaign_id=c.id AND d.state='accepted') accepted,
 (SELECT count(*) FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id WHERE e.campaign_id=c.id AND d.state IN('dead','expired')) failed
 FROM marketing_campaigns c LEFT JOIN totals t ON t.campaign_id=c.id ORDER BY c.created_at DESC LIMIT 100)r);
END $$;
COMMIT;
