-- 067 · Security fixes from the 2026-11-17 review.
--
-- 1. delete_user_account cancelled PENDING orders matched by the phone stored in the caller's
--    user_metadata, which the user can edit (auth.updateUser). An attacker could set a victim's phone
--    and cancel the victim's pending orders. Now it only touches orders owned by auth.uid().
-- 2. ratings were readable by anyone (user_id, order_id, comment). No app screen reads other users'
--    ratings; restrict to the author, the business owner and admins.
-- 3. Hygiene: trigger / internal SECURITY DEFINER functions are not callable by anon/authenticated
--    (triggers keep firing; EXECUTE is only checked when the trigger is created).
BEGIN;

DO $guard$
DECLARE def text := pg_get_functiondef('public.delete_user_account()'::regprocedure);
BEGIN
  IF position('raw_user_meta_data' IN def) = 0 THEN
    RAISE EXCEPTION '067: delete_user_account differs from the reviewed version; review before applying';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.delete_user_account() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  -- Only the caller's own pending orders (never matched by editable metadata such as phone).
  UPDATE public.orders SET status='CANCELLED', cancelled_at=now(), cancelled_by='client'
   WHERE client_user_id=_uid AND status='PENDING';
  DELETE FROM public.ratings WHERE user_id=_uid;
  DELETE FROM auth.users WHERE id=_uid;
END $$;
REVOKE ALL ON FUNCTION public.delete_user_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;

DROP POLICY IF EXISTS ratings_select_public ON public.ratings;
DROP POLICY IF EXISTS ratings_select_scoped ON public.ratings;
CREATE POLICY ratings_select_scoped ON public.ratings FOR SELECT TO authenticated USING (
  user_id = (SELECT auth.uid())
  OR restaurant_id IN (SELECT id FROM public.restaurants WHERE owner_id = (SELECT auth.uid()))
  OR EXISTS (SELECT 1 FROM public.admin_profiles WHERE id = (SELECT auth.uid()))
);

DO $revoke$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.prorettype='trigger'::regtype AND p.prosecdef LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $revoke$;

COMMIT;
