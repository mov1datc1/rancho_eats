CREATE OR REPLACE FUNCTION public.admin_reset_restaurant_password(
  p_restaurant_id UUID,
  p_password TEXT
)
RETURNS TABLE (
  restaurant_id UUID,
  restaurant_name TEXT,
  owner_id UUID,
  email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_restaurant public.restaurants%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.admin_profiles ap WHERE ap.id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Solo super admins pueden resetear claves.';
  END IF;

  IF p_restaurant_id IS NULL OR length(trim(coalesce(p_password, ''))) < 8 THEN
    RAISE EXCEPTION 'restaurant_id y password (mínimo 8 caracteres) son requeridos.';
  END IF;

  SELECT * INTO v_restaurant
  FROM public.restaurants r
  WHERE r.id = p_restaurant_id
  LIMIT 1;

  IF v_restaurant.id IS NULL THEN
    RAISE EXCEPTION 'No se encontró el restaurante.';
  END IF;

  IF v_restaurant.owner_id IS NULL THEN
    RAISE EXCEPTION 'El restaurante no tiene un usuario vinculado.';
  END IF;

  UPDATE auth.users
  SET encrypted_password = extensions.crypt(trim(p_password), extensions.gen_salt('bf')),
      updated_at = NOW(),
      email_confirmed_at = COALESCE(email_confirmed_at, NOW())
  WHERE id = v_restaurant.owner_id;

  RETURN QUERY
  SELECT v_restaurant.id, v_restaurant.name, v_restaurant.owner_id, v_restaurant.email;
END;
$$;
