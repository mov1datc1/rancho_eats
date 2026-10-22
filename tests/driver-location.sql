-- Disposable database only.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE TABLE driver_profiles(id uuid PRIMARY KEY, restaurant_id uuid, access_token text, is_active boolean, last_location_at timestamptz);
CREATE TABLE orders(id uuid PRIMARY KEY,restaurant_id uuid,delivery_driver_id uuid,status text,created_at timestamptz DEFAULT now(),driver_last_lat double precision,driver_last_lng double precision,driver_location_accuracy_m double precision,driver_location_updated_at timestamptz);
CREATE TABLE driver_locations(driver_id uuid PRIMARY KEY,order_id uuid,lat double precision,lng double precision,accuracy_m double precision,heading double precision,speed_mps double precision,recorded_at timestamptz,updated_at timestamptz);
\ir ../supabase/migrations/035_driver_location_assignment.sql
INSERT INTO driver_profiles VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','test-code',true,null);
INSERT INTO orders(id,restaurant_id,delivery_driver_id,status) VALUES
('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','ACCEPTED'),
('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000010',null,'ACCEPTED');
DO $$ BEGIN
 BEGIN PERFORM driver_update_location('test-code','00000000-0000-0000-0000-000000000003',20,-102); RAISE EXCEPTION 'test_failed'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='test_failed' THEN RAISE; END IF; END;
 BEGIN PERFORM driver_update_location('invalid',null,20,-102); RAISE EXCEPTION 'test_failed'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='test_failed' THEN RAISE; END IF; END;
 BEGIN PERFORM driver_update_location('test-code',null,999,-102); RAISE EXCEPTION 'test_failed'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='test_failed' THEN RAISE; END IF; END;
 PERFORM driver_update_location('test-code','00000000-0000-0000-0000-000000000002',20,-102);
 IF (SELECT status FROM orders WHERE id='00000000-0000-0000-0000-000000000002') <> 'ACCEPTED' THEN RAISE EXCEPTION 'GPS started delivery'; END IF;
 IF (SELECT driver_last_lat FROM orders WHERE id='00000000-0000-0000-0000-000000000003') IS NOT NULL THEN RAISE EXCEPTION 'Cross-driver write'; END IF;
 UPDATE orders SET status='DELIVERED' WHERE id='00000000-0000-0000-0000-000000000002';
 BEGIN PERFORM driver_update_location('test-code','00000000-0000-0000-0000-000000000002',20,-102); RAISE EXCEPTION 'test_failed'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='test_failed' THEN RAISE; END IF; END;
END $$;
SELECT 'PASS: invalid token, foreign order, bounds, explicit start, completed order';
