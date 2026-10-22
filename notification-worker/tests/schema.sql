-- Minimal isolated fixture. Never run this file on the application database.
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.admin_profiles(id uuid PRIMARY KEY REFERENCES auth.users(id));
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.restaurants(id uuid PRIMARY KEY,owner_id uuid REFERENCES auth.users(id));
CREATE TABLE public.driver_profiles(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),access_token text,is_active boolean DEFAULT true);
CREATE TABLE public.orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),restaurant_id uuid REFERENCES public.restaurants(id),client_user_id uuid REFERENCES auth.users(id),status text,delivery_driver_id uuid REFERENCES public.driver_profiles(id),client_confirmed_at timestamptz,driver_last_lat float,created_at timestamptz DEFAULT now());
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
GRANT USAGE ON SCHEMA public TO authenticated,anon,service_role;
GRANT SELECT ON public.driver_profiles TO authenticated;
