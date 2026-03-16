-- Safe/idempotent reconciliation for environments where 007/008 were run manually or partially.
-- This script can be executed multiple times without failing if objects already exist.

CREATE TABLE IF NOT EXISTS menu_item_options (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  available BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT menu_item_options_label_not_empty CHECK (char_length(trim(label)) > 0)
);

ALTER TABLE menu_item_options
  ADD COLUMN IF NOT EXISTS image_url TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_menu_item_options_updated_at'
  ) THEN
    CREATE TRIGGER trg_menu_item_options_updated_at
    BEFORE UPDATE ON menu_item_options
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

ALTER TABLE menu_item_options ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'menu_item_options'
      AND policyname = 'menu_options_select_public'
  ) THEN
    CREATE POLICY "menu_options_select_public" ON menu_item_options FOR SELECT USING (
      EXISTS (
        SELECT 1
        FROM menu_items mi
        JOIN restaurants r ON r.id = mi.restaurant_id
        WHERE mi.id = menu_item_options.menu_item_id
          AND r.status = 'ACTIVE'
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'menu_item_options'
      AND policyname = 'menu_options_all_owner'
  ) THEN
    CREATE POLICY "menu_options_all_owner" ON menu_item_options FOR ALL USING (
      EXISTS (
        SELECT 1
        FROM menu_items mi
        JOIN restaurants r ON r.id = mi.restaurant_id
        WHERE mi.id = menu_item_options.menu_item_id
          AND r.owner_id = auth.uid()
      )
    ) WITH CHECK (
      EXISTS (
        SELECT 1
        FROM menu_items mi
        JOIN restaurants r ON r.id = mi.restaurant_id
        WHERE mi.id = menu_item_options.menu_item_id
          AND r.owner_id = auth.uid()
      )
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_menu_item_options_item
  ON menu_item_options(menu_item_id, sort_order);
