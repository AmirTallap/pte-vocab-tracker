import { SHEETS } from './config.js';
import { today } from './tracker.js';

/* ---- deterministic RNG -------------------------------------------------- */
/* The batch must be the SAME every time you run `daily` on a given day.
 * Random-on-every-call would hand you a different 50 words each time you
 * reopened the terminal, which is not a study plan. Seeded by date + sheet. */

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFor(seed) {
  return mulberry32(xmur3(String(seed))());
}

export function shuffled(list, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---- selection ---------------------------------------------------------- */

/**
 * Pick `count` unknown entries: least-seen first, shuffled within each
 * seen-count tier.
 *
 * Pure random over the unknown pool would let a word go unseen for weeks by
 * chance, which defeats the "every word seen once by week 4" goal.
 * Least-seen-first guarantees full coverage in ceil(pool / perDay) days — six
 * days for the 267 words — while the shuffle inside a tier keeps the order
 * varied so you are not revising in the same sequence every cycle.
 */
export function pick(entries, count, rand) {
  const pool = entries.filter((e) => !e.known);
  const tiers = new Map();
  for (const e of pool) {
    const t = e.seenCount || 0;
    if (!tiers.has(t)) tiers.set(t, []);
    tiers.get(t).push(e);
  }
  const out = [];
  for (const tier of [...tiers.keys()].sort((a, b) => a - b)) {
    if (out.length >= count) break;
    out.push(...shuffled(tiers.get(tier), rand).slice(0, count - out.length));
  }
  return out;
}

/** Attach each entry's historical seen-count from progress. */
function withSeen(entries, seen) {
  return entries.map((e) => ({ ...e, seenCount: seen[e.key] || 0 }));
}

/**
 * Build (or re-read) the batch for a date.
 *
 * A batch already recorded for that date is REPLAYED from progress.json rather
 * than regenerated, so re-running `daily` shows the same list even after you
 * have marked part of it known. Pass { regenerate: true } to force a fresh draw.
 */
export function dailyBatch(deck, progress, { date = today(), regenerate = false } = {}) {
  const existing = progress.batches[date];
  const batch = { date, replayed: false, short: {} };

  for (const [id, cfg] of Object.entries(SHEETS)) {
    const entries = deck[id] || [];
    const byKey = new Map(entries.map((e) => [e.key, e]));

    if (existing && !regenerate && Array.isArray(existing[id])) {
      batch[id] = existing[id].map((k) => byKey.get(k)).filter(Boolean);
      batch.replayed = true;
    } else {
      const rand = rngFor(`${date}:${id}`);
      batch[id] = pick(withSeen(entries, progress.seen[id] || {}), cfg.perDay, rand);
    }

    // A short batch means the unknown pool is smaller than the daily target.
    // Reported, never silently padded with words you already know.
    batch.short[id] = Math.max(cfg.perDay - batch[id].length, 0);
  }
  return batch;
}

/** Persist the batch and bump each entry's seen-count. Idempotent per date. */
export function recordBatch(progress, batch) {
  if (progress.batches[batch.date]) return progress;   // already counted today

  progress.batches[batch.date] = {};
  for (const id of Object.keys(SHEETS)) {
    progress.batches[batch.date][id] = batch[id].map((e) => e.key);
    progress.seen[id] ||= {};
    for (const e of batch[id]) {
      progress.seen[id][e.key] = (progress.seen[id][e.key] || 0) + 1;
    }
  }
  progress.cycleStart ||= batch.date;
  return progress;
}
