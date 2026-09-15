import { answersMatch } from "./math.js";
import { EXAM_CONFIG, getQuestionById, getQuestions, TOPICS } from "./questions.js";

function initialQuestionState() {
  return {
    answer: "",
    status: "unanswered",
    attempts: 0,
    hintsShown: 0,
    solutionRevealed: false,
    optionsHidden: false,
    essayOptionsVisible: false,
  };
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function takeAcrossTracks(questions, count) {
  const groups = new Map();
  shuffle(questions).forEach((question) => {
    const group = groups.get(question.track) || [];
    group.push(question);
    groups.set(question.track, group);
  });

  const tracks = shuffle([...groups.keys()]);
  const selected = [];
  while (selected.length < count && tracks.length) {
    for (let index = tracks.length - 1; index >= 0 && selected.length < count; index -= 1) {
      const group = groups.get(tracks[index]);
      const question = group.pop();
      if (question) selected.push(question);
      if (!group.length) tracks.splice(index, 1);
    }
  }
  return selected;
}

export function selectBalancedQuestions(pool, count) {
  if (pool.length <= count) return shuffle(pool);
  const targets = count === 10
    ? { easy: 3, medium: 5, hard: 2 }
    : {
        easy: Math.round(count * 0.25),
        medium: Math.round(count * 0.5),
        hard: count - Math.round(count * 0.25) - Math.round(count * 0.5),
      };

  const selected = [];
  for (const difficulty of ["easy", "medium", "hard"]) {
    selected.push(...takeAcrossTracks(pool.filter((question) => question.difficulty === difficulty), targets[difficulty]));
  }

  const selectedIds = new Set(selected.map((question) => question.id));
  const remaining = shuffle(pool.filter((question) => !selectedIds.has(question.id)));
  while (selected.length < count && remaining.length) selected.push(remaining.pop());
  return shuffle(selected);
}

export function createSession(mode, topic = "section45") {
  const pool = getQuestions(topic);
  const requestedCount = mode === "exam" ? EXAM_CONFIG.questionCount : EXAM_CONFIG.trainingQuestionCount;
  const questions = selectBalancedQuestions(pool, Math.min(requestedCount, pool.length));
  const now = Date.now();
  return {
    id: `session-${now}`,
    mode,
    topic,
    topicLabel: TOPICS[topic] || TOPICS.all,
    questionIds: questions.map((question) => question.id),
    currentIndex: 0,
    questionState: Object.fromEntries(questions.map((question) => [question.id, initialQuestionState()])),
    startedAt: now,
    deadline: mode === "exam" ? now + EXAM_CONFIG.durationSeconds * 1000 : null,
    completedAt: null,
  };
}

export function hydrateSession(session) {
  if (!session || !Array.isArray(session.questionIds) || !session.questionIds.length) return null;
  const validIds = session.questionIds.filter((id) => getQuestionById(id));
  if (!validIds.length) return null;
  session.questionIds = validIds;
  session.currentIndex = Math.min(Math.max(Number(session.currentIndex) || 0, 0), validIds.length - 1);
  session.questionState = session.questionState && typeof session.questionState === "object" ? session.questionState : {};
  validIds.forEach((id) => {
    session.questionState[id] = { ...initialQuestionState(), ...(session.questionState[id] || {}) };
  });
  return session;
}

export function currentQuestion(session) {
  return getQuestionById(session.questionIds[session.currentIndex]);
}

export function gradeQuestion(question, answer) {
  return answersMatch(question, answer);
}

export function buildReport(session) {
  const rows = session.questionIds.map((id) => {
    const question = getQuestionById(id);
    const state = session.questionState[id];
    const correct = state.status === "correct" || (session.mode === "exam" && gradeQuestion(question, state.answer));
    return {
      id,
      topic: question.topic,
      subtopic: question.subtopic,
      correct,
      answered: String(state.answer ?? "").trim() !== "",
      hintsUsed: state.hintsShown || 0,
      solutionRevealed: Boolean(state.solutionRevealed),
    };
  });

  const topicStats = {};
  rows.forEach((row) => {
    const bucket = topicStats[row.topic] || { topic: row.topic, label: TOPICS[row.topic], total: 0, correct: 0, hints: 0, revealed: 0 };
    bucket.total += 1;
    bucket.correct += row.correct ? 1 : 0;
    bucket.hints += row.hintsUsed > 0 ? 1 : 0;
    bucket.revealed += row.solutionRevealed ? 1 : 0;
    topicStats[row.topic] = bucket;
  });

  const subtopicStats = {};
  rows.forEach((row) => {
    const key = row.subtopic || "غير مصنّف";
    const bucket = subtopicStats[key] || { subtopic: key, label: key, total: 0, correct: 0, hints: 0, revealed: 0 };
    bucket.total += 1;
    bucket.correct += row.correct ? 1 : 0;
    bucket.hints += row.hintsUsed > 0 ? 1 : 0;
    bucket.revealed += row.solutionRevealed ? 1 : 0;
    subtopicStats[key] = bucket;
  });

  const correct = rows.filter((row) => row.correct).length;
  const weakTopics = Object.values(subtopicStats)
    .filter((item) => item.correct / item.total < 0.75 || item.hints > 0 || item.revealed > 0)
    .sort((a, b) => a.correct / a.total - b.correct / b.total);

  return {
    id: session.id,
    mode: session.mode,
    topic: session.topic,
    startedAt: session.startedAt,
    completedAt: Date.now(),
    total: rows.length,
    correct,
    incorrect: rows.length - correct,
    accuracy: rows.length ? Math.round((correct / rows.length) * 100) : 0,
    hinted: rows.filter((row) => row.hintsUsed > 0).length,
    revealed: rows.filter((row) => row.solutionRevealed).length,
    rows,
    topicStats: Object.values(topicStats),
    subtopicStats: Object.values(subtopicStats),
    weakTopics,
    reviewIds: rows.filter((row) => !row.correct || row.solutionRevealed).map((row) => row.id),
  };
}
