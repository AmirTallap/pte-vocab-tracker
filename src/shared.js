/**
 * The half of this tool that has no Node dependency: the sheet definitions,
 * the date helpers, and the derived study statistics.
 *
 * They used to live in config.js and tracker.js, which between them import
 * node:fs, node:path and node:url. That was fine while the only host was this
 * machine. The cloud build runs the *same batch rules* in a browser - see
 * web/cloud-store.js - and a browser cannot load a module that imports
 * node:fs, however unreachable that import is at runtime.
 *
 * So this file exists to break the chain, and it exists by MOVING code, not
 * copying it: config.js and tracker.js re-export everything here, so no call
 * site anywhere changed. There is still exactly one definition of SHEETS, of
 * today(), and of the empty progress shape. Two copies of the study rules -
 * one for the Node server and one for the browser - is precisely the drift
 * this project warns about everywhere else, and it is not on the table.
 *
 * The rule for this file: nothing here may import from Node, ever. If a value
 * needs a filesystem path, it belongs in config.js.
 */

// The two sheets, and how many of each go into a daily batch.
export const SHEETS = {
  words:   { sheet: 'Academic Words',  label: 'words',   perDay: 50 },
  phrases: { sheet: 'Complex Phrases', label: 'phrases', perDay: 20 },
};

export const EXAM_DATE = '2026-12-19';

// Canonical headers written back to Excel. Input headers are matched loosely
// (see loader.js) so a file re-saved by Excel still loads.
export const HEADERS = {
  word:    'Word',
  arabic:  'Arabic Translation',
  meaning: 'English Meaning',
  known:   'Known (T/F)',
  listen:  'Listen (EN>AR)',
};

// Cell text for the pronunciation hyperlink column written into the workbook.
export const LISTEN_LABEL = 'play';

/**
 * The shape of a fresh progress file. The browser store starts from this same
 * object, so a first visit to the cloud build and a first run of the local
 * tool begin from an identical state.
 */
export const EMPTY_PROGRESS = {
  version: 1,
  cycleStart: null,
  examDate: EXAM_DATE,
  batches: {},                       // "YYYY-MM-DD" -> { words: [key], phrases: [key] }
  studyBatches: {},                  // sheet -> { next, list: [{ n, created, keys }] }
  seen: { words: {}, phrases: {} },  // key -> times it has appeared in a batch
  flags: { words: {}, phrases: {} }, // key -> true, words set aside to work on
  history: [],                       // one snapshot per day a batch was drawn
  drills: [],                        // recall/review sessions
};

/** Local calendar date as YYYY-MM-DD (not UTC — the study day is your day). */
export function today(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Whole days from a to b, compared at UTC midnight so DST cannot shift it. */
export function daysBetween(a, b) {
  const at = Date.parse(`${a}T00:00:00Z`);
  const bt = Date.parse(`${b}T00:00:00Z`);
  return Math.round((bt - at) / 86400000);
}

/* ------------------------------------------------------ derived statistics */

function coverage(entries, seen) {
  return entries.filter((e) => (seen[e.key] || 0) > 0).length;
}

/**
 * Everything the dashboard and the pace maths need.
 * Nothing here is stored — it is recomputed from the deck on every call, so a
 * flag edited in Excel is reflected immediately and cannot go stale.
 */
export function stats(deck, progress, date = today()) {
  const per = {};

  for (const [id, cfg] of Object.entries(SHEETS)) {
    const entries = deck[id] || [];
    const known = entries.filter((e) => e.known).length;
    const total = entries.length;
    const seen = progress.seen[id] || {};
    per[id] = {
      label: cfg.label,
      perDay: cfg.perDay,
      total,
      known,
      unknown: total - known,
      pct: total ? (known / total) * 100 : 0,
      seenOnce: coverage(entries, seen),
      seenPct: total ? (coverage(entries, seen) / total) * 100 : 0,
      neverSeen: total - coverage(entries, seen),
    };
  }

  const cycleStart = progress.cycleStart;
  const examDate = progress.examDate || EXAM_DATE;
  const daysToExam = daysBetween(date, examDate);

  // A cycle start in the future (a batch drawn with --date ahead of today)
  // yields a negative day number. Reported as "starts in N days" rather than
  // "day -9, week -1", which is not a state the plan has.
  const rawDay = cycleStart ? daysBetween(cycleStart, date) + 1 : null;
  const cycleDay = rawDay != null && rawDay >= 1 ? rawDay : null;
  const startsIn = rawDay != null && rawDay < 1 ? 1 - rawDay : null;

  // Pace: the study days left INCLUDING today. Past the exam this floors at 0
  // and requiredPerDay becomes null rather than dividing by zero or lying.
  const daysLeft = Math.max(daysToExam, 0);
  const studyDays = daysLeft + (daysToExam >= 0 ? 1 : 0);

  for (const p of Object.values(per)) {
    p.requiredPerDay = studyDays > 0 ? p.unknown / studyDays : null;
    // Days to clear the backlog at the configured pace, assuming no re-marking.
    p.daysAtCurrentPace = p.perDay > 0 ? Math.ceil(p.unknown / p.perDay) : null;
    p.onTrack = p.requiredPerDay == null ? null : p.requiredPerDay <= p.perDay;
  }

  return {
    date,
    examDate,
    daysToExam,
    studyDays,
    cycleStart,
    cycleDay,
    startsIn,
    week: cycleDay ? Math.ceil(cycleDay / 7) : null,
    batchesRun: Object.keys(progress.batches).length,
    per,
  };
}

/* ------------------------------------------------------------------- keys */

/** The key an entry is identified by across files and across runs. */
export const keyOf = (text) => String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/* ---------------------------------------------------------------- grammar */

/** Case- and space-insensitive, and blind to the apostrophe Word likes to curl. */
function normalise(s) {
  return String(s == null ? '' : s)
    .replace(/[‘’ʼ]/g, "'")
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Mark one typed answer against the accepted list. */
export function isAccepted(question, given) {
  const g = normalise(given);
  if (!g) return false;
  return question.accept.some((a) => normalise(a) === g);
}

/** The learner's record for one module, created on demand. */
export function grammarState(progress, moduleId) {
  progress.grammar ||= {};
  const m = (progress.grammar[moduleId] ||= { answers: {}, lastAt: null });
  if (!m.answers || typeof m.answers !== 'object') m.answers = {};
  return m;
}

/**
 * Record one attempt. Both counts are kept: `right` and `wrong` make the
 * difference between a rule that was guessed once and one that is actually
 * held, which a single boolean would hide.
 */
export function recordAnswer(progress, moduleId, questionId, correct) {
  const m = grammarState(progress, moduleId);
  const a = (m.answers[questionId] ||= { right: 0, wrong: 0, last: null });
  if (correct) a.right += 1; else a.wrong += 1;
  a.last = correct ? 'right' : 'wrong';
  m.lastAt = new Date().toISOString();
  return a;
}

/** Answers only - the content itself is on disk and never changes. */
export function grammarProgress(progress) {
  const out = {};
  for (const [id, m] of Object.entries(progress.grammar || {})) {
    out[id] = { answers: m.answers || {}, lastAt: m.lastAt || null };
  }
  return out;
}
