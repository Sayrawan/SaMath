import { pickMessage } from "./messages.js";
import { formatMath, renderMath } from "./math.js";
import { DIFFICULTY_LABELS, getQuestionById, getQuestions, TOPICS } from "./questions.js";
import { addCompletedSession, loadAppState, resetAppState, saveAppState } from "./storage.js";
import { buildReport, createSession, currentQuestion, gradeQuestion, hydrateSession } from "./quiz-engine.js";
import { CalmTimer } from "./timer.js";

const appState = loadAppState();
let session = hydrateSession(appState.activeSession);
let latestReport = null;
let reviewIndex = 0;

const homeScreen = document.querySelector("#home-screen");
const quizScreen = document.querySelector("#quiz-screen");
const resultsScreen = document.querySelector("#results-screen");
const dialog = document.querySelector("#app-dialog");
const dialogContent = document.querySelector("#dialog-content");
const liveRegion = document.querySelector("#live-region");
const timer = new CalmTimer((value) => {
  const timerValue = document.querySelector("#timer-value");
  if (timerValue) timerValue.textContent = value;
});

function announce(message) {
  liveRegion.textContent = "";
  window.requestAnimationFrame(() => {
    liveRegion.textContent = message;
  });
}

function showScreen(screen) {
  [homeScreen, quizScreen, resultsScreen].forEach((item) => {
    const active = item === screen;
    item.hidden = !active;
    item.classList.toggle("is-active", active);
  });
  if (screen !== quizScreen) timer.stop();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function persistSession() {
  appState.activeSession = session;
  saveAppState(appState);
}

function updateHome() {
  document.querySelector("#welcome-message").textContent = pickMessage("welcome");
  const resumeButton = document.querySelector("#resume-session");
  if (session) {
    const label = session.mode === "exam" ? "الاختبار" : "التدريب";
    resumeButton.querySelector("strong").textContent = `كمّلي ${label} من مكانك`;
    resumeButton.classList.remove("is-hidden");
  } else {
    resumeButton.classList.add("is-hidden");
  }
}

function startNewSession(mode, topic = document.querySelector("#topic-select").value) {
  session = createSession(mode, topic);
  appState.activeSession = session;
  saveAppState(appState);
  announce(pickMessage(mode === "exam" ? "startExam" : "startTraining"));
  renderQuiz();
  showScreen(quizScreen);
}

function answerControl(question, state, locked) {
  const choicesAreToggleable = question.type !== "true-false" && question.options?.length;
  if (choicesAreToggleable && !state.essayOptionsVisible) return "";

  return `
    <fieldset class="choice-list" ${locked ? "disabled" : ""}>
      <legend class="sr-only">خيارات الإجابة</legend>
      ${question.options.map((option) => `
        <label class="choice-option ${state.answer === option.value ? "is-selected" : ""}">
          <input type="radio" name="answer" value="${option.value}" ${state.answer === option.value ? "checked" : ""} />
          <span class="choice-dot" aria-hidden="true"></span>
          <span class="choice-copy">${option.math ? formatMath(option.math) : option.label}</span>
        </label>
      `).join("")}
    </fieldset>`;
}

function solutionMarkup(question) {
  return `
    <section class="solution-panel" aria-labelledby="solution-title">
      <div class="section-kicker">نفهمها سوا</div>
      <h3 id="solution-title">الحل خطوة خطوة</h3>
      <div class="solution-rule">
        <span>القاعدة</span>
        <div class="math-scroll">${formatMath(question.rule, true)}</div>
      </div>
      <ol class="solution-steps">
        ${question.solutionSteps.map((step) => `<li>${step}</li>`).join("")}
      </ol>
      <div class="final-answer">
        <span>الإجابة النهائية</span>
        <div class="math-scroll">${formatMath(question.finalAnswer, true)}</div>
      </div>
      <p class="solution-note">${question.explanation}</p>
    </section>`;
}

function feedbackMarkup(state) {
  if (!state.feedback) return "";
  const icon = state.feedbackType === "correct" ? "✓" : state.feedbackType === "incorrect" ? "×" : "•";
  return `<div class="feedback ${state.feedbackType || "neutral"}" role="status"><span class="feedback-icon" aria-hidden="true">${icon}</span><p>${state.feedback}</p></div>`;
}

function renderQuiz() {
  if (!session) return;
  const question = currentQuestion(session);
  const state = session.questionState[question.id];
  const isExam = session.mode === "exam";
  const locked = !isExam && ["correct", "revealed"].includes(state.status);
  const progressVisible = appState.preferences.progressVisible;
  const timerVisible = appState.preferences.timerVisible;
  const focusMode = appState.preferences.focusMode;
  const hasOptionToggle = question.type !== "true-false" && question.options?.length;
  const optionsVisible = !hasOptionToggle || state.essayOptionsVisible;
  const hint = state.hintsShown > 0 ? question.hints[state.hintsShown - 1] : null;

  document.body.classList.toggle("focus-mode", focusMode);
  quizScreen.innerHTML = `
    <header class="quiz-topbar secondary-ui">
      <button class="quiet-button" id="back-home" type="button"><span aria-hidden="true">→</span><span>الرئيسية</span></button>
      <div class="session-label">${isExam ? "اختبار هادئ" : "تدريب"} · ${session.topicLabel}</div>
      <button class="icon-button" id="question-nav" type="button" aria-label="خريطة الأسئلة">☷</button>
    </header>

    <div class="session-strip secondary-ui">
      <div class="progress-info ${progressVisible ? "" : "is-concealed"}">
        <span>سؤال ${session.currentIndex + 1} من ${session.questionIds.length}</span>
        <div class="progress-track" aria-hidden="true"><span style="width:${((session.currentIndex + 1) / session.questionIds.length) * 100}%"></span></div>
      </div>
      <div class="strip-actions">
        ${isExam ? `<button class="mini-control" id="toggle-timer" type="button">${timerVisible ? "إخفاء الوقت" : "إظهار الوقت"}</button>` : ""}
        <button class="mini-control" id="toggle-progress" type="button">${progressVisible ? "إخفاء التقدّم" : "إظهار التقدّم"}</button>
      </div>
      ${isExam ? `<div class="timer ${timerVisible ? "" : "is-concealed"}" aria-label="الوقت المتبقي"><span id="timer-value">00:00</span><small>الوقت للمعلومة فقط</small></div>` : ""}
    </div>

    <button class="focus-toggle secondary-ui" id="enter-focus" type="button"><span aria-hidden="true">◉</span> وضع التركيز</button>
    <button class="exit-focus" id="exit-focus" type="button">إنهاء التركيز</button>

    <article class="question-card">
      <div class="question-meta secondary-ui">
        <span>${question.subtopic}</span>
        <span>${DIFFICULTY_LABELS[question.difficulty] || question.difficulty}</span>
      </div>
      <div class="question-heading ${state.status === "incorrect" ? "has-incorrect-answer" : ""}">
        ${state.status === "incorrect" ? `<span class="question-status-x" role="img" aria-label="الإجابة غير صحيحة">×</span>` : ""}
        <h1 id="question-title">${question.prompt}</h1>
      </div>
      <div class="question-formula math-scroll">${formatMath(question.formula, true)}</div>

      <form id="answer-form" class="answer-area" novalidate>
        ${hasOptionToggle ? `<button class="reveal-options-button secondary-ui" id="toggle-options" type="button"><span aria-hidden="true">${optionsVisible ? "−" : "+"}</span>${optionsVisible ? "إخفاء الخيارات" : "إظهار خيارات الإجابة"}</button>` : ""}
        ${answerControl(question, state, locked)}
        ${feedbackMarkup(state)}

        ${hint ? `<div class="hint-panel"><span aria-hidden="true">💡</span><p>${hint}</p></div>` : ""}
        ${state.solutionRevealed ? solutionMarkup(question) : ""}

        <div class="answer-actions">
          ${!locked && optionsVisible ? `<button class="primary-button" type="submit">${isExam ? "حفظ الإجابة" : "تحققي من الإجابة"}</button>` : ""}
          ${!state.solutionRevealed && state.hintsShown < question.hints.length ? `<button class="secondary-button" id="show-hint" type="button">💡 تلميح${state.hintsShown ? " آخر" : ""}</button>` : ""}
          ${!isExam && state.status === "incorrect" ? `<button class="ghost-button" id="give-up" type="button">استسلام وعرض الحل</button>` : ""}
        </div>
      </form>
    </article>

    <nav class="question-footer secondary-ui" aria-label="التنقل بين الأسئلة">
      <button class="nav-button" id="prev-question" type="button" ${session.currentIndex === 0 ? "disabled" : ""}><span aria-hidden="true">→</span> السابق</button>
      <button class="finish-link" id="finish-session" type="button">إنهاء ${isExam ? "الاختبار" : "التدريب"}</button>
      <button class="nav-button" id="next-question" type="button" ${session.currentIndex === session.questionIds.length - 1 ? "disabled" : ""}>التالي <span aria-hidden="true">←</span></button>
    </nav>`;

  const input = quizScreen.querySelector("#answer-input");
  if (input && input.tagName === "INPUT") input.value = state.answer || "";

  bindQuizEvents(question, state);
  renderMath(quizScreen);
  if (isExam) timer.start(session.deadline);
}

function saveVisibleAnswer(state) {
  const selected = quizScreen.querySelector('input[name="answer"]:checked');
  const input = quizScreen.querySelector("#answer-input");
  if (selected) state.answer = selected.value;
  else if (input) state.answer = input.value;
  persistSession();
}

function bindQuizEvents(question, state) {
  quizScreen.querySelector("#back-home")?.addEventListener("click", () => {
    saveVisibleAnswer(state);
    document.body.classList.remove("focus-mode");
    appState.preferences.focusMode = false;
    saveAppState(appState);
    updateHome();
    showScreen(homeScreen);
  });

  quizScreen.querySelector("#enter-focus")?.addEventListener("click", () => setFocusMode(true));
  quizScreen.querySelector("#exit-focus")?.addEventListener("click", () => setFocusMode(false));

  quizScreen.querySelector("#toggle-progress")?.addEventListener("click", () => {
    appState.preferences.progressVisible = !appState.preferences.progressVisible;
    saveAppState(appState);
    renderQuiz();
  });

  quizScreen.querySelector("#toggle-timer")?.addEventListener("click", () => {
    appState.preferences.timerVisible = !appState.preferences.timerVisible;
    saveAppState(appState);
    renderQuiz();
  });

  quizScreen.querySelector("#toggle-options")?.addEventListener("click", () => {
    saveVisibleAnswer(state);
    state.essayOptionsVisible = !state.essayOptionsVisible;
    state.feedback = "";
    persistSession();
    renderQuiz();
  });

  quizScreen.querySelectorAll('input[name="answer"]').forEach((input) => {
    input.addEventListener("change", () => {
      state.answer = input.value;
      state.feedback = "";
      persistSession();
      quizScreen.querySelectorAll(".choice-option").forEach((option) => option.classList.toggle("is-selected", option.contains(input)));
    });
  });

  quizScreen.querySelector("#answer-input")?.addEventListener("input", (event) => {
    state.answer = event.target.value;
    state.feedback = "";
    persistSession();
  });

  quizScreen.querySelector("#answer-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    handleSubmit(question, state);
  });

  quizScreen.querySelector("#show-hint")?.addEventListener("click", () => {
    state.hintsShown = Math.min(state.hintsShown + 1, question.hints.length);
    state.feedback = pickMessage(state.hintsShown > 1 ? "repeatedDifficulty" : "hint");
    state.feedbackType = "neutral";
    persistSession();
    renderQuiz();
    announce(state.feedback);
  });

  quizScreen.querySelector("#give-up")?.addEventListener("click", () => {
    state.solutionRevealed = true;
    state.status = "revealed";
    state.feedback = pickMessage("giveUp");
    state.feedbackType = "neutral";
    persistSession();
    renderQuiz();
    announce(state.feedback);
  });

  quizScreen.querySelector("#prev-question")?.addEventListener("click", () => moveQuestion(-1, state));
  quizScreen.querySelector("#next-question")?.addEventListener("click", () => moveQuestion(1, state));
  quizScreen.querySelector("#finish-session")?.addEventListener("click", () => openFinishDialog(state));
  quizScreen.querySelector("#question-nav")?.addEventListener("click", () => openQuestionNavigator(state));
}

