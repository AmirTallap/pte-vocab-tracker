import fs from 'node:fs';
import path from 'node:path';
import { GRAMMARMAP_DIR } from './config.js';

/**
 * The grammar map: the whole of English grammar that PTE writing and speaking
 * lean on, laid out as a transit map. A LINE is an area (tense, agreement,
 * clauses ...), a STATION is one rule on it, and each station carries an
 * article explaining how the rule applies. It replaced the 24-module syllabus
 * and its 288 multiple-choice questions on 26 Sep 2026, by request - those
 * tested recognition, and the map's job is different: it is where the reviews
 * of your own essays and answers pin each mistake, so the colour of a station
 * is how often YOU got that rule wrong, not how many questions you ticked.
 *
 * One JSON file per line in data/grammarmap/, the rule every directory of
 * authored content here lives under: edit one file, by name. `_map.json` holds
 * what belongs to no single line - the interchanges, where two stations are
 * the same rule seen from two sides.
 *
 * Static, read at startup, never written back. The failure log is in
 * data/attempts.db (see attempts.js), keyed by the station ids here - which is
 * why an id, once a fault has been filed against it, must never be renamed.
 */
export function loadGrammarMap(dir = GRAMMARMAP_DIR) {
  const out = { lines: [], links: [], problems: [] };
  if (!fs.existsSync(dir)) return { ...out, problems: ['data/grammarmap/ is missing'] };

  const ids = new Set();
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json') || name.startsWith('_')) continue;
    let line;
    try {
      line = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch (err) {
      out.problems.push(`${name}: ${err.message}`);
      continue;
    }
    if (!line.id || !Array.isArray(line.stations)) {
      out.problems.push(`${name}: needs an id and stations[]`);
      continue;
    }
    const stations = [];
    for (const s of line.stations) {
      if (!s || !s.id || !s.title) { out.problems.push(`${name}: a station has no id or title`); continue; }
      if (!s.id.startsWith(line.id + '.')) out.problems.push(`${name}: "${s.id}" is not on line ${line.id}`);
      if (ids.has(s.id)) { out.problems.push(`${name}: duplicate station "${s.id}"`); continue; }
      ids.add(s.id);
      if (!Array.isArray(s.sections) || !s.sections.length) out.problems.push(`${s.id}: no article yet`);
      stations.push({
        id: s.id,
        title: s.title,
        summary: s.summary || '',
        sections: Array.isArray(s.sections) ? s.sections : [],
        slips: Array.isArray(s.slips) ? s.slips : [],
        arabic: s.arabic || '',
        check: s.check || '',
      });
    }
    out.lines.push({ id: line.id, name: line.name || line.id, order: Number(line.order) || 99,
                     summary: line.summary || '', stations });
  }
  out.lines.sort((a, b) => a.order - b.order);

  const mapFile = path.join(dir, '_map.json');
  if (fs.existsSync(mapFile)) {
    try {
      const m = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
      for (const pair of m.links || []) {
        if (Array.isArray(pair) && pair.length === 2 && ids.has(pair[0]) && ids.has(pair[1])) {
          out.links.push(pair);
        } else {
          out.problems.push(`_map.json: link ${JSON.stringify(pair)} names an unknown station`);
        }
      }
    } catch (err) {
      out.problems.push(`_map.json: ${err.message}`);
    }
  }
  out.ids = ids;
  return out;
}

/** Just the station ids and titles: what the review skill may pin a fault to. */
export function stationIndex(map) {
  return map.lines.flatMap((l) => l.stations.map((s) => ({ id: s.id, line: l.name, title: s.title, summary: s.summary })));
}
