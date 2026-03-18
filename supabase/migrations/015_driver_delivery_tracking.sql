CREATE TABLE IF NOT EXISTS public.driver_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  vehicle_label TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  access_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(18), 'hex'),
  last_location_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.driver_locations (
  driver_id UUID PRIMARY KEY REFERENCES public.driver_profiles(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy_m DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  speed_mps DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_driver_id UUID REFERENCES public.driver_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_driver_name TEXT,
  ADD COLUMN IF NOT EXISTS delivery_driver_phone TEXT,
  ADD COLUMN IF NOT EXISTS delivery_assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS driver_last_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS driver_last_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS driver_location_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS driver_location_updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_driver_profiles_updated_at'
  ) THEN
    CREATE TRIGGER trg_driver_profiles_updated_at
    BEFORE UPDATE ON public.driver_profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_driver_locations_updated_at'
  ) THEN
    CREATE TRIGGER trg_driver_locations_updated_at
    BEFORE UPDATE ON public.driver_locations
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END
$$;

ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "driver_profiles_select_owner" ON public.driver_profiles
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.restaurants r
    WHERE r.id = driver_profiles.restaurant_id
      AND r.owner_id = auth.uid()
  )
);

CREATE POLICY "driver_profiles_insert_owner" ON public.driver_profiles
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.restaurants r
    WHERE r.id = driver_profiles.restaurant_id
      AND r.owner_id = auth.uid()
  )
);

CREATE POLICY "driver_profiles_update_owner" ON public.driver_profiles
FOR UPDATE USING (
  EXISTS (
    SELECT 1
    FROM public.restaurants r
    WHERE r.id = driver_profiles.restaurant_id
      AND r.owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.restaurants r
    WHERE r.id = driver_profiles.restaurant_id
      AND r.owner_id = auth.uid()
  )
);

CREATE POLICY "driver_locations_select_owner" ON public.driver_locations
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.driver_profiles dp
    JOIN public.restaurants r ON r.id = dp.restaurant_id
    WHERE dp.id = driver_locations.driver_id
      AND r.owner_id = auth.uid()
  )
);

CREATE POLICY "driver_locations_update_owner" ON public.driver_locations
FOR ALL USING (
  EXISTS (
    SELECT 1
    FROM public.driver_profiles dp
    JOIN public.restaurants r ON r.id = dp.restaurant_id
    WHERE dp.id = driver_locations.driver_id
      AND r.owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.driver_profiles dp
    JOIN public.restaurants r ON r.id = dp.restaurant_id
    WHERE dp.id = driver_locations.driver_id
      AND r.owner_id = auth.uid()
  )
);

