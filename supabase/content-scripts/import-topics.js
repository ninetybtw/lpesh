// LexPrep — импорт конспекта в public.disciplines/public.topics (см.
// ../content.sql). Ожидает исходник в формате из первого импорта
// (Гражданское право, 26 тем): каталог с topic-NN.md файлами, каждый с
// YAML front matter (id/topic_number/title/section) и телом из markdown
// (## Дидактические единицы / ## Конспект).
//
// Использование:
//   npm install @supabase/supabase-js@2
//   node import-topics.js <путь-к-каталогу-с-topic-NN.md> <discipline-id> <discipline-title>
//
// Логинится тестовым админом (см. supabase/admin.sql) — обычный
// пользователь insert/update topics/disciplines не может (RLS).

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { structureDocument } = require('./structure-text.js');

const SUPABASE_URL = 'https://yupoqkkxedkmhkpqivwa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nAk1Res337ENtZ8FRSTELQ__uUDY31o';
const ADMIN_EMAIL = 'admin.test@lexprep.local';
const ADMIN_PASSWORD = 'AdminLexPrep2026!';

const [, , srcDir, disciplineId, disciplineTitle] = process.argv;
if (!srcDir || !disciplineId || !disciplineTitle) {
  console.error('Usage: node import-topics.js <src-dir> <discipline-id> <discipline-title>');
  process.exit(1);
}

function parseTopicFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`No front matter in ${filePath}`);
  const [, front, rest] = m;

  const topicNumber = Number((front.match(/topic_number:\s*(\d+)/) || [])[1]);
  const title = (front.match(/title:\s*"([^"]*)"/) || [])[1];
  const section = (front.match(/section:\s*"([^"]*)"/) || [])[1];
  if (!topicNumber || !title) throw new Error(`Missing topic_number/title in ${filePath}`);

  let body = rest.replace(/^\s*# Тема \d+\.[^\n]*\n/, '');
  body = body.replace(/^\s*\*Раздел[^\n]*\*\n/, '');
  body = body.trim();

  return { topicNumber, title, section, body: structureDocument(body) };
}

const files = fs.readdirSync(srcDir).filter(f => /^topic-\d+\.md$/.test(f)).sort();
const topics = files.map(f => {
  const parsed = parseTopicFile(path.join(srcDir, f));
  return {
    id: `${disciplineId}-${String(parsed.topicNumber).padStart(2, '0')}`,
    discipline_id: disciplineId,
    topic_number: parsed.topicNumber,
    title: parsed.title,
    section: parsed.section,
    body_markdown: parsed.body,
    sort_order: parsed.topicNumber
  };
});

console.log(`Parsed+structured ${topics.length} topics.`);

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(async () => {
  const { error: loginErr } = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (loginErr) {
    console.error('Login failed:', loginErr.message);
    process.exit(1);
  }
  console.log('Logged in as admin.');

  const { error: discErr } = await client.from('disciplines').upsert({ id: disciplineId, title: disciplineTitle, sort_order: 0 });
  if (discErr) {
    console.error('Discipline upsert failed:', discErr.message);
    process.exit(1);
  }

  const { error: topicsErr, data } = await client.from('topics').upsert(topics).select('id');
  if (topicsErr) {
    console.error('Topics upsert failed:', topicsErr.message, topicsErr.details);
    process.exit(1);
  }
  console.log(`Upserted ${data.length} topics into discipline "${disciplineId}".`);
})();
