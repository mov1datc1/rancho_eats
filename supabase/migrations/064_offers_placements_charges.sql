-- 064 · Advertising v1: offers (discounts), featured placements and a charges ledger.
--
-- Modeled on how delivery marketplaces sell marketing to businesses:
--   * Offers: % or fixed discount, funded by the business (or by PideYa), targeted to all / new / lapsed
--     customers, with date range, weekday + hour window (America/Mexico_City), per-user limit,
--     max redemptions and budget. Validated server-side at checkout; the client never decides the price.
--   * Featured placements: paid "Destacado" slot on the client home for a date range.
--   * Charges: what PideYa bills the business for placements, offers and sponsored push campaigns.
--
-- Backward compatible: old app builds send no offer_id, discount_amount defaults to 0 and checkout
-- validation is identical for them. v1 offers only apply to 'prepared' (restaurant) businesses because
-- the grocery picking flow recomputes totals from (total - subtotal).
BEGIN;

-- Refuse to replace checkout_prices unless it is the reviewed 057 version.
DO $guard$
DECLARE def text := pg_get_functiondef('public.checkout_prices()'::regprocedure);
BEGIN
  IF position('delivery_pricing_snapshot:=quote' IN def) = 0 OR position('offer' IN def) > 0 THEN
    RAISE EXCEPTION '064: checkout_prices differs from the reviewed 057 version; review before applying';
  END IF;
END $guard$;

CREATE TABLE public.marketing_offers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 restaurant_id uuid REFERENCES restaurants(id) ON DELETE CASCADE,      -- NULL = PideYa-wide offer
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 3 AND 60),
 kind text NOT NULL CHECK(kind IN('percent','amount')),
 value numeric NOT NULL CHECK(value>0),
 max_discount numeric CHECK(max_discount IS NULL OR max_discount>0),
 min_subtotal numeric NOT NULL DEFAULT 0 CHECK(min_subtotal>=0),
 audience text NOT NULL DEFAULT 'all' CHECK(audience IN('all','new','lapsed')),
 lapsed_days integer NOT NULL DEFAULT 30 CHECK(lapsed_days BETWEEN 7 AND 365),
 funded_by text NOT NULL DEFAULT 'business' CHECK(funded_by IN('business','platform')),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 days_of_week smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',            -- 0 = Sunday, Mexico City
 start_time time, end_time time,                                         -- optional daily window
 per_user_limit integer NOT NULL DEFAULT 1 CHECK(per_user_limit BETWEEN 1 AND 100),
 max_redemptions integer CHECK(max_redemptions IS NULL OR max_redemptions>0),
 budget numeric CHECK(budget IS NULL OR budget>0),
 fee numeric NOT NULL DEFAULT 0 CHECK(fee BETWEEN 0 AND 1000000),        -- PideYa's charge to the business
 state text NOT NULL DEFAULT 'active' CHECK(state IN('active','paused','cancelled')),
 created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at>starts_at),
 CHECK(kind<>'percent' OR value<=90),
 CHECK(funded_by='platform' OR restaurant_id IS NOT NULL),
 CHECK((start_time IS NULL)=(end_time IS NULL)),
 CHECK(days_of_week <@ '{0,1,2,3,4,5,6}'::smallint[] AND cardinality(days_of_week)>0)
);
CREATE INDEX marketing_offers_live ON marketing_offers(restaurant_id,ends_at) WHERE state='active';

CREATE TABLE public.business_placements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
 slot text NOT NULL DEFAULT 'home_featured' CHECK(slot IN('home_featured')),
 label text NOT NULL DEFAULT 'Destacado' CHECK(length(trim(label)) BETWEEN 3 AND 30),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 priority integer NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 100),
 price numeric NOT NULL DEFAULT 0 CHECK(price BETWEEN 0 AND 1000000),
 state text NOT NULL DEFAULT 'active' CHECK(state IN('active','cancelled')),
 created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at>starts_at)
);
CREATE INDEX business_placements_live ON business_placements(slot,ends_at) WHERE state='active';

CREATE TABLE public.marketing_charges(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
 source text NOT NULL CHECK(source IN('campaign','placement','offer')),
 source_id uuid NOT NULL,
 description text NOT NULL,
 amount numeric NOT NULL CHECK(amount>0),
 due_on date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Mexico_City')::date,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','paid','cancelled')),
 paid_at timestamptz, paid_reference text, paid_by uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source,source_id)
);
CREATE INDEX marketing_charges_business ON marketing_charges(restaurant_id,state,due_on);

