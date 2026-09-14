/* ==========================================================================
AUTH.JS — переключение вкладок Вход/Регистрация на странице auth.html
Подключается отдельным тегом <script src="auth.js"></script>,
ничего менять в script.js не нужно.
========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.auth-tab');
  const panels = document.querySelectorAll('.auth-panel');
  const success = document.getElementById('authSuccess');
  const successText = document.getElementById('authSuccessText');

  if (!tabs.length || !panels.length) return;

  function switchTo(name) {
    tabs.forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
    panels.forEach(p => { p.classList.toggle('is-active', p.dataset.panel === name); p.hidden = false; });
    if (success) success.classList.remove('is-visible');
    const confirmCodeForm = document.getElementById('confirmCodeForm');
    if (confirmCodeForm) confirmCodeForm.hidden = true;
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTo(tab.dataset.tab));
  });

  document.querySelectorAll('[data-switch]').forEach(btn => {
    btn.addEventListener('click', () => switchTo(btn.dataset.switch));
  });

  const regPasswordInput = document.getElementById('regPassword');
  const passwordRules = document.getElementById('passwordRules');
  if (regPasswordInput && passwordRules) {
    regPasswordInput.addEventListener('input', () => {
      const status = getPasswordRuleStatus(regPasswordInput.value);
      passwordRules.querySelectorAll('[data-rule]').forEach(item => {
        item.classList.toggle('is-met', !!status[item.dataset.rule]);
      });
    });
  }

  const authError = document.getElementById('authError');
  function showAuthError(message) {
    if (!authError) { alert(message); return; }
    authError.textContent = message;
    authError.hidden = false;
  }
  function hideAuthError() {
    if (authError) authError.hidden = true;
  }

  panels.forEach(panel => {
    panel.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAuthError();
      const isRegister = panel.dataset.panel === 'register';
      const emailInput = document.getElementById(isRegister ? 'regEmail' : 'loginEmail');

      if (!validateEmailField(emailInput)) {
        emailInput.focus();
        return;
      }

      const email = emailInput.value.trim();
      const submitBtn = panel.querySelector('button[type="submit"]');

      if (isRegister) {
        const passwordInput = document.getElementById('regPassword');
        const password = passwordInput.value;
        const passwordConfirm = document.getElementById('regPasswordConfirm').value;

        if (!isPasswordValid(password)) {
          markFieldInvalid(passwordInput, 'Пароль не соответствует требованиям ниже.');
          passwordInput.focus();
          return;
        }
        clearFieldInvalid(passwordInput);

        if (password !== passwordConfirm) {
          showAuthError('Пароли не совпадают.');
          return;
        }

        const name = document.getElementById('regName').value;
        submitBtn.disabled = true;
        try {
          const result = await LexPrepApi.register({ name, email, password });
          if (result.pendingConfirmation) {
            panel.hidden = true;
            showConfirmCodeForm(result.email);
          } else {
            localStorage.setItem('lexprep_user', JSON.stringify(result.user));
            if (successText) successText.textContent = 'Готово, входим…';
            if (success) success.classList.add('is-visible');
            setTimeout(() => { window.location.href = 'index.html'; }, 900);
          }
        } catch (err) {
          showAuthError(err.message);
        } finally {
          submitBtn.disabled = false;
        }
      } else {
        const password = document.getElementById('loginPassword').value;
        submitBtn.disabled = true;
        try {
          const user = await LexPrepApi.login({ email, password });
          localStorage.setItem('lexprep_user', JSON.stringify(user));
          if (successText) successText.textContent = 'Готово, входим…';
          if (success) success.classList.add('is-visible');
          setTimeout(() => { window.location.href = 'index.html'; }, 900);
        } catch (err) {
          showAuthError(err.message);
        } finally {
          submitBtn.disabled = false;
        }
      }
    });
  });

  const confirmCodeForm = document.getElementById('confirmCodeForm');
  const confirmCodeEmailEl = document.getElementById('confirmCodeEmail');
  const confirmCodeResendBtn = document.getElementById('confirmCodeResend');
  const confirmCodeSubmitBtn = document.getElementById('confirmCodeSubmit');
  const otpSlots = confirmCodeForm ? Array.from(confirmCodeForm.querySelectorAll('.otp-slot')) : [];
  let confirmCodeEmail = null;

  function getOtpValue() {
    return otpSlots.map(s => s.value).join('');
  }

  function clearOtpError() {
    otpSlots.forEach(s => s.classList.remove('is-error'));
  }

  function updateSubmitState() {
    if (confirmCodeSubmitBtn) confirmCodeSubmitBtn.disabled = getOtpValue().length !== otpSlots.length;
  }

  function fillOtp(digits) {
    const chars = digits.replace(/\D/g, '').slice(0, otpSlots.length).split('');
    otpSlots.forEach((slot, i) => {
      slot.value = chars[i] || '';
      slot.classList.toggle('is-filled', !!chars[i]);
    });
    updateSubmitState();
    const nextEmpty = otpSlots.find(s => !s.value);
    (nextEmpty || otpSlots[otpSlots.length - 1]).focus();
  }

  otpSlots.forEach((slot, i) => {
    slot.addEventListener('input', () => {
      clearOtpError();
      slot.value = slot.value.replace(/\D/g, '').slice(-1);
      slot.classList.toggle('is-filled', !!slot.value);
      if (slot.value && otpSlots[i + 1]) otpSlots[i + 1].focus();
      updateSubmitState();
      if (getOtpValue().length === otpSlots.length && confirmCodeForm) {
        confirmCodeForm.requestSubmit();
      }
    });

    slot.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !slot.value && otpSlots[i - 1]) {
        otpSlots[i - 1].focus();
      }
    });

    slot.addEventListener('paste', (e) => {
      e.preventDefault();
      fillOtp((e.clipboardData || window.clipboardData).getData('text'));
    });
  });

  function showConfirmCodeForm(email) {
    confirmCodeEmail = email;
    if (confirmCodeEmailEl) confirmCodeEmailEl.textContent = email;
    if (confirmCodeForm) confirmCodeForm.hidden = false;
    if (success) success.classList.remove('is-visible');
    hideAuthError();
    otpSlots.forEach(s => { s.value = ''; s.classList.remove('is-filled', 'is-error'); });
    updateSubmitState();
    if (otpSlots[0]) otpSlots[0].focus();
  }

  if (confirmCodeForm) {
    confirmCodeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAuthError();
      const code = getOtpValue();
      if (code.length !== otpSlots.length) return;
      confirmCodeSubmitBtn.disabled = true;
      otpSlots.forEach(s => s.disabled = true);
      try {
        const user = await LexPrepApi.confirmSignupCode({ email: confirmCodeEmail, code });
        localStorage.setItem('lexprep_user', JSON.stringify(user));
        confirmCodeForm.hidden = true;
        if (successText) successText.textContent = 'Готово, входим…';
        if (success) success.classList.add('is-visible');
        setTimeout(() => { window.location.href = 'index.html'; }, 900);
      } catch (err) {
        otpSlots.forEach(s => s.classList.add('is-error'));
        showAuthError(err.message);
      } finally {
        confirmCodeSubmitBtn.disabled = false;
        otpSlots.forEach(s => s.disabled = false);
      }
    });
  }

  if (confirmCodeResendBtn) {
    confirmCodeResendBtn.addEventListener('click', async () => {
      if (!confirmCodeEmail) return;
      confirmCodeResendBtn.disabled = true;
      try {
        await LexPrepApi.resendSignupCode({ email: confirmCodeEmail });
        showAuthError('Код отправлен ещё раз — проверь почту.');
      } catch (err) {
        showAuthError(err.message);
      } finally {
        confirmCodeResendBtn.disabled = false;
      }
    });
  }

  const hash = window.location.hash.replace('#', '');
  if (hash === 'register' || hash === 'login') {
    switchTo(hash);
  }
});