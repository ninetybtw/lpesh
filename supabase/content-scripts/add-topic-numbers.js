// LexPrep — разовый скрипт: добавляет префикс "Тема N. " к заголовкам тем
// гражданского, конституционного и уголовного права — эти три дисциплины
// были импортированы раньше без сквозной нумерации, а "Уголовный процесс"
// (см. import-criminal-procedure.js) её уже содержит в исходниках, из-за
// чего в интерфейсе только у него были подписи вида "Тема 1. ...".
// Идемпотентно: пропускает темы, у которых заголовок уже начинается с
// "Тема N." — можно запускать повторно без риска задвоить префикс.
//
// Использование:
//   node add-topic-numbers.js

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://yupoqkkxedkmhkpqivwa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nAk1Res337ENtZ8FRSTELQ__uUDY31o';
const ADMIN_EMAIL = 'admin.test@lexprep.local';
const ADMIN_PASSWORD = 'AdminLexPrep2026!';

const DISCIPLINE_IDS = ['civil', 'constitutional', 'criminal-law'];

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(async () => {
  const { error: loginErr } = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginErr) { console.error('Login failed:', loginErr.message); process.exit(1); }

  const { data: topics, error } = await client
    .from('topics')
    .select('id, discipline_id, topic_number, title')
    .in('discipline_id', DISCIPLINE_IDS);
  if (error) { console.error('select failed:', error.message); process.exit(1); }

  const toUpdate = topics
    .filter(t => !/^Тема\s+\d+\./.test(t.title))
    .map(t => ({ id: t.id, title: `Тема ${t.topic_number}. ${t.title}` }));

  console.log(`${topics.length} тем всего, ${toUpdate.length} требуют обновления.`);

  for (const t of toUpdate) {
    const { error: updErr } = await client.from('topics').update({ title: t.title }).eq('id', t.id);
    if (updErr) { console.error(`update failed for ${t.id}:`, updErr.message); process.exit(1); }
  }

  console.log('Done.');
})();
