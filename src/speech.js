import { keyOf } from './shared.js';

/**
 * What a recording is worth saying about it.
 *
 * Pure functions over a word list, the samples behind it and - for a read
 * aloud - the script that was on screen. No filesystem, no model, no I/O: the
 * whole file can be reasoned about by reading it, and it is the only place
 * that decides what counts as a fault.
 *
 * The governing rule here is PRECISION OVER RECALL, everywhere. A drill that
 * cries wolf gets ignored, and a false "you said that wrong" against an answer
 * that was right is the same failure CLAUDE.md calls the worst this tool has,
 * in the grammar grader. Every check below would rather miss a real fault than
 * invent one, and the ones that cannot be made precise are not here at all -
 * see accent, in dialect() below.
 */

/* ------------------------------------------------------------- the words */

/** Lowercase, apostrophes uncurled, punctuation off the ends. */
export function norm(w) {
  return String(w ?? '')
    .replace(/[‘’ʼ]/g, "'")
    .toLowerCase()
    .replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
}

const tokens = (words) => words.map((w) => norm(w.text)).filter(Boolean);

/* ------------------------------------------------------------ the pauses */

/*
 * The frame the loudness is measured over. 25ms at 16kHz with a 10ms hop is
 * the ordinary speech-analysis frame and needs no defending; what matters here
 * is that it is short enough that a 200ms "uh" is several frames rather than
 * part of one.
 */
const FRAME = 400;
const HOP = 160;

/* Under this a gap is phrasing, not a pause worth naming. */
const MIN_GAP = 0.2;

/*
 * What the exam actually penalises. PTE's Oral Fluency descriptors are about
 * rhythm and phrasing, not silence as such - a pause at a clause boundary is
 * good speaking. So a gap under this is reported as phrasing and costs
 * nothing; past it, it reads as hesitation.
 */
const HESITATION = 0.7;

/* How much continuous voicing makes a gap a filled one. A real "uh" is a
 * sustained sound; a stray frame or two is a click, a lip smack, or the tail
 * of the previous word bleeding past its timestamp. Requiring a RUN rather
 * than a percentage is what tells those apart - scattered frames can reach any
 * percentage you like without a sound ever having been held. */
const VOICED_RUN = 0.15;

/*
 * How far into the gap to ignore, at each end - and it is deliberately small.
 *
 * This was 150ms, to stop the tail of a drawn-out final word reading as a
 * filler. It worked, and it also made the feature useless: trimming 150ms off
 * BOTH ends of a 0.4s gap leaves 0.1s to look at, which cannot contain the
 * 0.2s run a filler has to show - so no short gap could ever be flagged,
 * whatever was in it. Worse, an "uh" normally lands immediately after the word
 * just finished, which is precisely the region being thrown away.
 *
 * The run length already rejects a word tail, and does it better: Whisper's
 * boundaries are wrong by tens of milliseconds, not by 200, so a tail cannot
 * sustain long enough to qualify. 50ms here is only to keep the very edge of
 * an adjacent word out of the measurement.
 */
const HEAD_TRIM = 0.12;
const TAIL_TRIM = 0.03;

/*
 * Two settings, because this cannot be calibrated from here.
 *
 * What counts as a held sound depends on the microphone, the room and the
 * voice, and none of those are knowable from this file. Strict is the default
 * because the failure that actually happened was false ones - a pause at every
 * full stop reported as a filler teaches you to distrust the whole panel,
 * while a missed "uh" costs only that one.
 */
/*
 * One set of numbers, not a choice offered to the reader.
 *
 * There was briefly a strict/sensitive control in the toolbar. It was the
 * wrong answer to "I cannot calibrate this from here": it handed the reader a
 * word they had no way to interpret and asked them to tune an acoustic
 * threshold, which is not their job. These are the values, and if they are
 * wrong they get fixed here.
 */
export const THRESHOLDS = { periodic: 0.45, level: 0.07, run: 0.15 };

