import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const { client_ip, client_fingerprint } = await req.json();
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: blocked } = await supabase.from('blocked_entities').select('id').eq('value', client_ip).single();

  if (blocked) {
    return new Response(JSON.stringify({ blocked: true }), { status: 200 });
  }

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('client_ip', client_ip)
    .in('status', ['PENDING', 'ACCEPTED', 'ON_THE_WAY'])
    .gte('created_at', twoHoursAgo);

  return new Response(
    JSON.stringify({
      blocked: false,
      active_orders: count || 0,
      suspicious: (count || 0) >= 1,
      fingerprint_received: Boolean(client_fingerprint)
    }),
    { status: 200 }
  );
});