ALTER TABLE orders ADD COLUMN offer_id uuid REFERENCES marketing_offers(id);
ALTER TABLE orders ADD COLUMN discount_amount numeric NOT NULL DEFAULT 0 CHECK(discount_amount>=0);
CREATE INDEX orders_offer_redemptions ON orders(offer_id,client_user_id) WHERE offer_id IS NOT NULL;

-- RLS: no direct public access; admins read everything, business owners read their own rows.
ALTER TABLE marketing_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY offers_admin_read ON marketing_offers FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM admin_profiles WHERE id=(SELECT auth.uid())));
CREATE POLICY offers_owner_read ON marketing_offers FOR SELECT TO authenticated USING(restaurant_id IN(SELECT id FROM restaurants WHERE owner_id=(SELECT auth.uid())));
CREATE POLICY placements_admin_read ON business_placements FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM admin_profiles WHERE id=(SELECT auth.uid())));
CREATE POLICY placements_owner_read ON business_placements FOR SELECT TO authenticated USING(restaurant_id IN(SELECT id FROM restaurants WHERE owner_id=(SELECT auth.uid())));
CREATE POLICY charges_admin_read ON marketing_charges FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM admin_profiles WHERE id=(SELECT auth.uid())));
CREATE POLICY charges_owner_read ON marketing_charges FOR SELECT TO authenticated USING(restaurant_id IN(SELECT id FROM restaurants WHERE owner_id=(SELECT auth.uid())));
GRANT SELECT ON marketing_offers,business_placements,marketing_charges TO authenticated;

-- ── Offer rules ─────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.offer_window_open(o marketing_offers,p_now timestamptz DEFAULT now()) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT o.state='active' AND p_now>=o.starts_at AND p_now<o.ends_at
  AND extract(dow FROM p_now AT TIME ZONE 'America/Mexico_City')::smallint = ANY(o.days_of_week)
  AND (o.start_time IS NULL OR (
       CASE WHEN o.start_time<=o.end_time
            THEN (p_now AT TIME ZONE 'America/Mexico_City')::time >= o.start_time AND (p_now AT TIME ZONE 'America/Mexico_City')::time < o.end_time
            ELSE (p_now AT TIME ZONE 'America/Mexico_City')::time >= o.start_time OR (p_now AT TIME ZONE 'America/Mexico_City')::time < o.end_time END));
$$;

