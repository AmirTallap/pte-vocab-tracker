import fs from 'node:fs';
import path from 'node:path';
import { LECTURES_DIR } from './config.js';

/**
 * The Re-tell Lecture items: 100 short academic lectures to hear once and then
 * summarise in your own words.
 *
 * One JSON file per lecture in data/lectures/ - L01.json, L02.json - the same
 * layout as the grammar modules and the model answers, and for the reason
 * CLAUDE.md gives there: a bulk script over a directory of authored content is
 * how sixteen grammar modules were corrupted at a stroke. These hundred were
 * written by ten parallel agents, which is exactly the situation that rule
 * exists for. Edit one file, by name.
 *
 * Static content, read once at startup and NEVER written back. Nothing here is
 * study state: the workbook owns the Known flag, progress.json owns the
 * history, and a lecture is neither - it is something to listen to.
 *
 * What you SAY about it is not stored either, on the Essays tab's reasoning:
 * a retelling is a forty-second rehearsal, not a document. The report is drawn
 * once and the recording is gone, exactly as everywhere else on this tab.
 *
 * `points` is not a mark scheme this tool applies. It is the list of what the
 * lecture actually said, handed to the prompt the page builds so that a model
 * elsewhere can judge coverage - see the Speaking tab. This file does no
 * grading and should never start.
 */

/* PTE plays a lecture of roughly a minute and a half, gives you ten seconds,
 * and then takes forty. The numbers live here because the page, the prompt it
 * writes and any future exporter must all agree about them. */
export const PREPARE_SECONDS = 10;
export const SPEAK_SECONDS = 40;

const words = (text) => {
  const t = String(text || '').trim();
  return t ? t.split(/\s+/).length : 0;
};

export function loadLectures(dir = LECTURES_DIR) {
  const problems = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return { lectures: [], problems: ['data/lectures/ is missing'] };
  }

  const seen = new Set();
  const lectures = [];

  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (err) {
      problems.push(`${file}: ${err.message}`);
      continue;
    }
    const id = raw && raw.id ? String(raw.id) : path.basename(file, '.json');
    if (!raw || typeof raw.text !== 'string' || !raw.text.trim()) {
      problems.push(`${file}: no lecture text`);
      continue;
    }
    // A duplicate id would make two lectures the same bookmark, and the id is
    // what /api/lectures/<id> and the page's rotation are keyed on.
    if (seen.has(id)) { problems.push(`${file}: duplicate id "${id}"`); continue; }
    seen.add(id);

    const text = raw.text.trim();
    const n = words(text);
    // Reported, never repaired - the word band rule the model essays follow.
    // A lecture far outside the band is teaching the wrong thing and the fix
    // is to rewrite that one file, by name.
    if (n < 150 || n > 240) problems.push(`${id}: ${n} words, outside 150-240`);

    lectures.push({
      id,
      title: String(raw.title || id).trim(),
      field: String(raw.field || '').trim(),
      text,
      words: n,
      points: (Array.isArray(raw.points) ? raw.points : [])
        .map((p) => String(p).trim()).filter(Boolean),
    });
  }

  lectures.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  return { lectures, problems };
}

/** The index: everything except the text, which is the point of the exercise. */
export function lectureIndex(lectures) {
  return lectures.map((l) => ({
    id: l.id, title: l.title, field: l.field, words: l.words,
  }));
}
