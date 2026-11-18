-- 065 · Item-level promotions managed by the business ("hook" items: 1-3 dishes at a promo price).
--
-- The business (merchant app / portal) sets on a menu item: is_promo, promo_price (< price),
-- optional promo_starts_at / promo_ends_at and optional promo_max_per_order. The client shows the
-- regular price struck through and charges promo_price; checkout_prices accepts it only while active
-- and within the per-order limit. Old app builds that send the regular price are still accepted.
-- Requires 064 (checkout_prices with offers).
BEGIN;

DO $guard$
DECLARE def text := pg_get_functiondef('public.checkout_prices()'::regprocedure);
BEGIN
  IF position('offer_block_reason' IN def) = 0 OR position('promo_price' IN def) > 0 THEN
    RAISE EXCEPTION '065: apply 064 first (checkout_prices is not the reviewed 064 version)';
  END IF;
END $guard$;

ALTER TABLE menu_items ADD COLUMN promo_price numeric(10,2);
ALTER TABLE menu_items ADD COLUMN promo_starts_at timestamptz;
ALTER TABLE menu_items ADD COLUMN promo_ends_at timestamptz;
ALTER TABLE menu_items ADD COLUMN promo_max_per_order integer;
ALTER TABLE menu_items ADD CONSTRAINT menu_items_promo_valid CHECK (
  (promo_price IS NULL OR (promo_price > 0 AND promo_price < price))
  AND (promo_max_per_order IS NULL OR promo_max_per_order BETWEEN 1 AND 50)
  AND (promo_starts_at IS NULL OR promo_ends_at IS NULL OR promo_ends_at > promo_starts_at)
);

CREATE FUNCTION public.menu_item_promo_active(m menu_items, p_now timestamptz DEFAULT now()) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
  SELECT m.is_promo AND m.promo_price IS NOT NULL AND m.available
     AND (m.promo_starts_at IS NULL OR p_now >= m.promo_starts_at)
     AND (m.promo_ends_at IS NULL OR p_now < m.promo_ends_at);
$$;
REVOKE ALL ON FUNCTION public.menu_item_promo_active(menu_items,timestamptz) FROM PUBLIC,anon,authenticated;

-- Checkout: identical to 064 except the unit-price check also accepts an active promo price
-- (with its per-order quantity limit).
CREATE OR REPLACE FUNCTION public.checkout_prices() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item jsonb;extra jsonb;m menu_items;q numeric;p numeric;extras numeric;subtotal numeric:=0;fee numeric;shipping numeric;distance_km float;r restaurants;tiers jsonb;quote jsonb;
 o marketing_offers; discount numeric:=0; reason text; promo_qty jsonb:='{}'::jsonb; used numeric;
BEGIN
 IF jsonb_typeof(NEW.items)<>'array' OR jsonb_array_length(NEW.items)=0 OR jsonb_array_length(NEW.items)>100 THEN RAISE EXCEPTION 'Carrito inválido'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.items) LOOP
  SELECT * INTO m FROM menu_items WHERE id::text=coalesce(item->>'id',item->>'menu_item_id') AND restaurant_id=NEW.restaurant_id AND available;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Un producto ya no está disponible'; END IF;
  q:=coalesce((item->>'quantity')::numeric,(item->>'qty')::numeric);p:=coalesce((item->>'price')::numeric,(item->>'unit_price')::numeric);
  IF q IS NULL OR q<=0 OR q>100 OR q::text IN('NaN','Infinity','-Infinity') OR p IS NULL OR p<0 OR p::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Cantidad o precio inválido'; END IF;
  IF menu_item_promo_active(m) AND p=m.promo_price THEN
   used:=coalesce((promo_qty->>m.id::text)::numeric,0)+q;
   IF m.promo_max_per_order IS NOT NULL AND used>m.promo_max_per_order THEN
    RAISE EXCEPTION 'Máximo % piezas de «%» en promoción por pedido',m.promo_max_per_order,m.name;
   END IF;
   promo_qty:=promo_qty||jsonb_build_object(m.id::text,used);
  ELSIF p<>m.price AND NOT EXISTS(SELECT 1 FROM menu_item_options WHERE menu_item_id=m.id AND option_type='size' AND available AND price=p) THEN
   RAISE EXCEPTION 'El precio cambió: actualiza tu carrito';
  END IF;
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
 PERFORM 1 FROM delivery_pricing WHERE id FOR SHARE;
 quote:=quote_delivery(NEW.restaurant_id,coalesce(NEW.delivery_type,'delivery'),NEW.client_lat,NEW.client_lng);
 shipping:=(quote->>'fee')::numeric;
 NEW.delivery_pricing_snapshot:=quote;
 IF NEW.offer_id IS NOT NULL THEN
  SELECT * INTO o FROM marketing_offers WHERE id=NEW.offer_id FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'La promoción ya no está disponible; revisa tu carrito'; END IF;
  reason:=offer_block_reason(o,NEW.client_user_id,NEW.restaurant_id,subtotal);
  IF reason IS NOT NULL THEN RAISE EXCEPTION 'La promoción ya no está disponible; revisa tu carrito'; END IF;
  discount:=offer_discount(o,subtotal);
 END IF;
 IF NEW.subtotal IS DISTINCT FROM subtotal OR NEW.commission_amount IS DISTINCT FROM coalesce(fee,0) OR NEW.delivery_amount IS DISTINCT FROM shipping
    OR NEW.discount_amount IS DISTINCT FROM discount OR NEW.total IS DISTINCT FROM subtotal+coalesce(fee,0)+shipping-discount THEN
  RAISE EXCEPTION 'Los precios o cargos cambiaron; revisa el carrito antes de confirmar';
 END IF;
 RETURN NEW;
END;$$;

-- Home feed: add per-business count of active promo dishes ("Promos" badge).
CREATE OR REPLACE FUNCTION public.customer_home_feed() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
  'featured',coalesce((SELECT jsonb_agg(jsonb_build_object('restaurant_id',p.restaurant_id,'label',p.label) ORDER BY p.priority DESC,p.starts_at)
     FROM business_placements p WHERE p.slot='home_featured' AND p.state='active' AND now()>=p.starts_at AND now()<p.ends_at
       AND p.restaurant_id IN (SELECT public.orderable_business_ids())),'[]'::jsonb),
  'offers',coalesce((SELECT jsonb_agg(jsonb_build_object('offer_id',o.id,'restaurant_id',o.restaurant_id,'title',o.title,'kind',o.kind,'value',o.value,
        'max_discount',o.max_discount,'min_subtotal',o.min_subtotal,'audience',o.audience,'ends_at',o.ends_at) ORDER BY o.ends_at)
     FROM marketing_offers o WHERE offer_window_open(o) AND (o.restaurant_id IS NULL OR o.restaurant_id IN (SELECT public.orderable_business_ids()))),'[]'::jsonb),
  'item_promos',coalesce((SELECT jsonb_agg(jsonb_build_object('restaurant_id',x.restaurant_id,'count',x.n,'best_saving',x.best))
     FROM (SELECT m.restaurant_id,count(*) n,max(m.price-m.promo_price) best FROM menu_items m
           WHERE menu_item_promo_active(m) AND m.restaurant_id IN (SELECT public.orderable_business_ids()) GROUP BY m.restaurant_id) x),'[]'::jsonb),
  'generated_at',now());
$$;

CREATE INDEX IF NOT EXISTS menu_items_active_promos ON menu_items(restaurant_id) WHERE is_promo AND promo_price IS NOT NULL;

COMMIT;
