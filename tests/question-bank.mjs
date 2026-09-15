import assert from "node:assert/strict";
import {
  DIFFICULTY_LABELS,
  EXAM_CONFIG,
  QUESTION_BANK,
  TOPICS,
  getQuestionById,
  getQuestions,
} from "../dist/js/questions.js";
import { createSession } from "../dist/js/quiz-engine.js";
import { answersMatch, parseNumericAnswer } from "../dist/js/math.js";

const allowedTypes = new Set(["multiple-choice", "true-false", "select", "numeric", "math", "hybrid"]);
const allowedTracks = new Set(["concepts", "quotients", "transformations", "powers"]);
const counts = (key) => Object.fromEntries([...Map.groupBy(QUESTION_BANK, (question) => question[key])].map(([name, rows]) => [name, rows.length]));

assert.equal(QUESTION_BANK.length, 40, "The bank must contain exactly 40 questions");
assert.equal(new Set(QUESTION_BANK.map((question) => question.id)).size, 40, "Question IDs must be unique");
assert.deepEqual(counts("difficulty"), { easy: 10, medium: 20, hard: 10 });
assert.deepEqual(counts("type"), {
  "multiple-choice": 5,
  "true-false": 3,
  select: 4,
  numeric: 11,
  math: 13,
  hybrid: 4,
});

for (const question of QUESTION_BANK) {
  assert.ok(question.id && question.prompt && question.formula, `${question.id}: missing identity or prompt`);
  assert.ok(allowedTypes.has(question.type), `${question.id}: unsupported type`);
  assert.ok(allowedTracks.has(question.track), `${question.id}: unsupported track`);
  assert.ok(DIFFICULTY_LABELS[question.difficulty], `${question.id}: unsupported difficulty`);
  assert.ok(question.subtopic && question.rule && question.finalAnswer && question.explanation, `${question.id}: incomplete teaching metadata`);
  assert.ok(question.hints?.length >= 3, `${question.id}: needs three progressive hints`);
  assert.ok(question.solutionSteps?.length >= 3, `${question.id}: needs a detailed solution`);
  assert.equal(getQuestionById(question.id), question, `${question.id}: lookup failed`);

  if (["math", "numeric"].includes(question.type)) {
    assert.ok(question.options?.length >= 4, `${question.id}: essay question needs optional choices`);
  }

  if (question.options?.length) {
    assert.equal(new Set(question.options.map((option) => option.value)).size, question.options.length, `${question.id}: duplicate option values`);
    assert.equal(question.options.filter((option) => answersMatch(question, option.value)).length, 1, `${question.id}: options must contain exactly one correct answer`);
  }
}

assert.equal(getQuestions("section45").length, 40);
for (const track of allowedTracks) assert.ok(getQuestions(track).length > 0, `${track}: empty track`);
assert.equal(parseNumericAnswer("1/2"), 0.5);
assert.equal(parseNumericAnswer("\\frac{3}{2}"), 1.5);
assert.equal(parseNumericAnswer("١÷٤"), 0.25);

for (let sample = 0; sample < 25; sample += 1) {
  const training = createSession("training", "section45");
  const exam = createSession("exam", "section45");
  assert.equal(training.questionIds.length, EXAM_CONFIG.trainingQuestionCount);
  assert.equal(exam.questionIds.length, EXAM_CONFIG.questionCount);
  assert.equal(new Set(training.questionIds).size, training.questionIds.length);
  assert.equal(new Set(exam.questionIds).size, exam.questionIds.length);
  assert.deepEqual(countSessionDifficulties(exam), { easy: 3, medium: 5, hard: 2 });
  assert.ok(new Set(exam.questionIds.map((id) => getQuestionById(id).track)).size >= 3, "Exam needs broad skill coverage");
}

function countSessionDifficulties(session) {
  return Object.fromEntries(
    [...Map.groupBy(session.questionIds.map(getQuestionById), (question) => question.difficulty)]
      .map(([name, rows]) => [name, rows.length]),
  );
}

console.log(JSON.stringify({
  status: "passed",
  total: QUESTION_BANK.length,
  difficulties: counts("difficulty"),
  types: counts("type"),
  tracks: counts("track"),
  topics: TOPICS,
}, null, 2));
