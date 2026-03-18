CREATE TABLE IF NOT EXISTS public.app_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  commission_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.app_settings (id, commission_fee)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings_select_public" ON public.app_settings;
CREATE POLICY "app_settings_select_public"
ON public.app_settings
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "app_settings_admin_update" ON public.app_settings;
CREATE POLICY "app_settings_admin_update"
ON public.app_settings
FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.id = auth.uid()));

DROP POLICY IF EXISTS "app_settings_admin_insert" ON public.app_settings;
CREATE POLICY "app_settings_admin_insert"
ON public.app_settings
FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.id = auth.uid()));

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER trg_app_settings_updated_at
BEFORE UPDATE ON public.app_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS subtotal NUMERIC(10,2);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

UPDATE public.orders
SET subtotal = COALESCE(subtotal, total),
    commission_amount = COALESCE(commission_amount, 0)
WHERE subtotal IS NULL;
