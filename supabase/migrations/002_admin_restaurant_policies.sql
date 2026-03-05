-- Permite que usuarios en admin_profiles puedan moderar restaurantes pendientes
CREATE POLICY "restaurants_select_admin" ON restaurants
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM admin_profiles ap
    WHERE ap.id = auth.uid()
  )
);

CREATE POLICY "restaurants_update_admin" ON restaurants
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM admin_profiles ap
    WHERE ap.id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM admin_profiles ap
    WHERE ap.id = auth.uid()
  )
);
