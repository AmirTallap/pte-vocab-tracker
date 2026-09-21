import fs from 'node:fs';
import path from 'node:path';
import { DISCUSSIONS_DIR } from './config.js';
import { isVoiceId, VOICES } from './tts.js';

/**
 * Summarize Group Discussion: three people talking about something, heard
 * once, and then summarised in your own words.
 *
 * It is the Re-tell Lecture exercise with different audio - hear it once, get
 * a few seconds, say it back - which is why the page shares the panel, the
 * transport, the recorder, the clock and the report between the two. What is
 * different is the voice: a lecture is one person talking at you, and a
 * discussion is people talking to each other, interrupting, agreeing and
 * changing their minds. Following who said what, and summarising a
 * conversation rather than a monologue, is the thing being practised.
 *
 * One JSON file per discussion in data/discussions/, the rule this project
 * applies to every directory of authored content: the grammar modules, the
 * model answers and the lectures all live under it, and it exists because a
 * bulk script over one of them corrupted sixteen modules at a stroke. Edit
 * one file, by name.
 *
 * Static content, read once at startup and NEVER written back. Nothing here
 * is study state, and what you SAY about it is not stored either - a summary
 * is a sixty-second rehearsal, not a document, exactly as on the Essays tab
 * and the rest of the Speaking tab.
 *
 * `points` is not a mark scheme this tool applies. It is what the discussion
 * actually established, handed to the prompt the page writes so that a model
 * elsewhere can judge coverage against it. Every cheap way of checking
 * coverage here - shared words, keyword matching - rewards parroting the
 * speakers' phrasing, which is the opposite of what *in your own words* means.
 * This file does no grading and should never start.
 */

/* PTE gives you a short while to think and then takes a fixed answer. The
 * numbers live here because the page, the prompt it writes and any future
 * exporter must all agree about them, and because they are the one thing
 * here worth being able to change in a single place. A summary of three
 * people needs longer than re-telling one lecturer, which is why `speak` is
 * not the lecture tab's 40. */
export const PREPARE_SECONDS = 10;
export const SPEAK_SECONDS = 60;

/* How far apart two turns sit, in seconds, when the file does not say.
 * Real conversational turn-taking runs about 200ms between speakers, which
 * is much tighter than the silence a reader would leave between paragraphs -
 * and getting it wrong is most of what makes synthesised dialogue sound like
 * two monologues stapled together. A turn may name its own `gap`, and a
 * NEGATIVE one overlaps the speakers, which is what a real interruption or a
 * "yeah, exactly" over the top of someone actually does. */
export const TURN_GAP = 0.22;
export const MIN_GAP = -0.6;
export const MAX_GAP = 1.5;

const VOICE_BY_ID = new Map(VOICES.map((v) => [v.id, v]));

const words = (text) => {
  const t = String(text || '').trim();
  return t ? t.split(/\s+/).length : 0;
};

/**
 * The audio file for a discussion, or null when it has not been rendered.
 *
 * Discovered on disk rather than recorded in the JSON, for the reason
 * src/lectures.js gives: writing an `audio` field into every authored file is
 * a bulk script over authored content. Name only, never a path from the data.
 */
function audioFor(id, dir) {
  try {
    return fs.statSync(path.join(dir, 'audio', `${id}.mp3`)).isFile() ? `${id}.mp3` : null;
  } catch {
    return null;
  }
}

