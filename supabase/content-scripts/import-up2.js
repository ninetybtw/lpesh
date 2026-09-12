// LexPrep — импорт продолжения "Уголовное право" (Особенная часть, 64
// темы) в существующую дисциплину discipline_id='criminal-law' (темы
// 1-19 — Общая часть, уже в базе). Сквозная нумерация: темы источника
// 1-64 становятся 20-83.
//
// Формат исходников — JSON, плоские поля (без вложенного meta, в отличие
// от gp-chast2):
//   json/temaNN_konspekt.json — { tema, subject, title, chapter, type,
//                                 content_markdown } — title БЕЗ префикса
//                                 "Тема N." (в content_markdown есть
//                                 редундантный "# Тема N. ..." — вырезаем)
//   json/temaNN_testy.json    — { questions: [{ question|prompt,
//                                 options: {A:text,...} ИЛИ [{id,text}],
//                                 correct: ["A",...], explanation }] } —
//                                 два разных формата options в одном
//                                 архиве, нормализуем оба.
//   json/temaNN_kartochki.json — { cards: [{ id, question, answer }] }
//   json/temaNN_praktika.json — { content_markdown | content_md } —
//                                 свободный текст без стабильного деления
//                                 на "## "-разделы (в отличие от
//                                 gp-chast2/tp) — почти everything живёт
//                                 под "### "-подразделами плюс вводный
//                                 абзац; поэтому весь файл разбираем как
//                                 плоский список актов (case_law не
//                                 заполняем — источник не даёт устойчиво
//                                 вычленимых "дел").
//
// Использование:
//   node import-up2.js <json-dir>

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://yupoqkkxedkmhkpqivwa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nAk1Res337ENtZ8FRSTELQ__uUDY31o';
const ADMIN_EMAIL = 'admin.test@lexprep.local';
const ADMIN_PASSWORD = 'AdminLexPrep2026!';

const DISCIPLINE_ID = 'criminal-law';
const DISCIPLINE_TITLE = 'Уголовное право';
const NUMBER_OFFSET = 19;

const [, , jsonDir] = process.argv;
if (!jsonDir) {
  console.error('Usage: node import-up2.js <json-dir>');
  process.exit(1);
}

function topicId(n) {
  return `${DISCIPLINE_ID}-${String(n).padStart(2, '0')}`;
}

