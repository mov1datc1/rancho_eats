-- RPCs extra para secciones del super admin: pedidos, mapa en vivo y bloqueo manual.

CREATE OR REPLACE FUNCTION public.admin_orders_feed(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  id UUID,
  order_number INTEGER,
  restaurant_name TEXT,
  status public.order_status,
  total NUMERIC,
  client_name TEXT,
  client_phone TEXT,
  client_location_note TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.id = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.order_number,
    COALESCE(r.name, 'Restaurante') AS restaurant_name,
    o.status,
    o.total,
    o.client_name,
    o.client_phone,
    o.client_location_note,
    o.created_at
  FROM public.orders o
  LEFT JOIN public.restaurants r ON r.id = o.restaurant_id
  ORDER BY o.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 300));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_live_map_points(p_limit INTEGER DEFAULT 120)
RETURNS TABLE (
  id UUID,
  name TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  status public.restaurant_status,
  is_open BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.id = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.name,
    r.lat,
    r.lng,
    r.status,
    r.is_open
  FROM public.restaurants r
  WHERE r.lat IS NOT NULL AND r.lng IS NOT NULL
  ORDER BY r.updated_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 400));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_block_entity(p_value TEXT, p_reason TEXT DEFAULT 'Bloqueado por super admin')
RETURNS public.blocked_entities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blocked public.blocked_entities;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.id = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  INSERT INTO public.blocked_entities(type, value, reason, blocked_by)
  VALUES ('IP', p_value, p_reason, auth.uid()::TEXT)
  ON CONFLICT (value)
  DO UPDATE SET reason = EXCLUDED.reason
  RETURNING * INTO v_blocked;

  RETURN v_blocked;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_orders_feed(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_live_map_points(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_block_entity(TEXT, TEXT) TO authenticated;
