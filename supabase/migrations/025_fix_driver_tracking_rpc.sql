DROP FUNCTION IF EXISTS public.driver_update_location(
  TEXT,
  UUID,
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  DOUBLE PRECISION
);

CREATE FUNCTION public.driver_update_location(
  p_access_token TEXT,
  p_order_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_accuracy_m DOUBLE PRECISION DEFAULT NULL,
  p_heading DOUBLE PRECISION DEFAULT NULL,
  p_speed_mps DOUBLE PRECISION DEFAULT NULL
)
RETURNS TABLE (
  result_driver_id UUID,
  result_order_id UUID,
  result_recorded_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_profile_id UUID;
  v_active_order_id UUID;
  v_recorded_at TIMESTAMPTZ := NOW();
BEGIN
  -- 1. Validar identidad del driver
  SELECT dp.id INTO v_driver_profile_id
  FROM public.driver_profiles dp
  WHERE dp.access_token = trim(coalesce(p_access_token, ''))
    AND dp.is_active = TRUE
  LIMIT 1;

  IF v_driver_profile_id IS NULL THEN
    RAISE EXCEPTION 'Acceso de repartidor inválido.';
  END IF;

  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'Latitud y longitud son requeridas.';
  END IF;

  -- 2. Buscar si hay un pedido activo (en caso de que la app envíe p_order_id como NULL)
  IF p_order_id IS NOT NULL THEN
    v_active_order_id := p_order_id;
  ELSE
    SELECT id INTO v_active_order_id
    FROM public.orders
    WHERE delivery_driver_id = v_driver_profile_id
      AND status IN ('ACCEPTED', 'ON_THE_WAY')
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  -- 3. Actualizar la tabla general de ubicaciones del repartidor, independientemente de si hay pedido activo
  INSERT INTO public.driver_locations AS dl (
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
    v_driver_profile_id,
    v_active_order_id, -- puede ser null
    p_lat,
    p_lng,
    p_accuracy_m,
    p_heading,
    p_speed_mps,
    v_recorded_at,
    v_recorded_at
  )
  ON CONFLICT ON CONSTRAINT driver_locations_pkey
  DO UPDATE SET
    order_id = EXCLUDED.order_id,
    lat = EXCLUDED.lat,
    lng = EXCLUDED.lng,
    accuracy_m = EXCLUDED.accuracy_m,
    heading = EXCLUDED.heading,
    speed_mps = EXCLUDED.speed_mps,
    recorded_at = EXCLUDED.recorded_at,
    updated_at = EXCLUDED.updated_at;

  -- 4. Actualizar timestamp del perfil del driver
  UPDATE public.driver_profiles
  SET last_location_at = v_recorded_at
  WHERE id = v_driver_profile_id;

  -- 5. Si hay un pedido activo, actualizar los campos en `orders` para que la app del cliente lo vea
  IF v_active_order_id IS NOT NULL THEN
    UPDATE public.orders o
    SET driver_last_lat = p_lat,
        driver_last_lng = p_lng,
        driver_location_accuracy_m = p_accuracy_m,
        driver_location_updated_at = v_recorded_at,
        delivery_started_at = COALESCE(o.delivery_started_at, v_recorded_at),
        status = CASE WHEN o.status = 'ACCEPTED' THEN 'ON_THE_WAY' ELSE o.status END
    WHERE o.id = v_active_order_id;
  END IF;

  RETURN QUERY
  SELECT v_driver_profile_id, v_active_order_id, v_recorded_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_update_location(TEXT, UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO anon, authenticated;