-- Discount for a subtotal (0 when below the minimum). Never more than the subtotal.
CREATE FUNCTION public.offer_discount(o marketing_offers,p_subtotal numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN p_subtotal IS NULL OR p_subtotal<=0 OR p_subtotal<o.min_subtotal THEN 0
   ELSE least(p_subtotal,
          CASE WHEN o.kind='percent' THEN least(round(p_subtotal*o.value/100,2),coalesce(o.max_discount,p_subtotal))
               ELSE o.value END) END;
$$;

-- Why an offer cannot be used by this customer now (NULL = usable).
CREATE FUNCTION public.offer_block_reason(o marketing_offers,p_user uuid,p_restaurant uuid,p_subtotal numeric) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE delivered integer; last_purchase timestamptz; used integer; spent numeric; redeemed integer; flow text;
BEGIN
 IF NOT offer_window_open(o) THEN RETURN 'closed'; END IF;
 IF o.restaurant_id IS NOT NULL AND o.restaurant_id<>p_restaurant THEN RETURN 'other_business'; END IF;
 SELECT c.flow_type INTO flow FROM restaurants r JOIN app_categories c ON lower(trim(c.name))=lower(trim(r.type)) WHERE r.id=p_restaurant;
 IF coalesce(flow,'prepared')<>'prepared' THEN RETURN 'picking_flow'; END IF;
 IF p_user IS NULL THEN RETURN 'login'; END IF;
 IF p_subtotal<o.min_subtotal THEN RETURN 'min_subtotal'; END IF;
 SELECT count(*),max(coalesce(delivered_at,created_at)) INTO delivered,last_purchase FROM orders
  WHERE client_user_id=p_user AND status='DELIVERED' AND (o.restaurant_id IS NULL OR restaurant_id=o.restaurant_id);
 IF o.audience='new' AND delivered>0 THEN RETURN 'audience'; END IF;
 IF o.audience='lapsed' AND (delivered=0 OR last_purchase>now()-make_interval(days=>o.lapsed_days)) THEN RETURN 'audience'; END IF;
 SELECT count(*) INTO used FROM orders WHERE offer_id=o.id AND client_user_id=p_user AND status NOT IN('REJECTED','CANCELLED');
 IF used>=o.per_user_limit THEN RETURN 'used'; END IF;
 IF o.max_redemptions IS NOT NULL OR o.budget IS NOT NULL THEN
  SELECT count(*),coalesce(sum(discount_amount),0) INTO redeemed,spent FROM orders WHERE offer_id=o.id AND status NOT IN('REJECTED','CANCELLED');
  IF o.max_redemptions IS NOT NULL AND redeemed>=o.max_redemptions THEN RETURN 'sold_out'; END IF;
  IF o.budget IS NOT NULL AND spent+offer_discount(o,p_subtotal)>o.budget THEN RETURN 'budget'; END IF;
 END IF;
 RETURN NULL;
END $$;

-- Best usable offer for the signed-in customer at this business and subtotal.
CREATE FUNCTION public.quote_offer(p_restaurant uuid,p_subtotal numeric) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o marketing_offers; best marketing_offers; best_amount numeric:=0; d numeric;
BEGIN
 IF p_restaurant IS NULL OR NOT can_order_business(p_restaurant) THEN RETURN NULL; END IF;
 FOR o IN SELECT * FROM marketing_offers WHERE state='active' AND (restaurant_id=p_restaurant OR restaurant_id IS NULL) AND now()<ends_at LOOP
  IF offer_block_reason(o,(SELECT auth.uid()),p_restaurant,p_subtotal) IS NULL THEN
   d:=offer_discount(o,p_subtotal);
   IF d>best_amount THEN best:=o;best_amount:=d; END IF;
  END IF;
 END LOOP;
 IF best.id IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('offer_id',best.id,'title',best.title,'discount',best_amount,'funded_by',best.funded_by);
END $$;

-- One cacheable call for the client home: featured businesses + live offer badges.
CREATE FUNCTION public.customer_home_feed() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
  'featured',coalesce((SELECT jsonb_agg(jsonb_build_object('restaurant_id',p.restaurant_id,'label',p.label) ORDER BY p.priority DESC,p.starts_at)
     FROM business_placements p WHERE p.slot='home_featured' AND p.state='active' AND now()>=p.starts_at AND now()<p.ends_at
       AND p.restaurant_id IN (SELECT public.orderable_business_ids())),'[]'::jsonb),
  'offers',coalesce((SELECT jsonb_agg(jsonb_build_object('offer_id',o.id,'restaurant_id',o.restaurant_id,'title',o.title,'kind',o.kind,'value',o.value,
        'max_discount',o.max_discount,'min_subtotal',o.min_subtotal,'audience',o.audience,'ends_at',o.ends_at) ORDER BY o.ends_at)
     FROM marketing_offers o WHERE offer_window_open(o) AND (o.restaurant_id IS NULL OR o.restaurant_id IN (SELECT public.orderable_business_ids()))),'[]'::jsonb),
  'generated_at',now());
$$;

-- ── Checkout: same validation as 057 plus an optional server-validated discount ─────────────
CREATE OR REPLACE FUNCTION public.checkout_prices() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item jsonb;extra jsonb;m menu_items;q numeric;p numeric;extras numeric;subtotal numeric:=0;fee numeric;shipping numeric;distance_km float;r restaurants;tiers jsonb;quote jsonb;
 o marketing_offers; discount numeric:=0; reason text;
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
 IF NEW.offer_id IS NOT NULL THEN
  -- Row lock serializes redemptions of the same offer so budget/limits cannot be overrun.
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

-- Discount fields are immutable after creation (only cancellation flows zero totals).
CREATE FUNCTION public.keep_order_offer() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.offer_id IS DISTINCT FROM OLD.offer_id OR (NEW.discount_amount IS DISTINCT FROM OLD.discount_amount AND NEW.status<>'CANCELLED') THEN
  RAISE EXCEPTION 'La promoción del pedido no se puede modificar';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER keep_order_offer BEFORE UPDATE OF offer_id,discount_amount ON orders FOR EACH ROW EXECUTE FUNCTION keep_order_offer();

-- ── Admin RPCs ──────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.admin_assert() RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'not_authorized'; END IF; END $$;

