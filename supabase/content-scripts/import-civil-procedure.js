// LexPrep — импорт "Гражданский процесс" (ГПП), новая дисциплина.
//
// Формат исходников отличается от предыдущих импортов:
//   md/temaNN_konspekt.md         — конспект (некоторые темы — 12, 19, 20 —
//                                    продолжаются в temaNN_konspekt_chast2.md,
//                                    части склеиваются в один body_markdown)
//   md/temaNN_test.md             — тест: "**Вопрос N.** <текст вопроса...>"
//                                    (текст вопроса сразу после лейбла, не с
//                                    новой строки), варианты "- А) ...",
//                                    "**Правильный ответ:** <буква>"
//                                    (в этой дисциплине все вопросы с одним
//                                    правильным ответом — букв через запятую
//                                    не встречается, но парсер это допускает)
//   md/temaNN_cards.md            — карточки: "**КN. Вопрос?**\n<ответ>" —
//                                    БЕЗ отдельного лейбла "**Ответ:**",
//                                    ответ — это весь текст до следующей "**КN."
//   md/temaNN_praktika.md         — практика: плоский список "## N. <акт>"
//                                    с полями "**Позиция:**"/"**Обстоятельства:**"
//                                    и "**Почему важно:**" — без деления на
//                                    Пленумы/примеры (тот же эвристический
//                                    парсер, что у import-up2.js: всё уходит
//                                    в acts, case_law пустой).
//
// Self-hosted backend (api.lexprep.ru) — в отличие от старых import-*.js в
// этой папке, которые ходили в исходный hosted Supabase. Старые скрипты
// логинились под тестовым админ-аккаунтом, которого на новом бэкенде нет —
// вместо этого используем SERVICE_ROLE_KEY (обходит RLS без входа под каким-
// либо пользователем). Ключ не хардкодим в файл: передаём через переменную
// окружения.
//
// Использование:
//   LEXPREP_SERVICE_ROLE_KEY=... node import-civil-procedure.js <md-dir>

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://api.lexprep.ru';
const SERVICE_ROLE_KEY = process.env.LEXPREP_SERVICE_ROLE_KEY;

const DISCIPLINE_ID = 'civil-procedure';
const DISCIPLINE_TITLE = 'Гражданский процесс';
const SORT_ORDER = 10;
const SKIP_TOPICS = [26]; // неполный набор файлов — только конспект, без теста/карточек/практики

const [, , mdDir] = process.argv;
if (!mdDir) {
  console.error('Usage: LEXPREP_SERVICE_ROLE_KEY=... node import-civil-procedure.js <md-dir>');
  process.exit(1);
}
if (!SERVICE_ROLE_KEY) {
  console.error('Задайте переменную окружения LEXPREP_SERVICE_ROLE_KEY');
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
  return body.replace(/^\s*# .*\n/, '').trim();
}

// ---------------- Тесты ----------------

function parseQuestions(testBody) {
  const blocks = testBody.split(/(?=^\*\*Вопрос\s+\d+\.\*\*)/m).filter(b => /^\*\*Вопрос\s+\d+\.\*\*/.test(b));
  return blocks.map(block => {
    const question = (block.match(/^\*\*Вопрос\s+\d+\.\*\*\s*([\s\S]*?)(?=\n- [А-ЯЁ]\))/m) || [])[1];
    const optionMatches = [...block.matchAll(/^- ([А-ЯЁ])\)\s*(.+)$/gm)];
    const options = optionMatches.map(m => ({ id: m[1], text: m[2].trim() }));
    const answerMatch = block.match(/\*\*Правильн(?:ый ответ|ые ответы):\*\*\s*(.+)/);
    const correct = answerMatch
      ? answerMatch[1].split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const explanationMatch = block.match(/\*\*Объяснение:\*\*\s*([\s\S]*?)(?=\n---|\n\*\*Вопрос|$)/);
    return {
      question: question ? question.trim() : '',
      options,
      correct,
      explanation: explanationMatch ? explanationMatch[1].trim() : ''
    };
  });
}

// ---------------- Карточки ----------------

function parseCards(cardsBody) {
  const matches = [...cardsBody.matchAll(/\*\*К\d+\.\s*(.+?)\*\*\s*\n(.+?)(?=\n\*\*К\d+\.|$)/gs)];
  return matches.map(m => ({ front: m[1].trim(), back: m[2].trim() }));
}

