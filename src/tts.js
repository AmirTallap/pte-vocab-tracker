import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '@huggingface/transformers';

/**
 * Local neural text-to-speech, for hearing a word said properly on the reveal.
 *
 * Kokoro-82M (Apache-2.0, 2025) on the CPU through onnxruntime. Entirely
 * local: the model is downloaded once and nothing leaves this machine
 * afterwards, which is the point - the alternative was a Google Translate link
 * that needs the internet and takes you out of the drill to use it.
 *
 * fp32, not the quantized build, and that is not a slip: q8 measured ~2.5x
 * SLOWER here, because the int8 kernels are not optimised for this CPU. The
 * quantized model is smaller on disk and worse in the only way that is felt.
 *
 * A word takes ~2.5s to render on these four cores and then never again: every
 * rendering is cached on disk, and the page asks for a card's audio while you
 * are still typing the answer. The 2.5s is spent where it is not felt.
 *
 * Both caches live outside the project - in ~/.cache/pte-vocab-tracker - because
 * both are derived data. `data/` stays the workbook, progress.json and the
 * grammar content; nothing in this file is a source of truth, and deleting the
 * whole cache directory costs a re-download and nothing else.
 */

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const CACHE_ROOT = path.join(os.homedir(), '.cache', 'pte-vocab-tracker');
const AUDIO_DIR = path.join(CACHE_ROOT, 'audio');

// The rendered-audio cache is disposable, but it is the whole reason the
// reveal is instant rather than ~2.5s late, so it is worth a few hundred MB.
// Pruned oldest-first past this.
const AUDIO_CAP_BYTES = 400 * 1024 * 1024;

env.cacheDir = path.join(CACHE_ROOT, 'models');

/**
 * The voices, as the browser's two dropdowns need them. Kokoro names them by a
 * prefix - `a` American, `b` British, `f` female, `m` male - and grades each
 * one A-F for how much training audio it had. The grade is shown because it is
 * honest: a D voice is audibly rougher than an A, and there is no reason to
 * make you find that out by ear. Listed best-graded first inside each group,
 * which is also the order the dropdown offers them in.
 *
 * Written out here rather than read off the model, because the dropdown has to
 * paint before the model has loaded - on a first run that is a 326MB download.
 * The model is pinned to one release above, so there is nothing to drift
 * against, and `checkVoices()` says so if that ever stops being true.
 */
export const VOICES = [
  { id: 'af_heart',    name: 'Heart',    accent: 'en-us', gender: 'female', grade: 'A' },
  { id: 'af_bella',    name: 'Bella',    accent: 'en-us', gender: 'female', grade: 'A-' },
  { id: 'af_nicole',   name: 'Nicole',   accent: 'en-us', gender: 'female', grade: 'B-' },
  { id: 'af_aoede',    name: 'Aoede',    accent: 'en-us', gender: 'female', grade: 'C+' },
  { id: 'af_kore',     name: 'Kore',     accent: 'en-us', gender: 'female', grade: 'C+' },
  { id: 'af_sarah',    name: 'Sarah',    accent: 'en-us', gender: 'female', grade: 'C+' },
  { id: 'af_alloy',    name: 'Alloy',    accent: 'en-us', gender: 'female', grade: 'C' },
  { id: 'af_nova',     name: 'Nova',     accent: 'en-us', gender: 'female', grade: 'C' },
  { id: 'af_sky',      name: 'Sky',      accent: 'en-us', gender: 'female', grade: 'C-' },
  { id: 'af_jessica',  name: 'Jessica',  accent: 'en-us', gender: 'female', grade: 'D' },
  { id: 'af_river',    name: 'River',    accent: 'en-us', gender: 'female', grade: 'D' },
  { id: 'am_fenrir',   name: 'Fenrir',   accent: 'en-us', gender: 'male',   grade: 'C+' },
  { id: 'am_michael',  name: 'Michael',  accent: 'en-us', gender: 'male',   grade: 'C+' },
  { id: 'am_puck',     name: 'Puck',     accent: 'en-us', gender: 'male',   grade: 'C+' },
  { id: 'am_echo',     name: 'Echo',     accent: 'en-us', gender: 'male',   grade: 'D' },
  { id: 'am_eric',     name: 'Eric',     accent: 'en-us', gender: 'male',   grade: 'D' },
  { id: 'am_liam',     name: 'Liam',     accent: 'en-us', gender: 'male',   grade: 'D' },
  { id: 'am_onyx',     name: 'Onyx',     accent: 'en-us', gender: 'male',   grade: 'D' },
  { id: 'am_santa',    name: 'Santa',    accent: 'en-us', gender: 'male',   grade: 'D-' },
  { id: 'am_adam',     name: 'Adam',     accent: 'en-us', gender: 'male',   grade: 'F+' },
  { id: 'bf_emma',     name: 'Emma',     accent: 'en-gb', gender: 'female', grade: 'B-' },
  { id: 'bf_isabella', name: 'Isabella', accent: 'en-gb', gender: 'female', grade: 'C' },
  { id: 'bf_alice',    name: 'Alice',    accent: 'en-gb', gender: 'female', grade: 'D' },
  { id: 'bf_lily',     name: 'Lily',     accent: 'en-gb', gender: 'female', grade: 'D' },
  { id: 'bm_fable',    name: 'Fable',    accent: 'en-gb', gender: 'male',   grade: 'C' },
  { id: 'bm_george',   name: 'George',   accent: 'en-gb', gender: 'male',   grade: 'C' },
  { id: 'bm_lewis',    name: 'Lewis',    accent: 'en-gb', gender: 'male',   grade: 'D+' },
  { id: 'bm_daniel',   name: 'Daniel',   accent: 'en-gb', gender: 'male',   grade: 'D' },
];

