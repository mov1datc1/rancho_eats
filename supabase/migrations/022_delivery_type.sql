-- Migration 022: Add delivery_type to orders (pickup vs delivery)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_type TEXT NOT NULL DEFAULT 'delivery'
  CHECK (delivery_type IN ('delivery', 'pickup'));

-- Set existing orders as delivery
UPDATE orders SET delivery_type = 'delivery' WHERE delivery_type IS NULL;
