-- Deploy with the new merchant/driver apps: legacy direct assignment and pickup are rejected.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE orders ADD COLUMN delivery_assignment_state text CHECK(delivery_assignment_state IN('OFFERED','ACCEPTED','HANDOVER','PICKED'));
CREATE TABLE public.delivery_offers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES orders,
 restaurant_id uuid NOT NULL REFERENCES restaurants,driver_id uuid NOT NULL REFERENCES driver_profiles,
 state text NOT NULL CHECK(state IN('OFFERED','ACCEPTED','HANDOVER','PICKED','DECLINED','EXPIRED','CANCELLED','RELEASED','CLOSED')),
 offered_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz,
 responded_at timestamptz,handover_at timestamptz,picked_at timestamptz,note text,
 CHECK(state<>'OFFERED' OR expires_at IS NOT NULL)
);
CREATE UNIQUE INDEX delivery_one_offer ON delivery_offers(order_id) WHERE state IN('OFFERED','ACCEPTED','HANDOVER','PICKED');
CREATE INDEX delivery_offer_inbox ON delivery_offers(driver_id,state,expires_at);
ALTER TABLE delivery_offers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON delivery_offers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON delivery_offers TO authenticated;
CREATE POLICY delivery_offer_owner ON delivery_offers FOR SELECT TO authenticated USING(can_manage_business(restaurant_id));
-- Preserve existing reservations without claiming that a notification was accepted.
INSERT INTO delivery_offers(order_id,restaurant_id,driver_id,state,note)
 SELECT id,restaurant_id,delivery_driver_id,'ACCEPTED','Reserva anterior a la migración; requiere confirmación física de recogida'
 FROM orders WHERE delivery_driver_id IS NOT NULL AND status IN('ACCEPTED','PREPARING','PICKING','ADJUSTED','READY');

CREATE FUNCTION public.dispatch_lock_business(p_restaurant uuid) RETURNS void LANGUAGE sql AS $$
 SELECT pg_advisory_xact_lock(hashtextextended(p_restaurant::text,5601));
$$;
-- Active profiles may receive offers. Revoked profiles may only resolve their own open custody.
CREATE FUNCTION public.driver_responsibility(p_token text) RETURNS driver_profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d driver_profiles;
BEGIN
 SELECT * INTO d FROM driver_profiles WHERE access_token=trim(p_token);
 IF d.id IS NULL OR length(coalesce(p_token,''))<16 OR (NOT d.is_active AND NOT EXISTS(SELECT 1 FROM delivery_cycles WHERE driver_id=d.id AND closed_at IS NULL)) THEN RAISE EXCEPTION 'Código inválido o desactivado'; END IF;
 RETURN d;
