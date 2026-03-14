CREATE TABLE menu_item_options (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  available BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT menu_item_options_label_not_empty CHECK (char_length(trim(label)) > 0)
);

CREATE TRIGGER trg_menu_item_options_updated_at
BEFORE UPDATE ON menu_item_options
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE menu_item_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "menu_options_select_public" ON menu_item_options FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM menu_items mi
    JOIN restaurants r ON r.id = mi.restaurant_id
    WHERE mi.id = menu_item_options.menu_item_id
      AND r.status = 'ACTIVE'
  )
);

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

CREATE INDEX idx_menu_item_options_item ON menu_item_options(menu_item_id, sort_order);
