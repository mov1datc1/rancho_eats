BEGIN;
-- Electronic payment requires server-side confirmation, not a client-selected label.
CREATE FUNCTION public.require_cash_checkout() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF coalesce(NEW.payment_method,'cash')<>'cash' THEN RAISE EXCEPTION 'Por ahora solo está habilitado el pago en efectivo'; END IF;
 NEW.payment_method:='cash';RETURN NEW;
END;$$;
CREATE TRIGGER operations_cash_only BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION require_cash_checkout();
CREATE FUNCTION public.expire_courier_shifts() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s courier_shifts;n integer:=0;
BEGIN
 FOR s IN SELECT * FROM courier_shifts WHERE closed_at IS NULL AND available_until<=now() FOR UPDATE SKIP LOCKED LOOP
  UPDATE courier_shifts SET accepting=false WHERE id=s.id;
  UPDATE orders SET delivery_driver_id=NULL,delivery_driver_name=NULL,delivery_driver_phone=NULL WHERE delivery_driver_id=s.driver_id AND status IN('ACCEPTED','PREPARING','PICKING','ADJUSTED','READY');
  IF NOT EXISTS(SELECT 1 FROM delivery_cycles WHERE identity_id=s.identity_id AND closed_at IS NULL) THEN UPDATE courier_shifts SET closed_at=now() WHERE id=s.id; END IF;
  n:=n+1;
 END LOOP;RETURN n;
END;$$;
REVOKE ALL ON FUNCTION expire_courier_shifts() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION expire_courier_shifts() TO service_role;
SELECT cron.schedule('expire-courier-shifts','* * * * *','SELECT public.expire_courier_shifts()');
COMMIT;
