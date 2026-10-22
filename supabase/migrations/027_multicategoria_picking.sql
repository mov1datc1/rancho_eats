-- ============================================================
-- PideYa Migration 027: Multi-Categoría + Picking
-- ============================================================
-- Adds: flow_type per category, weight-based selling for menu items,
-- picking workflow (order_picking_items), saved lists, and
-- picking preferences for clients.
-- ============================================================

-- 1. flow_type en app_categories
ALTER TABLE app_categories 
  ADD COLUMN IF NOT EXISTS flow_type TEXT DEFAULT 'prepared';

-- Configurar categorías existentes
UPDATE app_categories SET flow_type = 'picked' WHERE name IN ('Frutería', 'Carnicería', 'Cremería', 'Pescadería');
UPDATE app_categories SET flow_type = 'pharmacy' WHERE name IN ('Farmacia', 'Tiendas');

-- 2. Columnas de peso/inventario en menu_items
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS sell_by_weight BOOLEAN DEFAULT false;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS unit_type TEXT DEFAULT 'unit';
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS price_per_unit NUMERIC;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS min_quantity NUMERIC DEFAULT 0.1;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS step_quantity NUMERIC DEFAULT 0.1;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS allow_substitution BOOLEAN DEFAULT true;

-- 3. Columnas de picking en orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS picking_preferences JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS adjusted_total NUMERIC;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS picking_started_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS picking_completed_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_confirmed_at TIMESTAMPTZ;

-- 4. Tabla order_picking_items
CREATE TABLE IF NOT EXISTS order_picking_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES menu_items(id),
  
  -- Lo que pidió el cliente
  requested_name TEXT NOT NULL,
  requested_quantity NUMERIC NOT NULL,
  requested_unit TEXT DEFAULT 'unit',
  requested_price NUMERIC NOT NULL,
  
  -- Lo que encontró el negocio
  picked_quantity NUMERIC,
  picked_price NUMERIC,
  
  -- Sustitución
  substitute_item_id UUID REFERENCES menu_items(id),
  substitute_name TEXT,
  substitute_price NUMERIC,
  
  -- Estado del item
  status TEXT DEFAULT 'PENDING',
  client_response TEXT DEFAULT 'PENDING',
  
  notes TEXT,
  picked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS para order_picking_items
ALTER TABLE order_picking_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "picking_items_select" ON order_picking_items 
  FOR SELECT USING (true);

CREATE POLICY "picking_items_insert" ON order_picking_items 
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "picking_items_update" ON order_picking_items 
  FOR UPDATE USING (auth.role() = 'authenticated');

-- 5. Tabla saved_lists (listas de despensa)
CREATE TABLE IF NOT EXISTS saved_lists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_user_id UUID,
  client_phone TEXT,
  restaurant_id UUID REFERENCES restaurants(id),
  name TEXT NOT NULL,
  items JSONB NOT NULL,
  is_favorite BOOLEAN DEFAULT false,
  source_order_id UUID REFERENCES orders(id),
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE saved_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_lists_all" ON saved_lists 
  FOR ALL USING (true);

-- 6. Picking preferences en client_profiles
ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS picking_preferences JSONB DEFAULT '{
  "on_unavailable": "substitute",
  "on_less_quantity": "accept_available",
  "item_timeout_seconds": 300,
  "summary_timeout_seconds": 900
}';

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_picking_items_order ON order_picking_items(order_id);
CREATE INDEX IF NOT EXISTS idx_saved_lists_phone ON saved_lists(client_phone);
CREATE INDEX IF NOT EXISTS idx_saved_lists_restaurant ON saved_lists(restaurant_id);
