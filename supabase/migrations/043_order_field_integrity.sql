BEGIN;
-- Direct clients may update only operational fields; financial adjustments require authorized RPCs.
CREATE OR REPLACE FUNCTION public.order_transition_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF OLD.status='PENDING' AND NEW.status IN('ACCEPTED','PREPARING') THEN
  IF now()>=OLD.response_deadline THEN RAISE EXCEPTION 'Venció el plazo de respuesta'; END IF;
  IF OLD.proposal_expires_at IS NOT NULL AND current_setting('pideya.approve_proposal',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Falta la aprobación del cliente'; END IF;
  NEW.accepted_at:=now();
 END IF;
 IF current_user IN('anon','authenticated') THEN
  IF NOT(OLD.status='PENDING' AND NEW.status='ACCEPTED') THEN NEW.accepted_at:=OLD.accepted_at; END IF;
  IF NOT(OLD.status='READY' AND NEW.status='DELIVERED' AND OLD.delivery_type='pickup') THEN NEW.delivered_at:=OLD.delivered_at; END IF;
  IF (to_jsonb(NEW)-ARRAY['notification_revision','status','accepted_at','updated_at','rejection_reason','cancelled_by','cancelled_at','delivery_driver_id','delivery_driver_name','delivery_driver_phone','estimated_cycle_minutes','delivered_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['notification_revision','status','accepted_at','updated_at','rejection_reason','cancelled_by','cancelled_at','delivery_driver_id','delivery_driver_name','delivery_driver_phone','estimated_cycle_minutes','delivered_at']) THEN RAISE EXCEPTION 'Usa las operaciones autorizadas del pedido'; END IF;
  IF can_manage_business(OLD.restaurant_id) AND NEW.status<>OLD.status THEN
   IF NOT ((OLD.status='PENDING' AND NEW.status IN('ACCEPTED','REJECTED')) OR
     (OLD.status IN('ACCEPTED','PREPARING') AND NEW.status='READY' AND EXISTS(SELECT 1 FROM restaurants r JOIN app_categories c ON lower(trim(c.name))=lower(trim(r.type)) WHERE r.id=OLD.restaurant_id AND c.flow_type='prepared')) OR
     (OLD.status='READY' AND NEW.status='DELIVERED' AND OLD.delivery_type='pickup')) THEN RAISE EXCEPTION 'Usa el flujo de surtido, reparto o resolución de incidencias'; END IF;
  END IF;
  IF NOT can_manage_business(OLD.restaurant_id) THEN
   IF auth.uid() IS DISTINCT FROM OLD.client_user_id OR OLD.status<>'PENDING' OR NEW.status<>'CANCELLED' THEN RAISE EXCEPTION 'Transición no autorizada'; END IF;
  END IF;
 END IF;
 IF OLD.status IN('DELIVERED','CANCELLED','REJECTED') AND NEW.status<>OLD.status THEN RAISE EXCEPTION 'Pedido finalizado'; END IF;
 RETURN NEW;
END;$$;
COMMIT;