/*
 * Where those numbers come from, because they look low and they are not
 * guesses. Swept against a real recording - three sentences read aloud with
 * breath in every pause, once with a half-second "uh" dropped into the first
 * gap and once without - across periodicity 0.45 to 0.70 and run 0.12 to 0.25:
 *
 *   periodicity <= 0.50   the "uh" is found
 *   periodicity >= 0.55   it is missed
 *   false positives        ZERO, at every combination tried
 *
 * So the periodicity threshold is not what holds the false ones back - the RUN
 * requirement is, and it does it on its own. Breath reaches 0.82 for an
 * instant and never sustains; the "uh" sits at 0.67 for half a second. Reading
 * a clean synthetic vowel scoring 0.97 as "so 0.70 is safe" was the mistake
 * that made an earlier version miss real fillers: measured through a
 * microphone with a room behind it, a genuine "uh" lands nearer 0.65, and the
 * threshold has to sit below THAT, not below the laboratory figure.
 */

/*
 * Everything below 200Hz, removed before anything is measured.
 *
 * The test for a filled pause used to be "loud, with a low zero-crossing
 * rate", which is a precise description of MAINS HUM - a room with any hum,
 * fan or desk rumble had every silent pause reported as an "uh". A vowel's
 * pitch is down there too, which is why pitch cannot be the discriminator;
 * a vowel's ENERGY is not, it is in the formants at 300Hz-3kHz. Three
 * one-pole sections, ~18dB/octave, which puts 50Hz about 40dB down.
 */
function highpass(pcm, fc, poles) {
  const dt = 1 / 16000;
  const rc = 1 / (2 * Math.PI * fc);
  const a = rc / (rc + dt);
  let cur = pcm;
  for (let p = 0; p < poles; p++) {
    const y = new Float32Array(cur.length);
    let px = 0, py = 0;
    for (let i = 0; i < cur.length; i++) {
      const x = cur[i];
      py = a * (py + x - px);
      px = x;
      y[i] = py;
    }
    cur = y;
  }
  return cur;
}

/** RMS and zero-crossing rate per frame - the cheap pass, over every frame. */
function frames(pcm) {
  const out = [];
  for (let i = 0; i + FRAME <= pcm.length; i += HOP) {
    let sum = 0, zc = 0;
    for (let j = 0; j < FRAME; j++) {
      const s = pcm[i + j];
      sum += s * s;
      if (j && ((s < 0) !== (pcm[i + j - 1] < 0))) zc++;
    }
    out.push({ at: i / 16000, rms: Math.sqrt(sum / FRAME), zcr: zc / FRAME });
  }
  return out;
}

const quantile = (arr, q) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

/**
 * How periodic a stretch of audio is, 0 to 1 - and this is the test that was
 * missing.
 *
 * A filled pause is VOICED: the vocal folds are buzzing, so the waveform
 * repeats at the pitch period. Breath does not repeat. Room noise does not
 * repeat. That is the difference between an "uh" and the intake of air before
 * a sentence, and no amount of loudness or zero-crossing arithmetic can stand
 * in for it - which is why the first two versions of this could not tell them
 * apart.
 *
 * Normalised autocorrelation over lags 40-200 samples, which at 16kHz is 80Hz
 * to 400Hz - the whole range a human pitch can sit in. The signal has already
 * been high-passed, so the fundamental itself may be gone; it does not matter,
 * because the harmonics left behind are still spaced by F0 and still repeat
 * with that period.
 *
 * Only ever called for frames that already passed the loudness test, because
 * it is the expensive thing in this file.
 */
function periodicity(pcm, at) {
  const W = 512, LAG_MIN = 40, LAG_MAX = 200;
  if (at + W + LAG_MAX > pcm.length) return 0;

  let e0 = 0;
  for (let i = 0; i < W; i++) e0 += pcm[at + i] * pcm[at + i];
  if (e0 <= 0) return 0;

  let best = 0;
  for (let lag = LAG_MIN; lag <= LAG_MAX; lag++) {
    let num = 0, e1 = 0;
    for (let i = 0; i < W; i++) {
      const y = pcm[at + i + lag];
      num += pcm[at + i] * y;
      e1 += y * y;
    }
    if (e1 <= 0) continue;
    const r = num / Math.sqrt(e0 * e1);
    if (r > best) best = r;
  }
  return best;
}

