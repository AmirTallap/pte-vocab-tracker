import { norm } from './speech.js';

/**
 * Pronunciation: the words a Read Aloud came out wrong on, kept to be worked
 * through one at a time until they come out clear.
 *
 * This is the ONE thing the Speaking tab keeps, and it keeps words, never
 * sound. The recording is still held for one request and written nowhere;
 * what survives it is "the script said X and the transcriber heard Y", which
 * is a fact about a word rather than a copy of a voice. It lives in
 * progress.json under `pronounce`, beside the other drilled subjects, and it
 * is written through scheduleProgressWrite() - never the workbook.
 *
 *   pronounce.words[key]  = { word, heard: [...], misses, tries, clear, first, last }
 *   pronounce.deleted[key] = true
 *
 * A deleted word stays deleted. The list is the learner's, and a word they
 * threw out - often one the transcriber misheard however it was said - coming
 * back after the next read would make Delete a button that does not work.
 *
 * Precision over recall, the Speaking tab's rule for anything that tells you
 * that you got something wrong. A take that went badly overall is an
 * alignment full of noise, and a two-letter word "misheard" is the
 * transcriber's slip far more often than the speaker's.
 */

const MIN_ACCURACY = 50;          // below this the alignment itself is unreliable
const MIN_LETTERS = 3;
const KEEP_HEARD = 5;             // the last few things it came out as

function store(progress) {
  progress.pronounce ||= {};
  const p = progress.pronounce;
  if (!p.words || typeof p.words !== 'object') p.words = {};
  if (!p.deleted || typeof p.deleted !== 'object') p.deleted = {};
  return p;
}

function worthKeeping(word) {
  return word.length >= MIN_LETTERS && /[a-z]/.test(word) && !/\d/.test(word);
}

/**
 * Add every misread word of one Read Aloud take. `read` is readDiff()'s
 * result. Returns the words added or bumped, for the report to mention.
 */
export function noteMisreads(progress, read) {
  if (!read || !Array.isArray(read.ops) || read.accuracy < MIN_ACCURACY) return [];
  const p = store(progress);
  const now = new Date().toISOString();
  const noted = [];
  for (const o of read.ops) {
    if (o.op !== 'misread') continue;
    const key = norm(o.want);
    if (!key || !worthKeeping(key) || p.deleted[key]) continue;
    const e = (p.words[key] ||= { word: key, heard: [], misses: 0, tries: 0, clear: 0, first: now });
    e.misses += 1;
    e.last = now;
    e.heard = [o.got, ...e.heard.filter((h) => h !== o.got)].slice(0, KEEP_HEARD);
    if (!noted.includes(key)) noted.push(key);
  }
  return noted;
}

/**
 * One practice attempt at one word from the list: was it heard as itself?
 * Counted against the word, never added - a practice take is not a Read
 * Aloud, and a word that is not on the list stays off it.
 */
export function notePractice(progress, word, read) {
  const p = store(progress);
  const key = norm(word);
  const clear = !!(read && read.ops.some((o) => o.op === 'ok' && o.want === key));
  const got = read ? read.ops.filter((o) => o.got).map((o) => o.got).join(' ') : '';
  const e = p.words[key];
  if (e) {
    e.tries += 1;
    if (clear) e.clear += 1;
    else if (got) e.heard = [got, ...e.heard.filter((h) => h !== got)].slice(0, KEEP_HEARD);
  }
  return { word: key, clear, heard: got, entry: e || null };
}

/** The list, most recently missed first. Deleted words are not in it. */
export function pronounceList(progress) {
  const p = store(progress);
  return Object.values(p.words)
    .filter((e) => !p.deleted[e.word])
    .sort((a, b) => String(b.last || '').localeCompare(String(a.last || '')));
}

/** Take a word off the list for good. */
export function deletePronounce(progress, word) {
  const p = store(progress);
  const key = norm(word);
  if (!key) return false;
  delete p.words[key];
  p.deleted[key] = true;
  return true;
}
