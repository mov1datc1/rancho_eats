-- Independent of optional email migration 060. Requires platform migrations through 059.
BEGIN;
INSERT INTO public.app_settings(setting_key,value) VALUES('staff_auth_email_ready','false'::jsonb) ON CONFLICT(setting_key) DO NOTHING;
CREATE TABLE public.staff_roles (
 id text PRIMARY KEY, name text NOT NULL CHECK(length(trim(name)) BETWEEN 3 AND 60),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=240),
 permissions text[] NOT NULL DEFAULT '{}', builtin boolean NOT NULL DEFAULT false,
 version bigint NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(permissions <@ ARRAY['admin.full','orders.read','orders.write','commissions.read','commissions.collect','businesses.read','leads.read','incidents.read']::text[]),
 CHECK(NOT('orders.write'=ANY(permissions)) OR 'orders.read'=ANY(permissions)),
 CHECK(NOT('commissions.collect'=ANY(permissions)) OR 'commissions.read'=ANY(permissions))
);
INSERT INTO staff_roles(id,name,description,permissions,builtin) VALUES
 ('owner','Superadmin principal','Control del equipo y de toda la plataforma.',ARRAY['admin.full'],true),
 ('administrator','Administrador','Gestiona la plataforma. No administra usuarios ni roles.',ARRAY['admin.full'],true),
 ('operations','Operación','Consulta pedidos e incidencias y cambia estados autorizados.',ARRAY['orders.read','orders.write','incidents.read'],true),
 ('finance','Finanzas','Consulta comisiones y registra dinero recibido con recibo.',ARRAY['commissions.read','commissions.collect'],true),
 ('commercial','Comercial','Consulta negocios y solicitudes de incorporación.',ARRAY['businesses.read','leads.read'],true);
CREATE TABLE public.staff_members (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 100),
 role_id text NOT NULL REFERENCES staff_roles(id), active boolean NOT NULL DEFAULT true,
 is_owner boolean NOT NULL DEFAULT false, version bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
-- Existing administrators retain their authority. They cannot be demoted by this UI.
INSERT INTO staff_members(user_id,name,role_id,is_owner)
SELECT a.id,left(coalesce(nullif(split_part(u.email,'@',1),''),'Superadmin'),100),'owner',true
FROM admin_profiles a JOIN auth.users u ON u.id=a.id;
CREATE TABLE public.staff_access_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 subject uuid REFERENCES auth.users(id) ON DELETE SET NULL,action text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_audit_recent ON staff_access_audit(created_at DESC,id);
CREATE TABLE public.staff_email_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor uuid NOT NULL REFERENCES auth.users(id),
 action text NOT NULL CHECK(action IN('invite','recovery')),email text NOT NULL,name text NOT NULL,
 role_id text REFERENCES staff_roles(id),state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','requested','failed')),
 error_code text,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz
);
CREATE INDEX staff_email_rate_limit ON staff_email_actions(actor,created_at DESC);
CREATE INDEX staff_email_recent ON staff_email_actions(email,created_at DESC);
ALTER TABLE staff_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_email_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON staff_roles,staff_members,staff_access_audit,staff_email_actions FROM PUBLIC,anon,authenticated;
GRANT ALL ON staff_roles,staff_members,staff_access_audit,staff_email_actions TO service_role;

CREATE FUNCTION public.staff_owner_id(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM staff_members WHERE user_id=p_user AND active AND is_owner)
 OR EXISTS(SELECT 1 FROM admin_profiles a WHERE a.id=p_user AND NOT EXISTS(SELECT 1 FROM staff_members m WHERE m.user_id=p_user))
