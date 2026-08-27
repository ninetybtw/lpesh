// LexPrep — импорт "Международное право" (92 темы) в Supabase. Новая
// дисциплина (её ещё нет ни в data.js, ни в базе) — content-loader.js
// сам добавит её в LEXPREP_DATA, раз для discipline_id находятся темы.
//
// Формат исходников — уже готовый JSON под структуру БД (в отличие от
// предыдущих импортов, парсить markdown/front matter не нужно):
//   json/konspekt_N.json — { topic, title, block, intro, body_md }
//   json/cards_N.json    — { topic, title, cards: [{q, a}] }
//   json/test_N.json     — { topic, title, questions: [{question, options:[{id,text}], correct:[id], explanation}] }
// Практики ВС РФ по этому предмету нет (см. README архива).
//
// Использование:
//   node import-international-law.js <путь-к-распакованному-архиву>

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://yupoqkkxedkmhkpqivwa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nAk1Res337ENtZ8FRSTELQ__uUDY31o';
const ADMIN_EMAIL = 'admin.test@lexprep.local';
const ADMIN_PASSWORD = 'AdminLexPrep2026!';

const DISCIPLINE_ID = 'international-law';
const DISCIPLINE_TITLE = 'Международное право';

const [, , srcDir] = process.argv;
if (!srcDir) {
  console.error('Usage: node import-international-law.js <src-dir>');
  process.exit(1);
}

const jsonDir = path.join(srcDir, 'json');

function topicId(n) {
  return `${DISCIPLINE_ID}-${String(n).padStart(2, '0')}`;
}

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(jsonDir, name), 'utf-8'));
}

const konspektFiles = fs.readdirSync(jsonDir).filter(f => /^konspekt_\d+\.json$/.test(f));
const topics = konspektFiles.map(f => {
  const k = readJson(f);
  return {
    id: topicId(k.topic),
    discipline_id: DISCIPLINE_ID,
    topic_number: k.topic,
    title: `Тема ${k.topic}. ${k.title}`,
    section: k.intro || DISCIPLINE_TITLE,
    body_markdown: k.body_md,
    sort_order: k.topic
  };
}).sort((a, b) => a.topic_number - b.topic_number);
console.log(`Конспекты: ${topics.length} тем.`);

const cardsFiles = fs.readdirSync(jsonDir).filter(f => /^cards_\d+\.json$/.test(f));
const flashcardRows = cardsFiles.map(f => {
  const c = readJson(f);
  return {
    topic_id: topicId(c.topic),
    cards: c.cards.map(card => ({ front: card.q, back: card.a }))
  };
});
console.log(`Карточки: ${flashcardRows.reduce((s, r) => s + r.cards.length, 0)} штук по ${flashcardRows.length} темам.`);

const testFiles = fs.readdirSync(jsonDir).filter(f => /^test_\d+\.json$/.test(f));
const quizRows = testFiles.map(f => {
  const t = readJson(f);
  const questions = t.questions.map(q => {
    const options = q.options.map(o => o.text);
    const correct = q.correct.map(id => q.options.findIndex(o => o.id === id)).filter(i => i >= 0);
    return { question: q.question, options, correct, explanation: q.explanation || '' };
  });
  return { topic_id: topicId(t.topic), questions };
});
console.log(`Тесты: ${quizRows.reduce((s, r) => s + r.questions.length, 0)} вопросов по ${quizRows.length} темам.`);

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(async () => {
  const { error: loginErr } = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginErr) { console.error('Login failed:', loginErr.message); process.exit(1); }
  console.log('Logged in as admin.');

  const { error: discErr } = await client.from('disciplines').upsert({ id: DISCIPLINE_ID, title: DISCIPLINE_TITLE, sort_order: 4 });
  if (discErr) { console.error('discipline upsert failed:', discErr.message); process.exit(1); }

  const { error: topicsErr, data: topicsData } = await client.from('topics').upsert(topics).select('id');
  if (topicsErr) { console.error('topics upsert failed:', topicsErr.message); process.exit(1); }
  console.log(`Upserted ${topicsData.length} topics.`);

  const { error: quizErr, data: quizData } = await client.from('topic_quiz').upsert(quizRows).select('topic_id');
  if (quizErr) { console.error('topic_quiz upsert failed:', quizErr.message); process.exit(1); }
  console.log(`Upserted quiz for ${quizData.length} topics.`);

  const { error: cardsErr, data: cardsData } = await client.from('topic_flashcards').upsert(flashcardRows).select('topic_id');
  if (cardsErr) { console.error('topic_flashcards upsert failed:', cardsErr.message); process.exit(1); }
  console.log(`Upserted flashcards for ${cardsData.length} topics.`);

  console.log('Done.');
})();
