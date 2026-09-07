# Session log — 31 Aug / 1 Sep 2026

Two pieces of work: **fixing the write path that lost a batch**, and **building the
Grammar tab**. Both are finished and verified. Open items are at the bottom.

Note: this file exists because it was asked for. It is not the `the shared web root` session-log
convention, which Rule 0 in `CLAUDE.md` says does not apply here. There is no git in
this project, so nothing here is committed anywhere.

---

## 1. The lost batch — diagnosis

Reported symptom: a batch was generated and later gone.

Evidence at the time: `progress.json` last written 21:30:54, to the same second as
`PTE_Vocabulary_Master.backup-2026-08-31T18-30-54.xlsx`. That backup is taken once per
session before the first write, so 21:30:54 was that session's **first and only** flush.
Everything done after it never reached disk. The surviving state was correspondingly
thin: `next: 2` with only batch 1, two `seen` counts, one history row.

Four ways a created batch could die in memory:

1. **SIGHUP was not handled.** `createBatch` only called `scheduleWrite()`, an 800 ms
   debounce. Closing the terminal window hangs up the process, and Node's default action
   for SIGHUP is to terminate immediately without running any handler. Confirmed by
   experiment: `kill -HUP` printed `Hangup` and no handler ran.
2. **A throw inside the timer killed the process.** `flush()` ran from `setTimeout` with
   no try/catch and no `uncaughtException` handler, and wrote the 275 KB workbook
   *before* the 1 KB progress file. A failing workbook write (open in Excel, disk full)
   took the unwritten batches with it.
3. **Lost update.** A CLI command that writes progress (`npm run daily`, `update`) run
   while the server is up, or a second server on another port. Each holds its own
   in-memory copy and saves it whole; last writer wins. **Still open — see below.**
4. **Non-atomic write.** A torn file gives "progress.json is unreadable. Fix or delete
   it", and deleting it takes every batch with it.

Amplifier: `backupMaster()` copied only the `.xlsx`. `progress.json` — the sole record of
batch membership — had no backup at all, so the loss was unrecoverable. It was not
recovered.

## 2. What was changed

`src/tracker.js`
- `saveProgress` writes `progress.json.tmp`, `fsync`s, then `rename`s over the real file.
- New `backupProgress()`, the twin of `backupMaster()` → `progress.backup-<stamp>.json`.

`src/server.js`
- Batch create/delete call `writeProgressNow()` — immediate, not debounced. The 800 ms
  delay exists for the workbook; a batch number exists nowhere else and can never be
  reused, so it must not sit in memory.
- `shutdown` handles SIGINT, SIGTERM, **SIGHUP**, SIGQUIT, plus an `uncaughtException`
  handler that flushes. The exit message is wrapped in try/catch — on a hangup the
  terminal is already gone.
- `flush()` writes each store in its own `try`, progress first. A workbook failure
  prints, leaves the flag set, and retries on the next write.
- Separate `deckBackedUp` / `progressBackedUp` flags, so `progress.json` gets its own
  once-per-session backup even when the workbook is not being written.

Data fix: `words.next` 2 → 3 and `phrases.next` 1 → 2, retiring the numbers a lost batch
would have carried. Nothing in `exports/` recorded which deck it was, so one number was
burned on each rather than risk reprinting a number already on paper.

Verified in a throwaway copy of the project:

| Test | Result |
|---|---|
| `kill -HUP` inside the debounce window | `Saved (terminal closed). Bye.`, mark persisted, both backups written |
| `kill -9` right after creating a batch | batch survived intact, 20 keys. Old code lost it |
| workbook `chmod 444`, then a mark | server survived, printed the Excel hint, wrote progress anyway, flushed the held mark once permissions were restored |

## 3. The Grammar tab

**Content.** 24 modules / 288 questions in `data/grammar/`, one JSON file per module,
eight groups of three: Tenses · Future and Conditionals · Modality · Voice and Reporting ·
Clause Structure · The Noun Phrase · Verb Patterns and Prepositions · Precision and Style.
Each module: 4–6 sections (rule + right/wrong example pairs), 4–6 named slips, and
exactly 12 questions (7 mcq + 5 blank). Aimed at the B2–C1 boundary.

**Code.**
- `src/grammar.js` — loads and validates modules, `isAccepted()` grading, answer history.
  A file that will not parse is reported at startup and skipped, not fatal.
