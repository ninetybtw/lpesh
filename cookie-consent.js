// LexPrep — баннер согласия на использование cookies/localStorage.
// Показывается один раз на устройстве, пока пользователь явно не выберет
// "Согласен" или "Не согласен"; выбор запоминается в localStorage.
// Технические cookies/localStorage (сессия входа, тема, локальный прогресс)
// нужны для работы самого сервиса и используются в любом случае — баннер
// честно об этом говорит и не обещает выключить их при отказе.
(function () {
  const CONSENT_KEY = 'lexprep_cookie_consent';

  function injectStyles() {
    if (document.getElementById('cookieConsentStyles')) return;
    const style = document.createElement('style');
    style.id = 'cookieConsentStyles';
    style.textContent = `
      .cookie-consent {
        position: fixed;
        left: 16px;
        right: 16px;
        bottom: 16px;
        z-index: 9999;
        max-width: 720px;
        margin: 0 auto;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 14px;
        padding: 16px 20px;
        border-radius: 14px;
        background: var(--color-bg-alt, #f6f7fb);
        color: var(--color-text, #14161f);
        border: 1px solid var(--color-border, #e6e8f0);
        box-shadow: var(--shadow-lg, 0 20px 48px rgba(20, 22, 31, 0.12));
        font-size: 14px;
        line-height: 1.5;
      }
      .cookie-consent__text {
        flex: 1 1 320px;
      }
      .cookie-consent__text a {
        color: inherit;
        text-decoration: underline;
      }
      .cookie-consent__actions {
        display: flex;
        gap: 10px;
        flex: 0 0 auto;
      }
      .cookie-consent__btn {
        padding: 9px 18px;
        border-radius: 999px;
        border: 1px solid transparent;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }
      .cookie-consent__btn--accept {
        background: var(--color-primary, #3d5afe);
        color: #fff;
      }
      .cookie-consent__btn--decline {
        background: transparent;
        border-color: var(--color-border, #e6e8f0);
        color: inherit;
      }
      @media (max-width: 520px) {
        .cookie-consent {
          flex-direction: column;
          align-items: stretch;
        }
        .cookie-consent__actions {
          justify-content: flex-end;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function showBanner() {
    injectStyles();
    const el = document.createElement('div');
    el.className = 'cookie-consent';
    el.id = 'cookieConsentBanner';
    el.innerHTML = `
      <div class="cookie-consent__text">
        Мы используем cookies и localStorage для входа в аккаунт, сохранения темы оформления и локального прогресса.
        Технические файлы необходимы для работы Сервиса и используются в любом случае — подробнее в
        <a href="legal.html#privacy">Политике конфиденциальности</a>.
      </div>
      <div class="cookie-consent__actions">
        <button type="button" class="cookie-consent__btn cookie-consent__btn--decline" id="cookieConsentDecline">Не согласен</button>
        <button type="button" class="cookie-consent__btn cookie-consent__btn--accept" id="cookieConsentAccept">Согласен</button>
      </div>
    `;
    document.body.appendChild(el);

    function close(value) {
      localStorage.setItem(CONSENT_KEY, value);
      el.remove();
    }

    document.getElementById('cookieConsentAccept').addEventListener('click', () => close('accepted'));
    document.getElementById('cookieConsentDecline').addEventListener('click', () => close('declined'));
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!localStorage.getItem(CONSENT_KEY)) showBanner();
  });
})();
