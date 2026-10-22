-- Apply after the shared platform migrations (including client 030 and driver 019).
-- Deliberately disabled until devices, credentials and workers have passed staging QA.
BEGIN;
CREATE TABLE public.notification_routes (
  app text PRIMARY KEY CHECK (app IN ('client','restaurant','driver','web')),
  expo_project_id text,
  enabled boolean NOT NULL DEFAULT false,
  capture_enabled boolean NOT NULL DEFAULT false,
  provider text NOT NULL DEFAULT 'expo' CHECK (provider IN ('expo','fcm','webpush')),
  batch_size integer NOT NULL DEFAULT 100 CHECK (batch_size BETWEEN 1 AND 100),
  interval_ms integer NOT NULL DEFAULT 250 CHECK (interval_ms >= 20),
  next_send_at timestamptz NOT NULL DEFAULT now(),
  CHECK (provider<>'expo' OR interval_ms>=200)
);
INSERT INTO public.notification_routes(app,expo_project_id,provider) VALUES
 ('client','db0d6965-cc3c-4c5f-bb2e-ef3058b3fde7','expo'),
 ('restaurant','44de164f-0475-4018-aa60-c2e1816c6100','expo'),
 ('driver','886e6c3a-fc23-4887-ad1b-28dc1f0c050b','expo'),
 ('web',NULL,'webpush');

CREATE TABLE public.notification_endpoints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 app text NOT NULL REFERENCES public.notification_routes(app),
 user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
 driver_id uuid REFERENCES public.driver_profiles(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK (provider IN ('expo','fcm','webpush')),
 token text NOT NULL CHECK (length(token) BETWEEN 10 AND 4096),
 subscription jsonb,
 active boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(app,provider,token),
 CHECK (user_id IS NOT NULL OR driver_id IS NOT NULL)
);
CREATE INDEX notification_endpoint_user ON public.notification_endpoints(app,user_id) WHERE active;
CREATE INDEX notification_endpoint_driver ON public.notification_endpoints(driver_id) WHERE active;

-- One durable inbox item per business event and audience, even without a push token.
CREATE TABLE public.notification_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
 revision bigint NOT NULL,
 audience text NOT NULL CHECK (audience IN ('client','restaurant','driver')),
 user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
 driver_id uuid REFERENCES public.driver_profiles(id) ON DELETE CASCADE,
 kind text NOT NULL,
 title text NOT NULL,
 body text NOT NULL,
 priority smallint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
 opened_at timestamptz,
 UNIQUE(order_id,revision,audience,kind)
);
CREATE INDEX notification_inbox_user ON public.notification_events(user_id,created_at DESC);
CREATE INDEX notification_inbox_driver ON public.notification_events(driver_id,created_at DESC);
CREATE TABLE public.notification_deliveries (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event_id uuid NOT NULL REFERENCES public.notification_events(id) ON DELETE CASCADE,
 endpoint_id uuid NOT NULL REFERENCES public.notification_endpoints(id) ON DELETE CASCADE,
 app text NOT NULL REFERENCES public.notification_routes(app),
 priority smallint NOT NULL DEFAULT 1,
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','receipt','accepted','dead','expired')),
 attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(),
 lease_id uuid,
 lease_until timestamptz,
 ticket_id text,
 error_code text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,endpoint_id)
);
CREATE INDEX notification_delivery_ready ON public.notification_deliveries(app,priority,available_at,id) WHERE state IN ('pending','sending','receipt');
ALTER TABLE public.orders ADD COLUMN notification_revision bigint NOT NULL DEFAULT 0;

ALTER TABLE public.notification_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_routes,public.notification_endpoints,public.notification_events,public.notification_deliveries FROM anon, authenticated;
GRANT ALL ON public.notification_routes,public.notification_endpoints,public.notification_events,public.notification_deliveries TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.notification_deliveries_id_seq TO service_role;
GRANT SELECT ON public.notification_events TO authenticated;
CREATE POLICY notification_inbox_own ON public.notification_events FOR SELECT TO authenticated USING (
 user_id=auth.uid() OR driver_id IN (SELECT id FROM public.driver_profiles WHERE user_id=auth.uid() AND is_active)
);

CREATE FUNCTION public.register_notification_endpoint(p_app text,p_provider text,p_token text,p_subscription jsonb DEFAULT NULL,p_driver_token text DEFAULT NULL)
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
 WHERE r.capture_enabled AND r.provider=p_provider AND e.expires_at>now()
 AND (e.audience=p_app OR (p_app='web' AND e.audience='restaurant'))
 AND ((p_app='driver' AND e.driver_id=v_driver) OR (p_app<>'driver' AND e.user_id=v_user))
 ON CONFLICT DO NOTHING;
 RETURN v_id;
END $$;

