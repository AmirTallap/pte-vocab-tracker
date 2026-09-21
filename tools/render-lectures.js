#!/usr/bin/env node
/**
 * Pre-render the written lectures to MP3, once, onto this machine.
 *
 * The Re-tell tab used to synthesise a lecture when you pressed Play. That was
 * wrong twice over, and the second one was silent:
 *
 *  - It cost most of a minute, which the page papered over with a two-phase
 *    progress bar - an estimate dressed up as a wait, in front of somebody who
 *    only wanted to hear a lecture.
 *  - It TRUNCATED. `generate()` renders what fits in Kokoro's ~510-token
 *    context and returns without a word. Measured: 100, 140 and 209 words all
 *    came back as exactly 26.95 seconds. Every one of the hundred was playing
 *    its first eighty words, stopping mid-sentence, and caching that.
 *    src/tts.js chunks now, and its `render()` rejects any chunk that comes
 *    back faster than a human could say it.
 *
 * So the audio is made once, here, and saved - which is what the Yale
 * excerpts already do. After a run every lecture on the tab is a FILE: the
 * page opens it, knows its duration, can draw a real progress bar and knows
 * when it has ended. None of that is possible for audio that does not exist
 * until it is asked for.
 *
 *   node tools/render-lectures.js                 # the default voice, all of them
 *   node tools/render-lectures.js af_heart 20     # twenty, then stop
 *
 * Output: data/lectures/audio/<id>.mp3, beside the Yale excerpts and
 * gitignored with them. It is derived data: the lecture text in
 * data/lectures/<id>.json is the source, and deleting the whole audio
 * directory costs a re-run and nothing else.
 *
 * Re-runnable. A lecture whose MP3 is already there is skipped, so an
 * interrupted run is resumed by starting it again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { loadLectures } from '../src/lectures.js';
import { say, isVoiceId, DEFAULT_VOICE } from '../src/tts.js';
import { LECTURES_DIR } from '../src/config.js';

const run = promisify(execFile);
const OUT_DIR = path.join(LECTURES_DIR, 'audio');

/**
 * The same bar src/tts.js rejects a chunk at, applied again to the finished
 * clip. It is not redundant: the per-chunk test catches a chunk that was cut,
 * and this catches a clip that lost a whole chunk somewhere between rendering
 * and the MP3. A truncated lecture is worse than a missing one - it plays,
 * it sounds fine, and it stops mid-sentence - so it is worth two checks.
 */
const MAX_WPM = 260;

async function haveFfmpeg() {
  try { await run('ffmpeg', ['-version']); return true; } catch { return false; }
}

/** How long an MP3 runs, off ffprobe, in seconds. */
async function seconds(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ]);
  return Number(String(stdout).trim());
}

async function main() {
  const voice = process.argv[2] && isVoiceId(process.argv[2]) ? process.argv[2] : DEFAULT_VOICE;
  const limit = Number(process.argv.find((a, i) => i > 1 && /^\d+$/.test(a))) || Infinity;

  if (!await haveFfmpeg()) {
    console.error('ffmpeg is not on PATH - it is what turns the WAV into an MP3.');
    process.exit(1);
  }

  const { lectures, problems } = loadLectures();
  for (const p of problems) console.error(`  ! ${p}`);
  if (!lectures.length) { console.error('no lectures loaded'); process.exit(1); }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // The real recordings are somebody standing in a lecture hall. Nothing here
  // improves on that, and re-rendering one would replace it with a synthetic
  // voice reading its transcript - which is the whole thing the fetcher exists
  // to avoid.
  const todo = lectures.filter((l) => !(l.source && l.source.credit));

  console.log(`${lectures.length} lectures · ${lectures.length - todo.length} real recordings ` +
              `· ${todo.length} to render in ${voice}`);

  let made = 0, already = 0, failed = 0, tried = 0;

  for (const lecture of todo) {
    // Attempts, not successes. Counting successes meant a fault that hit
    // every lecture - a wrong ffmpeg argument, say - ignored the limit
    // entirely and spent a minute of synthesis on each of the hundred before
    // failing on all of them.
    if (tried >= limit) break;
    const mp3 = path.join(OUT_DIR, `${lecture.id}.mp3`);
    if (fs.existsSync(mp3)) { already++; continue; }

    tried++;
    const started = Date.now();
    const tmp = path.join(OUT_DIR, `${lecture.id}.${process.pid}.wav`);
    try {
      // cache:false - this file IS the cache, and a 78-second WAV in the
      // shared audio cache would evict the headwords that make the drill's
      // reveal instant. See say() in src/tts.js.
      const { buffer } = await say(lecture.text, voice, { cache: false });
      fs.writeFileSync(tmp, buffer);
      // Written under a temp name and renamed, the way the WAV cache is: an
      // interrupted run must not leave a half-written MP3 that the next run
      // then skips as done.
      // `.part.mp3`, not `.mp3.part`: ffmpeg chooses the output format from
      // the extension, and a name it cannot read one from is an error rather
      // than a default.
      const part = path.join(OUT_DIR, `${lecture.id}.part.mp3`);
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
        '-i', tmp, '-codec:a', 'libmp3lame', '-b:a', '64k', '-ac', '1', part]);

      const secs = await seconds(part);
      const wpm = secs > 0 ? lecture.words / (secs / 60) : Infinity;
      if (wpm > MAX_WPM) {
        fs.unlinkSync(part);
        throw new Error(`${lecture.words} words in ${secs.toFixed(1)}s is ${Math.round(wpm)}wpm ` +
                        `- this clip was cut short`);
      }
      fs.renameSync(part, mp3);

      made++;
      console.log(`  ${lecture.id}  ${lecture.words}w  ${secs.toFixed(1)}s  ` +
                  `${Math.round(wpm)}wpm  (${((Date.now() - started) / 1000).toFixed(0)}s)`);
    } catch (err) {
      failed++;
      console.error(`  ! ${lecture.id}: ${err.message}`);
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* never written */ }
    }
  }

  console.log(`\n${made} rendered · ${already} already there · ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
