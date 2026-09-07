import fs from 'node:fs';
import { BACKUP_FILE, SHEETS } from './config.js';
import { keyOf, load } from './loader.js';

/* ---- the reserve -------------------------------------------------------- */

/**
 * backup_words.json is the "unused reserve" from the brief: extra vocabulary
 * that is NOT yet in the workbook and gets promoted into it when the unknown
 * pool runs thin.
 *
 * It ships EMPTY, and that is not an oversight — the only vocabulary supplied
 * was the 267 words / 205 phrases already in the master file, and inventing
 * replacement words would put material in your study deck that nobody vetted.
 * Add entries to it yourself and `update` will draw them in automatically.
 */
export function loadReserve() {
  if (!fs.existsSync(BACKUP_FILE)) return { words: [], phrases: [] };
  const raw = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
  // Underscore keys are the file's own documentation. They are carried through
  // so writing the reserve back does not strip the instructions for filling it.
  const doc = Object.fromEntries(Object.entries(raw).filter(([k]) => k.startsWith('_')));
  return { ...doc, words: raw.words || [], phrases: raw.phrases || [] };
}

export function saveReserve(reserve) {
  fs.writeFileSync(BACKUP_FILE, JSON.stringify(reserve, null, 2) + '\n');
  return BACKUP_FILE;
}

/**
 * Move reserve entries into the deck so each unknown pool can still fill a full
 * daily batch. Anything already in the deck (by key) is dropped from the
 * reserve rather than added twice.
 */
export function topUp(deck, reserve) {
  const promoted = { words: [], phrases: [] };

  for (const [id, cfg] of Object.entries(SHEETS)) {
    const have = new Set((deck[id] || []).map((e) => e.key));
    const keep = [];

    for (const item of reserve[id] || []) {
      const key = keyOf(item.word ?? item.Word);
      if (!key || have.has(key)) continue;                 // duplicate: discard

      const unknown = deck[id].filter((e) => !e.known).length;
      if (unknown >= cfg.perDay) { keep.push(item); continue; }   // pool is full

      const entry = {
        key,
        word: String(item.word ?? item.Word).trim(),
        arabic: String(item.arabic ?? item['Arabic Translation'] ?? '').trim(),
        meaning: String(item.meaning ?? item['English Meaning'] ?? '').trim(),
        known: false,
      };
      deck[id].push(entry);
      have.add(key);
      promoted[id].push(entry.word);
    }
    reserve[id] = keep;
  }
  return promoted;
}

/* ---- merging an edited workbook ----------------------------------------- */

/**
 * Fold an externally edited workbook into the master deck.
 *
 * The incoming file is authoritative for the Known column — it is the file you
 * just marked up — so an entry can move both ways and an accidental TRUE is
 * correctable by setting it back to FALSE. Both directions are reported;
 * silently accepting a demotion is how a mastered word quietly re-enters the
 * rotation with no explanation.
 *
 * Entries present in the incoming file but not the master are ADDED (you typed
 * new vocabulary straight into Excel). Entries missing from the incoming file
 * are LEFT ALONE, never deleted — a partial or filtered export must not be able
 * to destroy the deck.
 */
export function merge(deck, incoming) {
  const report = { mastered: {}, unmarked: {}, added: {}, missing: {}, unchanged: {} };

  for (const id of Object.keys(SHEETS)) {
    const master = deck[id] || [];
    const byKey = new Map(master.map((e) => [e.key, e]));
    const seen = new Set();

    report.mastered[id] = [];
    report.unmarked[id] = [];
    report.added[id] = [];

    for (const inc of incoming[id] || []) {
      seen.add(inc.key);
      const cur = byKey.get(inc.key);

      if (!cur) {
        master.push({ ...inc });
        byKey.set(inc.key, master[master.length - 1]);
        report.added[id].push(inc.word);
        continue;
      }

      // Non-Known fields follow the incoming file when it actually has a value,
      // so a typo fixed in Excel survives, but a blank cell never wipes data.
      if (inc.arabic) cur.arabic = inc.arabic;
      if (inc.meaning) cur.meaning = inc.meaning;

      if (inc.known && !cur.known) { cur.known = true; report.mastered[id].push(cur.word); }
      else if (!inc.known && cur.known) { cur.known = false; report.unmarked[id].push(cur.word); }
    }

    report.missing[id] = master.filter((e) => !seen.has(e.key)).map((e) => e.word);
    report.unchanged[id] = master.length - report.added[id].length;
  }
  return report;
}

/** Read an edited workbook from disk, ready for merge(). */
export function readIncoming(file) {
  return load(file);
}
