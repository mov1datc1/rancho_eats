BEGIN;
CREATE INDEX IF NOT EXISTS orders_operations_period ON orders(created_at DESC,restaurant_id,status);
CREATE FUNCTION public.operations_metrics(p_days integer DEFAULT 7,p_restaurant uuid DEFAULT NULL,p_category text DEFAULT NULL,p_status text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT(EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) OR EXISTS(SELECT 1 FROM restaurants WHERE owner_id=auth.uid())) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF p_days NOT BETWEEN 1 AND 31 THEN RAISE EXCEPTION 'Periodo inválido'; END IF;
 IF p_restaurant IS NOT NULL AND NOT can_manage_business(p_restaurant) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 WITH filtered AS MATERIALIZED (
 SELECT o.* FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.created_at>=now()-make_interval(days=>p_days)
 AND can_manage_business(o.restaurant_id) AND (p_restaurant IS NULL OR o.restaurant_id=p_restaurant)
 AND (p_category IS NULL OR coalesce(o.category_snapshot,r.type)=p_category) AND (p_status IS NULL OR o.status::text=p_status)
 ) SELECT jsonb_build_object(
 'total',count(*),'pending',count(*) FILTER(WHERE status='PENDING'),'on_the_way',count(*) FILTER(WHERE status='ON_THE_WAY'),
 'delivered',count(*) FILTER(WHERE status='DELIVERED'),'cancelled',count(*) FILTER(WHERE status='CANCELLED'),'rejected',count(*) FILTER(WHERE status='REJECTED'),
 'average_delivery_minutes',round(avg(extract(epoch FROM delivered_at-delivery_started_at)/60) FILTER(WHERE status='DELIVERED' AND delivered_at>=delivery_started_at)::numeric,1),
 'average_response_minutes',round(avg(extract(epoch FROM accepted_at-created_at)/60) FILTER(WHERE accepted_at>=created_at)::numeric,1),
 'open_incidents',(SELECT count(*) FROM order_incidents i JOIN filtered f ON f.id=i.order_id WHERE i.status<>'RESOLVED'),
 'unsettled_cycles',(SELECT count(*) FROM delivery_cycles c JOIN filtered f ON f.id=c.order_id WHERE c.closed_at IS NULL),
 'cash_pending',(SELECT coalesce(sum(greatest(0,coalesce(c.cash_collected,0)-coalesce(c.cash_received,0))),0) FROM delivery_cycles c JOIN filtered f ON f.id=c.order_id WHERE c.closed_at IS NULL)
 ) INTO result FROM filtered;
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION operations_metrics(integer,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION operations_metrics(integer,uuid,text,text) TO authenticated;
COMMIT;
