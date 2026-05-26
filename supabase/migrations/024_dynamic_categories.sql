-- 024_dynamic_categories.sql
-- Creates the app_categories table, converts restaurants.type to TEXT, and migrates existing data

CREATE TABLE IF NOT EXISTS app_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  emoji TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Habilitar RLS
ALTER TABLE app_categories ENABLE ROW LEVEL SECURITY;

-- Politicas para app_categories
CREATE POLICY "categories_select_public" ON app_categories FOR SELECT USING (is_active = TRUE);
CREATE POLICY "categories_admin_all" ON app_categories FOR ALL USING (
  EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())
);

-- Insertar las categorias iniciales
INSERT INTO app_categories (name, emoji, sort_order) VALUES
('Restaurantes', '🍽️', 10),
('Farmacia', '💊', 20),
('Carnicería', '🥩', 30),
('Frutería', '🍎', 40),
('Pescadería', '🐟', 50),
('Cremería', '🧀', 60),
('Tiendas', '🏪', 70),
('Otros', '📦', 90)
ON CONFLICT (name) DO NOTHING;

-- Convertir restaurants.type de ENUM a TEXT y eliminar el ENUM
ALTER TABLE restaurants ALTER COLUMN type TYPE TEXT USING type::text;
DROP TYPE IF EXISTS food_type CASCADE;

-- Actualizar todos los restaurantes existentes para usar la nueva categoria maestra 'Restaurantes'
-- Todos los que tenian 'TACOS', 'POLLOS', etc., ahora son 'Restaurantes'
UPDATE restaurants 
SET type = 'Restaurantes' 
WHERE type IN ('CARNES', 'BIRRIA', 'TACOS', 'POLLOS', 'MARISCOS', 'CORRIDA', 'ANTOJITOS', 'RESTAURANTE');

-- Los que tenian 'OTRO' se cambian a 'Otros'
UPDATE restaurants SET type = 'Otros' WHERE type = 'OTRO';

-- Notify realtime para que se puedan suscribir si quieren
ALTER PUBLICATION supabase_realtime ADD TABLE app_categories;
