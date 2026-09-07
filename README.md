# PTE Vocabulary Tracker

A CLI for the 16-week PTE vocabulary cycle: **50 academic words + 20 complex phrases a day**,
tracked against the exam on **19 December 2026**.

**Try it in your browser: <https://pte-vocab.amirfox.workers.dev>** - no sign-up, nothing
to install. Your progress is saved in that browser and goes nowhere else. The version
below is the local one, which reads and writes the real spreadsheet.

```bash
npm install
npm run web       # opens the study page in your browser
```

That is the whole thing. `npm run web` starts a local server on
**http://localhost:4173**, opens your browser, and you cycle through all 491
entries: Arabic prompt, type the English, submit, see how you did, mark it
known or still learning.

**It reads and writes the real `.xlsx`.** Marking a word known in the browser
sets `Known = TRUE` in `data/PTE_Vocabulary_Master.xlsx` - there is no separate
browser copy to reconcile later. Ctrl-C to stop; a pending write is flushed on
the way out, and a timestamped backup is taken once per session before the
first write. Closing the terminal window instead of Ctrl-C is also safe - the
hangup is caught and everything is saved before the process goes.

```bash
npm run web -- --port 5000    # different port
npm run web -- --no-open      # do not launch a browser
```

The page is styled after the PTE test-delivery screen, and spellcheck,
autocorrect, autocapitalise and Grammarly are all switched off on the answer
field so nothing underlines or "fixes" what you type.

### Where things live

Every view has a real URL, so you can bookmark one, reload into it, and use the
browser's Back button:

| URL | What it is |
|---|---|
| `/word_list` | The printable table of every entry |
| `/batches` | The newest batch of the deck you were last on |
| `/batches/words-3` | Words Batch 3 |
| `/batches/words-3/training` | Drilling Words Batch 3 |
| `/batches/words-3/retake` | Going over all 20 again, the ones you have cleared included |
| `/batches/words-3/print` | Its print sheet - shown on screen exactly as it prints, and the print dialog opens |
| `/grammar` | The grammar syllabus - 24 modules |
| `/grammar/articles` | One module: the rules, then 12 questions |
| `/essays` | Write Essay: one prompt, a 20-minute clock, a word counter, the method and three worked answers |
| `/practice` | The whole-deck drill |

`/` goes to whichever view you were last in. An address that does not exist -
a deleted batch number, a typo - falls back to the nearest real view and
corrects itself in the address bar rather than leaving you on a dead page.
Filters, blank-column counts and column choices stay out of the URL; they are
per-browser settings, not places.

### Word list

Four tabs sit at the top of the page: **Word list**, **Batches**, **Grammar**
and **Practice**. The word list is a plain sortable table of the same 491 entries,
built to be printed:

- **Filters** across the top - deck (all / words / phrases), status (all /
  learning / known), flag (all / flagged / unflagged), seen (any / 0 / 1 / 2 /
  3+), and a search over the English, the Arabic and the meaning.
- **Blank columns: 0 1 2 3.** Adds that many empty writing columns, with taller
  rows, so the printout is something you can fill in by hand. They are columns
  like any other: each has a heading - *Attempt 1*, *2*, *3* unless you type
  your own into **Blank titles** - and each can be dragged into place, so a
  column you write the Arabic into can sit right next to the English instead of
  out at the right-hand edge.
- **Columns** - tick off English, Arabic, Meaning, Status, Flag or Seen. Untick
  Arabic and Meaning with 2 blank columns and you have a test sheet; leave them
  on with 0 blanks and you have a reference list.
- **Print** drops all the on-screen chrome, forces black on white (a dark theme
  will not print as a black page) and repeats the header row on every sheet.
- **Add word** opens a small form: which sheet it belongs to (Academic Words or
  Complex Phrases), the English, and optionally the Arabic and the meaning. It
  is appended to that sheet in the workbook as a new row marked `FALSE`, so it
  joins the pool the batches and the drill draw from straight away. A word
  already on that sheet is refused rather than duplicated - the same comparison
  the loader uses, so case and spacing do not let a second copy through.
