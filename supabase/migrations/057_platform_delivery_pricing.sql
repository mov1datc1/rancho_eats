BEGIN;
-- Only this server-owned tariff is used for new checkouts. Restaurant coverage remains independent.
CREATE TABLE public.delivery_pricing (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 base_fee numeric NOT NULL DEFAULT 20 CHECK(base_fee BETWEEN 0 AND 10000 AND scale(base_fee)<=2),
 included_km numeric NOT NULL DEFAULT 1 CHECK(included_km>0 AND included_km<=100),
 per_km numeric NOT NULL DEFAULT 5 CHECK(per_km>0 AND per_km<=1000 AND scale(per_km)<=2),
 max_fee numeric NOT NULL DEFAULT 80 CHECK(max_fee>=base_fee AND max_fee<=10000 AND scale(max_fee)<=2),
 zones jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(zones)='array'),
 version bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO delivery_pricing(id) VALUES(true);
ALTER TABLE delivery_pricing ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON delivery_pricing FROM PUBLIC,anon,authenticated;
GRANT SELECT ON delivery_pricing TO anon,authenticated;
CREATE POLICY delivery_pricing_read ON delivery_pricing FOR SELECT USING(true);
CREATE FUNCTION public.admin_save_delivery_pricing(p_config jsonb,p_version bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c delivery_pricing;z jsonb; names text[]:='{}';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'Solo admin PideYa';END IF;
 SELECT * INTO c FROM delivery_pricing WHERE id FOR UPDATE;
 IF c.version<>p_version OR p_version IS NULL THEN RAISE EXCEPTION 'La tarifa cambió; actualiza antes de guardar';END IF;
 IF jsonb_typeof(p_config)<>'object' OR NOT(p_config ?& ARRAY['base_fee','included_km','per_km','max_fee','zones']) OR p_config IS NULL THEN RAISE EXCEPTION 'Configuración incompleta';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_config) WHERE key IN('base_fee','included_km','per_km','max_fee') AND jsonb_typeof(value)<>'number') THEN RAISE EXCEPTION 'Importes inválidos';END IF;
 IF jsonb_typeof(p_config->'zones')<>'array' OR jsonb_array_length(p_config->'zones')>100 THEN RAISE EXCEPTION 'Máximo 100 zonas';END IF;
 FOR z IN SELECT value FROM jsonb_array_elements(p_config->'zones') LOOP
  IF jsonb_typeof(z)<>'object' OR NOT(z ?& ARRAY['name','lat','lng','radius_km','fee']) OR jsonb_typeof(z->'name')<>'string' OR length(trim(z->>'name')) NOT BETWEEN 1 AND 100 OR trim(z->>'name')=ANY(names) THEN RAISE EXCEPTION 'Cada zona necesita un nombre único';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(z) WHERE key IN('lat','lng','radius_km','fee') AND jsonb_typeof(value)<>'number') THEN RAISE EXCEPTION 'Zona inválida';END IF;
  IF NOT((z->>'lat')::numeric BETWEEN 14 AND 33.5 AND (z->>'lng')::numeric BETWEEN -119 AND -86 AND (z->>'radius_km')::numeric>0 AND (z->>'radius_km')::numeric<=100 AND scale((z->>'fee')::numeric)<=2 AND (z->>'fee')::numeric BETWEEN (p_config->>'base_fee')::numeric AND (p_config->>'max_fee')::numeric) THEN RAISE EXCEPTION 'Revisa coordenadas, radio y tarifa de la zona';END IF;
  names:=array_append(names,trim(z->>'name'));
 END LOOP;
 UPDATE delivery_pricing SET base_fee=(p_config->>'base_fee')::numeric,included_km=(p_config->>'included_km')::numeric,per_km=(p_config->>'per_km')::numeric,max_fee=(p_config->>'max_fee')::numeric,zones=p_config->'zones',version=version+1,updated_at=clock_timestamp() WHERE id RETURNING * INTO c;
 INSERT INTO operation_audit(actor,action,details) VALUES(auth.uid(),'DELIVERY_PRICING_UPDATED',to_jsonb(c));
 RETURN to_jsonb(c);
