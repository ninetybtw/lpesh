// LexPrep — общая эвристика "слишком очевидного" вопроса теста, используется
// admin-quiz-audit (только читает и показывает) и admin-quiz-fix (правит).
//
// Жалоба пользователей: в части вопросов 3 варианта ответа — одно слово,
// а один (обычно как раз правильный) — развёрнутый, из-за чего правильный
// ответ угадывается по одному внешнему виду, независимо от порядка
// вариантов (порядок и так перемешивается на фронтенде, см. duel-engine.js/
// exam.js — дело не в порядке, а в самом тексте вариантов).

export function wordCount(text: string): number {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

const RATIO_THRESHOLD = 2.5;
const SHORT_WORDS = 3;

export interface ObviousResult {
  correctWords: number;
  outlierIds: string[];
}

// Возвращает null, если вопрос выглядит нормально, иначе — список id
// вариантов-"отступников" (тех, что резко отличаются по объёму от
// правильного ответа) для последующей переписки.
export function findObviousOptions(question: any): ObviousResult | null {
  const options = Array.isArray(question?.options) ? question.options : [];
  const correctIds = new Set(question?.correct || []);
  const correctOpts = options.filter((o: any) => correctIds.has(o.id));
  const distractors = options.filter((o: any) => !correctIds.has(o.id));
  if (!correctOpts.length || distractors.length < 2) return null;

  const correctWords = Math.round(
    correctOpts.reduce((sum: number, o: any) => sum + wordCount(o.text), 0) / correctOpts.length
  );
  if (!correctWords) return null;

  const outlierIds: string[] = [];
  distractors.forEach((o: any) => {
    const w = wordCount(o.text) || 1;
    const ratio = Math.max(w, correctWords) / Math.min(w, correctWords);
    const tooShortOrLong = w <= SHORT_WORDS || correctWords <= SHORT_WORDS;
    if (ratio >= RATIO_THRESHOLD && tooShortOrLong) outlierIds.push(o.id);
  });

  return outlierIds.length ? { correctWords, outlierIds } : null;
}
