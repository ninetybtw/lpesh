// LexPrep — Edge Function: безвозвратное удаление аккаунта пользователя.
//
// Единственное место во всём проекте, где используется service_role —
// он живёт только здесь, в переменных окружения функции, и никогда не
// попадает во фронтенд. Удалить чужой auth.users через anon-ключ
// в принципе нельзя, поэтому это отдельная функция, а не запрос к таблице.
//
// Деплой:
//   supabase functions deploy admin-delete-user
// (service_role уже доступен функции автоматически как SUPABASE_SERVICE_ROLE_KEY,
// отдельно его прописывать не нужно)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing authorization header');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Клиент от имени вызывающего — только чтобы узнать, кто он и
    // действительно ли он админ. Никаких привилегированных операций
    // через него не выполняется.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) throw new Error('Not authenticated');

    const { data: callerProfile, error: profileErr } = await callerClient
      .from('profiles')
      .select('is_admin')
      .eq('id', caller.id)
      .single();
    if (profileErr) throw profileErr;
    if (!callerProfile?.is_admin) throw new Error('Not an admin');

    const { userId } = await req.json();
    if (!userId) throw new Error('userId is required');
    if (userId === caller.id) throw new Error('Нельзя удалить самого себя из админки');

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteErr) throw deleteErr;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