END;$$;
CREATE FUNCTION public.dispatch_validate(p_driver uuid,p_order uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d driver_profiles;s courier_shifts;n integer;minutes integer;
BEGIN
 SELECT * INTO d FROM driver_profiles WHERE id=p_driver;
 IF NOT FOUND OR NOT d.is_active OR d.restaurant_id IS DISTINCT FROM (SELECT restaurant_id FROM orders WHERE id=p_order) THEN RAISE EXCEPTION 'Repartidor de otro negocio o inactivo'; END IF;
 SELECT * INTO s FROM courier_shifts WHERE driver_id=d.id AND closed_at IS NULL;
 IF s.id IS NULL OR NOT s.accepting OR s.available_until<=clock_timestamp() THEN RAISE EXCEPTION 'Repartidor sin turno disponible'; END IF;
 SELECT count(*),coalesce(sum(estimated_cycle_minutes),0) INTO n,minutes FROM orders
 WHERE delivery_driver_id=d.id AND id<>p_order AND status IN('ACCEPTED','PREPARING','PICKING','ADJUSTED','READY');
 IF n>=2 THEN RAISE EXCEPTION 'La cola del repartidor ya tiene dos pedidos'; END IF;
 -- Conservatively reserve a full cycle even when already returning with cash.
 IF EXISTS(SELECT 1 FROM delivery_cycles WHERE driver_id=d.id AND closed_at IS NULL) THEN
  minutes:=minutes+coalesce((SELECT o.estimated_cycle_minutes FROM delivery_cycles c JOIN orders o ON o.id=c.order_id WHERE c.driver_id=d.id AND c.closed_at IS NULL),45);
 END IF;
 IF s.available_until<clock_timestamp()+make_interval(mins=>minutes+(SELECT estimated_cycle_minutes FROM orders WHERE id=p_order)) THEN RAISE EXCEPTION 'El turno no alcanza para la cola, el recorrido y el regreso estimados'; END IF;
END;$$;
-- Default invoker is essential: a client cannot bypass this with a session setting.
CREATE OR REPLACE FUNCTION public.assignment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.delivery_driver_id IS DISTINCT FROM OLD.delivery_driver_id THEN
  NEW.driver_last_lat:=NULL;NEW.driver_last_lng:=NULL;NEW.driver_location_accuracy_m:=NULL;NEW.driver_location_updated_at:=NULL;
  IF current_user IN('anon','authenticated','service_role') OR current_setting('pideya.dispatch',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Usa las ofertas de reparto; actualiza la aplicación'; END IF;
  IF EXISTS(SELECT 1 FROM delivery_cycles WHERE order_id=OLD.id AND closed_at IS NULL) THEN RAISE EXCEPTION 'Entrega con custodia: resuelve el retorno antes de reasignar'; END IF;
 END IF;
 RETURN NEW;
END;$$;

CREATE FUNCTION public.merchant_offer_delivery(p_order_id uuid,p_driver_id uuid,p_expected_driver uuid,p_ttl_seconds integer DEFAULT 90,p_note text DEFAULT NULL) RETURNS delivery_offers LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o orders;d driver_profiles;f delivery_offers;i uuid;
BEGIN
 SELECT * INTO o FROM orders WHERE id=p_order_id;
 IF o.id IS NULL OR NOT can_manage_business(o.restaurant_id) THEN RAISE EXCEPTION 'Pedido no autorizado'; END IF;
 PERFORM dispatch_lock_business(o.restaurant_id);
 SELECT * INTO d FROM driver_profiles WHERE id=p_driver_id;
 IF d.id IS NULL OR d.restaurant_id<>o.restaurant_id THEN RAISE EXCEPTION 'Repartidor de otro negocio o inactivo'; END IF;
 SELECT identity_id INTO i FROM courier_shifts WHERE driver_id=d.id AND closed_at IS NULL;
 PERFORM 1 FROM courier_identities WHERE id=i FOR UPDATE;
 SELECT * INTO d FROM driver_profiles WHERE id=d.id FOR UPDATE;
 PERFORM 1 FROM courier_shifts WHERE driver_id=d.id AND closed_at IS NULL FOR UPDATE;
 SELECT * INTO o FROM orders WHERE id=p_order_id FOR UPDATE;
 IF o.status NOT IN('ACCEPTED','PREPARING','PICKING','ADJUSTED','READY') OR o.delivery_type='pickup' THEN RAISE EXCEPTION 'Pedido no disponible para reparto'; END IF;
 IF EXISTS(SELECT 1 FROM delivery_cycles WHERE order_id=o.id) THEN RAISE EXCEPTION 'Entrega con custodia: resuelve el retorno antes de reasignar'; END IF;
 SELECT * INTO f FROM delivery_offers WHERE order_id=o.id AND state IN('OFFERED','ACCEPTED','HANDOVER','PICKED') FOR UPDATE;
 IF f.driver_id=d.id AND (f.state='ACCEPTED' OR (f.state='OFFERED' AND f.expires_at>clock_timestamp())) THEN RETURN f; END IF;
 IF o.delivery_driver_id IS DISTINCT FROM p_expected_driver THEN RAISE EXCEPTION 'La asignación cambió; actualiza el pedido'; END IF;
 IF o.delivery_driver_id IS NOT NULL AND o.delivery_driver_id<>d.id AND length(trim(coalesce(p_note,'')))<5 THEN RAISE EXCEPTION 'Indica el motivo de la reasignación'; END IF;
 IF p_ttl_seconds IS NULL OR p_ttl_seconds NOT BETWEEN 30 AND 300 THEN RAISE EXCEPTION 'Plazo de oferta inválido'; END IF;
 IF EXISTS(SELECT 1 FROM delivery_offers WHERE order_id=o.id AND driver_id=d.id AND state IN('DECLINED','RELEASED') AND responded_at>clock_timestamp()-interval '10 minutes') THEN RAISE EXCEPTION 'El repartidor ya rechazó esta entrega; elige otro'; END IF;
 PERFORM dispatch_validate(d.id,o.id);
 UPDATE delivery_offers SET state='CANCELLED',responded_at=clock_timestamp(),note=coalesce(left(trim(p_note),2000),'Reemplazada por el negocio') WHERE id=f.id;
 PERFORM set_config('pideya.dispatch','yes',true);
 IF o.delivery_driver_id=d.id THEN UPDATE orders SET delivery_driver_id=NULL,delivery_driver_name=NULL,delivery_driver_phone=NULL WHERE id=o.id; END IF;
 INSERT INTO delivery_offers(order_id,restaurant_id,driver_id,state,expires_at) VALUES(o.id,o.restaurant_id,d.id,'OFFERED',clock_timestamp()+make_interval(secs=>p_ttl_seconds)) RETURNING * INTO f;
 PERFORM set_config('pideya.dispatch','yes',true);
 UPDATE orders SET delivery_driver_id=d.id,delivery_driver_name=d.name,delivery_driver_phone=d.phone WHERE id=o.id;
 UPDATE notification_events SET expires_at=f.expires_at WHERE order_id=o.id AND kind='driver.offered' AND driver_id=d.id AND revision=(SELECT notification_revision FROM orders WHERE id=o.id);
 INSERT INTO operation_audit(order_id,actor,action,details) VALUES(o.id,auth.uid(),'DELIVERY_OFFERED',jsonb_build_object('offer_id',f.id,'driver_id',d.id));
 RETURN f;
END;$$;

CREATE FUNCTION public.driver_reply_delivery(p_token text,p_offer_id uuid,p_accept boolean,p_note text DEFAULT NULL) RETURNS delivery_offers LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d driver_profiles;f delivery_offers;o orders;i uuid;
BEGIN
 d:=driver_responsibility(p_token);
 SELECT * INTO f FROM delivery_offers WHERE id=p_offer_id AND driver_id=d.id;
 IF f.id IS NULL THEN RAISE EXCEPTION 'Oferta no autorizada'; END IF;
 PERFORM dispatch_lock_business(f.restaurant_id);
 SELECT identity_id INTO i FROM courier_shifts WHERE driver_id=d.id AND closed_at IS NULL;
 PERFORM 1 FROM courier_identities WHERE id=i FOR UPDATE;
 SELECT * INTO d FROM driver_profiles WHERE id=d.id FOR UPDATE;
 PERFORM 1 FROM courier_shifts WHERE driver_id=d.id AND closed_at IS NULL FOR UPDATE;
 SELECT * INTO o FROM orders WHERE id=f.order_id FOR UPDATE;
 SELECT * INTO f FROM delivery_offers WHERE id=f.id FOR UPDATE;
 IF p_accept IS NULL THEN RAISE EXCEPTION 'Respuesta inválida'; END IF;
 IF (p_accept AND f.state='ACCEPTED') OR (NOT p_accept AND f.state='DECLINED') THEN RETURN f; END IF;
 IF f.state<>'OFFERED' OR o.delivery_driver_id IS DISTINCT FROM d.id OR o.status NOT IN('ACCEPTED','PREPARING','PICKING','ADJUSTED','READY') THEN RAISE EXCEPTION 'Oferta no vigente'; END IF;
 IF f.expires_at<=clock_timestamp() THEN
  UPDATE delivery_offers SET state='EXPIRED',responded_at=clock_timestamp() WHERE id=f.id RETURNING * INTO f;
  PERFORM set_config('pideya.dispatch','yes',true);
  UPDATE orders SET delivery_driver_id=NULL,delivery_driver_name=NULL,delivery_driver_phone=NULL WHERE id=o.id;
  RETURN f;
 END IF;
 IF p_accept THEN
  PERFORM dispatch_validate(d.id,o.id);
  UPDATE delivery_offers SET state='ACCEPTED',responded_at=clock_timestamp() WHERE id=f.id RETURNING * INTO f;
 ELSE
  IF length(trim(coalesce(p_note,'')))<5 THEN RAISE EXCEPTION 'Indica el motivo del rechazo'; END IF;
  UPDATE delivery_offers SET state='DECLINED',responded_at=clock_timestamp(),note=left(trim(p_note),2000) WHERE id=f.id RETURNING * INTO f;
  PERFORM set_config('pideya.dispatch','yes',true);
  UPDATE orders SET delivery_driver_id=NULL,delivery_driver_name=NULL,delivery_driver_phone=NULL WHERE id=o.id;
 END IF;
 INSERT INTO operation_audit(order_id,actor,action,details) VALUES(o.id,NULL,CASE WHEN p_accept THEN 'DELIVERY_ACCEPTED' ELSE 'DELIVERY_DECLINED' END,jsonb_build_object('offer_id',f.id,'driver_id',d.id,'note',f.note));
 IF p_accept THEN
 PERFORM enqueue_order_notice(o.id,(SELECT notification_revision FROM orders WHERE id=o.id),'restaurant',(SELECT owner_id FROM restaurants WHERE id=o.restaurant_id),NULL,'dispatch.response.'||f.id::text,'Respuesta del repartidor','Revisa la confirmación o el rechazo de la oferta en el pedido.',0::smallint);
 END IF;
 RETURN f;
END;$$;

CREATE FUNCTION public.merchant_confirm_handover(p_offer_id uuid) RETURNS delivery_offers LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f delivery_offers;o orders;d driver_profiles;i uuid;
BEGIN
 SELECT * INTO f FROM delivery_offers WHERE id=p_offer_id;
 IF f.id IS NULL OR NOT can_manage_business(f.restaurant_id) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 PERFORM dispatch_lock_business(f.restaurant_id);
 SELECT identity_id INTO i FROM courier_shifts WHERE driver_id=f.driver_id AND closed_at IS NULL;
 PERFORM 1 FROM courier_identities WHERE id=i FOR UPDATE;
 SELECT * INTO d FROM driver_profiles WHERE id=f.driver_id FOR UPDATE;
 PERFORM 1 FROM courier_shifts WHERE driver_id=d.id AND closed_at IS NULL FOR UPDATE;
 SELECT * INTO o FROM orders WHERE id=f.order_id FOR UPDATE;
 SELECT * INTO f FROM delivery_offers WHERE id=f.id FOR UPDATE;
 IF f.state IN('HANDOVER','PICKED') THEN RETURN f; END IF;
 IF f.state<>'ACCEPTED' OR o.delivery_driver_id IS DISTINCT FROM d.id OR o.status<>'READY' THEN RAISE EXCEPTION 'El pedido debe estar listo y el repartidor debe aceptar antes de entregar el paquete'; END IF;
 PERFORM dispatch_validate(d.id,o.id);
 IF EXISTS(SELECT 1 FROM delivery_cycles WHERE identity_id=i AND closed_at IS NULL) THEN RAISE EXCEPTION 'Regresa y liquida tu entrega anterior'; END IF;
 INSERT INTO delivery_cycles(order_id,identity_id,driver_id,restaurant_id,expected_cash) VALUES(o.id,i,d.id,o.restaurant_id,CASE WHEN coalesce(o.payment_method,'cash')='cash' THEN coalesce(o.adjusted_total,o.total) ELSE 0 END);
 UPDATE delivery_offers SET state='HANDOVER',handover_at=clock_timestamp() WHERE id=f.id RETURNING * INTO f;
 INSERT INTO operation_audit(order_id,actor,action,details) VALUES(o.id,auth.uid(),'PACKAGE_HANDED_OVER',jsonb_build_object('offer_id',f.id,'driver_id',d.id));
 RETURN f;
END;$$;

CREATE FUNCTION public.release_delivery_reservation(p_order_id uuid,p_offer_id uuid,p_note text,p_token text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f delivery_offers;d driver_profiles;o orders;
BEGIN
 SELECT * INTO f FROM delivery_offers WHERE id=p_offer_id AND order_id=p_order_id;
 IF p_token IS NOT NULL THEN d:=driver_responsibility(p_token);IF d.id IS DISTINCT FROM f.driver_id THEN RAISE EXCEPTION 'No autorizado'; END IF;
 ELSIF f.id IS NULL OR NOT can_manage_business(f.restaurant_id) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 PERFORM dispatch_lock_business(f.restaurant_id);
 SELECT * INTO o FROM orders WHERE id=p_order_id FOR UPDATE;
 SELECT * INTO f FROM delivery_offers WHERE id=p_offer_id FOR UPDATE;
 IF f.state IN('RELEASED','CANCELLED','DECLINED','EXPIRED') THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM delivery_cycles WHERE order_id=o.id) OR f.state NOT IN('OFFERED','ACCEPTED') THEN RAISE EXCEPTION 'Entrega con custodia: registra una incidencia y el retorno'; END IF;
 IF length(trim(coalesce(p_note,'')))<5 THEN RAISE EXCEPTION 'Indica el motivo'; END IF;
 UPDATE delivery_offers SET state=CASE WHEN p_token IS NULL THEN 'CANCELLED' ELSE 'RELEASED' END,responded_at=clock_timestamp(),note=left(trim(p_note),2000) WHERE id=f.id;
 PERFORM set_config('pideya.dispatch','yes',true);
 UPDATE orders SET delivery_driver_id=NULL,delivery_driver_name=NULL,delivery_driver_phone=NULL WHERE id=o.id AND delivery_driver_id=f.driver_id;
 INSERT INTO operation_audit(order_id,actor,action,details) VALUES(o.id,auth.uid(),'RESERVATION_RELEASED',jsonb_build_object('offer_id',f.id,'driver_id',f.driver_id,'note',p_note));
END;$$;

CREATE OR REPLACE FUNCTION public.driver_take_order(p_access_token text,p_order_id uuid) RETURNS orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d driver_profiles;o orders;c delivery_cycles;f delivery_offers;
BEGIN
 d:=driver_responsibility(p_access_token);
 PERFORM dispatch_lock_business(d.restaurant_id);
 SELECT * INTO o FROM orders WHERE id=p_order_id FOR UPDATE;
 SELECT * INTO c FROM delivery_cycles WHERE order_id=o.id AND driver_id=d.id AND closed_at IS NULL FOR UPDATE;
 IF o.delivery_driver_id IS DISTINCT FROM d.id OR o.restaurant_id<>d.restaurant_id OR c.id IS NULL THEN RAISE EXCEPTION 'El negocio debe confirmar la entrega física del paquete'; END IF;
 IF o.status='ON_THE_WAY' AND c.state='OUT' THEN RETURN o; END IF;
 SELECT * INTO f FROM delivery_offers WHERE order_id=o.id AND driver_id=d.id AND state='HANDOVER' FOR UPDATE;
 IF f.id IS NULL OR c.state<>'OUT' OR o.status<>'READY' THEN RAISE EXCEPTION 'Recogida no autorizada'; END IF;
 UPDATE orders SET status='ON_THE_WAY',delivery_started_at=clock_timestamp() WHERE id=o.id RETURNING * INTO o;
 UPDATE delivery_offers SET state='PICKED',picked_at=clock_timestamp() WHERE id=f.id;
 INSERT INTO operation_audit(order_id,actor,action,details) VALUES(o.id,NULL,'PICKUP_CONFIRMED',jsonb_build_object('driver_id',d.id));
 RETURN o;
END;$$;

CREATE FUNCTION public.driver_delivery_offers(p_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d driver_profiles;
BEGIN
 d:=driver_responsibility(p_token);
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'order_id',o.id,'order_number',o.order_number,'state',CASE WHEN f.state='OFFERED' AND f.expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE f.state END,'expires_at',f.expires_at,'client_location_note',o.client_location_note,'client_lat',o.client_lat,'client_lng',o.client_lng,'expected_cash',CASE WHEN o.payment_method='card' THEN 0 ELSE coalesce(o.adjusted_total,o.total) END,'order_status',o.status) ORDER BY f.offered_at)
 FROM delivery_offers f JOIN orders o ON o.id=f.order_id WHERE f.driver_id=d.id AND o.delivery_driver_id=d.id AND o.status IN('ACCEPTED','PREPARING','PICKING','ADJUSTED','READY') AND f.state IN('OFFERED','ACCEPTED','HANDOVER') AND (d.is_active OR EXISTS(SELECT 1 FROM delivery_cycles c WHERE c.order_id=o.id AND c.driver_id=d.id AND c.closed_at IS NULL))),'[]');