$$;
CREATE FUNCTION public.staff_is_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT staff_owner_id(auth.uid()) $$;
CREATE FUNCTION public.staff_can(p_permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT staff_owner_id(auth.uid()) OR EXISTS(SELECT 1 FROM staff_members m JOIN staff_roles r ON r.id=m.role_id
 WHERE m.user_id=auth.uid() AND m.active AND ('admin.full'=ANY(r.permissions) OR p_permission=ANY(r.permissions)))
$$;
CREATE FUNCTION public.staff_my_access() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('user_id',auth.uid(),'owner',staff_owner_id(auth.uid()),
 'full',staff_owner_id(auth.uid()) OR coalesce(m.active AND 'admin.full'=ANY(r.permissions),false),
 'active',coalesce(m.active,false) OR staff_owner_id(auth.uid()),'name',m.name,'role',r.name,
 'permissions',CASE WHEN m.active THEN to_jsonb(r.permissions) ELSE '[]'::jsonb END)
 FROM (SELECT 1) x LEFT JOIN staff_members m ON m.user_id=auth.uid() LEFT JOIN staff_roles r ON r.id=m.role_id
$$;
CREATE FUNCTION public.staff_sync_admin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.is_owner THEN RETURN NEW; END IF;
 IF NEW.active AND EXISTS(SELECT 1 FROM staff_roles WHERE id=NEW.role_id AND 'admin.full'=ANY(permissions)) THEN
   INSERT INTO admin_profiles(id,email) SELECT id,email FROM auth.users WHERE id=NEW.user_id
   ON CONFLICT(id) DO NOTHING;
 ELSE DELETE FROM admin_profiles WHERE id=NEW.user_id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_sync_admin_profile AFTER INSERT OR UPDATE ON staff_members FOR EACH ROW EXECUTE FUNCTION staff_sync_admin();
CREATE FUNCTION public.staff_role_sync_members() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE staff_members SET version=version+1,updated_at=now() WHERE role_id=NEW.id AND NOT is_owner;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_sync_role_change AFTER UPDATE OF permissions ON staff_roles FOR EACH ROW EXECUTE FUNCTION staff_role_sync_members();

CREATE FUNCTION public.staff_directory(p_search text DEFAULT '',p_page integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT staff_is_owner() THEN RAISE EXCEPTION 'not_authorized';END IF;
 IF p_page<0 OR p_page>10000 OR length(p_search)>100 THEN RAISE EXCEPTION 'invalid_filter';END IF;
 WITH all_members AS(SELECT m.*,u.email,u.last_sign_in_at,r.name role_name FROM staff_members m JOIN auth.users u ON u.id=m.user_id JOIN staff_roles r ON r.id=m.role_id
 WHERE m.name ILIKE '%'||p_search||'%' OR u.email ILIKE '%'||p_search||'%')
 SELECT jsonb_build_object('count',(SELECT count(*) FROM all_members),'rows',coalesce((SELECT jsonb_agg(to_jsonb(v)) FROM(SELECT * FROM all_members ORDER BY is_owner DESC,name,user_id LIMIT 25 OFFSET p_page*25)v),'[]'),
 'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY builtin DESC,name) FROM staff_roles r),
 'email_ready',coalesce((SELECT value='true'::jsonb FROM app_settings WHERE setting_key='staff_auth_email_ready'),false),
 'recent_invitations',coalesce((SELECT jsonb_agg(to_jsonb(v)) FROM(SELECT id,email,name,role_id,state,action,error_code,created_at FROM staff_email_actions WHERE action='invite' ORDER BY created_at DESC LIMIT 10)v),'[]')) INTO result;
 RETURN result;
END $$;
CREATE FUNCTION public.staff_save_role(p_id text,p_name text,p_description text,p_permissions text[],p_version bigint DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r staff_roles;
BEGIN
 IF NOT staff_is_owner() THEN RAISE EXCEPTION 'not_authorized';END IF;
 IF p_id IS NULL OR p_id !~ '^custom_[a-z0-9_]{3,60}$' OR p_permissions IS NULL THEN RAISE EXCEPTION 'invalid_role';END IF;
 SELECT * INTO r FROM staff_roles WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
   IF r.builtin OR r.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'role_changed_refresh';END IF;
   UPDATE staff_roles SET name=trim(p_name),description=trim(p_description),permissions=p_permissions,version=version+1,updated_at=now() WHERE id=p_id;
 ELSE
   IF p_version IS NOT NULL THEN RAISE EXCEPTION 'role_changed_refresh';END IF;
   INSERT INTO staff_roles(id,name,description,permissions) VALUES(p_id,trim(p_name),trim(p_description),p_permissions);
 END IF;
 INSERT INTO staff_access_audit(actor,action,details) VALUES(auth.uid(),'ROLE_SAVED',jsonb_build_object('role_id',p_id,'permissions',p_permissions));
END $$;
CREATE FUNCTION public.staff_grant_existing(p_email text,p_name text,p_role text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target uuid;
BEGIN
 IF NOT staff_is_owner() THEN RAISE EXCEPTION 'not_authorized';END IF;
 IF p_role='owner' OR NOT EXISTS(SELECT 1 FROM staff_roles WHERE id=p_role) THEN RAISE EXCEPTION 'invalid_role';END IF;
 SELECT id INTO target FROM auth.users WHERE lower(email)=lower(trim(p_email)) AND email_confirmed_at IS NOT NULL;
 IF target IS NULL THEN RAISE EXCEPTION 'confirmed_account_required';END IF;
 IF EXISTS(SELECT 1 FROM staff_members WHERE user_id=target) THEN RAISE EXCEPTION 'member_exists';END IF;
 INSERT INTO staff_members(user_id,name,role_id) VALUES(target,trim(p_name),p_role);
 INSERT INTO staff_access_audit(actor,subject,action,details) VALUES(auth.uid(),target,'ACCESS_GRANTED',jsonb_build_object('role_id',p_role));
END $$;
CREATE FUNCTION public.staff_update_member(p_user uuid,p_name text,p_role text,p_active boolean,p_version bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE member staff_members;
BEGIN
 IF NOT staff_is_owner() THEN RAISE EXCEPTION 'not_authorized';END IF;
 SELECT * INTO member FROM staff_members WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND OR member.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'member_changed_refresh';END IF;
 IF member.is_owner OR p_user=auth.uid() OR p_role='owner' THEN RAISE EXCEPTION 'protected_account';END IF;
 IF p_active IS NULL THEN RAISE EXCEPTION 'invalid_member';END IF;
 UPDATE staff_members SET name=trim(p_name),role_id=p_role,active=p_active,version=version+1,updated_at=now() WHERE user_id=p_user;
 INSERT INTO staff_access_audit(actor,subject,action,details) VALUES(auth.uid(),p_user,'ACCESS_UPDATED',jsonb_build_object('role_id',p_role,'active',p_active,'previous_role',member.role_id));
END $$;
CREATE FUNCTION public.staff_audit_page(p_page integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT staff_is_owner() THEN RAISE EXCEPTION 'not_authorized';END IF;
 IF p_page<0 OR p_page>10000 THEN RAISE EXCEPTION 'invalid_page';END IF;
 RETURN jsonb_build_object('count',(SELECT count(*) FROM staff_access_audit),'rows',coalesce((SELECT jsonb_agg(to_jsonb(v)) FROM(
 SELECT a.*,u.email actor_email,s.email subject_email FROM staff_access_audit a LEFT JOIN auth.users u ON u.id=a.actor LEFT JOIN auth.users s ON s.id=a.subject ORDER BY a.created_at DESC,a.id LIMIT 25 OFFSET p_page*25)v),'[]'));
END $$;

-- Reserve before Auth sends mail. Only known staff can receive recovery requests.
CREATE FUNCTION public.staff_reserve_email(p_action text,p_email text,p_name text DEFAULT '',p_role text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request_id uuid;normalized text:=lower(trim(p_email));
BEGIN
 IF NOT staff_is_owner() THEN RAISE EXCEPTION 'not_authorized';END IF;
 IF p_action NOT IN('invite','recovery') OR p_action IS NULL OR normalized IS NULL OR length(normalized)>254 OR normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'invalid_email_action';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,61));
 PERFORM pg_advisory_xact_lock(hashtextextended(normalized,611));
 IF EXISTS(SELECT 1 FROM staff_email_actions WHERE email=normalized AND created_at>now()-interval '90 seconds') OR (SELECT count(*) FROM staff_email_actions WHERE actor=auth.uid() AND created_at>now()-interval '1 day')>=20 THEN RAISE EXCEPTION 'email_rate_limit';END IF;
 IF p_action='invite' THEN
   IF p_role IS NULL OR p_role='owner' OR NOT EXISTS(SELECT 1 FROM staff_roles WHERE id=p_role) OR length(trim(p_name)) NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'invalid_invitation';END IF;
   IF EXISTS(SELECT 1 FROM auth.users WHERE lower(email)=normalized) THEN RAISE EXCEPTION 'account_exists_use_existing';END IF;
 ELSE
   IF NOT EXISTS(SELECT 1 FROM staff_members m JOIN auth.users u ON u.id=m.user_id WHERE lower(u.email)=normalized AND m.active) THEN RAISE EXCEPTION 'active_staff_required';END IF;
 END IF;
 INSERT INTO staff_email_actions(actor,action,email,name,role_id) VALUES(auth.uid(),p_action,normalized,left(trim(p_name),100),CASE WHEN p_action='invite' THEN p_role END) RETURNING id INTO request_id;
 INSERT INTO staff_access_audit(actor,action,details) VALUES(auth.uid(),'EMAIL_RESERVED',jsonb_build_object('request_id',request_id,'type',p_action));
 RETURN request_id;
END $$;
CREATE FUNCTION public.staff_finish_email(p_request uuid,p_user uuid DEFAULT NULL,p_success boolean DEFAULT false,p_code text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request staff_email_actions;
BEGIN
 SELECT * INTO request FROM staff_email_actions WHERE id=p_request FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found';END IF;
 IF request.state<>'pending' THEN RETURN;END IF;
 IF request.created_at<now()-interval '10 minutes' OR NOT staff_owner_id(request.actor) THEN RAISE EXCEPTION 'request_expired';END IF;
 IF p_success AND request.action='invite' THEN
   IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user AND lower(email)=request.email) THEN RAISE EXCEPTION 'invitation_identity_mismatch';END IF;
   INSERT INTO staff_members(user_id,name,role_id) VALUES(p_user,request.name,request.role_id);
 END IF;
 UPDATE staff_email_actions SET state=CASE WHEN p_success THEN 'requested' ELSE 'failed' END,error_code=CASE WHEN p_success THEN NULL ELSE left(p_code,60) END,completed_at=now() WHERE id=p_request;
 INSERT INTO staff_access_audit(actor,subject,action,details) VALUES(request.actor,p_user,CASE WHEN p_success THEN 'EMAIL_REQUESTED' ELSE 'EMAIL_FAILED' END,jsonb_build_object('request_id',p_request,'type',request.action,'code',CASE WHEN NOT p_success THEN left(p_code,60) END));
END $$;
CREATE FUNCTION public.staff_account_protected(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM staff_members WHERE user_id=p_user) OR EXISTS(SELECT 1 FROM admin_profiles WHERE id=p_user)
$$;

-- Financial workers use exactly the existing ledger, idempotency and immutable receipts.
DO $migration$
DECLARE item record;definition text;changed text;permission text;
BEGIN
 FOR item IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname IN('admin_commission_statement','commission_statement','commission_receipt','commission_order_detail','admin_receive_commissions') LOOP
   permission:=CASE WHEN item.proname='admin_receive_commissions' THEN 'commissions.collect' ELSE 'commissions.read' END;
   definition:=pg_get_functiondef(item.oid);
   changed:=replace(definition,'EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid())','public.staff_can('''||permission||''')');
   IF changed=definition THEN RAISE EXCEPTION 'Commission permission patch mismatch: %',item.proname;END IF;
   EXECUTE changed;
 END LOOP;
 -- Prevent the old restaurant-password RPC from resetting a staff account.
 FOR item IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='admin_reset_restaurant_password' LOOP
   definition:=pg_get_functiondef(item.oid);
   changed:=replace(definition,'UPDATE auth.users','IF public.staff_account_protected(v_restaurant.owner_id) THEN RAISE EXCEPTION ''staff_password_requires_recovery''; END IF; UPDATE auth.users');
   IF changed=definition THEN RAISE EXCEPTION 'Password protection patch mismatch';END IF;
   EXECUTE changed;
 END LOOP;
END $migration$;

CREATE FUNCTION public.staff_business_options() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT staff_can('commissions.read') THEN RAISE EXCEPTION 'not_authorized';END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name) FROM restaurants),'[]');
END $$;
CREATE FUNCTION public.staff_workspace(p_module text,p_from date,p_to date,p_search text DEFAULT '',p_page integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;permission text;
BEGIN
 permission:=CASE p_module WHEN 'orders' THEN 'orders.read' WHEN 'incidents' THEN 'incidents.read' WHEN 'businesses' THEN 'businesses.read' WHEN 'leads' THEN 'leads.read' END;
 IF permission IS NULL OR NOT staff_can(permission) THEN RAISE EXCEPTION 'not_authorized';END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>366 OR p_page<0 OR p_page>10000 OR length(p_search)>100 THEN RAISE EXCEPTION 'invalid_filter';END IF;
 IF p_module='orders' THEN
   WITH filtered AS(SELECT o.id,o.order_number,o.reference_code,o.status,o.created_at,o.updated_at,o.client_name,r.name business,
     coalesce(o.adjusted_total,o.total) total,o.delivery_type,
     EXISTS(SELECT 1 FROM app_categories c WHERE lower(trim(c.name))=lower(trim(r.type)) AND c.flow_type='prepared') prepared
     FROM orders o JOIN restaurants r ON r.id=o.restaurant_id
     WHERE o.created_at>=p_from::timestamp AT TIME ZONE 'America/Mexico_City' AND o.created_at<(p_to+1)::timestamp AT TIME ZONE 'America/Mexico_City'
     AND(concat(o.order_number,' ',o.reference_code,' ',r.name,' ',o.client_name) ILIKE '%'||p_search||'%'))
   SELECT jsonb_build_object('count',(SELECT count(*) FROM filtered),'rows',coalesce((SELECT jsonb_agg(to_jsonb(v)) FROM(SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT 25 OFFSET p_page*25)v),'[]')) INTO result;
 ELSIF p_module='incidents' THEN
   WITH filtered AS(SELECT i.id,i.order_id,i.cause,i.status,i.description,i.resolution,i.created_at,o.order_number,r.name business FROM order_incidents i JOIN orders o ON o.id=i.order_id JOIN restaurants r ON r.id=o.restaurant_id
     WHERE i.created_at>=p_from::timestamp AT TIME ZONE 'America/Mexico_City' AND i.created_at<(p_to+1)::timestamp AT TIME ZONE 'America/Mexico_City' AND concat(o.order_number,' ',r.name,' ',i.cause) ILIKE '%'||p_search||'%')
   SELECT jsonb_build_object('count',(SELECT count(*) FROM filtered),'rows',coalesce((SELECT jsonb_agg(to_jsonb(v)) FROM(SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT 25 OFFSET p_page*25)v),'[]')) INTO result;
 ELSIF p_module='businesses' THEN
   WITH filtered AS(SELECT id,name,status,type,created_at FROM restaurants WHERE name ILIKE '%'||p_search||'%')
   SELECT jsonb_build_object('count',(SELECT count(*) FROM filtered),'rows',coalesce((SELECT jsonb_agg(to_jsonb(v)) FROM(SELECT * FROM filtered ORDER BY name,id LIMIT 25 OFFSET p_page*25)v),'[]')) INTO result;
 ELSE
   WITH filtered AS(SELECT id,lead_number,business_name,contact_name,email,phone,city,category,state,created_at FROM business_enquiries
     WHERE created_at>=p_from::timestamp AT TIME ZONE 'America/Mexico_City' AND created_at<(p_to+1)::timestamp AT TIME ZONE 'America/Mexico_City' AND concat(business_name,' ',contact_name,' ',city) ILIKE '%'||p_search||'%')
   SELECT jsonb_build_object('count',(SELECT count(*) FROM filtered),'rows',coalesce((SELECT jsonb_agg(to_jsonb(v)) FROM(SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT 25 OFFSET p_page*25)v),'[]')) INTO result;
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION public.staff_update_order(p_order uuid,p_expected text,p_status text,p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o orders;prepared boolean;
BEGIN
 IF NOT staff_can('orders.write') THEN RAISE EXCEPTION 'not_authorized';END IF;
 SELECT * INTO o FROM orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR o.status::text IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'order_changed_refresh';END IF;
 IF p_status IS NULL OR length(trim(coalesce(p_note,''))) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'reason_required';END IF;
 SELECT EXISTS(SELECT 1 FROM restaurants r JOIN app_categories c ON lower(trim(c.name))=lower(trim(r.type)) WHERE r.id=o.restaurant_id AND c.flow_type='prepared') INTO prepared;
 IF NOT((o.status='PENDING' AND p_status IN('ACCEPTED','REJECTED')) OR
   (o.status='ACCEPTED' AND p_status='PREPARING' AND prepared) OR
   (o.status IN('ACCEPTED','PREPARING') AND p_status='READY' AND prepared) OR
   (o.status='READY' AND o.delivery_type='pickup' AND p_status='DELIVERED')) THEN RAISE EXCEPTION 'use_delivery_or_picking_workflow';END IF;
 IF EXISTS(SELECT 1 FROM delivery_cycles WHERE order_id=o.id AND state<>'CLOSED') THEN RAISE EXCEPTION 'order_has_custody';END IF;
 UPDATE orders SET status=p_status::order_status,rejection_reason=CASE WHEN p_status='REJECTED' THEN trim(p_note) ELSE rejection_reason END WHERE id=o.id;
 INSERT INTO operation_audit(order_id,actor,action,details) VALUES(o.id,auth.uid(),'STAFF_STATUS_CHANGED',jsonb_build_object('from',p_expected,'to',p_status,'reason',trim(p_note)));
 INSERT INTO staff_access_audit(actor,action,details) VALUES(auth.uid(),'ORDER_UPDATED',jsonb_build_object('order_id',o.id,'from',p_expected,'to',p_status));
END $$;

-- Privileges are explicit. Never expose identity-management RPCs to PUBLIC.
DO $grants$
DECLARE item record;
BEGIN
 FOR item IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'staff\_%' ESCAPE '\' LOOP
   EXECUTE 'REVOKE ALL ON FUNCTION '||item.signature||' FROM PUBLIC,anon,authenticated';
 END LOOP;
END $grants$;
GRANT EXECUTE ON FUNCTION staff_is_owner(),staff_can(text),staff_my_access(),staff_directory(text,integer),staff_save_role(text,text,text,text[],bigint),staff_grant_existing(text,text,text),staff_update_member(uuid,text,text,boolean,bigint),staff_audit_page(integer),staff_reserve_email(text,text,text,text),staff_business_options(),staff_workspace(text,date,date,text,integer),staff_update_order(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION staff_finish_email(uuid,uuid,boolean,text),staff_account_protected(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
