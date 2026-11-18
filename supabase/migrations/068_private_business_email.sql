-- 068: the business login e-mail stops being public.
-- restaurants is readable by anyone (catalog), so restaurants.email exposed the
-- owner's login. The public contact is the business phone/WhatsApp; the e-mail
-- moves to restaurant_private (owner + superadmin only). Old clients that still
-- send restaurants.email keep working: a trigger moves the value and blanks it.
BEGIN;

CREATE TABLE IF NOT EXISTS public.restaurant_private (
  restaurant_id uuid PRIMARY KEY
    REFERENCES public.restaurants(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  email text CHECK (email IS NULL OR length(email) <= 254),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.restaurant_private ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.restaurant_private FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.restaurant_private TO authenticated;

DROP POLICY IF EXISTS restaurant_private_select ON public.restaurant_private;
CREATE POLICY restaurant_private_select ON public.restaurant_private
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.restaurants r
            WHERE r.id = restaurant_id AND r.owner_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.id = (SELECT auth.uid()))
  );

ALTER TABLE public.restaurants ALTER COLUMN email DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.restaurants_move_private_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF nullif(trim(NEW.email), '') IS NOT NULL THEN
    INSERT INTO public.restaurant_private (restaurant_id, email, updated_at)
    VALUES (NEW.id, lower(trim(NEW.email)), now())
    ON CONFLICT (restaurant_id) DO UPDATE SET email = EXCLUDED.email, updated_at = now();
  END IF;
  NEW.email := NULL;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.restaurants_move_private_email() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_restaurants_private_email ON public.restaurants;
CREATE TRIGGER a_restaurants_private_email
  BEFORE INSERT OR UPDATE OF email ON public.restaurants
  FOR EACH ROW EXECUTE FUNCTION public.restaurants_move_private_email();

-- Backfill: the trigger moves every existing e-mail and blanks the public column.
UPDATE public.restaurants SET email = email WHERE email IS NOT NULL;

-- Superadmin pending list (the web calls this RPC first; it was never created, so it fell
-- back to select('*')). Returns the private e-mail for review.
CREATE OR REPLACE FUNCTION public.admin_list_restaurant_requests()
RETURNS SETOF public.restaurants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.id = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  RETURN QUERY
  SELECT (jsonb_populate_record(NULL::public.restaurants,
            to_jsonb(r) || jsonb_build_object('email', coalesce(p.email, u.email::text)))).*
  FROM public.restaurants r
  LEFT JOIN public.restaurant_private p ON p.restaurant_id = r.id
  LEFT JOIN auth.users u ON u.id = r.owner_id
  WHERE UPPER(r.status::TEXT) = 'PENDING'
  ORDER BY r.created_at DESC;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_list_restaurant_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_restaurant_requests() TO authenticated;

COMMIT;
