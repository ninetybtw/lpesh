/* ---------------- Поддержка (support.html) ---------------- */

const TICKET_STATUS_LABEL = {
  open: 'Открыт',
  answered: 'Отвечено',
  closed: 'Закрыт'
};

function formatTicketDate(iso) {
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

function renderTickets(list, tickets) {
  if (!tickets.length) {
    list.innerHTML = '<p class="community-empty">Обращений пока нет — если что-то не так, напиши выше.</p>';
    return;
  }
  list.innerHTML = tickets.map(t => `
    <div class="community-item">
      <div class="community-item__head">
        <h3>${escapeHtml(t.subject)}</h3>
        <span class="community-badge community-badge--${t.status}">${TICKET_STATUS_LABEL[t.status] || t.status}</span>
      </div>
      <p class="community-item__message">${escapeHtml(t.message)}</p>
      <div class="community-item__meta"><span>${formatTicketDate(t.createdAt)}</span></div>
      ${t.adminReply ? `
        <div class="community-item__reply">
          <div class="community-item__reply-label">Ответ поддержки</div>
          <p>${escapeHtml(t.adminReply)}</p>
        </div>` : ''}
    </div>
  `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('ticketForm');
  const list = document.getElementById('ticketList');
  const status = document.getElementById('ticketFormStatus');
  const submitBtn = document.getElementById('ticketSubmit');
  if (!form || !list) return;

  async function loadTickets() {
    if (typeof LexPrepApi === 'undefined') return;
    try {
      const tickets = await LexPrepApi.listMySupportTickets();
      renderTickets(list, tickets);
    } catch (err) {
      if (err.status !== 401) {
        list.innerHTML = '<p class="community-empty">Не удалось загрузить обращения — попробуй обновить страницу.</p>';
      }
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const subject = document.getElementById('ticketSubject').value.trim();
    const message = document.getElementById('ticketMessage').value.trim();
    if (!subject || !message) return;

    submitBtn.disabled = true;
    status.dataset.error = 'false';
    status.textContent = 'Отправляем…';
    try {
      await LexPrepApi.createSupportTicket({ subject, message });
      form.reset();
      status.textContent = 'Обращение отправлено.';
      setTimeout(() => { status.textContent = ''; }, 2500);
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
