// LexPrep — Edge Function: ИИ-консультант (виджет на app.html).
//
// NVIDIA API-ключ живёт только здесь, в секретах функции — во фронтенд он
// никогда не попадает. Доступ и дневной лимит проверяются на сервере по
// profiles.plan_tier/plan_expires_at (клиентским данным не доверяем: сам
// факт вызова функции с валидным JWT — единственное, что мы принимаем на
// веру, всё остальное перепроверяем здесь).
//
// Деплой:
//   supabase functions deploy ai-consultant
//   supabase secrets set NVIDIA_API_KEY=nvapi-...
// (service_role уже доступен функции автоматически как SUPABASE_SERVICE_ROLE_KEY)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

const MODEL = 'meta/llama-3.1-70b-instruct';
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
    const nvidiaKey = Deno.env.get('NVIDIA_API_KEY')!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) throw new Error('Not authenticated');

    const { data: profile, error: profileErr } = await callerClient
      .from('profiles')
      .select('is_admin, plan_tier, plan_expires_at, is_banned')
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
    if (usedToday >= dailyLimit) {
      return new Response(JSON.stringify({
        error: `Дневной лимит исчерпан (${dailyLimit} запросов). Попробуй завтра.`
      }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const aiRes = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${nvidiaKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...cleanHistory,
          { role: 'user', content: message }
        ],
        temperature: 0.4,
        max_tokens: 700
      })
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text().catch(() => '');
      throw new Error(`NVIDIA API error (${aiRes.status}): ${errText.slice(0, 300)}`);
    }

    const aiData = await aiRes.json();
    const reply = aiData?.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error('Пустой ответ от ИИ — попробуй переформулировать вопрос.');

    await adminClient
      .from('ai_consultant_usage')
      .upsert({ user_id: caller.id, day: today, count: usedToday + 1 }, { onConflict: 'user_id,day' });

    return new Response(JSON.stringify({ reply, remaining: dailyLimit - usedToday - 1, limit: dailyLimit }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
