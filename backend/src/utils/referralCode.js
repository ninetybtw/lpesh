// Тот же формат, что фронтенд использовал для локально сгенерированного
// промокода (LEX-XXXXXX, без похожих друг на друга символов) — чтобы у
// пользователей, которые уже видели свой код, он не менялся с переездом
// на бэкенд.
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateReferralCode() {
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return `LEX-${suffix}`;
}

module.exports = { generateReferralCode };
