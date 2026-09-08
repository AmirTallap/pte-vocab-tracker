// From shared.js, not config.js/tracker.js: this module's rules are the ones
// the browser store runs too, so its imports must stay free of node:fs.
import { SHEETS, today } from './shared.js';
import { shuffled } from './generator.js';

/**
 * Numbered study batches: standing sets of entries, one series per sheet, as
 * many in a set as you asked for when you drew it.
 *
 * These are NOT `progress.batches`, which is the date-keyed daily draw replayed
 * per calendar day. A study batch is a set you print once and come back to by
 * number.
 *
 * A batch is drawn once and never refilled. The set it was drawn with is the
 * set it will always be: `keys` holds the ones still to learn and `done` the
 * ones marked known, and every mark only moves a key from one list to the
 * other. When `keys` empties the batch is finished - that is the point of it,
 * and it is what lets the drill end with "nothing left in this batch" instead
 * of handing you a word you have never seen in the middle of a pass. More work
 * comes from drawing the next batch.
 *
 * How many it is drawn with is asked at the draw (9 Sep 2026); BATCH_SIZE is
 * only what that prompt opens on. A batch's own size is not stored anywhere -
 * it is `keys` plus `done`, which is what `batchPayload()` already sends as
 * `total`. So a batch of 50 and a batch of 20 need no field to tell them
 * apart, and a batch drawn before the prompt existed needs no migration.
 */

/** The default draw, and what the New batch prompt opens on. */
export const BATCH_SIZE = 20;

/**
 * What a requested batch size means. Anything that is not a whole number of at
 * least 1 is the default rather than an error: the number comes off a form, and
 * a blank box should draw the usual 20 rather than fail. There is no upper
 * bound here because the pool is one - `createBatch()` slices, so asking for
 * 500 draws whatever is actually left.
 */
export function batchSize(n) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v >= 1 ? v : BATCH_SIZE;
}

/** The per-sheet store, repaired in place if the file was hand-edited. */
function state(progress, id) {
  progress.studyBatches ||= {};
  const s = (progress.studyBatches[id] ||= { next: 1, list: [] });
  if (!Array.isArray(s.list)) s.list = [];
  for (const b of s.list) {
    if (!Array.isArray(b.keys)) b.keys = [];
    // What this batch has cleared: the keys that left it because they were
    // marked known. Not a second mastery store - the flag itself still lives
    // in the workbook and is read back from it. This is the other half of the
    // batch: `keys` plus `done` is the set that was drawn.
    if (!Array.isArray(b.done)) b.done = [];
    // Answers you got wrong while drilling this batch. A running total, not a
    // per-word tally: it stands until the batch is reset, which is the only
    // thing that clears it.
    if (!Number.isInteger(b.errors) || b.errors < 0) b.errors = 0;
  }
  // `next` never goes backwards, so a deleted batch's number is not handed out
  // again - a number on a printed sheet has to keep meaning one thing.
  const highest = s.list.reduce((m, b) => Math.max(m, b.n || 0), 0);
  if (!Number.isInteger(s.next) || s.next <= highest) s.next = highest + 1;
  return s;
}

/**
 * Every key that belongs to a batch of this sheet, cleared ones included: a
 * key drawn into batch 3 is batch 3's for good, so that unmarking it later
 * hands it back there rather than letting a newer batch have drawn it too.
 */
function committed(s, byKey) {
  const taken = new Set();
  for (const b of s.list) {
    for (const k of b.keys) if (byKey.has(k)) taken.add(k);
    for (const k of b.done) if (byKey.has(k)) taken.add(k);
  }
  return taken;
}

/**
 * The draw pool: unknown, not already in a batch, least-seen first and
 * shuffled inside each seen-count tier - the same rule the daily draw and the
 * browser queue use, so two batches drawn in a row are not the same words twice.
 */
function candidates(deck, progress, id, taken) {
  const seen = progress.seen[id] || {};
  const tiers = new Map();

  for (const e of deck[id] || []) {
    if (e.known || taken.has(e.key)) continue;
    const t = seen[e.key] || 0;
    if (!tiers.has(t)) tiers.set(t, []);
    tiers.get(t).push(e);
  }

  const out = [];
  for (const t of [...tiers.keys()].sort((a, b) => a - b)) {
    out.push(...shuffled(tiers.get(t), Math.random));
  }
  return out;
}

/** How many entries are left to draw a new batch from, for this sheet. */
export function remaining(deck, progress, id) {
  const s = state(progress, id);
  const byKey = new Map((deck[id] || []).map((e) => [e.key, e]));
  const taken = committed(s, byKey);
  return (deck[id] || []).filter((e) => !e.known && !taken.has(e.key)).length;
}

/**
 * Reconcile every batch with the workbook: entries now known move to `done`,
 * entries set back to FALSE come back out of it. Nothing is drawn in and
 * nothing is drawn out - the membership of a batch is fixed at the draw.
 *
 * Runs on every mark and on startup, so a flag flipped in Excel behind the
 * tool's back is reconciled the next time the server reads the workbook.
 *
 * Returns true if anything moved.
 */
