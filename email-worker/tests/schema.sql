-- Throwaway local database ONLY; not a platform migration.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
CREATE TABLE public.restaurants(id uuid PRIMARY KEY,name text);
CREATE TABLE public.orders(id uuid PRIMARY KEY,client_user_id uuid REFERENCES auth.users(id),restaurant_id uuid REFERENCES public.restaurants(id),
 status text,reference_code text,order_number integer,delivered_at timestamptz,items jsonb,
 total numeric,adjusted_total numeric,delivery_amount numeric,commission_amount numeric,payment_method text);
CREATE TABLE public.order_picking_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid REFERENCES public.orders(id),
 requested_name text,substitute_name text,picked_quantity numeric,picked_price numeric,status text,created_at timestamptz DEFAULT now());
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
