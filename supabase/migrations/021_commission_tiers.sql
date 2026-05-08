-- Migration 021: Commission Tiers + Payments Tracking
-- Replaces fixed commission_fee with tiered ranges + cutoff dates + payment history

-- ═══ 1. New columns in app_settings ═══
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS commission_tiers JSONB DEFAULT '[
    {"up_to": 100, "fee": 8},
    {"up_to": 150, "fee": 10},
    {"up_to": 200, "fee": 12},
    {"up_to": 300, "fee": 15},
    {"up_to": 500, "fee": 18},
    {"up_to": null, "fee": 20}
  ]'::jsonb,
  ADD COLUMN IF NOT EXISTS cutoff_from DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS cutoff_to DATE DEFAULT (CURRENT_DATE + INTERVAL '15 days')::date;

-- Set defaults on existing row
UPDATE app_settings SET
  commission_tiers = '[
    {"up_to": 100, "fee": 8},
    {"up_to": 150, "fee": 10},
    {"up_to": 200, "fee": 12},
    {"up_to": 300, "fee": 15},
    {"up_to": 500, "fee": 18},
    {"up_to": null, "fee": 20}
  ]'::jsonb,
  cutoff_from = CURRENT_DATE,
  cutoff_to = (CURRENT_DATE + INTERVAL '15 days')::date
WHERE id = 1;

-- ═══ 2. Commission payments table ═══
CREATE TABLE IF NOT EXISTS commission_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  orders_count INT NOT NULL DEFAULT 0,
  total_commission NUMERIC(10,2) NOT NULL DEFAULT 0,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_commission_payments_restaurant
  ON commission_payments(restaurant_id, period_start, period_end);

-- RLS: only admins can manage commission payments
ALTER TABLE commission_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_manage_commission_payments" ON commission_payments
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid())
  );

-- Restaurant owners can read their own payments
CREATE POLICY "restaurant_read_own_payments" ON commission_payments
  FOR SELECT
  USING (
    restaurant_id IN (
      SELECT id FROM restaurants WHERE owner_id = auth.uid()
    )
  );