function handleSubmit(question, state) {
  saveVisibleAnswer(state);
  if (!String(state.answer || "").trim()) {
    state.feedback = pickMessage("emptyAnswer");
    state.feedbackType = "neutral";
    persistSession();
    renderQuiz();
    announce(state.feedback);
    return;
  }

  if (session.mode === "exam") {
    state.status = "answered";
    state.feedback = "انحفظت إجابتك، وتقدرين تغيّرينها بأي وقت.";
    state.feedbackType = "neutral";
    persistSession();
    renderQuiz();
    announce(state.feedback);
    return;
  }

  state.attempts += 1;
  if (gradeQuestion(question, state.answer)) {
    state.status = "correct";
    state.feedback = pickMessage("correct");
    state.feedbackType = "correct";
  } else {
    state.status = "incorrect";
    state.feedback = pickMessage(state.attempts > 1 ? "repeatedDifficulty" : "incorrect");
    state.feedbackType = "incorrect";
  }
  persistSession();
  renderQuiz();
  announce(state.feedback);
}

function moveQuestion(direction, state) {
  saveVisibleAnswer(state);
  session.currentIndex = Math.min(Math.max(session.currentIndex + direction, 0), session.questionIds.length - 1);
  persistSession();
  renderQuiz();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setFocusMode(enabled) {
  appState.preferences.focusMode = enabled;
  saveAppState(appState);
  renderQuiz();
  announce(enabled ? "تم تشغيل وضع التركيز." : "تم إنهاء وضع التركيز.");
}

function showDialog(markup) {
  if (dialog.open) dialog.close();
  dialogContent.innerHTML = markup;
  dialog.showModal();
  dialogContent.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => dialog.close()));
}

