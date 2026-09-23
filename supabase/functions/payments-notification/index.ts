// LexPrep — Edge Function: вебхук Т-Кассы (Notification).
//
// Банк дёргает этот URL сам, server-to-server, при любой смене статуса
// платежа — без JWT пользователя и без нашего apikey в заголовке (это
// чужой сервер, он не умеет ходить с Supabase-специфичными хедерами).
// Поэтому apikey передаём ЗАРАНЕЕ строкой запроса в самом NotificationURL
// (см. payments-init) — Kong у self-hosted Supabase принимает apikey и
// из query, и из заголовка. Подлинность самого запроса (что это правда
// от Т-Кассы, а не кто угодно, кто узнал этот URL) проверяем ОТДЕЛЬНО —
// подписью Token по паролю терминала (см. _shared/tbank.ts).
//
// Т-Касса ждёт от нас HTTP 200 с телом ровно "OK" (обычный текст, не
// JSON) — иначе будет повторять вебхук по расписанию. Отвечаем "OK"
// только когда реально обработали; на любую ошибку — не-200, пусть
// присылает повторно.
//
// Деплой:
//   supabase functions deploy payments-notification --no-verify-jwt
// Флаг --no-verify-jwt обязателен: платформа Supabase иначе завернёт
// запрос без Authorization ещё до нашего кода. Перед первым деплоем
// выполни supabase/payments.sql в SQL Editor.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyNotificationToken, PERIOD_DAYS } from '../_shared/tbank.ts';

serve(async (req) => {
  try {
    const payload = await req.json();
    console.log('[payments-notification] пришло уведомление:', JSON.stringify({ ...payload, Token: '(скрыт)' }));

    const terminalPassword = Deno.env.get('TBANK_TERMINAL_PASSWORD')!;
    const valid = await verifyNotificationToken(payload, terminalPassword);
    if (!valid) {
      console.error('[payments-notification] неверная подпись Token — игнорирую');
      return new Response('invalid token', { status: 400 });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const orderId = String(payload.OrderId || '');
    const { data: payment, error: findErr } = await adminClient
      .from('payments')
      .select('id, user_id, plan_tier, billing_period')
      .eq('id', orderId)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!payment) {
      // Платёж не наш (или id битый) — банку отвечаем ошибкой, чтобы не
      // делать вид, что мы что-то обработали.
      console.error('[payments-notification] платёж не найден по OrderId:', orderId);
      return new Response('payment not found', { status: 404 });
    }

    const status = String(payload.Status || '');

    if (status === 'CONFIRMED') {
      const { data: profile, error: profileErr } = await adminClient
        .from('profiles')
        .select('plan_tier, plan_expires_at')
        .eq('id', payment.user_id)
        .single();
      if (profileErr) throw profileErr;

      const now = Date.now();
      const currentExpiry = profile.plan_expires_at ? new Date(profile.plan_expires_at).getTime() : 0;
      // Если текущая подписка того же тарифа ещё активна — продлеваем от
      // даты её окончания (не теряем оплаченные дни), иначе — от текущего
      // момента (новая подписка или апгрейд с другого тарифа).
      const base = (profile.plan_tier === payment.plan_tier && currentExpiry > now) ? currentExpiry : now;
      const days = PERIOD_DAYS[payment.billing_period] || 30;
      const newExpiresAt = new Date(base + days * 24 * 60 * 60 * 1000).toISOString();

      const rebillId = payload.RebillId ? String(payload.RebillId) : null;

      const { error: updateProfileErr } = await adminClient
        .from('profiles')
        .update({
          plan_tier: payment.plan_tier,
          plan_expires_at: newExpiresAt,
          plan_billing_period: payment.billing_period,
          plan_auto_renew: true,
          ...(rebillId ? { tbank_rebill_id: rebillId } : {})
        })
        .eq('id', payment.user_id);
      if (updateProfileErr) throw updateProfileErr;

      const { error: updatePaymentErr } = await adminClient
        .from('payments')
        .update({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
          ...(rebillId ? { rebill_id: rebillId } : {}),
          tbank_payment_id: payload.PaymentId ? String(payload.PaymentId) : undefined
        })
        .eq('id', payment.id);
      if (updatePaymentErr) throw updatePaymentErr;

      console.log('[payments-notification] подписка продлена:', payment.user_id, payment.plan_tier, payment.billing_period, 'до', newExpiresAt);
    } else if (status === 'REJECTED' || status === 'DEADLINE_EXPIRED') {
      await adminClient
        .from('payments')
        .update({ status: 'failed', error_message: String(payload.ErrorCode || status) })
        .eq('id', payment.id);
    }
    // Промежуточные статусы (NEW/AUTHORIZED/FORM_SHOWED и т.п.) просто
    // подтверждаем без изменений — платёж ещё не завершён.

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('[payments-notification] ошибка обработки:', err?.message);
    return new Response('error', { status: 500 });
  }
});
