BEGIN;
-- One ledger for both merchant and platform; agreements never change order prices.
CREATE TABLE public.commission_collection_agreements(
 restaurant_id uuid PRIMARY KEY REFERENCES public.restaurants(id),
 frequency text NOT NULL DEFAULT 'monthly' CHECK(frequency IN('weekly','fortnightly','monthly')),
 updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.commission_collection_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY commission_agreement_read ON public.commission_collection_agreements FOR SELECT TO authenticated USING(
 EXISTS(SELECT 1 FROM public.admin_profiles WHERE id=auth.uid()) OR EXISTS(SELECT 1 FROM public.restaurants WHERE id=restaurant_id AND owner_id=auth.uid()));
GRANT SELECT ON public.commission_collection_agreements TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.commission_collection_agreements FROM authenticated,anon;
ALTER TABLE public.commission_payments ADD COLUMN receipt_number bigint GENERATED ALWAYS AS IDENTITY,
 ADD COLUMN business_name text,ADD COLUMN received_by text,ADD COLUMN collection_method text NOT NULL DEFAULT 'unspecified',
 ADD COLUMN collection_frequency text NOT NULL DEFAULT 'monthly',ADD COLUMN collection_request_id uuid;
CREATE UNIQUE INDEX commission_receipt_number ON public.commission_payments(receipt_number);
CREATE UNIQUE INDEX commission_request_once ON public.commission_payments(collection_request_id) WHERE collection_request_id IS NOT NULL;
ALTER TABLE public.commission_payments ADD CONSTRAINT commission_method CHECK(collection_method IN('cash','transfer','other','unspecified')),
 ADD CONSTRAINT commission_frequency CHECK(collection_frequency IN('weekly','fortnightly','monthly'));
UPDATE public.commission_payments cp SET business_name=r.name FROM public.restaurants r WHERE r.id=cp.restaurant_id;
CREATE INDEX commission_allocations_payment ON public.commission_allocations(payment_id);
CREATE INDEX commission_delivered_period ON public.orders(restaurant_id,created_at,id) INCLUDE(commission_amount) WHERE status='DELIVERED';
CREATE FUNCTION public.commission_items(p_from date,p_to date,p_restaurant uuid)
RETURNS TABLE(order_id uuid,restaurant_id uuid,name text,order_number integer,created_at timestamptz,commission_amount numeric,settlement text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT o.id,o.restaurant_id,r.name,o.order_number,o.created_at,coalesce(o.commission_amount,0),
 CASE WHEN a.order_id IS NOT NULL THEN 'paid' WHEN EXISTS(SELECT 1 FROM commission_payments cp WHERE cp.restaurant_id=o.restaurant_id AND (o.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN cp.period_start AND cp.period_end AND NOT EXISTS(SELECT 1 FROM commission_allocations ca WHERE ca.payment_id=cp.id)) THEN 'legacy' ELSE 'due' END
 FROM orders o JOIN restaurants r ON r.id=o.restaurant_id LEFT JOIN commission_allocations a ON a.order_id=o.id
 WHERE o.status='DELIVERED' AND (p_from IS NULL OR o.created_at>=p_from::timestamp AT TIME ZONE 'America/Mexico_City')
 AND (p_to IS NULL OR o.created_at<(p_to+1)::timestamp AT TIME ZONE 'America/Mexico_City') AND(p_restaurant IS NULL OR o.restaurant_id=p_restaurant)
$$;
REVOKE ALL ON FUNCTION public.commission_items(date,date,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.commission_statement(p_restaurant uuid,p_from date,p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT(EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) OR EXISTS(SELECT 1 FROM restaurants WHERE id=p_restaurant AND owner_id=auth.uid())) THEN RAISE EXCEPTION 'not_authorized'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>366 THEN RAISE EXCEPTION 'invalid_period'; END IF;
 WITH items AS(SELECT * FROM commission_items(p_from,p_to,p_restaurant)),
 balances AS(SELECT restaurant_id,name,count(*) orders_count,sum(commission_amount) generated,
 coalesce(sum(commission_amount) FILTER(WHERE settlement='paid'),0) paid,coalesce(sum(commission_amount) FILTER(WHERE settlement='legacy'),0) legacy,
 coalesce(sum(commission_amount) FILTER(WHERE settlement='due'),0) due FROM items GROUP BY restaurant_id,name),
 outstanding AS(SELECT restaurant_id,sum(commission_amount) FILTER(WHERE settlement='due') due,sum(commission_amount) FILTER(WHERE settlement='legacy') legacy FROM commission_items(NULL,NULL,p_restaurant) GROUP BY restaurant_id)
 SELECT jsonb_build_object('balances',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY due DESC,name) FROM balances b),'[]'::jsonb),
 'outstanding',coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM outstanding b),'[]'::jsonb),
 'agreements',coalesce((SELECT jsonb_agg(jsonb_build_object('restaurant_id',r.id,'name',r.name,'frequency',coalesce(a.frequency,'monthly')) ORDER BY r.name) FROM restaurants r LEFT JOIN commission_collection_agreements a ON a.restaurant_id=r.id WHERE p_restaurant IS NULL OR r.id=p_restaurant),'[]'::jsonb),
 'payments',coalesce((SELECT jsonb_agg(to_jsonb(p)-'paid_by'-'collection_request_id') FROM(SELECT cp.*,coalesce(cp.business_name,r.name) name FROM commission_payments cp JOIN restaurants r ON r.id=cp.restaurant_id WHERE(p_restaurant IS NULL OR cp.restaurant_id=p_restaurant) AND cp.period_start<=p_to AND cp.period_end>=p_from ORDER BY cp.paid_at DESC,cp.id LIMIT 200)p),'[]'::jsonb),
 'as_of',statement_timestamp(),'from',p_from,'to',p_to) INTO result;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.admin_commission_statement(p_from date,p_to date,p_restaurant uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'not_authorized';END IF;
 RETURN commission_statement(p_restaurant,p_from,p_to);
END $$;
CREATE FUNCTION public.admin_set_commission_agreement(p_restaurant uuid,p_frequency text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'not_authorized';END IF;
 IF p_frequency NOT IN('weekly','fortnightly','monthly') OR p_frequency IS NULL THEN RAISE EXCEPTION 'invalid_frequency';END IF;
 PERFORM 1 FROM restaurants WHERE id=p_restaurant FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'business_not_found';END IF;
 INSERT INTO commission_collection_agreements(restaurant_id,frequency,updated_by) VALUES(p_restaurant,p_frequency,auth.uid()) ON CONFLICT(restaurant_id) DO UPDATE SET frequency=excluded.frequency,updated_at=now(),updated_by=auth.uid();
END $$;
CREATE FUNCTION public.commission_receipt(p_payment uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cp commission_payments;
BEGIN
 SELECT * INTO cp FROM commission_payments WHERE id=p_payment;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT(EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) OR EXISTS(SELECT 1 FROM restaurants WHERE id=cp.restaurant_id AND owner_id=auth.uid())) THEN RAISE EXCEPTION 'not_authorized';END IF;
 RETURN to_jsonb(cp)-'paid_by'-'collection_request_id'||jsonb_build_object('folio','PY-COM-'||lpad(cp.receipt_number::text,greatest(8,length(cp.receipt_number::text)),'0'),'name',cp.business_name,'historical',cp.collection_request_id IS NULL);
END $$;
CREATE FUNCTION public.admin_receive_commissions(p_restaurant uuid,p_from date,p_to date,p_expected numeric,p_reference text,p_received_by text,p_method text,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ids uuid[];amount numeric;payment uuid;prior commission_payments;business text;freq text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'not_authorized';END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>366 OR length(trim(coalesce(p_reference,''))) NOT BETWEEN 3 AND 500 OR length(trim(coalesce(p_received_by,''))) NOT BETWEEN 3 AND 100 OR p_method IS NULL OR p_method NOT IN('cash','transfer','other') OR p_request_id IS NULL OR p_expected IS NULL OR p_expected<=0 THEN RAISE EXCEPTION 'invalid_collection';END IF;
 SELECT name INTO business FROM restaurants WHERE id=p_restaurant FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'business_not_found';END IF;
 SELECT * INTO prior FROM commission_payments WHERE collection_request_id=p_request_id;
 IF FOUND THEN
  IF prior.restaurant_id IS DISTINCT FROM p_restaurant OR prior.period_start IS DISTINCT FROM p_from OR prior.period_end IS DISTINCT FROM p_to OR prior.total_commission IS DISTINCT FROM p_expected OR prior.notes IS DISTINCT FROM trim(p_reference) OR prior.received_by IS DISTINCT FROM trim(p_received_by) OR prior.collection_method IS DISTINCT FROM p_method OR prior.paid_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'request_conflict';END IF;
  RETURN commission_receipt(prior.id);
 END IF;
 -- Lock eligible order rows after the business lock; overlapping cuts cannot collect twice.
 SELECT array_agg(id),sum(commission_amount) INTO ids,amount FROM(
 SELECT o.id,o.commission_amount FROM orders o WHERE o.restaurant_id=p_restaurant AND o.status='DELIVERED' AND o.commission_amount>0
 AND o.created_at>=p_from::timestamp AT TIME ZONE 'America/Mexico_City' AND o.created_at<(p_to+1)::timestamp AT TIME ZONE 'America/Mexico_City'
 AND NOT EXISTS(SELECT 1 FROM commission_allocations a WHERE a.order_id=o.id)
 AND NOT EXISTS(SELECT 1 FROM commission_payments cp WHERE cp.restaurant_id=o.restaurant_id AND(o.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN cp.period_start AND cp.period_end AND NOT EXISTS(SELECT 1 FROM commission_allocations ca WHERE ca.payment_id=cp.id)) FOR UPDATE OF o)pending;
 IF coalesce(amount,0)<=0 OR amount IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'balance_changed_refresh';END IF;
 SELECT coalesce((SELECT frequency FROM commission_collection_agreements WHERE restaurant_id=p_restaurant),'monthly') INTO freq;
 INSERT INTO commission_payments(restaurant_id,period_start,period_end,orders_count,total_commission,paid_by,notes,business_name,received_by,collection_method,collection_frequency,collection_request_id)
 VALUES(p_restaurant,p_from,p_to,cardinality(ids),amount,auth.uid(),trim(p_reference),business,trim(p_received_by),p_method,freq,p_request_id) RETURNING id INTO payment;
 INSERT INTO commission_allocations SELECT id,payment,commission_amount FROM orders WHERE id=ANY(ids);
 RETURN commission_receipt(payment);
END $$;
-- Preserve the previous admin client contract while routing every collection through the same guards.
CREATE OR REPLACE FUNCTION public.admin_collect_commissions(p_restaurant uuid,p_from date,p_to date,p_expected numeric,p_reference text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE receipt jsonb;
BEGIN
 receipt:=admin_receive_commissions(p_restaurant,p_from,p_to,p_expected,p_reference,'Administración PideYa','other',gen_random_uuid());
 RETURN(receipt->>'id')::uuid;
END $$;
CREATE FUNCTION public.commission_order_detail(p_restaurant uuid,p_from date,p_to date,p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT(EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) OR EXISTS(SELECT 1 FROM restaurants WHERE id=p_restaurant AND owner_id=auth.uid())) OR p_restaurant IS NULL THEN RAISE EXCEPTION 'not_authorized';END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>366 OR p_page IS NULL OR p_page<0 OR p_page>100000 THEN RAISE EXCEPTION 'invalid_period_or_page';END IF;
 RETURN jsonb_build_object('count',(SELECT count(*) FROM commission_items(p_from,p_to,p_restaurant)),
 'rows',coalesce((SELECT jsonb_agg(to_jsonb(i)) FROM(SELECT * FROM commission_items(p_from,p_to,p_restaurant) ORDER BY created_at DESC,order_id LIMIT 25 OFFSET p_page*25)i),'[]'::jsonb));
END $$;
CREATE FUNCTION public.commission_receipt_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'commission_receipts_are_immutable';END $$;
CREATE TRIGGER immutable_commission_receipt BEFORE UPDATE OR DELETE ON public.commission_payments FOR EACH ROW EXECUTE FUNCTION public.commission_receipt_immutable();
CREATE TRIGGER immutable_commission_allocation BEFORE UPDATE OR DELETE ON public.commission_allocations FOR EACH ROW EXECUTE FUNCTION public.commission_receipt_immutable();
REVOKE ALL ON FUNCTION public.commission_receipt_immutable() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.commission_statement(uuid,date,date),public.admin_set_commission_agreement(uuid,text),public.commission_receipt(uuid),public.admin_receive_commissions(uuid,date,date,numeric,text,text,text,uuid),public.commission_order_detail(uuid,date,date,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.commission_statement(uuid,date,date),public.admin_set_commission_agreement(uuid,text),public.commission_receipt(uuid),public.admin_receive_commissions(uuid,date,date,numeric,text,text,text,uuid),public.commission_order_detail(uuid,date,date,integer) TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.commission_payments,public.commission_allocations FROM authenticated,anon;
NOTIFY pgrst,'reload schema';
COMMIT;
