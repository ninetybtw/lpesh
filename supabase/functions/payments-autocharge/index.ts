// LexPrep — Edge Function: автосписание по истекающим подпискам.
//
// Не вызывается фронтендом — только по расписанию (системный cron на
// сервере, см. инструкцию по деплою ниже), раз в сутки. Находит
// профили с plan_auto_renew=true и сохранённым tbank_rebill_id, у
// которых подписка истекает в ближайшие сутки, и пытается списать
// сохранённую карту через Т-Кассу (Init без Recurrent + Charge по
// RebillId — так работает повторное списание в API Т-Кассы).
//
// Сама подписка НЕ продлевается здесь напрямую — Charge приводит к тому
// же вебхуку payments-notification, что и обычная оплата (тот статус
// CONFIRMED и продлит profiles.plan_expires_at), чтобы вся логика
// начисления жила в одном месте и не могла разойтись между "первой
// оплатой" и "автопродлением".
//
// Защита от чужого вызова — не JWT (тут никакого пользователя нет), а
// собственный секрет AUTOCHARGE_SECRET, который знает только наш cron.
//
// Деплой:
//   supabase functions deploy payments-autocharge --no-verify-jwt
//   supabase secrets set AUTOCHARGE_SECRET=<любая длинная случайная строка>
// Затем на сервере — системный cron (не pg_cron, чтобы не зависеть от
// того, включено ли расширение в конкретной self-hosted сборке):
//   crontab -e
//   0 6 * * * curl -s -X POST "https://api.lexprep.ru/functions/v1/payments-autocharge?apikey=<ANON_KEY>" -H "X-Autocharge-Secret: <AUTOCHARGE_SECRET>"

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { tbankInit, tbankCharge, PRICES_KOPECKS, TIER_TITLES, PERIOD_TITLES, type TBankReceiptItem } from '../_shared/tbank.ts';

const PUBLIC_API_BASE = 'https://api.lexprep.ru';
const PUBLIC_SITE_BASE = 'https://lexprep.ru';

serve(async (req) => {
  try {
    const expectedSecret = Deno.env.get('AUTOCHARGE_SECRET')!;
    const gotSecret = req.headers.get('X-Autocharge-Secret');
    if (!expectedSecret || gotSecret !== expectedSecret) {
      return new Response('unauthorized', { status: 401 });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const terminalKey = Deno.env.get('TBANK_TERMINAL_KEY')!;
    const terminalPassword = Deno.env.get('TBANK_TERMINAL_PASSWORD')!;
    const taxation = Deno.env.get('TBANK_TAXATION') || 'usn_income';
    const vatTag = Deno.env.get('TBANK_VAT') || 'none';

    const adminClient = createClient(supabaseUrl, serviceKey);

    const windowEnd = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { data: dueProfiles, error: findErr } = await adminClient
      .from('profiles')
      .select('id, email, plan_tier, plan_billing_period, plan_expires_at, tbank_rebill_id')
      .eq('plan_auto_renew', true)
      .eq('is_banned', false)
      .not('tbank_rebill_id', 'is', null)
      .in('plan_tier', ['pro', 'max'])
      .lte('plan_expires_at', windowEnd);
    if (findErr) throw findErr;

    const results: Array<{ userId: string; ok: boolean; message?: string }> = [];

    for (const profile of dueProfiles || []) {
      try {
        const tier = profile.plan_tier as 'pro' | 'max';
        const period = (profile.plan_billing_period as 'monthly' | 'annual') || 'monthly';
        const amountKopecks = PRICES_KOPECKS[tier][period];
        const description = `Автопродление LexPrep «${TIER_TITLES[tier]}», ${PERIOD_TITLES[period]} оплата`;

        const { data: paymentRow, error: insertErr } = await adminClient
          .from('payments')
          .insert({
            user_id: profile.id,
            plan_tier: tier,
            billing_period: period,
            amount_kopecks: amountKopecks,
            status: 'pending',
            is_auto_charge: true
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
          customerKey: profile.id,
          // Без Recurrent: это НЕ регистрация новой привязки карты, а
          // обычный платёж, который сразу же довзыскиваем по RebillId.
          notificationUrl: `${PUBLIC_API_BASE}/functions/v1/payments-notification?apikey=${Deno.env.get('SUPABASE_ANON_KEY')}`,
          successUrl: `${PUBLIC_SITE_BASE}/profile.html?payment=success#subscription`,
          failUrl: `${PUBLIC_SITE_BASE}/profile.html?payment=fail#subscription`,
          receiptEmail: profile.email,
          receiptTaxation: taxation,
          receiptItem
        });

        if (!initResult.Success) {
          await adminClient.from('payments').update({
            status: 'failed',
            error_message: initResult.Message || initResult.Details || 'Init не удался'
          }).eq('id', paymentRow.id);
          results.push({ userId: profile.id, ok: false, message: initResult.Message });
          continue;
        }

        await adminClient.from('payments').update({ tbank_payment_id: String(initResult.PaymentId) }).eq('id', paymentRow.id);

        const chargeResult = await tbankCharge({
          terminalKey,
          password: terminalPassword,
          paymentId: String(initResult.PaymentId),
          rebillId: profile.tbank_rebill_id!
        });

        if (!chargeResult.Success) {
          await adminClient.from('payments').update({
            status: 'failed',
            error_message: chargeResult.Message || chargeResult.Details || 'Charge не удался'
          }).eq('id', paymentRow.id);
          results.push({ userId: profile.id, ok: false, message: chargeResult.Message });
          continue;
        }

        // Итоговое продление подписки — в payments-notification, когда
        // придёт вебхук CONFIRMED по этому же OrderId.
        results.push({ userId: profile.id, ok: true });
      } catch (e) {
        console.error('[payments-autocharge] ошибка на пользователе', profile.id, e?.message);
        results.push({ userId: profile.id, ok: false, message: e?.message });
      }
    }

    console.log('[payments-autocharge] обработано:', results.length, JSON.stringify(results));
    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('[payments-autocharge] общая ошибка:', err?.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
