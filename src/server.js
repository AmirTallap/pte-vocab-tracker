import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { load, save, backupMaster, keyOf } from './loader.js';
import { loadProgress, saveProgress, backupProgress, stats, snapshot, today } from './tracker.js';
import { syncBatches, createBatch, deleteBatch, resetBatch, noteError, batchPayload, BATCH_SIZE } from './batches.js';
import { loadGrammar, isAccepted, grammarState, recordAnswer, grammarProgress } from './grammar.js';
import { say, status as ttsStatus, VOICES, ACCENTS, DEFAULT_VOICE, isVoiceId } from './tts.js';
import { loadUsage, usageCounts } from './usage.js';
import { loadEssays, loadEssayGuides } from './essays.js';
import { loadModels, modelCounts } from './models.js';
import { SHEETS, MASTER_FILE, ROOT } from './config.js';

const PAGE = path.join(ROOT, 'web', 'app.html');

/**
 * Bumped whenever a route's meaning changes in a way an older page would get
 * wrong. `web/app.html` carries the same number and refuses to talk to a server
 * that does not match.
 *
 * This exists because of a real loss on 2 Sep 2026. The page is read off disk on
 * every request, so editing app.html puts new code in the browser instantly -
 * but the server had been running for an hour and was still the old build. The
 * new page's Reset all sent {scope:'seen'}, which the old /api/reset did not
 * know about and ignored, wiping every Known flag in the workbook instead of
 * clearing seen counts. A page newer than its server must fail loudly, not
 * quietly mean something else.
 *
 * 1  the original routes
 * 2  /api/reset takes a scope; batches are drawn once and never refilled
 * 3  /api/batch/reset no longer takes a scope - it resets everything;
 *    /api/batch/error is new
 * 4  batches carry doneIds, which a retake pass is built from
 * 5  entries carry `flagged`; /api/flag sets it, /api/reset takes a `flags`
 *    scope - and an older server would read that scope as "both" and wipe the
 *    workbook, which is exactly the failure this number exists to stop
 * 6  /api/usage is new: the example sentences shown under a revealed answer.
 *    A new route rather than a changed one, so nothing an older server does is
 *    dangerous here - but it would 404 the request and the drill would quietly
 *    show no examples at all, and "quietly means something else" is the thing
 *    this number exists to prevent. Bumped so the mismatch is said out loud.
 * 7  /api/essays is new: the Write Essay prompts and their timing. New route,
 *    not a changed one, so nothing an older server does here is dangerous -
 *    but it would 404 and the Essays tab would come up empty with no prompts
 *    and no explanation, which is the quiet wrong meaning this number stops.
 * 8  /api/essays carries `guides` and a `models` count, and
 *    /api/essays/models/<id> is new: the three worked model answers for one
 *    prompt. Another addition rather than a change, and bumped for the reason
 *    6 and 7 were - an older server answers /api/essays without the counts,
 *    the page draws no Show model answers button anywhere, and the whole
 *    feature is silently missing rather than loudly broken.
 */
const API_VERSION = 8;

/**
 * The browser page is the front end for the SAME Excel file the rest of the
 * tool uses - it is not a separate copy with its own memory. Marking a word
 * known in the browser sets Known=TRUE in the workbook, so there is one source
 * of truth and nothing to reconcile later.
 */
