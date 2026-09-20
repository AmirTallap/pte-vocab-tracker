# Session log — 20 Sep 2026

Built the **Speaking tab**: record yourself, transcribed and marked on this machine,
and then a **Re-tell Lecture** section under it with 100 lectures. Everything below
is finished and verified unless it says otherwise. Open items are at the bottom.

**This file is in a public repo.** As the 7 Sep note says: no personal email, no
Cloudflare account id, no work repository names. `npx wrangler whoami` and the
gitignored `.env` are where that lives.

The session started from a mock test result of **57 overall**, which is what the
whole tab is aimed at.

---

## 1. What the Speaking tab does

`/speaking`, a sixth view, and the **one view that exists on one host only**.

- **Whisper `base.en_timestamped`** through `@huggingface/transformers`, which
  `kokoro-js` already pulls in - no new heavy dependency. The model caches in
  `~/.cache/pte-vocab-tracker/` beside Kokoro's. ~133MB, one download.
- `ffmpeg` decodes whatever the browser recorded to 16kHz mono.
- **Nothing is stored.** The server holds the audio for one request and writes none
  of it down; the browser keeps the blob until the next take. That is the Essays rule
  and it matters more here because it is a voice.
- Three tasks: **Free talk**, **Read aloud** (timed the way PTE times it), and
  **Re-tell lecture**.

What comes back: speaking rate, fillers, hesitations, repeats, grammar faults, which
of the 491 deck words came out unprompted, dialect consistency by word choice, and -
reading aloud - every word against the script. Click any word, gap or fault to hear
that slice of the recording, cut to the sample. The word being said is underlined as
it plays.

## 2. The hard part: finding "uh" in the audio

Whisper is trained on tidy transcripts and **deletes "um" and "uh"**. Ask it for a
transcript and it reports, cheerfully, that you have no fillers at all. It cannot
delete the 400ms the "um" took, so the gaps between word timestamps are measured
directly in the samples.

That took **four wrong versions**, and the sequence is worth keeping because each was
wrong for a different reason:

1. **Loud + low zero-crossing rate.** That is a precise description of *mains hum*.
   Any room with hum, a fan or a desk rumble had every silent pause reported as an
   "uh". Fixed with a 200Hz high-pass: a vowel's pitch is down in hum territory but
   its *energy* is in the formants at 300Hz-3kHz.
2. **Still loudness-based.** Breath before a sentence is loud too. The real test is
   **periodicity** - a vowel is the vocal folds buzzing, so the waveform repeats;
   breath does not. Normalised autocorrelation over 80-400Hz.
3. **Too strict.** Tuned against a clean synthetic vowel scoring 0.97, so the bar went
   to 0.70. Through a real microphone a genuine "uh" lands nearer 0.65 and flickers
   either side of the line. Added 20ms of slack so a dip does not reset the run, and
   **swept the thresholds** against a real recording instead of guessing: periodicity
   <= 0.50 finds it, >= 0.55 misses it, false positives ZERO at every combination.
   The run length does the discrimination, not the periodicity threshold.
4. **The trim.** 150ms was being cut off *both* ends of every gap to keep word tails
   out. A 0.4s gap has 0.1s left after that, which cannot hold the 0.2s run a filler
   must show - so no short gap could ever be flagged whatever was in it. And an "uh"
   lands immediately after the word just finished, which is exactly what was being
   discarded. Now 120ms at the head (where tails bleed forward) and 30ms at the tail.

Final state: 20/20 on breath, loud breath, word tails to 0.25s, hum, hiss, silence,
and it catches "uh" down to 12% of speech level, nasal "uhm" at an 85Hz male pitch,
and "uh" over a hum.

**Known limit, not papered over:** Whisper sometimes timestamps the next word early
and swallows the filler into that word's span - roughly one time in three on a
deliberately planted filler. A **false start** ("near- nearly") is worse: splicing a
real one into a sentence produced a transcript *identical* to the clean one. It is
repaired into clean prose before this code sees anything, and word duration is far too
noisy to flag on.

## 3. The bug that wasted two rounds

A read-aloud came back reporting **360 words/min** and **2% read accurately** from a
34-second take, with a three-word transcript. Two rounds went into the filler
thresholds before the recorder itself turned out to be broken:

`getUserMedia` is a promise, so `recording` stays false while the browser hands over
the microphone. The 200ms tick that opens a timed read aloud therefore called
`startRecording()` **again on every tick** until it resolved - each call opening
another stream, building another `MediaRecorder` over the top of the last, and
clearing the shared `chunks` array the real one was still filling.

Fixed with a synchronous `starting` flag. Verified by reproducing the race with a
deliberately slow 1.2s handover spanning six ticks: one mic request, one recorder.

**A failed capture is now reported as a failed capture**, never dressed up as
statistics - if the speaking found inside a clip is a small fraction of the clip, the
panel says so and says the numbers below mean nothing.

## 4. Other things that bit

- **`var speech` collision.** The page already had `var speech = new Audio()` for its
  TTS. A second `var speech = {...}` for this tab in the same function scope silently
  clobbered it at load, breaking `Hear it` and speak-on-reveal **across the whole
  app** while the Speaking tab itself looked fine. The tab's object is `mic` now.
- **Overlapping `speak()` calls.** One speaker button was safe; a report full of them
  is not. The second assigned `src` while the first's `play()` was pending, the browser
  aborted the first, and the catch painted a red error for what was just a newer click
  winning. `speakSeq` now makes a superseded request bail before touching the element.
