// LexPrep — импорт "Уголовный процесс" (35 тем) в Supabase. Заменяет
// демо-контент дисциплины criminal-procedure в data.js на настоящий
// (content-loader.js подхватит его автоматически, как и civil/
// constitutional/criminal-law).
//
// Формат исходников (плоские .md на тему, без вложенных папок):
//   tema_NN_*.md          — конспект: front matter (title/topic_number) +
//                            markdown-тело ("## Что ждёт в теме" + "## N. ...")
//   cards_tema_NN.md      — карточки: "N. **Вопрос**\nОтвет" блоки
//   test_tema_NN.md        — тесты: "**N.** Вопрос\n- А) ...\n✔ Ответ: Б"
//   test_tema_NN_chast2.md — продолжение теста той же темы (нумерация
//                            вопросов продолжается, topic_number тот же)
//   praktika_tema_NN.md    — практика: "## <акт>" + "**Позиция**: ..." +
//                            "**Почему важно**: ..." (не для всех тем есть)
//
// Использование:
//   node import-criminal-procedure.js <путь-к-распакованному-архиву>

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://yupoqkkxedkmhkpqivwa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nAk1Res337ENtZ8FRSTELQ__uUDY31o';
const ADMIN_EMAIL = 'admin.test@lexprep.local';
const ADMIN_PASSWORD = 'AdminLexPrep2026!';

const DISCIPLINE_ID = 'criminal-procedure';
const DISCIPLINE_TITLE = 'Уголовный процесс';

const [, , srcDir] = process.argv;
if (!srcDir) {
  console.error('Usage: node import-criminal-procedure.js <src-dir>');
  process.exit(1);
}

function topicId(n) {
  return `${DISCIPLINE_ID}-${String(n).padStart(2, '0')}`;
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

/* ---------------- Конспекты ---------------- */

const konspektFiles = fs.readdirSync(srcDir).filter(f => /^tema_\d+_.*\.md$/.test(f));
const topics = konspektFiles.map(f => {
  const { topicNumber, title, body } = readFrontMatter(fs.readFileSync(path.join(srcDir, f), 'utf-8'));
  return {
    id: topicId(topicNumber),
    discipline_id: DISCIPLINE_ID,
    topic_number: topicNumber,
    title,
    section: DISCIPLINE_TITLE,
    body_markdown: body,
    sort_order: topicNumber
  };
}).sort((a, b) => a.topic_number - b.topic_number);
console.log(`Конспекты: ${topics.length} тем.`);

/* ---------------- Карточки ---------------- */

const cardsFiles = fs.readdirSync(srcDir).filter(f => /^cards_tema_\d+\.md$/.test(f));
const flashcardRows = cardsFiles.map(f => {
  const { topicNumber, body } = readFrontMatter(fs.readFileSync(path.join(srcDir, f), 'utf-8'));
  const cards = [...body.matchAll(/^\d+\.\s*\*\*(.+?)\*\*\s*\n(.+?)\s*(?=\n\n|$)/gms)]
    .map(m => ({ front: m[1].trim(), back: m[2].trim() }));
  return { topic_id: topicId(topicNumber), cards };
});
console.log(`Карточки: ${flashcardRows.reduce((s, r) => s + r.cards.length, 0)} штук по ${flashcardRows.length} темам.`);

/* ---------------- Тесты (+ chast2) ---------------- */

const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

// Варианты ответа и строка "✔ Ответ: X" встречаются то с ведущим "- ",
// то без — разбираем блок вопроса построчно, а не одним жадным regex'ом
// на "- "-префикс, чтобы не терять безпрефиксные строки ответа.
// options/correct — в той же форме {id,text}/id-массив, что и у
// civil/constitutional/criminal-law (см. lexprepConvertQuiz в
// content-loader.js — он ожидает именно эту форму, а не голые строки).
function parseQuestions(body) {
  const blocks = body.split(/(?=^\*\*\d+\.\*\*)/m).filter(b => /^\*\*\d+\.\*\*/.test(b));
  return blocks.map(block => {
    const question = (block.match(/^\*\*\d+\.\*\*\s*(.+)/) || [])[1].trim();
    const optionMatches = [...block.matchAll(/^-?\s*([А-Я])\)\s*(.+)$/gm)];
    const options = optionMatches.map((m, i) => ({ id: LETTERS[i] || String(i), text: m[2].trim() }));
    const answerLetter = (block.match(/✔\s*Ответ:\s*([А-Я])/) || [])[1];
    const correctIndex = optionMatches.findIndex(m => m[1] === answerLetter);
    return { question, options, correct: [LETTERS[correctIndex] || String(correctIndex)], explanation: '' };
  });
}

const testFiles = fs.readdirSync(srcDir).filter(f => /^test_tema_\d+\.md$/.test(f));
const quizRows = testFiles.map(f => {
  const { topicNumber, body } = readFrontMatter(fs.readFileSync(path.join(srcDir, f), 'utf-8'));
  let questions = parseQuestions(body);
  const part2File = `test_tema_${String(topicNumber).padStart(2, '0')}_chast2.md`;
  if (fs.existsSync(path.join(srcDir, part2File))) {
    const { body: body2 } = readFrontMatter(fs.readFileSync(path.join(srcDir, part2File), 'utf-8'));
    questions = questions.concat(parseQuestions(body2));
  }
  return { topic_id: topicId(topicNumber), questions };
});
console.log(`Тесты: ${quizRows.reduce((s, r) => s + r.questions.length, 0)} вопросов по ${quizRows.length} темам.`);

/* ---------------- Практика (не для всех тем) ---------------- */

const praktikaFiles = fs.readdirSync(srcDir).filter(f => /^praktika_tema_\d+\.md$/.test(f));
const practiceRows = praktikaFiles.map(f => {
  const { topicNumber, body } = readFrontMatter(fs.readFileSync(path.join(srcDir, f), 'utf-8'));
  const sections = body.split(/^## /m).slice(1);
  const acts = sections.map(s => {
    const [name, ...rest] = s.split('\n');
    const text = rest.join('\n');
    const whyIdx = text.search(/\*\*Почему важно\*\*/);
    const positionRaw = whyIdx >= 0 ? text.slice(0, whyIdx) : text;
    // Метка "**Позиция...**" почти всегда сразу закрывается двоеточием,
    // но в паре мест внутри неё есть уточнение в скобках до двоеточия —
    // поэтому [^:]* вместо [^*]*\*\*: сразу после закрывающих **.
    const position = positionRaw.replace(/^\*\*Позиция[^:]*:\s*/, '').trim();
    const whyImportant = (text.match(/\*\*Почему важно\*\*:\s*([\s\S]*)/) || [])[1] || '';
    return {
      name: name.trim(),
      positions: [{ point: '', position: position.trim(), why_important: whyImportant.trim() }]
    };
  });
  return { topic_id: topicId(topicNumber), acts, case_law: [] };
});
console.log(`Практика: ${practiceRows.reduce((s, r) => s + r.acts.length, 0)} позиций по ${practiceRows.length} темам (из 35 — без практики: ${35 - practiceRows.length}).`);

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(async () => {
  const { error: loginErr } = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginErr) { console.error('Login failed:', loginErr.message); process.exit(1); }
  console.log('Logged in as admin.');

  const { error: discErr } = await client.from('disciplines').upsert({ id: DISCIPLINE_ID, title: DISCIPLINE_TITLE, sort_order: 3 });
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
