// LexPrep — Edge Function: старт оплаты подписки через Т-Кассу.
//
// Пользователь жмёт "Оформить подписку" на index.html/profile.html,
// фронт зовёт эту функцию с {planTier, billingPeriod}, функция:
//   1. создаёт запись в public.payments (status=pending) через service_role,
//   2. вызывает Init у Т-Кассы с Recurrent=Y (чтобы банк вернул RebillId
//      в вебхуке после успешной оплаты — это и есть привязка карты для
//      автопродления),
//   3. отдаёт фронту PaymentURL, куда редиректить пользователя.
//
// Деньги списываются НЕ здесь — только после реальной оплаты Т-Касса
// дёрнет payments-notification, и только там мы продлеваем подписку.
//
// Деплой:
//   supabase functions deploy payments-init
// Секреты — TBANK_TERMINAL_KEY/TBANK_TERMINAL_PASSWORD — уже должны быть
// в environment контейнера functions (см. supabase/payments.sql и README
// по деплою в конце этого файла).
// Перед первым деплоем выполни supabase/payments.sql в SQL Editor.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { tbankInit, type TBankReceiptItem, PRICES_KOPECKS, TIER_TITLES, PERIOD_TITLES } from '../_shared/tbank.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const PUBLIC_API_BASE = 'https://api.lexprep.ru';
const PUBLIC_SITE_BASE = 'https://lexprep.ru';

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
    const terminalKey = Deno.env.get('TBANK_TERMINAL_KEY')!;
    const terminalPassword = Deno.env.get('TBANK_TERMINAL_PASSWORD')!;
    const taxation = Deno.env.get('TBANK_TAXATION') || 'usn_income';
    const vatTag = Deno.env.get('TBANK_VAT') || 'none';

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) throw new Error('Not authenticated');

    const { planTier, billingPeriod } = await req.json();
    if (!PRICES_KOPECKS[planTier]) throw new Error('planTier должен быть "pro" или "max"');
    if (!PERIOD_TITLES[billingPeriod]) throw new Error('billingPeriod должен быть "monthly" или "annual"');

    const amountKopecks = PRICES_KOPECKS[planTier][billingPeriod];
    const description = `Подписка LexPrep «${TIER_TITLES[planTier]}», ${PERIOD_TITLES[billingPeriod]} оплата`;

    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: profile, error: profileErr } = await adminClient
      .from('profiles')
      .select('email, is_banned')
      .eq('id', caller.id)
      .single();
    if (profileErr) throw profileErr;
    if (profile.is_banned) throw new Error('Аккаунт заблокирован.');
    if (!profile.email) throw new Error('У аккаунта не указан email — нужен для чека.');

    const { data: paymentRow, error: insertErr } = await adminClient
      .from('payments')
      .insert({
        user_id: caller.id,
        plan_tier: planTier,
        billing_period: billingPeriod,
        amount_kopecks: amountKopecks,
        status: 'pending'
      })
      .select('id')
      .single();
    if (insertErr) throw insertErr;

    const receiptItem: TBankReceiptItem = {
      Name: description.slice(0, 128),
      Price: amountKopecks,
      Quantity: 1,
      Amount: amountKopecks,
      Tax: vatTag
    };

    const initResult = await tbankInit({
      terminalKey,
      password: terminalPassword,
      amountKopecks,
      orderId: paymentRow.id,
      description,
      customerKey: caller.id,
      recurrent: true,
      // apikey в query, а не в заголовке — вебхук дёргает сервер Т-Кассы,
      // он не умеет слать Supabase-специфичные заголовки. Kong у
      // self-hosted Supabase принимает apikey и так.
      notificationUrl: `${PUBLIC_API_BASE}/functions/v1/payments-notification?apikey=${anonKey}`,
      successUrl: `${PUBLIC_SITE_BASE}/profile.html?payment=success#subscription`,
      failUrl: `${PUBLIC_SITE_BASE}/profile.html?payment=fail#subscription`,
      receiptEmail: profile.email,
      receiptTaxation: taxation,
      receiptItem
    });

    if (!initResult.Success) {
      await adminClient
        .from('payments')
        .update({ status: 'failed', error_message: initResult.Message || initResult.Details || 'Init не удался' })
        .eq('id', paymentRow.id);
      return new Response(JSON.stringify({
        error: initResult.Message || 'Не удалось создать платёж. Попробуйте ещё раз.'
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await adminClient
      .from('payments')
      .update({ tbank_payment_id: String(initResult.PaymentId) })
      .eq('id', paymentRow.id);

    return new Response(JSON.stringify({ paymentUrl: initResult.PaymentURL }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
