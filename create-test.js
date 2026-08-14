/* ==========================================================================
CREATE-TEST.JS — форма создания пользовательского теста (демо: сохраняется
только в localStorage этого браузера, без реальной модерации и бэкенда)
========================================================================== */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = JSON.parse(localStorage.getItem('lexprep_user') || 'null');
  if (!user) {
    window.location.href = 'auth.html';
    return;
  }
  await (window.LexPrepContentReady || Promise.resolve());

  const authorName = document.getElementById('authorName');
  const authorAvatar = document.getElementById('authorAvatar');
  authorName.textContent = user.name || 'Профиль';
  if (user.avatar) {
    authorAvatar.textContent = '';
    authorAvatar.style.backgroundImage = `url(${user.avatar})`;
  } else {
    authorAvatar.textContent = (user.name || 'U').trim().charAt(0).toUpperCase();
  }

  const DATA = typeof LEXPREP_DATA !== 'undefined' ? LEXPREP_DATA : [];
  const urlParams = new URLSearchParams(window.location.search);

  const disciplineSelect = document.getElementById('ctDiscipline');
  const topicSelect = document.getElementById('ctTopic');
  const titleInput = document.getElementById('ctTitle');
  const questionsContainer = document.getElementById('ctQuestions');
  const addQuestionBtn = document.getElementById('ctAddQuestion');
  const form = document.getElementById('ctForm');

  if (!DATA.length) return;

  function emptyQuestion() {
    return { question: '', options: ['', '', '', ''], correct: 0, explanation: '' };
  }

  let questions = [emptyQuestion(), emptyQuestion(), emptyQuestion()];

  function populateDisciplines() {
    disciplineSelect.innerHTML = DATA.map(d => `<option value="${d.id}">${escapeHtml(d.title)}</option>`).join('');
  }

  function populateTopics(disciplineId) {
    const discipline = DATA.find(d => d.id === disciplineId) || DATA[0];
    topicSelect.innerHTML = discipline.topics.map(t => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('');
  }

  populateDisciplines();
  const initialDiscipline = DATA.find(d => d.id === urlParams.get('discipline')) ? urlParams.get('discipline') : DATA[0].id;
  disciplineSelect.value = initialDiscipline;
  populateTopics(initialDiscipline);
  const initialTopic = urlParams.get('topic');
  if (initialTopic && Array.from(topicSelect.options).some(o => o.value === initialTopic)) {
    topicSelect.value = initialTopic;
  }

  disciplineSelect.addEventListener('change', () => populateTopics(disciplineSelect.value));

  function renderQuestions() {
    questionsContainer.innerHTML = questions.map((q, qIndex) => `
      <div class="qb-question">
        <div class="qb-question__head">
          <span class="qb-question__num">Вопрос ${qIndex + 1}</span>
          ${questions.length > 1 ? `<button type="button" class="qb-question__remove" data-remove="${qIndex}">Удалить</button>` : ''}
        </div>
        <div class="form-group form-group--full">
          <label>Текст вопроса</label>
          <textarea class="form-textarea" data-q="${qIndex}" data-field="question">${escapeHtml(q.question)}</textarea>
        </div>
        <div class="qb-options">
          ${q.options.map((opt, oIndex) => `
            <label class="qb-option">
              <input type="radio" name="correct-${qIndex}" value="${oIndex}" data-q="${qIndex}" data-correct ${q.correct === oIndex ? 'checked' : ''}>
              <input type="text" class="form-input" placeholder="Вариант ${oIndex + 1}" data-q="${qIndex}" data-option="${oIndex}" value="${escapeHtml(opt)}">
            </label>
          `).join('')}
        </div>
        <div class="form-group form-group--full">
          <label>Объяснение (необязательно)</label>
          <textarea class="form-textarea" data-q="${qIndex}" data-field="explanation">${escapeHtml(q.explanation)}</textarea>
        </div>
      </div>
    `).join('');

    questionsContainer.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('input', () => {
        questions[Number(el.dataset.q)][el.dataset.field] = el.value;
      });
    });
    questionsContainer.querySelectorAll('[data-option]').forEach(el => {
      el.addEventListener('input', () => {
        questions[Number(el.dataset.q)].options[Number(el.dataset.option)] = el.value;
      });
    });
    questionsContainer.querySelectorAll('[data-correct]').forEach(el => {
      el.addEventListener('change', () => {
        questions[Number(el.dataset.q)].correct = Number(el.value);
      });
    });
    questionsContainer.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        questions.splice(Number(btn.dataset.remove), 1);
        renderQuestions();
      });
    });
  }

  renderQuestions();

  addQuestionBtn.addEventListener('click', () => {
    questions.push(emptyQuestion());
    renderQuestions();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    if (titleInput.value.trim().length < 8) {
      markFieldInvalid(titleInput, 'Название теста должно быть не короче 8 символов.');
      titleInput.focus();
      return;
    }
    clearFieldInvalid(titleInput);

    if (questions.length < 3) {
      alert('Добавь минимум 3 вопроса.');
      return;
    }

    for (const q of questions) {
      if (!q.question.trim() || q.options.some(o => !o.trim())) {
        alert('Заполни текст вопроса и все варианты ответа для каждого вопроса.');
        return;
      }
    }

    const gamification = typeof LexPrepProgress !== 'undefined' && LexPrepProgress.getGamification
      ? LexPrepProgress.getGamification()
      : { level: 1 };

    const newTest = {
      id: Date.now(),
      disciplineId: disciplineSelect.value,
      topicId: topicSelect.value,
      title: titleInput.value.trim(),
      author: user.name || 'Аноним',
      authorLevel: gamification.level,
      createdAt: Date.now(),
      questions: questions.map(q => ({
        question: q.question.trim(),
        options: q.options.map(o => o.trim()),
        correct: q.correct,
        explanation: q.explanation.trim()
      }))
    };

    const tests = JSON.parse(localStorage.getItem('lexprep_user_tests') || '[]');
    tests.unshift(newTest);
    localStorage.setItem('lexprep_user_tests', JSON.stringify(tests));

    window.location.href = `app.html?discipline=${encodeURIComponent(newTest.disciplineId)}&topic=${encodeURIComponent(newTest.topicId)}&view=test&highlight=${newTest.id}`;
  });
});
