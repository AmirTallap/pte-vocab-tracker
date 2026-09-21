#!/usr/bin/env node
/**
 * Render the group discussions to MP3, once, onto this machine.
 *
 * Each turn is spoken in ITS OWN speaker's voice and the turns are laid out on
 * a single timeline, which is the whole difference between a discussion and a
 * lecture. Three things do the work of making it sound like people rather than
 * three files played in order:
 *
 *  - **Different voices**, mixed across accent and gender. src/discussions.js
 *    refuses a file where two speakers share one, because two speakers you
 *    cannot tell apart make the exercise impossible rather than hard.
 *  - **A per-speaker speed**, a little either side of 1. Pitch alone is a
 *    weak cue over a laptop speaker; pace is what makes two voices feel like
 *    two people.
 *  - **Real turn-taking gaps.** Conversation runs about 200ms between turns,
 *    far tighter than the silence a reader leaves between paragraphs, and a
 *    turn may ask for less - or for a NEGATIVE gap, which overlaps it onto the
 *    end of the previous one. That is what a real "yeah, exactly" over the top
 *    of somebody does, and laying the samples over each other is the only way
 *    to get it: no amount of writing makes sequential audio interrupt.
 *
 *   node tools/render-discussions.js            # all of them
 *   node tools/render-discussions.js 3          # three, then stop
 *
 * Output: data/discussions/audio/<id>.mp3, gitignored like the lectures'.
 * Derived data: the JSON is the source, and deleting the audio directory
 * costs a re-run and nothing else. Re-runnable - a discussion whose MP3 is
 * already there is skipped, so an interrupted run resumes by starting again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { loadDiscussions, TURN_GAP } from '../src/discussions.js';
import { say, decodeWav } from '../src/tts.js';
import { DISCUSSIONS_DIR } from '../src/config.js';

const run = promisify(execFile);
const OUT_DIR = path.join(DISCUSSIONS_DIR, 'audio');

/* The same bar src/tts.js rejects a truncated chunk at, applied to the
 * finished clip. A discussion has silence in it, so it will always measure
 * well under this - which is the point: anything at or above 260wpm means
 * turns went missing, not that the speakers were brisk. */
const MAX_WPM = 260;

/* A moment before the first voice and after the last. Without the head the
 * first syllable can be clipped by a player still settling; without the tail
 * the last word runs into the end of the file, which sounds like it was cut. */
const LEAD_IN = 0.15;
const LEAD_OUT = 0.35;

async function haveFfmpeg() {
  try { await run('ffmpeg', ['-version']); return true; } catch { return false; }
}

async function seconds(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ]);
  return Number(String(stdout).trim());
}

/** A 16-bit PCM mono WAV around -1..1 floats. The mirror of src/tts.js's. */
function wav(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

/**
 * The turns onto one timeline.
 *
 * Each turn starts a gap after the END of the one before, so a negative gap
 * lays it over the tail of that turn and the two voices are summed there.
 * A turn can never start before the one before it did, however negative the
 * gap: two people talking at once is a conversation, and one person's words
 * arriving before the person they answer is not.
 */
function layout(clips, rate) {
  const placed = [];
  let at = 0, prevStart = 0, prevEnd = 0;

  clips.forEach((clip, i) => {
    if (i === 0) {
      at = Math.round(LEAD_IN * rate);
    } else {
      const gap = clip.gap != null ? clip.gap : TURN_GAP;
      at = Math.max(prevStart + 1, Math.round(prevEnd + gap * rate));
    }
    placed.push({ samples: clip.samples, at });
    prevStart = at;
    prevEnd = at + clip.samples.length;
  });

  const total = placed.reduce((n, p) => Math.max(n, p.at + p.samples.length), 0)
    + Math.round(LEAD_OUT * rate);
  const out = new Float32Array(total);
  for (const p of placed) {
    for (let i = 0; i < p.samples.length; i++) out[p.at + i] += p.samples[i];
  }
  // Summed overlaps can exceed full scale. Clipped here rather than by the
  // 16-bit conversion, so it is a deliberate line in one place.
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  return out;
}

async function main() {
  const limit = Number(process.argv.find((a, i) => i > 1 && /^\d+$/.test(a))) || Infinity;

  if (!await haveFfmpeg()) {
    console.error('ffmpeg is not on PATH - it is what turns the WAV into an MP3.');
    process.exit(1);
  }

  const { discussions, problems } = loadDiscussions();
  for (const p of problems) console.error(`  ! ${p}`);
  if (!discussions.length) { console.error('no discussions loaded'); process.exit(1); }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`${discussions.length} discussions`);

  let made = 0, already = 0, failed = 0, tried = 0;

  for (const d of discussions) {
    // Attempts, not successes: a fault that hits every one of them must not
    // ignore the limit and spend the synthesis before failing on all of them.
    if (tried >= limit) break;
    const mp3 = path.join(OUT_DIR, `${d.id}.mp3`);
    if (fs.existsSync(mp3)) { already++; continue; }

    tried++;
    const started = Date.now();
    const tmp = path.join(OUT_DIR, `${d.id}.${process.pid}.wav`);
    const byName = new Map(d.speakers.map((sp) => [sp.name, sp]));

    try {
      const clips = [];
      let rate = 24000;
      for (const turn of d.turns) {
        const sp = byName.get(turn.speaker);
        // cache:false - this MP3 is the cache, and a discussion's worth of
        // WAV in the shared audio cache would evict the headwords that make
        // the drill's reveal instant. See say() in src/tts.js.
        const { buffer } = await say(turn.text, sp.voice, { speed: sp.speed, cache: false });
        const got = decodeWav(buffer);
        rate = got.rate;
        clips.push({ samples: got.samples, gap: turn.gap });
      }

      fs.writeFileSync(tmp, wav(layout(clips, rate), rate));
      // `.part.mp3`, not `.mp3.part`: ffmpeg reads the output format off the
      // extension and an unreadable one is an error, not a default.
      const part = path.join(OUT_DIR, `${d.id}.part.mp3`);
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
        '-i', tmp, '-codec:a', 'libmp3lame', '-b:a', '64k', '-ac', '1', part]);

      const secs = await seconds(part);
      const wpm = secs > 0 ? d.words / (secs / 60) : Infinity;
      if (wpm > MAX_WPM) {
        fs.unlinkSync(part);
        throw new Error(`${d.words} words in ${secs.toFixed(1)}s is ${Math.round(wpm)}wpm ` +
                        `- turns are missing from this clip`);
      }
      fs.renameSync(part, mp3);

      made++;
      console.log(`  ${d.id}  ${d.turns.length} turns  ${d.words}w  ${secs.toFixed(1)}s  ` +
                  `${Math.round(wpm)}wpm  (${((Date.now() - started) / 1000).toFixed(0)}s)`);
    } catch (err) {
      failed++;
      console.error(`  ! ${d.id}: ${err.message}`);
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* never written */ }
    }
  }

  console.log(`\n${made} rendered · ${already} already there · ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
