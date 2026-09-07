import fs from 'node:fs';
import { PROGRESS_FILE, EXAM_DATE, SHEETS } from './config.js';

const EMPTY = {
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

export function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return structuredClone(EMPTY);
  try {
    const raw = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    return { ...structuredClone(EMPTY), ...raw,
      seen: { ...EMPTY.seen, ...(raw.seen || {}) },
      // A file written before flags existed has no `flags` at all, and one
      // written with only words flagged has no `phrases` - both must come back
      // with a sheet to write into rather than undefined.
      flags: { ...EMPTY.flags, ...(raw.flags || {}) },
      studyBatches: { ...(raw.studyBatches || {}) } };
  } catch (err) {
    throw new Error(`progress.json is unreadable (${err.message}). Fix or delete it: ${PROGRESS_FILE}`);
  }
}

/**
 * Written to a temp file and renamed over the real one, which is atomic on the
 * same filesystem. A crash or a full disk therefore leaves the previous file
 * intact rather than a truncated one - and a truncated progress.json is not a
 * small loss: batch numbers and membership live here and nowhere else.
 */
export function saveProgress(progress) {
  const tmp = `${PROGRESS_FILE}.tmp`;
  const text = JSON.stringify(progress, null, 2) + '\n';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);                 // on disk, not just in the page cache
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, PROGRESS_FILE);
  return PROGRESS_FILE;
}

/**
 * Timestamped copy beside progress.json, the twin of backupMaster(). The
 * workbook has had backups since the start; this file - the only record of the
 * numbered batches - had none, so a lost batch could not be recovered.
 */
export function backupProgress(file = PROGRESS_FILE) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = file.replace(/\.json$/, `.backup-${stamp}.json`);
  fs.copyFileSync(file, dest);
  return dest;
}

/** Count of entries that have appeared in at least one batch. */
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

/** Append today's mastery snapshot, replacing an existing one for the day. */
export function snapshot(progress, deck, date = today()) {
  const entry = { date };
  for (const id of Object.keys(SHEETS)) {
    const entries = deck[id] || [];
    entry[id] = { known: entries.filter((e) => e.known).length, total: entries.length };
  }
  progress.history = progress.history.filter((h) => h.date !== date);
  progress.history.push(entry);
  progress.history.sort((a, b) => a.date.localeCompare(b.date));
  return entry;
}
