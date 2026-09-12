// LexPrep — импорт тестов/карточек/практики ВС РФ в public.topic_quiz /
// public.topic_flashcards / public.topic_practice (см. ../quiz-content.sql).
// Хранит JSON "как прислали" — конвертация под формат фронтенда (числовые
// индексы вместо id вариантов и т.п.) происходит в content-loader.js при
// загрузке, не здесь.
//
// Использование:
//   npm install @supabase/supabase-js@2
//   node import-quiz-content.js <discipline-id> <quiz-dir> <flashcards-dir> <practice-dir>
//
// quiz-dir/flashcards-dir ожидают файлы quiz-topic-NN.json /
// flashcards-topic-NN.json (как в присланном gp-tests/), practice-dir —
// practice-topic-NN.json (как в gp-practice/). Любой из трёх путей можно
// передать пустой строкой "", если этого набора материалов нет.

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://yupoqkkxedkmhkpqivwa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nAk1Res337ENtZ8FRSTELQ__uUDY31o';
const ADMIN_EMAIL = 'admin.test@lexprep.local';
const ADMIN_PASSWORD = 'AdminLexPrep2026!';

const [, , disciplineId, quizDir, flashcardsDir, practiceDir] = process.argv;
if (!disciplineId) {
  console.error('Usage: node import-quiz-content.js <discipline-id> <quiz-dir> <flashcards-dir> <practice-dir>');
  process.exit(1);
}

function topicIdFor(n) {
  return `${disciplineId}-${String(n).padStart(2, '0')}`;
}

function readJsonDir(dir, prefix) {
  if (!dir) return [];
  return fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
}

const quizFiles = readJsonDir(quizDir, 'quiz-topic-');
const flashcardFiles = readJsonDir(flashcardsDir, 'flashcards-topic-');
const practiceFiles = readJsonDir(practiceDir, 'practice-topic-');

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(async () => {
  const { error: loginErr } = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginErr) {
    console.error('Login failed:', loginErr.message);
    process.exit(1);
  }
  console.log('Logged in as admin.');

  if (quizFiles.length) {
    const rows = quizFiles.map(q => ({ topic_id: topicIdFor(q.topic_number), questions: q.questions }));
    const { error } = await client.from('topic_quiz').upsert(rows);
    if (error) { console.error('topic_quiz upsert failed:', error.message); process.exit(1); }
    console.log(`Upserted quiz for ${rows.length} topics.`);
  }

  if (flashcardFiles.length) {
    const rows = flashcardFiles.map(c => ({ topic_id: topicIdFor(c.topic_number), cards: c.cards }));
    const { error } = await client.from('topic_flashcards').upsert(rows);
    if (error) { console.error('topic_flashcards upsert failed:', error.message); process.exit(1); }
    console.log(`Upserted flashcards for ${rows.length} topics.`);
  }

  if (practiceFiles.length) {
    const rows = practiceFiles.map(p => ({ topic_id: topicIdFor(p.topic_number), acts: p.acts || [], case_law: p.case_law || [] }));
    const { error } = await client.from('topic_practice').upsert(rows);
    if (error) { console.error('topic_practice upsert failed:', error.message); process.exit(1); }
    console.log(`Upserted practice for ${rows.length} topics.`);
  }
})();
