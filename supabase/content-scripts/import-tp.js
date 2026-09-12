// LexPrep — импорт "Трудовое право" (ТП), новая дисциплина, 19 тем.
//
// Формат исходников — markdown с YAML front matter (title уже вида
// "Тема N. ..." / "Тест по теме N. ..." / "Карточки по теме N. ..." /
// "Практика ВС РФ по теме N. ..."), тот же стиль, что у igpzs/iogp:
//   md/temaNN_konspekt.md — конспект
//   md/temaNN_test.md     — тест: "**Вопрос N** (один ответ|несколько ответов)"
//                            + "A) ..." + "**Правильный ответ:** X" или
//                            "**Правильные ответы:** X, Y" + "**Объяснение:** ..."
//   md/temaNN_cards.md    — карточки: "**KN. Вопрос:** ...\n**Ответ:** ..."
//   md/temaNN_praktika.md — практика: "## Пленумы..." / "## Реальные примеры
//                            из практики" разделы с "### " подразделами
//                            (тот же формат, что у gp-chast2) — переиспользуем
//                            тот же эвристический парсер.
//
// Использование:
//   node import-tp.js <md-dir>

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://yupoqkkxedkmhkpqivwa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nAk1Res337ENtZ8FRSTELQ__uUDY31o';
const ADMIN_EMAIL = 'admin.test@lexprep.local';
const ADMIN_PASSWORD = 'AdminLexPrep2026!';

const DISCIPLINE_ID = 'labor-law';
const DISCIPLINE_TITLE = 'Трудовое право';
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