- **Reset all** clears the whole deck - every entry, in and out of a batch -
  and asks *what* to clear, the same two things the per-batch reset separates.
  *Known flags* writes `FALSE` over every `TRUE` in the workbook and hands every
  batch back the words it had cleared. *Seen counts* only forgets how often each
  entry has come up, so the next pass comes in a fresh order; it never touches
  the workbook. *Both* does the two together. *Flags* clears every flag and is
  deliberately separate - *Both* leaves them, because a flag is a note to
  yourself about a word you want to write with, not a record of progress. Batch
  numbers and batch membership survive all of them. The **Reset all progress**
  button in Practice's *Known list* opens the same choices.

Click a column heading to sort, again to reverse, a third time to go back to
the workbook's own order - every column sorts, both ways. **Drag a heading onto
another** to move that column - blank writing columns included; the order is
remembered per table, and it is the order that prints. Adding an entry and **Reset all** are the only
changes this view makes to the `.xlsx` - **marking** one thing known is still
the Practice tab's job, so there is one path to a `Known` flag and no second one
to get wrong.

The batch table has the same headings: the same seen filter, the same
click-to-sort, the same drag-to-reorder, remembered separately from the word
list's.

### Hearing the words

A bar under the tabs picks the voice everything is spoken in. It is
**Kokoro-82M** running locally through the server - a 2025 neural model, not the
robotic system voice - so it works offline and nothing is sent anywhere.

