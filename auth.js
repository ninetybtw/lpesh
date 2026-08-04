/* ==========================================================================
AUTH.JS — переключение вкладок Вход/Регистрация на странице auth.html
Подключается отдельным тегом <script src="auth.js"></script>,
ничего менять в script.js не нужно.
========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.auth-tab');
  const panels = document.querySelectorAll('.auth-panel');
  const success = document.getElementById('authSuccess');

  if (!tabs.length || !panels.length) return;

  function switchTo(name) {
    tabs.forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
    panels.forEach(p => p.classList.toggle('is-active', p.dataset.panel === name));
    if (success) success.classList.remove('is-visible');
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTo(tab.dataset.tab));
  });

  document.querySelectorAll('[data-switch]').forEach(btn => {
    btn.addEventListener('click', () => switchTo(btn.dataset.switch));
  });

  panels.forEach(panel => {
    panel.addEventListener('submit', (e) => {
      e.preventDefault();
      const isRegister = panel.dataset.panel === 'register';
      const name = isRegister
        ? document.getElementById('regName').value
        : document.getElementById('loginEmail').value.split('@')[0];
      localStorage.setItem('lexprep_user', JSON.stringify({ name }));
      if (success) success.classList.add('is-visible');
      setTimeout(() => { window.location.href = 'index.html'; }, 900);
    });
  });
  
  const hash = window.location.hash.replace('#', '');
  if (hash === 'register' || hash === 'login') {
    switchTo(hash);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const authTabs = document.querySelectorAll('[data-auth-tab]');
  const authPanels = document.querySelectorAll('[data-auth-panel]');
  const forms = document.querySelectorAll('form');

  authTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.authTab;

      authTabs.forEach(t => t.classList.remove('is-active'));
      authPanels.forEach(p => p.classList.remove('is-active'));

      tab.classList.add('is-active');
      document.querySelector(`[data-auth-panel="${target}"]`)?.classList.add('is-active');
    });
  });

  forms.forEach(form => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const nameInput =
        form.querySelector('input[name="name"]') ||
        form.querySelector('input[name="username"]');

      const emailInput = form.querySelector('input[type="email"]');
      const userName =
        nameInput?.value?.trim() ||
        emailInput?.value?.trim()?.split('@')[0] ||
        'Student';

      localStorage.setItem('authUser', JSON.stringify({
        name: userName,
        email: emailInput?.value?.trim() || ''
      }));

      localStorage.setItem('token', 'demo-token');
      window.location.href = 'index.html';
    });
  });
});