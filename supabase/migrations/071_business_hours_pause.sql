-- 071: weekly business hours, timed pause and one server rule for "open now".
--
-- Before: one open/close time for every day, checked only by the customer app with the phone's clock;
-- the server refused paused businesses (is_open = false) but accepted orders outside hours, and a pause
-- stayed on until someone remembered to turn it off.
--
-- Now:
--   * restaurants.weekly_hours: {"0":{"open":"09:00","close":"21:00"}, ..., "6":null} keyed by weekday
--     (0 = Sunday, Mexico City time). null = closed that day. open = close means open all day. A close
--     earlier than open runs past midnight into the next day.
--   * restaurants.paused_until: a pause with automatic resume. is_open = false with paused_until = null
--     is a pause until the business turns it back on (the behaviour old app builds already have).
--   * business_open_now(): hours + pause, in Mexico City time. Orders are refused when it is false.
--   * Old builds and the web portal still edit open_time/close_time and is_open: a trigger keeps the
--     weekly hours and the pause consistent with them, so nothing they do leaves the two out of sync.
BEGIN;
SET LOCAL lock_timeout = '15s';

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS weekly_hours jsonb,
  ADD COLUMN IF NOT EXISTS paused_until timestamptz;

CREATE OR REPLACE FUNCTION public.valid_hhmm(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT p ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' $$;

CREATE OR REPLACE FUNCTION public.valid_weekly_hours(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p IS NULL OR (
    jsonb_typeof(p) = 'object'
    AND (SELECT count(*) FROM jsonb_object_keys(p) k WHERE k NOT IN ('0','1','2','3','4','5','6')) = 0
    AND (SELECT bool_and(
          jsonb_typeof(v) = 'null'
          OR (jsonb_typeof(v) = 'object' AND public.valid_hhmm(v->>'open') AND public.valid_hhmm(v->>'close')))
         FROM jsonb_each(p) e(k, v)) IS NOT FALSE
  )
$$;

ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_weekly_hours_valid;
ALTER TABLE public.restaurants ADD CONSTRAINT restaurants_weekly_hours_valid CHECK (public.valid_weekly_hours(weekly_hours)) NOT VALID;

-- Same hours every day, built from a single open/close pair.
CREATE OR REPLACE FUNCTION public.weekly_from_range(p_open text, p_close text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN public.valid_hhmm(p_open) AND public.valid_hhmm(p_close)
    THEN (SELECT jsonb_object_agg(d::text, jsonb_build_object('open', p_open, 'close', p_close)) FROM generate_series(0, 6) d)
  END
$$;

-- Is the business inside its hours at p_now (Mexico City)? Ignores the pause.
CREATE OR REPLACE FUNCTION public.business_in_hours(p_weekly jsonb, p_open text, p_close text, p_now timestamptz DEFAULT now())
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  local_ts timestamp := p_now AT TIME ZONE 'America/Mexico_City';
  dow int := extract(dow FROM local_ts)::int;
  mins int := extract(hour FROM local_ts)::int * 60 + extract(minute FROM local_ts)::int;
  week jsonb := coalesce(p_weekly, weekly_from_range(p_open, p_close));
  today jsonb; yday jsonb; o int; c int;
BEGIN
  IF week IS NULL THEN RETURN true; END IF;  -- no usable hours on record: do not lock the business out
  today := week -> dow::text;
  yday := week -> ((dow + 6) % 7)::text;
  -- Yesterday's hours that run past midnight still cover the early morning.
  IF jsonb_typeof(yday) = 'object' THEN
    o := split_part(yday->>'open', ':', 1)::int * 60 + split_part(yday->>'open', ':', 2)::int;
    c := split_part(yday->>'close', ':', 1)::int * 60 + split_part(yday->>'close', ':', 2)::int;
    IF c < o AND mins < c THEN RETURN true; END IF;
  END IF;
  IF jsonb_typeof(today) <> 'object' THEN RETURN false; END IF;
  o := split_part(today->>'open', ':', 1)::int * 60 + split_part(today->>'open', ':', 2)::int;
  c := split_part(today->>'close', ':', 1)::int * 60 + split_part(today->>'close', ':', 2)::int;
  IF o = c THEN RETURN true; END IF;              -- open all day
  IF c < o THEN RETURN mins >= o; END IF;         -- runs past midnight (early part handled above)
  RETURN mins >= o AND mins < c;
END $$;

CREATE OR REPLACE FUNCTION public.business_open_now(p_id uuid, p_now timestamptz DEFAULT now())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT (r.is_open OR (r.paused_until IS NOT NULL AND r.paused_until <= p_now))
       AND business_in_hours(r.weekly_hours, r.open_time, r.close_time, p_now)
    FROM restaurants r WHERE r.id = p_id), false)
$$;
GRANT EXECUTE ON FUNCTION public.business_open_now(uuid, timestamptz) TO anon, authenticated, service_role;

-- Keep weekly hours, the legacy open/close pair and the pause consistent whoever edits them.
CREATE OR REPLACE FUNCTION public.restaurants_hours_sync() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE first_day jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.weekly_hours IS NULL THEN NEW.weekly_hours := weekly_from_range(NEW.open_time, NEW.close_time); END IF;
  ELSIF NEW.weekly_hours IS NOT DISTINCT FROM OLD.weekly_hours
        AND (NEW.open_time IS DISTINCT FROM OLD.open_time OR NEW.close_time IS DISTINCT FROM OLD.close_time) THEN
    -- An old app or the web edited the single range: apply it to every day.
    NEW.weekly_hours := coalesce(weekly_from_range(NEW.open_time, NEW.close_time), NEW.weekly_hours);
  END IF;
  -- The legacy pair mirrors the first open day, for screens that still show one range.
  IF NEW.weekly_hours IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.weekly_hours END) AND NEW.weekly_hours IS NOT NULL THEN
    SELECT v INTO first_day FROM jsonb_each(NEW.weekly_hours) e(k, v) WHERE jsonb_typeof(v) = 'object' ORDER BY ((k::int + 6) % 7) LIMIT 1;
    IF first_day IS NOT NULL THEN NEW.open_time := first_day->>'open'; NEW.close_time := first_day->>'close'; END IF;
  END IF;
  -- Turning orders back on ends any pause; a pause end only makes sense while paused.
  IF NEW.is_open THEN NEW.paused_until := NULL; END IF;
  IF NEW.paused_until IS NOT NULL AND NEW.paused_until > now() + interval '24 hours' THEN
    RAISE EXCEPTION 'La pausa puede durar como máximo 24 horas';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS b_restaurants_hours_sync ON public.restaurants;
