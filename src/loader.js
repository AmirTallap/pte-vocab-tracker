import fs from 'node:fs';
import XLSX from 'xlsx';
import { MASTER_FILE, SHEETS, HEADERS, LISTEN_LABEL } from './config.js';
import { translateUrl } from './links.js';

/**
 * Header matching is deliberately loose. The brief called the columns
 * "Word | Arabic | Meaning | Known(T/F)" while the real file says
 * "Word | Arabic Translation | English Meaning | Known (T/F)". Excel round-trips
 * also love to add stray spaces. Matching on a normalised substring means a
 * renamed-but-recognisable column still loads instead of silently reading null.
 */
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');

function findHeader(keys, candidates) {
  for (const c of candidates) {
    const hit = keys.find((k) => norm(k) === norm(c));
    if (hit) return hit;
  }
  for (const c of candidates) {
    const hit = keys.find((k) => norm(k).includes(norm(c)));
    if (hit) return hit;
  }
  return null;
}

const TRUEISH = new Set(['true', 't', 'yes', 'y', '1', 'known', 'x']);

export function parseKnown(v) {
  if (v === true) return true;
  if (v === false || v == null) return false;
  return TRUEISH.has(String(v).trim().toLowerCase());
}

// keyOf lives in shared.js - the browser store needs the same key rule, and
// this file imports node:fs and xlsx. Re-exported so importers are unaffected.
import { keyOf } from './shared.js';
export { keyOf };

/**
 * Read one sheet into normalised records.
 * Returns { entries, duplicates, skipped }.
 *
 * Duplicates are merged rather than dropped blindly: if ANY copy is marked
 * known, the surviving entry is known. Leaving a second copy at FALSE would put
 * a word you have already mastered back into tomorrow's batch.
 */
function readSheet(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found. Found: ${workbook.SheetNames.join(', ')}`);

  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  if (!rows.length) return { entries: [], duplicates: [], skipped: 0 };

  const keys = Object.keys(rows[0]);
  const hWord    = findHeader(keys, ['Word', 'Phrase', 'Term']);
  const hArabic  = findHeader(keys, ['Arabic Translation', 'Arabic']);
  const hMeaning = findHeader(keys, ['English Meaning', 'Meaning', 'Definition']);
  const hKnown   = findHeader(keys, ['Known (T/F)', 'Known', 'Mastered']);

  if (!hWord) throw new Error(`Sheet "${sheetName}": no Word column. Found: ${keys.join(' | ')}`);
  if (!hKnown) throw new Error(`Sheet "${sheetName}": no Known column. Found: ${keys.join(' | ')}`);

  const entries = [];
  const index = new Map();
  const duplicates = [];
  let skipped = 0;

  for (const row of rows) {
    const word = String(row[hWord] ?? '').trim();
    if (!word) { skipped++; continue; }

    const k = keyOf(word);
    const known = parseKnown(row[hKnown]);

    if (index.has(k)) {
      const existing = index.get(k);
      if (known) existing.known = true;      // merge, never lose a TRUE
      duplicates.push(word);
      continue;
    }

    const entry = {
      key: k,
      word,
      arabic: String(row[hArabic] ?? '').trim(),
      meaning: String(row[hMeaning] ?? '').trim(),
      known,
    };
    entries.push(entry);
    index.set(k, entry);
  }

  return { entries, duplicates, skipped };
}

/** Load the whole workbook into { words, phrases, meta }. */
export function load(file = MASTER_FILE) {
  if (!fs.existsSync(file)) {
    throw new Error(`Vocabulary file not found: ${file}`);
  }
  const wb = XLSX.readFile(file);
  const out = { meta: { file, duplicates: {}, skipped: {} } };

  for (const [id, cfg] of Object.entries(SHEETS)) {
    const { entries, duplicates, skipped } = readSheet(wb, cfg.sheet);
    out[id] = entries;
    out.meta.duplicates[id] = duplicates;
    out.meta.skipped[id] = skipped;
  }
  return out;
}

/**
 * Write the deck back to Excel with canonical headers and sheet names, so the
 * file you open in Excel is the same shape as the one you loaded.
 * Known is written as the literal strings TRUE/FALSE to match the source file.
 *
 * A fifth column, "Listen (EN>AR)", carries a real Excel hyperlink to Google
 * Translate for every entry you have NOT marked known — click it in Excel and
 * it opens the translate view with the audio button. It is a separate column
 * rather than a link on the Word cell on purpose: the Word cell is one you may
 * want to click to edit, and a hyperlinked cell launches a browser instead.
 * Known entries get a blank cell, so the column doubles as a visual marker of
 * what is still outstanding. Pass { linkAll: true } to link every row.
 */
export function save(deck, file = MASTER_FILE, { linkAll = false } = {}) {
  const wb = XLSX.utils.book_new();
  const header = [HEADERS.word, HEADERS.arabic, HEADERS.meaning, HEADERS.known, HEADERS.listen];

  for (const [id, cfg] of Object.entries(SHEETS)) {
    const entries = deck[id] || [];
    const rows = entries.map((e) => ({
      [HEADERS.word]:    e.word,
      [HEADERS.arabic]:  e.arabic,
      [HEADERS.meaning]: e.meaning,
      [HEADERS.known]:   e.known ? 'TRUE' : 'FALSE',
      [HEADERS.listen]:  (linkAll || !e.known) ? LISTEN_LABEL : '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows, { header });

    // Attach the hyperlink to the Listen cells. Row 1 is the header, so entry i
    // lives on sheet row i + 2.
    entries.forEach((e, i) => {
      if (!linkAll && e.known) return;
      const addr = XLSX.utils.encode_cell({ c: header.indexOf(HEADERS.listen), r: i + 1 });
      const cell = ws[addr];
      if (!cell) return;
      cell.l = { Target: translateUrl(e.word), Tooltip: `Play "${e.word}" on Google Translate` };
    });

    ws['!cols'] = [{ wch: 26 }, { wch: 26 }, { wch: 46 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, cfg.sheet);
  }

  XLSX.writeFile(wb, file);
  return file;
}

/** Timestamped copy beside the master, taken before any destructive write. */
export function backupMaster(file = MASTER_FILE) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = file.replace(/\.xlsx$/, `.backup-${stamp}.xlsx`);
  fs.copyFileSync(file, dest);
  return dest;
}
