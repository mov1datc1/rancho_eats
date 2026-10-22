BEGIN;
CREATE FUNCTION public.can_view_category(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) OR EXISTS(
 SELECT 1 FROM app_categories c WHERE c.id=p_id AND (
 (c.is_active AND (c.release_mode='public' OR (c.release_mode='pilot' AND EXISTS(SELECT 1 FROM category_pilots p WHERE p.category_id=c.id AND p.user_id=auth.uid()))))
 OR EXISTS(SELECT 1 FROM restaurants r WHERE r.owner_id=auth.uid() AND lower(trim(r.type))=lower(trim(c.name)))
 ));
$$;
DROP POLICY categories_select_public ON app_categories;
CREATE POLICY categories_select_public ON app_categories FOR SELECT USING(public.can_view_category(id));
CREATE FUNCTION public.audit_category_release() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.release_mode IS DISTINCT FROM OLD.release_mode OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
 INSERT INTO operation_audit(actor,action,details) VALUES(auth.uid(),'CATEGORY_RELEASE',jsonb_build_object('category_id',NEW.id,'name',NEW.name,'old_mode',OLD.release_mode,'new_mode',NEW.release_mode,'active',NEW.is_active));
 END IF; RETURN NEW;
END;$$;
CREATE TRIGGER operations_category_release AFTER UPDATE ON app_categories FOR EACH ROW EXECUTE FUNCTION audit_category_release();
CREATE POLICY audit_platform_admin ON operation_audit FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()));
COMMIT;