CREATE TRIGGER b_restaurants_hours_sync BEFORE INSERT OR UPDATE OF weekly_hours, open_time, close_time, is_open, paused_until
  ON public.restaurants FOR EACH ROW EXECUTE FUNCTION public.restaurants_hours_sync();

-- Backfill: every business keeps today's single range on every day.
UPDATE public.restaurants SET weekly_hours = weekly_from_range(open_time, close_time) WHERE weekly_hours IS NULL;

-- Orders: refused outside hours or while paused (the pause check already existed in order_admission).
CREATE OR REPLACE FUNCTION public.order_business_hours() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT business_open_now(NEW.restaurant_id) THEN
    RAISE EXCEPTION 'El negocio está cerrado en este horario';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.order_business_hours() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS operations_business_hours ON public.orders;
CREATE TRIGGER operations_business_hours BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.order_business_hours();

-- Timed pauses resume by themselves (business_open_now already treats them as over; this flips the flag
-- so every screen that still reads is_open agrees within a minute).
CREATE OR REPLACE FUNCTION public.resume_expired_pauses() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE restaurants SET is_open = true WHERE NOT is_open AND paused_until IS NOT NULL AND paused_until <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.resume_expired_pauses() FROM PUBLIC, anon, authenticated;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'resume-expired-pauses';
SELECT cron.schedule('resume-expired-pauses', '* * * * *', 'SELECT public.resume_expired_pauses()');

-- Superadmin live map: add the computed state.
DROP FUNCTION IF EXISTS public.admin_live_map_points(integer);
CREATE FUNCTION public.admin_live_map_points(p_limit integer DEFAULT 120)
RETURNS TABLE (id uuid, name text, lat double precision, lng double precision, status public.restaurant_status,
               is_open boolean, paused_until timestamptz, open_now boolean, in_hours boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.id = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  RETURN QUERY
  SELECT r.id, r.name, r.lat, r.lng, r.status, r.is_open, r.paused_until,
         public.business_open_now(r.id), public.business_in_hours(r.weekly_hours, r.open_time, r.close_time)
  FROM public.restaurants r
  WHERE r.lat IS NOT NULL AND r.lng IS NOT NULL
  ORDER BY r.updated_at DESC NULLS LAST
  LIMIT greatest(1, least(coalesce(p_limit, 120), 500));
END $$;
REVOKE ALL ON FUNCTION public.admin_live_map_points(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_live_map_points(integer) TO authenticated;

-- Superadmin territory map (the one the web console uses): each business carries its live state.
CREATE OR REPLACE FUNCTION public.admin_business_map() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'No autorizado';END IF;
 RETURN jsonb_build_object('businesses',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM(SELECT id,name,type,status,is_open,paused_until,weekly_hours,public.business_open_now(id) AS open_now,public.business_in_hours(weekly_hours,open_time,close_time) AS in_hours,address,lat,lng,delivery_radius_km,pickup_instructions,location_verified_at FROM restaurants ORDER BY name LIMIT 2000)r),'[]'),'total_businesses',(SELECT count(*) FROM restaurants),'orders',coalesce((SELECT jsonb_agg(to_jsonb(o)) FROM(SELECT o.id,o.order_number,o.restaurant_id,r.name restaurant_name,o.status,o.created_at,o.client_lat,o.client_lng,o.delivery_driver_name,o.driver_last_lat,o.driver_last_lng,o.driver_location_updated_at,o.driver_location_accuracy_m,r.lat shop_lat,r.lng shop_lng FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.status NOT IN('DELIVERED','CANCELLED','REJECTED') ORDER BY o.created_at LIMIT 1000)o),'[]'),'active_orders',(SELECT count(*) FROM orders WHERE status NOT IN('DELIVERED','CANCELLED','REJECTED')),'as_of',now());
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
