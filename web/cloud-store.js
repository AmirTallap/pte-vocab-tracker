/**
 * The cloud build's store: the same study rules, run in the browser, against
 * localStorage instead of a workbook.
 *
 * WHY THERE IS NO ACCOUNT. Nobody is handing over an email address to practise
 * vocabulary, so there is no sign-in, no database and no server-side state at
 * all. A visitor's progress is theirs, on their machine, in their browser. The
 * consequence to be honest about: it does not follow them to another device,
 * and clearing site data clears it. That is the trade, and it is the right way
 * round for a study tool nobody should have to register for.
 *
 * WHY IT IS NOT A SECOND COPY OF THE RULES. Every decision worth getting wrong
 * lives in src/batches.js and is imported here, not reimplemented: batches are
 * drawn least-seen-first, a batch is drawn once and never refilled, `keys` and
 * `done` are the two halves of the same twenty, a reset hands the set back as
 * drawn. What this file adds is the glue those functions sat behind in
 * src/server.js - a few lines per route - and the storage underneath them.
 * If a rule needs changing, it changes in batches.js and both hosts move
 * together.
 *
 * WHAT REPLACES THE WORKBOOK. Locally, data/PTE_Vocabulary_Master.xlsx is the
 * single source of truth for `Known` and progress.json holds everything else.
 * There is no workbook here, so `known` becomes one more map in the same saved
 * object - keyed by the loader's own keyOf(), exactly as `seen` and `flags`
 * already are. The deck itself is static: deck.json ships with known:false on
 * every row, because a visitor arriving for the first time has not learnt
 * anything yet.
 *
 * WHAT STILL NEEDS A SERVER. Grammar answers. /api/grammar ships stripped of
 * `answer`, `accept` and `explain` - the marking is a round trip to the Worker
 * so the page cannot be read for the answers. That rule is the whole reason a
 * Worker exists in this build at all.
 */
import { SHEETS, EMPTY_PROGRESS, today, stats, keyOf, grammarState, recordAnswer, grammarProgress } from './shared.js';
import {
  BATCH_SIZE, syncBatches, createBatch, deleteBatch, resetBatch, noteError, batchPayload,
} from './batches.js';

/* Bumped with src/server.js's. The page refuses to write to a host whose
   number does not match, and that guard is worth keeping here even though this
   host cannot misread a request: a stale service-worker copy of the page
   against fresh static data is the same failure wearing a different hat. */
const API_VERSION = 8;

/* Kept apart from "pte-vocab-view", which holds the view settings and always
   has. This is study state; that is which column you dragged where. One key
   holding both would mean a cleared filter and a cleared batch are the same
   accident. */
const STORE_KEY = 'pte-vocab-progress';

let deck = null;      // { words: [entry], phrases: [entry] } - live, with .known
let progress = null;  // the progress.json shape, plus `known`
let index = null;     // "sheet:key" -> entry

/* ----------------------------------------------------------------- storage */

function blank() {
  const p = structuredClone(EMPTY_PROGRESS);
  // The one field the local tool keeps in the workbook instead.
  p.known = { words: {}, phrases: {} };
  return p;
}

function read() {
  let raw = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch { /* private mode, blocked storage */ }
  if (!raw) return blank();
  try {
    const saved = JSON.parse(raw);
    const p = { ...blank(), ...saved };
    // Each map merged onto the empty one: a store written before a field
    // existed still opens, which is the same tolerance loadProgress() has.
    for (const f of ['seen', 'flags', 'known']) p[f] = { words: {}, phrases: {}, ...(saved[f] || {}) };
    p.studyBatches = saved.studyBatches || {};
    p.grammar = saved.grammar || {};
    return p;
  } catch {
    // Unparseable is not worth wiping someone's work over silently, but there
    // is nothing else to do with it either. Start clean and say so.
    console.warn('saved progress could not be read; starting fresh');
    return blank();
  }
}

