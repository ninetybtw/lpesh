// LexPrep — импорт "История отечественного государства и права" (120
// тем: часть I — 62 темы, часть II — 58 тем) в Supabase. Новая
// дисциплина — content-loader.js добавит её в LEXPREP_DATA сам, раз для
// discipline_id находятся темы.
//
// Формат исходников — Cyrillic front matter (topic_number/title, title уже
// содержит "Тема N. ..."), три отдельных файла на тему, с разными
// префиксами/суффиксами в двух архивах:
//   часть I (обе "части" — I и II — темы 1-23 второй части — лежат в одном
//   каталоге md/):
//     chast{1,2}_temaNN_konspekt.md — конспект
//     test_chast{1,2}_temaNN.md     — тест ("**N. Текст**" + "- A) ... **(верно)**"
//                                      + "*Объяснение:* ...")
//     cards_chast{1,2}_temaNN.md    — карточки ("**N. Вопрос:** ...\n**Ответ:** ...")
//   часть II темы 24-58 (отдельный архив):
//     chast2_temaNN_konspekt.md
//     chast2_temaNN_test.md
//     chast2_temaNN_kartochki.md
//
// Часть I и часть II — независимая нумерация тем в исходниках (1..62 и
// 1..58) для одной дисциплины; темы части II получают сквозной
// topic_number = N + 62, чтобы вся дисциплина шла одним списком
// "Тема 1"..."Тема 120".
//
// Практики (судебной практики) для этой дисциплины нет — исторический курс
// (см. README архива части II).
//
// Использование:
//   node import-iogp.js <часть1-и-часть2(1-23)-dir=md> <часть2(24-58)-dir=archive_24_58>

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://yupoqkkxedkmhkpqivwa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nAk1Res337ENtZ8FRSTELQ__uUDY31o';
const ADMIN_EMAIL = 'admin.test@lexprep.local';
const ADMIN_PASSWORD = 'AdminLexPrep2026!';

const DISCIPLINE_ID = 'iogp';
const DISCIPLINE_TITLE = 'История отечественного государства и права';
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

const [, , dir1, dir2] = process.argv;
if (!dir1 || !dir2) {
  console.error('Usage: node import-iogp.js <md-dir> <archive_24_58-dir>');
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

// title уже вида "Тема N. Заголовок" — используем как есть для карточки
// темы, а из тела вырезаем необязательный редундантный "## Что ждёт..."
// не требуется — тело у конспектов и так без дублирующего "# Тема N" заголовка.

// Разбираем блок вопроса. Два варианта верстки в исходниках:
//  (а) "**Вопрос N.** Текст\n- A) ... **(верно)**\n...\n*Объяснение:* текст"
//      — правильный вариант помечен прямо в тексте опции;
//  (б) "**Вопрос N.** Текст\n- A) ...\n...\n*Правильный ответ: C*\n*Объяснение: текст*"
//      — правильный вариант вынесен отдельной строкой после списка опций.
function parseQuestions(testBody) {
  const blocks = testBody.split(/(?=^\*\*Вопрос\s+\d+\.\*\*)/m).filter(b => /^\*\*Вопрос\s+\d+\.\*\*/.test(b));
  return blocks.map(block => {
    const question = (block.match(/^\*\*Вопрос\s+\d+\.\*\*\s*(.+)$/m) || [])[1].trim();
    const optionMatches = [...block.matchAll(/^-\s*([A-D])\)\s*(.+)$/gm)];
    const options = optionMatches.map((m, i) => ({ id: LETTERS[i], text: m[2].replace(/\s*\*\*\(верно\)\*\*\s*$/, '').trim() }));

    let correct = optionMatches
      .map((m, i) => (/\*\*\(верно\)\*\*/.test(m[2]) ? LETTERS[i] : null))
      .filter(Boolean);

    if (!correct.length) {
      const answerLetterMatch = block.match(/\*Правильный ответ:\s*([A-D])\s*\*/);
      if (answerLetterMatch) {
        const idx = optionMatches.findIndex(m => m[1] === answerLetterMatch[1]);
        if (idx !== -1) correct = [LETTERS[idx]];
      }
    }

    const explanationMatch = block.match(/\*Объяснение:\s*(.+?)\s*\*(?:\s*$|\n)/s);
    return { question, options, correct, explanation: explanationMatch ? explanationMatch[1].trim() : '' };
  });
}

// Два варианта верстки карточек:
//  (а) "**N. Вопрос:** текст\n**Ответ:** текст"
//  (б) "**N. Текст вопроса?**\nТекст ответа" (без отдельного лейбла "Ответ:")
function parseCards(cardsBody) {
  const labeled = [...cardsBody.matchAll(/\*\*\d+\.\s*Вопрос:\*\*\s*(.+?)\s*\n\*\*Ответ:\*\*\s*(.+?)\s*(?=\n\*\*\d+\.\s*Вопрос:|$)/gs)];
  if (labeled.length) return labeled.map(m => ({ front: m[1].trim(), back: m[2].trim() }));

  const unlabeled = [...cardsBody.matchAll(/^\*\*(\d+)\.\s*(.+?)\*\*\s*\n(.+?)\s*(?=\n\*\*\d+\.\s|$)/gms)];
  return unlabeled.map(m => ({ front: m[2].trim(), back: m[3].trim() }));
}

