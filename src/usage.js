import fs from 'node:fs';
import path from 'node:path';
import { USAGE_DIR, SHEETS } from './config.js';
import { keyOf } from './loader.js';

/**
 * Example sentences: how each word or phrase is actually used, shown under the
 * answer once a card has been revealed.
 *
 * One file per sheet in data/usage/ - words.json, phrases.json - keyed by the
 * same `keyOf()` the workbook is keyed by, so a sentence set follows its entry
 * however the row is capitalised or re-typed in Excel.
 *
 * Static content, like the grammar syllabus and for the same reason: it is read
 * once at startup and NEVER written back. The workbook stays the single source
 * of truth for the Known flag and has no column for this; progress.json holds
 * study history and has no place for it either. An entry with no file entry
 * simply shows no examples - there is nothing to reconcile and nothing to
 * migrate, so adding sentences later is a one-file edit.
 *
 * Inside a sentence, [[...]] wraps the form of the word actually used. It is
 * marked in the data rather than matched in the browser on purpose: the used
 * form is often not the headword ("pervades" appears as [[pervaded]], "spur" as
 * [[spurred]]), and a client-side regex over a multi-word phrase would either
 * miss those or bold the wrong half of the sentence.
 */
export function loadUsage(dir = USAGE_DIR) {
  const usage = {};
  const problems = [];

  for (const id of Object.keys(SHEETS)) {
    usage[id] = {};
    const file = path.join(dir, `${id}.json`);
    if (!fs.existsSync(file)) continue;      // a sheet with no sentences yet

    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      problems.push(`${id}.json: ${err.message}`);
      continue;
    }

    for (const [word, list] of Object.entries(raw)) {
      const sentences = (Array.isArray(list) ? list : [list])
        .filter((s) => typeof s === 'string' && s.trim())
        .map((s) => s.trim());
      if (!sentences.length) {
        problems.push(`${id}.json: "${word}" has no sentences`);
        continue;
      }
      usage[id][keyOf(word)] = sentences;
    }
  }

  return { usage, problems };
}

/** How many entries and sentences were loaded, for the startup line. */
export function usageCounts(usage) {
  let entries = 0;
  let sentences = 0;
  for (const id of Object.keys(usage)) {
    for (const list of Object.values(usage[id])) { entries += 1; sentences += list.length; }
  }
  return { entries, sentences };
}
