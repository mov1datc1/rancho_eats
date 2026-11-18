-- Transactional order summaries. Disabled until domain/provider/staging QA are ready.
BEGIN;
CREATE TABLE public.order_email_channel (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 capture_enabled boolean NOT NULL DEFAULT false,
 send_enabled boolean NOT NULL DEFAULT false,
 capture_errors bigint NOT NULL DEFAULT 0,
 last_capture_error_at timestamptz
);
INSERT INTO public.order_email_channel DEFAULT VALUES;
CREATE TABLE public.order_receipt_emails (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 recipient text NOT NULL,
 snapshot jsonb NOT NULL,
 request jsonb,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','sending','accepted','dead','skipped')),
 attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 first_attempt_at timestamptz,
 available_at timestamptz NOT NULL DEFAULT now(),
 lease_id uuid,
 lease_until timestamptz,
 provider_id text,
 error_code text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_receipt_email_ready ON public.order_receipt_emails(available_at,id) WHERE state IN('pending','sending');
ALTER TABLE public.order_email_channel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_receipt_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_email_channel,public.order_receipt_emails FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.order_email_channel,public.order_receipt_emails TO service_role;

CREATE FUNCTION public.capture_order_receipt_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE recipient_email text; lines jsonb; final_total numeric; shipping numeric; fee numeric;
BEGIN
 IF NEW.status::text<>'DELIVERED' OR OLD.status::text='DELIVERED' THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM order_email_channel WHERE id AND capture_enabled) THEN RETURN NEW; END IF;
 SELECT u.email INTO recipient_email FROM auth.users u WHERE u.id=NEW.client_user_id
   AND u.email_confirmed_at IS NOT NULL AND nullif(trim(u.email),'') IS NOT NULL;
 IF recipient_email IS NULL THEN RETURN NEW; END IF;
 final_total:=coalesce(NEW.adjusted_total,NEW.total);
 shipping:=coalesce(NEW.delivery_amount,0);fee:=coalesce(NEW.commission_amount,0);
 IF EXISTS(SELECT 1 FROM order_picking_items WHERE order_id=NEW.id) THEN
   SELECT jsonb_agg(jsonb_build_object('name',left(coalesce(substitute_name,requested_name),200),
     'qty',picked_quantity,'amount',picked_price) ORDER BY created_at,id) INTO lines
   FROM order_picking_items WHERE order_id=NEW.id AND status<>'UNAVAILABLE' AND picked_quantity>0;
 ELSE
   SELECT jsonb_agg(jsonb_build_object('name',left(coalesce(i->>'name','Producto'),200),
     'qty',coalesce((i->>'qty')::numeric,(i->>'quantity')::numeric),
     'amount',round(coalesce((i->>'qty')::numeric,(i->>'quantity')::numeric)*
       (coalesce((i->>'unit_price')::numeric,(i->>'price')::numeric)+
       coalesce((SELECT sum((e->>'price')::numeric) FROM jsonb_array_elements(coalesce(i->'options','[]')) e),0)),2)))
   INTO lines FROM jsonb_array_elements(NEW.items) i;
 END IF;
 INSERT INTO order_receipt_emails(order_id,user_id,recipient,snapshot)
 VALUES(NEW.id,NEW.client_user_id,recipient_email,jsonb_build_object(
   'reference',coalesce(NEW.reference_code,'#'||NEW.order_number::text),
   'restaurant', (SELECT name FROM restaurants WHERE id=NEW.restaurant_id),
   'delivered_at',coalesce(NEW.delivered_at,now()),'items',coalesce(lines,'[]'),
   'subtotal',final_total-shipping-fee,'delivery',shipping,'fee',fee,'total',final_total,
   'payment_method',coalesce(NEW.payment_method,'cash'),'template_version',1))
 ON CONFLICT(order_id) DO NOTHING;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN
 -- Email is auxiliary: never prevent delivery/cash settlement. Keep a private alert counter.
 UPDATE order_email_channel SET capture_errors=capture_errors+1,last_capture_error_at=now() WHERE id;
 RETURN NEW;
END $$;
CREATE TRIGGER delivered_order_email AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.capture_order_receipt_email();

