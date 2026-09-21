import fs from 'node:fs';
import path from 'node:path';
import { READING_DIR } from './config.js';

/**
 * Reading: the PTE reading items, marked on the server.
 *
 * Five tasks, the exam's own, and one JSON file per SET of ten in
 * data/reading/ - the rule every directory of authored content here lives
 * under, for the reason CLAUDE.md gives at the grammar modules: a bulk script
 * over one of these corrupted sixteen of them at a stroke. Edit one file, by
 * name. A set says which task it holds in `task`.
 *
 * Static content, read once at startup and NEVER written back. What IS
 * written is the learner's answers, into progress.json under `reading`, by
 * the same tally code the grammar and listening tabs use. An item counts as
 * right only at full marks: a tally is "did you get this one", and the
 * partial score is shown in the verdict where it can be read.
 *
 * **The page is given the passage and never the key.** The passage has to be
 * read, so unlike a listening clue it is sent; the right option in a gap, the
 * right order of the paragraphs and the right choices are not, and they come
 * back only in the verdict for the item just submitted. The grammar tab's
 * rule: the page cannot be read for the answers.
 *
 * Presentation order is shuffled HERE, deterministically from the item id.
 * The data lists the correct option first and the paragraphs in their right
 * order, because that is the easy way to write and check it - sent as written,
 * the first option would always be right. Seeded rather than random so the
 * same item looks the same on every visit and a reload is not a reroll.
 */

export const TASKS = {
  'fib-rw': {
    title: 'Reading & Writing: Fill in the Blanks',
    short: 'R&W Fill in the Blanks',
    how: 'Choose the option that best fits each gap.',
  },
  'fib-r': {
    title: 'Reading: Fill in the Blanks',
    short: 'Fill in the Blanks',
    how: 'Put a word from the box into each gap. There are more words than gaps.',
  },
  reorder: {
    title: 'Re-order Paragraphs',
    short: 'Re-order Paragraphs',
    how: 'Put the paragraphs into the right order.',
  },
  'mcq-single': {
    title: 'Multiple Choice, Single Answer',
    short: 'Multiple Choice, Single',
    how: 'Choose the one answer that is correct.',
  },
  'mcq-multi': {
    title: 'Multiple Choice, Multiple Answers',
    short: 'Multiple Choice, Multiple',
    how: 'Choose every answer that is correct. A wrong choice costs a mark.',
  },
};

/* ---------------------------------------------------- seeded shuffling */