CREATE FUNCTION public.admin_save_offer(p jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result uuid; o marketing_offers; flow text;
BEGIN
 PERFORM admin_assert();
 IF nullif(p->>'restaurant_id','') IS NOT NULL THEN
  SELECT c.flow_type INTO flow FROM restaurants r JOIN app_categories c ON lower(trim(c.name))=lower(trim(r.type)) WHERE r.id=(p->>'restaurant_id')::uuid;
  IF coalesce(flow,'prepared')<>'prepared' THEN RAISE EXCEPTION 'Las ofertas v1 solo aplican a negocios de comida preparada'; END IF;
 END IF;
 INSERT INTO marketing_offers(restaurant_id,title,kind,value,max_discount,min_subtotal,audience,lapsed_days,funded_by,starts_at,ends_at,days_of_week,start_time,end_time,per_user_limit,max_redemptions,budget,fee)
 VALUES(nullif(p->>'restaurant_id','')::uuid,trim(p->>'title'),p->>'kind',(p->>'value')::numeric,nullif(p->>'max_discount','')::numeric,coalesce(nullif(p->>'min_subtotal','')::numeric,0),
  coalesce(p->>'audience','all'),coalesce(nullif(p->>'lapsed_days','')::integer,30),coalesce(p->>'funded_by','business'),(p->>'starts_at')::timestamptz,(p->>'ends_at')::timestamptz,
  coalesce((SELECT array_agg(x::smallint) FROM jsonb_array_elements_text(p->'days_of_week') x),'{0,1,2,3,4,5,6}'),nullif(p->>'start_time','')::time,nullif(p->>'end_time','')::time,
  coalesce(nullif(p->>'per_user_limit','')::integer,1),nullif(p->>'max_redemptions','')::integer,nullif(p->>'budget','')::numeric,coalesce(nullif(p->>'fee','')::numeric,0))
 RETURNING * INTO o;
 IF o.fee>0 AND o.restaurant_id IS NOT NULL THEN
  INSERT INTO marketing_charges(restaurant_id,source,source_id,description,amount) VALUES(o.restaurant_id,'offer',o.id,'Oferta: '||o.title,o.fee);
 END IF;
 INSERT INTO operation_audit(actor,action,details) VALUES(auth.uid(),'OFFER_CREATED',jsonb_build_object('offer_id',o.id,'fee',o.fee));
 RETURN o.id;
END $$;

CREATE FUNCTION public.admin_set_offer_state(p_id uuid,p_state text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM admin_assert();
 IF p_state NOT IN('active','paused','cancelled') THEN RAISE EXCEPTION 'Estado inválido'; END IF;
 UPDATE marketing_offers SET state=p_state WHERE id=p_id AND state<>'cancelled';
 IF p_state='cancelled' THEN UPDATE marketing_charges SET state='cancelled' WHERE source='offer' AND source_id=p_id AND state='pending'; END IF;
 INSERT INTO operation_audit(actor,action,details) VALUES(auth.uid(),'OFFER_STATE',jsonb_build_object('offer_id',p_id,'state',p_state));
END $$;

CREATE FUNCTION public.admin_save_placement(p_restaurant uuid,p_label text,p_starts timestamptz,p_ends timestamptz,p_priority integer,p_price numeric) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE pl business_placements;
BEGIN
 PERFORM admin_assert();
 INSERT INTO business_placements(restaurant_id,label,starts_at,ends_at,priority,price) VALUES(p_restaurant,coalesce(nullif(trim(p_label),''),'Destacado'),p_starts,p_ends,coalesce(p_priority,0),coalesce(p_price,0)) RETURNING * INTO pl;
 IF pl.price>0 THEN INSERT INTO marketing_charges(restaurant_id,source,source_id,description,amount) VALUES(pl.restaurant_id,'placement',pl.id,'Destacado en inicio',pl.price); END IF;
 INSERT INTO operation_audit(actor,action,details) VALUES(auth.uid(),'PLACEMENT_CREATED',jsonb_build_object('placement_id',pl.id,'price',pl.price));
 RETURN pl.id;
END $$;

CREATE FUNCTION public.admin_cancel_placement(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM admin_assert();
 UPDATE business_placements SET state='cancelled' WHERE id=p_id;
 UPDATE marketing_charges SET state='cancelled' WHERE source='placement' AND source_id=p_id AND state='pending';
 INSERT INTO operation_audit(actor,action,details) VALUES(auth.uid(),'PLACEMENT_CANCELLED',jsonb_build_object('placement_id',p_id));
END $$;

CREATE FUNCTION public.admin_mark_charge_paid(p_id uuid,p_reference text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM admin_assert();
 IF length(trim(coalesce(p_reference,'')))<3 THEN RAISE EXCEPTION 'Escribe la referencia del pago'; END IF;
 UPDATE marketing_charges SET state='paid',paid_at=now(),paid_reference=trim(p_reference),paid_by=auth.uid() WHERE id=p_id AND state='pending';
 IF NOT FOUND THEN RAISE EXCEPTION 'El cargo no está pendiente'; END IF;
 INSERT INTO operation_audit(actor,action,details) VALUES(auth.uid(),'MARKETING_CHARGE_PAID',jsonb_build_object('charge_id',p_id));
END $$;

-- Reporting: redemptions, discount given and delivered sales per offer.
CREATE FUNCTION public.admin_marketing_overview() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM admin_assert();
 RETURN jsonb_build_object(
  'offers',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (
    SELECT o.*,r.name business,
     (SELECT count(*) FROM orders WHERE offer_id=o.id AND status NOT IN('REJECTED','CANCELLED')) redemptions,
     (SELECT coalesce(sum(discount_amount),0) FROM orders WHERE offer_id=o.id AND status NOT IN('REJECTED','CANCELLED')) discount_given,
     (SELECT coalesce(sum(subtotal),0) FROM orders WHERE offer_id=o.id AND status='DELIVERED') delivered_sales
    FROM marketing_offers o LEFT JOIN restaurants r ON r.id=o.restaurant_id ORDER BY o.created_at DESC LIMIT 200) x),'[]'::jsonb),
  'placements',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.starts_at DESC) FROM (
    SELECT p.*,r.name business FROM business_placements p JOIN restaurants r ON r.id=p.restaurant_id ORDER BY p.starts_at DESC LIMIT 200) x),'[]'::jsonb),
  'charges',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (
    SELECT c.*,r.name business FROM marketing_charges c JOIN restaurants r ON r.id=c.restaurant_id ORDER BY c.created_at DESC LIMIT 300) x),'[]'::jsonb));