/**
 * Written straight through on every change, with no debounce.
 *
 * The local server debounces the workbook by 800ms because each write is a
 * 275KB rewrite of an .xlsx, and writes progress.json immediately because it
 * is 1KB and a batch number must never sit in memory. Here everything is the
 * 1KB case: localStorage is synchronous and small, so there is nothing to
 * defer and no shutdown to flush on. The signal handlers that exist in
 * src/server.js for exactly that reason have no equivalent here and need none.
 */
function save() {
  // `known` is the deck's, and the deck is what the rules mutate - so it is
  // collected from the entries rather than tracked alongside them, which is
  // what keeps the two from disagreeing.
  for (const id of Object.keys(SHEETS)) {
    const map = {};
    for (const e of deck[id]) if (e.known) map[e.key] = true;
    progress.known[id] = map;
  }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(progress));
  } catch (err) {
    // Quota, or storage blocked entirely. Say it once, out loud: silently
    // losing what someone just marked is the worst thing this file could do.
    console.error('could not save progress:', err && err.message);
    throw new Error('Your browser would not save this progress - check that site data is allowed.');
  }
}

/* -------------------------------------------------------------------- boot */

const getJSON = (path) => fetch(path).then((r) => {
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
});

async function boot() {
  const base = await getJSON('/static/deck.json');
  progress = read();

  deck = {};
  index = new Map();
  for (const id of Object.keys(SHEETS)) {
    // Shipped rows first, then the visitor's own. A word someone added is a
    // row of the deck like any other from here on - the same way the local
    // tool appends it to the sheet rather than keeping a list of "words I
    // added" to reconcile.
    const rows = [...(base.decks[id] || []), ...((progress.added || {})[id] || [])];
    deck[id] = [];
    for (const row of rows) {
      const key = row.key || keyOf(row.word);
      if (index.has(`${id}:${key}`)) continue;   // an added word that later shipped
      // deck.json ships known:false for everyone; the visitor's own marks are
      // what turn any of them true.
      const e = { key, word: row.word, arabic: row.arabic, meaning: row.meaning,
                  known: !!progress.known[id][key] };
      index.set(`${id}:${key}`, e);
      deck[id].push(e);
    }
  }

  // A batch may name a key the deck no longer has, or hold one the visitor has
  // since marked known in the word list. Same call the server makes on load.
  syncBatches(deck, progress);
}

/* ----------------------------------------------------------------- payload */

/* Deliberately the same object src/server.js's payload() builds, field for
   field, so web/app.html cannot tell which host answered it. `file` is what
   the local page prints as "writing to ..."; here it names the store instead. */
function payload() {
  const out = { api: API_VERSION, decks: {}, stats: null, file: 'your browser', lastWrite: null };
  for (const [id, cfg] of Object.entries(SHEETS)) {
    out.decks[id] = deck[id].map((e) => ({
      id: `${id}:${e.key}`,
      word: e.word,
      arabic: e.arabic,
      meaning: e.meaning,
      known: e.known,
      seen: (progress.seen[id] || {})[e.key] || 0,
      flagged: !!(progress.flags[id] || {})[e.key],
      label: cfg.sheet,
    }));
  }
  const s = stats(deck, progress);
  out.stats = { examDate: s.examDate, daysToExam: s.daysToExam, per: s.per };
  out.batches = batchPayload(deck, progress);
  out.batchSize = BATCH_SIZE;
  return out;
}

const split = (id) => [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];

/* ------------------------------------------------------------------ routes */

/* One entry per route, matching src/server.js's handler for it. The bodies are
   the glue only - every rule they lean on comes from batches.js. */
