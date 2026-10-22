BEGIN;
-- Pilot grocery policy: remove unavailable products; no free-text substitutions.
CREATE OR REPLACE FUNCTION public.merchant_pick_item(p_item_id uuid,p_status text,p_quantity numeric DEFAULT NULL,p_substitute text DEFAULT NULL,p_substitute_price numeric DEFAULT NULL)
RETURNS order_picking_items LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o orders;i order_picking_items;q numeric;a numeric;
BEGIN
 SELECT * INTO i FROM order_picking_items WHERE id=p_item_id;
 SELECT * INTO o FROM orders WHERE id=i.order_id FOR UPDATE;
 IF NOT can_manage_business(o.restaurant_id) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 SELECT * INTO i FROM order_picking_items WHERE id=p_item_id FOR UPDATE;
 IF o.status<>'PICKING' OR i.status<>'PENDING' THEN RAISE EXCEPTION 'El producto ya cambió'; END IF;
 IF p_status='PICKED' THEN q:=i.requested_quantity;a:=i.requested_price;
 ELSIF p_status='UNAVAILABLE' THEN q:=0;a:=0;
 ELSIF p_status='ADJUSTED' THEN
  IF coalesce(o.picking_preferences->>'on_less_quantity','remove')<>'accept_available' THEN RAISE EXCEPTION 'El cliente no autorizó cantidad parcial; marca faltante'; END IF;
  IF p_quantity IS NULL OR p_quantity<=0 OR p_quantity>=i.requested_quantity OR p_quantity::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  q:=p_quantity;a:=round(i.requested_price*q/i.requested_quantity,2);
 ELSE RAISE EXCEPTION 'Durante el piloto solo se permite surtir, reducir cantidad autorizada o quitar faltantes'; END IF;
 UPDATE order_picking_items SET status=p_status,picked_quantity=q,picked_price=a,picked_at=now(),client_response='ACCEPTED' WHERE id=i.id RETURNING * INTO i;
 RETURN i;
END;$$;
CREATE OR REPLACE FUNCTION public.merchant_finish_picking(p_order_id uuid) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o orders;a numeric;goods numeric;
BEGIN
 SELECT * INTO o FROM orders WHERE id=p_order_id FOR UPDATE;
 IF NOT can_manage_business(o.restaurant_id) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF o.picking_completed_at IS NOT NULL THEN RETURN coalesce(o.adjusted_total,o.total); END IF;
 IF o.status<>'PICKING' OR NOT EXISTS(SELECT 1 FROM order_picking_items WHERE order_id=o.id) OR EXISTS(SELECT 1 FROM order_picking_items WHERE order_id=o.id AND (status='PENDING' OR picked_price IS NULL)) THEN RAISE EXCEPTION 'Faltan productos por revisar'; END IF;
 SELECT coalesce(sum(picked_price),0) INTO goods FROM order_picking_items WHERE order_id=o.id;
 IF NOT EXISTS(SELECT 1 FROM order_picking_items WHERE order_id=o.id AND picked_quantity>0) THEN
  UPDATE orders SET status='CANCELLED',subtotal=0,total=0,adjusted_total=0,delivery_amount=0,commission_amount=0,cancelled_at=now(),cancelled_by='merchant',rejection_reason='Sin productos disponibles; sin cobro',picking_completed_at=now() WHERE id=o.id;RETURN 0;
 END IF;
 a:=round(goods+greatest(0,o.total-o.subtotal),2);
 IF a>o.total THEN RAISE EXCEPTION 'El surtido no puede aumentar el total autorizado'; END IF;
 UPDATE orders SET status='READY',subtotal=goods,total=a,adjusted_total=a,picking_completed_at=now(),client_confirmed_at=now() WHERE id=o.id;
 RETURN a;
END;$$;
DROP POLICY IF EXISTS orders_select_by_id_public ON orders;
DROP POLICY IF EXISTS orders_insert_public ON orders;
CREATE POLICY orders_client_read ON orders FOR SELECT TO authenticated USING(client_user_id=auth.uid());
CREATE POLICY orders_client_insert ON orders FOR INSERT TO authenticated WITH CHECK(client_user_id=auth.uid() AND status='PENDING');
CREATE POLICY orders_client_cancel ON orders FOR UPDATE TO authenticated USING(client_user_id=auth.uid() AND status='PENDING') WITH CHECK(client_user_id=auth.uid() AND status='CANCELLED');
CREATE POLICY orders_admin_all ON orders FOR ALL TO authenticated USING(EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid())) WITH CHECK(EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()));
DROP POLICY IF EXISTS driver_update_order_status ON orders;
DROP POLICY IF EXISTS picking_items_select ON order_picking_items;
DROP POLICY IF EXISTS picking_items_insert ON order_picking_items;
DROP POLICY IF EXISTS picking_items_update ON order_picking_items;
CREATE POLICY picking_participants ON order_picking_items FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM orders o WHERE o.id=order_id AND (o.client_user_id=auth.uid() OR can_manage_business(o.restaurant_id))));
DROP POLICY IF EXISTS saved_lists_all ON saved_lists;
CREATE POLICY lists_owner ON saved_lists FOR ALL TO authenticated USING(client_user_id=auth.uid()) WITH CHECK(client_user_id=auth.uid());
COMMIT;