const [, , mdDir] = process.argv;
if (!mdDir) {
  console.error('Usage: node import-tp.js <md-dir>');
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

function stripHeading(body) {
  return body.replace(/^\s*# .*\n/, '').trim();
}

function parseQuestions(testBody) {
  const blocks = testBody.split(/(?=^\*\*Вопрос\s+\d+\*\*)/m).filter(b => /^\*\*Вопрос\s+\d+\*\*/.test(b));
  return blocks.map(block => {
    const question = (block.match(/^\*\*Вопрос\s+\d+\*\*[^\n]*\n(.+)$/m) || [])[1].trim();
    const optionMatches = [...block.matchAll(/^([A-Z])\)\s*(.+)$/gm)];
    const options = optionMatches.map(m => ({ id: m[1].toLowerCase(), text: m[2].trim() }));
    const answerMatch = block.match(/\*\*Правильн(?:ый ответ|ые ответы):\*\*\s*(.+)/);
    const correct = answerMatch
      ? answerMatch[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      : [];
    const explanationMatch = block.match(/\*\*Объяснение:\*\*\s*([\s\S]*?)(?=\n---|\n\*\*Вопрос|$)/);
    return { question, options, correct, explanation: explanationMatch ? explanationMatch[1].trim() : '' };
  });
}

function parseCards(cardsBody) {
  const matches = [...cardsBody.matchAll(/\*\*К\d+\.\s*Вопрос:\*\*\s*(.+?)\s*\n\*\*Ответ:\*\*\s*(.+?)\s*(?=\n\*\*К\d+\.\s*Вопрос:|$)/gs)];
  return matches.map(m => ({ front: m[1].trim(), back: m[2].trim() }));
}

// ---------------- Практика: тот же эвристический парсер, что у gp-chast2 ----------------

function splitTopSections(md) {
  const body = md.replace(/^#[^\n]*\n/, '');
  const parts = body.split(/^## /m).map(s => s.trim()).filter(Boolean);
  return parts.map(p => {
    const nl = p.indexOf('\n');
    return { heading: (nl === -1 ? p : p.slice(0, nl)).trim(), body: (nl === -1 ? '' : p.slice(nl + 1)).trim() };
  });
}

function splitSubSections(body) {
  if (!/^### /m.test(body)) return null;
  const parts = body.split(/^### /m).map(s => s.trim()).filter(Boolean);
  return parts.map(p => {
    const nl = p.indexOf('\n');
    return { heading: (nl === -1 ? p : p.slice(0, nl)).trim(), body: (nl === -1 ? '' : p.slice(nl + 1)).trim() };
  });
}

function splitLabeledFields(body) {
  const matches = [...body.matchAll(/\*\*([^*:]+):\*\*\s*([\s\S]*?)(?=\n?\*\*[^*:]+:\*\*|\n---|$)/g)];
  return matches.map(m => ({ label: m[1].trim().toLowerCase(), text: m[2].trim() }));
}

function parseActs(sectionBody, sectionHeading) {
  const subs = splitSubSections(sectionBody);
  if (!subs) {
    return [{ name: sectionHeading, positions: [{ point: '', position: sectionBody.replace(/^---\s*$/m, '').trim(), why_important: '' }] }];
  }
  return subs.map(sub => {
    const whyMatch = sub.body.match(/\*\*[^*:]*важно[^*:]*:\*\*\s*([\s\S]*?)(?=\n?\*\*[^*:]+:\*\*|\n---|$)/i);
    const whyImportant = whyMatch ? whyMatch[1].trim() : '';
    const withoutWhy = whyMatch ? sub.body.slice(0, whyMatch.index).trim() : sub.body.replace(/^---\s*$/m, '').trim();
    const bullets = [...withoutWhy.matchAll(/^-\s*(.+)$/gm)].map(m => m[1].trim());
    const position = bullets.length ? bullets.join('\n') : withoutWhy;
    return { name: sub.heading, positions: [{ point: '', position, why_important: whyImportant }] };
  });
}

function parseCaseLaw(sectionBody) {
  const subs = splitSubSections(sectionBody);
  if (!subs) {
    return [{ source: '', facts: '', conclusion: sectionBody.replace(/^---\s*$/m, '').trim() }];
  }
  return subs.map(sub => {
    const clean = sub.body.replace(/^---\s*$/m, '').trim();
    const fields = splitLabeledFields(clean);
    let source = '';
    const facts = [];
    const conclusion = [];
    fields.forEach(f => {
      if (f.label.includes('источник')) source = f.text;
      else if (f.label.includes('обстоятельств')) facts.push(f.text);
      else if (f.label.includes('вывод')) conclusion.push(f.text);
      else conclusion.push(f.text);
    });
    if (!fields.length) {
      source = sub.heading;
      conclusion.push(clean);
    } else if (!source) {
      source = sub.heading;
    }
    return { source, facts: facts.join('\n'), conclusion: conclusion.join('\n') };
  });
}

function parsePractice(md) {
  const sections = splitTopSections(md);
  const actsSection = sections[0];
  const caseSection = sections[1];
  const acts = actsSection ? parseActs(actsSection.body, actsSection.heading) : [];
  const caseLaw = caseSection ? parseCaseLaw(caseSection.body) : [];
  return { acts, case_law: caseLaw };
}

// ---------------- Сбор файлов ----------------

const files = fs.readdirSync(mdDir);
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

  const { title, body } = readFrontMatter(fs.readFileSync(path.join(mdDir, f.konspekt), 'utf-8'));
  topics.push({
    id: topicId(n),
    discipline_id: DISCIPLINE_ID,
    topic_number: n,
    title,
    section: DISCIPLINE_TITLE,
    body_markdown: stripHeading(body),
    sort_order: n
  });

  const { body: testBody } = readFrontMatter(fs.readFileSync(path.join(mdDir, f.test), 'utf-8'));
  quizRows.push({ topic_id: topicId(n), questions: parseQuestions(testBody) });

  const { body: cardsBody } = readFrontMatter(fs.readFileSync(path.join(mdDir, f.cards), 'utf-8'));
  flashcardRows.push({ topic_id: topicId(n), cards: parseCards(cardsBody) });

  if (f.praktika) {
    const { body: praktikaBody } = readFrontMatter(fs.readFileSync(path.join(mdDir, f.praktika), 'utf-8'));
    const { acts, case_law } = parsePractice(praktikaBody);
    practiceRows.push({ topic_id: topicId(n), acts, case_law });
  }
});

console.log(`Конспекты: ${topics.length} тем.`);
console.log(`Тесты: ${quizRows.reduce((s, r) => s + r.questions.length, 0)} вопросов по ${quizRows.length} темам.`);
console.log(`Карточки: ${flashcardRows.reduce((s, r) => s + r.cards.length, 0)} штук по ${flashcardRows.length} темам.`);
console.log(`Практика: ${practiceRows.length} тем.`);

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

  const { error: discErr } = await client.from('disciplines').upsert({ id: DISCIPLINE_ID, title: DISCIPLINE_TITLE, sort_order: 8 });
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
