// LexPrep — Edge Function: аудит "слишком очевидных" вопросов в тестах
// (public.topic_quiz). Только читает и показывает список подозрительных
// вопросов — ничего не меняет в базе (см. admin-quiz-fix — там сама
// правка через ИИ). Доступ — только админам.
//
// Деплой:
//   скопировать в volumes/functions/admin-quiz-audit/index.ts + перезапустить
//   контейнер functions (см. admin-delete-user — тот же паттерн деплоя)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { findObviousOptions, wordCount } from '../_shared/quiz-audit.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// Ограничение на размер ответа — если подозрительных вопросов очень много,
// присылаем только первые (flaggedCount всё равно покажет реальный итог).
const MAX_DETAILED = 300;

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

    const { data: callerProfile, error: profileErr } = await callerClient
      .from('profiles')
      .select('is_admin')
      .eq('id', caller.id)
      .single();
    if (profileErr) throw profileErr;
    if (!callerProfile?.is_admin) throw new Error('Not an admin');

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: rows, error } = await adminClient.from('topic_quiz').select('topic_id, questions');
    if (error) throw error;

    const flagged: any[] = [];
    let totalQuestions = 0;
    let flaggedCount = 0;

    (rows || []).forEach((row: any) => {
      (row.questions || []).forEach((q: any, index: number) => {
        totalQuestions++;
        const result = findObviousOptions(q);
        if (result) {
          flaggedCount++;
          if (flagged.length < MAX_DETAILED) {
            flagged.push({
              topicId: row.topic_id,
              questionIndex: index,
              question: q.question,
              correctWords: result.correctWords,
              outlierOptionIds: result.outlierIds,
              options: (q.options || []).map((o: any) => ({
                id: o.id,
                text: o.text,
                words: wordCount(o.text),
                isCorrect: (q.correct || []).includes(o.id)
              }))
            });
          }
        }
      });
    });

    return new Response(JSON.stringify({
      totalTopics: (rows || []).length,
      totalQuestions,
      flaggedCount,
      truncated: flaggedCount > flagged.length,
      flagged
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
