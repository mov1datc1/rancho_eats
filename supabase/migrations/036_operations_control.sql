BEGIN;
CREATE OR REPLACE FUNCTION public.can_manage_business(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) OR EXISTS(SELECT 1 FROM restaurants WHERE id=p_id AND owner_id=auth.uid());
$$;
ALTER TABLE app_categories ADD COLUMN release_mode text NOT NULL DEFAULT 'public' CHECK(release_mode IN('closed','pilot','public'));
CREATE TABLE category_pilots(category_id uuid REFERENCES app_categories ON DELETE CASCADE,restaurant_id uuid REFERENCES restaurants ON DELETE CASCADE,user_id uuid REFERENCES auth.users ON DELETE CASCADE,PRIMARY KEY(category_id,restaurant_id,user_id));
ALTER TABLE category_pilots ENABLE ROW LEVEL SECURITY;
CREATE POLICY pilot_admin ON category_pilots FOR ALL TO authenticated USING(EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid())) WITH CHECK(EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()));
CREATE OR REPLACE FUNCTION public.can_order_business(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM restaurants r JOIN app_categories c ON lower(trim(c.name))=lower(trim(r.type)) WHERE r.id=p_id AND r.status='ACTIVE' AND c.is_active AND (c.release_mode='public' OR (c.release_mode='pilot' AND EXISTS(SELECT 1 FROM category_pilots p WHERE p.category_id=c.id AND p.restaurant_id=r.id AND p.user_id=auth.uid()))));
$$;
CREATE OR REPLACE FUNCTION public.customer_businesses() RETURNS SETOF restaurants LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT r.* FROM restaurants r WHERE can_order_business(r.id) ORDER BY r.name; $$;
ALTER TABLE orders ADD COLUMN response_deadline timestamptz;
ALTER TABLE orders ADD COLUMN accepted_at timestamptz;
ALTER TABLE orders ADD COLUMN promised_from timestamptz;
ALTER TABLE orders ADD COLUMN promised_to timestamptz;
ALTER TABLE orders ADD COLUMN proposal_expires_at timestamptz;
ALTER TABLE orders ADD COLUMN category_snapshot text;
-- Do not expire historical requests at deployment time; the previous cleanup is replaced below.
UPDATE orders SET response_deadline=now()+interval '10 minutes' WHERE status='PENDING';
CREATE TABLE order_incidents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders ON DELETE CASCADE,
 cause text NOT NULL CHECK(cause IN('DELAY','NO_SIGNAL','ADDRESS','ABSENT','ACCESS','BREAKDOWN','REFUSED','CASH','RETURN','OTHER')),
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','IN_PROGRESS','WAITING_RETURN','RESOLVED')),
 description text NOT NULL, resolution text, assigned_to uuid REFERENCES auth.users,
 created_by uuid REFERENCES auth.users,driver_id uuid REFERENCES driver_profiles,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz
);
CREATE UNIQUE INDEX incident_open_unique ON order_incidents(order_id,cause) WHERE status<>'RESOLVED';
CREATE TABLE operation_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,order_id uuid REFERENCES orders,actor uuid,action text NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE order_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY incident_read ON order_incidents FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM orders o WHERE o.id=order_id AND can_manage_business(o.restaurant_id)));
CREATE POLICY audit_read ON operation_audit FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM orders o WHERE o.id=order_id AND can_manage_business(o.restaurant_id)));
CREATE OR REPLACE FUNCTION public.order_admission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r restaurants; distance_km float;
BEGIN
 SELECT * INTO r FROM restaurants WHERE id=NEW.restaurant_id;
 IF auth.uid() IS NULL OR NEW.client_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Inicia sesión para crear el pedido'; END IF;
 IF NOT can_order_business(r.id) OR NOT r.is_open THEN RAISE EXCEPTION 'Negocio o categoría no disponible'; END IF;
 IF NEW.status<>'PENDING' THEN RAISE EXCEPTION 'Estado inicial inválido'; END IF;
 IF coalesce(NEW.delivery_type,'delivery')='delivery' THEN
  IF NEW.client_lat IS NULL OR NEW.client_lng IS NULL OR NOT(NEW.client_lat BETWEEN -90 AND 90) OR NOT(NEW.client_lng BETWEEN -180 AND 180) OR r.lat IS NULL OR r.lng IS NULL OR coalesce(r.delivery_radius_km,0)<=0 THEN RAISE EXCEPTION 'Ubicación de entrega inválida'; END IF;
  distance_km:=6371*2*asin(sqrt(least(1.0,power(sin(radians(NEW.client_lat-r.lat)/2),2)+cos(radians(r.lat))*cos(radians(NEW.client_lat))*power(sin(radians(NEW.client_lng-r.lng)/2),2))));
  IF distance_km>r.delivery_radius_km THEN RAISE EXCEPTION 'El domicilio está fuera de cobertura'; END IF;
 END IF;
 NEW.created_at:=now();NEW.response_deadline:=now()+interval '10 minutes';NEW.category_snapshot:=r.type;
 NEW.accepted_at:=NULL;NEW.proposal_expires_at:=NULL;NEW.promised_from:=NULL;NEW.promised_to:=NULL;
 IF lower(trim(r.type)) IN('frutería','carnicería','cremería','pescadería','tiendas') THEN
  NEW.picking_preferences:=coalesce(NEW.picking_preferences,'{}')||jsonb_build_object('on_unavailable','remove','on_less_quantity',CASE WHEN NEW.picking_preferences->>'on_less_quantity'='remove' THEN 'remove' ELSE 'accept_available' END,'policy_version',2);
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER operations_admission BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION order_admission();
CREATE OR REPLACE FUNCTION public.order_transition_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF OLD.status='PENDING' AND NEW.status IN('ACCEPTED','PREPARING') THEN
  IF now()>=OLD.response_deadline THEN RAISE EXCEPTION 'Venció el plazo de respuesta'; END IF;
  IF OLD.proposal_expires_at IS NOT NULL AND current_setting('pideya.approve_proposal',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Falta la aprobación del cliente'; END IF;
  NEW.accepted_at:=now();
 END IF;
 IF current_user IN('anon','authenticated') THEN
  IF NEW.client_user_id IS DISTINCT FROM OLD.client_user_id OR NEW.restaurant_id<>OLD.restaurant_id OR NEW.items IS DISTINCT FROM OLD.items OR NEW.total IS DISTINCT FROM OLD.total OR NEW.response_deadline IS DISTINCT FROM OLD.response_deadline THEN RAISE EXCEPTION 'Usa las operaciones autorizadas del pedido'; END IF;
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
CREATE TRIGGER operations_transition BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION order_transition_guard();
CREATE OR REPLACE FUNCTION public.client_cancel_order(p_order_id uuid) RETURNS orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o orders;
BEGIN
 SELECT * INTO o FROM orders WHERE id=p_order_id FOR UPDATE;
 IF auth.uid() IS NULL OR o.client_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Pedido no autorizado'; END IF;
 IF o.status='CANCELLED' THEN RETURN o; END IF;
 IF o.status<>'PENDING' THEN RAISE EXCEPTION 'El negocio ya respondió; solicita asistencia'; END IF;
 UPDATE orders SET status='CANCELLED',cancelled_at=now(),cancelled_by='client',rejection_reason='Cancelado antes de aceptación' WHERE id=o.id RETURNING * INTO o;
 RETURN o;
END;$$;
CREATE OR REPLACE FUNCTION public.merchant_propose_time(p_order_id uuid,p_from timestamptz,p_to timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o orders;
BEGIN
 SELECT * INTO o FROM orders WHERE id=p_order_id FOR UPDATE;
 IF NOT can_manage_business(o.restaurant_id) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF o.status<>'PENDING' OR now()>=o.response_deadline OR o.proposal_expires_at IS NOT NULL THEN RAISE EXCEPTION 'Solicitud vencida o ya tiene propuesta'; END IF;
 IF p_from<now() OR p_to<=p_from OR p_to>now()+interval '8 hours' THEN RAISE EXCEPTION 'Horario inválido'; END IF;
 UPDATE orders SET promised_from=p_from,promised_to=p_to,proposal_expires_at=least(now()+interval '2 minutes',created_at+interval '12 minutes'),response_deadline=least(now()+interval '2 minutes',created_at+interval '12 minutes') WHERE id=o.id;
 INSERT INTO operation_audit(order_id,actor,action) VALUES(o.id,auth.uid(),'PROPOSE_TIME');
END;$$;
CREATE OR REPLACE FUNCTION public.client_accept_time(p_order_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o orders;
BEGIN
 SELECT * INTO o FROM orders WHERE id=p_order_id FOR UPDATE;
 IF auth.uid() IS NULL OR o.client_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF o.status<>'PENDING' OR o.proposal_expires_at IS NULL OR now()>=o.proposal_expires_at THEN RAISE EXCEPTION 'Propuesta no vigente'; END IF;
 IF NOT can_order_business(o.restaurant_id) THEN RAISE EXCEPTION 'Negocio no disponible'; END IF;
 PERFORM set_config('pideya.approve_proposal','yes',true);
 UPDATE orders SET status='ACCEPTED',accepted_at=now() WHERE id=o.id;
 INSERT INTO operation_audit(order_id,actor,action) VALUES(o.id,auth.uid(),'ACCEPT_TIME');
END;$$;
CREATE OR REPLACE FUNCTION public.report_order_incident(p_order_id uuid,p_cause text,p_description text,p_driver_token text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o orders;d uuid;result uuid;
BEGIN
 SELECT * INTO o FROM orders WHERE id=p_order_id;
 IF p_driver_token IS NOT NULL THEN SELECT id INTO d FROM driver_profiles WHERE access_token=p_driver_token AND is_active AND id=o.delivery_driver_id; END IF;
 IF o.id IS NULL OR (NOT can_manage_business(o.restaurant_id) AND d IS NULL) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF length(trim(p_description))<5 OR length(p_description)>2000 THEN RAISE EXCEPTION 'Describe lo ocurrido (5–2000 caracteres)'; END IF;
 INSERT INTO order_incidents(order_id,cause,description,created_by,driver_id) VALUES(o.id,p_cause,trim(p_description),auth.uid(),d)
 ON CONFLICT(order_id,cause) WHERE status<>'RESOLVED' DO UPDATE SET updated_at=now() RETURNING id INTO result;
 INSERT INTO operation_audit(order_id,actor,action,details) VALUES(o.id,auth.uid(),'INCIDENT_REPORTED',jsonb_build_object('incident_id',result,'cause',p_cause,'description',trim(p_description),'driver_id',d));
 RETURN result;
END;$$;
CREATE OR REPLACE FUNCTION public.manage_order_incident(p_id uuid,p_status text,p_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i order_incidents;r uuid;
BEGIN
 SELECT * INTO i FROM order_incidents WHERE id=p_id FOR UPDATE;
 SELECT restaurant_id INTO r FROM orders WHERE id=i.order_id;
 IF NOT can_manage_business(r) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF length(trim(p_note))<5 THEN RAISE EXCEPTION 'Indica la acción o resolución'; END IF;
 IF i.status='RESOLVED' THEN RAISE EXCEPTION 'Incidencia ya resuelta'; END IF;
 UPDATE order_incidents SET status=p_status,resolution=p_note,assigned_to=auth.uid(),updated_at=now(),resolved_at=CASE WHEN p_status='RESOLVED' THEN now() END WHERE id=p_id;
 INSERT INTO operation_audit(order_id,actor,action,details) VALUES(i.order_id,auth.uid(),'INCIDENT_'||p_status,jsonb_build_object('note',p_note));
END;$$;
CREATE OR REPLACE FUNCTION public.cancel_orphan_orders() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer;
BEGIN
 UPDATE orders SET status='CANCELLED',cancelled_by='SYSTEM',cancelled_at=now(),rejection_reason='Solicitud vencida sin aceptación' WHERE status='PENDING' AND response_deadline<=now();
 GET DIAGNOSTICS n=ROW_COUNT;
 INSERT INTO order_incidents(order_id,cause,description)
 SELECT id,'DELAY','Pedido abierto por más de dos horas; revisar sin cancelar automáticamente' FROM orders WHERE status NOT IN('PENDING','DELIVERED','CANCELLED','REJECTED') AND created_at<now()-interval '2 hours'
 ON CONFLICT(order_id,cause) WHERE status<>'RESOLVED' DO NOTHING;
 RETURN n;
END;$$;
-- Free pre-acceptance cancellation must not inherit a card penalty or strike counter.
CREATE OR REPLACE FUNCTION public.handle_order_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
SELECT cron.schedule('cancel-orphan-orders','* * * * *','SELECT public.cancel_orphan_orders()');
REVOKE ALL ON FUNCTION client_cancel_order(uuid),merchant_propose_time(uuid,timestamptz,timestamptz),client_accept_time(uuid),manage_order_incident(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION client_cancel_order(uuid),merchant_propose_time(uuid,timestamptz,timestamptz),client_accept_time(uuid),manage_order_incident(uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION cancel_orphan_orders() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION cancel_orphan_orders() TO service_role;
COMMIT;
