import fs from 'node:fs';
import path from 'node:path';
import { IMAGES_DIR } from './config.js';

/**
 * Describe Image: look at a chart for 25 seconds, then describe it for 40.
 *
 * PTE's images are overwhelmingly charts - bar, line, pie, a table, a process
 * - and a chart is DATA, so these are stored as data and drawn by the page
 * as SVG rather than generated as pictures. Two reasons, and the second is
 * the one that matters: the drawing is exact, and the numbers behind it are
 * right there to hand to a model. A model reading a pasted transcript cannot
 * see the picture you described, so the copyable prompt writes the chart out
 * in words beside what you said, and "you said sales doubled, they rose by
 * a third" becomes something it can actually check.
 *
 * The figures are ILLUSTRATIVE - invented to be plausible, the way PTE's own
 * are - and the page says so. None of them is a claim about the world.
 *
 * One JSON file per set of ten in data/images/, the rule every directory of
 * authored content here lives under: edit one file, by name, never a bulk
 * script over the directory. Static, read once at startup, never written back.
 *
 * An item:
 *
 *   { id, type, title, unit?, points: [3-6 strings], ...one body below }
 *
 *   bar      categories: [2-8 labels], series: [1-4 {name, values}], yLabel?
 *   line     x: [3-12 labels],        series: [1-4 {name, values}], yLabel?
 *   pie      pies: [1-2 {title?, slices: [2-6 {label, value}]}]
 *   table    columns: [header labels], rows: [3-8 [label, ...cells]]
 *   process  steps: [3-8 {label, detail?}], cycle: true|false
 *
 * `points` is what a good 40-second answer would mention - the headline, the
 * biggest and smallest, the trend, the comparison worth making. It goes to
 * the model in the prompt; this code never marks an answer against it, for
 * the reason the lectures give: every cheap check of coverage rewards
 * reciting phrases rather than describing.
 */

export const TYPES = ['bar', 'line', 'pie', 'table', 'process'];

/* PTE's own allowances, fixed rather than scaled - the exam does not vary them. */
export const IMAGE_TIMES = { prepare: 25, speak: 40 };

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => typeof v === 'string' && v.trim().length > 0;

/** Everything wrong with one item, as sentences. Empty means it is fine. */
export function checkImage(it) {
  const bad = [];
  if (!str(it.id)) bad.push('no id');
  if (!TYPES.includes(it.type)) bad.push(`type must be one of ${TYPES.join(', ')}`);
  if (!str(it.title)) bad.push('no title');
  if (!Array.isArray(it.points) || it.points.length < 3 || it.points.length > 6 ||
      !it.points.every(str)) bad.push('points must be 3-6 sentences');

  const series = (labels, what) => {
    if (!Array.isArray(it.series) || it.series.length < 1 || it.series.length > 4) {
      return bad.push('series must be 1-4 {name, values}');
    }
    for (const s of it.series) {
      if (!str(s.name)) bad.push('a series has no name');
      if (!Array.isArray(s.values) || s.values.length !== labels.length) {
        bad.push(`series "${s.name}" needs one value per ${what} (${labels.length})`);
      } else if (!s.values.every(num)) bad.push(`series "${s.name}" has a non-number`);
    }
  };

  if (it.type === 'bar') {
    if (!Array.isArray(it.categories) || it.categories.length < 2 || it.categories.length > 8 ||
        !it.categories.every(str)) bad.push('categories must be 2-8 labels');
    else series(it.categories, 'category');
    if (Array.isArray(it.series) && it.series.some((s) => (s.values || []).some((v) => v < 0))) {
      bad.push('a bar value is negative');
    }
  } else if (it.type === 'line') {
    if (!Array.isArray(it.x) || it.x.length < 3 || it.x.length > 12 || !it.x.every((v) => str(String(v)))) {
      bad.push('x must be 3-12 labels');
    } else series(it.x, 'x label');
  } else if (it.type === 'pie') {
    if (!Array.isArray(it.pies) || it.pies.length < 1 || it.pies.length > 2) {
      bad.push('pies must be 1-2 pies');
    } else {
      for (const [i, p] of it.pies.entries()) {
        const sl = p && p.slices;
        if (!Array.isArray(sl) || sl.length < 2 || sl.length > 6) { bad.push(`pie ${i + 1} needs 2-6 slices`); continue; }
        if (!sl.every((s) => str(s.label) && num(s.value) && s.value > 0)) {
          bad.push(`pie ${i + 1} has a slice without a label or a positive value`);
          continue;
        }
        // A pie in percent that does not come to 100 is a picture of a
        // mistake, and describing it would teach the mistake.
        const sum = sl.reduce((t, s) => t + s.value, 0);
        if (it.unit === '%' && Math.abs(sum - 100) > 1) bad.push(`pie ${i + 1} sums to ${sum}, not 100`);
      }
    }
  } else if (it.type === 'table') {
    const cols = it.columns;
    if (!Array.isArray(cols) || cols.length < 2 || cols.length > 6 || !cols.every(str)) {
      bad.push('columns must be 2-6 labels');
    } else if (!Array.isArray(it.rows) || it.rows.length < 3 || it.rows.length > 8) {
      bad.push('rows must be 3-8');
    } else {
      for (const r of it.rows) {
        if (!Array.isArray(r) || r.length !== cols.length) {
          bad.push(`a row has ${Array.isArray(r) ? r.length : 0} cells, not ${cols.length}`);
        } else if (!r.every((c) => num(c) || str(c))) bad.push('a row has an empty cell');
      }
    }
  } else if (it.type === 'process') {
    if (!Array.isArray(it.steps) || it.steps.length < 3 || it.steps.length > 8 ||
        !it.steps.every((s) => s && str(s.label))) bad.push('steps must be 3-8 {label, detail?}');
    if (typeof it.cycle !== 'boolean') bad.push('cycle must be true or false');
  }
  return bad;
}

export function loadImages(dir = IMAGES_DIR) {
  const problems = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return { items: [], byId: new Map(), problems };
  }
  const items = [];
  const byId = new Map();
  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (err) {
      problems.push(`${file}: ${err.message}`);
      continue;
    }
    for (const it of Array.isArray(raw.items) ? raw.items : []) {
      const bad = checkImage(it || {});
      if (it && byId.has(it.id)) bad.push(`id "${it.id}" is already used`);
      if (bad.length) { problems.push(`${file} ${it && it.id || '?'}: ${bad.join('; ')}`); continue; }
      items.push(it);
      byId.set(it.id, it);
    }
  }
  return { items, byId, problems };
}