function openFinishDialog(state) {
  saveVisibleAnswer(state);
  const unanswered = session.questionIds.filter((id) => !String(session.questionState[id].answer || "").trim()).length;
  showDialog(`
    <div class="dialog-body">
      <p class="eyebrow">على راحتك</p>
      <h2>تبين تنهين ${session.mode === "exam" ? "الاختبار" : "التدريب"}؟</h2>
      <p>${unanswered ? `باقي ${unanswered} ${unanswered === 1 ? "سؤال بدون إجابة" : "أسئلة بدون إجابة"}. تقدرين ترجعين لها أو تنهين الجلسة الحين.` : "كل الأسئلة فيها إجابة، وإذا ودك نطلع النتيجة الحين."}</p>
      <div class="dialog-actions">
        <button class="primary-button" id="confirm-finish" type="button">نعم، عرض النتيجة</button>
        <button class="secondary-button" data-close-dialog type="button">أكمّل شوي</button>
      </div>
    </div>`);
  dialogContent.querySelector("#confirm-finish").addEventListener("click", finishSession);
}

function openQuestionNavigator(state) {
  saveVisibleAnswer(state);
  showDialog(`
    <div class="dialog-body">
      <div class="dialog-heading-row"><div><p class="eyebrow">خريطة هادئة</p><h2>الأسئلة</h2></div><button class="icon-button" data-close-dialog aria-label="إغلاق" type="button">×</button></div>
      <div class="question-map">
        ${session.questionIds.map((id, index) => {
          const item = session.questionState[id];
          const answered = String(item.answer || "").trim() || ["correct", "revealed"].includes(item.status);
          return `<button type="button" data-question-index="${index}" class="map-button ${answered ? "has-answer" : ""} ${index === session.currentIndex ? "is-current" : ""}" aria-label="الذهاب إلى السؤال ${index + 1}">${index + 1}</button>`;
        }).join("")}
      </div>
      <p class="dialog-note">النقطة الهادية تعني أن عندك إجابة محفوظة، بدون أي حكم عليها.</p>
    </div>`);
  dialogContent.querySelectorAll("[data-question-index]").forEach((button) => {
    button.addEventListener("click", () => {
      session.currentIndex = Number(button.dataset.questionIndex);
      persistSession();
      dialog.close();
      renderQuiz();
    });
  });
}

