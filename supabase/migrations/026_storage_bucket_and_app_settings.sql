-- ============================================================================
-- Migration 026: Supabase Storage bucket for menu images + app_settings table
-- ============================================================================
-- This migration:
-- 1. Creates a public Storage bucket "menu-images" for menu item photos
-- 2. Configures RLS policies for public read + authenticated write
-- 3. Creates an "app_settings" table for configurable platform settings
--    (GPS distance interval, etc.)
-- ============================================================================

-- ============================================================
-- 1. STORAGE BUCKET: menu-images
-- ============================================================

-- Create the bucket (public = anyone can read images via URL)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'menu-images',
  'menu-images',
  true,
  5242880, -- 5MB max per image
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Policy: Anyone can read/download images (public bucket)
CREATE POLICY "Public read menu images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'menu-images');

-- Policy: Authenticated users can upload images
CREATE POLICY "Authenticated upload menu images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'menu-images');

-- Policy: Authenticated users can update/overwrite their images
CREATE POLICY "Authenticated update menu images"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'menu-images');

-- Policy: Authenticated users can delete images
CREATE POLICY "Authenticated delete menu images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'menu-images');


-- ============================================================
-- 2. APP SETTINGS TABLE (platform-wide configuration)
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Everyone can read settings (drivers, clients, restaurants)
CREATE POLICY "Public read app settings"
  ON app_settings FOR SELECT
  USING (true);

-- Only admins can update settings (via the SuperAdmin dashboard)
-- For now, allow any authenticated user (admin check done in app layer)
CREATE POLICY "Authenticated update app settings"
  ON app_settings FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated insert app settings"
  ON app_settings FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);


-- ============================================================
-- 3. SEED DEFAULT SETTINGS
-- ============================================================

-- GPS distance interval in meters (0 = send every update, 30 = every 30m moved)
INSERT INTO app_settings (setting_key, value, description)
VALUES (
  'gps_distance_interval_m',
  '0'::jsonb,
  'Minimum distance in meters the driver must move before sending a GPS update. 0 = every update (testing mode). Recommended production: 20-50.'
)
ON CONFLICT (setting_key) DO NOTHING;

-- GPS time interval in milliseconds
INSERT INTO app_settings (setting_key, value, description)
VALUES (
  'gps_time_interval_ms',
  '10000'::jsonb,
  'Minimum time in milliseconds between GPS updates. Default 10000 (10 seconds).'
)
ON CONFLICT (setting_key) DO NOTHING;
