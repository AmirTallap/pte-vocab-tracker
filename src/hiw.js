import fs from 'node:fs';
import path from 'node:path';
import { HIW_DIR } from './config.js';

/**
 * Highlight Incorrect Words: hear a recording, and click the words in the
 * transcript that are not what was said.
 *
 * One JSON file per set of ten in data/hiw/, the rule every directory of
 * authored content lives under. Static, read once at startup, never written
 * back; the learner's tallies go to progress.json under `hiw` through the
 * shared tally code, like every other drilled subject.
 *
 * The data writes a swapped word as {{spoken|shown}} - what the recording
 * says, then what the transcript on screen says instead. Everything else is
 * the same in both. That one line of text is therefore both the script the
 * voice reads and the transcript the page draws, and the two cannot drift.
 *
 * **The page gets the transcript as shown and never which words are wrong.**
 * It has to be given the words - clicking them is the task - but the swapped
 * positions and what was really said stay here until the answer is sent. The
 * spoken text is only ever SOUND, from /api/hiw/<id>/audio.
 */

const SWAP = /\{\{([^|{}]+)\|([^|{}]+)\}\}/;

/**
 * One item, normalised, or a thrown error naming what is wrong with it.
 * Tokens are whitespace-separated and keep their punctuation, because that is
 * how a transcript is clicked - "rapidly," is one word on screen.
 */
function readItem(raw, setId, i, problems) {
  const where = `${setId} item ${i + 1}`;
  const text = String(raw && raw.text || '').trim();
  if (!text) throw new Error(`${where}: no text`);
  const id = String(raw.id || `${setId}-${i + 1}`);

  const shown = [], spoken = [], wrong = [];
  for (const chunk of text.split(/\s+/)) {
    const m = SWAP.exec(chunk);
    if (!m) {
      if (/[{}|]/.test(chunk)) throw new Error(`${where}: a broken marker in "${chunk}"`);
      shown.push(chunk); spoken.push(chunk);
      continue;
    }
    const said = m[1].trim(), seen = m[2].trim();
    if (!said || !seen || said.toLowerCase() === seen.toLowerCase()) {
      throw new Error(`${where}: "${chunk}" swaps a word for itself`);
    }
    wrong.push(shown.length);
    shown.push(chunk.replace(m[0], seen));
    spoken.push(chunk.replace(m[0], said));
  }

  if (wrong.length < 2) throw new Error(`${where}: fewer than two swapped words`);
  // Two swaps side by side read as one phrase changed, and the exam does not
  // set them that way.
  for (let k = 1; k < wrong.length; k++) {
    if (wrong[k] - wrong[k - 1] < 2) problems.push(`${where}: swaps at words ${wrong[k - 1] + 1} and ${wrong[k] + 1} are adjacent`);
  }
  if (shown.length < 40 || shown.length > 130) problems.push(`${where}: ${shown.length} words`);

  return {
    id,
    title: String(raw.title || '').trim(),
    note: String(raw.note || '').trim(),
    shown,
    script: spoken.join(' '),
    wrong,
    said: wrong.map((k) => spoken[k]),
  };
}

export function loadHiw(dir = HIW_DIR) {
  const problems = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return { sets: [], byItem: new Map(), problems: [] };
  }

  const sets = [];
  const byItem = new Map();
  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (err) {
      problems.push(`${file}: ${err.message}`);
      continue;
    }
    const id = raw && raw.id ? String(raw.id) : path.basename(file, '.json');
    if (sets.some((s) => s.id === id)) { problems.push(`${file}: duplicate set id "${id}"`); continue; }

    const items = [];
    for (const [i, it] of (Array.isArray(raw.items) ? raw.items : []).entries()) {
      let item;
      try {
        item = readItem(it, id, i, problems);
      } catch (err) {
        problems.push(err.message);
        continue;
      }
      if (byItem.has(item.id)) { problems.push(`${id}: item id "${item.id}" is already used`); continue; }
      byItem.set(item.id, { ...item, set: id });
      items.push(item);
    }
    if (!items.length) { problems.push(`${id}: no usable items`); continue; }
    sets.push({
      id,
      title: String(raw.title || id).trim(),
      summary: String(raw.summary || '').trim(),
      items,
    });
  }
  sets.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return { sets, byItem, problems };
}

/** The sets as the page may see them: the transcript as shown, no key. */
export function hiwIndex(sets) {
  return sets.map((s) => ({
    id: s.id,
    title: s.title,
    summary: s.summary,
    items: s.items.map((it) => ({ id: it.id, title: it.title, words: it.shown })),
  }));
}

/**
 * PTE's marking: +1 for each word clicked that really was different, -1 for
 * each word clicked that was not, never below zero. Clicking everything
 * therefore scores nothing, which is the point of the negative mark.
 */
export function gradeHiw(item, picked) {
  const wrong = new Set(item.wrong);
  const chosen = [...new Set((Array.isArray(picked) ? picked : [])
    .map(Number).filter((k) => Number.isInteger(k) && k >= 0 && k < item.shown.length))];
  const hits = chosen.filter((k) => wrong.has(k)).length;
  const misses = chosen.length - hits;
  return {
    score: Math.max(0, hits - misses),
    max: item.wrong.length,
    hits,
    misses,
    wrong: item.wrong,
    said: item.said,
    note: item.note,
  };
}
