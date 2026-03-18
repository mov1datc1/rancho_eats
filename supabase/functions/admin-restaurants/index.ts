import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const projectUrl = Deno.env.get('PROJECT_URL') ?? Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(projectUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Unauthorized user' }, 401);

    const { data: adminProfile } = await userClient
      .from('admin_profiles')
      .select('id')
      .eq('id', userData.user.id)
      .maybeSingle();

    if (!adminProfile) return json({ error: 'Forbidden' }, 403);

    const body = await req.json().catch(() => ({}));
    const serviceClient = createClient(projectUrl, serviceKey);

    if (body.action === 'list_pending') {
      const { data, error } = await serviceClient
        .from('restaurants')
        .select('*')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return json({ items: data ?? [] });
    }

    if (body.action === 'update_status') {
      const status = body.status === 'ACTIVE' ? 'ACTIVE' : body.status === 'SUSPENDED' ? 'SUSPENDED' : null;
      if (!status || !body.restaurant_id) return json({ error: 'restaurant_id/status required' }, 400);

      const { error } = await serviceClient
        .from('restaurants')
        .update({ status })
        .eq('id', body.restaurant_id);

      if (error) throw error;
      return json({ ok: true });
    }

    if (body.action === 'reset_password') {
      const nextPassword = `${body.password ?? ''}`.trim();
      if (!body.restaurant_id || nextPassword.length < 8) {
        return json({ error: 'restaurant_id/password required, min 8 chars' }, 400);
      }

      const { data: restaurant, error: restaurantError } = await serviceClient
        .from('restaurants')
        .select('id,name,owner_id,email')
        .eq('id', body.restaurant_id)
        .maybeSingle();

      if (restaurantError) throw restaurantError;
      if (!restaurant?.owner_id) {
        return json({ error: 'Restaurant has no linked owner user' }, 400);
      }

      const { error: authError } = await serviceClient.auth.admin.updateUserById(restaurant.owner_id, {
        password: nextPassword,
        email: restaurant.email ?? undefined,
        email_confirm: true
      });

      if (authError) throw authError;
      return json({ ok: true, owner_id: restaurant.owner_id, restaurant_name: restaurant.name });
    }

    return json({ error: 'Unsupported action' }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: 'Internal error' }, 500);
  }
});
