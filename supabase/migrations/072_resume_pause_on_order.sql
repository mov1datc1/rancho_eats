-- 072: an expired timed pause ends the moment an order arrives.
-- 071 resumes expired pauses with a cron every minute, and business_open_now() already treats them as
-- over, but order_admission (036) still refuses while is_open = false. In the gap of up to a minute the
-- apps showed the business as open and checkout failed. This trigger runs before order_admission
-- (trigger names fire in alphabetical order) and flips the flag for that one business first.
BEGIN;
SET LOCAL lock_timeout = '15s';

CREATE OR REPLACE FUNCTION public.order_resume_expired_pause() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE restaurants SET is_open = true
   WHERE id = NEW.restaurant_id AND NOT is_open AND paused_until IS NOT NULL AND paused_until <= now();
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.order_resume_expired_pause() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a0_resume_expired_pause ON public.orders;
CREATE TRIGGER a0_resume_expired_pause BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.order_resume_expired_pause();

COMMIT;
