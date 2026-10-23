BEGIN;
CREATE TABLE account_restrictions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id),reason text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),created_by uuid NOT NULL REFERENCES auth.users(id),revoked_at timestamptz,revoked_by uuid REFERENCES auth.users(id));
CREATE INDEX account_restriction_active ON account_restrictions(user_id,expires_at) WHERE revoked_at IS NULL;
CREATE TABLE abuse_reports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES orders(id),user_id uuid NOT NULL REFERENCES auth.users(id),reason text NOT NULL,status text NOT NULL DEFAULT 'open' CHECK(status IN('open','reviewed','dismissed')),created_at timestamptz NOT NULL DEFAULT now(),created_by uuid NOT NULL REFERENCES auth.users(id),resolution text,reviewed_at timestamptz);
CREATE UNIQUE INDEX abuse_one_open_report ON abuse_reports(order_id) WHERE status='open';
ALTER TABLE account_restrictions ENABLE ROW LEVEL SECURITY;ALTER TABLE abuse_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY restriction_admin_read ON account_restrictions FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()));
CREATE POLICY abuse_admin_read ON abuse_reports FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) OR EXISTS(SELECT 1 FROM orders o WHERE o.id=order_id AND can_manage_business(o.restaurant_id)));
GRANT SELECT ON account_restrictions,abuse_reports TO authenticated;
CREATE FUNCTION enforce_account_order_limits() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NEW.client_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Inicia sesión para crear el pedido';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,48));
 IF EXISTS(SELECT 1 FROM account_restrictions WHERE user_id=auth.uid() AND revoked_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'Tu cuenta tiene una restricción temporal. Contacta con soporte de PideYa.';END IF;
 IF (SELECT count(*) FROM orders WHERE client_user_id=auth.uid() AND created_at>now()-interval '10 minutes')>=8 THEN RAISE EXCEPTION 'Has creado varios pedidos seguidos. Espera unos minutos antes de intentar de nuevo.';END IF;
 IF (SELECT count(*) FROM orders WHERE client_user_id=auth.uid() AND status='PENDING' AND response_deadline>now())>=4 THEN RAISE EXCEPTION 'Tienes cuatro pedidos esperando respuesta. Espera a que el negocio responda.';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aa_account_order_limits BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION enforce_account_order_limits();
CREATE INDEX IF NOT EXISTS orders_account_time ON orders(client_user_id,created_at DESC);
CREATE FUNCTION report_order_abuse(p_order uuid,p_reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid;rid uuid;result uuid;
BEGIN
 SELECT client_user_id,restaurant_id INTO u,rid FROM orders WHERE id=p_order;
 IF u IS NULL OR NOT can_manage_business(rid) THEN RAISE EXCEPTION 'No autorizado';END IF;
 IF length(trim(p_reason)) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'Describe el motivo con al menos 10 caracteres';END IF;
 IF EXISTS(SELECT 1 FROM abuse_reports WHERE order_id=p_order AND status='open') THEN RAISE EXCEPTION 'Este pedido ya tiene un reporte abierto';END IF;
 INSERT INTO abuse_reports(order_id,user_id,reason,created_by) VALUES(p_order,u,trim(p_reason),auth.uid()) RETURNING id INTO result;RETURN result;
END $$;
CREATE FUNCTION admin_restrict_account(p_user uuid,p_reason text,p_hours integer DEFAULT 24) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'No autorizado';END IF;
 IF p_hours NOT BETWEEN 1 AND 720 OR length(trim(p_reason)) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'Motivo y duración inválidos';END IF;
 IF p_user=auth.uid() OR EXISTS(SELECT 1 FROM admin_profiles WHERE id=p_user) THEN RAISE EXCEPTION 'No se restringen administradores desde este módulo';END IF;
 INSERT INTO account_restrictions(user_id,reason,expires_at,created_by) VALUES(p_user,trim(p_reason),now()+make_interval(hours=>p_hours),auth.uid()) RETURNING id INTO result;
 INSERT INTO operation_audit(actor,action,details) VALUES(auth.uid(),'ACCOUNT_RESTRICTED',jsonb_build_object('restriction_id',result,'user_id',p_user,'hours',p_hours,'reason',trim(p_reason)));RETURN result;
END $$;
CREATE FUNCTION admin_revoke_restriction(p_id uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'No autorizado';END IF;
 IF length(trim(p_reason))<10 THEN RAISE EXCEPTION 'Escribe el motivo de la revisión';END IF;
 UPDATE account_restrictions SET revoked_at=now(),revoked_by=auth.uid() WHERE id=p_id AND revoked_at IS NULL;
 INSERT INTO operation_audit(actor,action,details) VALUES(auth.uid(),'ACCOUNT_RESTRICTION_REVOKED',jsonb_build_object('restriction_id',p_id,'reason',trim(p_reason)));
END $$;
CREATE FUNCTION admin_review_abuse(p_id uuid,p_status text,p_resolution text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'No autorizado';END IF;
 IF p_status NOT IN('reviewed','dismissed') OR length(trim(p_resolution))<10 THEN RAISE EXCEPTION 'Escribe la conclusión de la revisión';END IF;
 UPDATE abuse_reports SET status=p_status,resolution=trim(p_resolution),reviewed_at=now() WHERE id=p_id AND status='open';
END $$;
CREATE FUNCTION admin_abuse_overview() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'No autorizado';END IF;
 RETURN jsonb_build_object('signals',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM(SELECT o.client_user_id user_id,max(o.client_name) name,count(*) orders_24h,count(*)FILTER(WHERE o.status='CANCELLED') cancelled,count(*)FILTER(WHERE o.status='REJECTED') rejected,max(o.created_at) last_order FROM orders o WHERE o.client_user_id IS NOT NULL AND o.created_at>now()-interval '24 hours' GROUP BY o.client_user_id HAVING count(*)>=5 OR count(*)FILTER(WHERE o.status='CANCELLED')>=3 ORDER BY count(*) DESC LIMIT 100)s),'[]'),'restrictions',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM(SELECT * FROM account_restrictions ORDER BY created_at DESC LIMIT 100)r),'[]'),'reports',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM(SELECT a.*,o.order_number,o.client_name,r.name business_name FROM abuse_reports a JOIN orders o ON o.id=a.order_id JOIN restaurants r ON r.id=o.restaurant_id ORDER BY a.created_at DESC LIMIT 100)r),'[]'),'legacy_ip_entries',(SELECT count(*) FROM blocked_entities));
