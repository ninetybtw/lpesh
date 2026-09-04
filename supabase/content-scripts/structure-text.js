// Эвристическая структуризация "сплошного" конспекта: разбивает текст на
// абзацы/списки там, где в исходнике это явно list-подобная структура
// (нумерация "1. ...", буллеты "•"), а остальной сплошной текст режет на
// абзацы по границам предложений (осторожно, чтобы не резать по
// сокращениям вида "ст.", "п.", "т.д.").

const ABBR = ['т\\.д', 'т\\.е', 'т\\.п', 'т\\.к', 'др', 'пр', 'см', 'ст', 'п', 'пп', 'гл', 'ч', 'г', 'им', 'проф', 'руб', 'чел', 'н\\.э', 'в', 'вв'];
const ABBR_RE = new RegExp(`(?:${ABBR.join('|')})\\.$`, 'i');

function splitSentences(text) {
  // Разбиваем по ". "/"! "/"? " перед заглавной буквой, но не там, где
  // перед точкой — известное сокращение.
  const parts = text.split(/(?<=[.!?])\s+(?=[А-ЯЁ])/);
  const out = [];
  let buf = '';
  for (const part of parts) {
    if (buf) {
      const prevEnd = buf.trim().split(/\s+/).pop();
      if (ABBR_RE.test(prevEnd)) {
        buf += ' ' + part;
        continue;
      }
      out.push(buf);
      buf = part;
    } else {
      buf = part;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function groupSentences(sentences, perParagraph = 3) {
  const paras = [];
  for (let i = 0; i < sentences.length; i += perParagraph) {
    paras.push(sentences.slice(i, i + perParagraph).join(' ').trim());
  }
  return paras;
}

function structureBlock(rawBlock) {
  // Схлопываем ВСЕ переносы строк источника в пробелы: раздел абзацев —
  // целиком наша ответственность ниже (через outParts.join('\n\n')).
  // Если этого не сделать, случайные пустые строки из исходника (перед
  // "1) ...", "2) ..." и т.п.) доходят до markdown как есть и
  // commonmark сам разбирает их как начало списка — мимо всей логики
  // этого файла.
  let text = rawBlock.replace(/\s+/g, ' ').trim();
  if (!text) return '';

  // Инлайн-буллеты "• " -> каждый на новую строку как элемент списка.
  // Убираем "• -" -> "• " (в исходнике встречается двойной маркер).
  text = text.replace(/•\s*-\s*/g, '• ');
  const bulletSplit = text.split(/(?=•\s)/g).map(s => s.trim()).filter(Boolean);

  const chunks = [];
  bulletSplit.forEach(chunk => {
    if (chunk.startsWith('•')) {
      const inner = chunk.replace(/^•\s*/, '').trim();
      // Буллеты в исходнике короткие (пара слов/словосочетание). Если
      // после первого предложения идёт ещё длинный текст без своего "•" —
      // это уже не часть буллета, а обычная проза, которая просто
      // случайно прилипла к нему при разбиении по "•".
      const sentences = splitSentences(inner);
      const first = sentences[0] || inner;
      const rest = sentences.slice(1).join(' ').trim();
      chunks.push({ type: 'bullet', text: first.replace(/[;:.]\s*$/, '').trim() });
      if (rest && rest.length > 40) {
        chunks.push({ type: 'prose', text: rest });
      }
    } else {
      chunks.push({ type: 'prose', text: chunk });
    }
  });

  const outParts = [];
  let proseBuf = [];

  function flushProse() {
    if (!proseBuf.length) return;
    const combined = proseBuf.join(' ').trim();
    proseBuf = [];
    if (!combined) return;

    // Внутри прозы: нумерованные пункты вида "N. Заглавная" -> список,
    // если таких пунктов 2+ подряд по всему блоку. Рендерим не как
    // настоящий markdown-список ("N. текст"), а как жирный номер перед
    // абзацем ("**N.** текст") — иначе commonmark склеивает подряд идущие
    // "N. ..." из РАЗНЫХ, не связанных друг с другом перечислений (когда
    // нумерация начинается заново с 1) в один общий <ol>.
    const numberedSplit = combined.split(/(?=(?:^|\s)\d{1,2}\.\s+(?=[А-ЯЁ]))/g);
    const numberedItems = numberedSplit.filter(s => /^\s*\d{1,2}\.\s+[А-ЯЁ]/.test(s));
    if (numberedItems.length >= 3 && numberedItems.length === numberedSplit.filter(Boolean).length - (/^\s*\d{1,2}\.\s+[А-ЯЁ]/.test(numberedSplit[0]) ? 0 : 1)) {
      numberedSplit.filter(Boolean).forEach(seg => {
        const m = seg.match(/^\s*(\d{1,2})\.\s+(.*)$/s);
        if (m) {
          outParts.push(`**${m[1]}.** ${m[2].trim()}`);
        } else if (seg.trim()) {
          groupSentences(splitSentences(seg.trim()), 3).forEach(p => outParts.push(p));
        }
      });
    } else {
      groupSentences(splitSentences(combined), 3).forEach(p => outParts.push(p));
    }
  }

  chunks.forEach(c => {
    if (c.type === 'bullet') {
      flushProse();
      outParts.push(`- ${c.text}`);
    } else {
      proseBuf.push(c.text);
    }
  });
  flushProse();

  // Финальная защита: если абзац всё равно начинается с "N." или "N)"
  // (источник вперемешку использует оба стиля нумерации, и не все случаи
  // ловит эвристика выше — например, если пунктов всего 1-2), markdown
  // распознает это как начало нумерованного списка и может склеить с
  // соседними такими же абзацами в один <ol>, даже если они из разных,
  // не связанных перечислений. Превращаем маркер в жирный текст — тогда
  // это просто абзац, никакого list-парсинга.
  return outParts
    .map(p => p.replace(/^(\d{1,2})[.)]\s+/, (full, num) => `**${num}.** `))
    .join('\n\n');
}

// Обрабатываем весь markdown-документ по секциям "## ..." отдельно, чтобы
// заголовки/структура секций не трогались, только текст внутри.
function structureDocument(md) {
  const sectionRe = /(^## .*$)/m;
  const pieces = md.split(/(^## .*$)/m);
  let out = '';
  for (let i = 0; i < pieces.length; i++) {
    if (/^## /.test(pieces[i])) {
      out += pieces[i] + '\n';
    } else {
      out += structureBlock(pieces[i]) + '\n\n';
    }
  }
  return out.trim() + '\n';
}

module.exports = { structureDocument, structureBlock, splitSentences };
