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

/* ------------------------------------------------- throttling a batch render

   A rendering run takes every core this machine has, for as long as it runs.
   That is right for the drill - one word is 2.5 seconds against an otherwise
   idle machine - and wrong for a batch of a hundred, which pins all four for
   an hour and spins the fans while somebody is trying to work.

   THREE THINGS THAT DO NOT WORK, all measured here rather than assumed, so
   that nobody spends the afternoon on them again:

     - `nice -n 19`. Priority only decides who yields when two things want the
       same core. With the other cores idle the renderer still takes them all,
       and the heat is identical. It was running at 270% at nice 19.
     - `taskset -c 0,1`. onnxruntime sets per-thread affinity itself and walks
       straight out of the mask: pinned to CPUs 0 and 1, its worker threads
       were found running on 2 and 3.
     - `session_options: { intraOpNumThreads: 1 }` through
       `KokoroTTS.from_pretrained`. kokoro-js does not pass it down to the
       session, so the option is simply ignored - four busy threads either way.

   What DOES work is not running it while the machine is in use. Every render
   tool here skips what is already on disk, so stopping one costs nothing and
   resuming it is the same command again. A cgroup quota
   (`systemd-run --user -p CPUQuota=100%`) is enforced by the kernel and
   cannot be escaped, but the transient unit did not inherit enough of the
   environment to find the audio cache, so that route needs work before it is
   worth recommending.
*/

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

/* --------------------------------------------------------------- long text

   Kokoro's context is about 510 phoneme tokens, and `generate()` does not say
   when it runs out: it renders what fits, returns, and looks exactly like a
   success. Measured on this machine with af_heart - 60 words came back as
   21.35s at a natural 169wpm, and 100, 140 and 209 words ALL came back as
   *exactly* 26.95s. Every Re-tell lecture was therefore playing its first
   eighty-odd words and stopping mid-sentence, and the truncated rendering was
   then written to the cache, so the replay was wrong instantly and for ever.
   Nothing anywhere reported it, because nothing had been told to look.

   So text is cut into chunks here and the samples are joined back up. Only
   the headwords are short enough for this never to have mattered, which is
   why it survived until a lecture was read aloud.
*/

/* Far under what actually fits. The ceiling is in PHONEMES, so the same word
   count crosses it or not depending on the words - "through" and "aluminium"
   are one word each and nothing alike - and there is no signal when it does.
   A chunk boundary costs a breath; a truncation costs the second half of the
   lecture. */
const CHUNK_WORDS = 40;

/* The backstop, and it is the half that actually guarantees this. A chunk is
   rejected when what came back is too short to be the words that went in.
   260wpm sits far above every Kokoro voice - the A-graded ones read at about
   170 - and far below the 465 that the truncated 209-word lecture measured,
   so it cannot fire on honest audio and cannot miss a cut one. A rejected
   chunk is split and re-rendered rather than reported: the split IS the fix,
   and a budget that needs hand-tuning per voice is a budget that will be
   wrong again. */
const MAX_WPM = 260;

const countWords = (t) => String(t).trim().split(/\s+/).filter(Boolean).length;

/** Sentences, keeping the terminator that ended each one. */
function sentences(text) {
  return String(text).trim().split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * One over-long sentence, broken where a reader would draw breath: at a
 * clause boundary first, and only between bare words when there is no clause
 * boundary to use.
 */
function splitLong(sentence, budget) {
  const clauses = sentence.split(/(?<=[,;:])\s+/).map((c) => c.trim()).filter(Boolean);
  const out = [];
  let cur = [], n = 0;
  for (const clause of clauses) {
    const w = countWords(clause);
    if (n && n + w > budget) { out.push(cur.join(' ')); cur = []; n = 0; }
    if (w > budget) {
      // No punctuation left to break on. Split between words, which is
      // audible - but it is a seam in a sentence rather than the end of one.
      const ws = clause.split(/\s+/);
      for (let i = 0; i < ws.length; i += budget) out.push(ws.slice(i, i + budget).join(' '));
      continue;
    }
    cur.push(clause); n += w;
  }
  if (cur.length) out.push(cur.join(' '));
  return out;
}

/** The text as chunks that will each fit, packed whole sentences first. */
function chunk(text, budget = CHUNK_WORDS) {
  const out = [];
  let cur = [], n = 0;
  for (const s of sentences(text)) {
    const w = countWords(s);
    if (w > budget) {
      if (cur.length) { out.push(cur.join(' ')); cur = []; n = 0; }
      for (const piece of splitLong(s, budget)) out.push(piece);
      continue;
    }
    if (n && n + w > budget) { out.push(cur.join(' ')); cur = []; n = 0; }
    cur.push(s); n += w;
  }
  if (cur.length) out.push(cur.join(' '));
  return out.length ? out : [String(text).trim()];
}

/**
 * One chunk, rendered - and checked against the clock. Anything that comes
 * back faster than a human being could say it was cut off, so it is halved
 * and each half rendered instead. The depth limit is there so a genuinely
 * strange input cannot recurse for ever; by then the halves are a few words
 * each and whatever is wrong is not truncation.
 */
async function render(tts, text, voice, rate, depth = 0) {
  const audio = await tts.generate(text, { voice, speed: rate });
  const seconds = audio.audio.length / audio.sampling_rate;
  const words = countWords(text);
  const wpm = seconds > 0 ? words / (seconds / 60) : Infinity;

  if (wpm > MAX_WPM * rate && words > 6 && depth < 5) {
    const ws = text.trim().split(/\s+/);
    const half = Math.ceil(ws.length / 2);
    const a = await render(tts, ws.slice(0, half).join(' '), voice, rate, depth + 1);
    const b = await render(tts, ws.slice(half).join(' '), voice, rate, depth + 1);
    return { rate: a.rate, parts: a.parts.concat(b.parts) };
  }
  return { rate: audio.sampling_rate, parts: [audio.audio] };
}

/**
 * The chunks back into one clip, with a breath between them. Kokoro leaves
 * very little room at the edges of what it renders, so butting two chunks
 * straight together runs the sentences into each other.
 */
function join(parts, rate, gapSeconds = 0.09) {
  const gap = Math.max(0, Math.round(rate * gapSeconds));
  const total = parts.reduce((n, p) => n + p.length, 0) + gap * (parts.length - 1);
  const out = new Float32Array(total);
  let at = 0;
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i], at);
    at += parts[i].length + (i < parts.length - 1 ? gap : 0);
  }
  return out;
}

