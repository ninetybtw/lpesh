/* ==========================================================================
VALIDATION.JS — общая проверка email-адресов и вывод ошибок под полем формы.
Подключается на страницах с формами (auth, index, profile, article).
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

function validateEmailField(input) {
  if (!isValidEmail(input.value)) {
    markFieldInvalid(input, 'Похоже, это не настоящий email — проверь адрес.');
    return false;
  }
  clearFieldInvalid(input);
  return true;
}