function finishSession() {
  dialog.close();
  timer.stop();
  session.completedAt = Date.now();
  latestReport = buildReport(session);
  addCompletedSession(appState, latestReport);
  session = null;
  appState.preferences.focusMode = false;
  saveAppState(appState);
  document.body.classList.remove("focus-mode");
  renderResults(latestReport);
  showScreen(resultsScreen);
  announce(pickMessage(latestReport.mode === "exam" ? "finishExam" : "finishTraining"));
}

function renderResults(report) {
  const positive = report.accuracy >= 75;
  resultsScreen.innerHTML = `
    <header class="results-header">
      <div class="brand-mark" aria-hidden="true">∫</div>
      <button class="quiet-button" id="results-home" type="button">الرئيسية</button>
    </header>
    <section class="results-hero">
      <p class="eyebrow">خلصت الجلسة</p>
      <h1 id="results-title">${positive ? "شغلك مرتب يا سارة" : "عرفنا وين نركّز"}</h1>
      <p>${pickMessage(positive ? "goodPerformance" : "difficultSession")}</p>
      <div class="accuracy-ring" style="--score:${report.accuracy * 3.6}deg" aria-label="الدقة ${report.accuracy} بالمئة">
        <div><strong>${report.accuracy}%</strong><span>دقّة</span></div>
      </div>
    </section>

    <section class="summary-grid" aria-label="ملخص الجلسة">
      <div><strong>${report.correct}</strong><span>مضبوطة</span></div>
      <div><strong>${report.incorrect}</strong><span>تحتاج مراجعة</span></div>
      <div><strong>${report.hinted}</strong><span>استخدمت تلميح</span></div>
    </section>

    <section class="topic-results">
      <div class="section-heading"><div><p class="eyebrow">صورة بسيطة</p><h2>حسب المهارة</h2></div></div>
      ${(report.subtopicStats || report.topicStats).map((topic) => `
        <div class="topic-row">
          <span>${topic.label}</span>
          <div class="topic-bar" aria-hidden="true"><span style="width:${Math.round((topic.correct / topic.total) * 100)}%"></span></div>
          <strong>${topic.correct}/${topic.total}</strong>
        </div>`).join("")}
    </section>

    <section class="review-card">
      <p class="eyebrow">مواضيع تحتاج مراجعة</p>
      <h2>${report.weakTopics.length ? report.weakTopics.map((topic) => topic.label).join(" · ") : "ما فيه نقطة واضحة تحتاج تركيز إضافي"}</h2>
      <p>${report.weakTopics.length ? pickMessage("reviewRecommendation") : "كمّلي بنفس الهدوء، وضعك طيب."}</p>
      <div class="result-actions">
        ${report.reviewIds.length ? `<button class="primary-button" id="review-questions" type="button">مراجعة الحلول</button>` : ""}
        ${report.weakTopics.length ? `<button class="secondary-button" id="train-weak" type="button">تدرّبي على نقاط ضعفك</button>` : ""}
      </div>
    </section>`;

  resultsScreen.querySelector("#results-home").addEventListener("click", () => {
    updateHome();
    showScreen(homeScreen);
  });
  resultsScreen.querySelector("#review-questions")?.addEventListener("click", () => {
    reviewIndex = 0;
    renderReviewDialog();
  });
  resultsScreen.querySelector("#train-weak")?.addEventListener("click", startWeakTraining);
}

