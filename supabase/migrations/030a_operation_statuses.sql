-- Prerequisite for 031–039. Commit enum additions before using them in transactions.
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'PREPARING';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'PICKING';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'ADJUSTED';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'READY';