function seedOf(s) {
  let h = 2166136261;                               // FNV-1a
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function rng(seed) {                                // mulberry32
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Indices 0..n-1 in a shuffled order that is never the identity. */
function permutation(n, key) {
  const r = rng(seedOf(key));
  const p = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  // A re-order item that arrives already in order is a free mark, and an
  // options list with the answer first is the pattern the shuffle exists to
  // break. Rotating keeps it deterministic.
  if (n > 1 && p.every((v, i) => v === i)) p.push(p.shift());
  return p;
}

const words = (s) => String(s).split(/\s+/).filter(Boolean).length;

/* ------------------------------------------------------------ parsing */

const GAP = /\{\{([^}]*)\}\}/g;

/** Text with {{...}} gaps -> [string | {gap: n}], plus each gap's inside. */
function splitGaps(text) {
  const parts = [], inner = [];
  let last = 0;
  for (const m of text.matchAll(GAP)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push({ gap: inner.length });
    inner.push(m[1]);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return { parts, inner };
}

/** The passage with every gap filled by its right answer - for word counts. */
function filled(parts, answers) {
  return parts.map((p) => (typeof p === 'string' ? p : answers[p.gap])).join('');
}

function distinct(list) {
  return new Set(list.map((s) => s.toLowerCase())).size === list.length;
}

/**
 * One item, normalised, or a thrown error naming what is wrong with it.
 * `problems` collects the softer complaints - a passage outside the length
 * the exam uses - which are reported at startup rather than refused.
 */
function readItem(raw, task, setId, i, problems) {
  const where = `${setId} item ${i + 1}`;
  if (!raw || typeof raw !== 'object') throw new Error(`${where}: not an object`);
  const id = String(raw.id || `${setId}-${i + 1}`);
  const base = {
    id,
    task,
    title: String(raw.title || '').trim(),
    note: String(raw.note || '').trim(),
  };

  if (task === 'fib-rw') {
    const { parts, inner } = splitGaps(String(raw.text || ''));
    if (inner.length < 2) throw new Error(`${where}: fewer than two gaps`);
    const gaps = inner.map((g, n) => {
      const opts = g.split('|').map((o) => o.trim());
      if (opts.length !== 4 || opts.some((o) => !o)) {
        throw new Error(`${where}: gap ${n + 1} needs exactly four options`);
      }
      if (!distinct(opts)) throw new Error(`${where}: gap ${n + 1} repeats an option`);
      const p = permutation(4, `${id}#${n}`);
      return { answer: opts[0], options: p.map((k) => opts[k]) };
    });
    const why = Array.isArray(raw.why) ? raw.why.map(String) : [];
    if (why.length && why.length !== gaps.length) {
      problems.push(`${where}: ${why.length} explanations for ${gaps.length} gaps`);
    }
    const w = words(filled(parts, gaps.map((g) => g.answer)));
    if (w < 60 || w > 300) problems.push(`${where}: ${w} words`);
    return { ...base, parts, gaps, why };
  }

  if (task === 'fib-r') {
    const { parts, inner } = splitGaps(String(raw.text || ''));
    if (inner.length < 2) throw new Error(`${where}: fewer than two gaps`);
    const answers = inner.map((g) => g.trim());
    if (answers.some((a) => !a || a.includes('|'))) {
      throw new Error(`${where}: a gap here holds one word, with no options`);
    }
    const distractors = (Array.isArray(raw.distractors) ? raw.distractors : [])
      .map((d) => String(d).trim()).filter(Boolean);
    if (distractors.length < 2) throw new Error(`${where}: needs at least two distractors`);
    const pool = [...answers, ...distractors];
    // Two gaps with the same answer would make the box hold one word twice,
    // and the page could not tell which copy went where.
    if (!distinct(pool)) throw new Error(`${where}: a word appears twice in the box`);
    const p = permutation(pool.length, `${id}#bank`);
    const why = Array.isArray(raw.why) ? raw.why.map(String) : [];
    if (why.length && why.length !== answers.length) {
      problems.push(`${where}: ${why.length} explanations for ${answers.length} gaps`);
    }
    const w = words(filled(parts, answers));
    if (w < 60 || w > 300) problems.push(`${where}: ${w} words`);
    return { ...base, parts, answers, bank: p.map((k) => pool[k]), why };
  }

  if (task === 'reorder') {
    const paras = (Array.isArray(raw.paragraphs) ? raw.paragraphs : [])
      .map((s) => String(s).trim()).filter(Boolean);
    if (paras.length < 3 || paras.length > 6) {
      throw new Error(`${where}: needs three to six paragraphs`);
    }
    if (!distinct(paras)) throw new Error(`${where}: two paragraphs are the same`);
    // shown[k] is the paragraph drawn k-th. The page names a paragraph by its
    // place in THAT list, which says nothing about where it belongs.
    const shown = permutation(paras.length, `${id}#order`);
    return { ...base, paragraphs: paras, shown };
  }

  if (task === 'mcq-single' || task === 'mcq-multi') {
    const passage = String(raw.passage || '').trim();
    const question = String(raw.question || '').trim();
    if (!passage || !question) throw new Error(`${where}: needs a passage and a question`);
    const options = (Array.isArray(raw.options) ? raw.options : []).map((o) => String(o).trim());
    if (options.length < 3 || options.some((o) => !o)) {
      throw new Error(`${where}: needs at least three options`);
    }
    if (!distinct(options)) throw new Error(`${where}: two options are the same`);
    const answer = [...new Set(Array.isArray(raw.answer) ? raw.answer.map(Number) : [])];
    if (answer.some((k) => !Number.isInteger(k) || k < 0 || k >= options.length)) {
      throw new Error(`${where}: an answer points past the options`);
    }
    if (task === 'mcq-single' && answer.length !== 1) {
      throw new Error(`${where}: a single-answer item needs exactly one answer`);
    }
    if (task === 'mcq-multi' && (answer.length < 2 || answer.length >= options.length)) {
      throw new Error(`${where}: a multiple-answer item needs two or more answers, and not all`);
    }
    const w = words(passage);
    if (w < 80 || w > 350) problems.push(`${where}: ${w} words`);
    // The data may list the answer first; the page must not see it there.
    const shown = permutation(options.length, `${id}#options`);
    return { ...base, passage, question, options, answer, shown };
  }

  throw new Error(`${where}: unknown task "${task}"`);
}

export function loadReading(dir = READING_DIR) {
  const problems = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return { sets: [], byItem: new Map(), problems: [] };
  }

  const sets = [];
  const byItem = new Map();
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
    const task = String(raw.task || '');
    if (!TASKS[task]) { problems.push(`${file}: unknown task "${task}"`); continue; }

    const items = [];
    for (const [i, it] of (Array.isArray(raw.items) ? raw.items : []).entries()) {
      let item;
      try {
        item = readItem(it, task, id, i, problems);
      } catch (err) {
        problems.push(err.message);
        continue;
      }
      if (byItem.has(item.id)) {
        problems.push(`${id}: item id "${item.id}" is already used`);
        continue;
      }
      byItem.set(item.id, { ...item, set: id });
      items.push(item);
    }
    if (!items.length) { problems.push(`${id}: no usable items`); continue; }

    sets.push({
      id,
      task,
      title: String(raw.title || id).trim(),
      summary: String(raw.summary || '').trim(),
      items,
    });
  }

  const order = Object.keys(TASKS);
  sets.sort((a, b) => (order.indexOf(a.task) - order.indexOf(b.task)) ||
                      a.id.localeCompare(b.id, undefined, { numeric: true }));
  return { sets, byItem, problems };
}

