# CLAUDE.md — pte-vocab-tracker

## ⛔ RULE 0 — THIS PROJECT IS SEPARATE FROM THE WORK PROJECTS ON THIS MACHINE

**Hard rule, set by amir on 2026-08-30.**

This is a personal study tool for the PTE exam on **19 December 2026**. It has nothing
to do with any of the work repositories or hosts on this machine, and it never will.

- **The work `CLAUDE.md` files under the shared web root DO NOT APPLY HERE.** Not their
  Rule 0's mandatory pull from the deploy remote, not the session-log requirement, not
  the architecture-approval rule, not the deploy or nginx rules, not "read DB records
  on the server only". Do not open those files for work in this directory.
- **There IS now a remote and a deploy, and they are amir's own** (7 Sep 2026). The
  repo is `github.com/AmirTallap/pte-vocab-tracker`, private, pushed with the `gh`
  login already on this machine. The page is deployed to **`pte-vocab.amirfox.workers.dev`**
  on amir's **PERSONAL** Cloudflare account
  and the reason another personal project's rule is repeated here:
  **never `wrangler login` on this machine.** That OAuth session belongs to the work
  account. Authenticate only through `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
  in the gitignored `.env` - wrangler's reserved auth vars, never bound into the
  Worker. Check with `npx wrangler whoami` if in any doubt: it must report the personal
  account, not the work one.
- **There is still no database, and nothing of anyone's is stored on that Worker.**
  Progress in the cloud build is the visitor's own `localStorage`. `rmt`,
  push-to-deploy, the nginx URL allowlist, the menu cache and `pm.max_children` are
  still meaningless here, and so are D1, R2 and KV.
- **Do not move this project under the shared web root.** It was first built inside
  one of the work repositories and moved out precisely because that put it inside
  someone else's git repo. It lives at `~/pte-vocab-tracker` and stays there.
- Nothing here is a precedent for the work projects, and no incident there is a
  precedent here.

---

## What it is

A study tool for the two vocabulary sheets, English ↔ Arabic - **284 academic words
+ 207 complex phrases** as of 3 Sep 2026, and it grows whenever a word is added -
plus a **grammar syllabus of 24 modules / 288 questions** at B2-C1, plus
**60 PTE-style Write Essay prompts** on the Essays tab, each with **three worked
model answers** and a guide to writing one, plus a **Speaking tab** that records
you, transcribes it on this machine and marks the fluency, the fillers and the
grammar - with every fault clickable to hear the exact moment it happened.

```bash
npm run web        # THE way to use it: browser page on http://localhost:4173
npm run cf:deploy  # publish the cloud build (source ./.env first - see Cloud build)
```

Everything else is optional terminal equivalents — see `README.md`.

There are **two hosts and one rulebook**: this local tool, backed by the workbook,
and a public build at **`pte-vocab.amirfox.workers.dev`** backed by the visitor's
own `localStorage`. See **Cloud build** below. The Speaking tab is the one view
that is local-only, and it hides itself on the other host rather than forking the
page - see **The Speaking tab**.

## How it works

- **`data/PTE_Vocabulary_Master.xlsx` is the single source of truth** for the `Known`
  flag. The browser page is a front end for that file, not a separate copy: marking a
  word known in the browser writes `Known = TRUE` into the workbook. Never introduce a
  second store for mastery state.
- **A new word is a new row, and nothing else.** `POST /api/entry/new` appends to
  `deck[kind]` and lets the ordinary debounced workbook write carry it to the
  `.xlsx` - there is no separate list of "words I added" to reconcile. It rejects
  a word already on that sheet using `keyOf()`, the loader's own comparison, so
  the browser cannot create the kind of duplicate row the loader has to merge on
  load. The Add word and Reset all buttons are on the word list; the list marks
  nothing one at a time, because marking is the drill's job.
- `data/progress.json` holds view/seen history, the numbered study batches
  (`studyBatches`), grammar answers (`grammar`) and the flags (`flags`) - no
  vocabulary mastery state.
  `data/backup_words.json` is an empty reserve of extra vocabulary, drawn on when an
  unknown pool runs dry.
- **Grammar content is static and lives in `data/grammar/*.json`, one file per module**
  (`src/grammar.js` loads it). It is never written back. Only the learner's answers are
  written, into `progress.json` under `grammar`, as right/wrong counts per question.
  This is not a second mastery store: it is a different subject, and the workbook has
  no column for it.
- **Example sentences are static content too, in `data/usage/*.json`, one file per
  sheet** (`src/usage.js` loads it, `GET /api/usage` serves it whole). They are keyed
  by the loader's own `keyOf()`, so a sentence set follows its row however Excel
  re-capitalises it, and they are never written back - nothing there is study state.
  They are not carried on the deck entries: `/api/deck` is re-sent whole by every
  mark, add and reset, and this is the one part of that payload that would grow
  without limit as more of the deck gets sentences. They are not fetched per card
  either - the reveal is drawn synchronously, and a round trip there is exactly the
  stutter the audio prefetch exists to hide. The page fetches them once at boot.
  Inside a sentence `[[...]]` wraps the form actually used, and the browser expands
  it to `<b>` *after* escaping. It is marked in the data rather than matched in the
  browser because the used form is usually not the headword - `pervades` appears as
  `[[pervaded]]`, `spur` as `[[spurred]]` - and a regex over a multi-word phrase
  would either miss those or bold the wrong half of the line. An entry with no
  sentences shows none; there is one `renderCard()` and one reveal block, so the
  whole-deck drill and a batch drill get them from the same place.
- **The essay prompts are static content too, in `data/essays.json`** - one file,
  because 60 prompts is 20KB with nothing underneath them to grow into.
  `src/essays.js` loads it, `GET /api/essays` serves it whole, and it is never
  written back. Neither is the essay: there is no POST beside that route, and
  nothing on that tab touches the workbook or `progress.json`. **The essay you
  type is a rehearsal, not a document** - what it is for is the twenty minutes
  and the word count, and a library of past attempts would be a third store to
  back up, migrate and reason about. The draft is kept in the browser beside the
  other view settings (`settings.essay`) purely so a stray reload does not cost
  you twenty minutes; that is insurance, not storage, and it is not a mastery
  store of any kind.
- **Three worked model answers per prompt live in `data/models/<id>.json`**,
  one file per prompt, the way the grammar syllabus is one file per module and
  for the reason CLAUDE.md gives there: a bulk script over a directory of
  authored content is how sixteen grammar modules were corrupted at a stroke.
  Edit one file, by name. Static content, read at startup, never written back -
  a model answer is something to read, and it is not study state of any kind.
  180 essays is about 300KB, which is why `/api/essays` carries only a *count*
  per prompt and `/api/essays/models/<id>` serves one prompt's essays when the
  panel is opened. That is the opposite call from `/api/usage`, deliberately:
  the drill's reveal is drawn synchronously and a round trip there is the
  stutter the audio prefetch exists to hide, whereas opening the model answers
  is a click that can afford one.
- **Every model answer scores 100, and the number is stamped in `src/models.js`,
  not stored in the data.** These are exemplars written to be full marks. A
  `score` field in 180 files is a field that one day says 99 in one of them and
  quietly teaches the wrong lesson.
- **The word band is checked at load and reported at startup, not repaired.**
  200-300 words is the exam's rule, so an example outside it is teaching the
  wrong thing and the fix is to rewrite the paragraph. Em *and* en dashes are
  rejected too, by request - a checker that caught only one would let the other
  through.
- **Inside a model essay, `[[...]]` marks a word taken from the deck and the
  browser paints it green**, using the same escape-then-expand as the usage
  sentences. Where the form used is not the headword the marker carries both,
  `[[exacerbates|Exacerbate]]`, and the second half is what `data-vw` is set to
  and what the hover card looks the row up by - so a marker missing its pipe
  shows no example sentences at all. The pipe is for inflections ONLY: filing
  one phrase under a different one paints green over a word that was never
  practised and hands the reader another row's sentences. `tools/check-models.js`
  rejects that, and its `--fix` adds a headword only where exactly one deck
  entry matches after a suffix is stripped.
- **The green words carry the word list's own hover card.** Same `usageHtml(e,
  "tip")`, same single `.tip` element, same delegation to the panel - which is
  rebuilt whenever you switch between the three answers, exactly as the tables'
  rows are. A second set of example sentences anywhere in this page would
  eventually disagree with the first. A green word that has sentences drops its
  `title` attribute, as `wordLink()` does on the word list: the browser's own
  tooltip over the top of the card is one tooltip too many.
- **How to write an essay is `data/essay_guides.json`** - the general method,
  the twenty minutes, and one recipe per question type - served inside
  `/api/essays` because it is a few KB that every prompt shares. One file, not
  one per type, for the reason `essays.json` is one file: there is nothing
  underneath it to grow into.
- **The 20-minute clock starts when a question is ROTATED**, not on a start
  button - that is what the exam does. `pickEssay()` is the only place that
  knows it, and Next question, Random and the dropdown all go through it; a
  second copy of the rule in one of those three handlers is how they would
  drift apart. The countdown is a *deadline* (`settings.essay.endsAt`), not a
  running total, so it survives a reload and keeps going while you are on
  another tab - only the repainting stops, which is all the interval was ever
  for. `Restart timer` resets the clock and keeps the question and the prose;
  taking a new question is the other button and it clears both. **With no
  question taken, that same button reads `Start timer`** and is never disabled:
  timing yourself against a prompt brought from somewhere else, or writing to
  the clock with no prompt at all, used to be impossible here. One button, one
  handler, two labels - a second handler for the standing start is how the two
  would drift apart, and rotating a question still starts the clock through
  `pickEssay()` without touching this one.
- **The Essays view's markup is in the page, not built by a render function.**
  `renderEssay()` refills the prompt panel and the counters and never touches
  the textarea - a repaint that replaced that element would take the essay and
  the cursor with it. Same rule, same reason, as the drill repainting the flag
  button rather than the card.
- **The same sentences are the tables' hover card**, on the English cell of the word
  list and of a batch - `usageHtml(e, "tip")`, the one function, so the drill and the
  tables can never show different examples. One card element is moved and refilled
  rather than one built per row, and the listener is delegated to the `<tbody>` for
  the reason the head's is: the rows inside are rebuilt on every paint. It is
  `position: fixed` because it is placed from `getBoundingClientRect()` and the list
  scrolls, `pointer-events: none` so it cannot eat the pointer that summoned it, and
  it is hidden on scroll, resize and `beforeprint`. `wordLink()` drops its `title`
  attribute for a row that has sentences - the browser's own tooltip over the top of
  the card is one tooltip too many.
- **Grammar marking happens on the server, on purpose.** `/api/grammar` strips
  `answer`, `accept` and `explain` out of what it sends, so the page cannot be read for
  the answers; `/api/grammar/answer` returns the verdict and the explanation for one
  question at a time. Do not move marking into the client "to save a round trip".
- **The two stores have different write policies, deliberately.** Workbook writes are
  debounced ~800ms, because each one is a 275KB rewrite. `progress.json` is 1KB and is
  written *immediately* on batch create/delete - a batch number exists nowhere else and
  can never be reused, so it must not sit in memory waiting out a debounce. Marks still
  ride the debounce.
- Writes are flushed on SIGINT, SIGTERM, **SIGHUP** and SIGQUIT, and on an uncaught
  exception. SIGHUP is the one that used to lose batches: closing the terminal window
  hangs up the process, and Node's default action for SIGHUP is to die immediately
  without running any handler.
- `progress.json` is written temp-file-then-rename with an fsync, so a crash leaves the
  previous file rather than a truncated one. Both files get a timestamped backup once
  per server session, before that file's first write - `progress.json` included, which
  it was not until 31 Aug 2026.
- Each store is written inside its own `try`, progress first. A workbook write that
  throws (file open in Excel, disk full) used to be an uncaught exception in a timer
  callback, which killed the process and took the unwritten batches with it; it now
  prints, keeps the data dirty, and retries on the next write.

---

## The Speaking tab

Added 20 Sep 2026, after a mock came back at 57. `/speaking`, and it is the one
view that exists on **one host only**.

- **It is local, and the cloud build says so rather than hiding the code.**
  `web/cloud-store.js` answers `/api/speech/status` with `available:false`, the
  page hides the tab, and `web/app.html` stays ONE file for both hosts - the
  rule the Essays and Batches tabs already live under. Do not fork the page to
  cut this tab out. Whisper is 133MB plus an `ffmpeg` process and has nowhere
  to live on a Worker, which is the same wall that sent the audio to a
  pre-rendered manifest; and sending a visitor's voice to a public URL with no
  account behind it is not something this project will do.
- **Nothing is stored, on either side.** `/api/speech/analyse` holds the audio
  for the length of one request and writes none of it down; the browser keeps
  the blob in memory until the next take replaces it. There is no history, no
  past attempts and no export, and none should be added. It is the Essays rule
  - what you said is a rehearsal, not a document - and it matters more here
  because it is your voice. `speech.session` is the single exception: a handful
  of numbers per recording, in memory, so the consistency panel can compare
  turns. A reload empties it.
- **There is no accent detection and that is a decision, not a gap.** Telling
  accents apart acoustically needs a classifier; the ones that work (SpeechBrain
  ECAPA, CommonAccent) are PyTorch and will not run in Node, and an ONNX search
  returns nothing usable. "73% Australian" invented anyway would be a random
  number with a progress bar, and it would be believed. What `dialect()`
  measures is **word choice** - `lift`/`elevator`, `maths`/`math`, `gotten` -
  which is exactly right or exactly wrong per word, and the browser accumulates
  it across a session to answer the question actually asked: am I consistent
  from the first answer to the last. Neither column is correct; PTE accepts
  every standard variety.
  **Never add spelling markers to that table.** Whisper writes American
  spelling almost regardless of what it heard, so `color` is evidence about the
  model, not the speaker. Nothing turns a spoken "lift" into "elevator".
- **Filled pauses are found in the AUDIO, not in the transcript.** Whisper is
  trained on tidy transcripts and deletes "um" and "uh" outright - ask it and it
  will report cheerfully that you have no fillers at all. It cannot delete the
  400ms the "um" took, so `pauses()` reads the samples inside each gap between
  word timestamps: voiced and loud relative to the room is a filled pause, quiet
  is silence, and noisy-but-quiet is a breath and is deliberately not a fault.
  This is why the model is the `_timestamped` build; the ordinary `base.en`
  would make the whole feature impossible.
- **Everything below 200Hz is filtered out before a single measurement is
  taken, and that line is the whole of `pauses()` being correct.** The first
  version tested for "loud, with a low zero-crossing rate", which is a precise
  description of MAINS HUM - so a room with any hum, fan or desk rumble in it
  had *every silent pause reported as an "uh"*, and the quieter the recording
  the worse it got, because the threshold is relative to the speech. A vowel's
  pitch is down in hum territory too, which is why pitch cannot be the
  discriminator; a vowel's ENERGY is not, it is in the formants at 300Hz-3kHz,
  and that is what makes it a vowel rather than a drone. Three one-pole
  sections, ~18dB/octave. Do not take the filter out to "keep more signal".
- **A filled pause is PERIODIC, and that test is the one that matters.** Hum
  and loudness were red herrings; the failure that showed up in real use was an
  "uh" printed at every full stop, because what lives in a sentence-boundary
  pause is a breath and the tail of the word just finished - both loud, neither
  a filler. A vowel is the vocal folds buzzing, so the waveform REPEATS at the
  pitch period. Breath does not repeat, and a word tail is not a filler at all.
  `periodicity()` is a normalised autocorrelation over lags 40-200 (80-400Hz),
  run only on frames that already passed the loudness test because it is the
  expensive thing in the file.
- **It is a continuous RUN of voicing, not a percentage and not a peak.**
  Scattered frames reach any percentage you like without a sound ever being
  held, and a breath touches 0.82 periodicity for one instant. The run is what
  separates them and it does nearly all the work - see the sweep below, where
  the false-positive count is zero at *every* periodicity tried.
- **A brief dip does not end the run.** Measured clean, a synthetic vowel
  scores 0.97 frame after frame; through a microphone with a room behind it, a
  real "uh" flickers either side of the line, and a rule that reset on every
  dip scored a continuous half-second filler as 0.08s and threw it away. Two
  frames of slack, 20ms - far shorter than any filler, far too short for noise
  to chain through. Only frames that genuinely passed are counted, so the
  reported `voiced` is still how long a sound was really held.
- **The thresholds were swept, not chosen.** Against a real recording - three
  sentences read aloud with breath in every pause, once with a half-second "uh"
  in the first gap and once without: periodicity <= 0.50 finds it, >= 0.55
  misses it, and false positives are ZERO at every combination tried. Hence
  0.50 strict / 0.45 sensitive. Reading the clean synthetic 0.97 as "0.70 is
  safe" is exactly the mistake that made a version of this miss real fillers:
  the threshold has to sit below what a real microphone measures, about 0.65,
  not below the laboratory figure.
- **One set of thresholds, and no control for them.** There was briefly a
  strict/sensitive toggle in the toolbar. It was the wrong answer to "I cannot
  calibrate this from here": it put a word in front of the reader that they had
  no way to interpret and asked them to tune an acoustic threshold, which is
  not their job. `THRESHOLDS` in `src/speech.js` is the one place; if the
  numbers are wrong they get fixed there.
- **The gap is trimmed at the HEAD, barely at the tail, and the difference is
  not cosmetic.** 150ms off both ends - the first attempt at keeping word tails
  out - made the whole feature dead for short gaps: a 0.4s gap has 0.1s left
  after that, which cannot hold the 0.2s run a filler must show, so no short
  gap could ever be flagged whatever was in it. And an "uh" normally lands
  immediately after the word just finished, which is exactly the region being
  discarded. It is 120ms at the head, where the previous word's tail bleeds
  forward and is voiced, periodic and the same speaker; 30ms at the tail, which
  only ever holds the next word's onset. The RUN length is what rejects a tail,
  and it does it better: Whisper's boundaries are wrong by tens of
  milliseconds, not 200, so a tail cannot sustain long enough to qualify.
- **When nothing is flagged, the panel says what came CLOSEST and what it
  needed.** "It found no fillers" and "it cannot find fillers" look identical
  from the outside, and telling them apart cost two rounds of guessing. The
  nearest gap is named with its held-sound duration, its voicing, and the bar
  it failed - and it plays back. `thresholds` rides along in the report for
  exactly this.
- **Exactly one recorder can be live, and `starting` is what guarantees it.**
  `getUserMedia` is a promise, so `speech.recording` stays false for as long as
  the browser takes to hand over the microphone. The 200ms tick that opens a
  timed read aloud therefore called `startRecording()` again on every tick
  until it resolved - each call opening another stream, building another
  `MediaRecorder` over the top of `speech.rec`, and clearing the shared
  `chunks` array the previous one was still filling. A 34-second take came back
  as half a second of audio, and the panel dutifully reported 360 words per
  minute and 2% read accurately over the three words that survived. The
  synchronous `starting` flag closes the window; `speakTick` also leaves the
  prep phase BEFORE the await so the branch cannot be re-entered; and the
  resolver stops any stream or recorder that is somehow still open. Any new
  await on this path needs the same treatment.
- **A failed capture is reported as a failed capture, never as statistics.**
  If the speaking found inside a clip is a small fraction of the clip - few
  words, tiny span against a long recording - the panel says so at the top and
  says the numbers below mean nothing. The figures in the bug above were
  arithmetically correct and completely meaningless, and they sent two rounds
  of investigation at the filler thresholds when the recording itself was
  broken. `clipSeconds` rides in the report for exactly this.
- **The Speaking tab's state object is `mic`, and it must never be called
  `speech` again.** `var speech = new Audio()` is the page's TTS element,
  declared a thousand lines earlier in the same function scope; a second
  `var speech = {...}` for this tab silently clobbered it at load, which broke
  `Hear it` and speak-on-reveal across the *whole app* - the drill, the word
  list, everything - while the Speaking tab itself looked fine. Nothing errors:
  the audio element simply stops existing. Check the scope before naming a new
  top-level `var` in `web/app.html`.
- **Every fault carries a machine-readable `fix`, not only prose.** The panel
  speaks the correct version aloud in the chosen voice, and it cannot do that
  from "the verb goes back to its plain form" - hence `IRREGULAR_BASE` as a map
  rather than a list, and `BAD_BE` as a map. A rule that cannot say what the
  right answer IS can still explain itself; it just has nothing to demonstrate.
- **Two controls, two meanings, and they must stay distinguishable.** The grey
  one replays what you actually said, out of the recording still in the
  browser; the teal one says it properly through Kokoro in whichever voice the
  voicebar has. Hearing those back to back is the entire exercise - a fault
  list you cannot hear is a list of spellings. The click handler checks
  `[data-say]` BEFORE `[data-from]`, because a speaker button sits inside a row
  that also replays the recording and the button is the more specific intent,
  and each stops the other first so they never talk over each other.
- **The two ways to hear it live UNDER the paragraph**, not in the toolbar,
  because that is what they both play. `Play it back` is your own recording;
  `Hear it properly` is the model voice.
- **"Properly" means the SCRIPT, never the transcript.** In a read aloud the
  right words are the script's; the transcript is what you actually produced,
  mistakes and all. Wiring that button to the transcript - which was done
  briefly, to make the underline line up with the text directly above it - had
  it read your own errors back to you in a nice voice, under a button labelled
  "properly". Free talk has no script, so there it really is your own words
  said the way they should sound, and that is the only case where the two
  coincide.
- **The underline follows the text being spoken to wherever that text is
  drawn**: the script lights up in the prompt panel at the top, the transcript
  lights up in the panel below, and clicking in a read aloud scrolls the script
  into view first. One rule, two places, and neither pretends to be the other -
  which is why the script is rendered as word spans rather than plain text.
  The paragraph one is deliberately NOT prefetched: it takes the model many
  seconds on a first render and would hold every short correction on the page
  behind it. The per-fault corrections ARE prefetched, with `force`, because
  `settings.voice.auto` governs whether the drill talks at you unprompted -
  a different question from whether a button the reader is looking at should
  answer instantly.
- **The script carries your reading written into it.** Every word green,
  because the script IS the right answer; beside any word you put something
  else in place of, what came out, in red. The pair only means anything
  together - "the word that was wanted, and the word you said instead" is one
  fact, not two - so it belongs on the script rather than in another list
  further down, and it is the text the model voice reads, so the underline
  walks across it while you hear the difference.
  A word **never said** is struck through on the word itself and gets NO red
  chip: a chip is for something you put there instead, and an absence is not
  that. On a read that went badly wrong the chip version welded forty "not
  said" labels between the words and the sentence stopped being readable.
  The red chips are deliberately not class `w` - the model voice's timing is
  shared across the script's words, and counting them would slide the
  underline off the text.
- **The model head waits for a duration that is actually a NUMBER.** `play()`
  resolves when playback BEGINS, which can be before the blob's metadata has
  been read - and until then `duration` is NaN. Reading it at that instant and
  giving up silently left the underline permanently unstarted, while every test
  that stubbed the media clock reported it working. `startModelHead()` now
  hangs on `durationchange`/`loadedmetadata` and only unhooks once the value is
  finite: that event fires on its way to being known as well as on arrival, and
  unhooking on the first one throws away the only notification that matters.
  It is token-guarded too (`mic.headSeq`), because a listener left over from an
  earlier click must not start a head for audio that has since been replaced -
  two heads fight over the same `mic.phRaf`, and the second one's
  `resetCorrections()` wipes the corrections the first had already made.
- **The correction is tied to the PLAYHEAD, not to the report.** When the voice
  reaches a word you got wrong, the red word collapses - width as well as
  opacity, so the right word slides into the space rather than leaving a hole -
  and the correct word settles down into its place. It happens exactly when you
  HEAR it, which is the whole reason it is not done on load. Corrections stay
  put once passed, because watching a fix un-happen would be worse, and a fresh
  play resets them so the reading starts as it was. `prefers-reduced-motion`
  turns the movement off and keeps the outcome.
- **`runPlayhead(spans, clock, alive)` is driven by whichever audio is
  playing.** The recording supplies real spans and the AudioContext clock; the
  model voice supplies estimated spans and the media element's `currentTime`.
  One loop, one `.is-said`, so the two can never disagree about what is lit.
- **The model voice's word timings are ESTIMATED, and the page says so.**
  Whisper measured the recording, so the underline over it is exact. Kokoro
  returns a WAV and nothing else - there is no alignment in it, and getting one
  would mean transcribing audio we just synthesised, which costs more than the
  playback. So the duration is shared out by weight: letters, plus a little for
  the breath a comma or a full stop buys. It tracks well enough to follow, and
  the hint under the buttons calls it estimated rather than letting it pass as
  a measurement.
- **Overlapping `speak()` calls are a normal event now, and `speakSeq` is what
  makes them harmless.** One speaker button was safe; a report full of them is
  not. Two overlapping calls meant the second assigned `src` while the first's
  `play()` was still pending, and the browser aborts the first - *"The play()
  request was interrupted by a new load request"*. That is not a failure, it is
  the newer click winning, but the catch treated every non-autoplay rejection
  as one and painted a red error for it. A superseded request now bails before
  it touches the element at all, and `AbortError` is swallowed on both paths -
  it also arrives when `stopSpeaking()` silences something on purpose.
- **Known limits, not to be papered over:** Whisper sometimes timestamps the
  following word early and swallows the filler into that word's span, and then
  there is no gap to look inside and the "uh" is missed. Measured at roughly
  one time in three on a deliberately planted filler.
  A **false start or repair is worse: it cannot be seen at all.** Splicing a
  real `near- nearly` into a sentence and transcribing it gives a transcript
  *identical* to the clean one - same words, same text - with the only residue
  an extra 0.08s on a 0.18s word span. Whisper repairs disfluency into clean
  prose before this code sees anything, so `repeats()`, which looks for a word
  that is a prefix of the next, has nothing to work with. Word duration is the
  only remaining signal and it is far too noisy to flag on: in that same
  sentence, honest word durations ran from 0.06s to 0.66s.
  The panel shows every gap with its measured `voiced` and `tone` so a
  disagreement can be listened to rather than argued about, and that is the
  honest answer here rather than a cleverer threshold.
- **The noise floor is capped at 3% of the speech level, and the cap is
  load-bearing in both directions.** (Kept for the reason below, though the
  periodicity test now carries the discrimination.) The floor is a low quantile over every
  frame, so a long "uhhh" is part of the sample it is measured against: fill
  enough of a short clip and the filled pauses raise the floor until they sit
  under it and vanish - telling exactly the people who do it most that they
  never do it. But at 6% the `floor * 3` term came out at 18% of speech and
  quietly became the binding threshold, which is *above* a softly-said "uh" at
  about 17% - so the backstop was overruling the real test. It is a backstop;
  it must never bind.
- **Every gap comes back from `pauses()`, labelled, including the short silent
  ones that cost nothing**, and the panel draws them all with the measured
  `voiced` seconds in the tooltip. A detector that silently discards what it
  judged uninteresting is a detector you cannot check, and this one has been
  wrong before. Each chip plays back, so a verdict you disagree with can be
  listened to rather than just disbelieved.
- **Dead air at the two ends is not hesitation.** A silent gap before the first
  word or after the last is the fumble for the stop button, and counting it made
  a clean answer report a pause it never contained. A *filled* edge is kept -
  "ummm, I think..." really does start with one. Every rate is measured over the
  speaking span, first word to last, so leaving the recorder running cannot make
  you look slow.
- **The grammar rules are precision over recall, always.** The transcript is
  itself a guess, and a spoken answer is not prose - so every rule is one where
  the flagged string is not English in any register. `ED_BASE` and the two
  article exception lists exist for that: without them "didn't need" and "a
  university" are reported as your mistakes. A false "you said that wrong"
  against an answer that was right is the same failure the grammar grader calls
  the worst this tool has. Fix the list, never loosen the rule.
- **Playback is Web Audio, and the context is built inside the click.**
  `AudioBufferSourceNode.start(when, offset, duration)` plays an exact sample
  range, which is what makes clicking a fault land on the fault. A context made
  anywhere else - in the fetch callback that decodes the recording - is born
  SUSPENDED, its clock never advances, the source never plays and `onended`
  never fires, so the highlight sticks on the word for ever with no error
  anywhere. So `decodeForPlayback()` decodes through an **OfflineAudioContext**,
  which needs no gesture, and `playCtx()` makes the real one on first click.
  Be straight about the limit: playback is sample-exact, but the boundaries are
  Whisper's alignment, good to about 20ms. Hence the small pad either side.
- **The playhead runs off the AUDIO clock, not a wall clock.** `runPlayhead()`
  underlines the word being said from `ctx.currentTime`, which is the clock the
  sound is actually coming out on - so the underline cannot drift from what you
  hear however busy the page gets, and half speed needs no special case because
  multiplying by the rate does it. `Date.now()` would slide by a word or two
  across a long playback, which is worse than no underline at all. It is an
  *underline* rather than a fifth background colour because all four backgrounds
  already mean something and a colour sliding over them would read as a word
  changing category as it was spoken. Between two words the underline stays on
  the one just finished rather than blinking off: a flicker reads as a fault in
  the page. A backgrounded tab freezes rAF, so the underline stops while the
  audio plays on - the same bargain the level meter and the essay countdown
  already make.
- **Green is CORRECT, and a deck word is a dotted underline.** They are
  different kinds of fact - one is right-or-wrong, the other is which
  vocabulary you reached for - so they get different channels and combine
  freely rather than one overwriting the other. Green means the word matched
  the script in a read aloud, and the weaker, honest thing in free talk, where
  there is no reference at all: nothing was found wrong with it. Those are
  different claims and the legend says which is in force rather than letting
  one colour stand for both.
- **A `▶` at the head of each sentence plays from there to the END of the
  recording**, while clicking a word still plays only that word. Both are
  wanted and they are not the same gesture: one is "what exactly did that sound
  like", the other is "let me hear this part again in context". Sentences come
  off Whisper's own punctuation, and fall back to even runs when it did not
  punctuate - a pointer you can only put at the very beginning is not a pointer.
- **The colour key is a legend above the transcript, and it names the PLAIN
  words too.** It was a grey note underneath and that was wrong twice over: a
  key is needed while reading, not afterwards, and listing only the marked-up
  categories leaves the reader guessing what the unmarked majority means. The
  honest answer - nothing was found in it - is worth its own line. Green is a
  deck word *produced unprompted*, which is the one thing on that panel worth
  being pleased about.
- **The read aloud is timed and submits itself.** PTE shows you the text, gives
  you a fixed while to read it, opens the microphone on its own and submits when
  the clock runs out - there is no Stop button in the exam. Both allowances scale
  with the length of the script and are clamped. `prepEnds` is a wall-clock
  **deadline**, not a running total, for the reason the essay timer is: it
  survives the tab losing focus and only the repainting stops. One button, three
  labels, one handler - `Start`, `Record now`, `Stop` - because a second handler
  for the timed start is how the two would drift apart. The mode and script
  buttons stay live through the reading time, which is the only way out of a
  countdown started by mistake.
- **`answerEnglish()` has no equivalent here and needs none**: the Speaking tab
  never reads `settings.dir` or the Arabic. Everything PTE asks happens in
  English and this tab is all of it.
- `API_VERSION` went to **10** for the two new routes.

---

## Cloud build

The page also runs on Cloudflare, at **`pte-vocab.amirfox.workers.dev`**. Deploy with
`set -a && . ./.env && set +a && npm run cf:deploy` — read Rule 0 about the account
first.

- **There is no account and no database, on purpose.** A visitor's progress is in
  their own `localStorage` under `pte-vocab-progress`, kept apart from
  `pte-vocab-view`, which holds the view settings and always has. Clerk was considered
  and dropped: nobody should hand over an email address to practise vocabulary. Be
  honest about the trade rather than papering over it — progress does not follow
  anyone to a second device, and clearing site data clears it. **Do not add sign-in,
  D1, KV or R2 to make it sync.** If cross-device ever matters, it is an export and an
  import, not an account.
- **The rules are imported, not reimplemented.** `web/cloud-store.js` answers the same
  routes from `localStorage` but every decision worth getting wrong — least-seen-first
  draws, a batch drawn once and never refilled, `keys`/`done` as two halves of the
  same set, what a requested batch size means, the listed `/api/reset` scopes — comes
  from `src/batches.js`. Only the route glue is duplicated, a few lines each. **A rule changed in one host and not the
  other is the failure this whole arrangement exists to prevent**: change it in
  `batches.js` and both move together.
- **`src/shared.js` is the browser-safe half**, and nothing in it may import from
  Node, ever. It holds `SHEETS`, `EXAM_DATE`, `HEADERS`, `today()`, `daysBetween()`,
  `stats()`, `keyOf()` and the grammar grader. `config.js`, `tracker.js`, `loader.js`
  and `grammar.js` re-export what left them, so no call site changed. A value needing
  a filesystem path belongs in `config.js` instead.
- **`known` is the one field that has no workbook to live in**, so in the browser it
  becomes one more map in the saved object, keyed by `keyOf()` exactly as `seen` and
  `flags` are. It is collected from the deck entries on every save rather than tracked
  alongside them — the rules mutate the entries, and two records of the same fact
  disagree eventually. `deck.json` ships `known:false` on every row: a visitor has not
  learnt anything yet, and amir's 208 are his.
- **The Worker exists for one route.** `/static/grammar.json` is generated with
  `answer`, `accept` and `explain` cut out by the same mapping `src/server.js` uses,
  so the page still cannot be read for the answers; `POST /api/grammar/answer` marks
  one question against `worker/grammar-key.json`, which is bundled into the Worker and
  never served. The verdict is the Worker's, the **tally is the browser's** — a tally
  is study state and study state does not leave the browser. `tools/build-cloud.js`
  fails the build if an answer ever appears in the shipped file.
- **Audio is pre-rendered, not synthesised.** `tools/render-audio.js` runs all 491
  headwords through the same `src/tts.js` path and `ffmpeg` to MP3 (6.2MB, `af_heart`),
  and `web/audio/manifest.json` maps `keyOf()` to a filename so the page never guesses
  a URL. Kokoro is 326MB and has nowhere to live on a Worker — and off the edge there
  is no 2.5s first render for the prefetch to hide, which is why `sayUrl()` returning
  `null` for an unrendered word is a no-op rather than a 404. Adding a voice is
  `npm run audio -- bf_emma` and a rebuild, not a rewrite.
- **`run_worker_first = ["/api/*"]` in `wrangler.toml` is required.** Without it
  Cloudflare's asset router answers *navigation* requests with `index.html` before the
  Worker runs, which silently shadows every `/api/*` route: `fetch` still works, so
  the app looks fine, and only a browser navigation to an API URL reveals it.
- **`web/app.html` is one file for both hosts.** The cloud differences are four hooks
  — `api()`, `sayUrl()`, the voice list, and parking `boot()` for the deferred module
  — plus the two script tags `tools/build-cloud.js` injects. Do not fork the page.
- `dist/` and `worker/grammar-key.json` are generated and gitignored; `web/audio/` is
  committed, because reproducing it needs the 326MB model.

---

## Things not to re-derive

- **The source file has 9 duplicates** — `Jaywalk` plus 8 repeated phrases. The file
  as delivered was **267 / 205**, not 268 / 213. They are merged on load, TRUE
  winning. Anything above those numbers is a word added since; the counts in the
  docs are a snapshot, the workbook is the count.
- **Batches are least-seen-first**, shuffled within each seen-count tier — not pure
  random, which lets a word go unseen for weeks by chance. Full coverage in 6 days
  (words) and 11 (phrases).
- **Google Translate links** (`?sl=en&tl=ar&text=…&op=translate`) are attached to
  entries that are *not* known, for pronunciation. They appear in the browser page, in
  a `Listen` column in the workbook, and in the exports.
- **Spellcheck, autocorrect, autocapitalize and Grammarly are deliberately off** on the
  answer input, and on the Essays textarea for the same reason - the exam gives
  you none of them. Do not re-enable them.
- **A flag is a bookmark, not mastery state.** `progress.flags[sheet][key] =
  true` says "come back to this word and write a sentence with it". It is not a
  second `Known` store and the workbook has no column for it, so `/api/flag`
  takes `scheduleProgressWrite()` for the same reason `/api/batch/error` and the
  grammar answers do: it is a button pressed mid-drill, and it must not rewrite
  275KB of `.xlsx`. Unflagging deletes the key rather than writing `false` - the
  file is a list of what is flagged. Flagging never moves a card out of the
  pass, and the drill repaints only the button, never the card: before the
  reveal the half-typed answer lives in the DOM. `Ctrl-F` is the same toggle
  from the keyboard, taking that key off the browser's Find - but only on the
  Practice tab, because the document handler has already returned for every
  other view, and the word list and the grammar modules are the pages worth
  searching. One handler calls `toggleFlag()`, as the button does; do not give
  the shortcut its own copy of the rule.
- **`/api/reset` matches its scope against a list.** `seen | known | flags |
  both`, and anything else is `both`. `flags` in particular must never fall
  through to that default - it would wipe every `Known` flag in the workbook,
  which is the exact 2 Sep 2026 failure `API_VERSION` exists to stop. `both`
  still means the seen counts and the `Known` flags only: clearing what you have
  learnt is no reason to throw away the list of words you meant to write with.
- **A grammar answer must never trigger a workbook write.** That is what
  `scheduleProgressWrite()` is for - `scheduleWrite()` would rewrite 275KB of `.xlsx`
  for a 1KB change on every question answered.
- **Blank answers are graded by `isAccepted()`**, case-insensitively, on collapsed
  whitespace, with curly apostrophes normalised to `'`. Every question's `accept` array
  is expected to list *all* legitimate variants - contractions, both British and
  American spellings, and any equally valid wording. A missing variant marks a correct
  answer wrong, which is the worst failure this tool has; fix the array, not the
  grader.
- **The 24 modules were written by parallel agents and then verified by a second pass**
  that checked every key by substitution. Do not re-run a bulk script over
  `data/grammar/*.json`: one authoring agent did exactly that, permuting 16 other
  modules' option arrays mid-write. Edit module files individually, by name.
- **How many words go in a batch is asked at the draw** (9 Sep 2026). `New
  batch` opens a dialog with `20 | 50 | 100` presets over a number box, and the
  box is the only thing read on submit - a preset just fills it in, so a pressed
  chip can never disagree with the number that gets sent. `BATCH_SIZE` is now
  only the default that dialog opens on, and the last size drawn is remembered
  in `settings.batch.size` beside the other view settings. **A batch's own size
  is not stored anywhere**: it is `keys` plus `done`, which `batchPayload()`
  already sends as `total`, so a batch of 50 and a batch of 20 need no field to
  tell them apart and every batch drawn before the prompt existed needs no
  migration. `batchSize()` in `src/batches.js` is the one place that decides
  what a missing or nonsensical number means - the default, never an error,
  because it comes off a form and a blank box should draw the usual 20.
  Nothing clamps to what is left: asking for more than the pool has draws the
  pool, which is what the dialog says it will do.
- **A batch is drawn once and never refilled** (changed 2 Sep 2026; it used to
  top itself back up to 20 on every mark). `keys` is what is still to learn and
  `done` is what it has cleared - the two halves of the same set, so `keys` only
  ever shrinks and the batch is *finished* when it empties. That is the whole
  point: the drill can end. `syncBatches()` only moves keys between the two
  lists to match the workbook - it draws nothing in, and `createBatch()` does
  its own drawing. Do not put the refill back: a word appearing mid-drill that
  was never on the sheet you printed is the bug this replaced.
- **`studyBatches[sheet][i].done` is not a second mastery store.** The flag
  itself is still the workbook's, read back from it on every load; `done` is
  only which half of the batch is cleared. A key the workbook now says is FALSE
  goes back into `keys`, so `Reset this batch -> Known flags` hands back the
  whole set as drawn - and so does a hand edit in Excel.
- **`Reset this batch` is one button and does everything** (changed 2 Sep 2026):
  what the batch cleared comes back to it as `Known = FALSE`, every seen count
  in it goes to 0, and its error count goes to 0 - leaving the words, in the set
  they were drawn as. `/api/batch/reset` no longer takes a `scope`. It used to
  offer the seen counts and the `Known` flags separately, on the reasoning that
  working the same set again in a fresh order is a different intention from
  taking back what you marked known. True, and beside the point: reset means
  start this batch again. Do not put the menu back.
- **`Reset all`, on the word list, is still scoped** - `/api/reset` takes
  `seen | known | both` over both sheets, because there it really is two
  intentions and one of them rewrites 275KB of workbook. The seen scope takes
  `scheduleProgressWrite()` and never touches the `.xlsx`.
- **The batch error counter is `studyBatches[sheet][i].errors`.** Anything but
  an `exact` answer while drilling a batch counts, blanks included: submitting
  blank to see the answer is saying you could not produce it, and a `near` is a
  misspelling, which the exam marks wrong too. It stands until that batch is
  reset - nothing else clears it. `/api/batch/error` is its own route precisely
  so it takes `scheduleProgressWrite()`: a spelling slip must never rewrite the
  workbook, exactly as with a grammar answer.
- **A word you just got wrong cannot be marked known.** `canMarkKnown()` is
  false while a reveal is showing anything but an `exact` verdict, and it gates
  all three routes at once: `renderCard` does not draw the button, and `mark()`
  itself refuses, which is what makes `K` and `Ctrl-K` inert without either
  handler knowing the rule. Keep it that way - a second copy of the rule in the
  keyboard handler is how the button and the shortcut drift apart. `Ctrl-K`
  *before* the reveal still marks known on purpose: that is a claim made up
  front, not one made after seeing the answer.
- **In the drill, Enter is submit and nothing else.** The input's own handler
  calls `stopPropagation()`: without it the same keypress carried on to the
  document handler, which saw `revealed` already true and marked the card still
  learning - one Enter submitted *and* skipped past the answer, so the reveal
  was never seen. The second Enter is what moves on.
- **The English meaning is shown with the prompt in every drill** (changed
  7 Sep 2026), and the reveal block then leaves it out rather than printing it
  twice. It used to be held back outside a batch, on the reasoning that recall
  from the Arabic alone is the harder exercise. It is harder for the wrong
  reason: the Arabic is ambiguous, one Arabic word standing in for several of
  these headwords, so the whole-deck drill was asking which English word the
  sheet had in mind rather than testing the vocabulary. There is one
  `meaningUp` and one reveal block - do not reintroduce a per-mode rule.
- **The sentence clue runs in both drills** (`settings.clue`, added 7 Sep 2026,
  **on by default and in batches too since 8 Sep 2026**). The card shows the entry's
  example sentences *before* you answer with the marked form painted out, and
  the ordinary reveal then shows the same four sentences with the word in them.
  It defaulted off for a day, on the reasoning that a hint should be asked for;
  that is the wrong way round here, because the Arabic alone is ambiguous and
  the blanked sentence is what narrows it down. Changing that default needed a
  second field, `settings.clueDefault`: `loadSettings()` merges the saved
  object *over* the defaults, so every browser that had opened the page already
  carried `clue:"off"` - chosen or not - and would have carried it for ever.
  The stamp moves such a copy to the new default exactly once, and a deliberate
  `No clue` saved afterwards carries the current stamp and survives. Bump it
  again, never edit the saved value some other way, if the default ever moves.
  It is one `usageHtml()`
  still - a third `where`, beside `"tip"`, that swaps the `<b>` for a blank -
  because a second copy of those sentences would eventually disagree with the
  first. Blanking the `[[...]]` marker is the whole of the redaction and that
  is what makes it safe: the marker is the only place the data claims the word
  appears, so what is hidden is exactly what the reveal would have bolded. The
  blank is one fixed width for every entry, never sized to the word - a blank
  as long as what it hides gives away the letter count.
  `clueOn()` is the only place that knows when one is due, and there is now one
  condition in it: the Arabic prompt. Asked the other way round the sentences
  are in the language of the prompt above them, so a hole in one is the
  question printed twice rather than a hint; `renderChrome()` disables the
  control on that direction rather than hiding it, and leaves the setting
  alone. It refused inside a batch until 8 Sep 2026, on the reasoning that a
  batch already carries the meaning. That was wrong: a meaning is a gloss and a
  sentence is the word doing its job in a clause, which is what the exam marks.
  **Do not put the batch condition back** - there is one `renderCard()`, and a
  hint that appeared in the whole-deck pass and silently vanished when you
  trained a batch was the page disagreeing with itself. `renderTrainbar()`
  still hides `deckSeg` and `filterSeg` in a batch, because those choose what
  is in the pass and a batch has chosen; the clue chooses nothing, so it stays.
  Toggling it does **not** rebuild the queue, and it carries the half-typed
  answer across the repaint: reaching for a hint mid-word must not cost you the
  word.
- **Hiding the Arabic is one page-wide switch, `settings.arabic`** (added
  8 Sep 2026, by request; it lives in the voicebar with the voice because it
  governs every view, not just the drill). The reason is the exam: everything
  PTE asks happens in English, and an Arabic gloss sits between the learner and
  the word as a lookup step - the same argument that put the English meaning
  back on every card on 7 Sep, taken to its conclusion. **`arabicOn()` is the
  only place that reads it**, and `colsOf()` is the only gate the tables and
  the print sheet need, so what prints can never carry Arabic the screen is
  hiding.
  **It hides; it never edits.** The workbook keeps its Arabic column, and so do
  the saved `cols.ar` of both tables and the saved `dir` - the controls for
  those are *disabled with a title saying why*, never unticked or cleared,
  exactly as the clue control already was on the English prompt. A control that
  vanishes reads as a bug and a cleared setting loses a choice the reader made.
  Turn the Arabic back on and everything is as they left it.
  The **Add word form is the one deliberate exception**: a new row needs an
  Arabic cell to be a whole row, so that field stays put. A form that hid it
  would write blanks into the `.xlsx` that nothing would ever report.
  Two knock-ons that are not optional: the search box drops `e.arabic` from its
  haystack (a row matching on text that is not on screen looks like a broken
  filter) and `compare()` turns a saved `sort: "ar"` into `word` (a table
  ordered by invisible Arabic looks shuffled).
- **`answerEnglish()` is what the drill is drawn AND marked from.** Three
  states collapse into two: with the Arabic shown it is the direction you
  picked, and with it hidden there is only one answer the card can ask for
  whatever `dir` still says. `renderCard()` reads it for the prompt, the answer
  box's direction and placeholder, the revealed answer and the letter diff, and
  `submit()` reads it for `grade()`. **Do not put `settings.dir === "ar"` back
  into `submit()`** - drawing the card from one rule and marking it against
  another is how an answer gets graded against a word the card never asked for.
  With the Arabic hidden the prompt is the meaning plus the blanked example
  sentences and the answer is the English headword, which is the exam's own
  task and needed no new renderer: the clue already blanked the word, and
  `clueOn()` now asks `answerEnglish()` rather than the direction. The one
  guard worth keeping: a row with no Meaning cell and the clue off would draw
  an empty card, so `renderCard()` draws the sentences anyway in that case. A
  card with no question on it is not a harder card, it is a broken one.
- **A wrong answer says which letter, not just that it was wrong.**
  `align()` is the same edit distance as `distance()` with the matrix kept so
  the path can be walked back; the verdict then shows what you typed over what
  was wanted with the characters that did not line up picked out, and a drawn
  gap where a letter is simply missing. Two rules hold it together. It is
  computed over `normalise()`'s output - the strings the grader actually
  compared - so it can never point at a letter the grader forgave, which is why
  those two lines come back lowercased and stripped of punctuation. And it is
  drawn only while the answer is still recognisably that word being misspelt:
  `nearTol()` widened to a third of the word, so every `near` gets one (a
  verdict that says check your spelling beside a diff that will not say which
  letter is the page arguing with itself) and `intheshortrun` against
  `generally speaking` gets none - the aligner will seize on the letters two
  unrelated answers happen to share and highlight everything else, which says
  nothing. `nearTol()` exists as its own function for exactly that reason:
  `grade()` and `diffHtml()` both ask, and must never disagree. Not a mode - a
  batch drill draws it too, where a spelling slip is what the error count is
  counting.
- **Table column order is a saved list of keys** (`settings.list.order`,
  `settings.batch.order`), dragged by the headings, and it is what prints.
  `normOrder()` repairs a saved copy against `ALL_COLS` on load, so an order
  written before a column existed - or naming one that has gone - still opens.
  Both tables share `wireTableHead()`; the head is delegated to because the row
  inside it is rebuilt on every paint.
- **The blank writing columns are real columns** (`BLANKS`, keys `b1`-`b3`),
  not a count appended after the loop. They hold a place in `order` like any
  other, so one can sit between the English and the Arabic; the Blank columns
  control decides how many are drawn (`c.blank <= view.blanks`), not where.
  Their headings are the reader's, kept in `settings.<view>.names` and falling
  back to the `Attempt n` default when the box is empty - so `paintTable` is
  the only place that knows a blank column from a real one, through `c.blank`.
  A blank heading carries no `data-sort`: there is nothing to sort on, and the
  click handler returns early rather than sorting by a key `compare()` would
  fall through to `word` for.
- **A finished batch is not a dead batch.** `Train this batch` becomes
  `Retake this batch` and goes to `/batches/words-3/retake` once `ids` is empty
  - the pass over the whole set as drawn, `doneIds` included, which changes no
  flag by itself. It used to disable itself the moment the last word was marked
  known, which left the retake route reachable only by typing the URL. It is
  dead only when there is nothing there at all: no batch, or one whose rows have
  gone from the workbook.
- **A study batch is not the daily batch.** `progress.batches` is the date-keyed daily
  draw (`npm run daily`), replayed per calendar day. `progress.studyBatches` is the
  Batches tab: numbered sets, as big as you asked for at the draw, one series per
  sheet, drawn once and worked until they are empty. Batch numbers are never reused -
  a number on a printed sheet has to keep meaning one thing.
- **The page and the server carry a version, `API_VERSION`, and it must be
  bumped whenever a route's meaning changes.** `web/app.html` is read off disk
  on every request, so editing it puts new code in the browser at once - while
  `npm run web` can go on running an hours-old build. On 2 Sep 2026 that cost 32
  `Known` flags: the new Reset all sent `{scope:'seen'}`, the old `/api/reset`
  had no scope and ignored it, and wiped the workbook instead of the seen
  counts. The page now refuses to POST anything to a server whose number does
  not match, and a *missing* number counts as a mismatch. Restart the server
  after changing a route, and say so. It is **9** as of 9 Sep 2026, for the
  batch size: `/api/batch/new` now takes a `size`. This one *is* a change of
  meaning and it is exactly the shape of the 2 Sep failure - an older server
  ignores the field and hands back 20 when you asked for 100, which looks like
  the dialog not working rather than like a stale server. It was **8** from
  6 Sep for the model answers: `/api/essays` carries `guides` and a `models`
  count, and `/api/essays/models/<id>` is new.
- **Speech is Kokoro-82M, local, through `src/tts.js`.** `/api/tts` returns a
  WAV; `/api/tts/voices` returns a static table so the dropdowns paint without
  loading a 326MB model. fp32 on purpose - q8 measured ~2.5x *slower* on this
  CPU. A rendering costs ~2.5s and is then cached on disk for ever, in
  `~/.cache/pte-vocab-tracker/` along with the model: both are derived data and
  neither belongs in `data/`. The drill prefetches the current card's audio and
  the next one's while you type, which is what hides the 2.5s - do not "simplify"
  that away and then wonder why the reveal stutters.
- **The browser page is routed**, not tab state: `/word_list`, `/batches/words-3`,
  `/batches/words-3/training`, `/batches/words-3/print`, `/grammar`,
  `/grammar/<module-id>`, `/essays`, `/practice`. The server
  returns the page for every non-`/api/` GET and the client router decides. Note
  `history` inside `web/app.html` is the drill's undo stack and shadows the global -
  routing code must say `window.history`.
- `xlsx@0.18.5` is the last npm-published SheetJS release and `npm audit` flags it.
  Known and accepted for a local tool reading the user's own file.
