import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const projectUrl = Deno.env.get('PROJECT_URL') ?? Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(projectUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized user' }), { status: 401 });
    }

    const { data: adminProfile } = await userClient
      .from('admin_profiles')
      .select('id')
      .eq('id', userData.user.id)
      .maybeSingle();

    if (!adminProfile) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const serviceClient = createClient(projectUrl, serviceKey);

    if (body.action === 'list_pending') {
      const { data, error } = await serviceClient
        .from('restaurants')
        .select('*')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return new Response(JSON.stringify({ items: data ?? [] }), { status: 200 });
    }

    if (body.action === 'update_status') {
      const status = body.status === 'ACTIVE' ? 'ACTIVE' : body.status === 'SUSPENDED' ? 'SUSPENDED' : null;
      if (!status || !body.restaurant_id) {
        return new Response(JSON.stringify({ error: 'restaurant_id/status required' }), { status: 400 });
      }

      const { error } = await serviceClient
        .from('restaurants')
        .update({ status })
        .eq('id', body.restaurant_id);

      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'Unsupported action' }), { status: 400 });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }
});
