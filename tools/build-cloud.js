#!/usr/bin/env node
/**
 * Build dist/ - the Cloudflare version of the study page.
 *
 * There is no second copy of anything here. The page is web/app.html, the
 * rules are src/batches.js, the content is data/, and this script's whole job
 * is to turn the parts the local server reads off disk into files a Worker can
 * serve, and to switch the page over to the browser store.
 *
 * What changes between the two builds:
 *   - the deck is a static JSON file rather than the workbook, with
 *     known:false on every row - a visitor has not learnt anything yet;
 *   - the grammar map ships as its articles alone: the failure log over it
 *     lives in data/attempts.db on amir's machine and has no cloud copy;
 *   - the audio is pre-rendered (tools/render-audio.js) instead of synthesised
 *     on demand by a 326MB model that has nowhere to live on a Worker.
 *
 *   node tools/build-cloud.js
 */
import fs from 'node:fs';
import path from 'node:path';

import { ROOT, MODELS_DIR } from '../src/config.js';
import { SHEETS } from '../src/shared.js';
import { load } from '../src/loader.js';
import { loadUsage } from '../src/usage.js';
import { loadGrammarMap } from '../src/grammarmap.js';
import { loadEssays, loadEssayGuides } from '../src/essays.js';
import { loadModels } from '../src/models.js';
import { loadLectures, lectureIndex, PREPARE_SECONDS, SPEAK_SECONDS } from '../src/lectures.js';
import { VOICES, ACCENTS, DEFAULT_VOICE } from '../src/tts.js';

// Kept in step with src/server.js's. A page that finds a different number
// refuses to write, which is the point of it.
const API_VERSION = 11;

const DIST = path.join(ROOT, 'dist');
const WEB = path.join(ROOT, 'web');

const write = (rel, data) => {
  const file = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  return fs.statSync(file).size;
};

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;

