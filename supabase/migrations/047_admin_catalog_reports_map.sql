BEGIN;
ALTER TABLE app_categories ADD COLUMN IF NOT EXISTS icon_url text;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS pickup_instructions text;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS location_verified_at timestamptz;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS location_verified_by uuid REFERENCES auth.users(id);
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('category-icons','category-icons',true,2097152,ARRAY['image/png','image/webp']) ON CONFLICT(id) DO NOTHING;
CREATE POLICY category_icon_read ON storage.objects FOR SELECT USING(bucket_id='category-icons');
CREATE POLICY category_icon_admin_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='category-icons' AND EXISTS(SELECT 1 FROM public.admin_profiles WHERE id=auth.uid()));
UPDATE app_categories SET icon_url='https://www.pide-ya.app/category-icons/'||CASE name WHEN 'Restaurantes' THEN 'restaurantes' WHEN 'Farmacia' THEN 'farmacia' WHEN 'Carnicería' THEN 'carniceria' WHEN 'Frutería' THEN 'fruteria' WHEN 'Pescadería' THEN 'pescaderia' WHEN 'Cremería' THEN 'cremeria' WHEN 'Tiendas' THEN 'tiendas' ELSE 'otros' END||'.svg' WHERE icon_url IS NULL;
CREATE FUNCTION admin_save_category(p_id uuid,p_name text,p_flow text,p_mode text,p_sort integer,p_icon text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old app_categories; result uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'No autorizado';END IF;
 IF length(trim(p_name)) NOT BETWEEN 2 AND 50 OR p_flow NOT IN('prepared','picked','pharmacy') OR p_mode NOT IN('closed','pilot','public') OR p_sort NOT BETWEEN 0 AND 999 THEN RAISE EXCEPTION 'Datos de categoría inválidos';END IF;
 IF p_icon IS NOT NULL AND (length(p_icon)>2048 OR p_icon NOT LIKE 'https://%') THEN RAISE EXCEPTION 'Icono inválido';END IF;
 IF EXISTS(SELECT 1 FROM app_categories WHERE lower(trim(name))=lower(trim(p_name)) AND id IS DISTINCT FROM p_id) THEN RAISE EXCEPTION 'Ya existe una categoría con ese nombre';END IF;
 IF p_id IS NOT NULL THEN
 SELECT * INTO old FROM app_categories WHERE id=p_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Categoría no encontrada';END IF;
 IF old.name<>trim(p_name) AND EXISTS(SELECT 1 FROM restaurants WHERE type=old.name) THEN RAISE EXCEPTION 'No se puede renombrar una categoría con negocios asociados';END IF;
 IF old.flow_type<>p_flow AND EXISTS(SELECT 1 FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE r.type=old.name AND o.status NOT IN('DELIVERED','CANCELLED','REJECTED')) THEN RAISE EXCEPTION 'Hay pedidos activos: cambia el flujo al terminarlos';END IF;
 UPDATE app_categories SET name=trim(p_name),flow_type=p_flow,release_mode=p_mode,is_active=p_mode<>'closed',sort_order=p_sort,icon_url=p_icon WHERE id=p_id RETURNING id INTO result;
 ELSE
 INSERT INTO app_categories(name,emoji,flow_type,release_mode,is_active,sort_order,icon_url) VALUES(trim(p_name),'',p_flow,'closed',false,p_sort,p_icon) RETURNING id INTO result;
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION admin_business_map() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'No autorizado';END IF;
 RETURN jsonb_build_object('businesses',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM(SELECT id,name,type,status,is_open,address,lat,lng,delivery_radius_km,pickup_instructions,location_verified_at FROM restaurants ORDER BY name LIMIT 2000)r),'[]'),'total_businesses',(SELECT count(*) FROM restaurants),'orders',coalesce((SELECT jsonb_agg(to_jsonb(o)) FROM(SELECT o.id,o.order_number,o.restaurant_id,r.name restaurant_name,o.status,o.created_at,o.client_lat,o.client_lng,o.delivery_driver_name,o.driver_last_lat,o.driver_last_lng,o.driver_location_updated_at,o.driver_location_accuracy_m,r.lat shop_lat,r.lng shop_lng FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.status NOT IN('DELIVERED','CANCELLED','REJECTED') ORDER BY o.created_at LIMIT 1000)o),'[]'),'active_orders',(SELECT count(*) FROM orders WHERE status NOT IN('DELIVERED','CANCELLED','REJECTED')),'as_of',now());