// dir: каталог с файлами; chastPrefix: 'chast1' | 'chast2'; numberOffset:
// сдвиг для сквозной нумерации; namingStyle: 'prefixed' (test_/cards_ перед
// chastN) | 'suffixed' (chastN_temaNN_test/kartochki).
function collectPart(dir, chastPrefix, numberOffset, namingStyle) {
  const files = fs.readdirSync(dir);
  const byTopic = {};
  files.forEach(f => {
    let m;
    if (namingStyle === 'prefixed') {
      if ((m = f.match(new RegExp(`^${chastPrefix}_tema(\\d+)_konspekt\\.md$`)))) {
        (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).konspekt = f;
      } else if ((m = f.match(new RegExp(`^test_${chastPrefix}_tema(\\d+)\\.md$`)))) {
        (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).test = f;
      } else if ((m = f.match(new RegExp(`^cards_${chastPrefix}_tema(\\d+)\\.md$`)))) {
        (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).cards = f;
      }
    } else {
      if ((m = f.match(new RegExp(`^${chastPrefix}_tema(\\d+)_konspekt\\.md$`)))) {
        (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).konspekt = f;
      } else if ((m = f.match(new RegExp(`^${chastPrefix}_tema(\\d+)_test\\.md$`)))) {
        (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).test = f;
      } else if ((m = f.match(new RegExp(`^${chastPrefix}_tema(\\d+)_kartochki\\.md$`)))) {
        (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).cards = f;
      }
    }
  });

  const topics = [];
  const quizRows = [];
  const flashcardRows = [];

  Object.keys(byTopic).forEach(nStr => {
    const n = Number(nStr);
    const globalN = n + numberOffset;
    const f = byTopic[n];
    if (!f.konspekt || !f.test || !f.cards) {
      throw new Error(`Тема ${chastPrefix} ${n}: не хватает файлов (${JSON.stringify(f)})`);
    }

    const { title, body } = readFrontMatter(fs.readFileSync(path.join(dir, f.konspekt), 'utf-8'));
    topics.push({
      id: topicId(globalN),
      discipline_id: DISCIPLINE_ID,
      topic_number: globalN,
      title: title.replace(/^Тема\s+\d+\.\s*/, `Тема ${globalN}. `),
      section: DISCIPLINE_TITLE,
      body_markdown: body,
      sort_order: globalN
    });

    const testBody = readFrontMatter(fs.readFileSync(path.join(dir, f.test), 'utf-8')).body;
    const cardsBody = readFrontMatter(fs.readFileSync(path.join(dir, f.cards), 'utf-8')).body;

    quizRows.push({ topic_id: topicId(globalN), questions: parseQuestions(testBody) });
    flashcardRows.push({ topic_id: topicId(globalN), cards: parseCards(cardsBody) });
  });

  return { topics, quizRows, flashcardRows };
}

const part1 = collectPart(dir1, 'chast1', 0, 'prefixed');
const part2a = collectPart(dir1, 'chast2', 62, 'prefixed');
const part2b = collectPart(dir2, 'chast2', 62, 'suffixed');

const part2Topics = [...part2a.topics, ...part2b.topics];
const part2Quiz = [...part2a.quizRows, ...part2b.quizRows];
const part2Cards = [...part2a.flashcardRows, ...part2b.flashcardRows];

const topics = [...part1.topics, ...part2Topics].sort((a, b) => a.topic_number - b.topic_number);
const quizRows = [...part1.quizRows, ...part2Quiz];
const flashcardRows = [...part1.flashcardRows, ...part2Cards];

console.log(`Конспекты: ${topics.length} тем (часть I: ${part1.topics.length}, часть II: ${part2Topics.length}).`);
console.log(`Тесты: ${quizRows.reduce((s, r) => s + r.questions.length, 0)} вопросов по ${quizRows.length} темам.`);
console.log(`Карточки: ${flashcardRows.reduce((s, r) => s + r.cards.length, 0)} штук по ${flashcardRows.length} темам.`);

const badQuestions = quizRows.flatMap(r => r.questions.filter(q => !q.correct.length || !q.options.length));
if (badQuestions.length) {
  console.error(`${badQuestions.length} вопросов без правильного ответа/вариантов — прерываю импорт.`);
  console.error(JSON.stringify(badQuestions.slice(0, 3), null, 2));
  process.exit(1);
}
const badCards = flashcardRows.filter(r => !r.cards.length);
if (badCards.length) {
  console.error(`${badCards.length} тем без карточек — прерываю импорт.`);
  console.error(JSON.stringify(badCards.slice(0, 3), null, 2));
  process.exit(1);
}

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(async () => {
  const { error: loginErr } = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginErr) { console.error('Login failed:', loginErr.message); process.exit(1); }
  console.log('Logged in as admin.');

  const { error: discErr } = await client.from('disciplines').upsert({ id: DISCIPLINE_ID, title: DISCIPLINE_TITLE, sort_order: 6 });
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
