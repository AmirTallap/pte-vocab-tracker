# Session log — 7 Sep 2026

Three pieces of work: **putting the project under git and on GitHub**, **building a
cloud version that keeps progress in the visitor's own browser**, and **scrubbing the
repo before it went public**. All finished and verified. Open items are at the bottom.

Note: this file exists because it was asked for, as the 1 Sep one was. It is still not
the work projects' session-log convention, which Rule 0 in `CLAUDE.md` says does not
apply here.

**This file is in a public repo.** The personal email, the Cloudflare account id and the
work projects' repository names were deliberately removed from this project today (§4);
do not reintroduce them here. `npx wrangler whoami` and the gitignored `.env` are where
that information lives now.

The 1 Sep note ends by saying "there is no git in this project, so nothing here is
committed anywhere." That stopped being true today. It is left as written rather than
edited after the fact.

---

## 1. Git and GitHub

`gh` was already authenticated as AmirTallap, so nothing needed setting up. Repo-local
identity was set rather than touching the global config, which names a different
address; commits are attributed to a GitHub noreply address so no personal email is
baked into every commit.

`.gitignore` was missing three things that would otherwise have been committed: the 33
`data/progress.backup-*.json` files (360 KB of study-history noise — only the `.xlsx`
backups were ignored), the new `.env`, and the generated `dist/` and
`worker/grammar-key.json`.

Repo: `github.com/AmirTallap/pte-vocab-tracker`. Created private, made public at the end
of the session after §4.

## 2. The decision that shaped the port

The original ask included Clerk, for per-user progress. Dropped, by request: nobody
should hand over an email address to practise vocabulary.

That one decision removed most of the work. With no accounts there is **no database, no
D1, no auth and no server-side state at all** — a visitor's progress is `localStorage`
in their own browser. What remains is a static build plus one live route.

Be honest about the trade rather than papering over it: progress does not follow anyone
to a second device, and clearing site data clears it. If cross-device ever matters, it
is an export and an import, not an account.

## 3. What was built

**The risk was never Cloudflare, it was duplicating the rules.** Running the same study
logic on two hosts invites a second copy that drifts — the failure `CLAUDE.md` warns
about on nearly every page. So the logic was *moved* to where both hosts can reach it,
never copied.

`src/shared.js` (new)
- The browser-safe half: `SHEETS`, `EXAM_DATE`, `HEADERS`, `LISTEN_LABEL`, the empty
  progress shape, `today()`, `daysBetween()`, `stats()`, `keyOf()`, and the grammar
  grader (`normalise`, `isAccepted`, `grammarState`, `recordAnswer`, `grammarProgress`).
- Moved out of `config.js`, `tracker.js`, `loader.js` and `grammar.js`, each of which
  re-exports what left it, so **no call site changed**.
- Nothing here may import from Node, ever. A value needing a filesystem path belongs in
  `config.js`.
- Consequence: `batches.js` now reaches only `shared.js` and `generator.js` — no Node
  imports — so the browser can run the batch rules directly.
- Two of these mattered more than the rest. `keyOf()` decides when a word typed into the
  cloud build collides with the sheet; `isAccepted()` decides whether a blank answer was
  right. A second copy of either is how the two hosts start disagreeing about the same
  input.

`web/cloud-store.js` (new)
- Answers the same routes from `localStorage`, importing every rule from `batches.js`.
  Only the route glue is new — a few lines each, mirroring `src/server.js`'s handlers.
- Storage key `pte-vocab-progress`, kept apart from `pte-vocab-view` (view settings).
- `known` has no workbook to live in here, so it becomes one more map in the saved
  object, keyed by `keyOf()` as `seen` and `flags` are. It is collected from the deck
  entries on every save rather than tracked alongside them: the rules mutate the
  entries, and two records of the same fact disagree eventually.
- No debounce and no shutdown flush. Everything here is the 1 KB case; the signal
  handlers `src/server.js` needs have no equivalent and need none.

`worker/index.js` + `wrangler.toml` (new)
- The Worker exists for **one route**. `/static/grammar.json` is generated with
  `answer`, `accept` and `explain` cut out by the same mapping `src/server.js` uses, so
  the page still cannot be read for the answers, and `POST /api/grammar/answer` marks
  against `worker/grammar-key.json` — bundled into the Worker, never served, gitignored.
- The verdict is the Worker's; the **tally is the browser's**, because a tally is study
  state and study state does not leave the browser.
- `run_worker_first = ["/api/*"]` is **required**. Without it Cloudflare's asset router
  answers *navigation* requests with `index.html` before the Worker runs, silently
  shadowing every API route: `fetch` still works, so the app looks fine, and only a
  browser navigation to an API URL reveals it.

`tools/build-cloud.js` (new)
- Generates `dist/` from `web/`, `src/` and `data/`. There is one `app.html`, not two:
  the cloud differences are two injected script tags plus four hooks in the page.
- Fails the build if an answer leaks into `grammar.json`, or if a prompt offers model
  answers with no file behind it.