- **Accent** and **Voice**: 20 American voices and 8 British, each shown with
  the model's own quality grade (`Heart · female · A` down to `Adam · male ·
  F+`). The grade is real: a D voice is audibly rougher. Changing the accent
  picks the best-graded voice in it.
- **Speak on reveal** says the English word the moment the answer is shown, in
  both the whole-deck drill and a batch drill. Turn it off and the ▶ button
  beside the word still speaks on demand.
- **Speed** 0.7× to 1.15×, and **Hear it** auditions a voice on whatever card is
  on screen - or on the word *articulate* if none is.

The first word after installing downloads the model (~330MB, once). After that a
word takes about 2.5s the first time it is ever said and is then cached on disk
for ever, and the drill renders each card's audio while you are still typing, so
the reveal plays instantly. Model and audio both live in
`~/.cache/pte-vocab-tracker/` - delete it and it rebuilds itself.

### Seeing the word used

Under the revealed answer, if there are example sentences for that word, the
drill prints them - four short sentences with the word in bold, in the form it
actually takes there (`spur` turns up as **spurred**, `pervades` as
**pervaded**). It works the same in the whole-deck drill and while you are
drilling a batch: there is one card and one reveal.

The sentences live in `data/usage/words.json` and `data/usage/phrases.json`,
keyed by the word in lower case:

```json
{
  "dearth": [
    "There is a [[dearth]] of reliable data on the long-term effects of the policy.",
    "The argument fails not for want of passion but for a [[dearth]] of evidence."
  ]
}
```

`[[...]]` is what gets bolded, and it wraps whatever form the sentence uses.
Adding sentences for a word is a one-file edit and needs no migration - a word
with no entry simply shows none. Like the grammar syllabus, this content is
read at startup and never written back; nothing in it is study state.

The same sentences come up as a hover card on both tables - the word list and a
batch. Point at the English word in any row and its examples appear beside it;
move off and they go. It is the same set the drill prints, from the same file,
so the two can never disagree. The card never prints.

### Batches

A **batch** is a set of **20 entries you do not know yet**, numbered and kept on
file. Words and phrases have their own series, so Words Batch 1 and Phrases
Batch 1 are different sets.

- **New batch** draws 20 from the unknown pool - least-seen first, and never a
  word that is already sitting in another batch. When there is nothing left to
  draw it says so instead of handing you a short batch you did not ask for.
- **It is drawn once and never refilled.** The moment you mark one of its
  entries known - in the drill, or anywhere else - that entry leaves the batch,
  and nothing is drawn in to replace it: a batch that started as 20 shrinks as
  you learn it and is **finished** when the last one goes. The tab says
  `14 of 20 left`. That is what makes a batch something you can complete; more
  work comes from **New batch**, not from the one in your hand growing back.
- **Print** goes to `/batches/words-3/print`, which shows the sheet on screen
  exactly as it will come out - same blank writing columns, same black-on-white,
  batch number in the header - and opens the print dialog over it. **Back to
  batch** returns.
- **Train this batch** drills that batch and nothing else, at
  `/batches/words-3/training`. A bar across the top of the Practice tab says
  which batch you are in; **Leave this batch** goes back to the whole deck. When
  the last unknown entry in the batch is marked known the drill stops with **No
  more words in this batch** and offers *Reset this batch*, *Retake all 20* or
  *Done* - it will not pull in a word from outside the batch to keep the pass
  going.
- **A finished batch can still be worked.** Once there is nothing left to learn
  the same button reads **Retake this batch** and goes to
  `/batches/words-3/retake`: one pass over all 20 as they were drawn, the ones
  you have cleared included, to find out whether they stayed learnt. It marks
  nothing by itself - a word only stops being known if you say on the card that
  it has gone - so it is a check, not a reset. The progress meter stays deck-wide while you are in there -
  a batch is unknown-only, so scoping it to the batch would read 0% forever.
  Inside a batch the card shows the **English meaning next to the Arabic**,
  before you answer: the batch is the set you are still learning, and the
  description is what pins the Arabic to a meaning rather than to a guess. The
  whole-deck drill still holds it back until the reveal.
- **Errors are counted.** While you are drilling a batch, every answer that is
  not exactly right adds one to that batch's error count, shown in the bar:
  `12 of 20 left · 7 errors`. Blanks count, and so do one-character typos - the
  exam marks spelling too. The number stands across reloads and across days;
  the only thing that clears it is resetting the batch. It also shows on the
  Batches tab, so you can see at a glance which batch is fighting back.
- **Reset this batch**, in that same bar, is one button and does everything:
  what the batch has cleared comes back into it as `FALSE` in the workbook,
  every seen count in it goes to 0 so the next pass comes in a fresh order, and
  the error count goes to 0. What is left is the words, in the set they were
  drawn as. Nothing outside the batch is touched and the number does not
  change.
- **Delete** removes a batch and returns its entries to the pool, where a later
  **New batch** can draw them again. Nothing is marked known or unknown by this.
  The number is retired, never handed out again, so a sheet you printed in
  October still means the same batch in December.

Batch membership lives in `data/progress.json` under `studyBatches` - the `Known`
flags stay in the workbook, as always. This is a different thing from the
date-keyed daily draw behind `npm run daily`.

**Keys in the drill**, batch or whole deck: `Enter` submits, then `K` marks the
card known and `J` (or `Enter` again, or `→`) leaves it still learning; `←` undoes
the last mark, and **`Ctrl`+`F` flags it**. **`Ctrl`+`K` marks the card known at any point** - including while
the cursor is in the answer box, where plain `K` is just a letter you are typing.
It is the shortcut for *I already know this one, move on*, without having to
answer it first.

**Flag a word to come back to it.** Between *Skip* and *Submit* - and between
*Still learning* and *I know this* after the reveal - is a **Flag** button: this
is a word you want to work with later, to put in a sentence or drill by writing.
It is a bookmark and nothing more. It sets no `Known` flag, never touches the
workbook, and never takes the card out of the pass; pressing it mid-answer does
not disturb what you have typed. Press it again to take the flag off.
**`Ctrl`+`F` toggles it** without reaching for the mouse - before the reveal or
after it, from inside the answer box, the same way `Ctrl`+`K` marks a card
known. It takes over the browser's Find on the Practice tab only; on the word
list and in a grammar module - the pages you would actually search - `Ctrl`+`F`
is still Find.

What it is for is finding them again afterwards:

- **Practice → Flagged** drills exactly the flagged entries, known ones
  included - you flagged a word because you still want to use it, not because
  you have not learnt it.
- **Word list → Flag → Flagged** lists them, and prints. Add 2 or 3 blank
  columns and you have a sheet to write sentences on; tick the **Flag** column
  to see the mark against a list that is not filtered down to it.
- **Batches → Flag** does the same inside one batch.

Flags live in `data/progress.json` under `flags`, beside the seen counts - the
workbook has no column for them, and flagging a word during a drill must not
rewrite 275KB of `.xlsx`. **Reset all → Flags** clears them all at once.

**Get it wrong and you cannot mark it known.** After anything but an exact
answer the *I know this* button is not offered - the space says *Got it wrong -
it stays in the batch* instead - and `K` and `Ctrl`+`K` both do nothing. The only
way on is *Still learning*. `Ctrl`+`K` before you answer still works, because
that is a claim made up front rather than after seeing the answer, and a correct
answer leaves the button exactly where it was. The rule lasts as long as that
reveal: next time the card comes round it is a fresh attempt.

### Grammar

Vocabulary is half the problem; the other half is putting it in the right form.
The **Grammar** tab holds **24 modules and 288 questions**, aimed at the B2-C1
boundary - the level where the rules are known but slip under time pressure.

Eight groups, three modules each: Tenses · Future and Conditionals · Modality ·
Voice and Reporting · Clause Structure · The Noun Phrase · Verb Patterns and
Prepositions · Precision and Style.

Every module is built the same way:

- **The rule** - what the form is, when it applies and where it does not,
  written as a reference rather than a lesson. Right and wrong versions of the
  same sentence sit side by side, with a line on what separates them.
- **Where this slips** - the specific traps, named. Several are the ones an
  Arabic speaker hits hardest: the definite article on generic plurals, the
  present perfect with a finished time, `discuss about`.
- **Twelve questions** - seven multiple choice, five fill-in-the-blank. Answer
  and the explanation appears, along with the accepted answers if you missed it.

**The marking happens on the server.** `/api/grammar` sends the modules with the
keys and the accepted answers stripped out, so the page cannot be read for the
answers - guessing from the source is not available to you, deliberately.

Blanks are graded case-insensitively, ignoring extra spaces, and every module
lists the legitimate variants of an answer, so `'d left` and `had left` both
pass. Contractions, British and American spellings and equally valid wordings
are all accepted; if one is ever refused, it is a missing entry in that
question's `accept` list and worth fixing in the module's JSON file.

