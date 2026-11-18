-- 066 · Server-side input hardening (security review 2026-11-17).
--
-- * Order items: the stored item name came from the client JSON (only id/price were validated), so a
--   customer could spoof what the kitchen sees/prints. Names are now rewritten from menu_items
--   (plus the size label when a size price was used), notes are trimmed, stripped of control
--   characters and limited to 200 chars, and option labels come from menu_item_options.
-- * Free-text length limits on orders and catalog text. Constraints are NOT VALID so existing rows
--   are untouched; every new insert/update is checked.
-- Runs after price validation (trigger name sorts after 'operations_prices').
BEGIN;

CREATE FUNCTION public.clean_text(p text, p_max integer) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
  SELECT nullif(left(btrim(regexp_replace(coalesce(p,''), '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')), p_max), '');
$$;
REVOKE ALL ON FUNCTION public.clean_text(text,integer) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.order_items_canonical() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item jsonb; extra jsonb; m menu_items; size_label text; p numeric; out_items jsonb:='[]'::jsonb; out_extras jsonb;
BEGIN
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.items) LOOP
  SELECT * INTO m FROM menu_items WHERE id::text=coalesce(item->>'id',item->>'menu_item_id') AND restaurant_id=NEW.restaurant_id;
  p:=coalesce((item->>'price')::numeric,(item->>'unit_price')::numeric);
  size_label:=NULL;
  IF p IS DISTINCT FROM m.price AND p IS DISTINCT FROM m.promo_price THEN
   SELECT label INTO size_label FROM menu_item_options WHERE menu_item_id=m.id AND option_type='size' AND price=p ORDER BY sort_order LIMIT 1;
  END IF;
  out_extras:='[]'::jsonb;
  FOR extra IN SELECT value FROM jsonb_array_elements(coalesce(item->'options','[]')) LOOP
   out_extras:=out_extras||jsonb_build_array(jsonb_build_object('label',clean_text(extra->>'label',80),'price',(extra->>'price')::numeric));
  END LOOP;
  item:=item||jsonb_build_object('name', m.name||coalesce(' ('||size_label||')',''))
             ||jsonb_build_object('notes', clean_text(item->>'notes',200));
  IF jsonb_array_length(out_extras)>0 THEN item:=item||jsonb_build_object('options',out_extras); END IF;
  out_items:=out_items||jsonb_build_array(item);
 END LOOP;
 NEW.items:=out_items;
 NEW.client_name:=clean_text(NEW.client_name,80);
 NEW.client_location_note:=clean_text(NEW.client_location_note,500);
 IF length(coalesce(NEW.client_phone,''))>20 THEN RAISE EXCEPTION 'Teléfono inválido'; END IF;
 IF pg_column_size(NEW.items)>65536 THEN RAISE EXCEPTION 'Carrito demasiado grande'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.order_items_canonical() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zz_order_items_canonical BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION order_items_canonical();

-- Orders: limits enforced by the insert trigger only (a CHECK would also block status updates of legacy rows).
ALTER TABLE menu_items ADD CONSTRAINT menu_items_text_limits CHECK (
  length(name) <= 120 AND length(coalesce(description,'')) <= 600 AND length(category) <= 60
  AND length(coalesce(promo_description,'')) <= 120
) NOT VALID;
ALTER TABLE menu_item_options ADD CONSTRAINT menu_item_options_text_limits CHECK (length(label) <= 80) NOT VALID;
ALTER TABLE restaurants ADD CONSTRAINT restaurants_text_limits CHECK (
  length(name) <= 100 AND length(coalesce(description,'')) <= 600 AND length(coalesce(address,'')) <= 300
  AND length(coalesce(pickup_instructions,'')) <= 500 AND length(coalesce(phone,'')) <= 20
) NOT VALID;

COMMIT;
