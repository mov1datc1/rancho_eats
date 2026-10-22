-- Run only against a disposable PostgreSQL database, using psql -v ON_ERROR_STOP=1.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE TABLE restaurants(id uuid PRIMARY KEY,owner_id uuid,type text);
CREATE TABLE menu_items(id uuid PRIMARY KEY,restaurant_id uuid,allow_substitution boolean DEFAULT true);
CREATE TABLE orders(id uuid PRIMARY KEY,restaurant_id uuid,status text,items jsonb,picking_preferences jsonb,total numeric,subtotal numeric,adjusted_total numeric,picking_started_at timestamptz,picking_completed_at timestamptz,client_confirmed_at timestamptz);
CREATE TABLE order_picking_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid,menu_item_id uuid,requested_name text,requested_quantity numeric,requested_unit text,requested_price numeric,picked_quantity numeric,picked_price numeric,substitute_name text,substitute_price numeric,status text DEFAULT 'PENDING',client_response text DEFAULT 'PENDING',picked_at timestamptz,created_at timestamptz DEFAULT now());
\ir ../supabase/migrations/033_merchant_picking.sql
INSERT INTO restaurants VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','Tiendas');
INSERT INTO orders(id,restaurant_id,status,items,total,subtotal) VALUES('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','ACCEPTED','[{"name":"Manzanas","qty":2,"unit_price":10},{"name":"Agua","quantity":1,"price":15}]',60,35);
SET test.actor='00000000-0000-0000-0000-000000000004';
DO $$ BEGIN BEGIN PERFORM merchant_start_picking('00000000-0000-0000-0000-000000000003'); RAISE EXCEPTION 'test_failed'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='test_failed' THEN RAISE; END IF; END; END $$;
SET test.actor='00000000-0000-0000-0000-000000000002';
SELECT count(*) FROM merchant_start_picking('00000000-0000-0000-0000-000000000003');
SELECT count(*) FROM merchant_start_picking('00000000-0000-0000-0000-000000000003');
DO $$ DECLARE item uuid; amount numeric; BEGIN
 IF (SELECT count(*) FROM order_picking_items)<>2 THEN RAISE EXCEPTION 'Duplicate initialization';END IF;
 IF (SELECT sum(requested_price) FROM order_picking_items)<>35 THEN RAISE EXCEPTION 'Item normalization failed';END IF;
 BEGIN PERFORM merchant_finish_picking('00000000-0000-0000-0000-000000000003');RAISE EXCEPTION 'test_failed';EXCEPTION WHEN OTHERS THEN IF SQLERRM='test_failed' THEN RAISE;END IF;END;
 SELECT id INTO item FROM order_picking_items WHERE requested_name='Manzanas';
 BEGIN PERFORM merchant_pick_item(item,'ADJUSTED','NaN');RAISE EXCEPTION 'test_failed';EXCEPTION WHEN OTHERS THEN IF SQLERRM='test_failed' THEN RAISE;END IF;END;
 PERFORM merchant_pick_item(item,'ADJUSTED',1);
 BEGIN PERFORM merchant_pick_item(item,'PICKED');RAISE EXCEPTION 'test_failed';EXCEPTION WHEN OTHERS THEN IF SQLERRM='test_failed' THEN RAISE;END IF;END;
 SELECT id INTO item FROM order_picking_items WHERE requested_name='Agua';
 UPDATE restaurants SET type='Farmacia';
 BEGIN PERFORM merchant_pick_item(item,'SUBSTITUTED',null,'Otra',20);RAISE EXCEPTION 'test_failed';EXCEPTION WHEN OTHERS THEN IF SQLERRM='test_failed' THEN RAISE;END IF;END;
 PERFORM merchant_pick_item(item,'PICKED');
 amount:=merchant_finish_picking('00000000-0000-0000-0000-000000000003');
 IF amount<>50 THEN RAISE EXCEPTION 'Fees lost: %',amount;END IF;
 IF (SELECT status FROM orders LIMIT 1)<>'ADJUSTED' THEN RAISE EXCEPTION 'Confirmation not required';END IF;
 BEGIN PERFORM merchant_finish_picking('00000000-0000-0000-0000-000000000003');RAISE EXCEPTION 'test_failed';EXCEPTION WHEN OTHERS THEN IF SQLERRM='test_failed' THEN RAISE;END IF;END;
END $$;
SELECT 'merchant picking: authorization, idempotent initialization, both item formats, pending guard, invalid quantity, duplicate action, pharmacy, fee preservation, finalization guard PASS' AS result;

-- Product-level exclusions override a global preference allowing substitution.
INSERT INTO menu_items VALUES('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001',false);
UPDATE restaurants SET type='Frutería';
INSERT INTO orders(id,restaurant_id,status,items,total,subtotal,picking_preferences) VALUES('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','ACCEPTED','[{"id":"00000000-0000-0000-0000-000000000011","name":"Canasta","quantity":1,"price":229}]',254,229,'{"on_unavailable":"substitute"}');
SELECT count(*) FROM merchant_start_picking('00000000-0000-0000-0000-000000000012');
DO $$ DECLARE item uuid; BEGIN
 SELECT id INTO item FROM order_picking_items WHERE order_id='00000000-0000-0000-0000-000000000012';
 BEGIN PERFORM merchant_pick_item(item,'SUBSTITUTED',NULL,'Otra canasta',229); RAISE EXCEPTION 'test_failed'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='test_failed' THEN RAISE; END IF; END;
END $$;
UPDATE restaurants SET type='Restaurantes';
UPDATE orders SET status='ACCEPTED' WHERE id='00000000-0000-0000-0000-000000000012';
DO $$ BEGIN
 BEGIN PERFORM merchant_start_picking('00000000-0000-0000-0000-000000000012'); RAISE EXCEPTION 'test_failed'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='test_failed' THEN RAISE; END IF; END;
END $$;
