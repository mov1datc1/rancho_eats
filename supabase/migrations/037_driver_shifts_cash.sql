BEGIN;
ALTER TABLE orders ADD COLUMN estimated_cycle_minutes integer NOT NULL DEFAULT 45 CHECK(estimated_cycle_minutes BETWEEN 10 AND 480);
ALTER TABLE driver_profiles ADD COLUMN employment_type text NOT NULL DEFAULT 'OWN' CHECK(employment_type IN('OWN','TEMPORARY'));
CREATE TABLE courier_identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),phone text NOT NULL UNIQUE);
CREATE TABLE courier_shifts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),identity_id uuid NOT NULL REFERENCES courier_identities,driver_id uuid NOT NULL REFERENCES driver_profiles,restaurant_id uuid NOT NULL REFERENCES restaurants,available_until timestamptz NOT NULL,accepting boolean NOT NULL DEFAULT true,started_at timestamptz NOT NULL DEFAULT now(),closed_at timestamptz);
CREATE UNIQUE INDEX courier_one_shift ON courier_shifts(identity_id) WHERE closed_at IS NULL;
CREATE TABLE delivery_cycles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL UNIQUE REFERENCES orders,identity_id uuid NOT NULL REFERENCES courier_identities,driver_id uuid NOT NULL REFERENCES driver_profiles,restaurant_id uuid NOT NULL REFERENCES restaurants,state text NOT NULL DEFAULT 'OUT' CHECK(state IN('OUT','RETURNING','RETURNED','CLOSED')),expected_cash numeric NOT NULL CHECK(expected_cash>=0),cash_collected numeric CHECK(cash_collected>=0),cash_received numeric CHECK(cash_received>=0),started_at timestamptz NOT NULL DEFAULT now(),returned_at timestamptz,closed_at timestamptz,closed_by uuid REFERENCES auth.users,return_note text,settlement_note text);
CREATE UNIQUE INDEX courier_one_custody ON delivery_cycles(identity_id) WHERE closed_at IS NULL;
ALTER TABLE courier_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE courier_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY shift_business ON courier_shifts FOR SELECT TO authenticated USING(can_manage_business(restaurant_id));
CREATE POLICY cycle_business ON delivery_cycles FOR SELECT TO authenticated USING(can_manage_business(restaurant_id));
CREATE OR REPLACE FUNCTION public.driver_identity(p_token text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d driver_profiles;i uuid;phone_key text;
BEGIN
 SELECT * INTO d FROM driver_profiles WHERE access_token=trim(p_token) AND is_active;
 IF d.id IS NULL OR length(coalesce(p_token,''))<16 THEN RAISE EXCEPTION 'Código inválido o desactivado'; END IF;
 phone_key:=regexp_replace(d.phone,'[^0-9]','','g');
 IF length(phone_key)<10 THEN RAISE EXCEPTION 'El negocio debe registrar un teléfono válido del repartidor'; END IF;
 phone_key:=right(phone_key,10);
 INSERT INTO courier_identities(phone) VALUES(phone_key) ON CONFLICT(phone) DO NOTHING;
 SELECT id INTO i FROM courier_identities WHERE phone=phone_key FOR UPDATE;
 RETURN i;
END;$$;
CREATE OR REPLACE FUNCTION public.driver_set_shift(p_token text,p_until timestamptz DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i uuid;d driver_profiles;s courier_shifts;
BEGIN
 i:=driver_identity(p_token);SELECT * INTO d FROM driver_profiles WHERE access_token=trim(p_token);
 SELECT * INTO s FROM courier_shifts WHERE identity_id=i AND closed_at IS NULL FOR UPDATE;
 IF s.id IS NOT NULL AND s.available_until<=now() AND NOT EXISTS(SELECT 1 FROM delivery_cycles WHERE identity_id=i AND closed_at IS NULL) THEN
  UPDATE orders SET delivery_driver_id=NULL,delivery_driver_name=NULL,delivery_driver_phone=NULL WHERE delivery_driver_id=s.driver_id AND status IN('ACCEPTED','PREPARING','PICKING','ADJUSTED','READY');
  UPDATE courier_shifts SET closed_at=now(),accepting=false WHERE id=s.id;
  s:=NULL;
 END IF;
 IF s.id IS NOT NULL AND s.driver_id<>d.id THEN RAISE EXCEPTION 'Termina y liquida el turno del otro negocio primero'; END IF;
 IF p_until IS NULL THEN
  UPDATE courier_shifts SET accepting=false WHERE id=s.id;
  -- Release reservations without custody; never detach an order already on the road.
  UPDATE orders SET delivery_driver_id=NULL,delivery_driver_name=NULL,delivery_driver_phone=NULL WHERE delivery_driver_id=d.id AND status IN('ACCEPTED','PREPARING','PICKING','ADJUSTED','READY');
  IF NOT EXISTS(SELECT 1 FROM delivery_cycles WHERE identity_id=i AND closed_at IS NULL) THEN UPDATE courier_shifts SET closed_at=now() WHERE id=s.id; END IF;
 ELSE
  IF p_until<now()+interval '5 minutes' OR p_until>now()+interval '12 hours' THEN RAISE EXCEPTION 'Selecciona un turno entre 5 minutos y 12 horas'; END IF;
  IF s.id IS NULL THEN INSERT INTO courier_shifts(identity_id,driver_id,restaurant_id,available_until) VALUES(i,d.id,d.restaurant_id,p_until);
  ELSE UPDATE courier_shifts SET available_until=p_until,accepting=true WHERE id=s.id; END IF;
 END IF;
END;$$;
CREATE OR REPLACE FUNCTION public.driver_operations(p_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i uuid;d uuid;result jsonb;
BEGIN
 i:=driver_identity(p_token);SELECT id INTO d FROM driver_profiles WHERE access_token=trim(p_token);
 SELECT jsonb_build_object('shift',(SELECT to_jsonb(s) FROM courier_shifts s WHERE s.identity_id=i AND s.closed_at IS NULL), 'cycle',(SELECT to_jsonb(c) FROM delivery_cycles c WHERE c.identity_id=i AND c.closed_at IS NULL)) INTO result;
 RETURN result;
END;$$;
CREATE OR REPLACE FUNCTION public.driver_take_order(p_access_token text,p_order_id uuid) RETURNS orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i uuid;d driver_profiles;o orders;s courier_shifts;
BEGIN
 i:=driver_identity(p_access_token);SELECT * INTO d FROM driver_profiles WHERE access_token=trim(p_access_token);
 SELECT * INTO s FROM courier_shifts WHERE identity_id=i AND closed_at IS NULL FOR UPDATE;
 IF s.id IS NULL OR s.driver_id<>d.id OR NOT s.accepting OR s.available_until<=now() THEN RAISE EXCEPTION 'Activa o extiende tu turno'; END IF;
 SELECT * INTO o FROM orders WHERE id=p_order_id FOR UPDATE;
 IF o.delivery_driver_id IS DISTINCT FROM d.id OR o.restaurant_id<>d.restaurant_id THEN RAISE EXCEPTION 'Pedido no asignado'; END IF;
 IF EXISTS(SELECT 1 FROM delivery_cycles WHERE order_id=o.id AND state='OUT') THEN RETURN o; END IF;
 IF o.status NOT IN('ACCEPTED','READY') THEN RAISE EXCEPTION 'Pedido no listo para salir'; END IF;
 IF EXISTS(SELECT 1 FROM delivery_cycles WHERE identity_id=i AND closed_at IS NULL) THEN RAISE EXCEPTION 'Regresa y liquida tu entrega anterior'; END IF;
 INSERT INTO delivery_cycles(order_id,identity_id,driver_id,restaurant_id,expected_cash) VALUES(o.id,i,d.id,d.restaurant_id,CASE WHEN coalesce(o.payment_method,'cash')='cash' THEN coalesce(o.adjusted_total,o.total) ELSE 0 END);
 UPDATE orders SET status='ON_THE_WAY',delivery_started_at=now() WHERE id=o.id RETURNING * INTO o;RETURN o;
END;$$;
CREATE OR REPLACE FUNCTION public.driver_complete_cash(p_token text,p_order_id uuid,p_cash numeric,p_photo text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i uuid;c delivery_cycles;
BEGIN
 i:=driver_identity(p_token);SELECT * INTO c FROM delivery_cycles WHERE order_id=p_order_id AND identity_id=i FOR UPDATE;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Entrega no autorizada'; END IF;
 IF c.state IN('RETURNING','CLOSED') AND c.cash_collected=p_cash THEN RETURN; END IF;
 IF c.state<>'OUT' THEN RAISE EXCEPTION 'Este pedido no está en una entrega activa'; END IF;
 IF p_cash IS NULL OR p_cash<0 OR p_cash::text IN('NaN','Infinity','-Infinity') OR p_cash<>c.expected_cash THEN RAISE EXCEPTION 'El cobro no coincide. Reporta una incidencia antes de cerrar'; END IF;
 UPDATE delivery_cycles SET state='RETURNING',cash_collected=p_cash WHERE id=c.id;
 UPDATE orders SET status='DELIVERED',delivered_at=now(),delivery_photo_url=p_photo WHERE id=p_order_id AND status='ON_THE_WAY';
 IF NOT FOUND THEN RAISE EXCEPTION 'El pedido ya no está en camino'; END IF;
END;$$;
CREATE OR REPLACE FUNCTION public.driver_return_order(p_token text,p_order_id uuid,p_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i uuid;c delivery_cycles;
BEGIN
 i:=driver_identity(p_token);SELECT * INTO c FROM delivery_cycles WHERE order_id=p_order_id AND identity_id=i FOR UPDATE;
 IF c.id IS NULL OR c.closed_at IS NOT NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF c.state NOT IN('OUT','RETURNED') THEN RAISE EXCEPTION 'Una entrega cobrada debe liquidarse, no devolverse'; END IF;
 IF p_note IS NULL OR length(trim(p_note))<5 THEN RAISE EXCEPTION 'Indica el motivo del regreso'; END IF;
 UPDATE delivery_cycles SET state='RETURNED',returned_at=now(),return_note=p_note WHERE id=c.id;
 PERFORM report_order_incident(p_order_id,'RETURN',p_note,p_token);
END;$$;
CREATE OR REPLACE FUNCTION public.merchant_settle_cycle(p_id uuid,p_cash numeric,p_note text,p_returned_goods boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c delivery_cycles;
BEGIN
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
 UPDATE courier_shifts SET closed_at=now(),accepting=false WHERE identity_id=c.identity_id AND closed_at IS NULL AND (NOT accepting OR available_until<=now());
 INSERT INTO operation_audit(order_id,actor,action,details) VALUES(c.order_id,auth.uid(),'CASH_SETTLED',jsonb_build_object('received',p_cash,'note',p_note,'returned_goods',p_returned_goods));
END;$$;
CREATE OR REPLACE FUNCTION public.assignment_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d driver_profiles;n integer;
BEGIN
 IF NEW.delivery_driver_id IS NOT NULL AND NEW.delivery_driver_id IS DISTINCT FROM OLD.delivery_driver_id THEN
  SELECT * INTO d FROM driver_profiles WHERE id=NEW.delivery_driver_id FOR UPDATE;
  IF NOT d.is_active OR d.restaurant_id<>NEW.restaurant_id THEN RAISE EXCEPTION 'Repartidor de otro negocio o inactivo'; END IF;
  IF NOT EXISTS(SELECT 1 FROM courier_shifts WHERE driver_id=d.id AND closed_at IS NULL AND accepting AND available_until>now()) THEN RAISE EXCEPTION 'Repartidor sin turno disponible'; END IF;
  SELECT count(*) INTO n FROM orders WHERE delivery_driver_id=d.id AND status IN('ACCEPTED','PREPARING','PICKING','ADJUSTED','READY');
  IF n>=2 THEN RAISE EXCEPTION 'La cola del repartidor ya tiene dos pedidos'; END IF;
  IF NOT EXISTS(SELECT 1 FROM courier_shifts s WHERE s.driver_id=d.id AND s.closed_at IS NULL AND s.available_until>=now()+make_interval(mins=>NEW.estimated_cycle_minutes+coalesce((SELECT sum(o.estimated_cycle_minutes)::integer FROM orders o WHERE o.delivery_driver_id=d.id AND o.status IN('ACCEPTED','PREPARING','PICKING','ADJUSTED','READY','ON_THE_WAY')),0))) THEN RAISE EXCEPTION 'El turno no alcanza para la cola, el recorrido y el regreso estimados'; END IF;
 END IF;
 IF OLD.status='ON_THE_WAY' AND NEW.delivery_driver_id IS DISTINCT FROM OLD.delivery_driver_id THEN RAISE EXCEPTION 'Entrega con custodia: resuelve el retorno antes de reasignar'; END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER operations_assignment BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION assignment_guard();
-- Old binaries cannot bypass collection/return accounting.
CREATE OR REPLACE FUNCTION public.driver_complete_order(p_access_token text,p_order_id uuid,p_photo_url text DEFAULT NULL) RETURNS orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'Actualiza PideYa Repartidor para registrar cobro y retorno'; END;$$;
CREATE OR REPLACE FUNCTION public.driver_orders_secure(p_token text,p_order_id uuid DEFAULT NULL,p_history boolean DEFAULT false) RETURNS SETOF orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d driver_profiles;
BEGIN
 SELECT * INTO d FROM driver_profiles WHERE access_token=trim(p_token) AND is_active;
 IF d.id IS NULL OR length(coalesce(p_token,''))<16 THEN RAISE EXCEPTION 'Código inválido'; END IF;
 RETURN QUERY SELECT o.* FROM orders o WHERE o.delivery_driver_id=d.id AND o.restaurant_id=d.restaurant_id AND (p_order_id IS NULL OR o.id=p_order_id) AND (p_order_id IS NOT NULL OR CASE WHEN p_history THEN o.status='DELIVERED' ELSE o.status IN('ACCEPTED','READY','ON_THE_WAY') END) ORDER BY o.created_at DESC LIMIT 100;
END;$$;
REVOKE ALL ON FUNCTION driver_identity(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION driver_set_shift(text,timestamptz),driver_operations(text),driver_take_order(text,uuid),driver_complete_cash(text,uuid,numeric,text),driver_return_order(text,uuid,text),driver_orders_secure(text,uuid,boolean) TO anon,authenticated;
REVOKE ALL ON FUNCTION merchant_settle_cycle(uuid,numeric,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION merchant_settle_cycle(uuid,numeric,text,boolean) TO authenticated;
COMMIT;