END $$;
CREATE FUNCTION admin_platform_report(p_from date,p_to date,p_business uuid DEFAULT NULL,p_category text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin_profiles WHERE id=auth.uid()) THEN RAISE EXCEPTION 'No autorizado';END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>1096 THEN RAISE EXCEPTION 'Usa un periodo de hasta tres años';END IF;
 WITH f AS MATERIALIZED(SELECT o.*,r.name,r.type FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.created_at>=p_from::timestamp AT TIME ZONE 'America/Mexico_City' AND o.created_at<(p_to+1)::timestamp AT TIME ZONE 'America/Mexico_City' AND(p_business IS NULL OR o.restaurant_id=p_business)AND(p_category IS NULL OR coalesce(o.category_snapshot,r.type)=p_category)),
 stats AS(SELECT count(*) total,count(*)FILTER(WHERE status='DELIVERED') delivered,count(*)FILTER(WHERE status='CANCELLED') cancelled,count(*)FILTER(WHERE status='REJECTED') rejected,count(*)FILTER(WHERE status NOT IN('DELIVERED','CANCELLED','REJECTED')) active,coalesce(sum(total)FILTER(WHERE status='DELIVERED'),0) sales,coalesce(sum(commission_amount)FILTER(WHERE status='DELIVERED'),0) commission,coalesce(sum(delivery_amount)FILTER(WHERE status='DELIVERED'),0) delivery_fees,round(avg(total)FILTER(WHERE status='DELIVERED'),2) average_ticket,count(DISTINCT client_user_id) customers,
 round(avg(extract(epoch FROM accepted_at-created_at)/60)FILTER(WHERE accepted_at>=created_at)::numeric,1) acceptance_minutes,
 round(avg(extract(epoch FROM delivered_at-created_at)/60)FILTER(WHERE status='DELIVERED' AND delivered_at>=created_at)::numeric,1) cycle_minutes,
 count(*)FILTER(WHERE status='DELIVERED' AND delivered_at>=created_at) timed_deliveries FROM f),
 shops AS(SELECT restaurant_id,name,type,count(*) total,count(*)FILTER(WHERE status='DELIVERED') delivered,count(*)FILTER(WHERE status IN('CANCELLED','REJECTED')) failed,coalesce(sum(total)FILTER(WHERE status='DELIVERED'),0) sales,coalesce(sum(commission_amount)FILTER(WHERE status='DELIVERED'),0) commission FROM f GROUP BY restaurant_id,name,type),
 daily AS(SELECT (created_at AT TIME ZONE 'America/Mexico_City')::date AS "day",count(*) orders,count(*)FILTER(WHERE status='DELIVERED') delivered FROM f GROUP BY 1),
 reasons AS(SELECT coalesce(nullif(rejection_reason,''),'Sin motivo registrado') reason,count(*) count FROM f WHERE status IN('REJECTED','CANCELLED') GROUP BY 1 ORDER BY count(*) DESC LIMIT 10),
 repeat_users AS(SELECT client_user_id FROM f WHERE status='DELIVERED' AND client_user_id IS NOT NULL GROUP BY 1 HAVING count(*)>1)
 SELECT jsonb_build_object('summary',(SELECT to_jsonb(stats) FROM stats),'businesses',coalesce((SELECT jsonb_agg(to_jsonb(shops) ORDER BY sales DESC) FROM shops),'[]'),'daily',coalesce((SELECT jsonb_agg(to_jsonb(daily) ORDER BY "day") FROM daily),'[]'),'reasons',coalesce((SELECT jsonb_agg(to_jsonb(reasons)) FROM reasons),'[]'),'repeat_customers',(SELECT count(*) FROM repeat_users),'open_incidents',(SELECT count(*) FROM order_incidents i JOIN f ON f.id=i.order_id WHERE i.status<>'RESOLVED'),'cash_pending',(SELECT coalesce(sum(greatest(0,coalesce(c.cash_collected,0)-coalesce(c.cash_received,0))),0) FROM delivery_cycles c JOIN f ON f.id=c.order_id WHERE c.closed_at IS NULL)) INTO result;RETURN result;
END $$;
REVOKE ALL ON FUNCTION admin_save_category(uuid,text,text,text,integer,text),admin_business_map(),admin_platform_report(date,date,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_save_category(uuid,text,text,text,integer,text),admin_business_map(),admin_platform_report(date,date,uuid,text) TO authenticated;
COMMIT;
