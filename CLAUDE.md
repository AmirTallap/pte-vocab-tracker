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
model answers** and a guide to writing one.

```bash
npm run web        # THE way to use it: browser page on http://localhost:4173
npm run cf:deploy  # publish the cloud build (source ./.env first - see Cloud build)
```

Everything else is optional terminal equivalents — see `README.md`.

There are **two hosts and one rulebook**: this local tool, backed by the workbook,
and a public build at **`pte-vocab.amirfox.workers.dev`** backed by the visitor's
own `localStorage`. See **Cloud build** below.

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
