BEGIN;
CREATE TABLE public.commission_allocations (
 order_id uuid PRIMARY KEY REFERENCES orders(id), payment_id uuid NOT NULL REFERENCES commission_payments(id), amount numeric(10,2) NOT NULL CHECK(amount>=0)
);
ALTER TABLE commission_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_read ON commission_allocations FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()));
GRANT SELECT ON commission_allocations TO authenticated;
-- Historical payments lack order detail. Exclude covered orders from new collection and surface them for reconciliation.
CREATE FUNCTION public.admin_commission_statement(p_from date,p_to date,p_restaurant uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to THEN RAISE EXCEPTION 'invalid_period'; END IF;
 WITH items AS (
 SELECT o.*,r.name,
 CASE WHEN a.order_id IS NOT NULL THEN 'paid' WHEN EXISTS(SELECT 1 FROM commission_payments cp WHERE cp.restaurant_id=o.restaurant_id AND (o.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN cp.period_start AND cp.period_end AND NOT EXISTS(SELECT 1 FROM commission_allocations ca WHERE ca.payment_id=cp.id)) THEN 'legacy' ELSE 'due' END AS settlement
 FROM orders o JOIN restaurants r ON r.id=o.restaurant_id LEFT JOIN commission_allocations a ON a.order_id=o.id
 WHERE o.status='DELIVERED' AND o.created_at >= p_from::timestamp AT TIME ZONE 'America/Mexico_City' AND o.created_at < (p_to+1)::timestamp AT TIME ZONE 'America/Mexico_City' AND (p_restaurant IS NULL OR o.restaurant_id=p_restaurant)
 ), balances AS (SELECT restaurant_id,name,count(*) orders_count,sum(commission_amount) generated,
 coalesce(sum(commission_amount) FILTER(WHERE settlement='paid'),0) paid,
 coalesce(sum(commission_amount) FILTER(WHERE settlement='legacy'),0) legacy,
 coalesce(sum(commission_amount) FILTER(WHERE settlement='due'),0) due FROM items GROUP BY restaurant_id,name)
 SELECT jsonb_build_object('balances',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY due DESC,name) FROM balances b),'[]'::jsonb),
 'payments',coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM (SELECT cp.*,r.name FROM commission_payments cp JOIN restaurants r ON r.id=cp.restaurant_id WHERE (p_restaurant IS NULL OR cp.restaurant_id=p_restaurant) AND cp.period_start<=p_to AND cp.period_end>=p_from ORDER BY cp.paid_at DESC LIMIT 200) p),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
CREATE FUNCTION public.admin_collect_commissions(p_restaurant uuid,p_from date,p_to date,p_expected numeric,p_reference text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ids uuid[]; amount numeric; payment uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR length(trim(coalesce(p_reference,'')))<3 THEN RAISE EXCEPTION 'invalid_period_or_reference'; END IF;
 PERFORM 1 FROM restaurants WHERE id=p_restaurant FOR UPDATE;
 SELECT array_agg(id),sum(commission_amount) INTO ids,amount FROM (
 SELECT o.id,o.commission_amount FROM orders o WHERE o.restaurant_id=p_restaurant AND o.status='DELIVERED' AND o.commission_amount>0
 AND o.created_at>=p_from::timestamp AT TIME ZONE 'America/Mexico_City' AND o.created_at<(p_to+1)::timestamp AT TIME ZONE 'America/Mexico_City'
 AND NOT EXISTS(SELECT 1 FROM commission_allocations a WHERE a.order_id=o.id)
 AND NOT EXISTS(SELECT 1 FROM commission_payments cp WHERE cp.restaurant_id=o.restaurant_id AND (o.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN cp.period_start AND cp.period_end AND NOT EXISTS(SELECT 1 FROM commission_allocations ca WHERE ca.payment_id=cp.id)) FOR UPDATE OF o) pending;
 IF coalesce(amount,0)<=0 OR amount IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'balance_changed_refresh'; END IF;
 INSERT INTO commission_payments(restaurant_id,period_start,period_end,orders_count,total_commission,paid_by,notes) VALUES(p_restaurant,p_from,p_to,cardinality(ids),amount,auth.uid(),trim(p_reference)) RETURNING id INTO payment;
 INSERT INTO commission_allocations SELECT id,payment,commission_amount FROM orders WHERE id=ANY(ids);
 RETURN payment;
END $$;
-- Payment receipts are immutable; only the validated RPC writes new ones.
REVOKE INSERT,UPDATE,DELETE ON commission_payments FROM authenticated;
REVOKE ALL ON FUNCTION admin_commission_statement(date,date,uuid),admin_collect_commissions(uuid,date,date,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_commission_statement(date,date,uuid),admin_collect_commissions(uuid,date,date,numeric,text) TO authenticated;
COMMIT;