/* ------------------------------------------------- what the page gets */

/** One item as the page may see it: everything needed to take it, no key. */
function publicItem(it) {
  const out = { id: it.id, title: it.title };
  if (it.task === 'fib-rw') {
    out.parts = it.parts;
    out.options = it.gaps.map((g) => g.options);
  } else if (it.task === 'fib-r') {
    out.parts = it.parts;
    out.bank = it.bank;
  } else if (it.task === 'reorder') {
    out.paragraphs = it.shown.map((k) => it.paragraphs[k]);
  } else {
    out.passage = it.passage;
    out.question = it.question;
    out.options = it.shown.map((k) => it.options[k]);
    // How many are right is NOT sent for a multiple-answer item: the exam
    // does not say, and knowing it would take the negative marking's teeth out.
  }
  return out;
}

export function readingIndex(sets) {
  return sets.map((s) => ({
    id: s.id,
    task: s.task,
    title: s.title,
    summary: s.summary,
    items: s.items.map(publicItem),
  }));
}

/* ------------------------------------------------------------ marking */

/**
 * Mark one response the way PTE does, and hand over the key with the verdict.
 *
 *  - blanks, both kinds: a mark per gap filled correctly.
 *  - re-order: a mark per ADJACENT PAIR in the right order - so getting the
 *    middle right with the ends swapped still earns something, as it does in
 *    the exam, and a single misplaced paragraph does not cost everything.
 *  - single answer: all or nothing.
 *  - multiple answers: +1 per right choice, -1 per wrong one, never below 0.
 *    Negative marking is the exam's, and it is why guessing a third option
 *    "just in case" is a mistake worth being shown.
 *
 * Positions in `response` are the page's - the drawn order - and are mapped
 * back here, so the page never learns how the drawing was done.
 */
export function gradeReading(item, response = {}) {
  if (item.task === 'fib-rw' || item.task === 'fib-r') {
    const given = Array.isArray(response.gaps) ? response.gaps : [];
    const answers = item.task === 'fib-rw' ? item.gaps.map((g) => g.answer) : item.answers;
    const right = answers.map((a, n) =>
      String(given[n] || '').trim().toLowerCase() === a.toLowerCase());
    return {
      score: right.filter(Boolean).length,
      max: answers.length,
      right,
      answers,
      why: item.why,
      note: item.note,
    };
  }

  if (item.task === 'reorder') {
    const n = item.paragraphs.length;
    const given = (Array.isArray(response.order) ? response.order : []).map(Number);
    // Drawn position -> true position.
    const truth = given.map((k) => (Number.isInteger(k) && k >= 0 && k < n ? item.shown[k] : -1));
    let score = 0;
    const pairs = [];
    for (let i = 0; i + 1 < truth.length; i++) {
      const ok = truth[i] >= 0 && truth[i + 1] === truth[i] + 1;
      pairs.push(ok);
      if (ok) score++;
    }
    // The right order, in the page's drawn positions.
    const correct = [...Array(n).keys()].map((t) => item.shown.indexOf(t));
    return { score, max: n - 1, pairs, correct, note: item.note };
  }

  // Multiple choice. The page sends drawn positions; the key is in authored ones.
  const n = item.options.length;
  const chosen = [...new Set((Array.isArray(response.choice) ? response.choice : [])
    .map(Number).filter((k) => Number.isInteger(k) && k >= 0 && k < n))]
    .map((k) => item.shown[k]);
  const key = new Set(item.answer);
  const correct = item.answer.map((a) => item.shown.indexOf(a));
  if (item.task === 'mcq-single') {
    const ok = chosen.length === 1 && key.has(chosen[0]);
    return { score: ok ? 1 : 0, max: 1, correct, note: item.note };
  }
  const hits = chosen.filter((k) => key.has(k)).length;
  const misses = chosen.length - hits;
  return {
    score: Math.max(0, hits - misses),
    max: item.answer.length,
    hits,
    misses,
    correct,
    note: item.note,
  };
}