Your answers are kept in `data/progress.json` under `grammar`, both the right
and the wrong counts - so a module you guessed your way through looks different
from one you actually hold. **Clear my answers for this module** at the foot of
each module resets just that one.

Adding a module is one file: drop a JSON file into `data/grammar/` following the
shape of the others and restart. A file that will not parse is reported at
startup and skipped, rather than taking the tab down with it.

### Essays

The **Essays** tab is the PTE Write Essay task as it is actually sat: one
prompt, 200-300 words, twenty minutes.

**The clock starts when you take a question**, not when you press a start
button - that is what the exam does. **Next question** walks the sixty in
order, **Random** jumps, and the dropdown goes straight to one; all three start
a fresh twenty minutes and a fresh empty box, and all three ask first if you
have already written something.

You can also **start the clock on its own**. With no question taken the
**Restart timer** button reads **Start timer** and gives you the twenty
minutes with an empty box, which is what you want for a prompt you brought
from somewhere else, or for writing to the clock without one. It is the same
button and the same action, so the two can never drift apart.

The countdown is a deadline rather than a running total, so it keeps going if
you reload the page or wander off to the word list, and it comes back where it
should be. **Pause** holds it; **Restart timer** gives back the full twenty
minutes without touching the question or what you have written, which is the
button for the interruption you did not choose. Under two minutes the clock
turns amber, and at zero it says so in red and stops - it does not take the box
away from you.

The word counter is live, and it knows the band: grey under 200, green from 200
to 300, red past it, with the shortfall or the overrun spelled out underneath.
The exam penalises both ends, so both ends are shown.

**Spellcheck, autocorrect, autocapitalize and Grammarly are off**, exactly as
they are on the drill's answer box, and for the same reason: the exam gives you
none of them.

The sixty prompts are in `data/essays.json` and cover the six shapes PTE
actually sets - agree or disagree, discuss both views, advantages and
disadvantages, problem and solution, causes and effects, and the direct
question. They are static content: adding or rewording one is a single file
edit and a restart.