- **Suspended AudioContext.** A context built in a fetch callback is born suspended;
  its clock never advances, so a source started against it never plays and never fires
  `onended`. Decoding goes through an OfflineAudioContext and the real context is made
  inside the click.
- **`duration` is NaN when `play()` resolves.** Playback begins before metadata is
  read. Reading duration at that instant and giving up left the underline permanently
  unstarted - while every test that stubbed the media clock said it worked.

## 5. "Hear it properly" read the mistakes back

Worth recording as a design failure. The buttons were moved under the paragraph with
an underline that follows the audio, and to make the underline line up with the text
directly above it, "Hear it properly" was pointed at the **transcript**. In a read
aloud that is *what you actually said* - so a button labelled "properly" read your own
errors back in a pleasant voice.

The fix was not to swap the text back but to **underline the script where the script
is**: the prompt panel is word-spanned, lights up as the model reads, and scrolls into
view. The script also carries the reading written into it - every word green, and
beside any word you replaced, what came out, in red, struck through. A word never said
is struck on the word itself and gets **no red chip**: a chip is for something you put
there instead, and an absence is not that.

## 6. Re-tell Lecture

100 lectures, written by **ten parallel agents**, one JSON file each in
`data/lectures/` - the grammar-module layout, for the reason `CLAUDE.md` gives there.
189-210 words, 5-6 checkable points, ten subject areas, zero validation problems.

- You hear it **once**; the text is deliberately not on screen. PTE's own 0:10 to
  think and 0:40 to speak, auto-submitted.
- The report shows the lecture, then what you said **with the pauses written in**
  (`[1.2s]` silence, `(uh 0.5s)` filled), then a **copyable prompt** asking a model for
  coverage, grammar, own-words and one fix.
- **The tool does not score coverage, on purpose.** Every cheap way of checking it -
  shared words, keyword matching - rewards parroting the lecture's phrasing, which is
  the opposite of what "in your own words" means and of what PTE marks. It assembles
  the evidence and hands it over instead.
- The Play button has a **two-phase progress bar**: synthesis is ~0.23s per word and
  sends nothing until it is done, so a pure download bar would sit at 0% and then jump.
  The estimate phase is amber and says so; real bytes turn it teal with a true
  percentage.

## 7. What is NOT done

**Real lecture audio.** The synthetic voice is the weakest part of the Re-tell tab -
PTE uses real recorded lecturers with real accents and room acoustics, and Kokoro is
clean, fluent and American.

Ripping YouTube was asked for and declined: it breaks their Terms of Service and the
recordings are not ours to splice or to commit.

The openly-licensed route was then surveyed, and the honest finding is that **it is
thinner than it looked**:

| source | result |
|---|---|
| `collection:MIT_OpenCourseWare` on archive.org | **does not exist** |
| "MIT OpenCourseWare" audio on archive.org | 23 items, CC BY-NC-SA 3.0, niche (music composition, game design) |
| CC-BY lecture audio | **3 items** |
| CC-BY-SA lecture audio | 52, mostly one low-quality series |
| Public-domain lecture audio | 165, largely religious talks and non-English |
| CC-BY-NC-SA lecture audio | 126, mixed; a few real university recordings |

So archive.org is not a good well for academic English lectures. The better route is
**ocw.mit.edu directly** (CC BY-NC-SA, real academic English, licence permits
excerpting with attribution), which needs a different fetch path than the archive.org
API and was not built.

Two things make it tidier than it sounds when it is picked up:

- **The audio never needs to leave the machine.** The Speaking tab is local-only
  already, so excerpts belong in a gitignored directory - not in the repo, not on
  Cloudflare. That keeps the licensing simple.
- **Whisper is already installed**, so a spliced 60-90s excerpt can be transcribed
  automatically - which is exactly what the prompt needs. No manual transcription.

Sketch, if resumed: commit the *recipe* (source url, start offset, length, licence,
credit) in the lecture JSON and gitignore the audio, so it is reproducible from a
script rather than redistributed.

**Also open, from earlier in the session:** speech-to-text on the Cloudflare build.
The stated reason for local-only was that Whisper has nowhere to live on a Worker,
which is true but was the wrong question - the page runs in a *browser*, which can run
it via transformers.js with WebGPU. ~73MB one-time download with both parts quantised.
It would keep the privacy promise exactly, since the audio still never leaves the
machine it was recorded on. Deferred pending who it is for: it is a big download for a
public page, and likely unusable on a phone.

**Droplet 4395** was raised several times and never actioned - no hostname, no
`doctl`, and 352 `known_hosts` entries, so it was never resolved to a host and nothing
was touched.

## 8. Housekeeping

- `API_VERSION` **9 -> 10** (speech routes) **-> 11** (lecture routes). Restart the
  server after pulling.
- Speaking is hidden on the cloud build: `web/cloud-store.js` answers
  `/api/speech/status` with `available:false`, `/speaking` falls back to `/practice`.
  Verified on the live URL.
- Mid-session push and deploy: two commits to GitHub, and the Worker redeployed after
  the account was checked with `npx wrangler whoami` (personal, via `.env` token - no
  `wrangler login`, per Rule 0). The Re-tell work in this commit was **not** deployed:
  the tab is invisible on that host, so there is nothing to ship.
- Testing note: the browser used for verification runs its tab **hidden**, where Chrome
  clamps timers to once a minute, freezes `requestAnimationFrame`, and never loads
  audio metadata. Several measurements timed out or read as failures for that reason
  alone. `MessageChannel` scheduling is the way round the timer clamp.
