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
    const otpOverlay = document.getElementById('otpOverlay');
    if (otpOverlay) otpOverlay.classList.remove('is-visible');
    const resetOverlay = document.getElementById('resetOverlay');
    if (resetOverlay) resetOverlay.classList.remove('is-visible');
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
  const otpErrorEl = document.getElementById('otpError');
  const otpSlots = confirmCodeForm ? Array.from(confirmCodeForm.querySelectorAll('.otp-slot')) : [];
  let confirmCodeEmail = null;

  function showOtpError(message) {
    if (!otpErrorEl) return;
    otpErrorEl.textContent = message;
    otpErrorEl.hidden = false;
  }
  function hideOtpError() {
    if (otpErrorEl) otpErrorEl.hidden = true;
  }

  function getOtpValue() {
    return otpSlots.map(s => s.value).join('');
  }

  function clearOtpError() {
    otpSlots.forEach(s => s.classList.remove('is-error'));
    hideOtpError();
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
    const otpOverlay = document.getElementById('otpOverlay');
    if (otpOverlay) otpOverlay.classList.add('is-visible');
    if (success) success.classList.remove('is-visible');
    hideAuthError();
    hideOtpError();
    otpSlots.forEach(s => { s.value = ''; s.classList.remove('is-filled', 'is-error'); });
    updateSubmitState();
    setTimeout(() => { if (otpSlots[0]) otpSlots[0].focus(); }, 50);
  }

  if (confirmCodeForm) {
    confirmCodeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideOtpError();
      const code = getOtpValue();
      if (code.length !== otpSlots.length) return;
      confirmCodeSubmitBtn.disabled = true;
      otpSlots.forEach(s => s.disabled = true);
      try {
        const user = await LexPrepApi.confirmSignupCode({ email: confirmCodeEmail, code });
        localStorage.setItem('lexprep_user', JSON.stringify(user));
        const otpOverlay = document.getElementById('otpOverlay');
        if (otpOverlay) otpOverlay.classList.remove('is-visible');
        if (successText) successText.textContent = 'Готово, входим…';
        if (success) success.classList.add('is-visible');
        setTimeout(() => { window.location.href = 'index.html'; }, 900);
      } catch (err) {
        otpSlots.forEach(s => s.classList.add('is-error'));
        showOtpError(err.message);
        otpSlots.forEach(s => s.disabled = false);
        confirmCodeSubmitBtn.disabled = false;
      }
    });
  }

  if (confirmCodeResendBtn) {
    confirmCodeResendBtn.addEventListener('click', async () => {
      if (!confirmCodeEmail) return;
      confirmCodeResendBtn.disabled = true;
      try {
        await LexPrepApi.resendSignupCode({ email: confirmCodeEmail });
        showOtpError('Код отправлен ещё раз — проверь почту.');
      } catch (err) {
        showOtpError(err.message);
      } finally {
        confirmCodeResendBtn.disabled = false;
      }
    });
  }

  // ---- Восстановление пароля по коду с почты ----
  const resetOverlay = document.getElementById('resetOverlay');
  const forgotPasswordLink = document.getElementById('forgotPasswordLink');
  const resetStepEmail = document.getElementById('resetStepEmail');
  const resetRequestForm = document.getElementById('resetRequestForm');
  const resetRequestSubmitBtn = document.getElementById('resetRequestSubmit');
  const resetRequestErrorEl = document.getElementById('resetRequestError');
  const resetCancelBtn = document.getElementById('resetCancelBtn');
  const resetConfirmForm = document.getElementById('resetConfirmForm');
  const resetConfirmEmailEl = document.getElementById('resetConfirmEmail');
  const resetConfirmErrorEl = document.getElementById('resetConfirmError');
  const resetConfirmSubmitBtn = document.getElementById('resetConfirmSubmit');
  const resetResendBtn = document.getElementById('resetResendBtn');
  const resetOtpSlots = resetConfirmForm ? Array.from(resetConfirmForm.querySelectorAll('.otp-slot')) : [];
  const resetNewPasswordInput = document.getElementById('resetNewPassword');
  const resetNewPasswordConfirmInput = document.getElementById('resetNewPasswordConfirm');
  const resetPasswordRules = document.getElementById('resetPasswordRules');
  let resetEmail = null;

  function showResetRequestError(message) {
    if (!resetRequestErrorEl) return;
    resetRequestErrorEl.textContent = message;
    resetRequestErrorEl.hidden = false;
  }
  function hideResetRequestError() {
    if (resetRequestErrorEl) resetRequestErrorEl.hidden = true;
  }
  function showResetConfirmError(message) {
    if (!resetConfirmErrorEl) return;
    resetConfirmErrorEl.textContent = message;
    resetConfirmErrorEl.hidden = false;
  }
  function hideResetConfirmError() {
    if (resetConfirmErrorEl) resetConfirmErrorEl.hidden = true;
  }

  function getResetOtpValue() {
    return resetOtpSlots.map(s => s.value).join('');
  }
  function clearResetOtpError() {
    resetOtpSlots.forEach(s => s.classList.remove('is-error'));
    hideResetConfirmError();
  }
  function updateResetSubmitState() {
    if (resetConfirmSubmitBtn) {
      resetConfirmSubmitBtn.disabled = getResetOtpValue().length !== resetOtpSlots.length;
    }
  }
  function fillResetOtp(digits) {
    const chars = digits.replace(/\D/g, '').slice(0, resetOtpSlots.length).split('');
    resetOtpSlots.forEach((slot, i) => {
      slot.value = chars[i] || '';
      slot.classList.toggle('is-filled', !!chars[i]);
    });
    updateResetSubmitState();
    const nextEmpty = resetOtpSlots.find(s => !s.value);
    (nextEmpty || resetOtpSlots[resetOtpSlots.length - 1]).focus();
  }

  resetOtpSlots.forEach((slot, i) => {
    slot.addEventListener('input', () => {
      clearResetOtpError();
      slot.value = slot.value.replace(/\D/g, '').slice(-1);
      slot.classList.toggle('is-filled', !!slot.value);
      if (slot.value && resetOtpSlots[i + 1]) resetOtpSlots[i + 1].focus();
      updateResetSubmitState();
    });
    slot.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !slot.value && resetOtpSlots[i - 1]) {
        resetOtpSlots[i - 1].focus();
      }
    });
    slot.addEventListener('paste', (e) => {
      e.preventDefault();
      fillResetOtp((e.clipboardData || window.clipboardData).getData('text'));
    });
  });

  if (resetNewPasswordInput && resetPasswordRules) {
    resetNewPasswordInput.addEventListener('input', () => {
      const status = getPasswordRuleStatus(resetNewPasswordInput.value);
      resetPasswordRules.querySelectorAll('[data-rule]').forEach(item => {
        item.classList.toggle('is-met', !!status[item.dataset.rule]);
      });
    });
  }

  function showResetStep(step) {
    if (resetStepEmail) resetStepEmail.hidden = step !== 'email';
    if (resetConfirmForm) resetConfirmForm.hidden = step !== 'code';
  }

  function openResetOverlay() {
    if (!resetOverlay) return;
    hideAuthError();
    if (success) success.classList.remove('is-visible');
    resetEmail = null;
    hideResetRequestError();
    hideResetConfirmError();
    if (resetRequestForm) resetRequestForm.reset();
    showResetStep('email');
    resetOverlay.classList.add('is-visible');
    setTimeout(() => { const el = document.getElementById('resetEmail'); if (el) el.focus(); }, 50);
  }

  function closeResetOverlay() {
    if (resetOverlay) resetOverlay.classList.remove('is-visible');
  }

  function showResetConfirmStep(email) {
    resetEmail = email;
    if (resetConfirmEmailEl) resetConfirmEmailEl.textContent = email;
    hideResetConfirmError();
    resetOtpSlots.forEach(s => { s.value = ''; s.classList.remove('is-filled', 'is-error'); });
    if (resetNewPasswordInput) resetNewPasswordInput.value = '';
    if (resetNewPasswordConfirmInput) resetNewPasswordConfirmInput.value = '';
    if (resetPasswordRules) resetPasswordRules.querySelectorAll('[data-rule]').forEach(item => item.classList.remove('is-met'));
    updateResetSubmitState();
    showResetStep('code');
    setTimeout(() => { if (resetOtpSlots[0]) resetOtpSlots[0].focus(); }, 50);
  }

  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', openResetOverlay);
  }
  if (resetCancelBtn) {
    resetCancelBtn.addEventListener('click', closeResetOverlay);
  }

  if (resetRequestForm) {
    resetRequestForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideResetRequestError();
      const emailInput = document.getElementById('resetEmail');
      if (!validateEmailField(emailInput)) {
        emailInput.focus();
        return;
      }
      const email = emailInput.value.trim();
      resetRequestSubmitBtn.disabled = true;
      try {
        await LexPrepApi.requestPasswordReset({ email });
        showResetConfirmStep(email);
      } catch (err) {
        showResetRequestError(err.message);
      } finally {
        resetRequestSubmitBtn.disabled = false;
      }
    });
  }

  if (resetConfirmForm) {
    resetConfirmForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideResetConfirmError();
      const code = getResetOtpValue();
      if (code.length !== resetOtpSlots.length) return;

      if (!isPasswordValid(resetNewPasswordInput.value)) {
        markFieldInvalid(resetNewPasswordInput, 'Пароль не соответствует требованиям выше.');
        resetNewPasswordInput.focus();
        return;
      }
      clearFieldInvalid(resetNewPasswordInput);

      if (resetNewPasswordInput.value !== resetNewPasswordConfirmInput.value) {
        showResetConfirmError('Пароли не совпадают.');
        return;
      }

      resetConfirmSubmitBtn.disabled = true;
      resetOtpSlots.forEach(s => s.disabled = true);
      try {
        const user = await LexPrepApi.confirmPasswordReset({
          email: resetEmail,
          code,
          newPassword: resetNewPasswordInput.value
        });
        localStorage.setItem('lexprep_user', JSON.stringify(user));
        closeResetOverlay();
        if (successText) successText.textContent = 'Пароль обновлён, входим…';
        if (success) success.classList.add('is-visible');
        setTimeout(() => { window.location.href = 'index.html'; }, 900);
      } catch (err) {
        resetOtpSlots.forEach(s => s.classList.add('is-error'));
        showResetConfirmError(err.message);
        resetOtpSlots.forEach(s => s.disabled = false);
        resetConfirmSubmitBtn.disabled = false;
      }
    });
  }

  if (resetResendBtn) {
    resetResendBtn.addEventListener('click', async () => {
      if (!resetEmail) return;
      resetResendBtn.disabled = true;
      try {
        await LexPrepApi.requestPasswordReset({ email: resetEmail });
        showResetConfirmError('Код отправлен ещё раз — проверь почту.');
      } catch (err) {
        showResetConfirmError(err.message);
      } finally {
        resetResendBtn.disabled = false;
      }
    });
  }

  const hash = window.location.hash.replace('#', '');
  if (hash === 'register' || hash === 'login') {
    switchTo(hash);
  }
});