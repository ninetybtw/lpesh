// LexPrep — Edge Function: ИИ-консультант (виджет на app.html).
//
// GigaChat API-ключ живёт только здесь, в секретах функции — во фронтенд он
// никогда не попадает. Доступ и дневной лимит проверяются на сервере по
// profiles.plan_tier/plan_expires_at (клиентским данным не доверяем: сам
// факт вызова функции с валидным JWT — единственное, что мы принимаем на
// веру, всё остальное перепроверяем здесь).
//
// Деплой:
//   supabase functions deploy ai-consultant
//   supabase secrets set GIGACHAT_AUTH_KEY=<Authorization key из личного кабинета GigaChat API>
//   supabase secrets set GIGACHAT_SCOPE=GIGACHAT_API_PERS
// (service_role уже доступен функции автоматически как SUPABASE_SERVICE_ROLE_KEY)
// Перед первым деплоем этой версии выполни supabase/ai-extra-requests.sql
// в SQL Editor — функция читает и списывает profiles.ai_extra_requests.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callGigaChat } from '../_shared/gigachat.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// Тариф → сколько запросов в день. basic сюда не входит — доступа нет
// вообще (см. PLAN_LIMITS[tier] === undefined ниже). Цифры совпадают с
// тем, что написано в тарифах на index.html.
const PLAN_LIMITS: Record<string, number> = {
  pro: 5,
  max: 35
};

const MODEL = 'GigaChat-3-Ultra';
const MAX_MESSAGE_LEN = 1500;
const MAX_HISTORY_TURNS = 3;

const SYSTEM_PROMPT = `Ты — ИИ-консультант образовательной платформы LexPrep, помогаешь студентам готовиться к экзаменам по праву (Россия). Отвечай по-русски, по делу, структурированно, без воды. Если вопрос выходит за рамки учебной подготовки и требует реальной юридической консультации по конкретной ситуации человека — прямо скажи, что это не замена консультации с практикующим юристом.`;

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
    const gigaKey = Deno.env.get('GIGACHAT_AUTH_KEY')!;
    const gigaScope = Deno.env.get('GIGACHAT_SCOPE') || 'GIGACHAT_API_PERS';

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) throw new Error('Not authenticated');

    const { data: profile, error: profileErr } = await callerClient
      .from('profiles')
      .select('is_admin, plan_tier, plan_expires_at, is_banned, ai_extra_requests')
      .eq('id', caller.id)
      .single();
    if (profileErr) throw profileErr;
    if (profile.is_banned) throw new Error('Аккаунт заблокирован.');

    const planActive = profile.plan_tier && profile.plan_tier !== 'basic'
      && profile.plan_expires_at && new Date(profile.plan_expires_at).getTime() > Date.now();

    const dailyLimit = profile.is_admin
      ? PLAN_LIMITS.max
      : (planActive ? PLAN_LIMITS[profile.plan_tier] : undefined);

    if (!dailyLimit) {
      return new Response(JSON.stringify({
        error: 'ИИ-консультант доступен на тарифах «Про» и «Максимум».'
      }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { message, history } = await req.json();
    if (typeof message !== 'string' || !message.trim()) throw new Error('message is required');
    if (message.length > MAX_MESSAGE_LEN) throw new Error(`Сообщение слишком длинное (максимум ${MAX_MESSAGE_LEN} символов).`);

    const cleanHistory = Array.isArray(history)
      ? history
          .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .slice(-MAX_HISTORY_TURNS * 2)
          .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, MAX_MESSAGE_LEN) }))
      : [];

    // Считаем и проверяем дневной лимит через service_role — RLS у
    // ai_consultant_usage обычному пользователю insert/update не даёт.
    const adminClient = createClient(supabaseUrl, serviceKey);
    const today = new Date().toISOString().slice(0, 10);

    const { data: usageRow } = await adminClient
      .from('ai_consultant_usage')
      .select('count')
      .eq('user_id', caller.id)
      .eq('day', today)
      .maybeSingle();

    const usedToday = usageRow?.count || 0;
    // Дневной лимит тарифа исчерпан — но если в магазине куплены "лишние"
    // запросы (profiles.ai_extra_requests, см. shop.js), используем один
    // из них вместо отказа. Списываем ниже, только если запрос реально
    // выполнился (после успешного ответа GigaChat), а не заранее.
    const extraRequests = profile.ai_extra_requests || 0;
    const usingExtraRequest = usedToday >= dailyLimit;
    if (usingExtraRequest && extraRequests <= 0) {
      return new Response(JSON.stringify({
        error: `Дневной лимит исчерпан (${dailyLimit} запросов). Попробуй завтра или купи дополнительные запросы в магазине.`
      }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const reply = await callGigaChat({
      authKey: gigaKey,
      scope: gigaScope,
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...cleanHistory,
        { role: 'user', content: message }
      ],
      temperature: 0.4,
      maxTokens: 700
    });

    if (usingExtraRequest) {
      await adminClient
        .from('profiles')
        .update({ ai_extra_requests: extraRequests - 1 })
        .eq('id', caller.id);
    } else {
      await adminClient
        .from('ai_consultant_usage')
        .upsert({ user_id: caller.id, day: today, count: usedToday + 1 }, { onConflict: 'user_id,day' });
    }

    return new Response(JSON.stringify({
      reply,
      remaining: usingExtraRequest ? 0 : dailyLimit - usedToday - 1,
      limit: dailyLimit,
      extraRequestsLeft: usingExtraRequest ? extraRequests - 1 : extraRequests
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
