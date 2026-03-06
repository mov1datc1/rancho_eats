-- RPCs para dashboard completo de super admin

CREATE OR REPLACE FUNCTION public.admin_dashboard_summary()
RETURNS TABLE (
  active_restaurants INTEGER,
  pending_restaurants INTEGER,
  orders_month INTEGER,
  moved_month NUMERIC,
  blocked_entities INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.id = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*)::INTEGER FROM public.restaurants WHERE status = 'ACTIVE'),
    (SELECT COUNT(*)::INTEGER FROM public.restaurants WHERE status = 'PENDING'),
    (SELECT COUNT(*)::INTEGER FROM public.orders WHERE created_at >= NOW() - INTERVAL '30 days'),
    COALESCE((SELECT SUM(total) FROM public.orders WHERE created_at >= NOW() - INTERVAL '30 days' AND status IN ('DELIVERED','ACCEPTED','ON_THE_WAY')), 0),
    (SELECT COUNT(*)::INTEGER FROM public.blocked_entities);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_restaurants_overview()
RETURNS TABLE (
  id UUID,
  name TEXT,
  status public.restaurant_status,
  orders_today INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.id = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.name,
    r.status,
    COUNT(o.id)::INTEGER AS orders_today
  FROM public.restaurants r
  LEFT JOIN public.orders o
    ON o.restaurant_id = r.id
   AND o.created_at::date = CURRENT_DATE
  GROUP BY r.id, r.name, r.status
  ORDER BY CASE r.status
    WHEN 'ACTIVE' THEN 0
    WHEN 'PENDING' THEN 1
    ELSE 2
  END, r.created_at DESC
  LIMIT 8;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_recent_activity()
RETURNS TABLE (
  kind TEXT,
  title TEXT,
  detail TEXT,
  happened_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.id = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  WITH events AS (
    SELECT
      'ORDER_CREATED'::TEXT AS kind,
      'Nuevo pedido #' || o.order_number AS title,
      COALESCE(r.name, 'Restaurante') || ' · ' || COALESCE(o.client_location_note, 'Sin referencia') AS detail,
      o.created_at AS happened_at
    FROM public.orders o
    LEFT JOIN public.restaurants r ON r.id = o.restaurant_id

    UNION ALL

    SELECT
      'ORDER_DELIVERED',
      'Pedido #' || o.order_number || ' entregado',
      COALESCE(r.name, 'Restaurante') || ' · ' || COALESCE(o.client_name, 'Cliente'),
      o.updated_at
    FROM public.orders o
    LEFT JOIN public.restaurants r ON r.id = o.restaurant_id
    WHERE o.status = 'DELIVERED'

    UNION ALL

    SELECT
      'ORDER_CANCELLED',
      'Pedido #' || o.order_number || ' cancelado',
      COALESCE(r.name, 'Restaurante') || ' · cancelado por cliente',
      COALESCE(o.cancelled_at, o.updated_at)
    FROM public.orders o
    LEFT JOIN public.restaurants r ON r.id = o.restaurant_id
    WHERE o.status = 'CANCELLED'

    UNION ALL

    SELECT
      'REGISTRATION_PENDING',
      'Registro nuevo: ' || r.name,
      'Solicitud pendiente de aprobación',
      r.created_at
    FROM public.restaurants r
    WHERE r.status = 'PENDING'

    UNION ALL

    SELECT
      'SPAM_BLOCK',
      'Entidad bloqueada: ' || b.value,
      COALESCE(b.reason, 'Posible spam'),
      b.created_at
    FROM public.blocked_entities b
  )
  SELECT e.kind, e.title, e.detail, e.happened_at
  FROM events e
  ORDER BY e.happened_at DESC
  LIMIT 8;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_antispam_overview()
RETURNS TABLE (
  entity TEXT,
  orders_today INTEGER,
  cancelled INTEGER,
  rejected INTEGER,
  last_order_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.id = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(NULLIF(o.client_ip, ''), 'Sin IP') AS entity,
    COUNT(*) FILTER (WHERE o.created_at::date = CURRENT_DATE)::INTEGER AS orders_today,
    COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::INTEGER AS cancelled,
    COUNT(*) FILTER (WHERE o.status = 'REJECTED')::INTEGER AS rejected,
    MAX(o.created_at) AS last_order_at
  FROM public.orders o
  GROUP BY COALESCE(NULLIF(o.client_ip, ''), 'Sin IP')
  ORDER BY orders_today DESC, last_order_at DESC
  LIMIT 10;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_orders_by_restaurant_30d()
RETURNS TABLE (
  restaurant_name TEXT,
  orders_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles ap WHERE ap.id = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    r.name AS restaurant_name,
    COUNT(o.id)::INTEGER AS orders_count
  FROM public.restaurants r
  LEFT JOIN public.orders o
    ON o.restaurant_id = r.id
   AND o.created_at >= NOW() - INTERVAL '30 days'
  GROUP BY r.name
  ORDER BY orders_count DESC, r.name
  LIMIT 8;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_dashboard_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_restaurants_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_recent_activity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_antispam_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_orders_by_restaurant_30d() TO authenticated;