Nothing you write is saved to the workbook or to `progress.json`. The essay is
a rehearsal, not a document. The draft does survive a reload - the browser keeps
it with the other view settings - but that is insurance against a stray refresh,
not a library of past attempts.

#### How to write it, and 180 worked answers

Two panels sit below the box, both shut until you ask for them. They are below
the box deliberately: neither should be in your eye while the clock runs.

**How to write it** is the method - the seven things PTE marks, what to do with
each of the twenty minutes, eight rules for the paragraphs, and a checklist for
the last three minutes - followed by a recipe for the *type* of question you
currently have, paragraph by paragraph, with openers taken from your own phrase
sheet. It changes as you change question. It lives in `data/essay_guides.json`.

**Model answers** gives you **three worked essays for every one of the sixty
prompts**, 180 in all. Each takes a different line - agree, disagree, and a
third position that is not a fence - and each is scored **100 / 100**, because
they are written to be full marks rather than graded afterwards. Every one is
inside the 200-300 band, is four paragraphs, and carries its plan, its
paragraph labels and a short note on *why* it scores what it does.

**Every word taken from your two sheets is highlighted in green**, and hovering
one shows the same example sentences the word list shows, from the same place.
There are about 1,765 of these marks across the 180 essays, covering 198
distinct entries from the deck. The marking is in the data rather than matched
in the browser, for the reason the example sentences are: the form used is
usually not the headword, so `[[exacerbates|Exacerbate]]` records both, and
`node tools/check-models.js` verifies every one of them against the workbook.

The essays live in `data/models/`, one file per prompt, and are fetched only
when you open the panel - 300KB that most visits never need. They are static
content and are never written back, like everything else on this tab.

    node tools/check-models.js          check all 60: band, dashes, deck marks
    node tools/check-models.js e07      just that prompt
    node tools/check-models.js --fix    name the headword for an inflected mark

---

## The five things it does

## If you prefer the terminal

The same data, driven from the command line. All optional - `npm run web` needs
none of it.

| Command | What it does |
|---|---|
| `npm run web` | **The browser page.** Every entry, writes straight to the workbook. |
| `npm run daily` | Today's 50 words + 20 phrases. Same batch all day, every time you run it. |
| `npm run stats` | Mastered counts, coverage, days to exam, required pace, milestone check. |
| `npm run update -- <file.xlsx>` | Folds a workbook you marked up in Excel back in. |
| `npm run export-batch` | Saves the batch as a file to study away from the terminal. |
| `npm run triage` / `npm run recall` / `npm run review` | The three interactive modes, below. |

Anything after `--` goes to the tool, e.g. `npm run daily -- --only phrases`.
Or install it once and drop the `npm run`: `npm link` then `pte daily`.

---

## The two modes you asked for

You described two things without names. They are `triage` and `recall`, and they
pull in opposite directions on purpose.

### `npm run triage` — sort what you do and don't know

Shows the **English** word and its meaning, you answer `k` (I know this) or
`u`/Enter (still unknown). This is the mode that **sets the flags**; every number
in the tool derives from them.

```
  1/50  Ubiquitous   hear it
     منتشر في كل مكان   Present everywhere
  > k
     known
```

`k` known · `u` or Enter unknown · `b` back one · `q` stop and save.
`-n 30` to sort 30 at a time. `--all` to sweep known entries too.

### `npm run recall` — Arabic shown, you write the English

Scoped to entries you have **already marked known**. It is not for learning, it
is for catching decay: a word you claimed last month and cannot produce today is
not mastered.

```
  1/40  الاستقلالية
  > autonomy
     correct  Autonomy  The capacity to make one's own choices  hear it
```

At the end it lists everything you could not produce and **offers to send it back
to the unknown pool**. That offer is the point of the mode — without it "known"
only ever ratchets upward and the percentage stops meaning anything.

Type the answer and it grades it (a one-character typo scores *close*, not
*correct*). Press Enter blank to reveal instead, if you are writing on paper.

### and `npm run review` — the batch quiz