export const ACCENTS = [
  { id: 'en-us', label: 'American' },
  { id: 'en-gb', label: 'British' },
];

/** The default: the best-graded voice there is, so a first run sounds right. */
export const DEFAULT_VOICE = 'af_heart';

const BY_ID = new Map(VOICES.map((v) => [v.id, v]));

/** A voice id we will actually hand to the model. */
export function isVoiceId(id) {
  return BY_ID.has(id);
}

/* ------------------------------------------------------------- the model */

let ttsPromise = null;
let loadError = null;
let checked = false;

/**
 * Shout if the pinned release stops matching the table above. Called once, when
 * the model finishes loading; it changes nothing, it only prints.
 */
function checkVoices(tts) {
  if (checked) return;
  checked = true;
  const theirs = Object.keys(tts.voices || {});
  if (!theirs.length) return;
  const added = theirs.filter((id) => !BY_ID.has(id));
  const gone = VOICES.filter((v) => !theirs.includes(v.id)).map((v) => v.id);
  if (added.length || gone.length) {
    console.error(`  ! src/tts.js VOICES is out of date with ${MODEL}` +
      (added.length ? ` - new: ${added.join(', ')}` : '') +
      (gone.length ? ` - gone: ${gone.join(', ')}` : ''));
  }
}

/** One load, kept for the life of the process. */
function loadTTS() {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      const { KokoroTTS } = await import('kokoro-js');
      const tts = await KokoroTTS.from_pretrained(MODEL, { dtype: 'fp32', device: 'cpu' });
      loadError = null;
      checkVoices(tts);
      return tts;
    })().catch((err) => {
      // Cleared so the next request tries again: the usual cause is being
      // offline on the very first run, before the model has been downloaded.
      ttsPromise = null;
      loadError = err;
      throw err;
    });
  }
  return ttsPromise;
}

/**
 * Whether the model is on disk, without loading it. The page asks on startup so
 * it can say "first use downloads 326MB" instead of appearing to hang on the
 * first word.
 */
export function status() {
  let ready = false;
  try {
    // The weights themselves, not just the directory: an interrupted first
    // download leaves the config and tokenizer behind and nothing to speak with.
    ready = fs.readdirSync(path.join(env.cacheDir, MODEL, 'onnx'))
      .some((n) => n.endsWith('.onnx'));
  } catch { ready = false; }
  return {
    ready,
    loaded: !!ttsPromise && !loadError,
    error: loadError ? loadError.message : null,
    model: MODEL,
  };
}

/* ------------------------------------------------------------ audio cache */

function cachePath(voice, key) {
  const hash = crypto.createHash('sha1').update(`${voice} ${key}`).digest('hex');
  return path.join(AUDIO_DIR, voice, `${hash}.wav`);
}

/**
 * Keep the cache under its cap, oldest first. Runs after a write, so the
 * directory is only walked when something new was actually rendered.
 */
function prune() {
  const files = [];
  try {
    for (const voice of fs.readdirSync(AUDIO_DIR)) {
      const dir = path.join(AUDIO_DIR, voice);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        const st = fs.statSync(p);
        files.push({ p, size: st.size, at: st.mtimeMs });
      }
    }
  } catch { return; }

  let total = files.reduce((n, f) => n + f.size, 0);
  if (total <= AUDIO_CAP_BYTES) return;

  files.sort((a, b) => a.at - b.at);
  for (const f of files) {
    if (total <= AUDIO_CAP_BYTES) break;
    try { fs.unlinkSync(f.p); total -= f.size; } catch { /* already gone */ }
  }
}

/** A 16-bit PCM mono WAV around the -1..1 floats Kokoro returns. */
function wav(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);                 // PCM
  buf.writeUInt16LE(1, 22);                 // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);          // byte rate
  buf.writeUInt16LE(2, 32);                 // block align
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
 * One rendering, in flight. The page prefetches the card it is showing and then
 * asks for the same audio again on the reveal; both wait on the one synthesis
 * rather than running the model twice over.
 */
const inFlight = new Map();

/**
 * Say `text` in `voice`, as a WAV buffer. Served from disk when it has been
 * said before - the common case after one pass through a batch, and the reason
 * the model is usually never loaded at all on a restart.
 */
export async function say(text, voice, { speed = 1 } = {}) {
  const words = String(text || '').trim();
  if (!words) throw new Error('nothing to say');
  if (!isVoiceId(voice)) throw new Error(`unknown voice: ${voice}`);

  // Speed changes the rendering, so it is part of the key.
  const rate = Math.max(0.5, Math.min(2, Number(speed) || 1));
  const file = cachePath(voice, rate === 1 ? words : `${words}@${rate}`);

  try { return { buffer: fs.readFileSync(file), cached: true }; }
  catch { /* not rendered yet */ }

  const running = inFlight.get(file);
  if (running) return { buffer: await running, cached: false };

  const job = (async () => {
    const tts = await loadTTS();
    const audio = await tts.generate(words, { voice, speed: rate });
    const buf = wav(audio.audio, audio.sampling_rate);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Written under a temp name and renamed: a killed process must not be
      // able to leave a half-written WAV that is then served as a cache hit
      // for ever.
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, file);
      prune();
    } catch (err) {
      console.error(`  ! could not cache audio: ${err.message}`);
    }
    return buf;
  })();

  inFlight.set(file, job);
  try {
    return { buffer: await job, cached: false };
  } finally {
    inFlight.delete(file);
  }
}