export function syncBatches(deck, progress) {
  let changed = false;

  for (const id of Object.keys(SHEETS)) {
    const s = state(progress, id);
    if (!s.list.length) continue;

    const byKey = new Map((deck[id] || []).map((e) => [e.key, e]));

    for (const b of s.list) {
      // A key with no entry is a word deleted from the workbook. It leaves the
      // batch for good and is not remembered in `done`: a deleted row has
      // nothing to come back to, so that batch is simply one short forever.
      const keep = [];
      for (const k of b.keys) {
        const e = byKey.get(k);
        if (!e) { changed = true; continue; }
        if (!e.known) { keep.push(k); continue; }
        if (!b.done.includes(k)) b.done.push(k);
        changed = true;
      }
      b.keys = keep;

      // A word cleared from here and then set back to FALSE elsewhere - the
      // whole-progress reset, or a hand edit in Excel - is no longer cleared,
      // so it goes back into the batch it was drawn into.
      const stillDone = [];
      for (const k of b.done) {
        const e = byKey.get(k);
        if (!e) { changed = true; continue; }
        if (e.known) { stillDone.push(k); continue; }
        if (!b.keys.includes(k)) b.keys.push(k);
        changed = true;
      }
      b.done = stillDone;
    }
  }
  return changed;
}

/**
 * Draw a new batch: up to `size` unknown entries that no batch holds, the
 * default being BATCH_SIZE. Asking for more than there is draws what is left
 * rather than refusing - a short batch is still a batch, and the pool is the
 * only thing that could ever cap it.
 *
 * Returns the batch, or null when there is nothing left to draw at all.
 */
export function createBatch(deck, progress, id, size) {
  const s = state(progress, id);
  const byKey = new Map((deck[id] || []).map((e) => [e.key, e]));
  const pool = candidates(deck, progress, id, committed(s, byKey));
  if (!pool.length) return null;

  const batch = {
    n: s.next++,
    created: today(),
    keys: pool.slice(0, batchSize(size)).map((e) => e.key),
    done: [],
    errors: 0,
  };
  s.list.push(batch);
  return batch;
}

/** One wrong answer while drilling this batch. Returns the running total. */
export function noteError(progress, id, n) {
  const s = state(progress, id);
  const b = s.list.find((x) => x.n === n);
  if (!b) return null;
  b.errors += 1;
  return b.errors;
}

/**
 * Put one batch back to the day it was drawn: everything it cleared returns to
 * it with Known=FALSE, every seen count in it goes to 0, and the error count
 * goes to 0. What is left is the words, in the set they were drawn as.
 *
 * It used to take a scope - seen counts and Known flags separately - on the
 * reasoning that re-drilling in a fresh order is a different intention from
 * taking back what you marked known. In use that turned out to be a menu in
 * front of a thing nobody wanted to think about: reset means start this batch
 * again. One button, everything.
 *
 * Returns a summary, or null when there is no such batch.
 */
export function resetBatch(deck, progress, id, n) {
  const s = state(progress, id);
  const b = s.list.find((x) => x.n === n);
  if (!b) return null;

  const byKey = new Map((deck[id] || []).map((e) => [e.key, e]));
  let restored = 0;

  for (const k of b.done.filter((k2) => byKey.has(k2))) {
    const e = byKey.get(k);
    if (e.known) { e.known = false; restored += 1; }
    if (!b.keys.includes(k)) b.keys.push(k);
  }
  b.done = [];

  let cleared = 0;
  const seen = (progress.seen[id] ||= {});
  for (const k of b.keys) {
    if (seen[k]) cleared += 1;
    delete seen[k];
  }

  const errors = b.errors;
  b.errors = 0;

  return { restored, cleared, errors, size: b.keys.length };
}

/** Remove a batch; everything it held goes back to the pool to be drawn again. */
export function deleteBatch(deck, progress, id, n) {
  const s = state(progress, id);
  const i = s.list.findIndex((b) => b.n === n);
  if (i < 0) return false;
  s.list.splice(i, 1);
  return true;
}

/** Batches as the browser needs them: numbered, in order, as full entry ids. */
export function batchPayload(deck, progress) {
  const out = {};
  for (const id of Object.keys(SHEETS)) {
    const s = state(progress, id);
    const byKey = new Map((deck[id] || []).map((e) => [e.key, e]));
    out[id] = {
      // The default draw, not the size of any batch in this list: sizes are
      // per batch now, and each one's is its own `total`.
      size: BATCH_SIZE,
      remaining: remaining(deck, progress, id),
      list: [...s.list].sort((a, b) => a.n - b.n).map((b) => {
        const ids = b.keys.filter((k) => byKey.has(k));
        // The ones it has cleared, as ids. Sent because a retake drills the
        // whole set as drawn - what you have learnt included - and the page
        // cannot reconstruct that from `ids` alone.
        const doneIds = b.done.filter((k) => byKey.has(k));
        return {
          n: b.n,
          created: b.created || null,
          errors: b.errors || 0,
          // How many this batch has already cleared - what a reset would hand
          // back to it, and what a retake adds to the pass.
          cleared: doneIds.length,
          // The set as drawn, less any row since deleted from the workbook:
          // what "3 of 20 left" counts against, and the only record of how big
          // this batch was asked for.
          total: ids.length + doneIds.length,
          ids: ids.map((k) => `${id}:${k}`),
          doneIds: doneIds.map((k) => `${id}:${k}`),
        };
      }),
    };
  }
  return out;
}
