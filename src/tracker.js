import fs from 'node:fs';
import { PROGRESS_FILE, SHEETS } from './config.js';
// today(), the empty shape and stats() live in shared.js: the browser store
// starts from the same object and computes the same numbers, and it cannot
// import this file (node:fs). Re-exported so every existing importer of
// tracker.js is unaffected.
import { EMPTY_PROGRESS, today, daysBetween } from './shared.js';
export { today, daysBetween, stats } from './shared.js';

const EMPTY = EMPTY_PROGRESS;

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
