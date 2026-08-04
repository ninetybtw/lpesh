document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initApp() {
  const DATA = [
    {
      id: "civil",
      title: "Гражданское право",
      topics: [
        {
          id: "invalid-deals",
          title: "Недействительность сделок",
          description: "Конспект по теме ничтожных и оспоримых сделок, их последствиям и логике применения норм ГК РФ.",
          theory: `
            <div class="note-box">
              <h3>Что важно запомнить</h3>
              <p>Сделка может быть недействительной либо в силу признания её таковой судом, либо независимо от такого признания. Это базовое различие между оспоримой и ничтожной сделкой.</p>
            </div>

            <div class="theory">
              <h3>1. Общая классификация</h3>
              <p>По статье 166 ГК РФ недействительные сделки делятся на <strong>оспоримые</strong> и <strong>ничтожные</strong>. Оспоримая сделка становится недействительной после решения суда, а ничтожная считается недействительной независимо от судебного признания.</p>

              <h3>2. Кто может заявлять требования</h3>
              <p>Требование о признании оспоримой сделки недействительной обычно предъявляет сторона сделки или иное лицо, указанное в законе. Требование о применении последствий недействительности ничтожной сделки вправе предъявить сторона сделки, а в предусмотренных законом случаях — и иное лицо.</p>

              <h3>3. Последствия недействительности</h3>
              <p>По статье 167 ГК РФ недействительная сделка не влечёт тех правовых последствий, на которые была направлена. Общее последствие — возврат сторонами всего полученного по сделке, то есть реституция.</p>

              <h3>4. Что спрашивают на экзамене</h3>
              <ul>
                <li>Чем отличается оспоримая сделка от ничтожной.</li>
                <li>Когда нужно решение суда, а когда нет.</li>
                <li>Какие последствия применяются после признания сделки недействительной.</li>
              </ul>
            </div>
          `,
          test: [
            {
              question: "Какая сделка считается недействительной независимо от признания её судом?",
              options: ["Оспоримая", "Ничтожная", "Возмездная", "Кабальная"],
              correct: 1,
              explanation: "Ничтожная сделка недействительна сама по себе, а оспоримая — только после признания её таковой судом."
            },
            {
              question: "Что является общим последствием недействительности сделки?",
              options: ["Только штраф", "Автоматическое прекращение обязательства без последствий", "Реституция", "Обязательно уголовная ответственность"],
              correct: 2,
              explanation: "Общее последствие по статье 167 ГК РФ — возврат сторонами всего полученного по сделке, то есть реституция."
            },
            {
              question: "Кто обычно вправе требовать признания оспоримой сделки недействительной?",
              options: ["Любое лицо", "Только прокурор", "Сторона сделки или иное указанное в законе лицо", "Только суд по собственной инициативе"],
              correct: 2,
              explanation: "Статья 166 ГК РФ прямо связывает такое требование со стороной сделки или иным лицом, названным в законе."
            }
          ]
        }
      ]
    },
    {
      id: "constitutional",
      title: "Конституционное право",
      topics: [
        {
          id: "federation",
          title: "Федеративное устройство РФ",
          description: "Базовый учебный конспект по принципам федерализма, разграничению предметов ведения и статусу субъектов РФ.",
          theory: `
            <div class="note-box">
              <h3>Что важно запомнить</h3>
              <p>Федеративное устройство России строится на единстве государственной власти, разграничении предметов ведения и равноправии субъектов РФ.</p>
            </div>

            <div class="theory">
              <h3>1. Сущность федерализма</h3>
              <p>Россия — федеративное государство, состоящее из субъектов РФ. Федерализм позволяет сочетать общегосударственное единство и региональное разнообразие.</p>

              <h3>2. Разграничение компетенции</h3>
              <p>Часть вопросов находится в ведении Российской Федерации, часть — в совместном ведении Федерации и субъектов, а всё остальное относится к компетенции субъектов РФ.</p>

              <h3>3. Практический смысл</h3>
              <p>На экзамене обычно проверяют понимание различий между предметами ведения, а также статус республики, края, области, города федерального значения, автономной области и автономного округа.</p>
            </div>
          `,
          test: [
            {
              question: "Что отражает принцип федерализма?",
              options: ["Полный отказ от регионов", "Сочетание единства государства и самостоятельности субъектов", "Только местное самоуправление", "Подчинение субъектов муниципалитетам"],
              correct: 1,
              explanation: "Федерализм строится на сочетании единства государства и самостоятельности субъектов в пределах их компетенции."
            },
            {
              question: "Какие вопросы могут находиться в совместном ведении?",
              options: ["Только личные права граждан", "Вопросы, прямо распределённые между Федерацией и субъектами", "Только муниципальные вопросы", "Исключительно вопросы международных договоров субъектов"],
              correct: 1,
              explanation: "Совместное ведение — это сфера, где компетенция распределяется между Федерацией и субъектами по Конституции."
            }
          ]
        }
      ]
    },
    {
      id: "criminal-procedure",
      title: "Уголовный процесс",
      topics: [
        {
          id: "preventive-measures",
          title: "Меры пресечения",
          description: "Конспект по основаниям избрания мер пресечения, их видам и процессуальной логике главы 13 УПК РФ.",
          theory: `
            <div class="note-box">
              <h3>Что важно запомнить</h3>
              <p>Меры пресечения применяются не автоматически, а при наличии процессуальных оснований: риск скрыться, продолжить преступную деятельность, угрожать участникам процесса или иным образом воспрепятствовать производству по делу.</p>
            </div>

            <div class="theory">
              <h3>1. Основания применения</h3>
              <p>Статья 97 УПК РФ связывает избрание меры пресечения с наличием достаточных оснований полагать, что подозреваемый или обвиняемый может скрыться от дознания, следствия или суда, продолжить преступную деятельность, угрожать свидетелям или иным способом помешать производству по делу.</p>

              <h3>2. Виды мер пресечения</h3>
              <p>Глава 13 УПК РФ включает подписку о невыезде, личное поручительство, наблюдение командования воинской части, присмотр за несовершеннолетним, запрет определённых действий, залог, домашний арест и заключение под стражу.</p>

              <h3>3. Как отвечать на экзамене</h3>
              <ul>
                <li>Сначала назови цель меры пресечения.</li>
                <li>Потом — основания по статье 97 УПК РФ.</li>
                <li>Далее — перечисли виды мер и покажи, что заключение под стражу не единственный вариант.</li>
              </ul>
            </div>
          `,
          test: [
            {
              question: "Что является основанием для избрания меры пресечения?",
              options: [
                "Любое подозрение без процессуального обоснования",
                "Наличие риска скрыться, продолжить преступную деятельность или воспрепятствовать делу",
                "Только тяжесть преступления",
                "Только признание вины"
              ],
              correct: 1,
              explanation: "Статья 97 УПК РФ требует достаточных оснований полагать, что лицо может скрыться, продолжить преступную деятельность или помешать делу."
            },
            {
              question: "Какая из мер относится к мерам пресечения?",
              options: ["Привод", "Денежное взыскание", "Домашний арест", "Освидетельствование"],
              correct: 2,
              explanation: "Домашний арест прямо назван среди мер пресечения в главе 13 УПК РФ."
            },
            {
              question: "Верно ли, что заключение под стражу — единственная возможная мера пресечения?",
              options: ["Да", "Нет"],
              correct: 1,
              explanation: "Нет, закон предусматривает несколько мер пресечения, а заключение под стражу — только одна из них."
            }
          ]
        }
      ]
    }
  ];

  const disciplineList = document.getElementById('disciplineList');
  const topicList = document.getElementById('topicList');
  const contentView = document.getElementById('contentView');

  if (!disciplineList || !topicList || !contentView) return;

  let activeDiscipline = DATA[0];
  let activeTopic = DATA[0].topics[0];

  function renderDisciplines() {
    disciplineList.innerHTML = DATA.map(d => `
      <button class="item-btn ${d.id === activeDiscipline.id ? 'is-active' : ''}" data-discipline="${d.id}">
        ${escapeHtml(d.title)}
      </button>
    `).join('');

    disciplineList.querySelectorAll('[data-discipline]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeDiscipline = DATA.find(d => d.id === btn.dataset.discipline);
        activeTopic = activeDiscipline.topics[0];
        renderDisciplines();
        renderTopics();
        renderContent();
        enableFocusMode();
      });
    });
  }

  function renderTopics() {
    topicList.innerHTML = activeDiscipline.topics.map(t => `
      <button class="item-btn ${t.id === activeTopic.id ? 'is-active' : ''}" data-topic="${t.id}">
        ${escapeHtml(t.title)}
      </button>
    `).join('');

    topicList.querySelectorAll('[data-topic]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTopic = activeDiscipline.topics.find(t => t.id === btn.dataset.topic);
        renderTopics();
        renderContent();
        enableFocusMode();
      });
    });
  }

  function renderContent() {
    contentView.innerHTML = `
      <div class="breadcrumbs">
        <span>LexPrep</span>
        <span>→</span>
        <span>${escapeHtml(activeDiscipline.title)}</span>
        <span>→</span>
        <span>${escapeHtml(activeTopic.title)}</span>
      </div>

      <h1 class="topic-title">${escapeHtml(activeTopic.title)}</h1>
      <p class="topic-desc">${escapeHtml(activeTopic.description)}</p>

      <div class="topic-tabs">
        <span class="topic-tab is-active">Конспект</span>
        <span class="topic-tab">Карточки</span>
        <span class="topic-tab">Тест</span>
        <span class="topic-tab">Практика ВС РФ</span>
      </div>

      ${activeTopic.theory}

      <div class="test-launch">
        <button class="btn btn--primary" id="openTestBtn">Решить тест</button>
      </div>

      <div class="test-box" id="testBox">
        <h2 class="test-box__title">Тест по теме</h2>
        <div id="questionsWrap">
          ${activeTopic.test.map((q, qIndex) => `
            <div class="question" data-question="${qIndex}">
              <h4>${qIndex + 1}. ${escapeHtml(q.question)}</h4>
              <div class="answers">
                ${q.options.map((option, i) => `
                  <label class="answer">
                    <input type="radio" name="q-${qIndex}" value="${i}">
                    <span>${escapeHtml(option)}</span>
                  </label>
                `).join('')}
              </div>
              <div class="question-result" id="result-${qIndex}"></div>
            </div>
          `).join('')}
        </div>

        <div class="test-actions">
          <button class="btn btn--primary" id="checkTestBtn">Проверить ответы</button>
        </div>

        <div class="summary" id="summaryBox"></div>
      </div>
    `;

    const openBtn = document.getElementById('openTestBtn');
    const checkBtn = document.getElementById('checkTestBtn');

    if (openBtn) {
      openBtn.addEventListener('click', () => {
        document.getElementById('testBox').classList.add('is-open');
        document.getElementById('testBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    if (checkBtn) {
      checkBtn.addEventListener('click', () => {
        let score = 0;

        activeTopic.test.forEach((q, qIndex) => {
          const chosen = document.querySelector(`input[name="q-${qIndex}"]:checked`);
          const resultBox = document.getElementById(`result-${qIndex}`);

          if (!chosen) {
            resultBox.className = 'question-result is-wrong';
            resultBox.innerHTML = `Ответ не выбран.<br>Правильный ответ: <strong>${escapeHtml(q.options[q.correct])}</strong>.<br>${escapeHtml(q.explanation)}`;
            return;
          }

          const chosenIndex = Number(chosen.value);

          if (chosenIndex === q.correct) {
            score++;
            resultBox.className = 'question-result is-correct';
            resultBox.innerHTML = `Верно.<br><strong>Почему:</strong> ${escapeHtml(q.explanation)}`;
          } else {
            resultBox.className = 'question-result is-wrong';
            resultBox.innerHTML = `
              Неверно.<br>
              <strong>Твой ответ:</strong> ${escapeHtml(q.options[chosenIndex])}<br>
              <strong>Правильный ответ:</strong> ${escapeHtml(q.options[q.correct])}<br>
              <strong>Почему не так:</strong> ${escapeHtml(q.explanation)}
            `;
          }
        });

        const summaryBox = document.getElementById('summaryBox');
        const total = activeTopic.test.length;
        const percent = Math.round((score / total) * 100);

        summaryBox.classList.add('is-visible');
        summaryBox.innerHTML = `
          <h3>Итог теста</h3>
          <p>Правильных ответов: <strong>${score}</strong> из <strong>${total}</strong>.</p>
          <p>Результат: <strong>${percent}%</strong>.</p>
          <p class="summary__note">Если результат ниже 70%, лучше ещё раз пройти теорию и затем перепройти тест.</p>
        `;

        summaryBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }

  const appLayout = document.getElementById('appLayout');

  function enableFocusMode() {
    appLayout?.classList.add('is-focus-mode');
  }

  function disableFocusMode() {
    appLayout?.classList.remove('is-focus-mode');
  }

  document.querySelectorAll('[data-toggle-panel]').forEach(button => {
    button.addEventListener('click', disableFocusMode);
  });

  renderDisciplines();
  renderTopics();
  renderContent();
}

