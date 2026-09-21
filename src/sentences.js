import fs from 'node:fs';
import path from 'node:path';
import { SENTENCES_DIR } from './config.js';

/**
 * Repeat Sentence: hear a sentence once, say it back exactly.
 *
 * It is Read Aloud with the script HEARD instead of shown, which is why the
 * page builds it as a fourth Speaking task rather than a tab of its own: the
 * recorder, the clock, the transcript, the word-by-word comparison against
 * the script and the click-to-hear playback are all already there, and a
 * second copy of any of them is how the two would drift apart.
 *
 * PTE scores this item under BOTH Speaking and Listening, so a listening
 * drill living on the Speaking tab is the exam's own arrangement rather than
 * a compromise.
 *
 * What makes it hard is not vocabulary, it is working memory: the sentence is
 * played once and you have to hold all of it. That is why the sets are banded
 * by LENGTH rather than by subject - getting seven words exact is a different
 * exercise from getting fifteen, and the way to improve is to move up the
 * bands rather than to keep failing the long ones.
 *
 * One JSON file per set in data/sentences/, the rule every directory of
 * authored content here lives under. Static, read once at startup, never
 * written back.
 *
 * **The text never reaches the browser before the attempt.** The index
 * carries ids and word counts; the sentence is delivered as SOUND from
 * /api/sentences/<id>/audio; and the words themselves are resolved
 * server-side when the recording is analysed - the page asks for
 * `?sentence=<id>` rather than sending a script it was trusted with. Reading
 * it beforehand would not make the task easier, it would make it a different
 * task.
 */

/* Presentation order: shortest first, because that is the order they should
 * be worked in. A set on disk that is not listed still loads, sorting last. */
const ORDER = ['short', 'medium', 'long', 'academic', 'figures'];

const words = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;

export function loadSentences(dir = SENTENCES_DIR) {
  const problems = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return { sets: [], byId: new Map(), problems: [] };
  }

  const sets = [];
  const byId = new Map();
  const seenSets = new Set();

  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (err) {
      problems.push(`${file}: ${err.message}`);
      continue;
    }
    const id = raw && raw.id ? String(raw.id) : path.basename(file, '.json');
    if (seenSets.has(id)) { problems.push(`${file}: duplicate set id "${id}"`); continue; }
    seenSets.add(id);

    const list = [];
    for (const [i, s] of (Array.isArray(raw.sentences) ? raw.sentences : []).entries()) {
      const text = String(s && s.text || '').trim();
      if (!text) { problems.push(`${id} #${i + 1}: no text`); continue; }
      const sid = String(s && s.id || `${id}-${i + 1}`);
      // Unique across ALL sets: the audio route is keyed on the sentence
      // alone, so two sharing an id would play each other's sentence.
      if (byId.has(sid)) { problems.push(`${id}: sentence id "${sid}" is already used`); continue; }

      const n = words(text);
      // Reported, never repaired - the word band rule the rest of this
      // project follows. PTE's own sentences run about 3 to 9 seconds, which
      // is roughly 6 to 18 words; far outside that is teaching the wrong
      // thing and the fix is to rewrite that one, by name.
      if (n < 5 || n > 20) problems.push(`${sid}: ${n} words, outside 5-20`);

      const item = { id: sid, text, words: n, set: id };
      byId.set(sid, item);
      list.push(item);
    }

    if (!list.length) { problems.push(`${id}: no usable sentences`); continue; }

    sets.push({
      id,
      title: String(raw.title || id).trim(),
      summary: String(raw.summary || '').trim(),
      sentences: list,
    });
  }

  sets.sort((a, b) => {
    const ai = ORDER.indexOf(a.id), bi = ORDER.indexOf(b.id);
    if (ai !== bi) return (ai < 0 ? ORDER.length : ai) - (bi < 0 ? ORDER.length : bi);
    return a.id.localeCompare(b.id);
  });

  return { sets, byId, problems };
}

/**
 * The index: sets, and each sentence's id and LENGTH. Not the words.
 *
 * The length is sent on purpose and is not a leak: the exam tells you how
 * long the sentence was the moment you hear it, and the page needs it to size
 * the recording window - a seven-word sentence should not be given the
 * fifteen seconds a long one needs.
 */
export function sentenceIndex(sets) {
  return sets.map((s) => ({
    id: s.id,
    title: s.title,
    summary: s.summary,
    sentences: s.sentences.map((x) => ({ id: x.id, words: x.words })),
  }));
}
