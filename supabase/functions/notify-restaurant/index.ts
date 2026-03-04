import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(async (req) => {
  const body = await req.json();
  console.log('Nuevo pedido para restaurante:', body.restaurant_id);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
