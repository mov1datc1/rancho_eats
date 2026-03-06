-- Ajuste defensivo: consulta pendientes por texto para evitar cualquier problema de casteo/cliente

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
  WHERE UPPER(r.status::TEXT) = 'PENDING'
  ORDER BY r.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_restaurant_requests() TO authenticated;