CREATE INDEX IF NOT EXISTS idx_driver_profiles_restaurant ON public.driver_profiles(restaurant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_token ON public.driver_profiles(access_token);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_driver ON public.orders(delivery_driver_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_locations_recorded_at ON public.driver_locations(recorded_at DESC);

CREATE OR REPLACE FUNCTION public.driver_get_session(
  p_access_token TEXT
)
RETURNS TABLE (
  driver_id UUID,
  restaurant_id UUID,
  restaurant_name TEXT,
  driver_name TEXT,
  driver_phone TEXT,
  vehicle_label TEXT,
  is_active BOOLEAN,
  last_location_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT dp.id,
         dp.restaurant_id,
         r.name,
         dp.name,
         dp.phone,
         dp.vehicle_label,
         dp.is_active,
         dp.last_location_at
  FROM public.driver_profiles dp
  JOIN public.restaurants r ON r.id = dp.restaurant_id
  WHERE dp.access_token = trim(coalesce(p_access_token, ''))
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_get_assigned_orders(
  p_access_token TEXT
)
RETURNS TABLE (
  id UUID,
  order_number INTEGER,
  restaurant_id UUID,
  client_name TEXT,
  client_phone TEXT,
  client_location_note TEXT,
  client_lat DOUBLE PRECISION,
  client_lng DOUBLE PRECISION,
  items JSONB,
  subtotal NUMERIC,
  commission_amount NUMERIC,
  delivery_amount NUMERIC,
  total NUMERIC,
  status public.order_status,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ,
  delivery_driver_id UUID,
  delivery_driver_name TEXT,
  delivery_driver_phone TEXT,
  delivery_assigned_at TIMESTAMPTZ,
  delivery_started_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  driver_last_lat DOUBLE PRECISION,
  driver_last_lng DOUBLE PRECISION,
  driver_location_accuracy_m DOUBLE PRECISION,
  driver_location_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id UUID;
BEGIN
  SELECT dp.id INTO v_driver_id
  FROM public.driver_profiles dp
  WHERE dp.access_token = trim(coalesce(p_access_token, ''))
    AND dp.is_active = TRUE
  LIMIT 1;

  IF v_driver_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT o.id,
         o.order_number,
         o.restaurant_id,
         o.client_name,
         o.client_phone,
         o.client_location_note,
         o.client_lat,
         o.client_lng,
         o.items,
         o.subtotal,
         o.commission_amount,
         o.delivery_amount,
         o.total,
         o.status,
         o.rejection_reason,
         o.created_at,
         o.delivery_driver_id,
         o.delivery_driver_name,
         o.delivery_driver_phone,
         o.delivery_assigned_at,
         o.delivery_started_at,
         o.delivered_at,
         o.driver_last_lat,
         o.driver_last_lng,
         o.driver_location_accuracy_m,
         o.driver_location_updated_at
  FROM public.orders o
  WHERE o.delivery_driver_id = v_driver_id
    AND o.status IN ('ACCEPTED', 'ON_THE_WAY')
  ORDER BY o.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_take_order(
  p_access_token TEXT,
  p_order_id UUID
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id UUID;
  v_order public.orders;
BEGIN
  SELECT dp.id INTO v_driver_id
  FROM public.driver_profiles dp
  WHERE dp.access_token = trim(coalesce(p_access_token, ''))
    AND dp.is_active = TRUE
  LIMIT 1;

  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'Acceso de repartidor inválido.';
  END IF;

  UPDATE public.orders o
  SET status = CASE WHEN o.status = 'ACCEPTED' THEN 'ON_THE_WAY' ELSE o.status END,
      delivery_started_at = COALESCE(o.delivery_started_at, NOW())
  WHERE o.id = p_order_id
    AND o.delivery_driver_id = v_driver_id
    AND o.status IN ('ACCEPTED', 'ON_THE_WAY')
  RETURNING o.* INTO v_order;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Pedido no disponible para este repartidor.';
  END IF;

  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_update_location(
  p_access_token TEXT,
  p_order_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_accuracy_m DOUBLE PRECISION DEFAULT NULL,
  p_heading DOUBLE PRECISION DEFAULT NULL,
  p_speed_mps DOUBLE PRECISION DEFAULT NULL
)
RETURNS TABLE (
  driver_id UUID,
  order_id UUID,
  recorded_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id UUID;
  v_recorded_at TIMESTAMPTZ := NOW();
BEGIN
  SELECT dp.id INTO v_driver_id
  FROM public.driver_profiles dp
  WHERE dp.access_token = trim(coalesce(p_access_token, ''))
    AND dp.is_active = TRUE
  LIMIT 1;

  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'Acceso de repartidor inválido.';
  END IF;

  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'Latitud y longitud son requeridas.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = p_order_id
      AND o.delivery_driver_id = v_driver_id
      AND o.status IN ('ACCEPTED', 'ON_THE_WAY')
  ) THEN
    RAISE EXCEPTION 'El pedido ya no está disponible para compartir ubicación.';
  END IF;

  INSERT INTO public.driver_locations (
    driver_id,
    order_id,
    lat,
    lng,
    accuracy_m,
    heading,
    speed_mps,
    recorded_at,
    updated_at
  )
  VALUES (
    v_driver_id,
    p_order_id,
    p_lat,
    p_lng,
    p_accuracy_m,
    p_heading,
    p_speed_mps,
    v_recorded_at,
    v_recorded_at
  )
  ON CONFLICT (driver_id)
  DO UPDATE SET
    order_id = EXCLUDED.order_id,
    lat = EXCLUDED.lat,
    lng = EXCLUDED.lng,
    accuracy_m = EXCLUDED.accuracy_m,
    heading = EXCLUDED.heading,
    speed_mps = EXCLUDED.speed_mps,
    recorded_at = EXCLUDED.recorded_at,
    updated_at = EXCLUDED.updated_at;

  UPDATE public.driver_profiles
  SET last_location_at = v_recorded_at
  WHERE id = v_driver_id;

  UPDATE public.orders o
  SET driver_last_lat = p_lat,
      driver_last_lng = p_lng,
      driver_location_accuracy_m = p_accuracy_m,
      driver_location_updated_at = v_recorded_at,
      delivery_started_at = COALESCE(o.delivery_started_at, v_recorded_at),
      status = CASE WHEN o.status = 'ACCEPTED' THEN 'ON_THE_WAY' ELSE o.status END
  WHERE o.id = p_order_id
    AND o.delivery_driver_id = v_driver_id;

  RETURN QUERY
  SELECT v_driver_id, p_order_id, v_recorded_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_get_session(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.driver_get_assigned_orders(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.driver_take_order(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.driver_update_location(TEXT, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO anon, authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_locations;
