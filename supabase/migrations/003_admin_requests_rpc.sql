-- RPCs de administración para listar y moderar solicitudes de restaurantes
-- Evitan depender de consultas cliente directas con filtros sensibles a RLS.

CREATE OR REPLACE FUNCTION public.admin_list_restaurant_requests()
RETURNS SETOF public.restaurants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.admin_profiles ap
    WHERE ap.id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT r.*
  FROM public.restaurants r
  WHERE r.status = 'PENDING'
  ORDER BY r.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_restaurant_status(
  p_restaurant_id UUID,
  p_status public.restaurant_status
)
RETURNS public.restaurants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant public.restaurants;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.admin_profiles ap
    WHERE ap.id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_status NOT IN ('ACTIVE', 'SUSPENDED') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  UPDATE public.restaurants
  SET status = p_status
  WHERE id = p_restaurant_id
  RETURNING * INTO v_restaurant;

  RETURN v_restaurant;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_restaurant_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_restaurant_status(UUID, public.restaurant_status) TO authenticated;
