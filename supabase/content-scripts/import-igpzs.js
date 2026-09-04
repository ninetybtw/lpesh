// LexPrep — импорт "История государства и права зарубежных стран" (124
// темы: часть I — 64 темы, часть II — 60 тем) в Supabase. Новая
// дисциплина — content-loader.js добавит её в LEXPREP_DATA сам, раз для
// discipline_id находятся темы.
//
// Формат исходников — Cyrillic front matter (topic_number/title, тот же
// стиль, что у constitutional/criminal-procedure), два варианта на тему:
//   chast{1,2}_temaNN_konspekt.md    — конспект (с редундантным "# Тема N. ..."
//                                       заголовком в начале тела — вырезаем)
//   chast{1,2}_temaNN_test_cards.md  — тест ("# Тест по теме N", вопросы
//                                       "**N. Вопрос**" + "- a) ... ✅") и
//                                       карточки ("# Карточки по теме N",
//                                       "**Q: ...**\nA: ...") одним файлом
//   chast1_tema01_test.md / _cards.md — тема 1 части I исключение: тест и
//                                       карточки раздельными файлами
//                                       (тот же формат вопросов/карточек)
//
// Часть I и часть II — независимая нумерация тем в исходниках (1..64 и
// 1..60) для одной и той же дисциплины; здесь темы части II получают
// сквозной topic_number = N + 64, чтобы вся дисциплина шла одним
// списком "Тема 1"..."Тема 124", как и остальные пять дисциплин.
//
// Использование:
//   node import-igpzs.js <часть1-dir> <часть2-dir>

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://yupoqkkxedkmhkpqivwa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nAk1Res337ENtZ8FRSTELQ__uUDY31o';
const ADMIN_EMAIL = 'admin.test@lexprep.local';
const ADMIN_PASSWORD = 'AdminLexPrep2026!';

const DISCIPLINE_ID = 'igpzs';
const DISCIPLINE_TITLE = 'История государства и права зарубежных стран';
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

const [, , part1Dir, part2Dir] = process.argv;
if (!part1Dir || !part2Dir) {
  console.error('Usage: node import-igpzs.js <часть1-dir> <часть2-dir>');
  process.exit(1);
}

function topicId(n) {
  return `${DISCIPLINE_ID}-${String(n).padStart(3, '0')}`;
}

function readFrontMatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('No front matter');
  const [, front, rest] = m;
  const topicNumber = Number((front.match(/topic_number:\s*(\d+)/) || [])[1]);
  const title = (front.match(/title:\s*"([^"]*)"/) || [])[1];
  if (!topicNumber || !title) throw new Error('Missing topic_number/title');
  return { topicNumber, title, body: rest.trim() };
}

function stripHeading(body) {
  return body.replace(/^\s*# Тема \d+\.[^\n]*\n/, '').trim();
}

// Разбираем блок вопроса вида "**N. Текст**\n- a) ...\n- b) ... ✅\n..."
// (эмодзи ✅ прямо в тексте верного варианта, без отдельной строки "Ответ:").
function parseQuestions(testBody) {
  const blocks = testBody.split(/(?=^\*\*\d+\.\s)/m).filter(b => /^\*\*\d+\./.test(b));
  return blocks.map(block => {
    const question = (block.match(/^\*\*\d+\.\s*(.+?)\*\*\s*$/m) || [])[1].trim();
    const optionMatches = [...block.matchAll(/^-\s*[a-dA-D]\)\s*(.+)$/gm)];
    const options = optionMatches.map((m, i) => ({ id: LETTERS[i], text: m[1].replace(/\s*✅\s*$/, '').trim() }));
    const correct = optionMatches
      .map((m, i) => (/✅/.test(m[1]) ? LETTERS[i] : null))
      .filter(Boolean);
    const explanationMatch = block.match(/\*Пояснение:\s*(.+?)\*/s);
    return { question, options, correct, explanation: explanationMatch ? explanationMatch[1].trim() : '' };
  });
}

function parseCards(cardsBody) {
  const matches = [...cardsBody.matchAll(/\*\*Q:\s*(.+?)\*\*\s*\nA:\s*(.+?)\s*(?=\n\n|$)/gs)];
  return matches.map(m => ({ front: m[1].trim(), back: m[2].trim() }));
}

function collectPart(dir, prefix, numberOffset) {
  const files = fs.readdirSync(dir);
  const byTopic = {};
  files.forEach(f => {
    const m = f.match(new RegExp(`^${prefix}_tema(\\d+)_(konspekt|test_cards|test|cards)\\.md$`));
    if (!m) return;
    const n = Number(m[1]);
    (byTopic[n] = byTopic[n] || {})[m[2]] = f;
  });

  const topics = [];
  const quizRows = [];
  const flashcardRows = [];

  Object.keys(byTopic).forEach(nStr => {
    const n = Number(nStr);
    const globalN = n + numberOffset;
    const files = byTopic[n];

    const { title, body } = readFrontMatter(fs.readFileSync(path.join(dir, files.konspekt), 'utf-8'));
    topics.push({
      id: topicId(globalN),
      discipline_id: DISCIPLINE_ID,
      topic_number: globalN,
      title: `Тема ${globalN}. ${title}`,
      section: DISCIPLINE_TITLE,
      body_markdown: stripHeading(body),
      sort_order: globalN
    });

    let testBody, cardsBody;
    if (files.test_cards) {
      const { body: combined } = readFrontMatter(fs.readFileSync(path.join(dir, files.test_cards), 'utf-8'));
      const [t, c] = combined.split(/^# Карточки.*$/m);
      testBody = t;
      cardsBody = c || '';
    } else {
      testBody = readFrontMatter(fs.readFileSync(path.join(dir, files.test), 'utf-8')).body;
      cardsBody = readFrontMatter(fs.readFileSync(path.join(dir, files.cards), 'utf-8')).body;
    }

    quizRows.push({ topic_id: topicId(globalN), questions: parseQuestions(testBody) });
    flashcardRows.push({ topic_id: topicId(globalN), cards: parseCards(cardsBody) });
  });

  return { topics, quizRows, flashcardRows };
}

const part1 = collectPart(part1Dir, 'chast1', 0);
const part2 = collectPart(part2Dir, 'chast2', 64);

const topics = [...part1.topics, ...part2.topics].sort((a, b) => a.topic_number - b.topic_number);
const quizRows = [...part1.quizRows, ...part2.quizRows];
const flashcardRows = [...part1.flashcardRows, ...part2.flashcardRows];

console.log(`Конспекты: ${topics.length} тем (часть I: ${part1.topics.length}, часть II: ${part2.topics.length}).`);
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

  const { error: discErr } = await client.from('disciplines').upsert({ id: DISCIPLINE_ID, title: DISCIPLINE_TITLE, sort_order: 5 });
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
