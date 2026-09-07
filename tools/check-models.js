#!/usr/bin/env node
/**
 * Checks the worked model answers in data/models/ against the three things
 * that would otherwise teach the wrong lesson:
 *
 *   1. the word band - an example essay outside 200 to 300 is not an example;
 *   2. em and en dashes, which are out of this content by request;
 *   3. every [[...]] marker, which must name a word or phrase that is really
 *      on one of the two sheets. A green highlight over a word that is not in
 *      the deck is a lie about what has been practised.
 *
 * Where the form used is not the headword the marker carries both, separated
 * by a pipe: [[exacerbated|Exacerbate]]. The first half is what the reader
 * sees, the second is what is looked up here through the loader's own keyOf(),
 * so a row re-capitalised in Excel still matches.
 *
 *   node tools/check-models.js            all prompts
 *   node tools/check-models.js e01 e02    just those
 */
import fs from 'node:fs';
import path from 'node:path';
import { load, keyOf } from '../src/loader.js';
import { loadEssays } from '../src/essays.js';
import { loadModels, countWords } from '../src/models.js';
import { MODELS_DIR, SHEETS } from '../src/config.js';

const argv = process.argv.slice(2);
const fix = argv.includes('--fix');
const only = argv.filter((a) => a !== '--fix');

const deck = load();
const known = new Map();                       // key -> which sheet it is on
const deckWord = new Map();                    // key -> the headword as written
for (const id of Object.keys(SHEETS)) {
  for (const e of deck[id]) { known.set(e.key, id); deckWord.set(e.key, e.word); }
}

const essays = loadEssays();
const promptIds = new Set(essays.questions.map((q) => q.id));
const { models, problems } = loadModels(MODELS_DIR, essays.words);

/**
 * --fix names the headword for a marker that is plainly an inflection of one:
 * [[facilitates]] becomes [[facilitates|Facilitate]]. It only ever ADDS the
 * half after the pipe, only where there is no pipe already, and only where
 * exactly one deck entry matches after a suffix is stripped; everything else
 * is left alone and reported, because guessing is how authored content gets
 * quietly corrupted. Every change is printed.
 *
 * The pipe is not decoration. It is what the browser looks the row up by when
 * you hover a green word inside a model answer, so a marker without one that
 * is not itself a headword shows no example sentences at all.
 */
const STEMS = [
  (w) => w.replace(/ies$/, 'y'), (w) => w.replace(/s$/, ''), (w) => w.replace(/es$/, ''),
  (w) => w.replace(/ed$/, ''), (w) => w.replace(/ed$/, 'e'),
  (w) => w.replace(/ing$/, ''), (w) => w.replace(/ing$/, 'e'),
  (w) => w.replace(/([bdglmnprt])\1(ed|ing)$/, '$1'),
  (w) => w.replace(/ly$/, ''), (w) => w.replace(/ly$/, 'le'), (w) => w.replace(/ily$/, 'y'),
  (w) => w.replace(/ally$/, ''), (w) => w.replace(/ness$/, ''),
];

function headwordFor(form) {
  const hits = new Set();
  for (const stem of STEMS) {
    const k = keyOf(stem(keyOf(form)));
    if (k && known.has(k)) hits.add(k);
  }
  return hits.size === 1 ? [...hits][0] : null;
}

/** Is `shown` the same deck word as `head`, merely inflected or embedded? */
function isSameWord(shown, head) {
  const a = keyOf(shown), b = keyOf(head);
  if (a === b || a.includes(b)) return true;
  if (headwordFor(a) === b) return true;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i >= Math.max(4, b.length - 3);
}

function fixFile(id) {
  const file = path.join(MODELS_DIR, `${id}.json`);
  const before = fs.readFileSync(file, 'utf8');
  const changes = [];
  const after = before.replace(/\[\[([^\[\]|]+?)\]\]/g, (whole, form) => {
    if (known.has(keyOf(form))) return whole;
    const head = headwordFor(form);
    if (!head) return whole;
    const proper = deckWord.get(head);
    changes.push(`${id}: [[${form}]] -> [[${form}|${proper}]]`);
    return `[[${form}|${proper}]]`;
  });
  if (after !== before) fs.writeFileSync(file, after);
  return changes;
}

const bad = [...problems];
const seenMarks = new Set();
let essayCount = 0;
let markCount = 0;

if (fix) {
  const done = [];
  for (const id of Object.keys(models)) {
    if (only.length && !only.includes(id)) continue;
    done.push(...fixFile(id));
  }
  for (const c of done) console.log(`  fixed ${c}`);
  if (done.length) console.log(`${done.length} marker${done.length === 1 ? '' : 's'} given a headword; re-run without --fix to verify.\n`);
}

for (const [id, list] of Object.entries(models)) {
  if (only.length && !only.includes(id)) continue;
  if (!promptIds.has(id)) bad.push(`${id}: no such prompt in essays.json`);
  if (list.length !== 3) bad.push(`${id}: ${list.length} model answers, expected 3`);

  list.forEach((m, i) => {
    essayCount += 1;
    const where = `${id} model ${i + 1}`;
    const whole = m.paras.map((p) => p.text).join('\n');
    let hit;
    let marksHere = 0;
    const re = /\[\[([\s\S]+?)\]\]/g;
    while ((hit = re.exec(whole))) {
      marksHere += 1;
      const [shown, head] = hit[1].split('|');
      const key = keyOf((head || shown).trim());
      markCount += 1;
      if (!known.has(key)) bad.push(`${where}: [[${hit[1]}]] is not on either sheet`);
      else if (head && !isSameWord(shown, head)) {
        // The pipe names the SAME word in the form it was used, and nothing
        // else. Using it to file one phrase under a different one paints a
        // green highlight over a word that was never practised, and hands the
        // hover card the wrong row's example sentences.
        bad.push(`${where}: [[${hit[1]}]] pipes to a different word, not an inflection`);
      } else seenMarks.add(key);
    }
    if (marksHere < 6) bad.push(`${where}: only ${marksHere} deck words used`);
    if (m.paras.length < 4) bad.push(`${where}: ${m.paras.length} paragraphs, expected 4`);
    // Repeated whole sentences across the three answers to one prompt would
    // make them one essay in three costumes.
    if (m.words < essays.words.min || m.words > essays.words.max) {
      bad.push(`${where}: ${m.words} words`);
    }
  });
}

// A prompt with no file at all: reported once, at the end, so adding them a
// few at a time shows progress rather than a wall of noise.
const missing = essays.questions.map((q) => q.id).filter((id) => !models[id]);

const files = fs.existsSync(MODELS_DIR)
  ? fs.readdirSync(MODELS_DIR).filter((f) => f.endsWith('.json')).length : 0;

console.log(`${files} files · ${essayCount} model answers · ${markCount} deck marks ` +
            `· ${seenMarks.size} distinct entries used`);
if (missing.length) console.log(`no models yet: ${missing.length} prompts (${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''})`);
if (!bad.length) console.log('all clear');
else {
  console.log(`\n${bad.length} problem${bad.length === 1 ? '' : 's'}:`);
  for (const b of bad) console.log(`  ! ${b}`);
  process.exitCode = 1;
}