END;$$;
CREATE FUNCTION public.delivery_distance_km(a float,b float,c float,d float) RETURNS float LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT 6371*2*asin(sqrt(least(1.0,power(sin(radians(c-a)/2),2)+cos(radians(a))*cos(radians(c))*power(sin(radians(d-b)/2),2))));
$$;
CREATE FUNCTION public.quote_delivery(p_restaurant uuid,p_type text,p_lat float,p_lng float) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r restaurants;c delivery_pricing;km float;z jsonb;amount numeric;zone_name text;
BEGIN
 IF p_type IS NULL OR p_type NOT IN('pickup','delivery') THEN RAISE EXCEPTION 'Tipo de entrega inválido';END IF;
 SELECT * INTO r FROM restaurants WHERE id=p_restaurant;
 IF r.id IS NULL OR NOT public.can_order_business(r.id) THEN RAISE EXCEPTION 'Negocio no disponible';END IF;
 SELECT * INTO STRICT c FROM delivery_pricing WHERE id;
 IF p_type='pickup' THEN RETURN jsonb_build_object('fee',0,'version',c.version,'distance_km',0,'zone',null);END IF;
 IF r.delivery_enabled=false THEN RAISE EXCEPTION 'Actualmente no tenemos entrega a domicilio, solo para recoger.';END IF;
 IF p_lat IS NULL OR p_lng IS NULL OR NOT(p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180) OR r.lat IS NULL OR r.lng IS NULL OR coalesce(r.delivery_radius_km,0)<=0 THEN RAISE EXCEPTION 'Ubicación de entrega inválida';END IF;
 km:=delivery_distance_km(r.lat,r.lng,p_lat,p_lng);
 IF km>r.delivery_radius_km THEN RAISE EXCEPTION 'El domicilio está fuera de cobertura';END IF;
 amount:=least(c.max_fee,c.base_fee+ceil(greatest(0,round(km::numeric,6)-c.included_km))*c.per_km);
 -- First matching zone wins, configured explicitly by admin. Coverage is always checked first.
 FOR z IN SELECT value FROM jsonb_array_elements(c.zones) LOOP
  IF delivery_distance_km((z->>'lat')::float,(z->>'lng')::float,p_lat,p_lng)<=(z->>'radius_km')::float THEN amount:=(z->>'fee')::numeric;zone_name:=z->>'name';EXIT;END IF;
 END LOOP;
 RETURN jsonb_build_object('fee',round(amount,2),'version',c.version,'distance_km',km,'zone',zone_name);
END;$$;
ALTER TABLE orders ADD COLUMN delivery_pricing_snapshot jsonb;
CREATE OR REPLACE FUNCTION public.checkout_prices() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item jsonb;extra jsonb;m menu_items;q numeric;p numeric;extras numeric;subtotal numeric:=0;fee numeric;shipping numeric;distance_km float;r restaurants;tiers jsonb;quote jsonb;
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
 -- Serialize an order's price validation with admin edits; never rewrite existing orders.
 PERFORM 1 FROM delivery_pricing WHERE id FOR SHARE;
 quote:=quote_delivery(NEW.restaurant_id,coalesce(NEW.delivery_type,'delivery'),NEW.client_lat,NEW.client_lng);
 shipping:=(quote->>'fee')::numeric;
 NEW.delivery_pricing_snapshot:=quote;
 IF NEW.subtotal IS DISTINCT FROM subtotal OR NEW.commission_amount IS DISTINCT FROM coalesce(fee,0) OR NEW.delivery_amount IS DISTINCT FROM shipping OR NEW.total IS DISTINCT FROM subtotal+coalesce(fee,0)+shipping THEN RAISE EXCEPTION 'Los precios o cargos cambiaron; revisa el carrito antes de confirmar'; END IF;
 RETURN NEW;
END;$$;

CREATE FUNCTION public.keep_order_delivery_price() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.delivery_amount IS DISTINCT FROM OLD.delivery_amount OR NEW.delivery_pricing_snapshot IS DISTINCT FROM OLD.delivery_pricing_snapshot THEN RAISE EXCEPTION 'El envío de un pedido creado no puede cambiar';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER keep_delivery_price BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION keep_order_delivery_price();
CREATE FUNCTION public.protect_legacy_delivery_fees() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF ROW(NEW.delivery_fee_0_10,NEW.delivery_fee_10_15,NEW.delivery_fee_15_20,NEW.delivery_fee_20_30) IS DISTINCT FROM ROW(OLD.delivery_fee_0_10,OLD.delivery_fee_10_15,OLD.delivery_fee_15_20,OLD.delivery_fee_20_30) THEN RAISE EXCEPTION 'Las tarifas de envío se administran en PideYa';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER protect_delivery_tariffs BEFORE UPDATE ON restaurants FOR EACH ROW EXECUTE FUNCTION protect_legacy_delivery_fees();
REVOKE ALL ON FUNCTION admin_save_delivery_pricing(jsonb,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION admin_save_delivery_pricing(jsonb,bigint) TO authenticated;
REVOKE ALL ON FUNCTION quote_delivery(uuid,text,float,float) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION quote_delivery(uuid,text,float,float) TO anon,authenticated;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE delivery_pricing;
 END IF;
END$$;
COMMIT;
