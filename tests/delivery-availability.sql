-- Only run in a disposable database. Minimal fixture tests migration 055's admission rule;
-- this does not replace the full platform RLS/coverage/price regression suite.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE TABLE public.restaurants(id uuid PRIMARY KEY);
CREATE TABLE public.orders(id integer PRIMARY KEY, restaurant_id uuid REFERENCES restaurants, delivery_type text, status text DEFAULT 'PENDING');
\ir ../supabase/migrations/055_delivery_availability.sql
BEGIN;
INSERT INTO restaurants(id) VALUES ('00000000-0000-0000-0000-000000000001');
INSERT INTO orders VALUES (1,'00000000-0000-0000-0000-000000000001','delivery','PENDING');
UPDATE restaurants SET delivery_enabled=false;
DO $$ BEGIN
 BEGIN
  INSERT INTO orders VALUES (2,'00000000-0000-0000-0000-000000000001','delivery','PENDING');
  RAISE EXCEPTION 'TEST: paused delivery was admitted';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM <> 'Actualmente no tenemos entrega a domicilio, solo para recoger.' THEN RAISE; END IF;
 END;
 BEGIN
  INSERT INTO orders VALUES (3,'00000000-0000-0000-0000-000000000001',NULL,'PENDING');
  RAISE EXCEPTION 'TEST: legacy NULL delivery bypassed pause';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM <> 'Actualmente no tenemos entrega a domicilio, solo para recoger.' THEN RAISE; END IF;
 END;
END $$;
INSERT INTO orders VALUES (4,'00000000-0000-0000-0000-000000000001','pickup','PENDING');
UPDATE orders SET status='ACCEPTED' WHERE id=1;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM orders WHERE id=1 AND status='ACCEPTED') THEN RAISE EXCEPTION 'Existing delivery modified'; END IF;
 IF has_function_privilege('authenticated','public.check_delivery_availability()','execute') THEN RAISE EXCEPTION 'Direct execute leaked'; END IF;
END $$;
UPDATE restaurants SET delivery_enabled=true;
INSERT INTO orders VALUES (5,'00000000-0000-0000-0000-000000000001','delivery','PENDING');
ROLLBACK;
