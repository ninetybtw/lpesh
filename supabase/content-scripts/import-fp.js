// LexPrep — импорт "Финансовое право" (ФП), новая дисциплина, 13 тем.
//
// Формат исходников — markdown с YAML front matter, но с ДРУГИМИ ключами,
// чем в остальных дисциплинах (tema/title/predmet/tip вместо
// topic_number/subject/type), и title БЕЗ префикса "Тема N." (в отличие
// от igpzs/iogp/tp) — прибавляем сами.
//   temaNN_konspekt.md — конспект
//   temaNN_test.md      — тест: "### Вопрос N (один ответ|несколько ответов)"
//                          + "A. ..." (точка, не скобка) + "**Верно:** X"
//                          или "**Верно:** X, Y" + "**Объяснение:** ..."
//   temaNN_cards.md     — карточки: "**В: вопрос**\nО: ответ" (по одной
//                          строке, без нумерации)
//   temaNN_praktika.md  — практика (не для всех тем, реально есть только у
//                          темы 1): плоский список "## N. Заголовок" — каждый
//                          раздел сам по себе одна позиция (без вложенных
//                          "### " подразделов и без отдельного блока
//                          примеров дел, в отличие от gp-chast2/tp) —
//                          "**По делу:**"/"**Позиция суда:**"/"**Почему
//                          важно:**" сливаем в одну позицию с why_important.
//
// Использование:
//   node import-fp.js <dir>

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://yupoqkkxedkmhkpqivwa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nAk1Res337ENtZ8FRSTELQ__uUDY31o';
const ADMIN_EMAIL = 'admin.test@lexprep.local';
const ADMIN_PASSWORD = 'AdminLexPrep2026!';

const DISCIPLINE_ID = 'financial-law';
const DISCIPLINE_TITLE = 'Финансовое право';

const [, , srcDir] = process.argv;
if (!srcDir) {
  console.error('Usage: node import-fp.js <dir>');
  process.exit(1);
}

function topicId(n) {
  return `${DISCIPLINE_ID}-${String(n).padStart(2, '0')}`;
}

function readFrontMatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('No front matter');
  const [, front, rest] = m;
  const topicNumber = Number((front.match(/tema:\s*(\d+)/) || [])[1]);
  const title = (front.match(/title:\s*"([^"]*)"/) || [])[1];
  if (!topicNumber || !title) throw new Error('Missing tema/title');
  return { topicNumber, title, body: rest.trim() };
}