END $$;
CREATE FUNCTION admin_verify_business_location(p_id uuid,p_address text,p_lat double precision,p_lng double precision,p_notes text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'No autorizado';END IF;
 IF p_lat IS NULL OR p_lng IS NULL OR NOT(p_lat BETWEEN 14 AND 33.5) OR NOT(p_lng BETWEEN -119 AND -86) OR length(trim(p_address))<8 OR length(trim(p_notes))<5 THEN RAISE EXCEPTION 'Confirma dirección, acceso y un pin válido en México';END IF;
 PERFORM 1 FROM restaurants WHERE id=p_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM orders WHERE restaurant_id=p_id AND status NOT IN('DELIVERED','CANCELLED','REJECTED')) THEN RAISE EXCEPTION 'Termina los pedidos activos antes de cambiar el punto de recogida';END IF;
 UPDATE restaurants SET address=trim(p_address),lat=p_lat,lng=p_lng,pickup_instructions=trim(p_notes),location_verified_at=now(),location_verified_by=auth.uid() WHERE id=p_id;
 INSERT INTO operation_audit(actor,action,details) VALUES(auth.uid(),'BUSINESS_LOCATION_VERIFIED',jsonb_build_object('restaurant_id',p_id,'lat',p_lat,'lng',p_lng));
END $$;
CREATE FUNCTION guard_business_location() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE admin boolean:=EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) OR auth.role()='service_role';
BEGIN
 IF TG_OP='INSERT' THEN
 IF NEW.lat IS NULL OR NEW.lng IS NULL OR NOT(NEW.lat BETWEEN 14 AND 33.5) OR NOT(NEW.lng BETWEEN -119 AND -86) OR length(trim(coalesce(NEW.address,'')))<8 THEN RAISE EXCEPTION 'Confirma la dirección y el pin del negocio en México';END IF;
 NEW.location_verified_at=NULL;NEW.location_verified_by=NULL;
 ELSE
 IF NOT admin AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'Solo PideYa puede aprobar o suspender negocios';END IF;
 IF NOT admin AND (NEW.lat IS DISTINCT FROM OLD.lat OR NEW.lng IS DISTINCT FROM OLD.lng OR NEW.address IS DISTINCT FROM OLD.address OR NEW.location_verified_at IS DISTINCT FROM OLD.location_verified_at OR NEW.location_verified_by IS DISTINCT FROM OLD.location_verified_by) THEN RAISE EXCEPTION 'Solicita la verificación del nuevo domicilio a PideYa antes de cambiarlo';END IF;
 IF NEW.status='ACTIVE' AND OLD.status<>'ACTIVE' AND NEW.location_verified_at IS NULL THEN RAISE EXCEPTION 'Verifica primero la ubicación en Mapa en vivo';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER business_location_guard BEFORE INSERT OR UPDATE ON restaurants FOR EACH ROW EXECUTE FUNCTION guard_business_location();
REVOKE ALL ON FUNCTION report_order_abuse(uuid,text),admin_restrict_account(uuid,text,integer),admin_revoke_restriction(uuid,text),admin_review_abuse(uuid,text,text),admin_abuse_overview(),admin_verify_business_location(uuid,text,double precision,double precision,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_order_abuse(uuid,text),admin_restrict_account(uuid,text,integer),admin_revoke_restriction(uuid,text),admin_review_abuse(uuid,text,text),admin_abuse_overview(),admin_verify_business_location(uuid,text,double precision,double precision,text) TO authenticated;
COMMIT;
