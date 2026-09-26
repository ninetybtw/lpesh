/* ==========================================================================
ADMIN-UI.JS — общее оформление админки и панели модератора: плитки
показателей, подписи колонок для таблиц-карточек на телефоне, переход к
разделу по клику на плитку. Логика данных — в admin.js / moderator.js.
========================================================================== */

const AdminUI = (function () {
  const parts = {};

  function reduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Плитка показателя: крупное число, подпись и мелкая строка под ней.
  function setKpi(key, value, sub) {
    const el = document.querySelector(`[data-kpi="${key}"]`);
    if (!el) return;
    const valueEl = el.querySelector('[data-kpi-value]');
    const target = Number(value);
    if (Number.isFinite(target) && window.LexPrepMotion && !reduced()) {
      // countTo сам отменяет предыдущую анимацию и считает от текущего числа.
      if (valueEl.textContent === '—') valueEl.textContent = '0';
      LexPrepMotion.countTo(valueEl, target, 700);
    } else {
      cancelAnimationFrame(valueEl._countFrame);
      valueEl.textContent = value;
    }
    if (sub !== undefined) el.querySelector('[data-kpi-sub]').textContent = sub;
    el.classList.remove('is-loading');
    el.classList.toggle('is-hot', Number.isFinite(target) && target > 0 && el.dataset.kpiHot !== undefined);
  }

  // Плитка, которая складывается из нескольких источников (например,
  // тесты + статьи на модерации). format(parts) возвращает подпись.
  function setKpiPart(key, part, value, format) {
    parts[key] = parts[key] || {};
    parts[key][part] = value;
    const sum = Object.values(parts[key]).reduce((a, b) => a + b, 0);
    setKpi(key, sum, format ? format(parts[key]) : undefined);
  }

  // На телефоне строки таблиц показываются карточками — каждой ячейке
  // нужна подпись колонки. Проставляем её автоматически при любой
  // перерисовке tbody.
  function labelTables() {
    document.querySelectorAll('.admin-table').forEach(table => {
      const heads = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
      const tbody = table.querySelector('tbody');
      if (!tbody) return;
      const apply = () => {
        tbody.querySelectorAll('tr').forEach(tr => {
          Array.from(tr.children).forEach((td, i) => {
            if (heads[i] && !td.hasAttribute('colspan')) td.dataset.label = heads[i];
          });
        });
      };
      apply();
      new MutationObserver(apply).observe(tbody, { childList: true });
    });
  }

  function initTabsUi() {
    const tabs = document.querySelector('.admin-tabs');
    if (!tabs) return;
    // Плитка показателя ведёт в свой раздел.
    document.addEventListener('click', (e) => {
      const kpi = e.target.closest('[data-kpi-tab]');
      if (!kpi) return;
      const key = kpi.dataset.kpiTab;
      const tab = document.querySelector(`[data-admin-tab="${key}"], [data-mod-tab="${key}"]`);
      if (tab) {
        tab.click();
        const layout = document.querySelector('.admin-layout');
        if (layout) layout.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      }
    });
    // Активный пункт в горизонтальной ленте (телефон) — всегда на виду;
    // открытая панель плавно появляется.
    tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.admin-tab');
      if (!tab) return;
      if (tabs.scrollWidth > tabs.clientWidth) {
        tabs.scrollTo({ left: tab.offsetLeft - tabs.clientWidth / 2 + tab.offsetWidth / 2, behavior: reduced() ? 'auto' : 'smooth' });
      }
      requestAnimationFrame(() => {
        const panel = document.querySelector('.admin-tab-panel:not([hidden])');
        if (!panel || reduced()) return;
        panel.classList.remove('is-entering');
        void panel.offsetWidth;
        panel.classList.add('is-entering');
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    labelTables();
    initTabsUi();
  });

  return { setKpi, setKpiPart };
})();