/**
 * The samples back out of a WAV this file wrote.
 *
 * It lives beside wav() on purpose: it is the same format description read in
 * the other direction, and the one thing that must never happen is for the
 * writer and the reader of it to be edited apart. Only for buffers from say()
 * - 16-bit mono PCM with a 44-byte header - not a general WAV parser.
 *
 * It exists for the group discussions, which are built by rendering each turn
 * in that speaker's own voice and laying them out on one timeline, with real
 * conversational gaps and the occasional overlap. That needs samples, not a
 * file per sentence.
 */
export function decodeWav(buffer) {
  const rate = buffer.readUInt32LE(24);
  const bytes = buffer.readUInt32LE(40);
  const n = Math.floor(Math.min(bytes, buffer.length - 44) / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buffer.readInt16LE(44 + i * 2) / 32768;
  return { samples: out, rate };
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
 *
 * `cache:false` renders without reading or writing that cache, for a caller
 * that is keeping the audio itself. A lecture is 78 seconds - about 3.8MB of
 * WAV against a headword's 60KB - so pre-rendering the hundred through the
 * cache would spend its whole 400MB budget on clips already saved as MP3 and
 * evict, oldest first, exactly the 491 headwords that make the drill's reveal
 * instant.
 */
export async function say(text, voice, { speed = 1, cache = true } = {}) {
  const words = String(text || '').trim();
  if (!words) throw new Error('nothing to say');
  if (!isVoiceId(voice)) throw new Error(`unknown voice: ${voice}`);

  // Speed changes the rendering, so it is part of the key.
  const rate = Math.max(0.5, Math.min(2, Number(speed) || 1));

  // Chunking is a pure text operation, so the key is decided without loading
  // the model. Text that still fits in ONE chunk keys exactly as it always
  // did: those renderings were never truncated and their cache entries are
  // still good, so a fix to the lectures does not cost a re-render of all 491
  // headwords. Multi-chunk text gets a distinct key, which strands every
  // truncated WAV rendered before this rather than serving it again for ever.
  const pieces = chunk(words);
  const key = pieces.length > 1 ? `${words}\n#chunked` : words;
  const file = cachePath(voice, rate === 1 ? key : `${key}@${rate}`);

  if (cache) {
    try { return { buffer: fs.readFileSync(file), cached: true }; }
    catch { /* not rendered yet */ }
  }

  const running = inFlight.get(file);
  if (running) return { buffer: await running, cached: false };

  const job = (async () => {
    const tts = await loadTTS();
    const parts = [];
    let sampleRate = 24000;
    for (const piece of pieces) {
      const done = await render(tts, piece, voice, rate);
      sampleRate = done.rate;
      for (const part of done.parts) parts.push(part);
    }
    const buf = wav(parts.length === 1 ? parts[0] : join(parts, sampleRate), sampleRate);
    if (!cache) return buf;
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

  // The in-flight map is keyed on the cache file, so an uncached render has
  // no key to share and does not belong in it. Nothing asks for the same
  // uncached clip twice: the one caller that passes cache:false is writing
  // the result to its own file and checking for that file first.
  if (!cache) return { buffer: await job, cached: false };

  inFlight.set(file, job);
  try {
    return { buffer: await job, cached: false };
  } finally {
    inFlight.delete(file);
  }
}
