-- 069: an order cancelled without charge may clear its shipping.
-- 057 made delivery_amount immutable after creation. merchant_finish_picking (038)
-- cancels an order whose items are all unavailable with every charge set to 0, so
-- for delivery orders with shipping > 0 that update was rejected and the order
-- stayed stuck in PICKING. Shipping can now only change to 0 on a cancellation;
-- the pricing snapshot stays immutable.
BEGIN;

DO $$
BEGIN
  IF position('El envío de un pedido creado no puede cambiar' IN
       pg_get_functiondef('public.keep_order_delivery_price()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '069: keep_order_delivery_price differs from the 057 version';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.keep_order_delivery_price()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.delivery_pricing_snapshot IS DISTINCT FROM OLD.delivery_pricing_snapshot
     OR (NEW.delivery_amount IS DISTINCT FROM OLD.delivery_amount
         AND NOT (NEW.status::text = 'CANCELLED' AND NEW.delivery_amount = 0)) THEN
    RAISE EXCEPTION 'El envío de un pedido creado no puede cambiar';
  END IF;
  RETURN NEW;
END $$;

COMMIT;
