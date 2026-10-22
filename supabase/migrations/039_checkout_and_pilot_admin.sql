BEGIN;
CREATE OR REPLACE FUNCTION public.admin_pilot_member(p_category uuid,p_restaurant uuid,p_email text,p_enabled boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'Solo admin PideYa'; END IF;
 SELECT id INTO u FROM auth.users WHERE lower(email)=lower(trim(p_email));
 IF u IS NULL THEN RAISE EXCEPTION 'El comprador debe tener una cuenta registrada con ese correo'; END IF;
 IF NOT EXISTS(SELECT 1 FROM restaurants r JOIN app_categories c ON lower(trim(r.type))=lower(trim(c.name)) WHERE r.id=p_restaurant AND c.id=p_category) THEN RAISE EXCEPTION 'El negocio no pertenece a esta categoría'; END IF;
 IF p_enabled THEN INSERT INTO category_pilots VALUES(p_category,p_restaurant,u) ON CONFLICT DO NOTHING;
 ELSE DELETE FROM category_pilots WHERE category_id=p_category AND restaurant_id=p_restaurant AND user_id=u; END IF;
 INSERT INTO operation_audit(actor,action,details) VALUES(auth.uid(),'PILOT_ACCESS',jsonb_build_object('category',p_category,'business',p_restaurant,'user',u,'enabled',p_enabled));
END;$$;
CREATE OR REPLACE FUNCTION public.checkout_prices() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item jsonb;extra jsonb;m menu_items;q numeric;p numeric;extras numeric;subtotal numeric:=0;fee numeric;shipping numeric;distance_km float;r restaurants;tiers jsonb;
BEGIN
 IF jsonb_typeof(NEW.items)<>'array' OR jsonb_array_length(NEW.items)=0 OR jsonb_array_length(NEW.items)>100 THEN RAISE EXCEPTION 'Carrito inválido'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.items) LOOP
  SELECT * INTO m FROM menu_items WHERE id::text=coalesce(item->>'id',item->>'menu_item_id') AND restaurant_id=NEW.restaurant_id AND available;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Un producto ya no está disponible'; END IF;
  q:=coalesce((item->>'quantity')::numeric,(item->>'qty')::numeric);p:=coalesce((item->>'price')::numeric,(item->>'unit_price')::numeric);
  IF q IS NULL OR q<=0 OR q>100 OR q::text IN('NaN','Infinity','-Infinity') OR p IS NULL OR p<0 OR p::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Cantidad o precio inválido'; END IF;
  IF p<>m.price AND NOT EXISTS(SELECT 1 FROM menu_item_options WHERE menu_item_id=m.id AND option_type='size' AND available AND price=p) THEN RAISE EXCEPTION 'El precio cambió: actualiza tu carrito'; END IF;
  extras:=0;
  FOR extra IN SELECT value FROM jsonb_array_elements(coalesce(item->'options','[]')) LOOP
   IF NOT EXISTS(SELECT 1 FROM menu_item_options WHERE menu_item_id=m.id AND option_type='extra' AND available AND label=extra->>'label' AND price=(extra->>'price')::numeric) THEN RAISE EXCEPTION 'Extra no disponible o precio cambiado'; END IF;
   extras:=extras+(extra->>'price')::numeric;
  END LOOP;
  subtotal:=subtotal+round(q*(p+extras),2);
 END LOOP;
 SELECT value->'commission_tiers' INTO tiers FROM app_settings WHERE setting_key='commission_config';
 IF tiers IS NULL OR jsonb_array_length(tiers)=0 THEN tiers:='[{"up_to":100,"fee":8},{"up_to":150,"fee":10},{"up_to":200,"fee":12},{"up_to":300,"fee":15},{"up_to":500,"fee":18},{"up_to":null,"fee":20}]'; END IF;
 SELECT round((value->>'fee')::numeric) INTO fee FROM jsonb_array_elements(tiers) WHERE value->>'up_to' IS NULL OR subtotal<=(value->>'up_to')::numeric ORDER BY (value->>'up_to')::numeric NULLS LAST LIMIT 1;
 SELECT * INTO r FROM restaurants WHERE id=NEW.restaurant_id;
 shipping:=0;
 IF coalesce(NEW.delivery_type,'delivery')='delivery' THEN
  distance_km:=6371*2*asin(sqrt(least(1.0,power(sin(radians(NEW.client_lat-r.lat)/2),2)+cos(radians(r.lat))*cos(radians(NEW.client_lat))*power(sin(radians(NEW.client_lng-r.lng)/2),2))));
  shipping:=coalesce(CASE WHEN distance_km<=10 THEN r.delivery_fee_0_10 WHEN distance_km<=15 THEN r.delivery_fee_10_15 WHEN distance_km<=20 THEN r.delivery_fee_15_20 ELSE r.delivery_fee_20_30 END,0);
 END IF;
 IF NEW.subtotal IS DISTINCT FROM subtotal OR NEW.commission_amount IS DISTINCT FROM coalesce(fee,0) OR NEW.delivery_amount IS DISTINCT FROM shipping OR NEW.total IS DISTINCT FROM subtotal+coalesce(fee,0)+shipping THEN RAISE EXCEPTION 'Los precios o cargos cambiaron; revisa el carrito antes de confirmar'; END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER operations_prices BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION checkout_prices();
CREATE OR REPLACE FUNCTION public.notify_time_proposal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.proposal_expires_at IS NOT NULL AND OLD.proposal_expires_at IS NULL THEN
  PERFORM enqueue_order_notice(NEW.id,NEW.notification_revision,'client',NEW.client_user_id,NULL,'order.time_proposal','El negocio propone otra hora','Abre PideYa para aceptar el horario o cancelar.');
  UPDATE notification_events SET expires_at=NEW.proposal_expires_at WHERE order_id=NEW.id AND kind='order.time_proposal';
 END IF; RETURN NEW;
END;$$;
CREATE TRIGGER operations_time_notice AFTER UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION notify_time_proposal();
REVOKE ALL ON FUNCTION admin_pilot_member(uuid,uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION admin_pilot_member(uuid,uuid,text,boolean) TO authenticated;
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='app_settings' AND cmd<>'SELECT' LOOP EXECUTE format('DROP POLICY %I ON app_settings',p.policyname);END LOOP;END;$$;
CREATE POLICY settings_admin_write ON app_settings FOR ALL TO authenticated USING(EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid())) WITH CHECK(EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()));
-- Gate discovery too, including older clients using direct table queries.
DROP POLICY IF EXISTS restaurants_select_public ON restaurants;
CREATE POLICY restaurants_select_public ON restaurants FOR SELECT USING(public.can_order_business(id));

COMMIT;