CREATE FUNCTION public.unregister_notification_endpoint(p_id uuid,p_driver_token text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 UPDATE notification_endpoints SET active=false,updated_at=now() WHERE id=p_id AND
 (user_id=auth.uid() OR driver_id IN (SELECT id FROM driver_profiles WHERE length(p_driver_token)>=16 AND access_token=p_driver_token));
$$;

CREATE FUNCTION public.open_notification(p_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 UPDATE notification_events SET opened_at=coalesce(opened_at,now()) WHERE id=p_id AND
 (user_id=auth.uid() OR driver_id IN (SELECT id FROM driver_profiles WHERE user_id=auth.uid() AND is_active));
$$;

CREATE FUNCTION public.enqueue_order_notice(p_order uuid,p_revision bigint,p_audience text,p_user uuid,p_driver uuid,p_kind text,p_title text,p_body text,p_priority smallint DEFAULT 1)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_event uuid;
BEGIN
 INSERT INTO notification_events(order_id,revision,audience,user_id,driver_id,kind,title,body,priority)
 VALUES(p_order,p_revision,p_audience,p_user,p_driver,p_kind,p_title,p_body,p_priority)
 ON CONFLICT DO NOTHING RETURNING id INTO v_event;
 IF v_event IS NULL THEN RETURN; END IF;
 INSERT INTO notification_deliveries(event_id,endpoint_id,app,priority)
 SELECT v_event,e.id,e.app,p_priority FROM notification_endpoints e JOIN notification_routes r ON r.app=e.app
 WHERE e.active AND e.updated_at>now()-interval '60 days' AND r.provider=e.provider AND r.capture_enabled
 AND (e.app=p_audience OR (p_audience='restaurant' AND e.app='web'))
 AND ((p_audience='driver' AND e.driver_id=p_driver) OR (p_audience<>'driver' AND e.user_id=p_user));
END $$;

CREATE FUNCTION public.capture_order_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_owner uuid; v_status text:=NEW.status::text; v_title text; v_old jsonb:='{}'; v_new jsonb:=to_jsonb(NEW);
BEGIN
 IF TG_OP='UPDATE' THEN v_old:=to_jsonb(OLD); END IF;
 -- GPS and other high-frequency writes must not produce events or fan-out.
 IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status AND
   NEW.delivery_driver_id IS NOT DISTINCT FROM OLD.delivery_driver_id AND
   v_new->>'client_confirmed_at' IS NOT DISTINCT FROM v_old->>'client_confirmed_at' THEN
   NEW.notification_revision:=OLD.notification_revision;
   RETURN NEW;
 END IF;
 NEW.notification_revision:=CASE WHEN TG_OP='INSERT' THEN 1 ELSE OLD.notification_revision+1 END;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_order_revision BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.capture_order_notifications();

CREATE FUNCTION public.emit_order_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_owner uuid; v_title text; v_old jsonb:='{}'; v_new jsonb:=to_jsonb(NEW);
BEGIN
 IF TG_OP='UPDATE' THEN
   IF NEW.notification_revision=OLD.notification_revision THEN RETURN NEW; END IF;
   v_old:=to_jsonb(OLD);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM notification_routes WHERE capture_enabled) THEN RETURN NEW; END IF;
 SELECT owner_id INTO v_owner FROM restaurants WHERE id=NEW.restaurant_id;
 IF TG_OP='INSERT' THEN
   PERFORM enqueue_order_notice(NEW.id,NEW.notification_revision,'restaurant',v_owner,NULL,'order.created','Nuevo pedido','Abre PideYa para revisar y aceptar el pedido.',0::smallint);
 END IF;
 IF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
   v_title:=CASE NEW.status::text WHEN 'ACCEPTED' THEN 'Pedido aceptado' WHEN 'PREPARING' THEN 'Están preparando tu pedido'
     WHEN 'PICKING' THEN 'Están surtiendo tu pedido' WHEN 'ADJUSTED' THEN 'Revisa los cambios de tu pedido'
     WHEN 'READY' THEN 'Tu pedido está listo' WHEN 'ON_THE_WAY' THEN 'Tu pedido va en camino'
     WHEN 'DELIVERED' THEN 'Pedido entregado' WHEN 'REJECTED' THEN 'Pedido rechazado' WHEN 'CANCELLED' THEN 'Pedido cancelado' ELSE NULL END;
   IF v_title IS NOT NULL THEN
     PERFORM enqueue_order_notice(NEW.id,NEW.notification_revision,'client',(v_new->>'client_user_id')::uuid,NULL,'order.'||lower(NEW.status::text),v_title,'Abre PideYa para ver el estado de tu pedido.');
   END IF;
   IF NEW.status::text IN ('CANCELLED','DELIVERED') THEN
     PERFORM enqueue_order_notice(NEW.id,NEW.notification_revision,'restaurant',v_owner,NULL,'order.'||lower(NEW.status::text),v_title,'Consulta el estado actualizado del pedido.');
   END IF;
   IF NEW.status::text IN ('CANCELLED','READY') AND NEW.delivery_driver_id IS NOT NULL THEN
     PERFORM enqueue_order_notice(NEW.id,NEW.notification_revision,'driver',NULL,NEW.delivery_driver_id,'order.'||lower(NEW.status::text),v_title,'Consulta tu lista de entregas.');
   END IF;
 END IF;
 IF NEW.delivery_driver_id IS DISTINCT FROM (v_old->>'delivery_driver_id')::uuid THEN
   IF NEW.delivery_driver_id IS NOT NULL THEN
     PERFORM enqueue_order_notice(NEW.id,NEW.notification_revision,'driver',NULL,NEW.delivery_driver_id,'driver.assigned','Nueva entrega asignada','Abre PideYa Repartidor para revisar la entrega.',0::smallint);
   END IF;
   IF v_old->>'delivery_driver_id' IS NOT NULL THEN
     PERFORM enqueue_order_notice(NEW.id,NEW.notification_revision,'driver',NULL,(v_old->>'delivery_driver_id')::uuid,'driver.unassigned','Entrega reasignada','Esta entrega ya no está asignada a ti.');
   END IF;
 END IF;
 IF v_new->>'client_confirmed_at' IS NOT NULL AND v_old->>'client_confirmed_at' IS NULL THEN
   PERFORM enqueue_order_notice(NEW.id,NEW.notification_revision,'restaurant',v_owner,NULL,'picking.confirmed','Cambios confirmados','El cliente confirmó el resumen de surtido.',0::smallint);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_order_events AFTER INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.emit_order_notifications();

-- Global per-app reservation: concurrent workers share the same throttle and leases.
CREATE FUNCTION public.claim_notifications(p_app text,p_receipts boolean DEFAULT false)
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
   'current_status',o.status::text,'current_revision',o.notification_revision,'current_driver_id',o.delivery_driver_id)),'[]') INTO result
 FROM claimed c JOIN notification_endpoints ep ON ep.id=c.endpoint_id JOIN notification_events ev ON ev.id=c.event_id
 JOIN orders o ON o.id=ev.order_id;
 RETURN result;
