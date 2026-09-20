import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { env, pipeline } from '@huggingface/transformers';

/**
 * Local speech-to-text, for hearing yourself the way the exam hears you.
 *
 * Whisper base.en through onnxruntime, the same arrangement as src/tts.js and
 * for the same reason: the model is downloaded once into ~/.cache and nothing
 * you say ever leaves this machine. A recording of your own voice is the most
 * personal thing this tool has ever handled, and the answer to "where does it
 * go" has to be "nowhere".
 *
 * `_timestamped` is not the ordinary base.en. It is the build that emits
 * WORD-level timestamps, and those timestamps are the whole feature: the gaps
 * between them are where the hesitations are, and src/speech.js reads the
 * audio inside each gap to tell a silent pause from an "uhh". Without them
 * there is a transcript and no fluency measurement at all.
 *
 * base.en, not small.en: 133MB against 480MB, and on these four cores it
 * transcribes at roughly 0.6x realtime, so a 40-second answer is analysed in
 * about 25 seconds. small.en is more accurate on a heavy accent and about
 * three times slower, which is the wrong trade for a drill you repeat. It is
 * one constant if that ever stops being true.
 */

const MODEL = 'onnx-community/whisper-base.en_timestamped';
const CACHE_ROOT = path.join(os.homedir(), '.cache', 'pte-vocab-tracker');

// The same models directory src/tts.js uses. Setting it twice is harmless -
// both files set the same value - and it keeps each module readable on its own.
env.cacheDir = path.join(CACHE_ROOT, 'models');

/** What the recorder hands us, and what Whisper wants. */
export const SAMPLE_RATE = 16000;

// A spoken answer is under a minute; PTE's longest speaking task is 40
// seconds. Anything past this is not a drill, it is a mistake, and decoding
// it would tie up the one model instance for minutes.
export const MAX_SECONDS = 180;

/* ------------------------------------------------------------- the model */

let asrPromise = null;
let loadError = null;

function loadASR() {
  if (!asrPromise) {
    asrPromise = (async () => {
      const p = await pipeline('automatic-speech-recognition', MODEL, {
        // fp32 encoder, q8 decoder. The encoder runs once over the clip and is
        // where the accuracy lives; the decoder runs once per token and is
        // where the time goes. Quantising only the decoder measured no worse
        // on these transcripts and meaningfully faster.
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
        device: 'cpu',
      });
      loadError = null;
      return p;
    })().catch((err) => {
      // Cleared so the next request tries again: the usual cause is being
      // offline on the very first run, before the model has been downloaded.
      asrPromise = null;
      loadError = err;
      throw err;
    });
  }
  return asrPromise;
}

/**
 * Whether the model is on disk, without loading it - so the page can say
 * "first use downloads 133MB" instead of appearing to hang. The weights
 * themselves, not just the directory: an interrupted first download leaves the
 * config and tokenizer behind and nothing to listen with.
 */
export function status() {
  let ready = false;
  try {
    ready = fs.readdirSync(path.join(env.cacheDir, MODEL, 'onnx'))
      .some((n) => n.endsWith('.onnx'));
  } catch { ready = false; }
  return {
    ready,
    loaded: !!asrPromise && !loadError,
    error: loadError ? loadError.message : null,
    model: MODEL,
    sampleRate: SAMPLE_RATE,
    maxSeconds: MAX_SECONDS,
  };
}

/** Whether ffmpeg is on the PATH, which is how the browser's audio is decoded. */
export function haveFfmpeg() {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  return dirs.some((d) => {
    try { fs.accessSync(path.join(d, 'ffmpeg'), fs.constants.X_OK); return true; }
    catch { return false; }
  });
}

/* ----------------------------------------------------------------- audio */

/**
 * Whatever the browser recorded -> 16kHz mono float samples.
 *
 * MediaRecorder gives WebM/Opus on Chrome and ogg or mp4 elsewhere, and the
 * exact container is the browser's choice, not ours. ffmpeg is already a
 * dependency of `npm run audio`, it reads all of them, and letting it sniff
 * the format is why nothing here has to care which one arrived.
 *
 * f32le out, because that is what the pipeline takes and it saves converting
 * an int16 buffer back to floats - and src/speech.js measures loudness over
 * these very same samples, so the transcript and the pause analysis can never
 * be looking at two different decodings of the audio.
 */
export function decode(buffer) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-f', 'f32le', '-acodec', 'pcm_f32le',
      '-ac', '1', '-ar', String(SAMPLE_RATE),
      '-t', String(MAX_SECONDS),          // a runaway recording is truncated, not refused
      'pipe:1',
    ]);

    const out = [];
    let err = '';
    ff.stdout.on('data', (c) => out.push(c));
    ff.stderr.on('data', (c) => { err += c; });
    ff.on('error', (e) => reject(new Error(
      e.code === 'ENOENT' ? 'ffmpeg is not installed' : `ffmpeg: ${e.message}`)));
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg failed: ${err.trim() || code}`));
      const buf = Buffer.concat(out);
      if (buf.length < 4) return reject(new Error('the recording was empty'));
      // A copy, not a view: Buffer.concat may hand back a slice of a larger
      // pool whose byteOffset is not 4-byte aligned, and Float32Array refuses
      // that. Copying is a few hundred KB and removes the whole question.
      const pcm = new Float32Array(buf.length >> 2);
      for (let i = 0; i < pcm.length; i++) pcm[i] = buf.readFloatLE(i * 4);
      resolve(pcm);
    });

    ff.stdin.on('error', () => { /* closed early; `close` reports it */ });
    ff.stdin.end(buffer);
  });
}

/**
 * The words, each with the seconds it started and ended at.
 *
 * Whisper's own chunking is left alone (30s windows): a speaking answer fits
 * inside one, and stitching timestamps across windows is exactly the kind of
 * thing that produces a pause that is not there.
 */
export async function transcribe(pcm) {
  const asr = await loadASR();
  const r = await asr(pcm, { return_timestamps: 'word', chunk_length_s: 30 });

  const words = [];
  for (const c of r.chunks || []) {
    const text = String(c.text || '').trim();
    const [start, end] = c.timestamp || [];
    if (!text) continue;
    // A word with no end timestamp is the last one in a window and Whisper
    // does occasionally drop it. Dropping the word would corrupt the counts,
    // so it keeps its start and borrows a plausible end.
    words.push({
      text,
      start: Number(start) || 0,
      end: Number(end ?? start) || Number(start) || 0,
    });
  }
  return { text: String(r.text || '').trim(), words };
}