END $$;

-- Sponsored push campaigns (existing sponsor_fee) now generate a charge; cancelling a campaign cancels it.
CREATE FUNCTION public.campaign_charge_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.restaurant_id IS NOT NULL AND NEW.sponsor_fee>0 THEN
  INSERT INTO marketing_charges(restaurant_id,source,source_id,description,amount)
  VALUES(NEW.restaurant_id,'campaign',NEW.id,'Campaña push: '||NEW.title,NEW.sponsor_fee)
  ON CONFLICT(source,source_id) DO UPDATE SET amount=EXCLUDED.amount,restaurant_id=EXCLUDED.restaurant_id WHERE marketing_charges.state='pending';
 END IF;
 IF NEW.state='cancelled' THEN UPDATE marketing_charges SET state='cancelled' WHERE source='campaign' AND source_id=NEW.id AND state='pending'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER campaign_charge_sync AFTER INSERT OR UPDATE OF sponsor_fee,restaurant_id,state ON marketing_campaigns FOR EACH ROW EXECUTE FUNCTION campaign_charge_sync();

-- Privileges
REVOKE ALL ON FUNCTION offer_window_open(marketing_offers,timestamptz),offer_discount(marketing_offers,numeric),offer_block_reason(marketing_offers,uuid,uuid,numeric),
 keep_order_offer(),campaign_charge_sync(),admin_assert() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION quote_offer(uuid,numeric),customer_home_feed(),admin_save_offer(jsonb),admin_set_offer_state(uuid,text),
 admin_save_placement(uuid,text,timestamptz,timestamptz,integer,numeric),admin_cancel_placement(uuid),admin_mark_charge_paid(uuid,text),admin_marketing_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION quote_offer(uuid,numeric),customer_home_feed() TO anon,authenticated;
GRANT EXECUTE ON FUNCTION admin_save_offer(jsonb),admin_set_offer_state(uuid,text),admin_save_placement(uuid,text,timestamptz,timestamptz,integer,numeric),
 admin_cancel_placement(uuid),admin_mark_charge_paid(uuid,text),admin_marketing_overview() TO authenticated;

COMMIT;