function stripHeading(body) {
  return body.trim().replace(/^#\s.*\n/, '').trim();
}

function parseQuestions(testBody) {
  const blocks = testBody.split(/(?=^### Вопрос\s+\d+)/m).filter(b => /^### Вопрос\s+\d+/.test(b));
  return blocks.map(block => {
    const question = (block.match(/^### Вопрос\s+\d+[^\n]*\n(.+)$/m) || [])[1].trim();
    const optionMatches = [...block.matchAll(/^([A-Z])\.\s*(.+)$/gm)];
    const options = optionMatches.map(m => ({ id: m[1].toLowerCase(), text: m[2].trim() }));
    const answerMatch = block.match(/\*\*Верно:\*\*\s*(.+)/);
    const correct = answerMatch
      ? answerMatch[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      : [];
    const explanationMatch = block.match(/\*\*Объяснение:\*\*\s*([\s\S]*?)(?=\n---|\n### Вопрос|$)/);
    return { question, options, correct, explanation: explanationMatch ? explanationMatch[1].trim() : '' };
  });
}

function parseCards(cardsBody) {
  const matches = [...cardsBody.matchAll(/\*\*В:\s*(.+?)\*\*\s*\nО:\s*(.+?)\s*(?=\n\*\*В:|$)/gs)];
  return matches.map(m => ({ front: m[1].trim(), back: m[2].trim() }));
}

function parsePractice(md) {
  const body = md.trim().replace(/^#\s.*\n/, '').trim();
  // Перед первым "## " почти всегда есть вводный абзац без заголовка
  // (например, у темы 1 объясняет, почему практика представлена иначе) —
  // это не акт с заголовком, а отдельная вводная позиция.
  const firstHeadingIdx = body.search(/^## /m);
  const intro = firstHeadingIdx === -1 ? body : body.slice(0, firstHeadingIdx).trim();
  const rest = firstHeadingIdx === -1 ? '' : body.slice(firstHeadingIdx);
  const parts = rest.split(/^## /m).map(s => s.trim()).filter(Boolean);

  const acts = [];
  if (intro) {
    acts.push({ name: 'Особенность практики по теме', positions: [{ point: '', position: intro, why_important: '' }] });
  }
  parts.forEach(part => {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    let text = (nl === -1 ? '' : part.slice(nl + 1)).replace(/^---\s*$/m, '').trim();
    const whyMatch = text.match(/\*\*Почему важно:\*\*\s*([\s\S]*?)(?=\n?\*\*[^*:]+:\*\*|\n---|\*\s*Примечание|$)/i);
    const whyImportant = whyMatch ? whyMatch[1].trim() : '';
    const position = whyMatch ? text.slice(0, whyMatch.index).trim() : text;
    acts.push({ name: heading, positions: [{ point: '', position, why_important: whyImportant }] });
  });
  return { acts, case_law: [] };
}

// ---------------- Сбор файлов ----------------

const files = fs.readdirSync(srcDir);
const byTopic = {};
files.forEach(f => {
  let m;
  if ((m = f.match(/^tema(\d+)_konspekt\.md$/))) (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).konspekt = f;
  else if ((m = f.match(/^tema(\d+)_test\.md$/))) (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).test = f;
  else if ((m = f.match(/^tema(\d+)_cards\.md$/))) (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).cards = f;
  else if ((m = f.match(/^tema(\d+)_praktika\.md$/))) (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).praktika = f;
});

const topics = [];
const quizRows = [];
const flashcardRows = [];
const practiceRows = [];

Object.keys(byTopic).sort((a, b) => Number(a) - Number(b)).forEach(nStr => {
  const n = Number(nStr);
  const f = byTopic[n];
  if (!f.konspekt || !f.test || !f.cards) {
    throw new Error(`Тема ${n}: не хватает файлов (${JSON.stringify(f)})`);
  }

  const { title, body } = readFrontMatter(fs.readFileSync(path.join(srcDir, f.konspekt), 'utf-8'));
  topics.push({
    id: topicId(n),
    discipline_id: DISCIPLINE_ID,
    topic_number: n,
    title: `Тема ${n}. ${title}`,
    section: DISCIPLINE_TITLE,
    body_markdown: stripHeading(body),
    sort_order: n
  });

  const { body: testBody } = readFrontMatter(fs.readFileSync(path.join(srcDir, f.test), 'utf-8'));
  quizRows.push({ topic_id: topicId(n), questions: parseQuestions(testBody) });

  const { body: cardsBody } = readFrontMatter(fs.readFileSync(path.join(srcDir, f.cards), 'utf-8'));
  flashcardRows.push({ topic_id: topicId(n), cards: parseCards(cardsBody) });

  if (f.praktika) {
    const { body: praktikaBody } = readFrontMatter(fs.readFileSync(path.join(srcDir, f.praktika), 'utf-8'));
    const { acts, case_law } = parsePractice(praktikaBody);
    practiceRows.push({ topic_id: topicId(n), acts, case_law });
  }
});

console.log(`Конспекты: ${topics.length} тем.`);
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

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(async () => {
  const { error: loginErr } = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginErr) { console.error('Login failed:', loginErr.message); process.exit(1); }
  console.log('Logged in as admin.');

  const { error: discErr } = await client.from('disciplines').upsert({ id: DISCIPLINE_ID, title: DISCIPLINE_TITLE, sort_order: 9 });
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

  if (practiceRows.length) {
    const { error: practiceErr, data: practiceData } = await client.from('topic_practice').upsert(practiceRows).select('topic_id');
    if (practiceErr) { console.error('topic_practice upsert failed:', practiceErr.message); process.exit(1); }
    console.log(`Upserted practice for ${practiceData.length} topics.`);
  }

  console.log('Done.');
})();