/**
 * Every gap between words, told apart by what is IN it.
 *
 * This is the part Whisper cannot do and the reason the timestamps are worth
 * having. Whisper is trained on tidy transcripts and deletes "um" and "uh"
 * outright - ask it for a transcript and it will report, cheerfully, that you
 * have no fillers at all. But it cannot delete the 400 milliseconds the "um"
 * took: that shows up as a gap between two word timestamps. So the gap is
 * measured in the samples directly.
 *
 * EVERY gap over MIN_GAP comes back, labelled, including the short silent ones
 * that cost nothing. The panel draws them all. A detector that silently
 * discards what it decided was uninteresting is a detector you cannot check,
 * and this one has been wrong before.
 *
 * The thresholds are relative to this recording, never absolute, because they
 * have to hold for a quiet room and a loud one with the same microphone gain.
 */
export function pauses(words, pcm) {
  const S = THRESHOLDS;
  const dur = pcm.length / 16000;
  if (!words.length) return { list: [], speechRms: 0, floor: 0, dur, span: dur };

  // Speech band only - see highpass() for why this line matters.
  const hp = highpass(pcm, 200, 3);
  const fr = frames(hp);
  if (!fr.length) return { list: [], speechRms: 0, floor: 0, dur, span: dur };

  // The speaking itself, first word to last. Every rate below is measured over
  // this rather than over the clip, so leaving the recorder running for three
  // seconds at the end cannot make you look slow.
  const span = Math.max(0.5, words[words.length - 1].end - words[0].start);

  // The speech level is the median frame inside a word, which is a robust
  // "how loud is he" that one shouted syllable cannot drag around.
  const inWord = fr.filter((f) => words.some((w) => f.at >= w.start && f.at < w.end));
  const speechRms = quantile((inWord.length ? inWord : fr).map((f) => f.rms), 0.5);

  // The room, as the quietest tenth of the clip - but never above 6% of the
  // speech level, and that cap is load-bearing. The quantile is taken over
  // every frame, so a long "uhhh" IS part of the sample it is measured
  // against: fill enough of a short clip and the filled pauses quietly raise
  // the floor until they sit under it and stop being detected - the speakers
  // who do it most would be told they never do it. A room above -24dB of
  // speech is not a usable recording anyway, so the cap costs nothing real.
  //
  // The cap is 3%, not 6%, and that is not a free parameter: at 6% the
  // floor*3 term came out at 18% of speech and quietly became the binding
  // threshold, which is ABOVE a softly-said "uh" - measured at about 17%. The
  // filter above means the floor is now genuinely tiny in any real recording,
  // so this term should never bind at all; it is a backstop, and a backstop
  // that overrules the real threshold is a bug.
  const floor = Math.min(quantile(fr.map((f) => f.rms), 0.1), speechRms * 0.03);

  // Above the room by a clear margin, but well under full speech: an "uh" is
  // said at less effort than a word - typically 6 to 15dB below it - and the
  // whole point is to catch it. 10% is about -20dB, the quiet end of that.
  const voicedAt = Math.max(floor * 3, speechRms * S.level);

  const gaps = [];
  // The run-up and the run-out count too: "ummm, I think..." puts the filler
  // before the first word, where a between-words loop would never look.
  const edges = [{ from: 0, to: words[0].start, lead: true }];
  for (let i = 1; i < words.length; i++) {
    edges.push({ from: words[i - 1].end, to: words[i].start, after: i - 1 });
  }
  edges.push({ from: words[words.length - 1].end, to: dur, trail: true });

  for (const g of edges) {
    const len = g.to - g.from;
    if (len < MIN_GAP) continue;

    // Asymmetric, because the two ends hold different things. The START of a
    // gap is where the previous word's tail bleeds forward when Whisper clips
    // its timestamp early, and that tail is voiced, periodic and the same
    // speaker - nothing downstream can tell it from a filler, so it needs real
    // margin. The END is only the next word's onset and needs almost none.
    // Trimming both by the old 150ms is what made every short gap unflaggable.
    const a = g.from + HEAD_TRIM, b = g.to - TAIL_TRIM;
    const inside = fr.filter((f) => f.at >= a && f.at < b);
    if (!inside.length) continue;

    // The longest unbroken stretch of VOICING - loud enough, and periodic.
    // Loudness alone was never enough: breath before a sentence is loud too.
    // Periodicity is the thing that means a voice was making the sound.
    //
    // A brief dip does NOT end the run, and that tolerance is not a fudge: a
    // real "uh" in a real room is not a laboratory tone. Measured clean it
    // scores 0.97 frame after frame, but with ordinary background noise over
    // it the figure flickers either side of the line, and a rule that reset on
    // every dip scored a continuous half-second "uh" as 0.08s - it was thrown
    // away for not being steady enough, which is the opposite of what steadily
    // means here. Two frames of slack is 20ms, far shorter than any real
    // filler and far too short for scattered noise to chain through.
    //
    // `best` counts only the frames that genuinely passed, never the bridged
    // ones, so the number reported is still how long a sound was actually
    // held.
    let run = 0, miss = 0, best = 0, topR = 0;
    for (const f of inside) {
      let ok = false;
      if (f.rms > voicedAt) {
        const r = periodicity(hp, Math.round(f.at * 16000));
        if (r > topR) topR = r;
        ok = r >= S.periodic;
      }
      if (ok) { run++; miss = 0; if (run > best) best = run; }
      else if (run > 0 && miss < 2) { miss++; }
      else { run = 0; miss = 0; }
    }
    const voicedFor = best * (HOP / 16000);
    const filled = voicedFor >= S.run;

    // Dead air before the first word and after the last is not hesitation - it
    // is the half-second of fumbling for the stop button that every recording
    // has, and counting it made a clean answer report a pause it never
    // contained. A FILLED edge is kept, because "ummm, I think..." really does
    // start with a filler and that is exactly where it lives.
    if ((g.lead || g.trail) && !filled) continue;

    gaps.push({
      from: +g.from.toFixed(2),
      to: +g.to.toFixed(2),
      len: +len.toFixed(2),
      filled,
      // The evidence, shown in the panel so a call you disagree with can be
      // argued with rather than just disbelieved: how long a sound was held,
      // and how periodic the most voice-like moment in there was.
      voiced: +voicedFor.toFixed(2),
      tone: +topR.toFixed(2),
      kind: filled ? 'filled' : len >= HESITATION ? 'hesitation' : 'phrasing',
      after: g.after ?? null,
      edge: g.lead ? 'lead' : g.trail ? 'trail' : null,
    });
  }
  return { list: gaps, speechRms, floor, dur, span };
}

