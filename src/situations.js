import fs from 'node:fs';
import path from 'node:path';
import { SITUATIONS_DIR } from './config.js';

/**
 * Respond to a Situation: read a short scenario, 20 seconds to prepare, 40 to
 * say what you would say to the person in it. Added to PTE Academic in August
 * 2025 beside Summarize Group Discussion, and added here on 26 Sep 2026.
 *
 * One JSON file per set of ten in data/situations/, the rule every directory of
 * authored content lives under: edit one file, by name.
 *
 *   { id, title, items: [{ id, title, register, function, situation, points[] }] }
 *
 * `points` is what a strong answer does, for the review - never a mark scheme
 * this code applies, for the reason the lectures give.
 *
 * Nothing is withheld: the situation is on screen the whole time in the exam.
 */
export const SITUATION_TIMES = { prepare: 20, speak: 40 };

export function loadSituations(dir = SITUATIONS_DIR) {
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
      if (!it || !it.id || typeof it.situation !== 'string' || !it.situation.trim()) {
        problems.push(`${name}: an item has no id or situation`);
        continue;
      }
      if (seen.has(it.id)) { problems.push(`${name}: duplicate id ${it.id}`); continue; }
      seen.add(it.id);
      items.push({
        id: it.id, set: set.id, setTitle: set.title || set.id,
        title: it.title || it.id, register: it.register || '', function: it.function || '',
        situation: it.situation.trim(), points: Array.isArray(it.points) ? it.points : [],
      });
    }
  }
  return { items, problems };
}