END $$;

CREATE FUNCTION public.finish_notification(p_id bigint,p_lease uuid,p_state text,p_code text DEFAULT NULL,p_ticket text DEFAULT NULL,p_delay integer DEFAULT 0,p_disable boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_endpoint uuid;
BEGIN
 IF p_state NOT IN ('pending','receipt','accepted','dead','expired') THEN RAISE EXCEPTION 'Invalid result'; END IF;
 UPDATE notification_deliveries SET state=p_state,error_code=left(p_code,120),ticket_id=coalesce(p_ticket,ticket_id),
   available_at=now()+make_interval(secs=>greatest(0,least(p_delay,86400))),lease_until=NULL,lease_id=NULL,updated_at=now()
 WHERE id=p_id AND lease_id=p_lease AND lease_until>now() RETURNING endpoint_id INTO v_endpoint;
 IF v_endpoint IS NULL THEN RETURN false; END IF;
 IF p_disable THEN UPDATE notification_endpoints SET active=false WHERE id=v_endpoint; END IF;
 IF p_code IN ('HTTP_429','TOO_MANY_REQUESTS','RESOURCE_EXHAUSTED','HTTP_503','UNAVAILABLE') THEN
   UPDATE notification_routes SET next_send_at=greatest(next_send_at,now()+make_interval(secs=>greatest(30,least(p_delay,900))))
   WHERE app=(SELECT app FROM notification_endpoints WHERE id=v_endpoint);
 END IF;
 RETURN true;
END $$;

CREATE FUNCTION public.finish_notifications(p_results jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item jsonb; result jsonb:='[]'; ok boolean;
BEGIN
 IF jsonb_typeof(p_results)<>'array' OR jsonb_array_length(p_results)>100 THEN RAISE EXCEPTION 'Invalid result batch'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_results) LOOP
   ok:=finish_notification((item->>'p_id')::bigint,(item->>'p_lease')::uuid,item->>'p_state',item->>'p_code',item->>'p_ticket',coalesce((item->>'p_delay')::integer,0),coalesce((item->>'p_disable')::boolean,false));
   result:=result||jsonb_build_array(jsonb_build_object('id',item->>'p_id','ack',ok));
 END LOOP;
 RETURN result;
END $$;

-- Never expose service functions through the default PUBLIC execute grant.
REVOKE ALL ON FUNCTION public.enqueue_order_notice(uuid,bigint,text,uuid,uuid,text,text,text,smallint),public.capture_order_notifications(),public.emit_order_notifications(),public.claim_notifications(text,boolean),public.finish_notification(bigint,uuid,text,text,text,integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notifications(text,boolean),public.finish_notification(bigint,uuid,text,text,text,integer,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.finish_notifications(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_notifications(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.register_notification_endpoint(text,text,text,jsonb,text),public.unregister_notification_endpoint(uuid,text),public.open_notification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_notification_endpoint(text,text,text,jsonb,text),public.unregister_notification_endpoint(uuid,text) TO authenticated,anon;
GRANT EXECUTE ON FUNCTION public.open_notification(uuid) TO authenticated;
COMMIT;
