// LexPrep — импорт "Теория государства и права" (ТГП), новая дисциплина,
// 64 темы. Без судебной практики — теоретический предмет (см. README
// присланного архива).
//
// Формат исходников — JSON (структурированный, не markdown):
//   json/temaNN_konspekt.json — { tema, title, intro: [string], sections:
//                                 [{ heading, text, author? }] }
//   json/temaNN_test.json     — { questions: [{ question, type:
//                                 'single'|'multiple', options: [string],
//                                 correct: [string] (текст верных
//                                 вариантов, не id/индекс), explanation }] }
//   json/temaNN_cards.json    — { cards: [{ q, a }] }
//
// Конспект собирается в markdown: "## Что ждёт в теме" (из intro) + по
// одному "## {heading}" на секцию (с "*Автор теории: X*" перед текстом,
// если у секции есть author).
//
// Тест: варианты — обычный массив строк без id, а "correct" — сами тексты
// верных вариантов, а не id/индекс. Присваиваем буквы a,b,c... по порядку
// options и сопоставляем correct-тексты обратно на эти буквы.
//
// Использование:
//   node import-tgp.js <json-dir>

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://yupoqkkxedkmhkpqivwa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nAk1Res337ENtZ8FRSTELQ__uUDY31o';
const ADMIN_EMAIL = 'admin.test@lexprep.local';
const ADMIN_PASSWORD = 'AdminLexPrep2026!';

const DISCIPLINE_ID = 'tgp';
const DISCIPLINE_TITLE = 'Теория государства и права';
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

const [, , jsonDir] = process.argv;
if (!jsonDir) {
  console.error('Usage: node import-tgp.js <json-dir>');
  process.exit(1);
}

function topicId(n) {
  return `${DISCIPLINE_ID}-${String(n).padStart(2, '0')}`;
}

function buildMarkdown(konspekt) {
  const introBlock = (konspekt.intro || []).length
    ? `## Что ждёт в теме:\n\n${konspekt.intro.map(i => `- ${i}`).join('\n')}\n\n---\n`
    : '';
  const sections = (konspekt.sections || []).map(s => {
    const authorLine = s.author ? `*Автор теории: ${s.author}*\n\n` : '';
    return `## ${s.heading}\n\n${authorLine}${s.text}`;
  }).join('\n\n');
  return `${introBlock}\n${sections}`.trim();
}

function convertQuestions(questions) {
  return questions.map(q => {
    const options = q.options.map((text, i) => ({ id: LETTERS[i] || String(i), text }));
    const correct = q.correct
      .map(text => options.find(o => o.text === text))
      .filter(Boolean)
      .map(o => o.id);
    return { question: q.question, options, correct, explanation: q.explanation || '' };
  });
}

const files = fs.readdirSync(jsonDir);
const byTopic = {};
files.forEach(f => {
  let m;
  if ((m = f.match(/^tema(\d+)_konspekt\.json$/))) (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).konspekt = f;
  else if ((m = f.match(/^tema(\d+)_test\.json$/))) (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).test = f;
  else if ((m = f.match(/^tema(\d+)_cards\.json$/))) (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).cards = f;
});

const topics = [];
const quizRows = [];
const flashcardRows = [];

Object.keys(byTopic).sort((a, b) => Number(a) - Number(b)).forEach(nStr => {
  const n = Number(nStr);
  const f = byTopic[n];
  if (!f.konspekt || !f.test || !f.cards) {
    throw new Error(`Тема ${n}: не хватает файлов (${JSON.stringify(f)})`);
  }

  const konspekt = JSON.parse(fs.readFileSync(path.join(jsonDir, f.konspekt), 'utf-8'));
  topics.push({
    id: topicId(n),
    discipline_id: DISCIPLINE_ID,
    topic_number: n,
    title: `Тема ${n}. ${konspekt.title}`,
    section: DISCIPLINE_TITLE,
    body_markdown: buildMarkdown(konspekt),
    sort_order: n
  });

  const test = JSON.parse(fs.readFileSync(path.join(jsonDir, f.test), 'utf-8'));
  quizRows.push({ topic_id: topicId(n), questions: convertQuestions(test.questions) });

  const cards = JSON.parse(fs.readFileSync(path.join(jsonDir, f.cards), 'utf-8'));
  flashcardRows.push({ topic_id: topicId(n), cards: cards.cards.map(c => ({ front: c.q, back: c.a })) });
});

console.log(`Конспекты: ${topics.length} тем.`);
console.log(`Тесты: ${quizRows.reduce((s, r) => s + r.questions.length, 0)} вопросов по ${quizRows.length} темам.`);
console.log(`Карточки: ${flashcardRows.reduce((s, r) => s + r.cards.length, 0)} штук по ${flashcardRows.length} темам.`);

const badQuestions = quizRows.flatMap(r => r.questions.filter(q => !q.correct.length || !q.options.length));
if (badQuestions.length) {
  console.error(`${badQuestions.length} вопросов без правильного ответа/вариантов — прерываю импорт.`);
  console.error(JSON.stringify(badQuestions.slice(0, 3), null, 2));
  process.exit(1);
}

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(async () => {
  const { error: loginErr } = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginErr) { console.error('Login failed:', loginErr.message); process.exit(1); }
  console.log('Logged in as admin.');

  const { error: discErr } = await client.from('disciplines').upsert({ id: DISCIPLINE_ID, title: DISCIPLINE_TITLE, sort_order: 7 });
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
