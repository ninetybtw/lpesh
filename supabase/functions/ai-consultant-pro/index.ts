// LexPrep — Edge Function: "продвинутый" ИИ-консультант (золотая кнопка в
// app.html), доступен только пользователям с оплаченной ГОДОВОЙ подпиской
// (profiles.plan_billing_period = 'annual' — сейчас выставляется только
// вручную администратором через admin.js, реального платёжного шлюза с
// выбором периода на сайте ещё нет). Отдельный дневной счётчик от
// обычного ai-consultant — см. ai-consultant-pro.sql.
//
// GigaChat API-ключ живёт только здесь, в секретах функции — во фронтенд
// он никогда не попадает. Используется тот же ключ и тот же аккаунт, что
// и в обычном ai-consultant (см. supabase/functions/_shared/gigachat.ts) —
// отдельной "продвинутой" модели на freemium-тарифе GigaChat нет, разница
// между обычным и продвинутым консультантом — в лимитах, промпте и
// поддержке вложений, а не в модели.
//
// Деплой:
//   supabase functions deploy ai-consultant-pro
//   supabase secrets set GIGACHAT_AUTH_KEY=<Authorization key из личного кабинета GigaChat API>
//   supabase secrets set GIGACHAT_SCOPE=GIGACHAT_API_PERS
// (service_role уже доступен функции автоматически как SUPABASE_SERVICE_ROLE_KEY)
// Перед первым деплоем выполни supabase/ai-consultant-pro.sql и
// supabase/plan-billing-period.sql в SQL Editor.
//
// Вложения: клиент присылает опциональный { attachment: { name, content } }
// с уже извлечённым текстом файла (см. app.js — читаются только
// текстовые форматы, .txt/.md/.json и т.п.; PDF/DOCX клиент не парсит,
// это отдельная задача на будущее). Текст вложения подмешивается в
// system-промпт отдельным блоком с явной пометкой источника.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callGigaChat } from '../_shared/gigachat.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// Дневной лимит продвинутого консультанта — отдельный от обычного
// (см. ai-consultant/index.ts PLAN_LIMITS). Цифры совпадают с тем, что
// написано в годовой карточке тарифа на index.html#pricing (40-60 у
// "максимума" — фиксируем 50 как конкретное число в диапазоне, тот же
// подход, что и у PLAN_LIMITS.max в ai-consultant/index.ts).
const PLAN_LIMITS: Record<string, number> = {
  pro: 10,
  max: 50
};

const MODEL = 'GigaChat-3-Ultra';
const MAX_MESSAGE_LEN = 1500;
const MAX_ATTACHMENT_LEN = 20000;
const MAX_HISTORY_TURNS = 3;

const SYSTEM_PROMPT = `Ты — продвинутый ИИ-консультант образовательной платформы LexPrep (доступен только пользователям с годовой подпиской), помогаешь студентам готовиться к экзаменам по праву (Россия). Отвечай по-русски, по делу, структурированно, без воды. Если пользователь прислал текст документа — учитывай его при ответе и явно ссылайся на конкретные фрагменты. Если вопрос выходит за рамки учебной подготовки и требует реальной юридической консультации по конкретной ситуации человека — прямо скажи, что это не замена консультации с практикующим юристом.`;

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
      .select('is_admin, plan_tier, plan_expires_at, plan_billing_period, is_banned')
      .eq('id', caller.id)
      .single();
    if (profileErr) throw profileErr;
    if (profile.is_banned) throw new Error('Аккаунт заблокирован.');

    const planActive = profile.plan_tier && profile.plan_tier !== 'basic'
      && profile.plan_expires_at && new Date(profile.plan_expires_at).getTime() > Date.now();
    const isAnnual = profile.is_admin || (planActive && profile.plan_billing_period === 'annual');

    const dailyLimit = profile.is_admin
      ? PLAN_LIMITS.max
      : (isAnnual ? PLAN_LIMITS[profile.plan_tier] : undefined);

    if (!dailyLimit) {
      return new Response(JSON.stringify({
        error: 'Продвинутый ИИ-консультант доступен только с годовой подпиской «Про» или «Максимум».'
      }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { message, history, attachment } = await req.json();
    if (typeof message !== 'string' || !message.trim()) throw new Error('message is required');
    if (message.length > MAX_MESSAGE_LEN) throw new Error(`Сообщение слишком длинное (максимум ${MAX_MESSAGE_LEN} символов).`);

    let attachmentBlock = '';
    if (attachment && typeof attachment.content === 'string' && attachment.content.trim()) {
      const name = typeof attachment.name === 'string' ? attachment.name.slice(0, 200) : 'файл';
      const content = attachment.content.slice(0, MAX_ATTACHMENT_LEN);
      attachmentBlock = `\n\nПользователь прикрепил файл «${name}». Его содержимое:\n---\n${content}\n---`;
    }

    const cleanHistory = Array.isArray(history)
      ? history
          .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .slice(-MAX_HISTORY_TURNS * 2)
          .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, MAX_MESSAGE_LEN) }))
      : [];

    const adminClient = createClient(supabaseUrl, serviceKey);
    const today = new Date().toISOString().slice(0, 10);

    const { data: usageRow } = await adminClient
      .from('ai_consultant_pro_usage')
      .select('count')
      .eq('user_id', caller.id)
      .eq('day', today)
      .maybeSingle();

    const usedToday = usageRow?.count || 0;
    if (usedToday >= dailyLimit) {
      return new Response(JSON.stringify({
        error: `Дневной лимит продвинутого консультанта исчерпан (${dailyLimit} запросов). Попробуй завтра.`
      }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const reply = await callGigaChat({
      authKey: gigaKey,
      scope: gigaScope,
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...cleanHistory,
        { role: 'user', content: message + attachmentBlock }
      ],
      temperature: 0.4,
      maxTokens: 1200
    });

    await adminClient
      .from('ai_consultant_pro_usage')
      .upsert({ user_id: caller.id, day: today, count: usedToday + 1 }, { onConflict: 'user_id,day' });

    return new Response(JSON.stringify({
      reply,
      remaining: dailyLimit - usedToday - 1,
      limit: dailyLimit
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
