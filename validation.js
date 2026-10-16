/* ==========================================================================
VALIDATION.JS — общая проверка email-адресов, имён пользователей и вывод
ошибок под полем формы. Подключается на страницах с формами (auth, index,
profile, article).

Имя проверяется и на сервере (supabase/name-check.sql) — списки слов там
те же, что здесь: меняешь один — поменяй и другой.
========================================================================== */

function isValidEmail(value) {
  const email = String(value || '').trim();
  const shape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!shape.test(email)) return false;

  const domain = email.split('@')[1];
  const labels = domain.split('.');
  if (labels.some(label => label.length === 0)) return false;

  const tld = labels[labels.length - 1];
  return tld.length >= 2 && /^[a-zA-Zа-яёА-ЯЁ]+$/.test(tld);
}

/* ---------------- Опечатки в email ----------------
   Частые ошибки: gmail.con, mail.ry, yandex.rru, gmial.com. Несуществующая
   зона (.con, .cpm, .ry…) — ошибка; похожий на популярный домен адрес —
   подсказка «Возможно, вы имели в виду…», которую можно принять или
   отклонить («Всё верно»). */
const LEXPREP_COMMON_EMAIL_DOMAINS = [
  'gmail.com', 'mail.ru', 'yandex.ru', 'ya.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'internet.ru',
  'rambler.ru', 'icloud.com', 'me.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com',
  'proton.me', 'protonmail.com', 'yandex.com', 'yandex.by', 'yandex.kz', 'mail.ua', 'ukr.net', 'tut.by'
];
// Зоны, которых не существует, но в которые часто попадают пальцем.
const LEXPREP_TLD_TYPOS = {
  con: 'com', cpm: 'com', cmo: 'com', ocm: 'com', comm: 'com', coom: 'com', cim: 'com', vom: 'com',
  xom: 'com', cpom: 'com', clm: 'com', copm: 'com', comn: 'com', con1: 'com',
  ry: 'ru', ri: 'ru', rj: 'ru', ruu: 'ru', rru: 'ru', ur: 'ru', rux: 'ru', ruz: 'ru', tu: 'ru', eu1: 'eu',
  nte: 'net', ner: 'net', nett: 'net', ogr: 'org', orgg: 'org', rog: 'org'
};

function lexprepEditDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// { error, suggestion } — error: адрес точно с опечаткой; suggestion:
// исправленный адрес (для error — вариант исправления, если он очевиден).
function checkEmailTypo(value) {
  const email = String(value || '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1) return {};
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const labels = domain.split('.');
  const tld = labels[labels.length - 1];
  if (LEXPREP_COMMON_EMAIL_DOMAINS.includes(domain)) return {};

  if (LEXPREP_TLD_TYPOS[tld]) {
    const fixedDomain = [...labels.slice(0, -1), LEXPREP_TLD_TYPOS[tld]].join('.');
    return { error: `Зоны «.${tld}» не существует.`, suggestion: `${local}@${fixedDomain}` };
  }

  let best = null;
  LEXPREP_COMMON_EMAIL_DOMAINS.forEach(known => {
    const dist = lexprepEditDistance(domain, known);
    if (dist > 0 && dist <= (known.length > 7 ? 2 : 1) && (!best || dist < best.dist)) best = { known, dist };
  });
  if (best) return { suggestion: `${local}@${best.known}` };
  return {};
}

function markFieldInvalid(input, message) {
  input.classList.add('is-invalid');
  let hint = input.parentElement.querySelector('.field-error');
  if (!hint) {
    hint = document.createElement('span');
    hint.className = 'field-error';
    input.insertAdjacentElement('afterend', hint);
  }
  hint.textContent = message;
}

function clearFieldInvalid(input) {
  input.classList.remove('is-invalid');
  const hint = input.parentElement.querySelector('.field-error');
  if (hint) hint.textContent = '';
}

// Подсказка под полем email с кнопками «Исправить» / «Всё верно».
function showEmailSuggestion(input, message, suggestion, allowKeep) {
  markFieldInvalid(input, '');
  const hint = input.parentElement.querySelector('.field-error');
  hint.textContent = '';
  hint.append(document.createTextNode(`${message} `));
  const fix = document.createElement('button');
  fix.type = 'button';
  fix.className = 'field-error__action';
  fix.textContent = `Исправить на ${suggestion}`;
  fix.addEventListener('click', () => {
    input.value = suggestion;
    delete input.dataset.emailConfirmed;
    clearFieldInvalid(input);
    input.focus();
  });
  hint.append(fix);
  if (allowKeep) {
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'field-error__action field-error__action--muted';
    keep.textContent = 'Всё верно';
    keep.addEventListener('click', () => {
      input.dataset.emailConfirmed = input.value.trim().toLowerCase();
      clearFieldInvalid(input);
    });
    hint.append(keep);
  }
}

function validateEmailField(input) {
  if (!isValidEmail(input.value)) {
    markFieldInvalid(input, 'Похоже, это не настоящий email — проверь адрес.');
    return false;
  }
  const typo = checkEmailTypo(input.value);
  if (typo.error) {
    if (typo.suggestion) showEmailSuggestion(input, typo.error, typo.suggestion, false);
    else markFieldInvalid(input, `${typo.error} Проверь адрес.`);
    return false;
  }
  if (typo.suggestion && input.dataset.emailConfirmed !== input.value.trim().toLowerCase()) {
    showEmailSuggestion(input, 'Возможно, в адресе опечатка.', typo.suggestion, true);
    return false;
  }
  clearFieldInvalid(input);
  return true;
}

/* ---------------- Имя пользователя (никнейм) ----------------
   Запрещаем мат (в том числе замаскированный латиницей, цифрами и
   разделителями: «x*у й», «п1зда», «bля»), оскорбления, служебные имена
   (админ, модератор, LexPrep) и явную бессмыслицу: фразы вроде «а что
   такок», набор букв с клавиатуры («фываолдж», «qwerty»), слова без
   гласных, смесь русских и латинских букв в одном слове. */
const LEXPREP_NAME_ROOTS = [
  'хуй', 'хуе', 'хуя', 'хуи', 'хую', 'хуы', 'пизд', 'пезд', 'бляд', 'блят', 'ебан', 'ебал', 'ебат', 'ебуч',
  'ебну', 'ебло', 'ебаш', 'еблан', 'ебет', 'ебут', 'ебис', 'долбое', 'заеб', 'выеб', 'поеб', 'наеб',
  'отъеб', 'уеб', 'съеб', 'въеб', 'мудак', 'мудил', 'мудоз', 'пидор', 'пидар', 'пидр', 'гандон',
  'гондон', 'залуп', 'шлюх', 'шалав', 'дроч', 'сучар', 'гитлер', 'нацис'
];
const LEXPREP_NAME_WORDS = [
  'бля', 'сука', 'суки', 'суку', 'хер', 'херня', 'нахер', 'похер', 'жопа', 'жопу', 'жопе', 'манда',
  'мразь', 'мрази', 'тварь', 'урод', 'дебил', 'идиот', 'даун', 'лох', 'член', 'пенис', 'говно',
  'говна', 'срать', 'ссать', 'секс', 'порно'
];
const LEXPREP_NAME_LATIN = ['fuck', 'shit', 'bitch', 'cunt', 'pussy', 'whore', 'nigg', 'hitler', 'nazi'];
const LEXPREP_NAME_LATIN_WORDS = ['dick', 'sex', 'porn', 'fck', 'wtf'];
const LEXPREP_NAME_RESERVED = ['admin', 'админ', 'модератор', 'moderator', 'lexprep', 'лекспреп', 'поддержк', 'support'];
// Слова-«не имена»: из них складываются фразы вроде «а что такое».
const LEXPREP_NAME_NOT_NAMES = [
  'что', 'чо', 'чё', 'шо', 'как', 'кто', 'где', 'это', 'эта', 'этот', 'такое', 'такой', 'такок', 'почему',
  'зачем', 'когда', 'куда', 'привет', 'здравствуйте', 'пока', 'хз', 'лол', 'кек', 'ок', 'окей', 'нет', 'да',
  'ну', 'вот', 'тест', 'тестовый', 'test', 'qwerty', 'asdf', 'имя', 'никнейм', 'name',
  'nickname', 'user', 'юзер', 'пользователь', 'аноним', 'anon', 'noname', 'неизвестный', 'просто',
  'вообще', 'хм', 'ааа', 'ыыы', 'abc', 'абв'
];
const LEXPREP_KEYBOARD_ROWS = ['йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
// Четыре клавиши подряд, которые встречаются в настоящих именах и фамилиях.
const LEXPREP_KEYBOARD_OK = ['апро', 'прол', 'смит', 'мить', 'erty', 'укен'];
const LEXPREP_HOMOGLYPHS = { a: 'а', b: 'б', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у', u: 'у', '0': 'о', '1': 'и', '3': 'з', '4': 'ч', '6': 'б', '@': 'а' };
const LEXPREP_TRANSLIT = [['shch', 'щ'], ['sch', 'щ'], ['yo', 'е'], ['zh', 'ж'], ['kh', 'х'], ['ts', 'ц'], ['ch', 'ч'], ['sh', 'ш'], ['ya', 'я'], ['yu', 'ю'], ['a', 'а'], ['b', 'б'], ['v', 'в'], ['g', 'г'], ['d', 'д'], ['e', 'е'], ['z', 'з'], ['i', 'и'], ['j', 'й'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'], ['f', 'ф'], ['h', 'х'], ['x', 'х'], ['c', 'к'], ['w', 'в'], ['y', 'ы'], ['q', 'к']];

function lexprepNameVariants(name) {
  const lower = String(name || '').toLowerCase().replace(/ё/g, 'е');
  const homoglyph = lower.split('').map(ch => LEXPREP_HOMOGLYPHS[ch] || ch).join('');
  let translit = lower;
  LEXPREP_TRANSLIT.forEach(([lat, cyr]) => { translit = translit.split(lat).join(cyr); });
  return [lower, homoglyph, translit];
}

function lexprepSqueeze(text) {
  // Без разделителей и повторов: «х у у й» → «хуй».
  return text.replace(/[^a-zа-я]/g, '').replace(/(.)\1+/g, '$1');
}

function checkDisplayName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 24 || !/^[A-Za-zА-Яа-яЁё0-9 .'_-]+$/.test(name)) {
    return 'Имя — от 2 до 24 символов: буквы, цифры, пробел, дефис, точка или подчёркивание.';
  }
  const letters = (name.match(/[A-Za-zА-Яа-яЁё]/g) || []).length;
  if (letters < 2) return 'В имени должно быть хотя бы две буквы.';

  const variants = lexprepNameVariants(name);
  const squeezed = variants.map(lexprepSqueeze);
  const words = variants.map(v => v.split(/[\s._'-]+/).filter(Boolean));
  if (squeezed.some(s => LEXPREP_NAME_ROOTS.some(root => s.includes(root)))
      || words.some(list => list.some(w => LEXPREP_NAME_WORDS.includes(w.replace(/(.)\1+/g, '$1')) || LEXPREP_NAME_WORDS.includes(w)))
      || LEXPREP_NAME_LATIN.some(root => lexprepSqueeze(variants[0]).includes(root))
      || words[0].some(w => LEXPREP_NAME_LATIN_WORDS.includes(w))) {
    return 'В имени есть недопустимые слова — выбери другое.';
  }
  if (LEXPREP_NAME_RESERVED.some(r => squeezed[0].includes(r) || squeezed[1].includes(r))) {
    return 'Это имя зарезервировано — выбери другое.';
  }

  const parts = name.split(' ');
  const notAName = 'Похоже не на имя. Укажи своё имя или никнейм — например, «Анна» или «Lex_Student».';
  if (parts.length > 3) return notAName;
  for (const part of parts) {
    const lettersOnly = part.replace(/[^A-Za-zА-Яа-яЁё]/g, '');
    const lower = lettersOnly.toLowerCase().replace(/ё/g, 'е');
    if (/[A-Za-z]/.test(lettersOnly) && /[А-Яа-яЁё]/.test(lettersOnly)) {
      return 'В одном слове смешаны русские и латинские буквы — исправь имя.';
    }
    // Однобуквенное слово — только инициал с точкой («Анна К.»).
    if (lettersOnly.length === 1 && !/^[A-Za-zА-Яа-яЁё]\.$/.test(part)) return notAName;
    if (LEXPREP_NAME_NOT_NAMES.includes(lower)) return notAName;
    if (/(.)\1\1/.test(lower)) return notAName;
    if (lower.length >= 4 && !/[аеиоуыэюяaeiouy]/.test(lower)) return notAName;
    if (/[бвгджзйклмнпрстфхцчшщ]{6,}/.test(lower) || /[bcdfghjklmnpqrstvwxz]{7,}/.test(lower)) return notAName;
    for (const row of LEXPREP_KEYBOARD_ROWS) {
      for (let i = 0; i + 4 <= row.length; i++) {
        const run = row.slice(i, i + 4);
        if (!LEXPREP_KEYBOARD_OK.includes(run) && lower.includes(run)) return notAName;
      }
    }
  }
  return null;
}

// Проверка поля имени с выводом ошибки под ним.
function validateNameField(input) {
  const problem = checkDisplayName(input.value);
  if (problem) {
    markFieldInvalid(input, problem);
    return false;
  }
  clearFieldInvalid(input);
  return true;
}

function getPasswordRuleStatus(password) {
  const value = String(password || '');
  return {
    length: value.length >= 8,
    letter: /[a-zA-Zа-яёА-ЯЁ]/.test(value),
    digit: /\d/.test(value),
    case: /[a-zа-яё]/.test(value) && /[A-ZА-ЯЁ]/.test(value)
  };
}

function isPasswordValid(password) {
  const status = getPasswordRuleStatus(password);
  return Object.keys(status).every(rule => status[rule]);
}
