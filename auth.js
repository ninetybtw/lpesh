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

      if (isRegister) {
        const password = document.getElementById('regPassword').value;
        const passwordConfirm = document.getElementById('regPasswordConfirm').value;
        if (password !== passwordConfirm) {
          alert('Пароли не совпадают');
          return;
        }
      }

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