const POST = {
  '/api/mark'({ id, known, seen }) {
    const entry = index.get(id);
    if (!entry) throw new Error(`unknown entry: ${id}`);
    entry.known = !!known;

    if (seen) {
      const [sheet, key] = split(id);
      progress.seen[sheet] ||= {};
      progress.seen[sheet][key] = (progress.seen[sheet][key] || 0) + 1;
    }
    progress.cycleStart ||= today();

    syncBatches(deck, progress);
    save();
    const s = stats(deck, progress);
    return { ok: true, per: s.per, batches: batchPayload(deck, progress) };
  },

  '/api/flag'({ id, flagged }) {
    if (!index.has(id)) throw new Error(`unknown entry: ${id}`);
    const [sheet, key] = split(id);
    progress.flags[sheet] ||= {};
    // Deleted, not set false - the store is a list of what is flagged.
    if (flagged) progress.flags[sheet][key] = true;
    else delete progress.flags[sheet][key];
    save();
    return { ok: true, flagged: !!progress.flags[sheet][key],
             count: Object.keys(progress.flags[sheet]).length };
  },

  '/api/entry/new'({ kind, word, arabic, meaning }) {
    if (!SHEETS[kind]) throw new Error(`unknown deck: ${kind}`);
    const text = String(word ?? '').trim();
    if (!text) throw new Error('Type the word or phrase first.');

    const key = keyOf(text);
    const id = `${kind}:${key}`;
    if (index.has(id)) throw new Error(`"${index.get(id).word}" is already in ${SHEETS[kind].sheet}.`);

    const entry = { key, word: text, arabic: String(arabic ?? '').trim(),
                    meaning: String(meaning ?? '').trim(), known: false };
    deck[kind].push(entry);
    index.set(id, entry);
    // A word added here is this visitor's, and lives in their store alongside
    // their marks - deck.json is shipped content and is never written to.
    progress.added ||= { words: [], phrases: [] };
    progress.added[kind].push({ key, word: entry.word, arabic: entry.arabic, meaning: entry.meaning });
    save();
    return { ok: true, id, ...payload() };
  },

  '/api/batch/new'({ kind }) {
    if (!SHEETS[kind]) throw new Error(`unknown deck: ${kind}`);
    const batch = createBatch(deck, progress, kind);
    if (!batch) {
      throw new Error(`Nothing left to draw - every ${SHEETS[kind].label.replace(/s$/, '')} ` +
                      'you have not marked known is already in a batch.');
    }
    save();
    return { ok: true, n: batch.n, batches: batchPayload(deck, progress) };
  },

  '/api/batch/delete'({ kind, n }) {
    if (!SHEETS[kind]) throw new Error(`unknown deck: ${kind}`);
    if (!deleteBatch(deck, progress, kind, Number(n))) throw new Error(`no batch ${n} in ${kind}`);
    save();
    return { ok: true, batches: batchPayload(deck, progress) };
  },

  '/api/batch/error'({ kind, n }) {
    if (!SHEETS[kind]) throw new Error(`unknown deck: ${kind}`);
    const errors = noteError(progress, kind, Number(n));
    if (errors === null) throw new Error(`no batch ${n} in ${kind}`);
    save();
    return { ok: true, errors };
  },

  '/api/batch/reset'({ kind, n }) {
    if (!SHEETS[kind]) throw new Error(`unknown deck: ${kind}`);
    const summary = resetBatch(deck, progress, kind, Number(n));
    if (!summary) throw new Error(`no batch ${n} in ${kind}`);
    save();
    return { ok: true, ...summary, ...payload() };
  },

  '/api/reset'({ scope }) {
    // Listed, not defaulted into. 'flags' falling through to 'both' is what
    // wiped the workbook once, and it stays impossible here for the same
    // reason it is impossible there.
    const what = ['seen', 'known', 'flags', 'both'].includes(scope) ? scope : 'both';
    let known = 0; let seen = 0; let flags = 0;

    if (what === 'flags') {
      for (const id of Object.keys(SHEETS)) {
        flags += Object.keys(progress.flags[id] || {}).length;
        progress.flags[id] = {};
      }
      save();
      return { ok: true, scope: what, known, seen, flags, ...payload() };
    }

    for (const id of Object.keys(SHEETS)) {
      if (what !== 'seen') for (const e of deck[id]) if (e.known) { e.known = false; known += 1; }
      if (what !== 'known') { seen += Object.keys(progress.seen[id] || {}).length; progress.seen[id] = {}; }
    }
    syncBatches(deck, progress);
    save();
    return { ok: true, scope: what, known, seen, flags, ...payload() };
  },

  '/api/grammar/reset'({ module: moduleId }) {
    const m = grammarState(progress, moduleId);
    m.answers = {};
    m.lastAt = null;
    save();
    return { ok: true, progress: grammarProgress(progress) };
  },
};