The brief's original Arabic→English quiz, run over **today's batch**. Where
`recall` quizzes what you have claimed and offers to demote it, `review` quizzes
what you are currently learning and offers to **promote** what you got exactly right.

---

## Pronunciation links

Every entry you have **not** marked known carries a Google Translate link
(`?sl=en&tl=ar&text=<word>&op=translate`) so you can play it back and hear it.
They appear in four places:

- **The terminal** — the word itself is clickable (OSC 8 hyperlinks; works in
  iTerm2, GNOME Terminal, Windows Terminal, VS Code, Kitty, WezTerm). Terminals
  that don't support it just show the plain word. `--no-links` prints raw URLs.
- **The Excel file** — a `Listen (EN>AR)` column with a real Excel hyperlink,
  so you can hear a word while you're marking it TRUE. Known entries get a blank
  cell, which makes the column double as a marker of what's still outstanding.
- **`export-batch --format html`** — tap-to-hear on a phone. This is the one to
  use away from a desk.
- **`export-batch --format md` / `txt`** — clickable link / spelled-out URL.

It is a separate Excel column rather than a link on the Word cell on purpose: a
hyperlinked cell launches a browser when you click it, and the Word cell is one
you may want to click to edit.

---

## The daily loop

```bash
npm run daily                       # study the batch
npm run triage -- -n 30             # mark what stuck
npm run stats                       # check pace
```

Or the Excel loop, if you'd rather mark up the spreadsheet:

```bash
npm run export-batch -- -f html     # study from exports/
# ... open data/PTE_Vocabulary_Master.xlsx, set Known to TRUE, save a copy ...
npm run update -- ~/Downloads/PTE_Vocabulary_Master.xlsx
```

`update` takes a backup of the master before writing, every time.
Add `--dry-run` to see what would change first.

---

## How the batch is chosen

Not pure random. The pool is ordered **least-seen first**, shuffled within each
seen-count tier, then the top 50 / 20 are taken.

Pure random over the unknown pool lets a word go unseen for weeks by chance,
which defeats the week-4 "every entry seen once" goal. Least-seen-first
guarantees full coverage in `ceil(pool ÷ per-day)` days, while the shuffle inside
a tier keeps the order varied so you aren't revising in the same sequence every
cycle. Verified on the 267 words / 205 phrases the file was delivered with:
**every word is seen within 6 days**, every phrase within 11.

The batch is also **seeded by the date**, so running `daily` three times in one
day shows the same 70 entries rather than three different sets. Once drawn it is
stored and replayed; `-r` forces a fresh draw.

---

## What `update` does with your marked-up file

The incoming file is authoritative for the `Known` column — it's the file you
just edited — so entries move **both ways** and an accidental TRUE is correctable
by setting it back to FALSE. Both directions are reported; silently accepting a
demotion is how a mastered word quietly re-enters rotation with no explanation.

- Rows present in your file but not the master are **added** (type new vocabulary
  straight into Excel and it lands in the deck).
- Rows *missing* from your file are **kept, never deleted** — a partial or
  filtered export must not be able to destroy the deck.
- Blank Arabic/meaning cells never overwrite existing data; filled ones do, so a
  typo you fix in Excel survives.

---

## The hosted version

<https://pte-vocab.amirfox.workers.dev> - the same page, the same 491 entries, the same
grammar syllabus and essay prompts, with two differences.

**There is no account, and there is no database.** Your progress lives in your own
browser, under `localStorage["pte-vocab-progress"]`. Nothing is uploaded, nothing is
stored on the server, and nobody has to hand over an email address to practise
vocabulary. The honest cost: it does not follow you to another device, and clearing
site data clears it. Everyone starts at 0 of 491.

**The audio is pre-recorded rather than synthesised.** The local tool speaks through a
326MB model running on your own CPU, which has nowhere to live on a Worker, so all 491
headwords are rendered ahead of time and shipped as MP3s. One voice, and no speed
control - but it plays instantly, with none of the ~2.5s a first local rendering costs.

Grammar answers still are not in the page: the syllabus is served with the answer key
stripped out, and marking is a round trip, exactly as it is locally.