END;$$;

CREATE FUNCTION public.dispatch_cleanup_order() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.delivery_driver_id IS DISTINCT FROM OLD.delivery_driver_id OR NEW.status IN('CANCELLED','REJECTED','DELIVERED') THEN
  UPDATE delivery_offers SET state=CASE WHEN NEW.status IN('CANCELLED','REJECTED','DELIVERED') THEN 'CLOSED' ELSE 'CANCELLED' END,responded_at=clock_timestamp(),note=coalesce(note,'Pedido o asignación actualizados') WHERE order_id=NEW.id AND state IN('OFFERED','ACCEPTED','HANDOVER','PICKED') AND (NEW.status IN('CANCELLED','REJECTED','DELIVERED') OR driver_id IS DISTINCT FROM NEW.delivery_driver_id);
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER dispatch_order_cleanup AFTER UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION dispatch_cleanup_order();

CREATE FUNCTION public.expire_delivery_offers() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f delivery_offers;n integer:=0;
BEGIN
 FOR f IN SELECT candidate.* FROM delivery_offers candidate JOIN driver_profiles d ON d.id=candidate.driver_id
 WHERE (candidate.state='OFFERED' AND candidate.expires_at<=clock_timestamp()) OR (candidate.state IN('OFFERED','ACCEPTED') AND NOT d.is_active)
 ORDER BY candidate.restaurant_id,candidate.order_id LIMIT 500 LOOP
  PERFORM dispatch_lock_business(f.restaurant_id);
  PERFORM 1 FROM orders WHERE id=f.order_id FOR UPDATE;
  UPDATE delivery_offers x SET state=CASE WHEN EXISTS(SELECT 1 FROM driver_profiles d WHERE d.id=x.driver_id AND NOT d.is_active) THEN 'CANCELLED' ELSE 'EXPIRED' END,
   responded_at=clock_timestamp(),note=CASE WHEN EXISTS(SELECT 1 FROM driver_profiles d WHERE d.id=x.driver_id AND NOT d.is_active) THEN 'Acceso del repartidor revocado' ELSE note END
  WHERE x.id=f.id AND ((x.state='OFFERED' AND x.expires_at<=clock_timestamp()) OR (x.state IN('OFFERED','ACCEPTED') AND EXISTS(SELECT 1 FROM driver_profiles d WHERE d.id=x.driver_id AND NOT d.is_active)))
   AND NOT EXISTS(SELECT 1 FROM delivery_cycles c WHERE c.order_id=x.order_id AND c.closed_at IS NULL);
  IF FOUND THEN
   PERFORM set_config('pideya.dispatch','yes',true);
   UPDATE orders SET delivery_driver_id=NULL,delivery_driver_name=NULL,delivery_driver_phone=NULL WHERE id=f.order_id AND delivery_driver_id=f.driver_id;
   n:=n+1;
  END IF;
 END LOOP;RETURN n;
