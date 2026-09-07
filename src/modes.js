import { save, backupMaster } from './loader.js';
import { createPrompt, grade } from './prompt.js';
import { translateUrl, osc8 } from './links.js';
import { rngFor, shuffled } from './generator.js';
import { today } from './tracker.js';
import { SHEETS } from './config.js';
import { c, banner, rule } from './display.js';

const listen = (word, links) =>
  links === false ? c.dim(translateUrl(word))
                  : osc8(translateUrl(word), c.cyan.underline('hear it'));

function poolOf(deck, ids) {
  return ids.flatMap((id) => (deck[id] || []).map((e) => ({ ...e, sheet: id })));
}

function sheetIds(only) {
  const all = Object.keys(SHEETS);
  if (!only) return all;
  return all.filter((id) => id === only);
}

function summary(title, lines) {
  return ['', '  ' + rule(70), `  ${c.bold(title)}`, ...lines.map((l) => '  ' + l), ''].join('\n');
}

/* ------------------------------------------------------------------ RECALL */

/**
 * RECALL DRILL - "show me the Arabic, I write the English".
 *
 * Deliberately scoped to entries you have already marked KNOWN. Its job is not
 * teaching, it is catching decay: a word you claimed last month and cannot
 * produce today is not mastered, and the drill offers to put it back into the
 * unknown pool at the end. That offer is the whole point of the mode - without
 * it "known" only ever ratchets upward and the percentage stops meaning
 * anything.
 */
export async function recall(deck, progress, opts = {}) {
  const ids = sheetIds(opts.only);
  const pool = poolOf(deck, ids).filter((e) => e.known);

  if (!pool.length) {
    console.log(banner('RECALL DRILL'));
    console.log(c.yellow('\n  Nothing to drill yet - no entries are marked known.'));
    console.log(c.dim('  Mark some with `npm run triage`, or in the Excel file, first.\n'));
    return null;
  }

  const rand = rngFor(opts.seed || `recall:${Date.now()}`);
  const items = shuffled(pool, rand).slice(0, opts.limit || pool.length);

  console.log(banner('RECALL DRILL', `${items.length} known entries  ·  Arabic to English`));
  console.log(c.dim('\n  Write the English, then press Enter. Blank Enter reveals the answer.'));
  console.log(c.dim('  Type `q` to stop and save.\n'));

  const p = createPrompt();
  const result = { exact: 0, close: 0, wrong: 0, blank: 0, asked: 0, failed: [] };

  try {
    for (const [i, e] of items.entries()) {
      console.log(`  ${c.dim(`${i + 1}/${items.length}`)}  ${c.bold.yellow(e.arabic)}`);
      const typed = await p.ask('  > ');
      if (typed.trim().toLowerCase() === 'q') break;

      const g = grade(typed, e.word);
      result.asked++;
      result[g === 'blank' ? 'blank' : g]++;

      const mark = { exact: c.green('correct'), close: c.yellow('close'),
                     wrong: c.red('missed'), blank: c.dim('revealed') }[g];
      console.log(`     ${mark}  ${c.bold(e.word)}  ${c.dim(e.meaning)}  ${listen(e.word, opts.links)}\n`);

      if (g !== 'exact') result.failed.push(e);
    }

    console.log(summary('RECALL RESULT', [
      `${c.green(result.exact)} correct   ${c.yellow(result.close)} close   ` +
      `${c.red(result.wrong)} missed   ${c.dim(result.blank + ' revealed')}   ` +
      c.dim(`(${result.asked} asked)`),
    ]));

    if (result.failed.length) {
      const n = result.failed.length;
      console.log(c.yellow(`  ${n} entr${n === 1 ? 'y' : 'ies'} you could not produce cleanly:`));
      console.log('  ' + result.failed.map((e) => e.word).join(', ') + '\n');
      const ans = await p.ask(
        c.bold('  Send these back to the unknown pool so they return in your batches? (y/N) '));
      if (ans.trim().toLowerCase().startsWith('y')) {
        const keys = new Set(result.failed.map((e) => e.sheet + ' ' + e.key));
        for (const id of ids) {
          for (const entry of deck[id]) {
            if (keys.has(id + ' ' + entry.key)) entry.known = false;
          }
        }
        result.demoted = n;
        console.log(c.green(`\n  ${n} sent back to the unknown pool.`));
      }
    }
  } finally {
    p.close();
  }

  progress.drills.push({ date: today(), mode: 'recall', asked: result.asked,
                         exact: result.exact, close: result.close, wrong: result.wrong,
                         demoted: result.demoted || 0 });
  return result;
}

/* ------------------------------------------------------------------ TRIAGE */

/**
 * TRIAGE - "sort what I do and do not know".
 *
 * Sweeps the entries currently marked FALSE and lets you pull out the ones you
 * already know, so the daily batch is spent on genuine gaps. This is the mode
 * that SETS the flags; every other number in the tool is derived from them.
 */
