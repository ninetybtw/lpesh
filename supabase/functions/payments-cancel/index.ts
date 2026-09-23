// LexPrep — Edge Function: отключить автопродление подписки.
//
// Раньше "Отменить подписку" в профиле было чисто локальным флагом
// (localStorage.lexprep_sub_cancelled) — ничего не мешало follow-up
// автосписанию всё равно списать деньги, потому что profiles.plan_auto_renew
// реальной подписки этот флаг не трогал. Теперь это по-настоящему
// отключает автосписание на сервере (payments-autocharge просто не
// увидит профиль в выборке — там прямое условие plan_auto_renew=true).
// Доступ к уже оплаченному периоду не трогаем — обнуляем только флаг,
// не plan_expires_at/plan_tier.
//
// Деплой:
//   supabase functions deploy payments-cancel

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

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) throw new Error('Not authenticated');

    const { autoRenew } = await req.json();
    if (typeof autoRenew !== 'boolean') throw new Error('autoRenew должен быть true/false');

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { error: updateErr } = await adminClient
      .from('profiles')
      .update({ plan_auto_renew: autoRenew })
      .eq('id', caller.id);
    if (updateErr) throw updateErr;

    return new Response(JSON.stringify({ ok: true, autoRenew }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