function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  /* ---------------------------------------------------------------- page */

  let page = fs.readFileSync(path.join(WEB, 'app.html'), 'utf8');

  // PENDING before the classic script, the module after it: a module is
  // deferred past a classic script, so the page has to be told to wait rather
  // than discovering an absent store halfway through booting.
  const inject = '<script>window.PTE_CLOUD_PENDING = true;</script>\n'
               + '<script type="module" src="/lib/cloud-store.js"></script>\n';
  const at = page.indexOf('<script>');
  if (at < 0) throw new Error('web/app.html has no <script> to inject before');
  page = page.slice(0, at) + inject + page.slice(at);
  write('index.html', page);

  // The browser store and the rules it runs. Flat, because batches.js imports
  // './shared.js' and './generator.js' and cloud-store.js imports both.
  for (const f of ['shared.js', 'batches.js', 'generator.js']) {
    write(`lib/${f}`, fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'));
  }
  write('lib/cloud-store.js', fs.readFileSync(path.join(WEB, 'cloud-store.js'), 'utf8'));

  /* ---------------------------------------------------------------- deck */

  const deck = load();
  const decks = {};
  for (const id of Object.keys(SHEETS)) {
    // known is dropped, not copied: it is amir's, it lives in his workbook,
    // and every visitor starts from nothing.
    decks[id] = deck[id].map((e) => ({ key: e.key, word: e.word, arabic: e.arabic, meaning: e.meaning }));
  }
  const deckBytes = write('static/deck.json', { decks });

  /* ------------------------------------------------------------- content */

  const grammarMap = loadGrammarMap();
  const grammarProblems = grammarMap.problems || [];

  // Destructured for the same reason as loadModels below: loadUsage returns
  // { usage, problems }, and wrapping the whole thing would bury the sentences
  // one level deeper than the page looks for them.
  const { usage, problems: usageProblems } = loadUsage();
  for (const p of usageProblems) console.warn(`  ! ${p}`);
  const usageBytes = write('static/usage.json', { api: API_VERSION, usage });

  const essays = loadEssays();
  const guides = loadEssayGuides();
  for (const p of [...(essays.problems || []), ...(guides.problems || []), ...(grammarProblems)]) {
    console.warn(`  ! ${p}`);
  }
  // Destructured, and given the same word band src/server.js uses: loadModels
  // returns { models, problems }, and the band is the exam's 200-300 rule.
  const { models, problems } = loadModels(MODELS_DIR, essays.words);
  const essayBytes = write('static/essays.json', {
    api: API_VERSION,
    minutes: essays.minutes,
    words: essays.words,
    types: essays.types,
    questions: essays.questions,
    guides: { general: guides.general, types: guides.types },
    models: Object.fromEntries(Object.entries(models).map(([id, list]) => [id, list.length])),
  });

  // One file per prompt, exactly as /api/essays/models/<id> serves them: 180
  // essays is 300KB that most visits to that tab never open.
  // Reported, not repaired - an essay outside the band is teaching the wrong
  // thing and the fix is to rewrite the paragraph, exactly as at startup.
  for (const p of problems) console.warn(`  ! ${p}`);

  let modelBytes = 0;
  for (const [id, list] of Object.entries(models)) {
    modelBytes += write(`static/models/${id}.json`, { api: API_VERSION, id, models: list });
  }

  /* ------------------------------------------------------------- lectures */

  // Same shape as the model answers, and for the same reason: an index that
  // every visit reads, and one file per item that only a taken lecture fetches.
  const { lectures } = loadLectures();
  let lectureBytes = write('static/lectures.json', {
    api: API_VERSION,
    prepare: PREPARE_SECONDS,
    speak: SPEAK_SECONDS,
    lectures: lectureIndex(lectures),
  });
  for (const l of lectures) {
    lectureBytes += write(`static/lectures/${l.id}.json`, { api: API_VERSION, lecture: l });
  }

  /* -------------------------------------------------------------- grammar */

  // The map and its articles. Nothing to strip since 26 Sep 2026: there are
  // no questions any more, only articles, and the log of your faults is local.
  const grammarBytes = write('static/grammarmap.json', {
    api: API_VERSION, lines: grammarMap.lines, links: grammarMap.links,
  });

  /* --------------------------------------------------------------- audio */

  let voiceIds = [];
  const manifestFile = path.join(WEB, 'audio', 'manifest.json');
  let audioBytes = 0;
  if (fs.existsSync(manifestFile)) {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    voiceIds = Object.keys(manifest.voices || {});
    audioBytes += write('audio/manifest.json', manifest);
    for (const v of voiceIds) {
      const from = path.join(WEB, 'audio', v);
      const to = path.join(DIST, 'audio', v);
      fs.mkdirSync(to, { recursive: true });
      for (const f of fs.readdirSync(from)) {
        fs.copyFileSync(path.join(from, f), path.join(to, f));
        audioBytes += fs.statSync(path.join(to, f)).size;
      }
    }
  } else {
    console.warn('  ! no web/audio/manifest.json - run tools/render-audio.js; the build will have no speech');
  }

  // Only what was rendered. A dropdown offering a voice with no clips behind
  // it is a dropdown full of silence.
  const shipped = VOICES.filter((v) => voiceIds.includes(v.id));
  write('static/voices.json', {
    voices: shipped,
    accents: ACCENTS.filter((a) => shipped.some((v) => v.accent === a.id)),
    defaultVoice: shipped.some((v) => v.id === DEFAULT_VOICE) ? DEFAULT_VOICE : (shipped[0] || {}).id,
    ready: shipped.length > 0,
  });

  /* --------------------------------------------------------------- done */

  // Every prompt the page will offer a button for must have a file behind it.
  // The button is drawn from the counts in essays.json, so a mismatch here is a
  // 404 the visitor finds rather than one the build does.
  for (const id of Object.keys(models)) {
    if (!fs.existsSync(path.join(DIST, `static/models/${id}.json`))) {
      throw new Error(`essays.json offers model answers for "${id}" but no file was written`);
    }
  }

  const entries = Object.values(decks).reduce((n, l) => n + l.length, 0);
  console.log(`  page       ${kb(Buffer.byteLength(page))}`);
  console.log(`  deck       ${kb(deckBytes)}  (${entries} entries, all known:false)`);
  console.log(`  usage      ${kb(usageBytes)}`);
  console.log(`  grammar    ${kb(grammarBytes)}  (${grammarMap.lines.length} map lines, articles only)`);
  console.log(`  essays     ${kb(essayBytes)} + ${kb(modelBytes)} of model answers`);
  console.log(`  lectures   ${kb(lectureBytes)}  (${lectures.length} to re-tell)`);
  console.log(`  audio      ${(audioBytes / 1024 / 1024).toFixed(1)}MB  (${shipped.map((v) => v.id).join(', ') || 'none'})`);
  console.log(`\n  dist/ ready`);
}

main();
