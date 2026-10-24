BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
CREATE TABLE public.technical_incidents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 business_id uuid REFERENCES public.restaurants(id) ON DELETE SET NULL,
 app text NOT NULL CHECK(app IN('client','merchant','driver','admin')),
 operation text NOT NULL CHECK(length(operation) BETWEEN 1 AND 60),
 code text NOT NULL CHECK(length(code) BETWEEN 1 AND 60),
 app_version text NOT NULL DEFAULT '' CHECK(length(app_version)<=32),
 build_version text NOT NULL DEFAULT '' CHECK(length(build_version)<=32),
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','IN_PROGRESS','RESOLVED')),
 resolution text NOT NULL DEFAULT '' CHECK(length(resolution)<=2000),
 updated_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz,
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX technical_incidents_recent ON technical_incidents(created_at DESC);
CREATE INDEX technical_incidents_user_time ON technical_incidents(user_id,created_at DESC);
CREATE INDEX technical_incidents_open ON technical_incidents(status,created_at DESC) WHERE status<>'RESOLVED';
ALTER TABLE technical_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON technical_incidents FROM anon,authenticated;
GRANT SELECT ON technical_incidents TO authenticated;
CREATE POLICY technical_incidents_admin_read ON technical_incidents FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()));

-- Separate transaction from the operation that failed. No payload, address, token or raw SQL message accepted.
CREATE FUNCTION report_technical_incident(p_id uuid,p_business uuid,p_app text,p_operation text,p_code text,p_version text,p_build text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Inicia sesión'; END IF;
 IF p_id IS NULL OR p_app NOT IN('client','merchant','driver','admin') OR p_operation !~ '^[a-z_]{1,60}$' OR p_code !~ '^[A-Z0-9_]{1,60}$' THEN RAISE EXCEPTION 'Reporte inválido'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,53));
 IF EXISTS(SELECT 1 FROM technical_incidents WHERE id=p_id AND user_id=auth.uid()) THEN RETURN p_id; END IF;
 IF (SELECT count(*) FROM technical_incidents WHERE user_id=auth.uid() AND created_at>now()-interval '1 hour')>=20 THEN RETURN NULL; END IF;
 IF p_business IS NOT NULL AND NOT EXISTS(SELECT 1 FROM restaurants WHERE id=p_business) THEN p_business:=NULL; END IF;
 INSERT INTO technical_incidents(id,user_id,business_id,app,operation,code,app_version,build_version)
 VALUES(p_id,auth.uid(),p_business,p_app,p_operation,p_code,left(coalesce(p_version,''),32),left(coalesce(p_build,''),32));
 RETURN p_id;
END;$$;
REVOKE ALL ON FUNCTION report_technical_incident(uuid,uuid,text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION report_technical_incident(uuid,uuid,text,text,text,text,text) TO authenticated;

CREATE FUNCTION admin_technical_incidents(p_from timestamptz,p_to timestamptz,p_status text DEFAULT NULL,p_business uuid DEFAULT NULL,p_user uuid DEFAULT NULL,p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'Solo admin PideYa'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to<=p_from OR p_to-p_from>interval '366 days' OR p_offset<0 OR p_offset>100000 THEN RAISE EXCEPTION 'Rango inválido'; END IF;
 WITH filtered AS (SELECT i.*,r.name business_name,u.email user_email FROM technical_incidents i LEFT JOIN restaurants r ON r.id=i.business_id LEFT JOIN auth.users u ON u.id=i.user_id WHERE i.created_at>=p_from AND i.created_at<p_to AND (p_status IS NULL OR i.status=p_status) AND(p_business IS NULL OR i.business_id=p_business) AND(p_user IS NULL OR i.user_id=p_user)),
 page AS(SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT 50 OFFSET p_offset)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'open',(SELECT count(*) FROM filtered WHERE status<>'RESOLVED'),'affected_users',(SELECT count(DISTINCT user_id) FROM filtered),'rows',coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM page),'[]')) INTO result;
 RETURN result;
END;$$;
CREATE FUNCTION admin_update_technical_incident(p_id uuid,p_status text,p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'Solo admin PideYa'; END IF;
 IF p_status NOT IN('OPEN','IN_PROGRESS','RESOLVED') OR length(trim(p_note))<5 OR length(p_note)>2000 THEN RAISE EXCEPTION 'Indica estado y una nota de 5 a 2000 caracteres'; END IF;
 UPDATE technical_incidents SET status=p_status,resolution=p_note,updated_at=now(),updated_by=auth.uid(),resolved_at=CASE WHEN p_status='RESOLVED' THEN now() ELSE NULL END WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Incidencia no encontrada'; END IF;
 INSERT INTO operation_audit(actor,action,details) VALUES(auth.uid(),'TECHNICAL_INCIDENT_STATUS',jsonb_build_object('incident',p_id,'status',p_status,'note',p_note));
END;$$;
REVOKE ALL ON FUNCTION admin_technical_incidents(timestamptz,timestamptz,text,uuid,uuid,integer),admin_update_technical_incident(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION admin_technical_incidents(timestamptz,timestamptz,text,uuid,uuid,integer),admin_update_technical_incident(uuid,text,text) TO authenticated;

-- Preserve the operational metrics already scraped by Grafana.
ALTER FUNCTION platform_health_snapshot() RENAME TO platform_health_snapshot_core;
CREATE FUNCTION platform_health_snapshot() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT platform_health_snapshot_core() || jsonb_build_object(
 'technical_errors_1h',(SELECT count(*) FROM technical_incidents WHERE created_at>now()-interval '1 hour'),
 'technical_affected_users_1h',(SELECT count(DISTINCT user_id) FROM technical_incidents WHERE created_at>now()-interval '1 hour'),
 'technical_incidents_open',(SELECT count(*) FROM technical_incidents WHERE status<>'RESOLVED'),
 'checkout_errors_15m',(SELECT count(*) FROM technical_incidents WHERE operation='create_order' AND created_at>now()-interval '15 minutes')
 );
$$;
REVOKE ALL ON FUNCTION platform_health_snapshot(),platform_health_snapshot_core() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION platform_health_snapshot() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