export function loadDiscussions(dir = DISCUSSIONS_DIR) {
  const problems = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    // Not an error: the directory is created by whoever writes the first one.
    return { discussions: [], problems: [] };
  }

  const seen = new Set();
  const discussions = [];

  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (err) {
      problems.push(`${file}: ${err.message}`);
      continue;
    }
    const id = raw && raw.id ? String(raw.id) : path.basename(file, '.json');
    if (seen.has(id)) { problems.push(`${file}: duplicate id "${id}"`); continue; }
    seen.add(id);

    const speakers = (Array.isArray(raw.speakers) ? raw.speakers : []).map((sp) => ({
      name: String(sp && sp.name || '').trim(),
      voice: String(sp && sp.voice || '').trim(),
      // A little either side of 1 tells two speakers apart by pace as well as
      // by pitch, which is most of what makes three synthetic voices sound
      // like three people. Clamped, because past this it stops being a person.
      speed: Math.max(0.85, Math.min(1.15, Number(sp && sp.speed) || 1)),
    }));

    if (speakers.length < 2 || speakers.length > 4) {
      problems.push(`${id}: ${speakers.length} speakers, expected 2-4`);
      continue;
    }
    if (speakers.some((sp) => !sp.name)) { problems.push(`${id}: a speaker has no name`); continue; }

    const names = new Set(speakers.map((sp) => sp.name));
    if (names.size !== speakers.length) { problems.push(`${id}: two speakers share a name`); continue; }

    const bad = speakers.find((sp) => !isVoiceId(sp.voice));
    if (bad) { problems.push(`${id}: ${bad.name} has no such voice "${bad.voice}"`); continue; }

    // Two speakers in one voice is two speakers the listener cannot tell
    // apart, which makes the whole exercise - following who said what -
    // impossible rather than hard.
    const voices = new Set(speakers.map((sp) => sp.voice));
    if (voices.size !== speakers.length) { problems.push(`${id}: two speakers share a voice`); continue; }

    const turns = (Array.isArray(raw.turns) ? raw.turns : []).map((t) => ({
      speaker: String(t && t.speaker || '').trim(),
      text: String(t && t.text || '').trim(),
      gap: t && t.gap != null
        ? Math.max(MIN_GAP, Math.min(MAX_GAP, Number(t.gap)))
        : null,
    })).filter((t) => t.text);

    if (turns.length < 4) { problems.push(`${id}: ${turns.length} turns, expected at least 4`); continue; }

    const unknown = turns.find((t) => !names.has(t.speaker));
    if (unknown) { problems.push(`${id}: a turn is spoken by "${unknown.speaker}", who is not listed`); continue; }

    // Everybody listed has to say something. A speaker in the list who never
    // speaks is a name the report prints beside nothing.
    const spoke = new Set(turns.map((t) => t.speaker));
    const silent = speakers.find((sp) => !spoke.has(sp.name));
    if (silent) { problems.push(`${id}: ${silent.name} is listed but never speaks`); continue; }

    const n = turns.reduce((sum, t) => sum + words(t.text), 0);
    // Reported, never repaired - the word band rule the model essays and the
    // lectures both follow. At a natural ~150wpm this is roughly a minute to
    // two minutes of talk, which is the length PTE plays.
    if (n < 140 || n > 340) problems.push(`${id}: ${n} words, outside 140-340`);

    discussions.push({
      id,
      title: String(raw.title || id).trim(),
      field: String(raw.field || '').trim(),
      speakers,
      turns,
      words: n,
      points: (Array.isArray(raw.points) ? raw.points : [])
        .map((p) => String(p).trim()).filter(Boolean),
      audio: audioFor(id, dir),
    });
  }

  discussions.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  return { discussions, problems };
}

/**
 * The index: everything except what was SAID, which is the whole exercise.
 *
 * The speakers come through, because knowing there are three people and what
 * they are called is what the exam tells you too - it is the words that are
 * withheld, not the situation.
 */
export function discussionIndex(discussions) {
  return discussions.map((d) => ({
    id: d.id,
    title: d.title,
    field: d.field,
    words: d.words,
    turns: d.turns.length,
    speakers: d.speakers.map((sp) => ({
      name: sp.name,
      // What the listener will actually hear, in the terms the voicebar uses.
      accent: (VOICE_BY_ID.get(sp.voice) || {}).accent || null,
      gender: (VOICE_BY_ID.get(sp.voice) || {}).gender || null,
    })),
    // Whether it has been rendered. A discussion with no file is not takeable
    // at all - unlike a lecture, there is no falling back to synthesising it
    // in the browser, because it is not one voice reading one block of text.
    audio: !!d.audio,
  }));
}

/** Where a discussion's audio lives on disk, or null when it is not rendered. */
export function discussionAudioPath(discussion, dir = DISCUSSIONS_DIR) {
  if (!discussion || !discussion.audio) return null;
  const name = path.basename(String(discussion.audio));
  return path.join(dir, 'audio', name);
}
