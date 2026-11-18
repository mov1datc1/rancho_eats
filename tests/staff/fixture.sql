-- Disposable local database only. Never apply this fixture to a hosted project.
CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz DEFAULT now(),last_sign_in_at timestamptz,encrypted_password text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE admin_profiles(id uuid PRIMARY KEY REFERENCES auth.users,email text NOT NULL);
CREATE TABLE app_settings(setting_key text PRIMARY KEY,value jsonb);
CREATE TABLE restaurants(id uuid PRIMARY KEY,owner_id uuid REFERENCES auth.users,name text,email text,type text DEFAULT 'Pizzería',status text DEFAULT 'ACTIVE',created_at timestamptz DEFAULT now());
CREATE TYPE order_status AS ENUM('PENDING','ACCEPTED','PREPARING','PICKING','ADJUSTED','READY','ON_THE_WAY','DELIVERED','CANCELLED','REJECTED');
CREATE TABLE orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),restaurant_id uuid REFERENCES restaurants,client_user_id uuid REFERENCES auth.users,order_number integer GENERATED ALWAYS AS IDENTITY,reference_code text,status order_status DEFAULT 'PENDING',delivery_driver_id uuid,delivery_type text DEFAULT 'delivery',commission_amount numeric,delivery_amount numeric,total numeric,adjusted_total numeric,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),client_name text,items jsonb,response_deadline timestamptz DEFAULT now()+interval '10 minutes',proposal_expires_at timestamptz,accepted_at timestamptz,rejection_reason text);
CREATE TABLE commission_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),restaurant_id uuid REFERENCES restaurants,period_start date,period_end date,orders_count int,total_commission numeric(10,2),paid_at timestamptz DEFAULT now(),paid_by uuid REFERENCES auth.users,notes text,created_at timestamptz DEFAULT now());
CREATE TABLE app_categories(name text,flow_type text);
INSERT INTO app_categories VALUES('Pizzería','prepared'),('Tiendas','picked');
CREATE TABLE delivery_cycles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid REFERENCES orders,state text);
CREATE TABLE operation_audit(id bigint GENERATED ALWAYS AS IDENTITY,order_id uuid,actor uuid,action text,details jsonb,created_at timestamptz DEFAULT now());
CREATE TABLE order_incidents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid REFERENCES orders,cause text,status text,description text,resolution text,created_at timestamptz DEFAULT now());
CREATE TABLE business_enquiries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_number int,business_name text,contact_name text,email text,phone text,city text,category text,state text,created_at timestamptz DEFAULT now());
CREATE FUNCTION public.admin_reset_restaurant_password(p_restaurant_id uuid,p_password text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_restaurant restaurants;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'not_authorized';END IF;
 SELECT * INTO v_restaurant FROM restaurants WHERE id=p_restaurant_id;
 UPDATE auth.users SET encrypted_password=p_password WHERE id=v_restaurant.owner_id;
END $$;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
GRANT SELECT ON restaurants,admin_profiles TO authenticated;
INSERT INTO auth.users(id,email) SELECT ('61000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'user'||i||'@example.invalid' FROM generate_series(1,8)i;
INSERT INTO admin_profiles SELECT id,email FROM auth.users WHERE email='user1@example.invalid';
INSERT INTO restaurants(id,owner_id,name,email) VALUES('61000000-0000-0000-0000-000000000010','61000000-0000-0000-0000-000000000001','Negocio QA','user1@example.invalid');
INSERT INTO orders(id,restaurant_id,status,total,commission_amount,delivery_amount,client_name) VALUES('61000000-0000-0000-0000-000000000020','61000000-0000-0000-0000-000000000010','PENDING',123.45,8.45,15,'Cliente QA');
INSERT INTO orders(id,restaurant_id,status,total,commission_amount,delivery_amount,client_name) VALUES('61000000-0000-0000-0000-000000000021','61000000-0000-0000-0000-000000000010','DELIVERED',123.45,8.45,15,'Cliente QA');
CREATE FUNCTION public.can_manage_business(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) OR EXISTS(SELECT 1 FROM restaurants WHERE id=p_id AND owner_id=auth.uid()) $$;
