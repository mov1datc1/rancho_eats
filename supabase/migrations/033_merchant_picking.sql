-- Merchant picking operations: ownership checks and one lock per order.
-- Deploy before PideYa Negocios 1.3.0. Existing records are not rewritten.
BEGIN;
CREATE OR REPLACE FUNCTION public.merchant_start_picking(p_order_id uuid)
RETURNS SETOF public.order_picking_items LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.orders; item jsonb; q numeric; price numeric; product uuid;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.restaurants r WHERE r.id=o.restaurant_id AND r.owner_id=auth.uid()) THEN RAISE EXCEPTION 'Pedido no autorizado'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.restaurants r WHERE r.id=o.restaurant_id AND lower(trim(r.type)) IN ('tiendas','frutería','carnicería','cremería','pescadería','farmacia')) THEN RAISE EXCEPTION 'Este negocio no usa surtido'; END IF;
 IF o.status NOT IN ('ACCEPTED','PICKING') THEN RAISE EXCEPTION 'El pedido cambió de estado'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.order_picking_items WHERE order_id=o.id) THEN
  IF jsonb_typeof(o.items::jsonb)<>'array' OR jsonb_array_length(o.items::jsonb)=0 THEN RAISE EXCEPTION 'Pedido sin productos'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(o.items::jsonb) LOOP
   q:=coalesce((item->>'qty')::numeric,(item->>'quantity')::numeric,1);
   price:=coalesce((item->>'unit_price')::numeric,(item->>'price')::numeric,0);
   IF q<=0 OR price<0 OR q::text IN ('NaN','Infinity','-Infinity') OR price::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Cantidad o precio inválido'; END IF;
   product:=NULL;
   SELECT id INTO product FROM public.menu_items WHERE id::text=coalesce(item->>'menu_item_id',item->>'id') AND restaurant_id=o.restaurant_id;
   INSERT INTO public.order_picking_items(order_id,menu_item_id,requested_name,requested_quantity,requested_unit,requested_price)
   VALUES(o.id,product,coalesce(item->>'name','Producto'),q,coalesce(item->>'unit_type','unit'),round(q*price,2));
  END LOOP;
 END IF;
 UPDATE public.orders SET status='PICKING',picking_started_at=coalesce(picking_started_at,now()) WHERE id=o.id;
 RETURN QUERY SELECT * FROM public.order_picking_items WHERE order_id=o.id ORDER BY created_at,id;
END; $$;
CREATE OR REPLACE FUNCTION public.merchant_pick_item(p_item_id uuid,p_status text,p_quantity numeric DEFAULT NULL,p_substitute text DEFAULT NULL,p_substitute_price numeric DEFAULT NULL)
RETURNS public.order_picking_items LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.orders; i public.order_picking_items; category text; amount numeric; qty numeric;
BEGIN
 SELECT * INTO i FROM public.order_picking_items WHERE id=p_item_id;
 SELECT * INTO o FROM public.orders WHERE id=i.order_id FOR UPDATE;
 IF o.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.restaurants r WHERE r.id=o.restaurant_id AND r.owner_id=auth.uid()) THEN RAISE EXCEPTION 'Pedido no autorizado'; END IF;
 SELECT * INTO i FROM public.order_picking_items WHERE id=p_item_id FOR UPDATE;
 IF o.status<>'PICKING' OR i.status<>'PENDING' THEN RAISE EXCEPTION 'El producto o pedido ya cambió'; END IF;
 IF p_status='PICKED' THEN qty:=i.requested_quantity;amount:=i.requested_price;
 ELSIF p_status='ADJUSTED' THEN
  IF p_quantity IS NULL OR p_quantity<=0 OR p_quantity>=i.requested_quantity OR p_quantity::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  qty:=p_quantity;amount:=round(i.requested_price*qty/i.requested_quantity,2);
 ELSIF p_status='UNAVAILABLE' THEN qty:=0;amount:=0;
 ELSIF p_status='SUBSTITUTED' THEN
  SELECT lower(r.type) INTO category FROM public.restaurants r WHERE r.id=o.restaurant_id;
  IF category='farmacia' OR coalesce(o.picking_preferences->>'on_unavailable','substitute')<>'substitute' THEN RAISE EXCEPTION 'Este pedido no admite sustituciones'; END IF;
  IF EXISTS(SELECT 1 FROM public.menu_items m WHERE m.id=i.menu_item_id AND m.allow_substitution=false) THEN RAISE EXCEPTION 'Este producto no admite sustituciones'; END IF;
  IF nullif(trim(p_substitute),'') IS NULL OR p_substitute_price IS NULL OR p_substitute_price<0 OR p_substitute_price::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Sustituto inválido'; END IF;
  qty:=i.requested_quantity;amount:=round(p_substitute_price,2);
 ELSE RAISE EXCEPTION 'Acción inválida'; END IF;
 UPDATE public.order_picking_items SET status=p_status,picked_quantity=qty,picked_price=amount,picked_at=now(),
 substitute_name=CASE WHEN p_status='SUBSTITUTED' THEN trim(p_substitute) END,
 substitute_price=CASE WHEN p_status='SUBSTITUTED' THEN amount END WHERE id=i.id RETURNING * INTO i;
 RETURN i;
END; $$;
CREATE OR REPLACE FUNCTION public.merchant_finish_picking(p_order_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.orders; amount numeric;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.restaurants r WHERE r.id=o.restaurant_id AND r.owner_id=auth.uid()) THEN RAISE EXCEPTION 'Pedido no autorizado'; END IF;
 IF o.status<>'PICKING' THEN RAISE EXCEPTION 'El pedido cambió de estado'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.order_picking_items WHERE order_id=o.id) OR EXISTS(SELECT 1 FROM public.order_picking_items WHERE order_id=o.id AND (status='PENDING' OR picked_price IS NULL)) THEN RAISE EXCEPTION 'Faltan productos por revisar'; END IF;
 SELECT round(sum(picked_price),2)+greatest(0,coalesce(o.total,0)-coalesce(o.subtotal,0)) INTO amount FROM public.order_picking_items WHERE order_id=o.id;
 UPDATE public.orders SET status='ADJUSTED',adjusted_total=amount,picking_completed_at=now(),client_confirmed_at=NULL WHERE id=o.id;
 RETURN amount;
END; $$;
REVOKE ALL ON FUNCTION public.merchant_start_picking(uuid),public.merchant_pick_item(uuid,text,numeric,text,numeric),public.merchant_finish_picking(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.merchant_start_picking(uuid),public.merchant_pick_item(uuid,text,numeric,text,numeric),public.merchant_finish_picking(uuid) TO authenticated;
COMMIT;
