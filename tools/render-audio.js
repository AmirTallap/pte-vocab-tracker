#!/usr/bin/env node
/**
 * Pre-render the deck's headwords to MP3 for the cloud build.
 *
 * The local tool speaks through Kokoro-82M on this CPU (src/tts.js). Workers
 * has no filesystem and no room for a 326MB ONNX model, so the cloud build
 * cannot render anything at request time - it ships the audio instead.
 *
 * That is a straight win rather than a compromise. A first rendering costs
 * ~2.5s, which is exactly the stutter web/app.html hides by prefetching the
 * current card and the next one while you type. A static MP3 off Cloudflare's
 * edge has no such delay, so the cloud build has nothing to hide.
 *
 * This reuses src/tts.js's own `say()`, so a word already in
 * ~/.cache/pte-vocab-tracker/audio is not rendered twice - the cache that
 * serves the local drill seeds this too.
 *
 *   node tools/render-audio.js               # the default voice
 *   node tools/render-audio.js bf_emma       # any voice id from VOICES
 *
 * Output: web/audio/<voice>/<slug>.mp3, plus web/audio/manifest.json mapping
 * the loader's own keyOf() to a filename. The manifest is what the browser
 * reads: it says which words have audio, so the page never guesses at a URL
 * and never asks for a 404.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { load, keyOf } from '../src/loader.js';
import { say, isVoiceId, DEFAULT_VOICE, VOICES } from '../src/tts.js';
import { ROOT } from '../src/config.js';

const run = promisify(execFile);
const AUDIO_DIR = path.join(ROOT, 'web', 'audio');

/**
 * A filename for a headword. Checked for collisions across the whole deck
 * below rather than assumed - two entries sharing a file would silently give
 * one of them the other's pronunciation, which is the kind of bug you only
 * notice by ear.
 */
export const slugFor = (word) => keyOf(word).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  const voice = process.argv[2] || DEFAULT_VOICE;
  if (!isVoiceId(voice)) {
    console.error(`unknown voice: ${voice}`);
    console.error(`try one of: ${VOICES.map((v) => v.id).join(', ')}`);
    process.exit(1);
  }

  try {
    await run('ffmpeg', ['-version']);
  } catch {
    console.error('ffmpeg is not on PATH - it is what turns the WAV into an MP3.');
    process.exit(1);
  }

  const deck = load();
  const entries = [...deck.words, ...deck.phrases];

  // Collisions would be silent, so refuse rather than overwrite.
  const bySlug = new Map();
  for (const e of entries) {
    const s = slugFor(e.word);
    if (bySlug.has(s)) {
      console.error(`slug collision: ${JSON.stringify(e.word)} and ${JSON.stringify(bySlug.get(s))} both -> ${s}.mp3`);
      process.exit(1);
    }
    bySlug.set(s, e.word);
  }

  const outDir = path.join(AUDIO_DIR, voice);
  fs.mkdirSync(outDir, { recursive: true });

  const manifestFile = path.join(AUDIO_DIR, 'manifest.json');
  const manifest = fs.existsSync(manifestFile)
    ? JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    : { voices: {} };
  manifest.voices[voice] ||= {};

  console.log(`rendering ${entries.length} entries in ${voice}`);
  let made = 0; let already = 0; let failed = 0;

  for (const [i, e] of entries.entries()) {
    const slug = slugFor(e.word);
    const mp3 = path.join(outDir, `${slug}.mp3`);
    manifest.voices[voice][keyOf(e.word)] = `${slug}.mp3`;

    if (fs.existsSync(mp3)) { already++; continue; }

    try {
      // say() serves from src/tts.js's own disk cache when the word has been
      // spoken in the drill before, so this only pays for the new ones.
      const { buffer } = await say(e.word, voice);
      const tmp = path.join(outDir, `${slug}.wav.tmp`);
      fs.writeFileSync(tmp, buffer);
      // 64k mono is transparent for a single spoken word and about a twelfth
      // of the WAV; the whole deck lands near 2MB.
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
        '-i', tmp, '-codec:a', 'libmp3lame', '-b:a', '64k', '-ac', '1', mp3]);
      fs.unlinkSync(tmp);
      made++;
    } catch (err) {
      failed++;
      delete manifest.voices[voice][keyOf(e.word)];
      console.error(`  ! ${e.word}: ${err.message}`);
    }

    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${entries.length}  (${made} new, ${already} already there)`);
  }

  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  const bytes = fs.readdirSync(outDir)
    .filter((f) => f.endsWith('.mp3'))
    .reduce((n, f) => n + fs.statSync(path.join(outDir, f)).size, 0);

  console.log(`\n${made} rendered, ${already} already there, ${failed} failed`);
  console.log(`${(bytes / 1024 / 1024).toFixed(1)}MB in web/audio/${voice}/`);
}

main().catch((err) => { console.error(err); process.exit(1); });
