import fs from 'node:fs';
import path from 'node:path';
import { LISTENING_DIR } from './config.js';

/**
 * Listening: hear a definition, type the word.
 *
 * A clue is spoken aloud - "a doctor uses this instrument to listen to your
 * heart and lungs" - and you type one word. It drills the two things the exam
 * actually tests together and this tool tested separately until now: hearing a
 * sentence you cannot re-read, and producing a precise word rather than
 * recognising one. The vocabulary drill shows you the word; this one never
 * does until you have answered.
 *
 * One JSON file per SET in data/listening/, the rule every directory of
 * authored content here lives under, and for the reason CLAUDE.md gives at
 * the grammar modules: a bulk script over one of these corrupted sixteen of
 * them at a stroke. Edit one file, by name.
 *
 * Static content, read once at startup and NEVER written back. What IS
 * written is the learner's answers, into progress.json under `listening`, as
 * right/wrong counts per question - the same shape the grammar syllabus uses
 * and, since the tally rule now lives once in src/shared.js, literally the
 * same code. This is not a second mastery store: the workbook owns the Known
 * flag and has no column for any of this.
 *
 * **The clue text and the answers never reach the browser un-asked.** The
 * index carries ids and counts and nothing else, `/api/listening/<id>/audio`
 * serves the clue as sound, and the words themselves come back only in the
 * verdict for the question you just answered. That is the grammar tab's rule
 * - the page cannot be read for the answers - and here it matters twice over,
 * because being able to read the clue would remove the listening entirely.
 */

/* Presentation order. A set on disk that is not listed here still loads; it
 * just sorts to the end, so adding one is a one-file operation. */
const ORDER = [
  'medicine-and-the-body',
  'tools-and-instruments',
  'weather-and-the-earth',
  'people-and-their-work',
  'feelings-and-character',
  'time-and-quantity',
  'places-and-buildings',
  'language-and-writing',
  'money-and-business',
  'science-and-measurement',
];

/**
 * One question, normalised, or a thrown error naming what is wrong with it.
 *
 * `accept` always ends up containing `answer`. A missing variant marks a
 * correct answer wrong, which CLAUDE.md calls the worst failure this tool
 * has, and the canonical answer going unaccepted through a typo in the array
 * would be that failure in its purest form. Variants beyond it are the data's
 * job: both spellings, and any word that genuinely answers the clue.
 */
function readQuestion(raw, setId, i) {
  const where = `${setId} q${i + 1}`;
  if (!raw || typeof raw.clue !== 'string' || !raw.clue.trim()) {
    throw new Error(`${where}: no clue`);
  }
  const answer = String(raw.answer || '').trim();
  if (!answer) throw new Error(`${where}: no answer`);

  // One word is the whole exercise. A hyphen is still one word; a space is a
  // different task and would be marked against a rule the clue never set.
  if (/\s/.test(answer)) throw new Error(`${where}: "${answer}" is more than one word`);

  const accept = [answer, ...(Array.isArray(raw.accept) ? raw.accept : [])]
    .map((a) => String(a).trim())
    .filter(Boolean);
  // De-duplicated case-insensitively, so a list that says both "Mint" and
  // "mint" does not look like two variants when it is one.
  const seen = new Set();
  const unique = accept.filter((a) => {
    const k = a.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    id: String(raw.id || `${setId}-${i + 1}`),
    clue: raw.clue.trim(),
    answer,
    accept: unique,
    // Why that word, or what else it nearly was. Shown with the verdict, the
    // way the grammar tab shows its explanation, because being told you are
    // wrong without being told what would have been right teaches nothing.
    note: String(raw.note || '').trim(),
  };
}

export function loadListening(dir = LISTENING_DIR) {
  const problems = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    // Not an error: the directory arrives with whoever writes the first set.
    return { sets: [], byQuestion: new Map(), problems: [] };
  }

  const sets = [];
  const byQuestion = new Map();
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

    const questions = [];
    for (const [i, q] of (Array.isArray(raw.questions) ? raw.questions : []).entries()) {
      let question;
      try {
        question = readQuestion(q, id, i);
      } catch (err) {
        problems.push(err.message);
        continue;
      }
      // Question ids have to be unique across ALL sets, because the audio
      // route is keyed on the question alone - /api/listening/<id>/audio -
      // and two questions sharing an id would play each other's clue.
      if (byQuestion.has(question.id)) {
        problems.push(`${id}: question id "${question.id}" is already used`);
        continue;
      }
      byQuestion.set(question.id, { ...question, set: id });
      questions.push(question);
    }

    if (!questions.length) { problems.push(`${id}: no usable questions`); continue; }

    sets.push({
      id,
      title: String(raw.title || id).trim(),
      // A line saying what the set is about, shown above the drill. Not a
      // hint about any one answer - that would give the game away.
      summary: String(raw.summary || '').trim(),
      questions,
    });
  }

  sets.sort((a, b) => {
    const ai = ORDER.indexOf(a.id), bi = ORDER.indexOf(b.id);
    if (ai !== bi) return (ai < 0 ? ORDER.length : ai) - (bi < 0 ? ORDER.length : bi);
    return a.id.localeCompare(b.id);
  });

  return { sets, byQuestion, problems };
}

/**
 * The index: the sets, their sizes and their question ids. NOT the clues and
 * NOT the answers - see the note at the top of this file. The ids are needed
 * because the page asks for one question's audio at a time and prefetches the
 * next while you are typing, exactly as the vocabulary drill does.
 */
export function listeningIndex(sets) {
  return sets.map((s) => ({
    id: s.id,
    title: s.title,
    summary: s.summary,
    questions: s.questions.map((q) => ({ id: q.id })),
  }));
}