END;$$;

CREATE OR REPLACE FUNCTION public.driver_set_shift(p_token text,p_until timestamptz DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i uuid;d driver_profiles;s courier_shifts;
BEGIN
 SELECT * INTO d FROM driver_profiles WHERE access_token=trim(p_token);
 IF d.id IS NULL THEN RAISE EXCEPTION 'Código inválido'; END IF;
 PERFORM dispatch_lock_business(d.restaurant_id);
 i:=driver_identity(p_token);SELECT * INTO d FROM driver_profiles WHERE access_token=trim(p_token) FOR UPDATE;
 IF NOT d.is_active THEN RAISE EXCEPTION 'Código desactivado'; END IF;
 PERFORM set_config('pideya.dispatch','yes',true);
 SELECT * INTO s FROM courier_shifts WHERE identity_id=i AND closed_at IS NULL FOR UPDATE;
 IF s.id IS NOT NULL AND s.available_until<=now() AND NOT EXISTS(SELECT 1 FROM delivery_cycles WHERE identity_id=i AND closed_at IS NULL) THEN
  UPDATE orders SET delivery_driver_id=NULL,delivery_driver_name=NULL,delivery_driver_phone=NULL WHERE delivery_driver_id=s.driver_id AND status IN('ACCEPTED','PREPARING','PICKING','ADJUSTED','READY') AND NOT EXISTS(SELECT 1 FROM delivery_cycles c WHERE c.order_id=orders.id AND c.closed_at IS NULL);
  UPDATE courier_shifts SET closed_at=now(),accepting=false WHERE id=s.id;
  s:=NULL;
 END IF;
 IF s.id IS NOT NULL AND s.driver_id<>d.id THEN RAISE EXCEPTION 'Termina y liquida el turno del otro negocio primero'; END IF;
 IF p_until IS NULL THEN
  UPDATE courier_shifts SET accepting=false WHERE id=s.id;
  -- Release reservations without custody; never detach an order already on the road.
  UPDATE orders SET delivery_driver_id=NULL,delivery_driver_name=NULL,delivery_driver_phone=NULL WHERE delivery_driver_id=d.id AND status IN('ACCEPTED','PREPARING','PICKING','ADJUSTED','READY') AND NOT EXISTS(SELECT 1 FROM delivery_cycles c WHERE c.order_id=orders.id AND c.closed_at IS NULL);
  IF NOT EXISTS(SELECT 1 FROM delivery_cycles WHERE identity_id=i AND closed_at IS NULL) THEN UPDATE courier_shifts SET closed_at=now() WHERE id=s.id; END IF;
 ELSE
  IF p_until<now()+interval '5 minutes' OR p_until>now()+interval '12 hours' THEN RAISE EXCEPTION 'Selecciona un turno entre 5 minutos y 12 horas'; END IF;
  IF s.id IS NULL THEN INSERT INTO courier_shifts(identity_id,driver_id,restaurant_id,available_until) VALUES(i,d.id,d.restaurant_id,p_until);
  ELSE UPDATE courier_shifts SET available_until=p_until,accepting=true WHERE id=s.id; END IF;
 END IF;
END;$$;

CREATE OR REPLACE FUNCTION public.driver_complete_cash(p_token text,p_order_id uuid,p_cash numeric,p_photo text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i uuid;c delivery_cycles;d driver_profiles;
BEGIN
 d:=driver_responsibility(p_token);PERFORM dispatch_lock_business(d.restaurant_id);
 SELECT identity_id INTO i FROM delivery_cycles WHERE order_id=p_order_id AND driver_id=d.id AND closed_at IS NULL;
 IF i IS NULL THEN SELECT identity_id INTO i FROM delivery_cycles WHERE order_id=p_order_id AND driver_id=d.id AND state='CLOSED'; END IF;SELECT * INTO c FROM delivery_cycles WHERE order_id=p_order_id AND identity_id=i FOR UPDATE;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Entrega no autorizada'; END IF;
 IF c.state IN('RETURNING','CLOSED') AND c.cash_collected=p_cash THEN RETURN; END IF;
 IF c.state<>'OUT' THEN RAISE EXCEPTION 'Este pedido no está en una entrega activa'; END IF;
 IF p_cash IS NULL OR p_cash<0 OR p_cash::text IN('NaN','Infinity','-Infinity') OR p_cash<>c.expected_cash THEN RAISE EXCEPTION 'El cobro no coincide. Reporta una incidencia antes de cerrar'; END IF;
 UPDATE delivery_cycles SET state='RETURNING',cash_collected=p_cash WHERE id=c.id;
 UPDATE orders SET status='DELIVERED',delivered_at=now(),delivery_photo_url=p_photo WHERE id=p_order_id AND status='ON_THE_WAY';
 IF NOT FOUND THEN RAISE EXCEPTION 'El pedido ya no está en camino'; END IF;
END;$$;

CREATE OR REPLACE FUNCTION public.driver_return_order(p_token text,p_order_id uuid,p_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i uuid;c delivery_cycles;d driver_profiles;
BEGIN
 d:=driver_responsibility(p_token);PERFORM dispatch_lock_business(d.restaurant_id);
 SELECT identity_id INTO i FROM delivery_cycles WHERE order_id=p_order_id AND driver_id=d.id AND closed_at IS NULL;
 IF i IS NULL THEN SELECT identity_id INTO i FROM delivery_cycles WHERE order_id=p_order_id AND driver_id=d.id AND state='CLOSED'; END IF;SELECT * INTO c FROM delivery_cycles WHERE order_id=p_order_id AND identity_id=i FOR UPDATE;
 IF c.id IS NULL OR c.closed_at IS NOT NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF c.state NOT IN('OUT','RETURNED') THEN RAISE EXCEPTION 'Una entrega cobrada debe liquidarse, no devolverse'; END IF;
 IF p_note IS NULL OR length(trim(p_note))<5 THEN RAISE EXCEPTION 'Indica el motivo del regreso'; END IF;
 UPDATE delivery_cycles SET state='RETURNED',returned_at=now(),return_note=p_note WHERE id=c.id;
 PERFORM report_order_incident(p_order_id,'RETURN',p_note,p_token);
END;$$;

CREATE OR REPLACE FUNCTION public.merchant_settle_cycle(p_id uuid,p_cash numeric,p_note text,p_returned_goods boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c delivery_cycles;
BEGIN
 SELECT * INTO c FROM delivery_cycles WHERE id=p_id;
 IF NOT can_manage_business(c.restaurant_id) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 PERFORM dispatch_lock_business(c.restaurant_id);
 SELECT * INTO c FROM delivery_cycles WHERE id=p_id FOR UPDATE;
 IF NOT can_manage_business(c.restaurant_id) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF c.closed_at IS NOT NULL THEN RETURN; END IF;
 IF c.state='OUT' THEN RAISE EXCEPTION 'Primero confirma el retorno'; END IF;
 IF p_cash IS NULL OR p_cash<0 OR p_cash::text IN('NaN','Infinity','-Infinity') OR length(trim(p_note))<5 THEN RAISE EXCEPTION 'Indica importe recibido y comprobación'; END IF;
 IF c.cash_collected IS NULL AND NOT p_returned_goods THEN RAISE EXCEPTION 'Confirma recepción de mercancía no entregada'; END IF;
 UPDATE delivery_cycles SET cash_received=p_cash,settlement_note=p_note WHERE id=c.id;
 IF p_cash<>coalesce(c.cash_collected,0) THEN
  PERFORM report_order_incident(c.order_id,'CASH','Diferencia de efectivo: '||p_note);RETURN;
 END IF;
 UPDATE delivery_cycles SET state='CLOSED',closed_at=now(),closed_by=auth.uid() WHERE id=c.id;
 IF c.cash_collected IS NULL THEN UPDATE orders SET status='CANCELLED',cancelled_by='merchant',cancelled_at=now(),rejection_reason='Mercancía devuelta: '||p_note WHERE id=c.order_id; END IF;
 UPDATE courier_shifts SET closed_at=now(),accepting=false WHERE identity_id=c.identity_id AND closed_at IS NULL AND (NOT accepting OR available_until<=now() OR EXISTS(SELECT 1 FROM driver_profiles d WHERE d.id=c.driver_id AND NOT d.is_active));
 INSERT INTO operation_audit(order_id,actor,action,details) VALUES(c.order_id,auth.uid(),'CASH_SETTLED',jsonb_build_object('received',p_cash,'note',p_note,'returned_goods',p_returned_goods));
END;$$;

CREATE OR REPLACE FUNCTION public.expire_courier_shifts() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s courier_shifts;n integer:=0;
BEGIN
 FOR s IN SELECT * FROM courier_shifts WHERE closed_at IS NULL AND (available_until<=clock_timestamp() OR EXISTS(SELECT 1 FROM driver_profiles d WHERE d.id=courier_shifts.driver_id AND NOT d.is_active)) ORDER BY restaurant_id,id LIMIT 500 LOOP
  PERFORM dispatch_lock_business(s.restaurant_id);
  PERFORM 1 FROM courier_identities WHERE id=s.identity_id FOR UPDATE;
  PERFORM 1 FROM driver_profiles WHERE id=s.driver_id FOR UPDATE;
  SELECT * INTO s FROM courier_shifts WHERE id=s.id FOR UPDATE;
  IF s.closed_at IS NOT NULL OR (s.available_until>clock_timestamp() AND EXISTS(SELECT 1 FROM driver_profiles d WHERE d.id=s.driver_id AND d.is_active)) THEN CONTINUE; END IF;
  PERFORM set_config('pideya.dispatch','yes',true);
  UPDATE courier_shifts SET accepting=false WHERE id=s.id;
  UPDATE orders SET delivery_driver_id=NULL,delivery_driver_name=NULL,delivery_driver_phone=NULL WHERE delivery_driver_id=s.driver_id AND status IN('ACCEPTED','PREPARING','PICKING','ADJUSTED','READY') AND NOT EXISTS(SELECT 1 FROM delivery_cycles c WHERE c.order_id=orders.id AND c.closed_at IS NULL);
  IF NOT EXISTS(SELECT 1 FROM delivery_cycles WHERE identity_id=s.identity_id AND closed_at IS NULL) THEN UPDATE courier_shifts SET closed_at=clock_timestamp() WHERE id=s.id; END IF;
  n:=n+1;
 END LOOP;RETURN n;
END;$$;
CREATE OR REPLACE FUNCTION public.driver_operations(p_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d driver_profiles;
BEGIN
 d:=driver_responsibility(p_token);
 RETURN jsonb_build_object('shift',(SELECT to_jsonb(s) FROM courier_shifts s WHERE driver_id=d.id AND closed_at IS NULL),'cycle',(SELECT to_jsonb(c) FROM delivery_cycles c WHERE driver_id=d.id AND closed_at IS NULL));
END;$$;
CREATE OR REPLACE FUNCTION public.driver_orders_secure(p_token text,p_order_id uuid DEFAULT NULL,p_history boolean DEFAULT false) RETURNS SETOF orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d driver_profiles;
BEGIN
 d:=driver_responsibility(p_token);
 RETURN QUERY SELECT o.* FROM orders o WHERE o.delivery_driver_id=d.id AND o.restaurant_id=d.restaurant_id AND (p_order_id IS NULL OR o.id=p_order_id)
 AND (o.status IN('ON_THE_WAY','DELIVERED') OR EXISTS(SELECT 1 FROM delivery_offers f WHERE f.order_id=o.id AND f.driver_id=d.id AND f.state IN('ACCEPTED','HANDOVER')))
 AND (d.is_active OR EXISTS(SELECT 1 FROM delivery_cycles c WHERE c.order_id=o.id AND c.driver_id=d.id AND c.closed_at IS NULL))
 AND (p_order_id IS NOT NULL OR CASE WHEN p_history THEN o.status='DELIVERED' ELSE o.status IN('ACCEPTED','PREPARING','PICKING','ADJUSTED','READY','ON_THE_WAY') END) ORDER BY o.created_at DESC LIMIT 100;
END;$$;
CREATE FUNCTION public.merchant_record_return(p_cycle_id uuid,p_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c delivery_cycles;
BEGIN
 SELECT * INTO c FROM delivery_cycles WHERE id=p_cycle_id;
 IF c.id IS NULL OR NOT can_manage_business(c.restaurant_id) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 PERFORM dispatch_lock_business(c.restaurant_id);
 SELECT * INTO c FROM delivery_cycles WHERE id=c.id FOR UPDATE;
 IF c.closed_at IS NOT NULL OR c.cash_collected IS NOT NULL OR c.state NOT IN('OUT','RETURNED') THEN RAISE EXCEPTION 'No corresponde a devolución de mercancía'; END IF;
 IF length(trim(coalesce(p_note,'')))<5 THEN RAISE EXCEPTION 'Indica la comprobación de devolución'; END IF;
 UPDATE delivery_cycles SET state='RETURNED',returned_at=coalesce(returned_at,clock_timestamp()),return_note=left(trim(p_note),2000) WHERE id=c.id;
 INSERT INTO operation_audit(order_id,actor,action,details) VALUES(c.order_id,auth.uid(),'SUPERVISED_RETURN_RECORDED',jsonb_build_object('cycle_id',c.id,'note',p_note));
END;$$;

CREATE OR REPLACE FUNCTION public.emit_order_notifications()
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
     PERFORM enqueue_order_notice(NEW.id,NEW.notification_revision,'driver',NULL,NEW.delivery_driver_id,CASE WHEN EXISTS(SELECT 1 FROM delivery_offers f WHERE f.order_id=NEW.id AND f.driver_id=NEW.delivery_driver_id AND f.state='OFFERED') THEN 'driver.offered' ELSE 'driver.assigned' END,'Nueva oferta de reparto','Abre PideYa Repartidor para aceptar o rechazar la oferta.',0::smallint);
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


CREATE FUNCTION public.merchant_cancel_uncollected_delivery(p_order_id uuid,p_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o orders;
BEGIN
 SELECT * INTO o FROM orders WHERE id=p_order_id;
 IF o.id IS NULL OR NOT can_manage_business(o.restaurant_id) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 PERFORM dispatch_lock_business(o.restaurant_id);
 SELECT * INTO o FROM orders WHERE id=p_order_id FOR UPDATE;
 IF o.status='CANCELLED' THEN RETURN; END IF;
 IF o.status NOT IN('ACCEPTED','PREPARING','PICKING','ADJUSTED','READY') OR o.delivery_type='pickup' OR coalesce(o.payment_method,'cash')<>'cash' THEN RAISE EXCEPTION 'La cancelación requiere revisión de pago o entrega'; END IF;
 IF EXISTS(SELECT 1 FROM delivery_cycles WHERE order_id=o.id) THEN RAISE EXCEPTION 'Entrega con custodia: resuelve el retorno antes de cancelar'; END IF;
 IF length(trim(coalesce(p_note,'')))<5 THEN RAISE EXCEPTION 'Indica el motivo para el cliente'; END IF;
 PERFORM set_config('pideya.dispatch','yes',true);
 UPDATE orders SET status='CANCELLED',cancelled_by='merchant',cancelled_at=clock_timestamp(),rejection_reason=left(trim(p_note),2000),delivery_driver_id=NULL,delivery_driver_name=NULL,delivery_driver_phone=NULL WHERE id=o.id;
 INSERT INTO operation_audit(order_id,actor,action,details) VALUES(o.id,auth.uid(),'UNAVAILABLE_DELIVERY_CANCELLED',jsonb_build_object('reason',p_note));
END;$$;
REVOKE ALL ON FUNCTION merchant_cancel_uncollected_delivery(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION merchant_cancel_uncollected_delivery(uuid,text) TO authenticated;
CREATE FUNCTION public.dispatch_publish_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE orders SET delivery_assignment_state=CASE WHEN NEW.state IN('OFFERED','ACCEPTED','HANDOVER','PICKED') THEN NEW.state ELSE NULL END WHERE id=NEW.order_id;
 RETURN NEW;
END;$$;
CREATE TRIGGER dispatch_publish AFTER INSERT OR UPDATE ON delivery_offers FOR EACH ROW EXECUTE FUNCTION dispatch_publish_state();
REVOKE ALL ON FUNCTION dispatch_publish_state() FROM PUBLIC,anon,authenticated,service_role;
UPDATE orders o SET delivery_assignment_state='ACCEPTED' WHERE EXISTS(SELECT 1 FROM delivery_offers f WHERE f.order_id=o.id AND f.state='ACCEPTED');
CREATE FUNCTION public.dispatch_offer_state_notice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.state IS DISTINCT FROM OLD.state AND NEW.state<>'OFFERED' THEN
  UPDATE notification_events SET expires_at=least(expires_at,clock_timestamp()) WHERE order_id=NEW.order_id AND driver_id=NEW.driver_id AND kind='driver.offered';
  IF NEW.state IN('DECLINED','EXPIRED','RELEASED','CANCELLED') THEN
   PERFORM enqueue_order_notice(NEW.order_id,(SELECT notification_revision FROM orders WHERE id=NEW.order_id),'restaurant',(SELECT owner_id FROM restaurants WHERE id=NEW.restaurant_id),NULL,'dispatch.'||lower(NEW.state)||'.'||NEW.id::text,'Revisar asignación de reparto','La oferta o reserva cambió. Abre el pedido para elegir otro repartidor.',0::smallint);
  END IF;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER dispatch_offer_notice AFTER UPDATE ON delivery_offers FOR EACH ROW EXECUTE FUNCTION dispatch_offer_state_notice();
REVOKE ALL ON FUNCTION dispatch_offer_state_notice() FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX dispatch_queue_orders ON orders(delivery_driver_id,status) WHERE status IN('ACCEPTED','PREPARING','PICKING','ADJUSTED','READY');
CREATE FUNCTION public.merchant_dispatch_capacity(p_restaurant uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT can_manage_business(p_restaurant) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'phone',d.phone,'vehicle_label',d.vehicle_label,'is_active',d.is_active,'employment_type',d.employment_type,
 'shift',(SELECT jsonb_build_object('accepting',s.accepting,'available_until',s.available_until) FROM courier_shifts s WHERE s.driver_id=d.id AND s.closed_at IS NULL),
 'cycle',(SELECT jsonb_build_object('state',c.state) FROM delivery_cycles c WHERE c.driver_id=d.id AND c.closed_at IS NULL),
 'queued_count',(SELECT count(*) FROM orders o WHERE o.delivery_driver_id=d.id AND o.status IN('ACCEPTED','PREPARING','PICKING','ADJUSTED','READY'))
 ) ORDER BY d.name) FROM driver_profiles d WHERE d.restaurant_id=p_restaurant AND d.is_active),'[]');
END;$$;
REVOKE ALL ON FUNCTION merchant_dispatch_capacity(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION merchant_dispatch_capacity(uuid) TO authenticated;
-- Hosted projects historically expanded this RPC outside migration 015. Preserve both
-- known response contracts; CREATE OR REPLACE must not drop/recreate a public API.
DO $session_contract$
BEGIN
 IF pg_get_function_result('public.driver_get_session(text)'::regprocedure) LIKE '%user_id uuid%' THEN
  EXECUTE $expanded_session$CREATE OR REPLACE FUNCTION public.driver_get_session(p_access_token text)
RETURNS TABLE(driver_id uuid,restaurant_id uuid,user_id uuid,restaurant_name text,restaurant_phone text,restaurant_address text,restaurant_lat double precision,restaurant_lng double precision,restaurant_logo text,driver_name text,driver_phone text,vehicle_label text,push_token text,is_active boolean,last_location_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT d.id,d.restaurant_id,(to_jsonb(d)->>'user_id')::uuid,r.name,r.phone,r.address,r.lat,r.lng,r.logo_url,d.name,d.phone,d.vehicle_label,to_jsonb(d)->>'push_token',d.is_active,d.last_location_at
 FROM driver_profiles d JOIN restaurants r ON r.id=d.restaurant_id
 WHERE d.access_token=trim(p_access_token) AND length(coalesce(p_access_token,''))>=16
 AND (d.is_active OR EXISTS(SELECT 1 FROM delivery_cycles c WHERE c.driver_id=d.id AND c.closed_at IS NULL));
$$;
$expanded_session$;
 ELSE
  EXECUTE $legacy_session$CREATE OR REPLACE FUNCTION public.driver_get_session(p_access_token text)
RETURNS TABLE(driver_id uuid,restaurant_id uuid,restaurant_name text,driver_name text,driver_phone text,vehicle_label text,is_active boolean,last_location_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT d.id,d.restaurant_id,r.name,d.name,d.phone,d.vehicle_label,d.is_active,d.last_location_at
 FROM driver_profiles d JOIN restaurants r ON r.id=d.restaurant_id
 WHERE d.access_token=trim(p_access_token) AND length(coalesce(p_access_token,''))>=16
 AND (d.is_active OR EXISTS(SELECT 1 FROM delivery_cycles c WHERE c.driver_id=d.id AND c.closed_at IS NULL));
$$;
$legacy_session$;
 END IF;
END;
$session_contract$;
REVOKE ALL ON FUNCTION driver_get_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION driver_get_session(text) TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.driver_get_assigned_orders(
  p_access_token TEXT
)
RETURNS TABLE (
  id UUID,
  order_number INTEGER,
  restaurant_id UUID,
  client_name TEXT,
  client_phone TEXT,
  client_location_note TEXT,
  client_lat DOUBLE PRECISION,
  client_lng DOUBLE PRECISION,
  items JSONB,
  subtotal NUMERIC,
  commission_amount NUMERIC,
  delivery_amount NUMERIC,
  total NUMERIC,
  status public.order_status,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ,
  delivery_driver_id UUID,
  delivery_driver_name TEXT,
  delivery_driver_phone TEXT,
  delivery_assigned_at TIMESTAMPTZ,
  delivery_started_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  driver_last_lat DOUBLE PRECISION,
  driver_last_lng DOUBLE PRECISION,
  driver_location_accuracy_m DOUBLE PRECISION,
  driver_location_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id,
         o.order_number,
         o.restaurant_id,
         o.client_name,
         o.client_phone,
         o.client_location_note,
         o.client_lat,
         o.client_lng,
         o.items,
         o.subtotal,
         o.commission_amount,
         o.delivery_amount,
         o.total,
         o.status,
         o.rejection_reason,
         o.created_at,
         o.delivery_driver_id,
         o.delivery_driver_name,
         o.delivery_driver_phone,
         o.delivery_assigned_at,
         o.delivery_started_at,
         o.delivered_at,
         o.driver_last_lat,
         o.driver_last_lng,
         o.driver_location_accuracy_m,
         o.driver_location_updated_at
  FROM public.driver_orders_secure(p_access_token,NULL,false) o;
END;
$$;
REVOKE ALL ON FUNCTION driver_get_assigned_orders(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION driver_get_assigned_orders(text) TO anon,authenticated;
REVOKE ALL ON FUNCTION dispatch_lock_business(uuid),dispatch_validate(uuid,uuid),driver_responsibility(text),dispatch_cleanup_order() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION merchant_offer_delivery(uuid,uuid,uuid,integer,text),merchant_confirm_handover(uuid),merchant_record_return(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION merchant_offer_delivery(uuid,uuid,uuid,integer,text),merchant_confirm_handover(uuid),merchant_record_return(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION driver_reply_delivery(text,uuid,boolean,text),driver_delivery_offers(text),release_delivery_reservation(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION driver_reply_delivery(text,uuid,boolean,text),driver_delivery_offers(text),release_delivery_reservation(uuid,uuid,text,text) TO anon,authenticated;
REVOKE ALL ON FUNCTION expire_delivery_offers() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION expire_delivery_offers() TO service_role;
SELECT cron.schedule('expire-delivery-offers','* * * * *','SELECT public.expire_delivery_offers()');
NOTIFY pgrst,'reload schema';
COMMIT;
