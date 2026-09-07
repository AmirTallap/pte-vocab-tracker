import fs from 'node:fs';
import path from 'node:path';
import { GRAMMAR_DIR } from './config.js';

/**
 * The grammar syllabus: one JSON file per module in data/grammar/.
 *
 * Unlike the deck, this content is static - it is read once at startup and
 * never written back. What IS written is the learner's answers, and those live
 * in progress.json under `grammar`, alongside the other study history. The
 * workbook stays the source of truth for vocabulary and knows nothing about
 * this.
 */

// Presentation order. A module on disk that is not listed here still loads; it
// just sorts to the end of its group, so adding one is a one-file operation.
const ORDER = [
  'present-simple-continuous', 'past-simple-present-perfect', 'past-perfect-narrative',
  'future-forms', 'conditionals', 'unreal-past',
  'modals-obligation', 'modals-deduction', 'modals-past',
  'passive-voice', 'impersonal-passive', 'reported-speech',
  'relative-clauses', 'subordination-connectors', 'inversion-emphasis',
  'articles', 'countability-quantifiers', 'subject-verb-agreement',
  'gerund-infinitive', 'dependent-prepositions', 'phrasal-verbs',
  'comparison-modification', 'punctuation', 'word-formation',
];

const GROUP_ORDER = [
  'Tenses',
  'Future and Conditionals',
  'Modality',
  'Voice and Reporting',
  'Clause Structure',
  'The Noun Phrase',
  'Verb Patterns and Prepositions',
  'Precision and Style',
];

/** Normalise one question and reject anything that cannot be marked. */
function readQuestion(q, moduleId, i) {
  const where = `${moduleId} q${i + 1}`;
  if (!q || typeof q.prompt !== 'string') throw new Error(`${where}: no prompt`);

  if (q.type === 'mcq') {
    if (!Array.isArray(q.options) || q.options.length < 2) throw new Error(`${where}: needs options`);
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) {
      throw new Error(`${where}: answer ${q.answer} is not an index into ${q.options.length} options`);
    }
    return { id: `q${i + 1}`, type: 'mcq', prompt: q.prompt, options: q.options,
             answer: q.answer, explain: q.explain || '' };
  }

  if (q.type === 'blank') {
    const accept = (Array.isArray(q.accept) ? q.accept : [q.accept]).filter((a) => typeof a === 'string' && a.trim());
    if (!accept.length) throw new Error(`${where}: no accepted answer`);
    return { id: `q${i + 1}`, type: 'blank', prompt: q.prompt, hint: q.hint || null,
             accept, explain: q.explain || '' };
  }

  throw new Error(`${where}: unknown type ${q.type}`);
}

function readModule(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const id = path.basename(file, '.json');
  if (!raw.title) throw new Error(`${id}: no title`);

  const sections = (raw.sections || []).map((s) => ({
    heading: s.heading || '',
    body: s.body || '',
    examples: (s.examples || []).map((e) => ({
      right: e.right || '', wrong: e.wrong || null, note: e.note || '',
    })),
  }));

  const questions = (raw.questions || []).map((q, i) => readQuestion(q, id, i));
  if (!questions.length) throw new Error(`${id}: no questions`);

  return {
    id,
    title: raw.title,
    group: raw.group || 'Other',
    summary: raw.summary || '',
    sections,
    slips: (raw.slips || []).filter((s) => typeof s === 'string'),
    questions,
  };
}

/**
 * Every module on disk, in teaching order. A file that will not parse is
 * reported and skipped rather than taking the whole tool down - one bad module
 * should not cost you the other twenty-three.
 */
export function loadGrammar() {
  if (!fs.existsSync(GRAMMAR_DIR)) return { groups: [], modules: [], problems: [] };

  const modules = [];
  const problems = [];

  for (const name of fs.readdirSync(GRAMMAR_DIR).sort()) {
    if (!name.endsWith('.json') || name.startsWith('_')) continue;
    try {
      modules.push(readModule(path.join(GRAMMAR_DIR, name)));
    } catch (err) {
      problems.push(`${name}: ${err.message}`);
    }
  }

  const rank = (m) => {
    const i = ORDER.indexOf(m.id);
    return i < 0 ? ORDER.length : i;
  };
  modules.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));

  const groups = [];
  for (const m of modules) {
    let g = groups.find((x) => x.name === m.group);
    if (!g) groups.push((g = { name: m.group, ids: [] }));
    g.ids.push(m.id);
  }
  groups.sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a.name), ib = GROUP_ORDER.indexOf(b.name);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  return { groups, modules, problems };
}

// normalise(), isAccepted(), grammarState(), recordAnswer() and
// grammarProgress() live in shared.js. The Worker marks answers with the same
// isAccepted() this server does, and the browser keeps its tally with the same
// recordAnswer() - a second grader is how a correct answer starts being marked
// wrong on one host and right on the other.
export { isAccepted, grammarState, recordAnswer, grammarProgress } from './shared.js';
