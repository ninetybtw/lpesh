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

// Напоминания об истечении подписки — за 3 дня и за 1 день. Считаем по
// календарным дням (UTC), а не по точным 72/24 часам — иначе при
// суточном cron легко "проскочить" нужный день из-за времени срабатывания.
// Каждое напоминание шлётся ровно один раз за период — флаг
// plan_expiry_notice_*_sent сбрасывается при продлении/оплате
// (см. payments-notification), так что для новой даты истечения
// напоминания снова сработают.
async function sendExpiryReminders(adminClient: ReturnType<typeof createClient>) {
  const { data: profiles, error } = await adminClient
    .from('profiles')
    .select('id, plan_tier, plan_expires_at, plan_auto_renew, plan_billing_period, plan_expiry_notice_3d_sent, plan_expiry_notice_1d_sent')
    .in('plan_tier', ['pro', 'max'])
    .eq('is_banned', false)
    .not('plan_expires_at', 'is', null)
    .gt('plan_expires_at', new Date().toISOString());
  if (error) {
    console.error('[payments-autocharge] не удалось получить профили для напоминаний:', error.message);
    return;
  }

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  for (const profile of profiles || []) {
    try {
      const expiresAt = new Date(profile.plan_expires_at);
      const expiresDayStart = new Date(expiresAt);
      expiresDayStart.setUTCHours(0, 0, 0, 0);
      const daysLeft = Math.round((expiresDayStart.getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000));

      const tierLabel = TIER_TITLES[profile.plan_tier] || profile.plan_tier;
      const dateLabel = expiresAt.toLocaleDateString('ru-RU');
      const renewNote = profile.plan_auto_renew
        ? `Автопродление включено — спишется ${PRICES_KOPECKS[profile.plan_tier]?.[profile.plan_billing_period || 'monthly'] / 100 || ''} ₽.`
        : 'Автопродление выключено — после этой даты тариф станет «Базовым».';

      if (daysLeft === 3 && !profile.plan_expiry_notice_3d_sent) {
        await adminClient.from('notifications').insert({
          user_id: profile.id,
          type: 'plan_expiry_reminder',
          title: `Тариф «${tierLabel}» истекает через 3 дня`,
          body: `Действует до ${dateLabel}. ${renewNote}`,
          link: 'profile.html#subscription'
        });
        await adminClient.from('profiles').update({ plan_expiry_notice_3d_sent: true }).eq('id', profile.id);
      } else if (daysLeft === 1 && !profile.plan_expiry_notice_1d_sent) {
        await adminClient.from('notifications').insert({
          user_id: profile.id,
          type: 'plan_expiry_reminder',
          title: `Тариф «${tierLabel}» истекает завтра`,
          body: `Действует до ${dateLabel}. ${renewNote}`,
          link: 'profile.html#subscription'
        });
        await adminClient.from('profiles').update({ plan_expiry_notice_1d_sent: true }).eq('id', profile.id);
      }
    } catch (e) {
      console.error('[payments-autocharge] ошибка напоминания для', profile.id, e?.message);
    }
  }
}

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

    await sendExpiryReminders(adminClient);

    const windowEnd = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { data: dueProfiles, error: findErr } = await adminClient
      .from('profiles')
      .select('id, email, plan_tier, plan_billing_period, plan_expires_at, tbank_rebill_id, pending_plan_tier, pending_plan_billing_period')
      .eq('plan_auto_renew', true)
      .eq('is_banned', false)
      .not('tbank_rebill_id', 'is', null)
      .in('plan_tier', ['pro', 'max'])
      .lte('plan_expires_at', windowEnd);
    if (findErr) throw findErr;

    const results: Array<{ userId: string; ok: boolean; message?: string }> = [];

    for (const profile of dueProfiles || []) {
      try {
        // Запланированное понижение до "Базового" — оплата не нужна вообще,
        // просто переводим на бесплатный тариф в момент истечения текущего
        // оплаченного периода (см. payments-schedule-downgrade).
        if (profile.pending_plan_tier === 'basic') {
          const { error: downgradeErr } = await adminClient
            .from('profiles')
            .update({ plan_tier: 'basic', plan_auto_renew: false, pending_plan_tier: null, pending_plan_billing_period: null })
            .eq('id', profile.id);
          if (downgradeErr) throw downgradeErr;
          results.push({ userId: profile.id, ok: true });
          continue;
        }

        // Запланированное понижение до другого платного тарифа (например,
        // "Максимум" → "Про") — списываем уже за НОВЫЙ тариф/период, а не
        // за старый. pending_plan_tier/pending_plan_billing_period снимутся
        // в payments-notification при успешном подтверждении этого платежа.
        const tier = (profile.pending_plan_tier || profile.plan_tier) as 'pro' | 'max';
        const period = ((profile.pending_plan_tier ? profile.pending_plan_billing_period : profile.plan_billing_period) || 'monthly') as 'monthly' | 'annual';
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
