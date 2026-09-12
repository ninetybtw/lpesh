// LexPrep — импорт "Уголовное право. Общая часть" (19 тем) в Supabase.
// Формат исходников отличается от гражданского права (см. import-topics.js/
// import-quiz-content.js): Cyrillic YAML front matter в конспектах, JSON
// вопросов использует "prompt" вместо "question", практика — "plenum_acts"/
// "case_examples" вместо "acts"/"case_law", карточки — только markdown
// (**N. Вопрос**\n\n> Ответ) без JSON. Здесь всё нормализуется под ту же
// форму в БД, что и гражданское право (topics/topic_quiz/topic_flashcards/
// topic_practice) — content-loader.js на фронтенде уже умеет её читать
// без доп. изменений.
//
// Использование:
//   npm install @supabase/supabase-js@2
//   node import-criminal-law.js <konspekty-md-dir> <testy-json-dir> <kartochki-md-dir> <praktika-json-dir>

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://yupoqkkxedkmhkpqivwa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nAk1Res337ENtZ8FRSTELQ__uUDY31o';
const ADMIN_EMAIL = 'admin.test@lexprep.local';
const ADMIN_PASSWORD = 'AdminLexPrep2026!';

const DISCIPLINE_ID = 'criminal-law';
const DISCIPLINE_TITLE = 'Уголовное право';

const [, , konspektyDir, testyDir, kartochkiDir, praktikaDir] = process.argv;
if (!konspektyDir || !testyDir || !kartochkiDir || !praktikaDir) {
  console.error('Usage: node import-criminal-law.js <konspekty-dir> <testy-dir> <kartochki-dir> <praktika-dir>');
  process.exit(1);
}

function topicId(n) {
  return `${DISCIPLINE_ID}-${String(n).padStart(2, '0')}`;
}

function parseKonspekt(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`No front matter in ${filePath}`);
  const [, front, rest] = m;

  const topicNumber = Number((front.match(/тема:\s*(\d+)/) || [])[1]);
  const title = (front.match(/название:\s*"([^"]*)"/) || [])[1];
  if (!topicNumber || !title) throw new Error(`Missing тема/название in ${filePath}`);

  const body = rest.replace(/^\s*# Тема \d+\.[^\n]*\n/, '').trim();
  return { topicNumber, title, body };
}

function parseFlashcardsMd(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const matches = [...content.matchAll(/^\*\*(\d+)\.\s*(.+?)\*\*\s*\n+>\s*(.+?)\s*$/gm)];
  return matches.map(m => ({ front: m[2].trim(), back: m[3].trim() }));
}

const konspektFiles = fs.readdirSync(konspektyDir).filter(f => f.endsWith('.md'));
const topics = konspektFiles.map(f => {
  const { topicNumber, title, body } = parseKonspekt(path.join(konspektyDir, f));
  return {
    id: topicId(topicNumber),
    discipline_id: DISCIPLINE_ID,
    topic_number: topicNumber,
    title,
    section: DISCIPLINE_TITLE,
    body_markdown: body,
    sort_order: topicNumber
  };
});

const testyFiles = fs.readdirSync(testyDir).filter(f => f.endsWith('.json'));
const quizRows = testyFiles.map(f => {
  const d = JSON.parse(fs.readFileSync(path.join(testyDir, f), 'utf-8'));
  const questions = d.questions.map(q => ({
    id: q.id,
    type: q.type,
    question: q.prompt,
    options: q.options,
    correct: q.correct,
    explanation: q.explanation
  }));
  return { topic_id: topicId(d.topic), questions };
});

const kartochkiFiles = fs.readdirSync(kartochkiDir).filter(f => f.endsWith('.md'));
const flashcardRows = kartochkiFiles.map(f => {
  const num = Number((f.match(/^(\d+)_/) || [])[1]);
  if (!num) throw new Error(`Cannot derive topic number from ${f}`);
  const cards = parseFlashcardsMd(path.join(kartochkiDir, f));
  return { topic_id: topicId(num), cards };
});

const praktikaFiles = fs.readdirSync(praktikaDir).filter(f => f.endsWith('.json'));
const practiceRows = praktikaFiles.map(f => {
  const d = JSON.parse(fs.readFileSync(path.join(praktikaDir, f), 'utf-8'));
  const acts = (d.plenum_acts || []).map(a => ({
    name: a.act,
    positions: [{ point: a.punkt, position: a.position, why_important: a.why_important }]
  }));
  const case_law = (d.case_examples || []).map(c => ({ source: c.source, facts: c.facts, conclusion: c.conclusion }));
  return { topic_id: topicId(d.topic), acts, case_law };
});

console.log(`Parsed: ${topics.length} topics, ${quizRows.reduce((s, r) => s + r.questions.length, 0)} questions, ${flashcardRows.reduce((s, r) => s + r.cards.length, 0)} cards, ${practiceRows.reduce((s, r) => s + r.acts.length, 0)} acts / ${practiceRows.reduce((s, r) => s + r.case_law.length, 0)} cases.`);

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(async () => {
  const { error: loginErr } = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginErr) { console.error('Login failed:', loginErr.message); process.exit(1); }
  console.log('Logged in as admin.');

  const { error: discErr } = await client.from('disciplines').upsert({ id: DISCIPLINE_ID, title: DISCIPLINE_TITLE, sort_order: 1 });
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
})();