/* ----------------------------------------------------------- the fillers */

/*
 * Two tiers, and the split is the honest part.
 *
 * CERTAIN are sounds that are never anything but a filled pause. If one
 * survives Whisper's tidying it is real, so it is counted outright.
 *
 * MARKERS are ordinary English words. One "actually" is fine; six is a tic.
 * They are reported with a count and never called an error, because calling a
 * legitimate word a mistake is how a checker loses its authority. Words that
 * are filler perhaps half the time - "so", "well", "right", "just" - are
 * deliberately absent: at that rate the flag carries no information.
 */
const CERTAIN = ['um', 'umm', 'uhm', 'uh', 'uhh', 'er', 'erm', 'ah', 'eh', 'hmm', 'mm', 'mhm', 'huh'];
const MARKERS = [
  'like', 'you know', 'i mean', 'sort of', 'kind of', 'basically', 'actually',
  'literally', 'obviously', 'stuff like that', 'things like that', 'or whatever',
];

export function fillers(words) {
  const t = tokens(words);
  const joined = ` ${t.join(' ')} `;
  const certain = [];
  t.forEach((w, i) => { if (CERTAIN.includes(w)) certain.push({ word: w, at: i }); });

  const markers = MARKERS
    .map((m) => {
      const hits = joined.split(` ${m} `).length - 1;
      return hits ? { phrase: m, count: hits } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.count - a.count);

  return { certain, markers };
}

/*
 * A word said twice over. Some doublings are correct English and a checker
 * that flags "had had" is wrong, so those are excluded by name rather than by
 * a rule that would also swallow the real ones.
 */
const DOUBLABLE = ['had', 'that', 'very', 'no', 'so', 'ha', 'bye'];

export function repeats(words) {
  const t = tokens(words);
  const out = [];
  for (let i = 1; i < t.length; i++) {
    if (t[i] && t[i] === t[i - 1] && !DOUBLABLE.includes(t[i])) {
      out.push({ kind: 'repeat', text: t[i], at: i });
      continue;
    }
    // "prol- proliferation": a false start, where the abandoned fragment is a
    // prefix of what was finally said. Three letters minimum, or every "a
    // and" in the language lands here.
    if (t[i - 1] && t[i] && t[i - 1].length >= 3 && t[i] !== t[i - 1] &&
        t[i].startsWith(t[i - 1])) {
      out.push({ kind: 'restart', text: `${t[i - 1]}- ${t[i]}`, at: i });
    }
  }
  return out;
}

/* -------------------------------------------------------------- the pace */

/**
 * Two rates, because they answer different questions. The gross rate is words
 * over the whole clip and is what a listener experiences. The articulation
 * rate takes the pauses out, so a slow gross rate can be read correctly as
 * "you stop a lot" rather than "you speak slowly" - opposite fixes.
 */
export function pace(words, gaps, dur) {
  const n = words.length;
  const paused = gaps.reduce((s, g) => s + g.len, 0);
  const talking = Math.max(0.5, dur - paused);
  return {
    words: n,
    seconds: +dur.toFixed(1),   // the speaking span, not the length of the file
    wpm: Math.round((n / Math.max(0.5, dur)) * 60),
    articulation: Math.round((n / talking) * 60),
    pausedSeconds: +paused.toFixed(1),
  };
}

/* ----------------------------------------------------------- the dialect */

/*
 * Word choice, and ONLY word choice.
 *
 * There is no accent detection in this file and that is a decision, not an
 * omission. Telling accents apart acoustically needs a classifier; the ones
 * that work (SpeechBrain's ECAPA, CommonAccent) are PyTorch and will not run
 * in Node, and no usable ONNX port exists to run beside the models already
 * here. A number invented anyway - "73% Australian" - would be a random
 * number with a progress bar on it, and it would be believed.
 *
 * What CAN be measured from a transcript is which VARIETY's vocabulary you
 * reach for, and whether you keep reaching for the same one. That is a real
 * part of what people mean by a consistent dialect, it is exactly right or
 * exactly wrong per word, and the browser accumulates it across a session to
 * answer "did I stay in one register from the first answer to the last".
 *
 * Spelling is not used and must not be added. Whisper writes American
 * spelling almost regardless of what it hears, so "color" in the transcript is
 * evidence about the model, not about the speaker. Word CHOICE survives that:
 * nothing turns a spoken "lift" into "elevator".
 *
 * Neither column is correct. PTE accepts every standard variety - this is a
 * consistency check, never a correction.
 */
const DIALECT = [
  ['elevator', 'lift'], ['apartment', 'flat'], ['truck', 'lorry'],
  ['garbage', 'rubbish'], ['trash', 'rubbish'], ['fall', 'autumn'],
  ['gas', 'petrol'], ['math', 'maths'], ['vacation', 'holiday'],
  ['movie', 'film'], ['soccer', 'football'], ['cookie', 'biscuit'],
  ['candy', 'sweets'], ['line', 'queue'], ['subway', 'underground'],
  ['sidewalk', 'pavement'], ['faucet', 'tap'], ['sweater', 'jumper'],
  ['store', 'shop'], ['parking lot', 'car park'], ['highway', 'motorway'],
  ['drugstore', 'chemist'], ['zip code', 'postcode'], ['gotten', 'got'],
  ['hood', 'bonnet'], ['trunk', 'boot'], ['diaper', 'nappy'],
  ['eraser', 'rubber'], ['schedule', 'timetable'], ['freeway', 'motorway'],
];

export function dialect(words) {
  const joined = ` ${tokens(words).join(' ')} `;
  const hits = [];
  for (const [us, uk] of DIALECT) {
    const nUs = joined.split(` ${us} `).length - 1;
    const nUk = joined.split(` ${uk} `).length - 1;
    if (nUs) hits.push({ variety: 'us', word: us, pair: uk, count: nUs });
    if (nUk) hits.push({ variety: 'uk', word: uk, pair: us, count: nUk });
  }
  const us = hits.filter((h) => h.variety === 'us').reduce((s, h) => s + h.count, 0);
  const uk = hits.filter((h) => h.variety === 'uk').reduce((s, h) => s + h.count, 0);
  // Both halves of one pair in a single answer - "lift" and "elevator" in the
  // same breath - is the clearest possible evidence of mixing, so it is called
  // out on its own rather than left to the totals.
  const mixedPairs = hits
    .filter((h) => hits.some((o) => o.word === h.pair))
    .map((h) => h.word)
    .sort();
  return { hits, us, uk, mixedPairs: [...new Set(mixedPairs)] };
}

/* ----------------------------------------------------------- the grammar */

/*
 * A small number of rules that are right essentially always, rather than a
 * large number that are right often.
 *
 * Two things make a loose rule worse here than it looks. The transcript is
 * itself a guess - Whisper mishearing "he has" as "he as" would be reported as
 * your grammar mistake - and a spoken answer is not written prose, so
 * constructions that a prose checker dislikes are perfectly good speech. Every
 * rule below is one where the flagged string is not English in any register.
 */

/*
 * Past tense -> the plain form it should go back to after `did`. A map rather
 * than a list, because every finding now has to carry the CORRECTION and not
 * only the complaint: the panel speaks the right version aloud in the chosen
 * voice, and it cannot do that from "the verb goes back to its plain form".
 */
const IRREGULAR_BASE = {
  went: 'go', saw: 'see', took: 'take', made: 'make', got: 'get', came: 'come',
  said: 'say', knew: 'know', thought: 'think', found: 'find', gave: 'give',
  told: 'tell', became: 'become', left: 'leave', felt: 'feel', brought: 'bring',
  began: 'begin', kept: 'keep', held: 'hold', wrote: 'write', stood: 'stand',
  heard: 'hear', meant: 'mean', met: 'meet', ran: 'run', paid: 'pay', sat: 'sit',
  spoke: 'speak', led: 'lead', grew: 'grow', lost: 'lose', fell: 'fall',
  sent: 'send', built: 'build', understood: 'understand', drew: 'draw',
  broke: 'break', spent: 'spend', rose: 'rise', drove: 'drive', bought: 'buy',
  wore: 'wear', chose: 'choose', ate: 'eat', won: 'win', taught: 'teach',
  caught: 'catch', sold: 'sell', threw: 'throw', flew: 'fly', fought: 'fight',
  forgot: 'forget', arose: 'arise',
};
const IRREGULAR_PAST = Object.keys(IRREGULAR_BASE);

// Base forms that simply end in the letters "ed". Without these, "didn't need"
// and "didn't succeed" would be reported as "didn't" plus a past tense.
const ED_BASE = ['need', 'exceed', 'proceed', 'succeed', 'breed', 'speed', 'bleed',
  'feed', 'heed', 'indeed', 'embed', 'shed', 'shred', 'spread'];

const NEVER_PLURAL = ['advices', 'informations', 'equipments', 'furnitures',
  'knowledges', 'homeworks', 'softwares', 'luggages', 'slangs'];

const BAD_PAIRS = [
  ['discuss about', 'discuss'], ['discussed about', 'discussed'],
  ['emphasize on', 'emphasize'], ['emphasise on', 'emphasise'],
  ['comprise of', 'comprise'], ['return back', 'return'],
  ['revert back', 'revert'], ['repeat again', 'repeat'],
  ['cope up with', 'cope with'], ['according to me', 'in my opinion'],
  ['more better', 'better'], ['most easiest', 'easiest'],
  ['married with', 'married to'], ['depend of', 'depend on'],
  ['more easier', 'easier'], ['most best', 'best'],
];

const BAD_BE = {
  'i is': 'I am', 'i are': 'I am', 'we is': 'we are', 'they is': 'they are',
  'you is': 'you are', 'he are': 'he is', 'she are': 'she is', 'it are': 'it is',
  'we was': 'we were', 'they was': 'they were', 'you was': 'you were',
};

const MUCH_PLURAL = ['people', 'things', 'problems', 'students', 'words', 'years',
  'countries', 'questions', 'ideas', 'jobs', 'books', 'friends', 'houses', 'reasons'];
const MANY_MASS = ['information', 'advice', 'money', 'knowledge', 'research',
  'equipment', 'furniture', 'homework', 'progress', 'traffic', 'news', 'work'];

// "a university", "an hour": the article follows the SOUND, not the letter, so
// both lists are exceptions to a rule written over letters.
const VOWEL_SOUND_NO = ['university', 'unique', 'user', 'union', 'uniform', 'used',
  'useful', 'european', 'one', 'once', 'utility', 'unit', 'universal', 'usual'];
const CONSONANT_SOUND_NO = ['hour', 'honest', 'honour', 'honor', 'heir', 'honestly'];

export function grammar(words) {
  const t = tokens(words);
  const joined = ` ${t.join(' ')} `;
  const out = [];
  // `fix` is what the panel says aloud. A finding without one can still be
  // read; it just has nothing to demonstrate.
  const add = (rule, text, message, fix) => out.push({ rule, text, message, fix: fix || null });

  for (const [p, right] of Object.entries(BAD_BE)) {
    if (joined.includes(` ${p} `)) {
      const [subj] = p.split(' ');
      add('agreement', p, `"${p}" - the verb does not agree with "${subj}".`, right);
    }
  }

  for (let i = 1; i < t.length; i++) {
    const aux = t[i - 1], verb = t[i];
    if (!["didn't", "doesn't", "don't", "didnt", "doesnt", "dont"].includes(aux)) continue;
    const isPast = IRREGULAR_PAST.includes(verb) ||
      (verb.endsWith('ed') && verb.length > 3 && !ED_BASE.includes(verb));
    if (isPast) {
      const base = IRREGULAR_BASE[verb] ||
        (verb.endsWith('ed') ? verb.replace(/ied$/, 'y').replace(/ed$/, '') : verb);
      add('do-support', `${aux} ${verb}`,
        `"${aux} ${verb}" - after ${aux} the verb goes back to its plain form.`,
        `${aux} ${base}`);
    }
  }

  for (const w of NEVER_PLURAL) {
    if (joined.includes(` ${w} `)) {
      add('uncountable', w, `"${w}" - this noun has no plural in English.`,
        w.replace(/es$/, '').replace(/s$/, ''));
    }
  }

  for (const [bad, good] of BAD_PAIRS) {
    if (joined.includes(` ${bad} `)) add('collocation', bad, `"${bad}" - say "${good}".`, good);
  }

  for (const w of MUCH_PLURAL) {
    if (joined.includes(` much ${w} `)) {
      add('quantifier', `much ${w}`, `"much ${w}" - "${w}" can be counted, so "many ${w}".`,
        `many ${w}`);
    }
  }
  for (const w of MANY_MASS) {
    if (joined.includes(` many ${w} `)) {
      add('quantifier', `many ${w}`, `"many ${w}" - "${w}" cannot be counted, so "much ${w}".`,
        `much ${w}`);
    }
  }

  for (let i = 1; i < t.length; i++) {
    const art = t[i - 1], w = t[i];
    if (!w) continue;
    if (art === 'a' && /^[aeiou]/.test(w) && !VOWEL_SOUND_NO.includes(w)) {
      add('article', `a ${w}`, `"a ${w}" - "${w}" opens with a vowel sound, so "an ${w}".`,
        `an ${w}`);
    }
    if (art === 'an' && /^[bcdfgjklmnpqrstvwxyz]/.test(w) && !CONSONANT_SOUND_NO.includes(w)) {
      add('article', `an ${w}`, `"an ${w}" - "${w}" opens with a consonant sound, so "a ${w}".`,
        `a ${w}`);
    }
  }

  return out;
}

/* -------------------------------------------------------- the deck words */

/**
 * Which of the 491 words you actually reached for - the point of the whole
 * project, asked of your speech instead of a text box. Knowing a word in a
 * drill and producing one unprompted are different things, and this is the
 * only place the tool can see the second.
 *
 * Matched on keyOf(), the loader's own comparison, so a match here means the
 * same thing a match anywhere else in this codebase means.
 */
export function deckHits(words, deck) {
  const t = tokens(words);
  const joined = ` ${t.join(' ')} `;
  // Crude, deliberately: a spoken "exacerbated" should count for "exacerbate".
  // Stemming properly needs a lexicon, and over-matching here costs a word
  // wrongly credited, which is the mild direction to be wrong in.
  const stems = new Set();
  for (const w of t) {
    stems.add(w);
    for (const suf of ['s', 'es', 'ed', 'ing', 'd', 'ly']) {
      if (w.length > suf.length + 2 && w.endsWith(suf)) stems.add(w.slice(0, -suf.length));
    }
    if (w.endsWith('ied') && w.length > 4) stems.add(`${w.slice(0, -3)}y`);
  }

  const hits = [];
  for (const e of deck || []) {
    // `word` is the loader's own field name for the English headword.
    const k = keyOf(e.word);
    if (!k) continue;
    const found = k.includes(' ') ? joined.includes(` ${k} `) : stems.has(k);
    if (found) hits.push({ key: e.key, word: e.word, kind: e.kind, known: !!e.known });
  }
  return hits;
}

/* --------------------------------------------------------- the read diff */

/**
 * What you said against what was written, word by word.
 *
 * The same edit distance the drill already uses on letters, run over words and
 * with the matrix kept so the path can be walked back - so it says WHICH word
 * went missing rather than that something did.
 *
 * What this measures is intelligibility, and that is the honest claim: a word
 * the model misheard is a word that was not clear. It is not a pronunciation
 * score, and it will mark a correctly-spoken word wrong now and then, which is
 * why the panel shows the pair and lets you listen rather than just asserting.
 */
export function readDiff(script, words) {
  const want = String(script || '').split(/\s+/).map(norm).filter(Boolean);
  const got = tokens(words);
  if (!want.length) return null;

  const m = want.length, n = got.length;
  const d = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = want[i - 1] === got[j - 1]
        ? d[i - 1][j - 1]
        : 1 + Math.min(d[i - 1][j - 1], d[i - 1][j], d[i][j - 1]);
    }
  }

  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && want[i - 1] === got[j - 1]) {
      ops.push({ op: 'ok', want: want[i - 1], got: got[j - 1] }); i--; j--;
    } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
      ops.push({ op: 'misread', want: want[i - 1], got: got[j - 1] }); i--; j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ op: 'missed', want: want[i - 1], got: null }); i--;
    } else {
      ops.push({ op: 'added', want: null, got: got[j - 1] }); j--;
    }
  }
  ops.reverse();

  const missed = ops.filter((o) => o.op === 'missed').length;
  const misread = ops.filter((o) => o.op === 'misread').length;
  const added = ops.filter((o) => o.op === 'added').length;
  return {
    ops,
    missed,
    misread,
    added,
    accuracy: Math.round((ops.filter((o) => o.op === 'ok').length / m) * 100),
  };
}