function renderReviewDialog() {
  if (!latestReport?.reviewIds.length) return;
  const question = getQuestionById(latestReport.reviewIds[reviewIndex]);
  showDialog(`
    <div class="dialog-body review-dialog-body">
      <div class="dialog-heading-row"><div><p class="eyebrow">مراجعة ${reviewIndex + 1} من ${latestReport.reviewIds.length}</p><h2>${question.subtopic}</h2></div><button class="icon-button" data-close-dialog aria-label="إغلاق" type="button">×</button></div>
      <p class="review-prompt">${question.prompt}</p>
      <div class="question-formula math-scroll">${formatMath(question.formula, true)}</div>
      ${solutionMarkup(question)}
      <div class="review-nav">
        <button class="nav-button" id="review-prev" type="button" ${reviewIndex === 0 ? "disabled" : ""}>السابق</button>
        <button class="nav-button" id="review-next" type="button" ${reviewIndex === latestReport.reviewIds.length - 1 ? "disabled" : ""}>التالي</button>
      </div>
    </div>`);
  dialogContent.querySelector("#review-prev")?.addEventListener("click", () => { reviewIndex -= 1; renderReviewDialog(); });
  dialogContent.querySelector("#review-next")?.addEventListener("click", () => { reviewIndex += 1; renderReviewDialog(); });
  renderMath(dialogContent);
}

