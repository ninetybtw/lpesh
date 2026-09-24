// LexPrep — Edge Function: правка "слишком очевидных" вариантов ответа в
// тестах (public.topic_quiz) через GigaChat. Переписывает ТОЛЬКО текст
// вариантов-отступников (см. _shared/quiz-audit.ts) — правильный ответ
// никогда не трогаем, id вариантов и correct не меняются, порядок и логика
// проверки ответа не затрагиваются.
//
// По умолчанию dryRun:true (ничего не пишет в базу, только показывает,
// что предложила бы ИИ) — явно передать { dryRun: false }, чтобы сохранить.
// За один вызов обрабатывается не больше `limit` вопросов (по умолчанию 10,
// максимум 30) — из-за времени на последовательные запросы к GigaChat.
// Обработанные вопросы перестают быть "подозрительными", поэтому чтобы
// пройтись по всей базе — просто вызывать функцию повторно, пока
// remainingFlagged не станет 0.
//
// Деплой: тот же паттерн, что и у admin-delete-user / admin-quiz-audit.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callGigaChat } from '../_shared/gigachat.ts';
import { findObviousOptions } from '../_shared/quiz-audit.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const MODEL = 'GigaChat-3-Ultra';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

async function rewriteDistractor(
  gigaKey: string,
  gigaScope: string,
  questionText: string,
  correctText: string,
  distractorText: string
): Promise<string> {
  const prompt = `Тестовый вопрос по праву (Россия): "${questionText}"
Правильный ответ: "${correctText}"
Текущий неправильный вариант ответа: "${distractorText}"

Перепиши этот НЕПРАВИЛЬНЫЙ вариант так, чтобы:
- он остался явно неверным по содержанию (не должен становиться правильным или синонимом правильного ответа);
- он был примерно такой же длины и стиля изложения, как правильный ответ — не в одно слово, если правильный ответ развёрнутый, и наоборот, не разворачивай в абзац, если правильный ответ короткий;
- звучал правдоподобно, как настоящий отвлекающий вариант в тесте, а не абсурд.

Ответь только новым текстом варианта ответа, без кавычек, без нумерации, без пояснений от себя.`;

  const reply = await callGigaChat({
    authKey: gigaKey,
    scope: gigaScope,
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    maxTokens: 220
  });
  return reply.replace(/^[«"]+|[»"]+$/g, '').trim();
}

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

    const { data: callerProfile, error: profileErr } = await callerClient
      .from('profiles')
      .select('is_admin')
      .eq('id', caller.id)
      .single();
    if (profileErr) throw profileErr;
    if (!callerProfile?.is_admin) throw new Error('Not an admin');

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun !== false;
    const limit = Math.min(Math.max(parseInt(body.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: rows, error } = await adminClient.from('topic_quiz').select('topic_id, questions');
    if (error) throw error;

    let totalFlagged = 0;
    const batch: { topicId: string; questionIndex: number }[] = [];
    const rowByTopic = new Map<string, any>();

    (rows || []).forEach((row: any) => {
      rowByTopic.set(row.topic_id, row);
      (row.questions || []).forEach((q: any, index: number) => {
        if (findObviousOptions(q)) {
          totalFlagged++;
          if (batch.length < limit) batch.push({ topicId: row.topic_id, questionIndex: index });
        }
      });
    });

    const workingQuestions = new Map<string, any[]>();
    const processed: any[] = [];

    for (const item of batch) {
      const questions = workingQuestions.get(item.topicId)
        || JSON.parse(JSON.stringify(rowByTopic.get(item.topicId).questions));
      workingQuestions.set(item.topicId, questions);

      const q = questions[item.questionIndex];
      const result = findObviousOptions(q);
      if (!result) continue;

      const correctOpt = (q.options || []).find((o: any) => (q.correct || []).includes(o.id));
      const changes: any[] = [];

      for (const optionId of result.outlierIds) {
        const opt = (q.options || []).find((o: any) => o.id === optionId);
        if (!opt) continue;
        try {
          const newText = await rewriteDistractor(gigaKey, gigaScope, q.question, correctOpt?.text || '', opt.text);
          if (newText) {
            changes.push({ optionId, oldText: opt.text, newText });
            if (!dryRun) opt.text = newText;
          }
        } catch (e) {
          changes.push({ optionId, oldText: opt.text, error: e.message });
        }
      }

      if (changes.length) {
        processed.push({ topicId: item.topicId, questionIndex: item.questionIndex, question: q.question, changes });
      }
    }

    if (!dryRun) {
      for (const [topicId, questions] of workingQuestions) {
        const { error: updErr } = await adminClient
          .from('topic_quiz')
          .update({ questions, updated_at: new Date().toISOString() })
          .eq('topic_id', topicId);
        if (updErr) throw updErr;
      }
    }

    return new Response(JSON.stringify({
      dryRun,
      totalFlagged,
      processedCount: processed.length,
      remainingFlagged: Math.max(totalFlagged - processed.length, 0),
      processed
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
