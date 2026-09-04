// LexPrep — импорт Конституционного права (96 тем) в public.disciplines/
// public.topics/public.topic_quiz/public.topic_flashcards/public.topic_practice.
// Источник — архив KPRF_KPZRF_full_96_topics.zip: уже готовая структура
// (konspekty/md с front matter + "## Что ждёт в теме" + "## Конспект",
// testy/kartochki/praktika как отдельные JSON на тему), в отличие от
// import-topics.js/import-quiz-content.js под старый формат ГП — этот
// скрипт разбирает формат архива напрямую, без структурирования текста.
//
// Использование:
//   node import-constitutional-law.js <путь-к-распакованному-архиву>

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://yupoqkkxedkmhkpqivwa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nAk1Res337ENtZ8FRSTELQ__uUDY31o';
const ADMIN_EMAIL = 'admin.test@lexprep.local';
const ADMIN_PASSWORD = 'AdminLexPrep2026!';

const DISCIPLINE_ID = 'constitutional';
const DISCIPLINE_TITLE = 'Конституционное право';

const [, , srcDir] = process.argv;
if (!srcDir) {
  console.error('Usage: node import-constitutional-law.js <src-dir>');
  process.exit(1);
}

function topicIdFor(n) {
  return `${DISCIPLINE_ID}-${String(n).padStart(2, '0')}`;
}

function parseMd(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`No front matter in ${filePath}`);
  const [, front, rest] = m;
  const topicNumber = Number((front.match(/topic_number:\s*(\d+)/) || [])[1]);
  const title = (front.match(/title:\s*"([^"]*)"/) || [])[1];
  if (!topicNumber || !title) throw new Error(`Missing topic_number/title in ${filePath}`);
  return { topicNumber, title, body: rest.trim() };
}

const mdDir = path.join(srcDir, 'konspekty', 'md');
const mdFiles = fs.readdirSync(mdDir).filter(f => f.endsWith('.md'));
const topics = mdFiles.map(f => {
  const { topicNumber, title, body } = parseMd(path.join(mdDir, f));
  return {
    id: topicIdFor(topicNumber),
    discipline_id: DISCIPLINE_ID,
    topic_number: topicNumber,
    title,
    section: DISCIPLINE_TITLE,
    body_markdown: body,
    sort_order: topicNumber
  };
}).sort((a, b) => a.topic_number - b.topic_number);
console.log(`Parsed ${topics.length} topics.`);

const testyDir = path.join(srcDir, 'testy');
const quizRows = fs.readdirSync(testyDir).filter(f => f.endsWith('.json')).map(f => {
  const raw = JSON.parse(fs.readFileSync(path.join(testyDir, f), 'utf-8'));
  const questions = raw.questions.map(q => ({
    id: q.id,
    question: q.prompt,
    options: q.options,
    correct: [q.correct_option_id],
    explanation: q.explanation
  }));
  return { topic_id: topicIdFor(raw.topic_number), questions };
});
console.log(`Parsed quiz for ${quizRows.length} topics.`);

const kartochkiDir = path.join(srcDir, 'kartochki');
const flashcardRows = fs.readdirSync(kartochkiDir).filter(f => f.endsWith('.json')).map(f => {
  const raw = JSON.parse(fs.readFileSync(path.join(kartochkiDir, f), 'utf-8'));
  const cards = raw.cards.map(c => ({ front: c.q, back: c.a }));
  return { topic_id: topicIdFor(raw.topic_number), cards };
});
console.log(`Parsed flashcards for ${flashcardRows.length} topics.`);

const praktikaDir = path.join(srcDir, 'praktika');
const practiceRows = fs.readdirSync(praktikaDir).filter(f => f.endsWith('.json')).map(f => {
  const raw = JSON.parse(fs.readFileSync(path.join(praktikaDir, f), 'utf-8'));
  const positions = raw.positions || [];
  const acts = positions.length ? [{
    name: 'Практика Конституционного Суда РФ',
    positions: positions.map(p => ({ point: p.source, position: p.position, why_important: p.why_important }))
  }] : [];
  return { topic_id: topicIdFor(raw.topic_number), acts, case_law: [] };
}).filter(row => row.acts.length);
console.log(`Parsed practice for ${practiceRows.length} topics (of ${fs.readdirSync(praktikaDir).length} — rest have no case law).`);

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(async () => {
  const { error: loginErr } = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginErr) {
    console.error('Login failed:', loginErr.message);
    process.exit(1);
  }
  console.log('Logged in as admin.');

  const { error: discErr } = await client.from('disciplines').upsert({ id: DISCIPLINE_ID, title: DISCIPLINE_TITLE, sort_order: 2 });
  if (discErr) { console.error('Discipline upsert failed:', discErr.message); process.exit(1); }

  const { error: topicsErr, data: topicsData } = await client.from('topics').upsert(topics).select('id');
  if (topicsErr) { console.error('Topics upsert failed:', topicsErr.message, topicsErr.details); process.exit(1); }
  console.log(`Upserted ${topicsData.length} topics.`);

  const { error: quizErr, data: quizData } = await client.from('topic_quiz').upsert(quizRows).select('topic_id');
  if (quizErr) { console.error('topic_quiz upsert failed:', quizErr.message); process.exit(1); }
  console.log(`Upserted quiz for ${quizData.length} topics.`);

  const { error: cardsErr, data: cardsData } = await client.from('topic_flashcards').upsert(flashcardRows).select('topic_id');
  if (cardsErr) { console.error('topic_flashcards upsert failed:', cardsErr.message); process.exit(1); }
  console.log(`Upserted flashcards for ${cardsData.length} topics.`);

  const { error: practiceErr, data: practiceData } = await client.from('topic_practice').upsert(practiceRows).select('topic_id');
  if (practiceErr) { console.error('topic_practice upsert failed:', practiceErr.message); process.exit(1); }
  console.log(`Upserted practice for ${practiceData.length} topics.`);

  console.log('Done.');
})();
