-- 062 · Catalog read scalability + business insert guard (capacity audit 2026-11-17).
--
-- Problem measured with k6 on staging (Micro compute): the public catalog and menu saturated the
-- database at ~100-150 req/s. Root cause is an RLS cascade:
--   menu_items row -> menu_select_public EXISTS(restaurants) -> restaurants_select_public
--   -> can_order_business(id) (SECURITY DEFINER, JOIN on lower(trim())) evaluated PER ROW.
-- customer_businesses() also called can_order_business() once per restaurant.
--
-- Fix: compute the orderable set ONCE per statement (uncorrelated subquery -> hashed SubPlan)
-- and wrap auth.uid() in (SELECT ...) so it becomes an InitPlan instead of a per-row call.
-- Visibility rules are unchanged; can_order_business() is kept for single-row callers
-- (order_admission, delivery pricing).
BEGIN;

CREATE OR REPLACE FUNCTION public.orderable_business_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT r.id
  FROM restaurants r
  JOIN app_categories c ON lower(trim(c.name))=lower(trim(r.type))
  WHERE r.status='ACTIVE' AND c.is_active
    AND (c.release_mode='public'
         OR (c.release_mode='pilot' AND EXISTS(
               SELECT 1 FROM category_pilots p
               WHERE p.category_id=c.id AND p.restaurant_id=r.id AND p.user_id=(SELECT auth.uid()))));
$$;
REVOKE ALL ON FUNCTION public.orderable_business_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orderable_business_ids() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.customer_businesses() RETURNS SETOF restaurants
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT r.* FROM restaurants r
  WHERE r.id IN (SELECT public.orderable_business_ids())
  ORDER BY r.name;
$$;

-- restaurants: same rules, evaluated once per statement.
DROP POLICY IF EXISTS restaurants_select_public ON restaurants;
CREATE POLICY restaurants_select_public ON restaurants FOR SELECT
  USING (id IN (SELECT public.orderable_business_ids()));
DROP POLICY IF EXISTS restaurants_select_owner ON restaurants;
CREATE POLICY restaurants_select_owner ON restaurants FOR SELECT
  USING (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS restaurants_select_admin ON restaurants;
CREATE POLICY restaurants_select_admin ON restaurants FOR SELECT
  USING (EXISTS (SELECT 1 FROM admin_profiles ap WHERE ap.id = (SELECT auth.uid())));
DROP POLICY IF EXISTS restaurants_update_owner ON restaurants;
CREATE POLICY restaurants_update_owner ON restaurants FOR UPDATE
  USING (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS restaurants_update_admin ON restaurants;
CREATE POLICY restaurants_update_admin ON restaurants FOR UPDATE
  USING (EXISTS (SELECT 1 FROM admin_profiles ap WHERE ap.id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles ap WHERE ap.id = (SELECT auth.uid())));

-- SECURITY: previously WITH CHECK (true) for every role, so anonymous callers could create
-- business rows. Registration (web) always inserts with a session and owner_id = auth.uid().
DROP POLICY IF EXISTS restaurants_insert_public ON restaurants;
CREATE POLICY restaurants_insert_owner ON restaurants FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid())
              OR EXISTS (SELECT 1 FROM admin_profiles ap WHERE ap.id = (SELECT auth.uid())));

-- menu_items / menu_item_options: same visibility, auth.uid() as InitPlan.
DROP POLICY IF EXISTS menu_all_owner ON menu_items;
CREATE POLICY menu_all_owner ON menu_items FOR ALL
  USING (EXISTS (SELECT 1 FROM restaurants r
                 WHERE r.id = menu_items.restaurant_id AND r.owner_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS menu_options_all_owner ON menu_item_options;
CREATE POLICY menu_options_all_owner ON menu_item_options FOR ALL
  USING (EXISTS (SELECT 1 FROM menu_items mi JOIN restaurants r ON r.id = mi.restaurant_id
                 WHERE mi.id = menu_item_options.menu_item_id AND r.owner_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM menu_items mi JOIN restaurants r ON r.id = mi.restaurant_id
                 WHERE mi.id = menu_item_options.menu_item_id AND r.owner_id = (SELECT auth.uid())));

-- Index matching the client menu query (restaurant, available, ORDER BY sort_order, category).
CREATE INDEX IF NOT EXISTS menu_items_public_menu
  ON menu_items (restaurant_id, sort_order, category) WHERE available;
CREATE INDEX IF NOT EXISTS app_categories_name_norm ON app_categories (lower(trim(name)));

COMMIT;