### Deploying it

```bash
npm run audio                 # render the MP3s (once; needs the model and ffmpeg)
npm run cf:build              # generate dist/
npm run cf:dev                # try it on http://127.0.0.1:8787 first

set -a && . ./.env && set +a  # personal Cloudflare token; never `wrangler login`
npm run cf:deploy
```

`.env` holds `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` and is gitignored.
`npx wrangler whoami` should report the intended account before you deploy.

## Files

```
pte-vocab-tracker/
├── index.js                    command wiring (commander)
├── web/
│   └── app.html                the browser page - served by `npm run web`
├── src/
│   ├── server.js               local http server + the read/write API
│   ├── config.js               paths, sheet names, pace, exam date
│   ├── loader.js               Excel read/write, header matching, dedupe
│   ├── generator.js            deterministic least-seen-first batch
│   ├── tracker.js              progress.json, stats and pace maths
│   ├── grammar.js              grammar modules, marking, answer history
│   ├── usage.js                example sentences, read once, never written
│   ├── essays.js               essay prompts and the writing guide
│   ├── models.js               180 worked model answers, read once
│   ├── replacer.js             merge an edited workbook, reserve top-up
│   ├── modes.js                triage / recall / review
│   ├── exporter.js             txt / md / html exports
│   ├── links.js                Google Translate URLs, OSC 8 hyperlinks
│   └── prompt.js               input queue, answer grading
├── data/
│   ├── PTE_Vocabulary_Master.xlsx   the deck (source of truth for Known)
│   ├── backup_words.json            unused reserve — see below
│   ├── progress.json                batch history, seen counts, drill log
│   ├── grammar/                     24 grammar modules, one JSON each
│   ├── usage/                       example sentences, one JSON per sheet
│   ├── essays.json                  60 Write Essay prompts
│   ├── essay_guides.json            how to write one, and a recipe per type
│   └── models/                      3 worked answers per prompt, one file each
└── exports/                    generated study files
```

`data/PTE_Vocabulary_Master.xlsx` is the source of truth. Backups are written
beside it as `PTE_Vocabulary_Master.backup-<timestamp>.xlsx` before any write.

`data/progress.json` is backed up the same way, as
`progress.backup-<timestamp>.json`. It only got backups on 31 August 2026, and
that was overdue: batch numbers and membership live in that file and nowhere
else, so before then a batch lost to a crash could not be recovered from
anything. It is now also written temp-file-then-renamed, and a new batch is
saved the instant it is drawn rather than waiting out the workbook's write
delay.

---

## Things worth knowing

**Your file has duplicates.** `Jaywalk` appears twice in Academic Words, and
eight phrases repeat (`In other words`, `In conclusion`, `By and large`,
`Be that as it may`, `To illustrate`, `In essence`, `Apparently`, `Regrettably`).
The file as delivered was **267 words / 205 phrases**, not 268 / 213 - anything
above that is a word added since. They're merged on
load — if any copy is TRUE the survivor is TRUE — so you never study the same
entry twice or leave half a duplicate stuck at FALSE. The tool prints a note each
run. Delete the extra rows in Excel if you want it to stop.

**`backup_words.json` ships empty, and that's deliberate.** The brief called for
an "unused reserve" to swap in as words are mastered — but the only vocabulary
supplied was the 267 + 205 already in the workbook, and inventing replacement
words would put unvetted material in your study deck. The mechanism is built and
wired: add entries in the documented shape and `update` promotes them
automatically whenever an unknown pool drops below its daily target. Until then,
"replacement" happens naturally — a word marked TRUE leaves the unknown pool, so
tomorrow's batch draws something new in its place.

**The 16-week plan is tight.** From 30 August that's 111 days, 15.9 weeks. From a
9 September start it's 101 days, 14.4 weeks. `stats` reports the real number and
the pace actually required, not the plan's assumption.

**`xlsx@0.18.5`** is the last npm-published SheetJS release and carries known
advisories. For a local CLI reading your own file that's not a live risk, but
`npm audit` will flag it. The maintained builds are on `cdn.sheetjs.com`.