export async function triage(deck, progress, opts = {}) {
  const ids = sheetIds(opts.only);
  let pool = poolOf(deck, ids);
  pool = opts.all ? pool : pool.filter((e) => !e.known);

  if (!pool.length) {
    console.log(banner('TRIAGE'));
    console.log(c.green('\n  Nothing left to sort - every entry is marked known.\n'));
    return null;
  }

  // Least-seen first, so triage attacks material the batches have not covered.
  const seenOf = (e) => (progress.seen[e.sheet] || {})[e.key] || 0;
  const rand = rngFor(opts.seed || `triage:${today()}`);
  pool = shuffled(pool, rand).sort((a, b) => seenOf(a) - seenOf(b));
  const items = pool.slice(0, opts.limit || pool.length);

  console.log(banner('TRIAGE', `${items.length} entries to sort`));
  console.log(c.dim('\n  k = I know this   ·   u or Enter = still unknown   ·   b = back   ·   q = stop and save\n'));

  const p = createPrompt();
  const marked = { known: [], unknown: 0 };

  try {
    for (let i = 0; i < items.length; i++) {
      const e = items[i];
      console.log(`  ${c.dim(`${i + 1}/${items.length}`)}  ${c.bold.white(e.word)}   ${listen(e.word, opts.links)}`);
      console.log(`     ${c.yellow(e.arabic)}   ${c.dim(e.meaning)}`);
      const ans = (await p.ask('  > ')).trim().toLowerCase();

      if (ans === 'q') break;
      if (ans === 'b') {                       // step back one, undoing its mark
        const prev = items[Math.max(i - 1, 0)];
        const prevTarget = deck[prev.sheet].find((x) => x.key === prev.key);
        prevTarget.known = false;
        const idx = marked.known.indexOf(prev.word);
        if (idx >= 0) marked.known.splice(idx, 1);
        i = Math.max(i - 2, -1);
        console.log(c.dim('     back\n'));
        continue;
      }

      const target = deck[e.sheet].find((x) => x.key === e.key);
      if (ans === 'k' || ans === 'y') {
        target.known = true;
        marked.known.push(e.word);
        console.log(c.green('     known\n'));
      } else {
        target.known = false;
        marked.unknown++;
        console.log(c.dim('     still unknown\n'));
      }
    }
  } finally {
    p.close();
  }

  console.log(summary('TRIAGE RESULT', [
    `${c.green(marked.known.length)} marked known   ${c.dim(marked.unknown + ' left unknown')}`,
    marked.known.length ? c.dim('  ' + marked.known.join(', ')) : '',
  ].filter(Boolean)));

  progress.drills.push({ date: today(), mode: 'triage',
                         asked: marked.known.length + marked.unknown,
                         promoted: marked.known.length });
  return marked;
}

/* ------------------------------------------------------------------ REVIEW */

/**
 * REVIEW - the brief's Arabic-to-English quiz, run over TODAY'S BATCH.
 *
 * Distinct from the recall drill: this quizzes the unknown material you are
 * currently learning and offers to promote what you got right. Recall quizzes
 * what you have already claimed, and offers to demote what you have lost.
 */
export async function review(deck, progress, batch, opts = {}) {
  const ids = sheetIds(opts.only);
  const items = ids.flatMap((id) => (batch[id] || []).map((e) => ({ ...e, sheet: id })));

  if (!items.length) {
    console.log(banner('REVIEW'));
    console.log(c.yellow("\n  Today's batch is empty. Run `npm run daily` first.\n"));
    return null;
  }

  const rand = rngFor(`review:${batch.date}`);
  const ordered = shuffled(items, rand);

  console.log(banner("REVIEW - TODAY'S BATCH", `${ordered.length} entries  ·  Arabic to English`));
  console.log(c.dim('\n  Type the English. Blank Enter reveals it. `q` stops and saves.\n'));

  const p = createPrompt();
  const result = { exact: 0, close: 0, wrong: 0, blank: 0, asked: 0, right: [] };

  try {
    for (const [i, e] of ordered.entries()) {
      console.log(`  ${c.dim(`${i + 1}/${ordered.length}`)}  ${c.bold.yellow(e.arabic)}`);
      const typed = await p.ask('  > ');
      if (typed.trim().toLowerCase() === 'q') break;

      const g = grade(typed, e.word);
      result.asked++;
      result[g === 'blank' ? 'blank' : g]++;

      const mark = { exact: c.green('correct'), close: c.yellow('close'),
                     wrong: c.red('missed'), blank: c.dim('revealed') }[g];
      console.log(`     ${mark}  ${c.bold(e.word)}  ${c.dim(e.meaning)}  ${listen(e.word, opts.links)}\n`);
      if (g === 'exact' && !e.known) result.right.push(e);
    }

    console.log(summary('REVIEW RESULT', [
      `${c.green(result.exact)} correct   ${c.yellow(result.close)} close   ` +
      `${c.red(result.wrong)} missed   ${c.dim(result.blank + ' revealed')}   ` +
      c.dim(`(${result.asked} asked)`),
    ]));

    if (result.right.length) {
      const ans = await p.ask(
        c.bold(`  Mark the ${result.right.length} you produced exactly as known? (y/N) `));
      if (ans.trim().toLowerCase().startsWith('y')) {
        const keys = new Set(result.right.map((e) => e.sheet + ' ' + e.key));
        for (const id of ids) {
          for (const entry of deck[id]) {
            if (keys.has(id + ' ' + entry.key)) entry.known = true;
          }
        }
        result.promoted = result.right.length;
        console.log(c.green(`\n  ${result.right.length} marked known.`));
      }
    }
  } finally {
    p.close();
  }

  progress.drills.push({ date: today(), mode: 'review', asked: result.asked,
                         exact: result.exact, close: result.close, wrong: result.wrong,
                         promoted: result.promoted || 0 });
  return result;
}

/** Shared save path for the interactive modes: back the file up, then write. */
export function persist(deck) {
  const backup = backupMaster();
  const file = save(deck);
  return { file, backup };
}