function startWeakTraining() {
  const weakSubtopics = new Set(latestReport.weakTopics.map((topic) => topic.subtopic || topic.topic));
  session = createSession("training", "section45");
  const weakPool = getQuestions("section45").filter((question) => weakSubtopics.has(question.subtopic));
  session.questionIds = weakPool.map((question) => question.id);
  session.questionState = Object.fromEntries(weakPool.map((question) => [question.id, {
    answer: "", status: "unanswered", attempts: 0, hintsShown: 0,
    solutionRevealed: false, optionsHidden: false, essayOptionsVisible: false,
  }]));
  session.topic = "weak";
  session.topicLabel = "نقاط تحتاج مراجعة";
  persistSession();
  renderQuiz();
  showScreen(quizScreen);
}

function openSettings() {
  showDialog(`
    <div class="dialog-body">
      <div class="dialog-heading-row"><div><p class="eyebrow">المساحة لك</p><h2>الإعدادات</h2></div><button class="icon-button" data-close-dialog aria-label="إغلاق" type="button">×</button></div>
      <label class="setting-row"><span><strong>إظهار التقدّم</strong><small>تقدرين تخفينه داخل الجلسة بعد</small></span><input id="setting-progress" type="checkbox" ${appState.preferences.progressVisible ? "checked" : ""} /></label>
      <label class="setting-row"><span><strong>إظهار وقت الاختبار</strong><small>إخفاؤه ما يوقف العد</small></span><input id="setting-timer" type="checkbox" ${appState.preferences.timerVisible ? "checked" : ""} /></label>
      <div class="settings-history"><span>الجلسات المحفوظة على هذا الجهاز</span><strong>${appState.completedSessions.length}</strong></div>
      <button class="danger-button" id="reset-progress" type="button">مسح التقدّم المحفوظ</button>
    </div>`);
  dialogContent.querySelector("#setting-progress").addEventListener("change", (event) => {
    appState.preferences.progressVisible = event.target.checked;
    saveAppState(appState);
  });
  dialogContent.querySelector("#setting-timer").addEventListener("change", (event) => {
    appState.preferences.timerVisible = event.target.checked;
    saveAppState(appState);
  });
  dialogContent.querySelector("#reset-progress").addEventListener("click", openResetConfirmation);
}

function openResetConfirmation() {
  showDialog(`
    <div class="dialog-body">
      <p class="eyebrow">قبل المسح</p>
      <h2>نمسح كل التقدّم؟</h2>
      <p>هذا يمسح الجلسة الحالية والنتائج والتفضيلات المحفوظة على هذا الجهاز.</p>
      <div class="dialog-actions">
        <button class="danger-button" id="confirm-reset" type="button">نعم، امسحيه</button>
        <button class="secondary-button" data-close-dialog type="button">خليه</button>
      </div>
    </div>`);
  dialogContent.querySelector("#confirm-reset").addEventListener("click", () => {
    const clean = resetAppState();
    Object.keys(appState).forEach((key) => delete appState[key]);
    Object.assign(appState, clean);
    session = null;
    latestReport = null;
    dialog.close();
    updateHome();
    showScreen(homeScreen);
    announce("تم مسح التقدّم المحفوظ.");
  });
}

function registerWebMcpTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  try {
    void Promise.resolve(context.registerTool({
      name: "start_calculus_session",
      title: "بدء جلسة تفاضل وتكامل",
      description: "ابدأ جلسة تدريب أو اختبار في الموضوع المختار، وافتح أول سؤال في الواجهة.",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["training", "exam"] },
          topic: { type: "string", enum: Object.keys(TOPICS) },
        },
        required: ["mode", "topic"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || !["training", "exam"].includes(input.mode) || !Object.hasOwn(TOPICS, input.topic)) {
          throw new Error("mode or topic is not supported");
        }
        startNewSession(input.mode, input.topic);
        return { status: "started", mode: input.mode, topic: input.topic, questionCount: session.questionIds.length };
      },
    })).catch(() => {});
  } catch {
    // WebMCP is optional and feature-detected; the visible interface remains complete.
  }
}

document.querySelector("#start-training").addEventListener("click", () => startNewSession("training"));
document.querySelector("#start-exam").addEventListener("click", () => startNewSession("exam"));
document.querySelector("#resume-session").addEventListener("click", () => {
  if (!session) return;
  renderQuiz();
  showScreen(quizScreen);
});
document.querySelector("#open-settings").addEventListener("click", openSettings);
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
window.addEventListener("load", () => renderMath(document));

updateHome();
registerWebMcpTools();
