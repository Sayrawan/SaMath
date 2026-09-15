const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function latinDigits(value) {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)));
}

export function normalizeAnswer(value) {
  return latinDigits(value)
    .toLowerCase()
    .trim()
    .replace(/[−–—]/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/\\left|\\right/g, "")
    .replace(/\\cdot|\\times/g, "*")
    .replace(/\\,/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, "")
    .replace(/\*+/g, "*");
}

export function parseNumericAnswer(value) {
  const normalized = latinDigits(value)
    .trim()
    .replace(/[−–—]/g, "-")
    .replace(/،/g, ".")
    .replace(/,/g, ".")
    .replace(/\s+/g, "");

  const latexFraction = normalized.match(/^\\frac\{(-?\d+(?:\.\d+)?)\}\{(-?\d+(?:\.\d+)?)\}$/);
  const plainFraction = normalized.match(/^(-?\d+(?:\.\d+)?)[/÷](-?\d+(?:\.\d+)?)$/);
  const fraction = latexFraction || plainFraction;
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator === 0 ? Number.NaN : Number(fraction[1]) / denominator;
  }
  return Number(normalized);
}

export function answersMatch(question, submitted) {
  if (submitted === undefined || submitted === null || String(submitted).trim() === "") return false;

  if (question.type === "numeric") {
    const numeric = parseNumericAnswer(submitted);
    return Number.isFinite(numeric) && Math.abs(numeric - Number(question.correctAnswer)) <= (question.tolerance ?? 0);
  }

  const normalized = normalizeAnswer(submitted);
  const accepted = [question.correctAnswer, ...(question.acceptedAnswers || [])].map(normalizeAnswer);
  return accepted.includes(normalized);
}

export function renderMath(root = document) {
  const nodes = root.querySelectorAll("[data-math]:not([data-math-rendered])");
  nodes.forEach((node) => {
    const expression = node.dataset.math || "";
    node.setAttribute("dir", "ltr");
    if (window.katex?.render) {
      try {
        window.katex.render(expression, node, { throwOnError: false, displayMode: node.dataset.display === "true" });
        node.dataset.mathRendered = "true";
      } catch {
        node.textContent = expression;
      }
    } else {
      node.textContent = expression;
    }
  });
}

export function formatMath(expression, display = false) {
  return `<span class="math-content" data-math="${escapeAttribute(expression)}" data-display="${display}">${escapeHtml(expression)}</span>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
