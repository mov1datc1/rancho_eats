-- Reconcile a field already present in some manually configured environments.
-- Old untyped options represent full variants; never infer semantics from price.
ALTER TABLE public.menu_item_options
  ADD COLUMN IF NOT EXISTS option_type text NOT NULL DEFAULT 'size';
UPDATE public.menu_item_options SET option_type = 'size' WHERE option_type IS NULL;
ALTER TABLE public.menu_item_options ALTER COLUMN option_type SET DEFAULT 'size';
ALTER TABLE public.menu_item_options ALTER COLUMN option_type SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_option_type_valid' AND conrelid = 'public.menu_item_options'::regclass) THEN
    ALTER TABLE public.menu_item_options ADD CONSTRAINT menu_option_type_valid CHECK (option_type IN ('size', 'extra'));
  END IF;
END $$;
