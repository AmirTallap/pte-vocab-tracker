import fs from 'node:fs';
import { ESSAYS_FILE, ESSAY_GUIDE_FILE } from './config.js';

/**
 * The Write Essay prompts: 60 PTE-style questions to write 200-300 words about
 * in 20 minutes.
 *
 * Static content, like the grammar syllabus and the example sentences, and for
 * the same reason - it is read once at startup and NEVER written back. There is
 * nothing here to reconcile with the workbook: the workbook is vocabulary and
 * has no column for an essay, and progress.json holds study history, not prose.
 *
 * The essay you type is not written anywhere either, on purpose. It is a
 * twenty-minute exam rehearsal, not a document: what it is for is the practice
 * and the word count, and keeping a library of past attempts would be a third
 * store to back up, migrate and reason about. The draft survives a reload
 * because the browser keeps it alongside the other view settings - see
 * `settings.essay` in web/app.html - and that is as far as it goes.
 *
 * One file rather than one-per-module as the grammar has, because 60 prompts is
 * 20KB and there is no per-question content underneath them to grow into.
 */
export function loadEssays(file = ESSAYS_FILE) {
  const empty = { minutes: 20, words: { min: 200, max: 300 }, types: {}, questions: [] };
  if (!fs.existsSync(file)) return { ...empty, problems: ['data/essays.json is missing'] };

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { ...empty, problems: [`essays.json: ${err.message}`] };
  }

  const problems = [];
  const types = raw.types && typeof raw.types === 'object' ? raw.types : {};
  const seen = new Set();
  const questions = [];

  for (const q of Array.isArray(raw.questions) ? raw.questions : []) {
    if (!q || !q.id || typeof q.prompt !== 'string' || !q.prompt.trim()) {
      problems.push(`essays.json: a question is missing an id or a prompt`);
      continue;
    }
    // A duplicate id would make two different prompts the same bookmark, and
    // `settings.essay.id` is how the page remembers where you were.
    if (seen.has(q.id)) { problems.push(`essays.json: duplicate id "${q.id}"`); continue; }
    seen.add(q.id);
    if (q.type && !types[q.type]) problems.push(`essays.json: "${q.id}" has unknown type "${q.type}"`);
    questions.push({
      id: q.id,
      type: q.type || 'direct',
      topic: q.topic || '',
      prompt: q.prompt.trim(),
    });
  }

  return {
    minutes: Number(raw.minutes) > 0 ? Number(raw.minutes) : 20,
    words: {
      min: Number(raw.words?.min) > 0 ? Number(raw.words.min) : 200,
      max: Number(raw.words?.max) > 0 ? Number(raw.words.max) : 300,
    },
    types,
    questions,
    problems,
  };
}

/**
 * How to write the essay: the general method, the clock, and one recipe per
 * question type. One small file, unlike the model answers, because it is a
 * couple of pages of advice that every prompt shares and there is nothing
 * underneath it to grow into.
 *
 * Static like everything else on this tab, and passed through almost as it
 * comes: the shape is prose meant to be read, not marked, so there is nothing
 * here to validate beyond the file parsing.
 */
export function loadEssayGuides(file = ESSAY_GUIDE_FILE) {
  const empty = { general: null, types: {} };
  if (!fs.existsSync(file)) return { ...empty, problems: ['data/essay_guides.json is missing'] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      general: raw.general && typeof raw.general === 'object' ? raw.general : null,
      types: raw.types && typeof raw.types === 'object' ? raw.types : {},
      problems: [],
    };
  } catch (err) {
    return { ...empty, problems: [`essay_guides.json: ${err.message}`] };
  }
}