`tools/render-audio.js` (new)
- All 491 headwords through the existing `src/tts.js` path and `ffmpeg` to MP3
  (6.2 MB, `af_heart`), with `web/audio/manifest.json` mapping `keyOf()` to a filename
  so the page never guesses a URL. Committed, because reproducing it needs the 326 MB
  model.
- Kokoro has nowhere to live on a Worker — and off the edge there is no ~2.5 s first
  render for the prefetch to hide, which is why `sayUrl()` returning `null` for an
  unrendered word is a no-op rather than a 404.

`web/app.html` — four hooks and a boot handoff: `api()`, `sayUrl()`, the voice list, and
parking `boot()` for the deferred module (a module script runs *after* a classic one, so
the page cannot look for the store at parse time). Nothing else in the page knows which
host answered it.

## 4. Scrubbing before public

Audited all five commits and every blob, not just the working tree. **No credentials
were ever committed**: `.env` never appeared in any commit, and there were no
token-shaped strings anywhere in history.

Four things did not belong in a public repo, and were removed:

1. The personal email, in `CLAUDE.md` ×2, `README.md` and `wrangler.toml` — added
   earlier in this same session while documenting the deploy. A published address is a
   credential-stuffing target and bought the docs nothing.
2. The Cloudflare account id. **Deleted from `wrangler.toml` outright rather than
   reworded**: wrangler already reads `CLOUDFLARE_ACCOUNT_ID` from the gitignored
   `.env`, so pinning it was redundant, and leaving it out means the repo cannot be
   deployed without deliberately sourcing credentials.
3. The work projects' repository names, deploy host and shared web root, in Rule 0 and
   in `notes/`. Not this project's to publish.
4. `data/progress.json` was considered and **kept** — study counts only, no names, no
   free text.

Rule 0 keeps every bit of its force. It still says this project is separate, still
forbids `wrangler login` on this machine, still refuses to be moved under the shared web
root. It just no longer names anyone's infrastructure to say so.

A scrub commit alone would have left the strings in the four earlier commits, so all
five were rewritten (`filter-branch`, literal replacements) and force-pushed. Verified
by **cloning the remote fresh and scanning every blob in it: zero hits**. Local
dangling objects purged with `reflog expire` + `gc --prune=now`.

## 5. Verification

The refactor in §3 is the change that could have broken the tool 103 days before the
exam, so it was verified by equality rather than by inspection: `/api/deck`,
`/api/usage`, `/api/grammar` and `/api/essays` captured before and after are
**byte-identical**, `npm run stats` is unchanged, and grammar marking and the
`entry/new` duplicate check both still work.

Cloud build, driven in a real browser against `wrangler dev` and then against the
deployed Worker: a drill graded and marked, a flag, a batch of 20 drawn
least-seen-first, an error counted, a grammar question marked right *and* wrong — all
surviving a full reload on a deep route (`/batches/words-1`). 60 prompts with 180 model
answers, 491 usage entries, and an MP3 decoding to 1.5 s of real audio.

Local build re-checked afterwards with the modified `app.html`: no cloud store, boot
runs directly, 208 known read from the workbook, all 28 voices, live `audio/wav` from
`/api/tts`.

Answer-hiding confirmed on the live site: `"accept"`, `"answer"` and `"explain"` all
appear **0 times** in the served syllabus.

## Two bugs found and fixed during the build

Both the same mistake, worth recognising if it recurs: **several loaders return a
`{ data, problems }` wrapper, not the data.**

- `loadUsage()` was used as if it were the usage map, which buried the example sentences
  one level deeper than the page looks for them — it would have silently killed the
  hover cards, the sentence clue and the reveal sentences.
- `loadModels()` was used the same way, so the model-answer files were written under the
  wrong names and every "Model answers" button would have 404'd.

The build now fails loudly on the second class rather than shipping it.

## Open items

- **Only one voice is rendered** (`af_heart`). Adding another is `npm run audio --
  bf_emma` and a rebuild, not a rewrite; the cloud voice list only ever offers what
  exists. All 8 would be ~25 MB and a couple of hours of CPU.
- **No speed control in the cloud build.** Speed is baked into a rendering, so the
  control is hidden there rather than lying.
- **GitHub may keep pre-rewrite objects addressable by exact SHA** until its own GC
  runs. The old SHAs were never disclosed and the repo was private throughout, so this
  is theoretical. The guaranteed fix is deleting and recreating the repo, which needs a
  `delete_repo` token scope the current `gh` login does not have. Judged not warranted
  for an email and an account id.
- **`API_VERSION` is 8 in three places now** — `src/server.js`, `web/app.html` and
  `tools/build-cloud.js`. It was two before. If a route's meaning changes, all three
  move together.

## Handy

```bash
npm run web                      # local tool, reads and writes the workbook
npm run audio                    # render MP3s (needs the model and ffmpeg)
npm run cf:build                 # generate dist/
npm run cf:dev                   # try the cloud build locally first

set -a && . ./.env && set +a     # personal token; never `wrangler login`
npx wrangler whoami              # confirm the account BEFORE deploying
npm run cf:deploy
```

Live at `pte-vocab.amirfox.workers.dev`; source at
`github.com/AmirTallap/pte-vocab-tracker`.
