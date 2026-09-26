/* ---------------- Поддержка (support.html) ----------------
   Обращения пользователя и ответы на них (public.support_tickets через
   LexPrepApi). Быстрые темы подставляют тему в форму, список можно
   фильтровать по статусу. */

const TICKET_STATUS_LABEL = {
  open: 'Открыт',
  answered: 'Есть ответ',
  closed: 'Закрыт'
};

function formatTicketDate(iso) {
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// Шкала обращения: отправлено → ответ → закрыто.
function ticketStepsHtml(t) {
  const answered = !!t.adminReply || t.status === 'answered' || t.status === 'closed';
  const closed = t.status === 'closed';
  const step = (on, label) => `<span class="help-step ${on ? 'is-done' : ''}"><i></i>${label}</span>`;
  return `<div class="help-steps-line">${step(true, 'Отправлено')}${step(answered, 'Ответ')}${step(closed, 'Закрыто')}</div>`;
}

function ticketHtml(t) {
  const long = (t.message || '').length > 280;
  return `
    <article class="help-item help-item--${escapeHtml(t.status)}">
      <div class="help-item__head">
        <h3>${escapeHtml(t.subject)}</h3>
        <span class="help-badge help-badge--${escapeHtml(t.status)}">${TICKET_STATUS_LABEL[t.status] || escapeHtml(t.status)}</span>
      </div>
      <div class="help-item__meta">${formatTicketDate(t.createdAt)}</div>
      <p class="help-item__message ${long ? 'is-clamped' : ''}">${escapeHtml(t.message)}</p>
      ${long ? '<button type="button" class="help-more" data-more>Показать полностью</button>' : ''}
      ${ticketStepsHtml(t)}
      ${t.adminReply ? `
        <div class="help-reply">
          <span class="help-reply__avatar" aria-hidden="true"><img src="assets/favicon/apple-touch-icon.png" alt="" /></span>
          <div class="help-reply__bubble">
            <span class="help-reply__label">Ответ поддержки${t.updatedAt ? ` · ${formatTicketDate(t.updatedAt)}` : ''}</span>
            <p>${escapeHtml(t.adminReply)}</p>
          </div>
        </div>` : ''}
    </article>
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('ticketForm');
  const list = document.getElementById('ticketList');
  const status = document.getElementById('ticketFormStatus');
  const submitBtn = document.getElementById('ticketSubmit');
  const subjectInput = document.getElementById('ticketSubject');
  const messageInput = document.getElementById('ticketMessage');
  const filterEl = document.getElementById('ticketFilter');
  if (!form || !list) return;

  let tickets = [];
  let filter = 'all';

  function renderTickets() {
    const counts = { all: tickets.length, open: 0, answered: 0, closed: 0 };
    tickets.forEach(t => { if (counts[t.status] !== undefined) counts[t.status]++; });
    if (filterEl) {
      filterEl.querySelectorAll('[data-count]').forEach(el => {
        const n = counts[el.dataset.count];
        el.textContent = n ? n : '';
      });
    }

    if (!tickets.length) {
      list.innerHTML = `
        <div class="help-empty help-empty--big">
          <img class="lp-icon" src="assets/icons/check.svg" alt="" />
          <b>Обращений пока нет</b>
          <span>Если что-то не так — напиши выше, ответим здесь же.</span>
        </div>`;
      return;
    }
    const shown = filter === 'all' ? tickets : tickets.filter(t => t.status === filter);
    list.innerHTML = shown.length
      ? shown.map(ticketHtml).join('')
      : '<p class="help-empty">В этом разделе пока пусто.</p>';
    if (window.LexPrepMotion) LexPrepMotion.stagger(list, '.help-item', 60);
  }

  async function loadTickets() {
    if (typeof LexPrepApi === 'undefined') return;
    try {
      tickets = await LexPrepApi.listMySupportTickets();
      renderTickets();
    } catch (err) {
      if (err.status !== 401) {
        list.innerHTML = '<p class="help-empty">Не удалось загрузить обращения — попробуй обновить страницу.</p>';
      }
    }
  }

  // «Показать полностью» у длинных сообщений.
  list.addEventListener('click', (e) => {
    const more = e.target.closest('[data-more]');
    if (!more) return;
    const message = more.previousElementSibling;
    const open = message.classList.toggle('is-clamped');
    more.textContent = open ? 'Показать полностью' : 'Свернуть';
  });

  if (filterEl) {
    filterEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-filter]');
      if (!btn) return;
      filter = btn.dataset.filter;
      filterEl.querySelectorAll('[data-filter]').forEach(b => {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-selected', String(b === btn));
      });
      renderTickets();
    });
  }

  // Быстрые темы: подставляют тему и ставят курсор в сообщение.
  document.querySelectorAll('#ticketTopics [data-topic]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#ticketTopics [data-topic]').forEach(b => b.classList.toggle('is-active', b === btn));
      subjectInput.value = btn.dataset.topic;
      subjectInput.dispatchEvent(new Event('input'));
      messageInput.focus();
    });
  });

  // Счётчики символов.
  [[subjectInput, 'ticketSubjectCount'], [messageInput, 'ticketMessageCount']].forEach(([input, id]) => {
    const counter = document.getElementById(id);
    if (!input || !counter) return;
    const update = () => { counter.textContent = input.value.length; };
    input.addEventListener('input', update);
    update();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const subject = subjectInput.value.trim();
    const message = messageInput.value.trim();
    if (!subject || !message) return;

    submitBtn.disabled = true;
    status.dataset.error = 'false';
    status.textContent = 'Отправляем…';
    try {
      await LexPrepApi.createSupportTicket({ subject, message });
      form.reset();
      document.querySelectorAll('#ticketTopics [data-topic]').forEach(b => b.classList.remove('is-active'));
      subjectInput.dispatchEvent(new Event('input'));
      messageInput.dispatchEvent(new Event('input'));
      status.dataset.error = 'false';
      status.textContent = 'Обращение отправлено — ответ появится ниже.';
      form.classList.remove('is-sent');
      void form.offsetWidth;
      form.classList.add('is-sent');
      setTimeout(() => { status.textContent = ''; }, 3500);
      await loadTickets();
    } catch (err) {
      status.dataset.error = 'true';
      status.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });

  loadTickets();
});
