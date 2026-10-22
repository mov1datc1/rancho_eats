BEGIN;
-- An operational alert is not an automatic phone call or SMS.
-- The operations dashboard/monitor must page an on-call human on these rows.
CREATE TABLE public.notification_incidents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
 kind text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz,
 UNIQUE(order_id,kind)
);
ALTER TABLE public.notification_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_incidents FROM anon,authenticated;
GRANT SELECT ON public.notification_incidents TO authenticated;
GRANT ALL ON public.notification_incidents TO service_role;
CREATE POLICY notification_incidents_admin ON public.notification_incidents FOR SELECT TO authenticated
 USING (EXISTS(SELECT 1 FROM public.admin_profiles WHERE id=auth.uid()));
CREATE INDEX notification_pending_orders ON public.orders(created_at) WHERE status='PENDING';

CREATE FUNCTION public.maintain_notifications()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item record;
BEGIN
 IF NOT pg_try_advisory_xact_lock(3132032) THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM notification_routes WHERE capture_enabled AND enabled) THEN RETURN; END IF;
 -- Bounded sweep: no repeated reminders and no scan of the complete order history.
 FOR item IN SELECT o.id,o.notification_revision,r.owner_id FROM orders o JOIN restaurants r ON r.id=o.restaurant_id
   WHERE o.status='PENDING' AND o.created_at<now()-interval '3 minutes'
   AND o.created_at>now()-interval '30 minutes'
   AND NOT EXISTS(SELECT 1 FROM notification_events e WHERE e.order_id=o.id AND e.kind='order.reminder')
   ORDER BY o.created_at LIMIT 100 FOR UPDATE OF o SKIP LOCKED
 LOOP
   PERFORM enqueue_order_notice(item.id,item.notification_revision,'restaurant',item.owner_id,NULL,'order.reminder','Pedido pendiente de aceptar','Abre PideYa y confirma si puedes atender el pedido.',0::smallint);
 END LOOP;
 INSERT INTO notification_incidents(order_id,kind)
 SELECT id,'restaurant_unacknowledged' FROM orders WHERE status='PENDING'
 AND created_at<now()-interval '7 minutes' AND created_at>now()-interval '24 hours'
 AND NOT EXISTS(SELECT 1 FROM notification_incidents i WHERE i.order_id=orders.id AND i.kind='restaurant_unacknowledged')
 ORDER BY created_at LIMIT 100 ON CONFLICT DO NOTHING;
 UPDATE notification_incidents i SET resolved_at=now() FROM orders o
 WHERE i.order_id=o.id AND i.resolved_at IS NULL AND o.status<>'PENDING';
 -- Small retention batches keep locks short. Events have no addresses/phone numbers.
 DELETE FROM notification_events WHERE id IN
 (SELECT e.id FROM notification_events e WHERE e.created_at<now()-interval '30 days'
 AND NOT EXISTS(SELECT 1 FROM notification_deliveries d WHERE d.event_id=e.id AND d.state IN ('pending','sending','receipt')) LIMIT 1000);
END $$;
REVOKE ALL ON FUNCTION public.maintain_notifications() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.maintain_notifications() TO service_role;
-- Service-only view; no browser role receives access (compatible with PostgreSQL 14+).
CREATE VIEW public.notification_health AS
 SELECT d.app,d.state,count(*) AS jobs,min(e.created_at) AS oldest_event_at,
 count(*) FILTER(WHERE d.lease_until<now() AND d.state='sending') AS abandoned_leases
 FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id GROUP BY d.app,d.state;
REVOKE ALL ON public.notification_health FROM anon,authenticated;
GRANT SELECT ON public.notification_health TO service_role;
COMMIT;
