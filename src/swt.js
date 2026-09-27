import fs from 'node:fs';
import path from 'node:path';
import { SWT_DIR } from './config.js';

/**
 * Summarize Written Text: read an academic passage, write ONE sentence of
 * 5-75 words summarising it, in ten minutes. Added 26 Sep 2026.
 *
 * One JSON file per set of ten in data/swt/:
 *
 *   { id, title, items: [{ id, title, topic, passage, points[], summary }] }
 *
 * `summary` is a model answer and `points` the main idea and its support.
 * Both are withheld from the index the page boots from, and served per item
 * only once you have written your own (server.js), because a model summary
 * read first turns summarising into copying.
 *
 * Summarize Spoken Text is the same exercise with a lecture instead of a
 * passage - 50-70 words, ten minutes - and reuses the lectures rather than
 * having content of its own; its allowances live here beside this one's
 * because they are the same kind of fact.
 */
export const SWT_TIMES = { minutes: 10, words: { min: 5, max: 75 } };
export const SST_TIMES = { minutes: 10, words: { min: 50, max: 70 } };

export function loadSwt(dir = SWT_DIR) {
  const items = [];
  const problems = [];
  if (!fs.existsSync(dir)) return { items, problems };
  const seen = new Set();
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    let set;
    try { set = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
    catch (err) { problems.push(`${name}: ${err.message}`); continue; }
    for (const it of set.items || []) {
      if (!it || !it.id || typeof it.passage !== 'string' || !it.passage.trim()) {
        problems.push(`${name}: an item has no id or passage`);
        continue;
      }
      if (seen.has(it.id)) { problems.push(`${name}: duplicate id ${it.id}`); continue; }
      seen.add(it.id);
      const words = it.passage.split(/\s+/).filter(Boolean).length;
      if (words < 150 || words > 350) problems.push(`${it.id}: passage is ${words} words`);
      items.push({
        id: it.id, set: set.id, setTitle: set.title || set.id,
        title: it.title || it.id, topic: it.topic || '',
        passage: it.passage.trim(), points: Array.isArray(it.points) ? it.points : [],
        summary: it.summary || '',
      });
    }
  }
  return { items, problems };
}
