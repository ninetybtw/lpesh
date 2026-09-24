/* ==========================================================================
DIALOG.JS — стилизованные под дизайн сайта alert/confirm вместо уродливых
браузерных окошек ("Подтвердите действие на lexprep.ru" и т.п.).

window.alert переопределён глобально и без изменений в местах вызова —
у alert() нигде в коде не используется возвращаемое значение, поэтому
безопасно сделать его невизуально-неблокирующим (нативный alert блокирует
выполнение скрипта, наш — нет; на практике после alert() в коде обычно и
так не идёт ничего, что зависело бы от того, успел ли человек его увидеть).

window.confirm НЕ переопределён — его результат используется в ветвлении
(if (confirm(...))), а показать блокирующее модальное окно синхронно
в браузере невозможно. Место вызова нужно переписывать на
`await LexPrepDialog.confirm(...)` вручную (см. LexPrepDialog.confirm ниже) —
это сделано во всех местах сайта, где раньше был confirm().
========================================================================== */

(function () {
  let root = null;

  function ensureRoot() {
    if (root) return root;
    root = document.createElement('div');
    root.className = 'lexprep-dialog-overlay';
    root.innerHTML = `
      <div class="lexprep-dialog" role="alertdialog" aria-modal="true">
        <div class="lexprep-dialog__title" hidden></div>
        <div class="lexprep-dialog__body"></div>
        <div class="lexprep-dialog__actions">
          <button type="button" class="btn btn--outline lexprep-dialog__cancel">Отмена</button>
          <button type="button" class="btn btn--primary lexprep-dialog__ok">ОК</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    return root;
  }

  function show({ title, message, okText, cancelText, showCancel }) {
    return new Promise((resolve) => {
      const el = ensureRoot();
      const titleEl = el.querySelector('.lexprep-dialog__title');
      const bodyEl = el.querySelector('.lexprep-dialog__body');
      const okBtn = el.querySelector('.lexprep-dialog__ok');
      const cancelBtn = el.querySelector('.lexprep-dialog__cancel');

      titleEl.hidden = !title;
      titleEl.textContent = title || '';
      bodyEl.textContent = message == null ? '' : String(message);
      okBtn.textContent = okText || 'ОК';
      cancelBtn.hidden = !showCancel;
      cancelBtn.textContent = cancelText || 'Отмена';

      el.classList.add('is-open');
      document.body.classList.add('lexprep-dialog-open');

      function cleanup(result) {
        el.classList.remove('is-open');
        document.body.classList.remove('lexprep-dialog-open');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        el.removeEventListener('mousedown', onOverlayClick);
        document.removeEventListener('keydown', onKeydown);
        resolve(result);
      }
      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onOverlayClick(e) { if (e.target === el) cleanup(false); }
      function onKeydown(e) {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
        if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
      }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      el.addEventListener('mousedown', onOverlayClick);
      document.addEventListener('keydown', onKeydown);
      setTimeout(() => okBtn.focus(), 0);
    });
  }

  window.LexPrepDialog = {
    alert(message, title) {
      return show({ title, message, okText: 'ОК', showCancel: false });
    },
    confirm(message, title) {
      return show({ title, message, okText: 'Да', cancelText: 'Отмена', showCancel: true });
    }
  };

  window.alert = function (message) {
    show({ message, okText: 'ОК', showCancel: false });
  };
})();
