import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ATTEMPTS_FILE } from './config.js';

/**
 * Your answers, and the reviews written about them. Added 26 Sep 2026, by
 * request, and it REVERSES a rule this project held until then: the essay and
 * the spoken answers were rehearsals, never documents, and nothing of them was
 * kept. They are kept now because a review has to have something to read, and
 * a failure log is only a log if it outlives the take.
 *
 * What is kept is TEXT, never audio: the essay as typed, or the transcript of
 * what you said with the pauses written in, plus the handful of numbers the
 * report already showed you. The recording itself is still held for one request
 * and written nowhere - the Pronunciation list's rule, words not voice.
 *
 * SQLite through node:sqlite, which ships with Node, so there is no dependency
 * to install. One file, `data/attempts.db`, in rollback-journal mode so it IS
 * one file: WAL would leave a -wal beside it that a copy or a commit could miss.
 *
 * Three tables, one job each:
 *   attempts  what you were asked and what you produced
 *   reviews   one review per attempt, as JSON - its shape belongs to the
 *             review skill (.claude/skills/review/SKILL.md), checked by
 *             checkReview() below before it is accepted
 *   faults    one row per grammar fault, pinned to a station on the grammar
 *             map. Derived from the review and rewritten with it, so the two
 *             cannot disagree; kept as rows because the map asks "how often,
 *             and where" across every attempt at once.
 */

