-- =============================================
-- EXTENSIONES
-- =============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE food_type AS ENUM (
  'CARNES', 'BIRRIA', 'TACOS', 'POLLOS',
  'MARISCOS', 'CORRIDA', 'ANTOJITOS', 'OTRO'
);

CREATE TYPE restaurant_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

CREATE TYPE order_status AS ENUM (
  'PENDING', 'ACCEPTED', 'ON_THE_WAY',
  'DELIVERED', 'REJECTED', 'CANCELLED'
);

CREATE TABLE restaurants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  phone TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  type food_type NOT NULL DEFAULT 'OTRO',
  logo_url TEXT,
  cover_url TEXT,
  address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  delivery_radius_km INTEGER NOT NULL DEFAULT 10,
  zones TEXT[] DEFAULT ARRAY[]::TEXT[],
  open_time TEXT NOT NULL DEFAULT '09:00',
  close_time TEXT NOT NULL DEFAULT '21:00',
  is_open BOOLEAN NOT NULL DEFAULT FALSE,
  status restaurant_status NOT NULL DEFAULT 'PENDING',
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  photo_url_1 TEXT,
  photo_url_2 TEXT,
  is_promo BOOLEAN NOT NULL DEFAULT FALSE,
  promo_description TEXT,
  is_combo BOOLEAN NOT NULL DEFAULT FALSE,
  combo_description TEXT,
  available BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number SERIAL,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  client_name TEXT,
  client_phone TEXT,
  client_lat DOUBLE PRECISION NOT NULL,
  client_lng DOUBLE PRECISION NOT NULL,
  client_location_note TEXT,
  client_ip TEXT,
  client_fingerprint TEXT,
  items JSONB NOT NULL,
  total NUMERIC(10,2) NOT NULL,
  status order_status NOT NULL DEFAULT 'PENDING',
  rejection_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  cancelled_by TEXT,
  is_suspicious BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE blocked_entities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL,
  value TEXT NOT NULL UNIQUE,
  reason TEXT,
  blocked_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE admin_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_restaurants_updated_at BEFORE UPDATE ON restaurants FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_menu_items_updated_at BEFORE UPDATE ON menu_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurants_select_public" ON restaurants FOR SELECT USING (status = 'ACTIVE');
CREATE POLICY "restaurants_select_owner" ON restaurants FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "restaurants_insert_public" ON restaurants FOR INSERT WITH CHECK (true);
CREATE POLICY "restaurants_update_owner" ON restaurants FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "menu_select_public" ON menu_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM restaurants r WHERE r.id = menu_items.restaurant_id AND r.status = 'ACTIVE')
);

CREATE POLICY "menu_all_owner" ON menu_items FOR ALL USING (
  EXISTS (SELECT 1 FROM restaurants r WHERE r.id = menu_items.restaurant_id AND r.owner_id = auth.uid())
);

CREATE POLICY "orders_insert_public" ON orders FOR INSERT WITH CHECK (true);
CREATE POLICY "orders_select_restaurant" ON orders FOR SELECT USING (
  EXISTS (SELECT 1 FROM restaurants r WHERE r.id = orders.restaurant_id AND r.owner_id = auth.uid())
);
CREATE POLICY "orders_select_by_id_public" ON orders FOR SELECT USING (true);
CREATE POLICY "orders_update_restaurant" ON orders FOR UPDATE USING (
  EXISTS (SELECT 1 FROM restaurants r WHERE r.id = orders.restaurant_id AND r.owner_id = auth.uid())
);

CREATE POLICY "blocked_admin_only" ON blocked_entities FOR ALL USING (
  EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())
);

CREATE POLICY "admin_profiles_self" ON admin_profiles FOR SELECT USING (auth.uid() = id);

CREATE INDEX idx_restaurants_status ON restaurants(status);
CREATE INDEX idx_restaurants_owner ON restaurants(owner_id);
CREATE INDEX idx_menu_items_restaurant ON menu_items(restaurant_id);
CREATE INDEX idx_orders_restaurant ON orders(restaurant_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_client_ip ON orders(client_ip);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE INDEX idx_blocked_value ON blocked_entities(value);

CREATE SEQUENCE order_number_seq START 1000;

CREATE OR REPLACE FUNCTION get_next_order_number()
RETURNS INTEGER AS $$
BEGIN
  RETURN nextval('order_number_seq');
END;
$$ LANGUAGE plpgsql;

ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE restaurants;