function stripHeading(md) {
  return md.trim().replace(/^#\s.*\n/, '').trim();
}

function normalizeOptions(rawOptions) {
  if (Array.isArray(rawOptions)) {
    return rawOptions.map(o => ({ id: String(o.id).toLowerCase(), text: o.text }));
  }
  return Object.entries(rawOptions).map(([id, text]) => ({ id: id.toLowerCase(), text }));
}

function normalizeQuestions(questions) {
  return questions.map(q => {
    const questionText = q.question || q.prompt;
    const options = normalizeOptions(q.options);
    const correct = (q.correct || []).map(c => String(c).toLowerCase());
    return { question: questionText, options, correct, explanation: q.explanation || '' };
  });
}

// ---------------- Практика: плоский список актов через "### ", вводный
// абзац до первого "### " (или "## ", если он есть) — отдельным актом. ----

function parsePractice(md) {
  const body = md.trim().replace(/^#\s.*\n/, '').trim();
  const firstSubIdx = body.search(/^#{2,3} /m);
  const intro = firstSubIdx === -1 ? body : body.slice(0, firstSubIdx).trim();
  const rest = firstSubIdx === -1 ? '' : body.slice(firstSubIdx);

  const acts = [];
  if (intro) {
    acts.push({ name: 'Особенность практики по теме', positions: [{ point: '', position: intro, why_important: '' }] });
  }

  const parts = rest.split(/^#{2,3} /m).map(s => s.trim()).filter(Boolean);
  parts.forEach(part => {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    let text = (nl === -1 ? '' : part.slice(nl + 1)).trim();
    const whyMatch = text.match(/\*\*Почему важно[^*:]*:\*\*\s*([\s\S]*?)(?=\n?\*\*[^*:]+:\*\*|$)/i);
    const whyImportant = whyMatch ? whyMatch[1].trim() : '';
    const position = whyMatch ? text.slice(0, whyMatch.index).trim() : text;
    if (position || whyImportant) {
      acts.push({ name: heading, positions: [{ point: '', position, why_important: whyImportant }] });
    }
  });
  return { acts, case_law: [] };
}

// ---------------- Сбор файлов ----------------

const files = fs.readdirSync(jsonDir);
const byTopic = {};
files.forEach(f => {
  let m;
  if ((m = f.match(/^tema(\d+)_konspekt\.json$/))) (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).konspekt = f;
  else if ((m = f.match(/^tema(\d+)_testy\.json$/))) (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).testy = f;
  else if ((m = f.match(/^tema(\d+)_kartochki\.json$/))) (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).kartochki = f;
  else if ((m = f.match(/^tema(\d+)_praktika\.json$/))) (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).praktika = f;
});

const topics = [];
const quizRows = [];
const flashcardRows = [];
const practiceRows = [];

Object.keys(byTopic).sort((a, b) => Number(a) - Number(b)).forEach(nStr => {
  const n = Number(nStr);
  const globalN = n + NUMBER_OFFSET;
  const f = byTopic[n];
  if (!f.konspekt || !f.testy || !f.kartochki) {
    throw new Error(`Тема ${n}: не хватает файлов (${JSON.stringify(f)})`);
  }

  const konspekt = JSON.parse(fs.readFileSync(path.join(jsonDir, f.konspekt), 'utf-8'));
  topics.push({
    id: topicId(globalN),
    discipline_id: DISCIPLINE_ID,
    topic_number: globalN,
    title: `Тема ${globalN}. ${konspekt.title}`,
    section: DISCIPLINE_TITLE,
    body_markdown: stripHeading(konspekt.content_markdown || konspekt.content_md),
    sort_order: globalN
  });

  const testy = JSON.parse(fs.readFileSync(path.join(jsonDir, f.testy), 'utf-8'));
  quizRows.push({ topic_id: topicId(globalN), questions: normalizeQuestions(testy.questions) });

  const kartochki = JSON.parse(fs.readFileSync(path.join(jsonDir, f.kartochki), 'utf-8'));
  flashcardRows.push({ topic_id: topicId(globalN), cards: kartochki.cards.map(c => ({ front: c.question, back: c.answer })) });

  if (f.praktika) {
    const praktika = JSON.parse(fs.readFileSync(path.join(jsonDir, f.praktika), 'utf-8'));
    const md = praktika.content_markdown || praktika.content_md;
    const { acts, case_law } = parsePractice(md);
    practiceRows.push({ topic_id: topicId(globalN), acts, case_law });
  }
});

console.log(`Конспекты: ${topics.length} тем (${topics[0].topic_number}-${topics[topics.length - 1].topic_number}).`);
console.log(`Тесты: ${quizRows.reduce((s, r) => s + r.questions.length, 0)} вопросов по ${quizRows.length} темам.`);
console.log(`Карточки: ${flashcardRows.reduce((s, r) => s + r.cards.length, 0)} штук по ${flashcardRows.length} темам.`);
console.log(`Практика: ${practiceRows.length} тем (из ${topics.length}).`);

const badQuestions = quizRows.flatMap(r => r.questions.filter(q => !q.correct.length || !q.options.length));
if (badQuestions.length) {
  console.error(`${badQuestions.length} вопросов без правильного ответа/вариантов — прерываю импорт.`);
  console.error(JSON.stringify(badQuestions.slice(0, 3), null, 2));
  process.exit(1);
}
const badCards = flashcardRows.filter(r => !r.cards.length);
if (badCards.length) {
  console.error(`${badCards.length} тем без карточек — прерываю импорт.`);
  process.exit(1);
}
const emptyActs = practiceRows.flatMap(r => r.acts.filter(a => !a.positions[0].position && !a.positions[0].why_important));
if (emptyActs.length) {
  console.error(`${emptyActs.length} пустых позиций практики — прерываю импорт.`);
  console.error(JSON.stringify(emptyActs.slice(0, 3), null, 2));
  process.exit(1);
}

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(async () => {
  const { error: loginErr } = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginErr) { console.error('Login failed:', loginErr.message); process.exit(1); }
  console.log('Logged in as admin.');

  const { error: topicsErr, data: topicsData } = await client.from('topics').upsert(topics).select('id');
  if (topicsErr) { console.error('topics upsert failed:', topicsErr.message); process.exit(1); }
  console.log(`Upserted ${topicsData.length} topics.`);

  const { error: quizErr, data: quizData } = await client.from('topic_quiz').upsert(quizRows).select('topic_id');
  if (quizErr) { console.error('topic_quiz upsert failed:', quizErr.message); process.exit(1); }
  console.log(`Upserted quiz for ${quizData.length} topics.`);

  const { error: cardsErr, data: cardsData } = await client.from('topic_flashcards').upsert(flashcardRows).select('topic_id');
  if (cardsErr) { console.error('topic_flashcards upsert failed:', cardsErr.message); process.exit(1); }
  console.log(`Upserted flashcards for ${cardsData.length} topics.`);

  if (practiceRows.length) {
    const { error: practiceErr, data: practiceData } = await client.from('topic_practice').upsert(practiceRows).select('topic_id');
    if (practiceErr) { console.error('topic_practice upsert failed:', practiceErr.message); process.exit(1); }
    console.log(`Upserted practice for ${practiceData.length} topics.`);
  }

  console.log('Done.');
})();
