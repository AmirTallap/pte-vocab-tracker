#!/usr/bin/env node
/**
 * The review skill's hands: everything .claude/skills/review/SKILL.md needs to
 * read an attempt out of data/attempts.db and write a review back into it.
 *
 *   node tools/review.js pending              attempts with no review yet
 *   node tools/review.js list                 every attempt, newest first
 *   node tools/review.js show <id>            one attempt, whole, plus the deck
 *                                             entries it already uses
 *   node tools/review.js deck [words|phrases] the deck, one entry a line
 *   node tools/review.js stations             every grammar-map station id
 *   node tools/review.js save <id> <file>     check a review JSON and store it
 *   node tools/review.js log                  the failure log: faults per station
 *
 * It opens the store directly rather than going through the server, so it
 * works whether or not `npm run web` is running. SQLite serialises the writes.
 * No backup is taken here - a review replaces only its own attempt's review
 * and fault rows, and the server backs the file up once per session anyway.
 */
import fs from 'node:fs';
import { load, keyOf } from '../src/loader.js';
import { SHEETS } from '../src/config.js';
import { loadGrammarMap, stationIndex } from '../src/grammarmap.js';
import {
  openAttempts, listAttempts, getAttempt, checkReview, saveReview, faultCounts, ATTEMPT_TASKS,
} from '../src/attempts.js';

const [cmd, ...args] = process.argv.slice(2);
const db = openAttempts(undefined, { backup: false });

const say = (s = '') => process.stdout.write(s + '\n');
// Piped into head or less and closed early: stop quietly rather than crash.
process.stdout.on('error', (err) => { if (err.code === 'EPIPE') process.exit(0); throw err; });
const words = (s) => String(s || '').split(/\s+/).filter(Boolean).length;

function deckEntries() {
  const deck = load();
  const out = [];
  for (const kind of Object.keys(SHEETS)) {
    for (const e of deck[kind]) out.push({ kind, word: e.word, meaning: e.meaning || '', key: keyOf(e.word) });
  }
  return out;
}

/**
 * Deck entries whose headword appears in the text. A plain containment test
 * over lower-cased, space-collapsed text, with a crude stem for single words -
 * a HINT for the reviewer, who confirms each one, never a verdict.
 */
function usedIn(text, entries) {
  const hay = ' ' + String(text).toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  return entries.filter((e) => {
    const w = e.word.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!w) return false;
    if (hay.includes(' ' + w + ' ')) return true;
    if (!w.includes(' ') && w.length > 4) {
      const stem = w.replace(/(e|y|es|ed|ing|s)$/, '');
      return new RegExp(' ' + stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[a-z]{0,4} ').test(hay);
    }
    return false;
  });
}

function row(a) {
  const m = a.metrics || {};
  const extra = [m.words != null ? `${m.words} words` : '', m.wpm ? `${m.wpm} wpm` : '']
    .filter(Boolean).join(', ');
  return `#${a.id}  ${a.created.slice(0, 16).replace('T', ' ')}  ${(ATTEMPT_TASKS[a.task] || {}).name || a.task}` +
         `  | ${a.title || a.item_id || ''}${extra ? '  (' + extra + ')' : ''}` +
         `${a.reviewed ? '  [reviewed, ' + a.faults + ' faults]' : '  [PENDING]'}`;
}

if (cmd === 'pending' || cmd === 'list') {
  const all = listAttempts(db, { status: cmd === 'pending' ? 'pending' : '', limit: 1000 });
  if (!all.length) say(cmd === 'pending' ? 'Nothing waiting for review.' : 'No attempts saved yet.');
  for (const a of all) say(row(a));
} else if (cmd === 'show') {
  const a = getAttempt(db, args[0]);
  if (!a) { say(`no attempt ${args[0]}`); process.exit(1); }
  const t = ATTEMPT_TASKS[a.task] || { name: a.task, kind: '?' };
  say(`# Attempt ${a.id} - ${t.name} (${t.kind}) - ${a.created}`);
  say(`item: ${a.item_id || '-'}   title: ${a.title || '-'}`);
  say(`metrics: ${JSON.stringify(a.metrics)}`);
  say(`\n## What was asked / given\n${a.prompt || '(nothing stored)'}`);
  say(`\n## The answer (${words(a.answer)} words)\n${a.answer}`);
  if (a.marked) say(`\n## As spoken, with pauses and fillers written in\n${a.marked}`);
  const used = usedIn(a.answer, deckEntries());
  say(`\n## Deck entries that seem to be used (confirm each)`);
  say(used.length ? used.map((e) => `- [${e.kind}] ${e.word}`).join('\n') : '(none found)');
  if (a.review) say(`\n## Existing review (${a.review.created}) - saving replaces it`);
} else if (cmd === 'deck') {
  const only = args[0];
  for (const e of deckEntries()) {
    if (only && e.kind !== only) continue;
    say(`[${e.kind}] ${e.word}${e.meaning ? ' :: ' + e.meaning : ''}`);
  }
} else if (cmd === 'stations') {
  const map = loadGrammarMap();
  let line = '';
  for (const s of stationIndex(map)) {
    if (s.line !== line) { line = s.line; say(`\n${line}`); }
    say(`  ${s.id.padEnd(26)} ${s.title}  -  ${s.summary}`);
  }
} else if (cmd === 'save') {
  const [id, file] = args;
  if (!id || !file) { say('usage: node tools/review.js save <id> <review.json>'); process.exit(1); }
  let review;
  try { review = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { say(`could not read ${file}: ${err.message}`); process.exit(1); }
  const map = loadGrammarMap();
  const keys = { words: new Set(), phrases: new Set() };
  for (const e of deckEntries()) keys[e.kind].add(e.key);
  const problems = checkReview(review, {
    stations: map.ids,
    inDeck: (text, kind) => !!keys[kind] && keys[kind].has(keyOf(String(text || ''))),
  });
  if (problems.length) {
    say(`NOT saved - ${problems.length} problem(s):`);
    for (const p of problems) say(`  - ${p}`);
    process.exit(1);
  }
  saveReview(db, id, review);
  say(`saved: attempt ${id}, ${(review.faults || []).length} faults filed on the map, ` +
      `${(review.deck || []).length} deck suggestions, ${review.sentences.length} sentences.`);
} else if (cmd === 'log') {
  const map = loadGrammarMap();
  const counts = faultCounts(db);
  const rows = stationIndex(map).filter((s) => counts[s.id])
    .sort((x, y) => counts[y.id].n - counts[x.id].n);
  if (!rows.length) say('No faults filed yet.');
  for (const s of rows) say(`${String(counts[s.id].n).padStart(4)}  ${s.id.padEnd(26)} ${s.title}  (last ${counts[s.id].last.slice(0, 10)})`);
} else {
  say('usage: node tools/review.js pending|list|show <id>|deck [kind]|stations|save <id> <file>|log');
  process.exit(cmd ? 1 : 0);
}