/** The tasks an attempt can come from. The one list both the page and the review skill read. */
export const ATTEMPT_TASKS = {
  essay:      { name: 'Write Essay',               kind: 'written' },
  swt:        { name: 'Summarize Written Text',    kind: 'written' },
  sst:        { name: 'Summarize Spoken Text',     kind: 'written' },
  retell:     { name: 'Re-tell Lecture',           kind: 'spoken' },
  discussion: { name: 'Summarize Group Discussion', kind: 'spoken' },
  image:      { name: 'Describe Image',            kind: 'spoken' },
  situation:  { name: 'Respond to a Situation',    kind: 'spoken' },
  free:       { name: 'Free talk',                 kind: 'spoken' },
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS attempts (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    created  TEXT NOT NULL,
    task     TEXT NOT NULL,
    item_id  TEXT,
    title    TEXT,
    prompt   TEXT,            -- what you were given: the question, the passage, the chart as text
    answer   TEXT NOT NULL,   -- what you produced: the essay, or the transcript
    marked   TEXT,            -- the transcript with pauses and fillers written in, for spoken tasks
    metrics  TEXT             -- JSON: word count, minutes used, words per minute, fillers ...
  );
  CREATE TABLE IF NOT EXISTS reviews (
    attempt_id INTEGER PRIMARY KEY REFERENCES attempts(id) ON DELETE CASCADE,
    created    TEXT NOT NULL,
    body       TEXT NOT NULL  -- JSON, see checkReview()
  );
  CREATE TABLE IF NOT EXISTS faults (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
    station    TEXT NOT NULL,
    excerpt    TEXT NOT NULL,
    fix        TEXT,
    why        TEXT,
    created    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS faults_station ON faults(station);
`;

let backedUp = false;

/**
 * Open (creating if need be) the store. The first open of a server session
 * copies the file aside first, the way progress.json and the workbook are -
 * the copy is gitignored with theirs, by the `data/*.backup-*` pattern.
 */
export function openAttempts(file = ATTEMPTS_FILE, { backup = true } = {}) {
  if (backup && !backedUp && fs.existsSync(file) && fs.statSync(file).size > 0) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.copyFileSync(file, file.replace(/\.db$/, `.backup-${stamp}.db`));
    backedUp = true;
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

const now = () => new Date().toISOString();
const str = (v, max) => (v == null ? '' : String(v)).slice(0, max);

/** One answer in. Returns its id. */
export function saveAttempt(db, a) {
  if (!ATTEMPT_TASKS[a.task]) throw new Error(`unknown task: ${a.task}`);
  const answer = str(a.answer, 20000).trim();
  if (!answer) throw new Error('there is nothing to save: the answer is empty');
  const r = db.prepare(`INSERT INTO attempts (created, task, item_id, title, prompt, answer, marked, metrics)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(now(), a.task, str(a.itemId, 80), str(a.title, 200), str(a.prompt, 40000),
         answer, str(a.marked, 30000), JSON.stringify(a.metrics || {}));
  return Number(r.lastInsertRowid);
}

function parse(json, fallback) {
  try { return json ? JSON.parse(json) : fallback; } catch { return fallback; }
}

/** The list: newest first, without the long text fields. */
export function listAttempts(db, { task = '', status = '', limit = 200 } = {}) {
  const rows = db.prepare(`
    SELECT a.id, a.created, a.task, a.item_id, a.title, a.metrics,
           length(a.answer) AS chars, substr(a.answer, 1, 160) AS opening,
           r.created AS reviewed, r.body AS body,
           (SELECT count(*) FROM faults f WHERE f.attempt_id = a.id) AS faults
    FROM attempts a LEFT JOIN reviews r ON r.attempt_id = a.id
    WHERE (? = '' OR a.task = ?)
    ORDER BY a.id DESC LIMIT ?`).all(task, task, Math.max(1, Math.min(1000, limit)));
  // The review body is not sent with the list; only its score's total is.
  const total = (body) => {
    const t = (parse(body, {}).score || {}).traits;
    if (!Array.isArray(t) || !t.length) return null;
    return t.reduce((o, x) => ({ got: o.got + x.got, max: o.max + x.max }), { got: 0, max: 0 });
  };
  return rows
    .map(({ body, ...x }) => ({ ...x, metrics: parse(x.metrics, {}), score: total(body) }))
    .filter((x) => !status || (status === 'pending' ? !x.reviewed : !!x.reviewed));
}

/** One attempt whole, with its review if it has one. */
export function getAttempt(db, id) {
  const a = db.prepare('SELECT * FROM attempts WHERE id = ?').get(Number(id));
  if (!a) return null;
  const r = db.prepare('SELECT created, body FROM reviews WHERE attempt_id = ?').get(a.id);
  return {
    ...a,
    metrics: parse(a.metrics, {}),
    review: r ? { created: r.created, ...parse(r.body, {}) } : null,
  };
}

export function deleteAttempt(db, id) {
  return db.prepare('DELETE FROM attempts WHERE id = ?').run(Number(id)).changes > 0;
}

/**
 * A review is checked before it is stored, because its station ids are what
 * the map colours itself from and its deck entries are what the page paints
 * green. A fault pinned to a station that does not exist would vanish from
 * the map; a deck entry that is not on the sheet would suggest a word you
 * never practised. Both are refused rather than quietly dropped.
 *
 * `stations` is a Set of valid station ids, `inDeck(text, kind)` answers
 * whether a headword is on that sheet.
 */
export function checkReview(review, { stations, inDeck }) {
  const problems = [];
  if (!review || typeof review !== 'object') return ['the review is not an object'];
  if (typeof review.summary !== 'string' || !review.summary.trim()) problems.push('summary is missing');
  if (!Array.isArray(review.sentences) || !review.sentences.length) {
    problems.push('sentences[] is missing: the review goes sentence by sentence');
  } else {
    review.sentences.forEach((s, i) => {
      if (!s || typeof s.original !== 'string' || !s.original.trim()) problems.push(`sentences[${i}] has no original`);
      if (!s || typeof s.fixed !== 'string') problems.push(`sentences[${i}] has no fixed version`);
      if (!s || typeof s.better !== 'string') problems.push(`sentences[${i}] has no better version`);
    });
  }
  for (const [i, f] of (review.faults || []).entries()) {
    if (!f || !stations.has(f.station)) problems.push(`faults[${i}]: unknown station "${f && f.station}"`);
    if (!f || typeof f.excerpt !== 'string' || !f.excerpt.trim()) problems.push(`faults[${i}] has no excerpt`);
  }
  for (const [i, d] of (review.deck || []).entries()) {
    if (!d || !['words', 'phrases'].includes(d.kind)) problems.push(`deck[${i}]: kind must be words or phrases`);
    else if (!inDeck(d.entry, d.kind)) problems.push(`deck[${i}]: "${d.entry}" is not on the ${d.kind} sheet`);
  }
  for (const [i, d] of (review.used || []).entries()) {
    if (!d || !['words', 'phrases'].includes(d.kind) || !inDeck(d.entry, d.kind)) {
      problems.push(`used[${i}]: "${d && d.entry}" is not on the ${d && d.kind} sheet`);
    }
  }
  if (!review.ideas || typeof review.ideas.body !== 'string' || !review.ideas.body.trim()) {
    problems.push('ideas.body is missing: every review ends with an assessment of the ideas');
  }
  // Every review carries a model answer and an estimated score (26 Sep 2026,
  // by request). The score is an ESTIMATE against PTE's published traits, not
  // PTE's score - `traits` says which, and a trait that cannot be judged from
  // text (pronunciation) is listed in `unscored` rather than guessed.
  if (!review.model || typeof review.model.text !== 'string' || !review.model.text.trim()) {
    problems.push('model.text is missing: every review includes a model answer');
  }
  const sc = review.score;
  if (!sc || !Array.isArray(sc.traits) || !sc.traits.length) {
    problems.push('score.traits is missing: every review includes an estimated score per trait');
  } else {
    sc.traits.forEach((t, i) => {
      const ok = t && typeof t.trait === 'string' && Number.isFinite(t.got) && Number.isFinite(t.max) &&
                 t.max > 0 && t.got >= 0 && t.got <= t.max;
      if (!ok) problems.push(`score.traits[${i}] needs trait, and 0 <= got <= max`);
      else if (typeof t.note !== 'string' || !t.note.trim()) problems.push(`score.traits[${i}] "${t.trait}" needs a note saying why`);
    });
  }
  return problems;
}

/** Store (or replace) the review of one attempt, and rewrite its fault rows to match. */
export function saveReview(db, id, review) {
  const a = db.prepare('SELECT id FROM attempts WHERE id = ?').get(Number(id));
  if (!a) throw new Error(`no attempt ${id}`);
  const t = now();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT OR REPLACE INTO reviews (attempt_id, created, body) VALUES (?, ?, ?)')
      .run(a.id, t, JSON.stringify(review));
    db.prepare('DELETE FROM faults WHERE attempt_id = ?').run(a.id);
    const ins = db.prepare(`INSERT INTO faults (attempt_id, station, excerpt, fix, why, created)
                            VALUES (?, ?, ?, ?, ?, ?)`);
    for (const f of review.faults || []) {
      ins.run(a.id, f.station, str(f.excerpt, 1000), str(f.fix, 1000), str(f.why, 2000), t);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** How often each station has been failed, and when last. Feeds the map's colours. */
export function faultCounts(db) {
  const out = {};
  for (const r of db.prepare(`SELECT station, count(*) AS n, max(created) AS last
                              FROM faults GROUP BY station`).all()) {
    out[r.station] = { n: r.n, last: r.last };
  }
  return out;
}

/** The log for one station, newest first, with where each fault came from. */
export function faultsFor(db, station, limit = 200) {
  return db.prepare(`
    SELECT f.id, f.excerpt, f.fix, f.why, f.created, a.id AS attempt, a.task, a.title
    FROM faults f JOIN attempts a ON a.id = f.attempt_id
    WHERE f.station = ? ORDER BY f.id DESC LIMIT ?`).all(station, limit);
}

/** The latest faults across every station: the map's running log. */
export function faultsRecent(db, limit = 30) {
  return db.prepare(`
    SELECT f.id, f.station, f.excerpt, f.fix, f.why, f.created, a.id AS attempt, a.task, a.title
    FROM faults f JOIN attempts a ON a.id = f.attempt_id
    ORDER BY f.id DESC LIMIT ?`).all(limit);
}