- `src/config.js` — `GRAMMAR_DIR`.
- `src/server.js` — `GET /api/grammar`, `POST /api/grammar/answer`,
  `POST /api/grammar/reset`, and `scheduleProgressWrite()`.
- `web/app.html` — the Grammar tab, `/grammar` and `/grammar/<id>` routes, module and
  index rendering, print rules.

**Design decisions worth not re-deriving** (also recorded in `CLAUDE.md`):
- Marking is server-side. `/api/grammar` strips `answer`, `accept` and `explain`, so the
  page cannot be read for the answers. Do not move it client-side "to save a round trip".
- Grammar answers go through `scheduleProgressWrite()`, never `scheduleWrite()` — a
  workbook rewrite per question answered would be 275 KB of churn for a 1 KB change.
- Answers live in `progress.json` under `grammar` as right/wrong counts per question.
  Not a second mastery store: different subject, and the workbook has no column for it.
- Blanks are graded case-insensitively, on collapsed whitespace, with curly apostrophes
  normalised. Every `accept` array should list all legitimate variants. **If a correct
  answer is ever marked wrong, fix that array — not the grader.**

**How the content was produced.** Eight agents wrote three modules each in parallel, then
four more verified all 288 questions by substituting every option into every gap.

The verification pass earned its keep — **12 real defects fixed**, including:
- `impersonal-passive` q7 accepted only an ungrammatical answer (`He is said to be living
  in Lisbon since the trial ended` — `since` + finished clause needs the perfect).
- Several questions where a distractor was also correct (`most residents ___ into the
  centre` accepted only `used to drive`, not `would drive`).
- Missing accepted variants that would have marked a right answer wrong: `whilst`, `yet`,
  `on account of`, `cut back on`, `are reviewing` (collective noun, British plural).
- False claims in prose: "`more` is never wrong with a two-syllable adjective";
  "could have + pp — that is its whole meaning".

**Two incidents to know about.**
1. One authoring agent ran a shuffle script globbing `data/grammar/*.json` and rewrote
   16 other agents' files mid-write. No content was lost, but this is why `CLAUDE.md`
   now says: never run a bulk script over that directory; edit module files by name.
2. That script used one fixed permutation, leaving **20 of 24 modules with the identical
   answer key sequence** B-D-A-C-D-B-C. Fixed with a per-module seeded permutation that
   tracks the key by text and asserts that no answer, prompt, explanation, accept list,
   section or slip changed. Now 24 distinct sequences, keys spread 41/47/40/40.

**Verified:** 24 modules load with zero problems; all 288 questions render headlessly;
API withholds every key; a grammar answer writes `progress.json` and leaves the workbook
byte-identical; blanks accept messy case, extra spaces and curly apostrophes; all routes
return 200. All testing ran against a throwaway copy — the real deck was never touched.

## 4. Scroll bug (fixed)

Grammar view would not scroll. `body.list-view { height: 100vh; overflow: hidden }` is
the fixed-height shell that lets the word-list and batch tables scroll inside their own
pane. The toggle read `!practice`, so the grammar view — a long document with no inner
scroller — inherited `overflow: hidden` and froze. Now only `list` and `batches` get it.

`app.html` is read from disk per request, so a page reload picks up edits; no restart.

---

## Open items

1. **The lost-update path is still unfixed.** A CLI command that writes progress run
   while the server is up, or a second server on another port, will silently erase the
   other's batches. A pid lockfile in `data/` would close it. This is the one durability
   hole left.
2. **Borderline grammar items.** Each verifier listed items it judged borderline and
   kept — mostly where an American intuition differs from the British register the
   modules teach (`I'd rather you contacted` vs `contact`; `Rarely can` vs `Rarely does`;
   `needn't have` vs `didn't need to`, which are genuinely both acceptable in many
   contexts and are deliberately never pitted against each other). If one marks a right
   answer wrong, add the variant to that question's `accept`.
3. `inversion-emphasis` section 2 says "English never inverts a lexical verb". Locative
   inversion ("On the hill stood a castle") is a real exception. Left as an acceptable
   simplification inside a do-support discussion.
4. `xlsx@0.18.5` still flagged by `npm audit` — known and accepted, unchanged.

## Handy

```bash
npm run web                      # localhost:4173
python3 tools/validate-grammar.py   # schema + key-distribution check on data/grammar/
```

`tools/validate-grammar.py` checks every module for schema conformance, answer indices in
range, `___` in every prompt, duplicate options and prompts, and reports the spread of
answer key positions. Run it after adding or editing a module.
