const endpoint = "http://127.0.0.1:9223";
const siteUrl = "http://127.0.0.1:4173/";
const storageKey = "sara-calculus-v1";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const page = await fetch(`${endpoint}/json/new?${encodeURIComponent(siteUrl)}`, { method: "PUT" }).then((response) => response.json());
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const runtimeErrors = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(message.params.exceptionDetails.text);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function command(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function click(selector) {
  const found = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  assert(found, `Missing clickable element: ${selector}`);
  await delay(45);
}

async function setInput(selector, value) {
  const found = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  assert(found, `Missing input: ${selector}`);
  await delay(30);
}

async function setRadio(value) {
  const found = await evaluate(`(() => { const el = [...document.querySelectorAll('input[name="answer"]')].find((input) => input.value === ${JSON.stringify(value)}); if (!el) return false; el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  assert(found, `Missing radio value: ${value}`);
  await delay(30);
}

async function reloadAndResume() {
  await command("Page.reload", { ignoreCache: true });
  await delay(500);
  await click("#resume-session");
}

await command("Runtime.enable");
await command("Page.enable");
for (let attempt = 0; attempt < 30; attempt += 1) {
  if (await evaluate("document.readyState === 'complete' && Boolean(document.querySelector('#start-training'))")) break;
  await delay(100);
}
await evaluate("localStorage.clear(); location.reload(); true");
await delay(700);

const widths = [320, 375, 390, 430];
for (const width of widths) {
  await command("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: true });
  const layout = await evaluate("({ inner: innerWidth, scroll: document.documentElement.scrollWidth })");
  assert(layout.scroll <= layout.inner, `Horizontal overflow at ${width}px (${layout.scroll} > ${layout.inner})`);
}

assert((await evaluate("document.documentElement.dir")) === "rtl", "Document is not RTL");
assert((await evaluate("document.querySelector('#topic-select').value")) === "section45", "Section 4.5 is not the default topic");

await click("#start-training");
const trainingShape = await evaluate(`(async () => {
  const state = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
  const { getQuestionById } = await import('./js/questions.js');
  const questions = state.activeSession.questionIds.map(getQuestionById);
  return {
    count: questions.length,
    easy: questions.filter((q) => q.difficulty === 'easy').length,
    medium: questions.filter((q) => q.difficulty === 'medium').length,
    hard: questions.filter((q) => q.difficulty === 'hard').length,
    tracks: new Set(questions.map((q) => q.track)).size,
  };
})()`);
assert(JSON.stringify(trainingShape) === JSON.stringify({ count: 12, easy: 3, medium: 6, hard: 3, tracks: 4 }), `Unbalanced training set: ${JSON.stringify(trainingShape)}`);

const fixtureIds = [
  "s45-e01-direct-forms",
  "s45-e02-zero-over-zero-value",
  "s45-m01-source-example-1d",
  "s45-e06-source-example-1b",
  "s45-e04-identify-exp-form",
  "s45-h05-radical-infinity-difference",
];
await evaluate(`(() => {
  const state = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
  const blank = () => ({ answer: '', status: 'unanswered', attempts: 0, hintsShown: 0, solutionRevealed: false, optionsHidden: false, essayOptionsVisible: false });
  state.activeSession.questionIds = ${JSON.stringify(fixtureIds)};
  state.activeSession.currentIndex = 0;
  state.activeSession.questionState = Object.fromEntries(state.activeSession.questionIds.map((id) => [id, blank()]));
  localStorage.setItem(${JSON.stringify(storageKey)}, JSON.stringify(state));
})()`);
await reloadAndResume();

assert(await evaluate("document.querySelector('#toggle-options') !== null && document.querySelectorAll('input[name=answer]').length === 0"), "Multiple choice should begin behind the options button");
await click("#toggle-options");
assert(await evaluate("document.querySelectorAll('input[name=answer]').length === 4"), "Multiple choice options did not appear");
await setRadio("zero-inf");
await click("#answer-form button[type=submit]");
assert(await evaluate("document.querySelector('.feedback.incorrect') !== null && document.querySelector('#give-up') !== null"), "Incorrect retry path missing");
assert(await evaluate("document.querySelector('.question-status-x')?.textContent === '×'"), "Incorrect question marker missing");
assert(await evaluate(`(() => {
  const icon = document.querySelector('.feedback.incorrect .feedback-icon').getBoundingClientRect();
  const text = document.querySelector('.feedback.incorrect p').getBoundingClientRect();
  return icon.left > text.left;
})()`), "Incorrect feedback icon is not on the right of its message");

await click("#show-hint");
const firstHint = await evaluate("document.querySelector('.hint-panel').textContent");
await click("#show-hint");
const secondHint = await evaluate("document.querySelector('.hint-panel').textContent");
assert(firstHint !== secondHint, "Hints did not progress");
await click("#give-up");
assert(await evaluate("document.querySelectorAll('.solution-steps li').length >= 3 && document.querySelector('.final-answer') !== null"), "Detailed solution missing");

await click("#enter-focus");
assert(await evaluate("document.body.classList.contains('focus-mode')"), "Focus mode did not activate");
await click("#exit-focus");

await click("#next-question");
assert(await evaluate("document.querySelector('#toggle-options') === null && document.querySelectorAll('input[name=answer]').length === 2"), "True/false should keep its choices visible");
await setRadio("false");
await click("#answer-form button[type=submit]");
assert(await evaluate("document.querySelector('.feedback.correct') !== null"), "True/false grading failed");

await click("#next-question");
assert(await evaluate("document.querySelector('#answer-input') === null && document.querySelector('input[name=answer]') === null"), "Math question still exposes keyboard entry");
assert(await evaluate("document.querySelector('#toggle-options') !== null"), "Essay show-options button missing");
await click("#toggle-options");
assert(await evaluate("document.querySelectorAll('input[name=answer]').length === 4"), "Math choices did not appear");
await setRadio("1/6");
await reloadAndResume();
assert(await evaluate("document.querySelector('input[name=answer]:checked')?.value === '1/6'"), "Selected math option did not survive refresh");
await click("#answer-form button[type=submit]");
assert(await evaluate("document.querySelector('.feedback.correct') !== null"), "Math answer grading failed");

await click("#next-question");
assert(await evaluate("document.querySelector('#answer-input') === null && document.querySelector('input[name=answer]') === null"), "Numeric question still exposes keyboard entry");
await click("#toggle-options");
assert(await evaluate("document.querySelectorAll('input[name=answer]').length === 4"), "Numeric choices did not appear");
await setRadio("0.5");
await click("#answer-form button[type=submit]");
assert(await evaluate("document.querySelector('.feedback.correct') !== null"), "Numeric option grading failed");

await click("#next-question");
assert(await evaluate("document.querySelector('select#answer-input') === null && document.querySelector('#toggle-options') !== null && document.querySelectorAll('input[name=answer]').length === 0"), "Select question should begin behind the options button");
await click("#toggle-options");
assert(await evaluate("document.querySelectorAll('input[name=answer]').length === 4"), "Select radio choices did not appear");
await setRadio("zero-zero");
await click("#answer-form button[type=submit]");
assert(await evaluate("document.querySelector('.feedback.correct') !== null"), "Former select question grading failed");

await click("#next-question");
assert(await evaluate("document.querySelector('#toggle-options') !== null && document.querySelectorAll('input[name=answer]').length === 0"), "Hybrid question should begin behind the options button");
await click("#toggle-options");
assert(await evaluate("document.querySelectorAll('input[name=answer]').length === 4"), "Hybrid choices did not appear");
await setRadio("3/2");
await click("#answer-form button[type=submit]");
assert(await evaluate("document.querySelector('.feedback.correct') !== null"), "Hybrid option failed");

for (const width of widths) {
  await command("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: true });
  const layout = await evaluate("({ inner: innerWidth, scroll: document.documentElement.scrollWidth })");
  assert(layout.scroll <= layout.inner, `Question overflow at ${width}px (${layout.scroll} > ${layout.inner})`);
  const controls = await evaluate(`(() => {
    const actions = document.querySelector('.answer-actions').getBoundingClientRect();
    const footer = document.querySelector('.question-footer').getBoundingClientRect();
    return { actionsTop: actions.top, actionsBottom: actions.bottom, footerTop: footer.top, footerBottom: footer.bottom, height: innerHeight };
  })()`);
  assert(controls.actionsTop >= 0 && controls.actionsBottom <= controls.height && controls.footerTop >= 0 && controls.footerBottom <= controls.height + 1, `Controls are not reachable at ${width}px`);
}

await click("#finish-session");
await click("#confirm-finish");
assert(await evaluate("!document.querySelector('#results-screen').hidden && document.querySelector('.accuracy-ring') !== null"), "Training results missing");
assert(await evaluate("document.querySelectorAll('.topic-row').length >= 4"), "Subtopic report missing");
assert(await evaluate("document.querySelector('#train-weak') !== null"), "Weak-skill training action missing");
await click("#train-weak");
assert(await evaluate(`(async () => {
  const state = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
  const { getQuestionById } = await import('./js/questions.js');
  const subtopics = new Set(state.activeSession.questionIds.map((id) => getQuestionById(id).subtopic));
  return state.activeSession.questionIds.length > 0 && subtopics.size === 1;
})()`), "Weak-skill session was not targeted by subtopic");

await click("#back-home");
await click("#start-exam");
const examShape = await evaluate(`(async () => {
  const state = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
  const { getQuestionById } = await import('./js/questions.js');
  const questions = state.activeSession.questionIds.map(getQuestionById);
  return { count: questions.length, easy: questions.filter((q) => q.difficulty === 'easy').length, medium: questions.filter((q) => q.difficulty === 'medium').length, hard: questions.filter((q) => q.difficulty === 'hard').length, deadline: state.activeSession.deadline };
})()`);
assert(examShape.count === 10 && examShape.easy === 3 && examShape.medium === 5 && examShape.hard === 2, `Unbalanced exam set: ${JSON.stringify(examShape)}`);
assert(Number.isFinite(examShape.deadline), "Exam deadline was not persisted");

const examWrong = await evaluate(`(async () => {
  const state = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
  const { getQuestionById } = await import('./js/questions.js');
  const { answersMatch } = await import('./js/math.js');
  const question = getQuestionById(state.activeSession.questionIds[state.activeSession.currentIndex]);
  return question.options.find((option) => !answersMatch(question, option.value)).value;
})()`);
if (await evaluate("document.querySelector('#toggle-options') !== null && document.querySelector('input[name=answer]') === null")) await click("#toggle-options");
await setRadio(examWrong);
await click("#answer-form button[type=submit]");
assert(await evaluate("document.querySelector('.feedback.neutral') !== null && document.querySelector('.question-status-x') === null"), "Exam revealed correctness early");

await click("#toggle-timer");
assert(await evaluate("document.querySelector('.timer').classList.contains('is-concealed')"), "Timer hide preference did not apply");
await evaluate(`(() => { const state = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})); state.activeSession.deadline = Date.now() - 2500; state.preferences.timerVisible = true; localStorage.setItem(${JSON.stringify(storageKey)}, JSON.stringify(state)); })()`);
await reloadAndResume();
await delay(1100);
const overtime = await evaluate("document.querySelector('#timer-value').textContent");
assert(overtime.startsWith("-00:"), `Overtime timer did not continue below zero: ${overtime}`);
if (await evaluate("document.querySelector('#toggle-options') !== null && document.querySelector('input[name=answer]') === null")) await click("#toggle-options");
assert(await evaluate("document.querySelector('input[name=answer]')?.disabled === false"), "Exam locked after timer expired");

await click("#finish-session");
await click("#confirm-finish");
assert(await evaluate("!document.querySelector('#results-screen').hidden"), "Exam did not grade at completion");
assert(runtimeErrors.length === 0, `Browser runtime errors: ${runtimeErrors.join('; ')}`);

console.log(JSON.stringify({
  status: "passed",
  widths,
  bankSession: { training: "12 (3/6/3)", exam: "10 (3/5/2)" },
  questionTypes: ["multiple-choice", "true-false", "math", "numeric", "select", "hybrid"],
  verified: ["rtl", "no-overflow", "incorrect-marker", "feedback-icon-position", "progressive-hints", "worked-solution", "focus", "options-only-answers", "no-keyboard-entry", "radio-persistence", "fixed-mobile-actions", "subtopic-report", "weak-skill-training", "exam-privacy", "timer", "overtime"],
}, null, 2));

socket.close();