CREATE FUNCTION public.claim_order_receipt_emails() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM order_email_channel WHERE id AND send_enabled) THEN RETURN '[]'; END IF;
 -- Resend deduplicates for 24h. Never retry uncertain submissions beyond 23h.
 UPDATE order_receipt_emails e SET state='dead',error_code='RETRY_WINDOW_EXPIRED',lease_id=NULL,lease_until=NULL,updated_at=now()
 WHERE e.state IN('pending','sending') AND (e.lease_until IS NULL OR e.lease_until<now())
 AND (e.first_attempt_at<now()-interval '23 hours' OR e.created_at<now()-interval '24 hours');
 WITH candidates AS (
   SELECT id FROM order_receipt_emails WHERE state IN('pending','sending') AND available_at<=now()
   AND (lease_until IS NULL OR lease_until<now()) ORDER BY available_at,id LIMIT 5 FOR UPDATE SKIP LOCKED
 ), claimed AS (
   UPDATE order_receipt_emails e SET state=CASE WHEN o.client_user_id IS DISTINCT FROM e.user_id OR o.status::text<>'DELIVERED' OR u.id IS NULL
     OR u.email_confirmed_at IS NULL OR u.email IS DISTINCT FROM e.recipient THEN 'skipped'
     WHEN e.attempts>=8 THEN 'dead' ELSE 'sending' END,
     error_code=CASE WHEN o.client_user_id IS DISTINCT FROM e.user_id OR o.status::text<>'DELIVERED' OR u.id IS NULL OR u.email_confirmed_at IS NULL
       OR u.email IS DISTINCT FROM e.recipient THEN 'RECIPIENT_OR_ORDER_CHANGED' WHEN e.attempts>=8 THEN 'MAX_ATTEMPTS' END,
     attempts=e.attempts+1,first_attempt_at=coalesce(e.first_attempt_at,now()),
     lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now()
   FROM candidates c,orders o LEFT JOIN auth.users u ON u.id=o.client_user_id
   WHERE e.id=c.id AND o.id=e.order_id
   RETURNING e.*
 ) SELECT coalesce(jsonb_agg(to_jsonb(c)) FILTER(WHERE c.state='sending'),'[]') INTO result FROM claimed c;
 RETURN result;
END $$;

-- Persist the exact request before external I/O. Retries keep the same body and recipient,
-- even if a template or sender configuration changes between deployments.
CREATE FUNCTION public.prepare_order_receipt_email(p_id uuid,p_lease uuid,p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 UPDATE order_receipt_emails SET request=coalesce(request,p_request)
 WHERE id=p_id AND lease_id=p_lease AND lease_until>now() AND state='sending'
   AND p_request->'to'=jsonb_build_array(recipient)
 RETURNING request INTO result;
 RETURN result;
END $$;
CREATE FUNCTION public.finish_order_receipt_email(p_id uuid,p_lease uuid,p_state text,p_code text DEFAULT NULL,p_provider_id text DEFAULT NULL,p_delay integer DEFAULT 60)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_state NOT IN('pending','accepted','dead') THEN RAISE EXCEPTION 'Invalid email state'; END IF;
 UPDATE order_receipt_emails SET state=CASE WHEN p_state='pending' AND attempts>=8 THEN 'dead' ELSE p_state END,
   error_code=left(p_code,80),provider_id=coalesce(p_provider_id,provider_id),
   available_at=now()+make_interval(secs=>greatest(30,least(p_delay,3600))),
   lease_id=NULL,lease_until=NULL,updated_at=now()
 WHERE id=p_id AND lease_id=p_lease AND lease_until>now() AND state='sending';
 RETURN FOUND;
END $$;
CREATE VIEW public.order_email_health AS
 SELECT state,count(*) jobs,min(created_at) oldest_at FROM public.order_receipt_emails GROUP BY state;
REVOKE ALL ON public.order_email_health FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.order_email_health TO service_role;
REVOKE ALL ON FUNCTION public.capture_order_receipt_email(),public.claim_order_receipt_emails(),public.prepare_order_receipt_email(uuid,uuid,jsonb),public.finish_order_receipt_email(uuid,uuid,text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_order_receipt_emails(),public.prepare_order_receipt_email(uuid,uuid,jsonb),public.finish_order_receipt_email(uuid,uuid,text,text,text,integer) TO service_role;
COMMIT;