export function serve({ port = 4173, open = true } = {}) {
  let deck = load();
  let progress = loadProgress();

  const index = new Map();
  for (const id of Object.keys(SHEETS)) {
    for (const e of deck[id]) index.set(`${id}:${e.key}`, e);
  }

  // A flag flipped in Excel between sessions can leave a batch holding words
  // you already know. Reconciled here, against the workbook we just read.
  let pendingBatchSync = syncBatches(deck, progress);

  // Static study content, read once. Answers to it live in progress.json.
  const grammar = loadGrammar();
  // Example sentences, also static and also never written back - see usage.js.
  const { usage, problems: usageProblems } = loadUsage();
  // The essay prompts, static for the third time and never written back either.
  const essays = loadEssays();
  // How to write one, and three worked answers per prompt. Static as well; the
  // models are validated against the same word band the prompts carry, so an
  // example that breaks the exam's 200-300 is reported at startup.
  const essayGuides = loadEssayGuides();
  const { models: essayModels, problems: modelProblems } = loadModels(undefined, essays.words);
  const grammarById = new Map(grammar.modules.map((m) => [m.id, m]));

  /* ---- writes are debounced, and backed up once per session ------------ */
  let writeTimer = null;
  let deckBackedUp = false;
  let progressBackedUp = false;
  // Two stores, two dirty flags. A grammar answer or a new batch changes only
  // progress.json; there is no reason to rewrite 275KB of workbook for it.
  let deckDirty = false;
  let progressDirty = false;
  let lastWrite = null;

  // Two stores, two backups. The workbook has always had one; progress.json
  // did not, and it is the only record of the numbered batches - so a batch
  // lost to a crash could not be recovered from anywhere.
  function backupDeckOnce() {
    if (deckBackedUp) return;
    deckBackedUp = true;
    try { backupMaster(); }
    catch (err) { console.error(`  ! could not back up the workbook: ${err.message}`); }
  }

  function backupProgressOnce() {
    if (progressBackedUp) return;
    progressBackedUp = true;
    try { backupProgress(); }
    catch (err) { console.error(`  ! could not back up progress.json: ${err.message}`); }
  }

  /**
   * progress.json, now. Batch numbers exist nowhere else and a re-created batch
   * cannot reuse a number, so they do not wait out a debounce window: the file
   * is 1KB, and the 800ms delay was only ever there for the 275KB workbook.
   */
  function writeProgressNow() {
    backupProgressOnce();
    try {
      saveProgress(progress);
      lastWrite = new Date().toISOString();
    } catch (err) {
      console.error(`  ! could not write progress.json: ${err.message}`);
      progressDirty = true;           // leave it for the next flush to retry
    }
  }

  /**
   * Each store is written inside its own try, and progress goes first: a
   * workbook write that throws (open in Excel, disk full) used to be an
   * uncaught exception in a timer callback, which killed the process and took
   * the unwritten batches with it. Now it prints, leaves the flag set, and
   * retries on the next write.
   */
  function flush() {
    if (!progressDirty && !deckDirty) return;
    let wrote = false;

    if (progressDirty) {
      backupProgressOnce();
      try {
        snapshot(progress, deck);
        saveProgress(progress);
        progressDirty = false;
        wrote = true;
      } catch (err) {
        console.error(`  ! could not write progress.json: ${err.message}`);
      }
    }

    if (deckDirty) {
      backupDeckOnce();
      try {
        save(deck);
        deckDirty = false;
        wrote = true;
      } catch (err) {
        console.error(`  ! could not write the workbook: ${err.message}`);
        console.error('    Is it open in Excel? Your marks are held and retried on the next write.');
      }
    }

    if (wrote) lastWrite = new Date().toISOString();
  }

  // A full .xlsx rewrite per click would be ~275KB of disk churn on every tap.
  // Coalesced instead - and flushed on shutdown so nothing is lost on Ctrl-C.
  function scheduleWrite() {
    deckDirty = true;
    progressDirty = true;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flush, 800);
  }

  /** For changes the workbook has no stake in - grammar answers, say. */
  function scheduleProgressWrite() {
    progressDirty = true;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flush, 800);
  }

  function payload() {
    const out = { api: API_VERSION, decks: {}, stats: null, file: MASTER_FILE, lastWrite };
    for (const [id, cfg] of Object.entries(SHEETS)) {
      out.decks[id] = deck[id].map((e) => ({
        id: `${id}:${e.key}`,
        word: e.word,
        arabic: e.arabic,
        meaning: e.meaning,
        known: e.known,
        seen: (progress.seen[id] || {})[e.key] || 0,
        // A flag is not mastery state and has no column in the workbook - it
        // is a bookmark in progress.json saying "come back to this one and
        // write with it". Sent with every entry so the list, the batch table
        // and the drill all read it from the same place.
        flagged: !!(progress.flags[id] || {})[e.key],
        label: cfg.sheet,
      }));
    }
    const s = stats(deck, progress);
    out.stats = { examDate: s.examDate, daysToExam: s.daysToExam, per: s.per };
    out.batches = batchPayload(deck, progress);
    out.batchSize = BATCH_SIZE;
    return out;
  }

  const json = (res, code, body) => {
    const text = JSON.stringify(body);
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
      'cache-control': 'no-store',
    });
    res.end(text);
  };

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
        // A study app posts a few dozen bytes. Anything larger is not ours.
        if (raw.length > 1e6) { req.destroy(); reject(new Error('body too large')); }
      });
      req.on('end', () => {
        try { resolve(raw ? JSON.parse(raw) : {}); }
        catch (err) { reject(new Error('invalid JSON body')); }
      });
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    try {
      // Every view has a real URL - /word_list, /batches/words-3/training and the
      // rest are client-side routes, so any non-API GET returns the page and the
      // router in the browser decides what to draw.
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        const html = fs.readFileSync(PAGE);
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': html.length,
          'cache-control': 'no-store',
        });
        return res.end(html);
      }

      if (req.method === 'GET' && url.pathname === '/api/deck') {
        return json(res, 200, payload());
      }

      /**
       * The voice catalogue, answered from a static table so the two dropdowns
       * paint immediately - listing them must not wait on a 326MB model load.
       * `ready` is what lets the page warn that the first word will take a
       * minute or two rather than appearing to hang.
       */
      if (req.method === 'GET' && url.pathname === '/api/tts/voices') {
        return json(res, 200, {
          voices: VOICES, accents: ACCENTS, defaultVoice: DEFAULT_VOICE, ...ttsStatus(),
        });
      }

      /**
       * One word, spoken. A WAV, not JSON, so the page can hand it straight to
       * an <audio> element. Rendered once and cached on disk, so the second
       * time round - and every time after a restart - it comes back in about 20
       * milliseconds and the model is never loaded at all.
       *
       * The page asks for this twice per card on purpose: once while you are
       * still typing (a prefetch) and once on the reveal. The second call is a
       * cache hit, which is what makes the reveal instant rather than the ~2.5s
       * a first rendering costs.
       */
      if (req.method === 'GET' && url.pathname === '/api/tts') {
        const text = url.searchParams.get('text') || '';
        const voice = url.searchParams.get('voice') || DEFAULT_VOICE;
        const speed = url.searchParams.get('speed') || '1';
        if (!text.trim()) return json(res, 400, { error: 'nothing to say' });
        if (!isVoiceId(voice)) return json(res, 400, { error: `unknown voice: ${voice}` });

        let audio;
        try {
          audio = await say(text, voice, { speed });
        } catch (err) {
          // Being offline before the model has been downloaded is the one
          // failure that is worth explaining rather than logging.
          return json(res, 503, { error: `could not speak: ${err.message}` });
        }

        res.writeHead(200, {
          'content-type': 'audio/wav',
          'content-length': audio.buffer.length,
          // Same words, same voice, same bytes - and the disk cache behind this
          // is the real one. This only saves the round trip on a replay.
          'cache-control': 'public, max-age=604800',
        });
        return res.end(req.method === 'HEAD' ? undefined : audio.buffer);
      }

      if (req.method === 'POST' && url.pathname === '/api/mark') {
        const { id, known, seen } = await readBody(req);
        const entry = index.get(id);
        if (!entry) return json(res, 404, { error: `unknown entry: ${id}` });

        entry.known = !!known;

        if (seen) {
          const [sheet, key] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
          progress.seen[sheet] ||= {};
          progress.seen[sheet][key] = (progress.seen[sheet][key] || 0) + 1;
        }

        progress.cycleStart ||= today();

        // Immediately, in the same request: a word you have just mastered
        // moves to its batch's cleared list, so the browser is told the batch
        // is one shorter before it draws the next card. Nothing replaces it -
        // a batch is the 20 it was drawn with.
        syncBatches(deck, progress);
        scheduleWrite();

        const s = stats(deck, progress);
        return json(res, 200, { ok: true, per: s.per, batches: batchPayload(deck, progress) });
      }

      /**
       * Flag one entry, or take the flag off it: the words you want to come
       * back to and build a sentence with.
       *
       * Its own route, and progress.json's - NOT the workbook's - for the same
       * reason /api/batch/error and the grammar answers are. A flag says
       * nothing about whether you know a word, so the .xlsx has no column for
       * it and rewriting 275KB to remember one would be absurd; and this is a
       * button pressed mid-drill, where the debounced workbook write is the
       * one thing that must not be triggered.
       */
      if (req.method === 'POST' && url.pathname === '/api/flag') {
        const { id, flagged } = await readBody(req);
        if (!index.has(id)) return json(res, 404, { error: `unknown entry: ${id}` });

        const sheet = id.slice(0, id.indexOf(':'));
        const key = id.slice(id.indexOf(':') + 1);
        progress.flags[sheet] ||= {};
        // Deleted rather than set to false: the file is a list of what is
        // flagged, so unflagging leaves nothing behind to read back.
        if (flagged) progress.flags[sheet][key] = true;
        else delete progress.flags[sheet][key];

        scheduleProgressWrite();
        return json(res, 200, {
          ok: true,
          flagged: !!progress.flags[sheet][key],
          count: Object.keys(progress.flags[sheet]).length,
        });
      }

      /**
       * Add one entry to a sheet. The workbook is the single source of truth,
       * so a new word goes into `deck` and is written back to the .xlsx like
       * any other change - there is no separate list of "words I added".
       */
      if (req.method === 'POST' && url.pathname === '/api/entry/new') {
        const { kind, word, arabic, meaning } = await readBody(req);
        if (!SHEETS[kind]) return json(res, 400, { error: `unknown deck: ${kind}` });

        const text = String(word ?? '').trim();
        if (!text) return json(res, 400, { error: 'Type the word or phrase first.' });

        // Same key rule the loader uses, so a word typed here collides with the
        // sheet exactly as a duplicate row in the workbook would.
        const key = keyOf(text);
        const id = `${kind}:${key}`;
        if (index.has(id)) {
          return json(res, 409, {
            error: `"${index.get(id).word}" is already in ${SHEETS[kind].sheet}.`,
          });
        }

        const entry = {
          key,
          word: text,
          arabic: String(arabic ?? '').trim(),
          meaning: String(meaning ?? '').trim(),
          known: false,
        };
        deck[kind].push(entry);
        index.set(id, entry);

        // Nothing to reconcile: a word just added is in no batch and is not
        // known, so it simply joins the pool the next batch is drawn from.
        scheduleWrite();

        return json(res, 200, { ok: true, id, ...payload() });
      }

      if (req.method === 'POST' && url.pathname === '/api/batch/new') {
        const { kind } = await readBody(req);
        if (!SHEETS[kind]) return json(res, 400, { error: `unknown deck: ${kind}` });

        const batch = createBatch(deck, progress, kind);
        if (!batch) {
          return json(res, 409, {
            error: `Nothing left to draw - every ${SHEETS[kind].label.replace(/s$/, '')} ` +
                   'you have not marked known is already in a batch.',
          });
        }
        writeProgressNow();
        return json(res, 200, { ok: true, n: batch.n, batches: batchPayload(deck, progress) });
      }

      if (req.method === 'POST' && url.pathname === '/api/batch/delete') {
        const { kind, n } = await readBody(req);
        if (!SHEETS[kind]) return json(res, 400, { error: `unknown deck: ${kind}` });
        if (!deleteBatch(deck, progress, kind, Number(n))) {
          return json(res, 404, { error: `no batch ${n} in ${kind}` });
        }
        writeProgressNow();
        return json(res, 200, { ok: true, batches: batchPayload(deck, progress) });
      }

      /**
       * One wrong answer in a batch drill. Its own tiny route because it must
       * NOT reach the workbook: an error count is a 1KB progress.json change,
       * and putting it through scheduleWrite() would rewrite 275KB of .xlsx
       * every time a spelling slipped.
       */
      if (req.method === 'POST' && url.pathname === '/api/batch/error') {
        const { kind, n } = await readBody(req);
        if (!SHEETS[kind]) return json(res, 400, { error: `unknown deck: ${kind}` });

        const errors = noteError(progress, kind, Number(n));
        if (errors === null) return json(res, 404, { error: `no batch ${n} in ${kind}` });

        scheduleProgressWrite();
        return json(res, 200, { ok: true, errors });
      }

      /**
       * Put one batch back to the day it was drawn: what it cleared comes back
       * into it as Known=FALSE, its seen counts go to 0, its error count goes
       * to 0. Known flags are the workbook's, so this takes the full debounced
       * write - it is one deliberate action, not something done per keystroke.
       */
      if (req.method === 'POST' && url.pathname === '/api/batch/reset') {
        const { kind, n } = await readBody(req);
        if (!SHEETS[kind]) return json(res, 400, { error: `unknown deck: ${kind}` });

        const summary = resetBatch(deck, progress, kind, Number(n));
        if (!summary) return json(res, 404, { error: `no batch ${n} in ${kind}` });

        scheduleWrite();
        return json(res, 200, { ok: true, ...summary, ...payload() });
      }

      /**
       * Reset the whole deck - every word and every phrase, in and out of a
       * batch. Scoped like the per-batch reset and for the same reason: seen
       * counts decide the order cards come in, the Known flags decide what is
       * still to learn, and taking back one is not taking back the other. A
       * seen-only reset never touches the workbook, so it takes the 1KB
       * progress write rather than the 275KB one.
       */
      if (req.method === 'POST' && url.pathname === '/api/reset') {
        const { scope } = await readBody(req);
        // Listed, not defaulted into: an unrecognised scope falling through to
        // 'both' is how a page newer than its server wiped the workbook once.
        // 'flags' in particular must never be read as "everything".
        const what = ['seen', 'known', 'flags', 'both'].includes(scope) ? scope : 'both';
        let known = 0;
        let seen = 0;
        let flags = 0;

        // Flags are a bookmark, not progress: 'both' means the seen counts and
        // the Known flags, exactly as it always has, and leaves them alone.
        // Clearing them is its own scope and never touches the workbook.
        if (what === 'flags') {
          for (const id of Object.keys(SHEETS)) {
            flags += Object.keys(progress.flags[id] || {}).length;
            progress.flags[id] = {};
          }
          scheduleProgressWrite();
          return json(res, 200, { ok: true, scope: what, known, seen, flags, ...payload() });
        }

        for (const id of Object.keys(SHEETS)) {
          if (what !== 'seen') {
            for (const e of deck[id]) if (e.known) { e.known = false; known += 1; }
          }
          if (what !== 'known') {
            seen += Object.keys(progress.seen[id] || {}).length;
            progress.seen[id] = {};
          }
        }

        // Everything is unknown again, so every batch takes back what it had
        // cleared and is the full set it was drawn as.
        syncBatches(deck, progress);
        if (what === 'seen') scheduleProgressWrite(); else scheduleWrite();
        return json(res, 200, { ok: true, scope: what, known, seen, flags, ...payload() });
      }

      /**
       * Every example sentence, in one response, fetched once when the page
       * loads. Not folded into /api/deck: the deck is re-sent whole by a mark,
       * an add and every reset, and these sentences never change - re-sending
       * them on each of those would be the only part of the payload that grows
       * without limit as more of the deck gets examples. Not fetched per card
       * either: the reveal is drawn synchronously, and a round trip there is
       * exactly the stutter the TTS prefetch exists to avoid.
       */
      if (req.method === 'GET' && url.pathname === '/api/usage') {
        return json(res, 200, { api: API_VERSION, usage });
      }

      /**
       * The essay prompts, whole, once. Nothing is stripped the way the grammar
       * questions are - an essay has no key to hide, and seeing the question is
       * the entire point. Nothing is written back either: this route is GET and
       * there is no companion POST, because the essay you type is not saved
       * anywhere on this side. See essays.js for why.
       */
      if (req.method === 'GET' && url.pathname === '/api/essays') {
        return json(res, 200, {
          api: API_VERSION,
          minutes: essays.minutes,
          words: essays.words,
          types: essays.types,
          questions: essays.questions,
          guides: { general: essayGuides.general, types: essayGuides.types },
          // How many model answers each prompt has, not the answers themselves.
          // This is what lets the page draw the button before it has fetched
          // anything, and it keeps the tab's one boot request small.
          models: Object.fromEntries(
            Object.entries(essayModels).map(([id, list]) => [id, list.length])),
        });
      }

      /**
       * The three model answers for ONE prompt, fetched when you ask to see
       * them. Per prompt rather than whole, unlike /api/usage: the example
       * sentences are drawn synchronously into a reveal that must not stutter,
       * whereas this is a button press that can afford a round trip, and 180
       * essays is 300KB that most visits to the tab never look at.
       *
       * GET only, like everything else here. A model answer is something to
       * read: there is nothing to mark, nothing to save and nothing to
       * reconcile with either store.
       */
      if (req.method === 'GET' && url.pathname.startsWith('/api/essays/models/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/essays/models/'.length));
        const list = essayModels[id];
        if (!list) return json(res, 404, { error: `no model answers for "${id}"` });
        return json(res, 200, { api: API_VERSION, id, models: list });
      }

      if (req.method === 'GET' && url.pathname === '/api/grammar') {
        return json(res, 200, {
          groups: grammar.groups,
          // The accepted answers and the key are stripped here: the marking is
          // the server's job, so the page cannot be read for the answers.
          modules: grammar.modules.map((m) => ({
            id: m.id, title: m.title, group: m.group, summary: m.summary,
            sections: m.sections, slips: m.slips,
            questions: m.questions.map((q) => (q.type === 'mcq'
              ? { id: q.id, type: 'mcq', prompt: q.prompt, options: q.options }
              : { id: q.id, type: 'blank', prompt: q.prompt, hint: q.hint })),
          })),
          progress: grammarProgress(progress),
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/grammar/answer') {
        const { module: moduleId, q: questionId, choice, text } = await readBody(req);
        const mod = grammarById.get(moduleId);
        if (!mod) return json(res, 404, { error: `unknown module: ${moduleId}` });
        const question = mod.questions.find((x) => x.id === questionId);
        if (!question) return json(res, 404, { error: `unknown question: ${questionId}` });

        const correct = question.type === 'mcq'
          ? Number(choice) === question.answer
          : isAccepted(question, text);

        const tally = recordAnswer(progress, moduleId, questionId, correct);
        scheduleProgressWrite();

        return json(res, 200, {
          ok: true,
          correct,
          answer: question.type === 'mcq' ? question.answer : question.accept,
          explain: question.explain,
          tally,
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/grammar/reset') {
        const { module: moduleId } = await readBody(req);
        if (!grammarById.has(moduleId)) return json(res, 404, { error: `unknown module: ${moduleId}` });
        const m = grammarState(progress, moduleId);
        m.answers = {};
        m.lastAt = null;
        scheduleProgressWrite();
        return json(res, 200, { ok: true, progress: grammarProgress(progress) });
      }

      json(res, 404, { error: 'not found' });
    } catch (err) {
      json(res, 400, { error: err.message });
    }
  });

  if (pendingBatchSync) { pendingBatchSync = false; scheduleWrite(); }

  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    const s = stats(deck, progress);
    console.log('');
    console.log(`  PTE Vocabulary  ->  ${url}`);
    console.log(`  ${deck.words.length} words · ${deck.phrases.length} phrases · ` +
                `${s.per.words.known + s.per.phrases.known} known · ` +
                `${s.daysToExam} days to exam`);
    const gq = grammar.modules.reduce((n, m) => n + m.questions.length, 0);
    if (grammar.modules.length) {
      console.log(`  grammar: ${grammar.modules.length} modules · ${gq} questions`);
    }
    for (const p of grammar.problems) console.error(`  ! grammar module skipped - ${p}`);
    const uc = usageCounts(usage);
    if (uc.entries) {
      console.log(`  usage: ${uc.sentences} example sentences for ${uc.entries} entries`);
    }
    for (const p of usageProblems) console.error(`  ! usage skipped - ${p}`);
    if (essays.questions.length) {
      console.log(`  essays: ${essays.questions.length} prompts · ` +
                  `${essays.words.min}-${essays.words.max} words in ${essays.minutes} min`);
    }
    for (const p of essays.problems) console.error(`  ! essay skipped - ${p}`);
    const mc = modelCounts(essayModels);
    if (mc.essays) {
      console.log(`  models: ${mc.essays} worked answers across ${mc.prompts} prompts`);
    }
    for (const p of essayGuides.problems) console.error(`  ! guide - ${p}`);
    for (const p of modelProblems) console.error(`  ! model - ${p}`);
    console.log(`  writing to ${MASTER_FILE}`);
    console.log('  Ctrl-C to stop.');
    console.log('');
    if (open) openBrowser(url);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Port ${port} is already in use. Try: npm run web -- --port ${port + 1}\n`);
      process.exit(1);
    }
    throw err;
  });

  // Ctrl-C must not drop a pending write - the debounce window is the only
  // moment the workbook and the browser can disagree.
  //
  // SIGHUP matters as much as SIGINT here: closing the terminal window hangs up
  // the process, and Node's default action for SIGHUP is to die on the spot
  // without running any handler. Every unwritten batch went with it.
  const shutdown = (signal) => {
    clearTimeout(writeTimer);
    try { flush(); } catch (err) { console.error(`  ! write failed on exit: ${err.message}`); }
    // The terminal may already be gone on SIGHUP - do not die writing to it.
    try { console.log(`\n  Saved${signal === 'SIGHUP' ? ' (terminal closed)' : ''}. Bye.\n`); } catch {}
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) {
    process.on(signal, () => shutdown(signal));
  }

  // Last resort: an unexpected throw anywhere should still leave the batches on
  // disk rather than only in this process's memory.
  process.on('uncaughtException', (err) => {
    console.error(`\n  ! ${err.stack || err.message}`);
    try { clearTimeout(writeTimer); flush(); } catch {}
    process.exit(1);
  });

  return server;
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32' ? 'start ""'
            : 'xdg-open';
  exec(`${cmd} "${url}"`, (err) => {
    if (err) console.log(`  (could not open a browser automatically - visit ${url})`);
  });
}
