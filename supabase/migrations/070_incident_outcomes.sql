-- 070: resolving an incident records what happened to the order.
-- Before, "Resolver incidencia" only closed the incident; the order stayed as it was, so an order that
-- could not be delivered remained open with no outcome for the customer's history. Now the business
-- chooses the outcome:
--   CONTINUES  the order goes on (or is already finished); the order is not touched.
--   CANCELLED  the order is cancelled; the note is the reason the customer sees in their history.
-- Cancelling is refused while the driver holds the package or the cash (resolve the return and
-- settlement first) and for non-cash payments, which need a refund review. Delivery itself is still
-- confirmed only by the driver (proof and cash), never from an incident.
BEGIN;
SET LOCAL lock_timeout = '15s';

ALTER TABLE public.order_incidents
  ADD COLUMN IF NOT EXISTS outcome text CHECK (outcome IS NULL OR outcome IN ('CONTINUES', 'CANCELLED'));

CREATE OR REPLACE FUNCTION public.resolve_order_incident(p_id uuid, p_outcome text, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE i order_incidents; o orders; v_note text := left(trim(coalesce(p_note, '')), 2000);
BEGIN
  SELECT * INTO i FROM order_incidents WHERE id = p_id;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Incidencia no encontrada'; END IF;
  SELECT * INTO o FROM orders WHERE id = i.order_id;
  IF NOT can_manage_business(o.restaurant_id) THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_outcome NOT IN ('CONTINUES', 'CANCELLED') THEN RAISE EXCEPTION 'Resultado inválido'; END IF;
  IF length(v_note) < 5 THEN RAISE EXCEPTION 'Indica la acción o resolución'; END IF;

  PERFORM dispatch_lock_business(o.restaurant_id);
  SELECT * INTO i FROM order_incidents WHERE id = p_id FOR UPDATE;
  SELECT * INTO o FROM orders WHERE id = i.order_id FOR UPDATE;
  IF i.status = 'RESOLVED' THEN RAISE EXCEPTION 'Incidencia ya resuelta'; END IF;

  IF p_outcome = 'CANCELLED' THEN
    IF o.status IN ('DELIVERED', 'CANCELLED', 'REJECTED') THEN
      RAISE EXCEPTION 'El pedido ya está cerrado; resuelve la incidencia sin cancelar';
    END IF;
    IF EXISTS (SELECT 1 FROM delivery_cycles WHERE order_id = o.id AND closed_at IS NULL) THEN
      RAISE EXCEPTION 'Entrega con custodia: registra el regreso y la liquidación antes de cancelar';
    END IF;
    IF coalesce(o.payment_method, 'cash') <> 'cash' THEN
      RAISE EXCEPTION 'La cancelación requiere revisión de pago';
    END IF;
    -- Withdraw any open delivery offer so no driver keeps a reservation on a cancelled order.
    UPDATE delivery_offers SET state = 'CANCELLED', responded_at = clock_timestamp(), note = left('Pedido cancelado: ' || v_note, 2000)
      WHERE order_id = o.id AND state IN ('OFFERED', 'ACCEPTED');
    PERFORM set_config('pideya.dispatch', 'yes', true);
    UPDATE orders SET status = 'CANCELLED', cancelled_by = 'merchant', cancelled_at = clock_timestamp(),
      rejection_reason = v_note, delivery_driver_id = NULL, delivery_driver_name = NULL, delivery_driver_phone = NULL
      WHERE id = o.id;
  END IF;

  UPDATE order_incidents SET status = 'RESOLVED', outcome = p_outcome, resolution = v_note,
    assigned_to = auth.uid(), updated_at = now(), resolved_at = now()
    WHERE id = p_id;
  INSERT INTO operation_audit(order_id, actor, action, details)
    VALUES (i.order_id, auth.uid(), 'INCIDENT_RESOLVED', jsonb_build_object('incident_id', p_id, 'outcome', p_outcome, 'note', v_note));
END $$;
REVOKE ALL ON FUNCTION public.resolve_order_incident(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_order_incident(uuid, text, text) TO authenticated;

-- The old call may still resolve from installed app builds; it keeps working and records CONTINUES.
CREATE OR REPLACE FUNCTION public.manage_order_incident(p_id uuid, p_status text, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE i order_incidents; r uuid;
BEGIN
  SELECT * INTO i FROM order_incidents WHERE id = p_id FOR UPDATE;
  SELECT restaurant_id INTO r FROM orders WHERE id = i.order_id;
  IF NOT can_manage_business(r) THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_status NOT IN ('IN_PROGRESS', 'WAITING_RETURN', 'RESOLVED') THEN RAISE EXCEPTION 'Estado inválido'; END IF;
  IF length(trim(p_note)) < 5 THEN RAISE EXCEPTION 'Indica la acción o resolución'; END IF;
  IF i.status = 'RESOLVED' THEN RAISE EXCEPTION 'Incidencia ya resuelta'; END IF;
  UPDATE order_incidents SET status = p_status, resolution = p_note, assigned_to = auth.uid(), updated_at = now(),
    resolved_at = CASE WHEN p_status = 'RESOLVED' THEN now() END,
    outcome = CASE WHEN p_status = 'RESOLVED' THEN 'CONTINUES' END
    WHERE id = p_id;
  INSERT INTO operation_audit(order_id, actor, action, details) VALUES (i.order_id, auth.uid(), 'INCIDENT_' || p_status, jsonb_build_object('note', p_note));
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