// ---------------- Практика: плоский список, тот же эвристический парсер, что у import-up2.js ----------------

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

const files = fs.readdirSync(mdDir);
const byTopic = {};
files.forEach(f => {
  let m;
  if ((m = f.match(/^tema(\d+)_konspekt_chast2\.md$/))) (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).konspekt2 = f;
  else if ((m = f.match(/^tema(\d+)_konspekt\.md$/))) (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).konspekt = f;
  else if ((m = f.match(/^tema(\d+)_test\.md$/))) (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).test = f;
  else if ((m = f.match(/^tema(\d+)_cards\.md$/))) (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).cards = f;
  else if ((m = f.match(/^tema(\d+)_praktika\.md$/))) (byTopic[Number(m[1])] = byTopic[Number(m[1])] || {}).praktika = f;
});

const topics = [];
const quizRows = [];
const flashcardRows = [];
const practiceRows = [];

Object.keys(byTopic)
  .map(Number)
  .filter(n => !SKIP_TOPICS.includes(n))
  .sort((a, b) => a - b)
  .forEach(n => {
    const f = byTopic[n];
    if (!f.konspekt || !f.test || !f.cards || !f.praktika) {
      throw new Error(`Тема ${n}: не хватает файлов (${JSON.stringify(f)})`);
    }

    const part1 = readFrontMatter(fs.readFileSync(path.join(mdDir, f.konspekt), 'utf-8'));
    let bodyMarkdown = stripHeading(part1.body);
    if (f.konspekt2) {
      const part2 = readFrontMatter(fs.readFileSync(path.join(mdDir, f.konspekt2), 'utf-8'));
      bodyMarkdown += '\n\n' + stripHeading(part2.body);
    }
    topics.push({
      id: topicId(n),
      discipline_id: DISCIPLINE_ID,
      topic_number: n,
      title: part1.title,
      section: DISCIPLINE_TITLE,
      body_markdown: bodyMarkdown,
      sort_order: n
    });

    const { body: testBody } = readFrontMatter(fs.readFileSync(path.join(mdDir, f.test), 'utf-8'));
    quizRows.push({ topic_id: topicId(n), questions: parseQuestions(testBody) });

    const { body: cardsBody } = readFrontMatter(fs.readFileSync(path.join(mdDir, f.cards), 'utf-8'));
    flashcardRows.push({ topic_id: topicId(n), cards: parseCards(cardsBody) });

    const { body: praktikaBody } = readFrontMatter(fs.readFileSync(path.join(mdDir, f.praktika), 'utf-8'));
    const { acts, case_law } = parsePractice(praktikaBody);
    practiceRows.push({ topic_id: topicId(n), acts, case_law });
  });

console.log(`Конспекты: ${topics.length} тем.`);
console.log(`Тесты: ${quizRows.reduce((s, r) => s + r.questions.length, 0)} вопросов по ${quizRows.length} темам.`);
console.log(`Карточки: ${flashcardRows.reduce((s, r) => s + r.cards.length, 0)} штук по ${flashcardRows.length} темам.`);
console.log(`Практика: ${practiceRows.length} тем.`);

const badQuestions = quizRows.flatMap(r => r.questions.filter(q => !q.question || !q.correct.length || !q.options.length));
if (badQuestions.length) {
  console.error(`${badQuestions.length} вопросов без текста/правильного ответа/вариантов — прерываю импорт.`);
  console.error(JSON.stringify(badQuestions.slice(0, 3), null, 2));
  process.exit(1);
}
const mismatchedAnswers = quizRows.flatMap(r => r.questions.filter(q =>
  q.correct.some(letter => !q.options.some(o => o.id === letter))
));
if (mismatchedAnswers.length) {
  console.error(`${mismatchedAnswers.length} вопросов с правильным ответом, которого нет среди вариантов — прерываю импорт.`);
  console.error(JSON.stringify(mismatchedAnswers.slice(0, 3), null, 2));
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

const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async () => {
  const { error: discErr } = await client.from('disciplines').upsert({ id: DISCIPLINE_ID, title: DISCIPLINE_TITLE, sort_order: SORT_ORDER });
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

  const { error: practiceErr, data: practiceData } = await client.from('topic_practice').upsert(practiceRows).select('topic_id');
  if (practiceErr) { console.error('topic_practice upsert failed:', practiceErr.message); process.exit(1); }
  console.log(`Upserted practice for ${practiceData.length} topics.`);

  console.log('Done.');
})();
