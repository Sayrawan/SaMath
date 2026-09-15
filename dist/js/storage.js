const STORAGE_KEY = "sara-calculus-v1";

const DEFAULT_STATE = {
  version: 1,
  preferences: {
    timerVisible: true,
    progressVisible: true,
    focusMode: false,
  },
  activeSession: null,
  completedSessions: [],
};

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function loadAppState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefault();
    const parsed = JSON.parse(raw);
    if (!isObject(parsed) || parsed.version !== 1) return cloneDefault();

    return {
      ...cloneDefault(),
      ...parsed,
      preferences: { ...DEFAULT_STATE.preferences, ...(isObject(parsed.preferences) ? parsed.preferences : {}) },
      activeSession: isObject(parsed.activeSession) ? parsed.activeSession : null,
      completedSessions: Array.isArray(parsed.completedSessions) ? parsed.completedSessions.slice(0, 20) : [],
    };
  } catch {
    return cloneDefault();
  }
}

export function saveAppState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function resetAppState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A private or restricted browser may block storage; the app still works in memory.
  }
  return cloneDefault();
}

export function addCompletedSession(state, report) {
  state.completedSessions = [report, ...(state.completedSessions || [])].slice(0, 20);
  state.activeSession = null;
  saveAppState(state);
}