/* -------------------------------------------------------------------- api */

/* The static content the local server reads off disk. Fetched once and held:
   /api/usage and /api/grammar are asked for at boot, and the essays are asked
   for every time that tab is opened. */
const cache = new Map();
function statics(path) {
  if (!cache.has(path)) cache.set(path, getJSON(path));
  return cache.get(path);
}

/**
 * Stands in for web/app.html's api(). Same contract: a promise of the parsed
 * body, rejecting with the message the local server would have put in `error`.
 */
async function api(path, body) {
  if (body) {
    const handler = POST[path];
    if (handler) return handler(body);

    if (path === '/api/grammar/answer') {
      // The one round trip left. The verdict is the Worker's because the
      // answers are the Worker's; the tally is kept here, because it is study
      // state and study state does not leave this browser.
      const r = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error || r.statusText);
      const tally = recordAnswer(progress, body.module, body.q, out.correct);
      save();
      return { ...out, tally };
    }
    throw new Error(`no local handler for ${path}`);
  }

  if (path === '/api/deck') return payload();
  if (path === '/api/usage') return statics('/static/usage.json');
  if (path === '/api/essays') return statics('/static/essays.json');
  if (path.startsWith('/api/essays/models/')) {
    const id = decodeURIComponent(path.slice('/api/essays/models/'.length));
    return statics(`/static/models/${encodeURIComponent(id)}.json`);
  }
  if (path === '/api/grammar') {
    const g = await statics('/static/grammar.json');
    // The content is shipped; the answers to it are this browser's.
    return { ...g, progress: grammarProgress(progress) };
  }
  throw new Error(`no local handler for ${path}`);
}

/* ------------------------------------------------------------------ speech */

/* Pre-rendered by tools/render-audio.js and served as ordinary files. The
   local build renders on demand through a 326MB model, which costs ~2.5s the
   first time a word is spoken and is the entire reason app.html prefetches the
   card ahead. Off the edge there is nothing to hide, so the prefetch simply
   warms the HTTP cache instead. */
let audio = { voices: {} };

function sayUrl(text, voice) {
  // Fall back to whichever voice was rendered rather than to nothing: a
  // setting saved before this build shipped names a voice with no audio.
  const id = audio.voices[voice] ? voice : Object.keys(audio.voices)[0];
  const file = id && audio.voices[id][keyOf(text)];
  // Null rather than a guessed path: a missing clip should do nothing, not
  // fetch a 404 and light up the console on every card.
  return file ? `/audio/${id}/${file}` : null;
}

/* --------------------------------------------------------------------- go */

const ready = boot().then(async () => {
  try { audio = await getJSON('/audio/manifest.json'); } catch { /* no audio shipped */ }
  return true;
});

// app.html parked its boot() here rather than running it, because this module
// is deferred past that script. Start the page now that there is a store.
ready.then(() => window.PTE_BOOT && window.PTE_BOOT())
  .catch((err) => {
    document.getElementById('stimulus').innerHTML =
      `<div class="empty"><p class="big">Could not load the deck.</p><p class="hint">${err.message}</p></div>`;
  });

window.PTE_CLOUD = {
  api,
  sayUrl,
  ready,
  /** Only the voices that were actually rendered can be offered. */
  voices: () => Object.keys(audio.voices),
  /** Speed is baked into a rendering, so the cloud build cannot offer it. */
  fixedSpeed: true,
};