/* ------------------------------------------------------------ the report */

/** Everything above, over one recording. */
export function analyse({ words, pcm, text, script, deck }) {
  const p = pauses(words, pcm);
  const gaps = p.list;
  const f = fillers(words);
  const filled = gaps.filter((g) => g.kind === 'filled');
  const hesitations = gaps.filter((g) => g.kind === 'hesitation');
  const phrasing = gaps.filter((g) => g.kind === 'phrasing');
  const m = pace(words, gaps, p.span);

  return {
    text,
    words,
    // The length of the RECORDING, beside the length of the speaking in it.
    // The two being wildly apart is the signature of a failed capture, and
    // the panel refuses to report statistics over it - see the guard there.
    clipSeconds: +p.dur.toFixed(1),
    pace: m,
    fluency: {
      filled: filled.map((g) => ({ at: g.from, len: g.len, after: g.after, edge: g.edge })),
      hesitations: hesitations.map((g) => ({ at: g.from, len: g.len, after: g.after })),
      phrasingPauses: phrasing.length,
      longest: gaps.length ? Math.max(...gaps.map((g) => g.len)) : 0,
      hesitationThreshold: HESITATION,
      // EVERY gap, including the short silent ones that cost nothing. The
      // panel draws them all and each one plays back, so a call you disagree
      // with can be listened to rather than just disbelieved. `voiced` is how
      // long a sound was actually held in there, which is the number the
      // verdict was made on.
      gaps: gaps.map((g) => ({ at: g.from, to: g.to, len: g.len, kind: g.kind,
                               voiced: g.voiced, tone: g.tone,
                               after: g.after, edge: g.edge })),
      // The bar a gap had to clear, sent so the panel can say WHY nothing was
      // flagged rather than just showing nothing. "It found no fillers" and
      // "it cannot find fillers" look identical from the outside, and telling
      // them apart used to need me.
      thresholds: THRESHOLDS,
    },
    fillers: f,
    repeats: repeats(words),
    dialect: dialect(words),
    grammar: grammar(words),
    deck: deckHits(words, deck),
    read: script ? readDiff(script, words) : null,
  };
}
