BEGIN;
-- Additive: existing versions/businesses keep delivery enabled. Existing orders are untouched.
ALTER TABLE public.restaurants ADD COLUMN delivery_enabled boolean NOT NULL DEFAULT true;
CREATE FUNCTION public.check_delivery_availability() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE enabled boolean;
BEGIN
 IF coalesce(NEW.delivery_type,'delivery')='delivery' THEN
  -- Serialize admission with the owner's availability update; never trust the app's cached flag.
  SELECT delivery_enabled INTO enabled FROM public.restaurants WHERE id=NEW.restaurant_id FOR SHARE;
  IF enabled IS FALSE THEN
   RAISE EXCEPTION 'Actualmente no tenemos entrega a domicilio, solo para recoger.' USING ERRCODE='P0001';
  END IF;
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION public.check_delivery_availability() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER delivery_availability_guard BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.check_delivery_availability();
COMMIT;
