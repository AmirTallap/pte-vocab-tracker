import fs from 'node:fs';
import path from 'node:path';
import { MODELS_DIR } from './config.js';

/**
 * Model answers: three worked example essays for every Write Essay prompt.
 *
 * One JSON file per prompt in data/models/ - e01.json, e02.json - named for
 * the id in essays.json, exactly as the grammar syllabus is one file per
 * module. Sixty files rather than one, because unlike the prompts themselves
 * there IS something underneath a question now: three essays of 200-300 words
 * plus their plan and their notes is about 5KB a prompt, and one file holding
 * all of it would be 300KB that has to be re-read and re-parsed to fix a comma
 * in one paragraph. It is also the file layout the grammar modules use for the
 * reason written up in CLAUDE.md: a bulk script over a directory of authored
 * content is how sixteen modules were once corrupted at a stroke. Edit one
 * file, by name.
 *
 * Static content, like the prompts, the grammar and the example sentences: read
 * once at startup and NEVER written back. Nothing here is study state - the
 * workbook still owns the Known flag, progress.json still owns the history, and
 * a model answer is neither. It is something to read.
 *
 * Inside a paragraph, [[...]] marks a word or phrase taken from the deck, and
 * the browser paints it green. It is marked in the data rather than matched in
 * the browser for the same reason the example sentences are (see usage.js): the
 * form actually used is usually not the headword, and a client-side regex over
 * two hundred multi-word phrases would both miss those and bold the wrong half
 * of a sentence. Where the two differ the headword follows a pipe -
 * [[exacerbated|Exacerbate]] - which is what tools/check-models.js checks
 * against the workbook and what the browser shows on hover.
 *
 * Every model answer scores 100. That is not a field in the data and cannot be:
 * these are exemplars written to be full marks, so the number is stamped here,
 * once, rather than typed into 180 files where one of them would eventually say
 * 99 and quietly teach the wrong lesson.
 */
export const MODEL_SCORE = 100;
export const MODEL_SCORE_OF = 100;

/** Everything outside the [[...]] markers, which is what the exam would count. */
export function stripMarks(text) {
  return String(text).replace(/\[\[([\s\S]+?)\]\]/g, (_, inner) => String(inner).split('|')[0]);
}

/** Words are runs of non-space, the way the browser and the exam count them. */
export function countWords(text) {
  const t = stripMarks(text).trim();
  return t ? t.split(/\s+/).length : 0;
}

function readParas(raw, where, problems) {
  const paras = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    const text = typeof p === 'string' ? p : (p && typeof p.text === 'string' ? p.text : '');
    if (!text.trim()) { problems.push(`${where}: an empty paragraph`); continue; }
    paras.push({ role: (p && p.role) || '', text: text.trim() });
  }
  if (!paras.length) problems.push(`${where}: no paragraphs`);
  return paras;
}

function readModel(raw, where, band, problems) {
  if (!raw || typeof raw !== 'object') { problems.push(`${where}: not an object`); return null; }

  const paras = readParas(raw.paras, where, problems);
  if (!paras.length) return null;

  const words = paras.reduce((n, p) => n + countWords(p.text), 0);
  // The band is the exam's, and an example that breaks it is teaching the wrong
  // thing. Reported, not repaired: the fix is to rewrite the paragraph.
  if (words < band.min) problems.push(`${where}: ${words} words, under ${band.min}`);
  if (words > band.max) problems.push(`${where}: ${words} words, over ${band.max}`);

  // Em dashes are out by request, and en dashes with them - the two are a
  // single typographic habit and the checker that only caught one would let
  // the other through.
  for (const p of paras) {
    if (/[—–]/.test(p.text)) problems.push(`${where}: an em or en dash in "${p.role || 'a paragraph'}"`);
  }

  return {
    stance: raw.stance || '',
    approach: raw.approach || '',
    plan: (Array.isArray(raw.plan) ? raw.plan : []).filter((s) => typeof s === 'string' && s.trim()),
    paras,
    notes: (Array.isArray(raw.notes) ? raw.notes : []).filter((s) => typeof s === 'string' && s.trim()),
    words,
    score: MODEL_SCORE,
    of: MODEL_SCORE_OF,
  };
}

/**
 * @param {object} band  the word band from essays.json, so the two agree.
 * @returns {{models: Record<string, object[]>, problems: string[]}}
 */
export function loadModels(dir = MODELS_DIR, band = { min: 200, max: 300 }) {
  const models = {};
  const problems = [];
  if (!fs.existsSync(dir)) return { models, problems };

  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const id = name.replace(/\.json$/, '');
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch (err) {
      problems.push(`${name}: ${err.message}`);
      continue;
    }
    if (raw.id && raw.id !== id) problems.push(`${name}: says id "${raw.id}"`);

    const list = [];
    (Array.isArray(raw.models) ? raw.models : []).forEach((m, i) => {
      const one = readModel(m, `${id} model ${i + 1}`, band, problems);
      if (one) list.push(one);
    });
    if (list.length) models[id] = list;
    else problems.push(`${name}: no usable models`);
  }

  return { models, problems };
}

/** How many prompts have model answers, and how many essays that is. */
export function modelCounts(models) {
  const prompts = Object.keys(models).length;
  let essays = 0;
  for (const list of Object.values(models)) essays += list.length;
  return { prompts, essays };
}
