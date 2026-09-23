// LexPrep — Edge Function: отложенное понижение тарифа (без оплаты сейчас).
//
// Вызывается, когда пользователь с активной платной подпиской выбирает
// тариф НИЖЕ текущего (например, у него "Максимум", жмёт "Про"). Ничего
// не списывает и не меняет profiles.plan_tier прямо сейчас — только
// запоминает pending_plan_tier/pending_plan_billing_period. Смена
// применяется сама через payments-autocharge в день, когда истекает
// текущий (более дорогой) период — см. supabase/payments-downgrade.sql.
//
// Деплой:
//   supabase functions deploy payments-schedule-downgrade
// Перед первым деплоем выполни supabase/payments-downgrade.sql в SQL Editor.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const TIER_RANK: Record<string, number> = { basic: 0, pro: 1, max: 2 };

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

    const { planTier, billingPeriod } = await req.json();
    if (!(planTier in TIER_RANK)) throw new Error('planTier должен быть "basic", "pro" или "max"');
    if (planTier !== 'basic' && billingPeriod !== 'monthly' && billingPeriod !== 'annual') {
      throw new Error('billingPeriod должен быть "monthly" или "annual"');
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: profile, error: profileErr } = await adminClient
      .from('profiles')
      .select('plan_tier, plan_expires_at, is_banned')
      .eq('id', caller.id)
      .single();
    if (profileErr) throw profileErr;
    if (profile.is_banned) throw new Error('Аккаунт заблокирован.');

    const planActive = profile.plan_tier && profile.plan_tier !== 'basic'
      && profile.plan_expires_at && new Date(profile.plan_expires_at).getTime() > Date.now();
    if (!planActive) {
      throw new Error('Понижать нечего — сейчас нет активной платной подписки. Оформи подписку через обычную оплату.');
    }

    if (TIER_RANK[planTier] >= TIER_RANK[profile.plan_tier]) {
      throw new Error('Это не понижение тарифа — для повышения или продления используй обычную оплату (payments-init).');
    }

    const { error: updateErr } = await adminClient
      .from('profiles')
      .update({
        pending_plan_tier: planTier,
        pending_plan_billing_period: planTier === 'basic' ? null : billingPeriod
      })
      .eq('id', caller.id);
    if (updateErr) throw updateErr;

    return new Response(JSON.stringify({
      ok: true,
      effectiveFrom: profile.plan_expires_at,
      pendingTier: planTier,
      pendingBillingPeriod: planTier === 'basic' ? null : billingPeriod
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
