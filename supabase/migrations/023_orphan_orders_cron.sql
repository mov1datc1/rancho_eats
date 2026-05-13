-- Migration 023: Auto-expire orphan orders after 2 hours
-- Uses pg_cron to run every 15 minutes

-- Enable pg_cron extension (Supabase has it available)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Function: cancel stale orders older than 2 hours
CREATE OR REPLACE FUNCTION cancel_orphan_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cancelled_count integer;
BEGIN
  UPDATE orders
  SET 
    status = 'CANCELLED',
    cancelled_at = NOW(),
    cancelled_by = 'SYSTEM',
    rejection_reason = 'Pedido expirado automáticamente después de 2 horas sin atención.'
  WHERE status IN ('PENDING', 'ACCEPTED', 'ON_THE_WAY')
    AND created_at < NOW() - INTERVAL '2 hours';
  
  GET DIAGNOSTICS cancelled_count = ROW_COUNT;
  
  -- Log to console for monitoring
  IF cancelled_count > 0 THEN
    RAISE NOTICE '[PideYa] Auto-cancelled % orphan orders', cancelled_count;
  END IF;
  
  RETURN cancelled_count;
END;
$$;

-- Schedule: run every 15 minutes
SELECT cron.schedule(
  'cancel-orphan-orders',     -- job name
  '*/15 * * * *',             -- every 15 minutes
  $$SELECT cancel_orphan_orders()$$
);

-- Grant execute permission
GRANT EXECUTE ON FUNCTION cancel_orphan_orders() TO postgres;
