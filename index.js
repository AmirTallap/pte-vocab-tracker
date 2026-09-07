#!/usr/bin/env node
import { Command } from 'commander';
import { load, save, backupMaster } from './src/loader.js';
import { loadProgress, saveProgress, stats, snapshot, today } from './src/tracker.js';
import { dailyBatch, recordBatch } from './src/generator.js';
import { merge, readIncoming, loadReserve, saveReserve, topUp } from './src/replacer.js';
import { exportBatch, FORMATS } from './src/exporter.js';
import { recall, triage, review, persist } from './src/modes.js';
import { serve } from './src/server.js';
import { c, banner, section, statsBlock, milestoneBlock, rule } from './src/display.js';
import { SHEETS, MASTER_FILE } from './src/config.js';

const program = new Command();

program
  .name('pte')
  .description('PTE vocabulary cycling system - daily batches, mastery tracking, drills')
  .version('1.0.0');

/** Load the deck and warn about anything the file itself got wrong. */
function open() {
  const deck = load();
  const progress = loadProgress();
  for (const [id, dupes] of Object.entries(deck.meta.duplicates)) {
    if (dupes.length) {
      console.log(c.dim(`  note: ${dupes.length} duplicate ${id} merged on load ` +
                        `(${dupes.slice(0, 3).join(', ')}${dupes.length > 3 ? ', ...' : ''})`));
    }
  }
  return { deck, progress };
}

const onlyOpt = (v) => {
  if (v && !Object.keys(SHEETS).includes(v)) {
    throw new Error(`--only must be one of: ${Object.keys(SHEETS).join(', ')}`);
  }
  return v;
};

/* --------------------------------------------------------------------- web */

program.command('web')
  .description('open the study page in your browser (reads and writes the same workbook)')
  .option('-p, --port <n>', 'port to listen on', (v) => parseInt(v, 10), 4173)
  .option('--no-open', 'do not launch a browser')
  .action((opts) => {
    serve({ port: opts.port, open: opts.open });
  });

/* ------------------------------------------------------------------- daily */

program.command('daily')
  .description("show today's batch (50 words + 20 phrases)")
  .option('-d, --date <YYYY-MM-DD>', 'draw the batch for another date', today())
  .option('-r, --regenerate', 'discard the stored batch for this date and draw a new one')
  .option('--no-links', 'plain words instead of clickable pronunciation links')
  .option('--only <sheet>', 'words | phrases', onlyOpt)
  .action((opts) => {
    const { deck, progress } = open();
    const batch = dailyBatch(deck, progress, { date: opts.date, regenerate: opts.regenerate });

    // Recorded BEFORE the header is drawn: recordBatch is what sets cycleStart,
    // and a first run that printed "cycle day -" while starting the cycle would
    // be reporting the state it just left.
    recordBatch(progress, batch);
    const s0 = stats(deck, progress, opts.date);
    console.log(banner(`DAILY BATCH  ${batch.date}`,
      (s0.cycleDay ? `cycle day ${s0.cycleDay} (week ${s0.week})  ·  ` : '') +
      `${s0.daysToExam} days to exam` + (batch.replayed ? '  ·  already drawn today' : '')));

    for (const [id, cfg] of Object.entries(SHEETS)) {
      if (opts.only && opts.only !== id) continue;
      console.log(section(cfg.sheet, batch[id], { links: opts.links }));
      if (batch.short[id]) {
        console.log(c.yellow(`\n  only ${batch[id].length} unknown ${cfg.label} left ` +
                             `(target ${cfg.perDay}) - the pool is nearly clear.`));
      }
    }

    snapshot(progress, deck, batch.date);
    saveProgress(progress);

    console.log('\n  ' + rule(70));
    console.log(c.dim('  Click a word to hear it on Google Translate. ' +
                      'Mark what you learn with `npm run triage`.\n'));
  });

/* ------------------------------------------------------------------- stats */

program.command('stats')
  .description('progress dashboard, pace and milestones')
  .action(() => {
    const { deck, progress } = open();
    const s = stats(deck, progress);
    console.log(statsBlock(s));
    console.log(milestoneBlock(s));

    const last = progress.drills.slice(-3).reverse();
    if (last.length) {
      console.log(`\n  ${c.bold.white('RECENT DRILLS')}\n`);
      for (const d of last) {
        const bits = [`${d.asked} asked`];
        if (d.exact != null) bits.push(`${d.exact} correct`);
        if (d.promoted) bits.push(c.green(`+${d.promoted} known`));
        if (d.demoted) bits.push(c.red(`-${d.demoted} known`));
        console.log(`  ${c.dim(d.date)}  ${c.bold(d.mode.padEnd(8))} ${c.dim(bits.join('  ·  '))}`);
      }
    }
    console.log('');
  });

/* ------------------------------------------------------------------ update */

program.command('update')
  .argument('<file>', 'the .xlsx you marked up and are sending back')
  .description('fold an edited workbook back in: promote TRUE entries, top up from the reserve')
  .option('--dry-run', 'report what would change without writing anything')
  .action((file, opts) => {
    const { deck, progress } = open();
    const incoming = readIncoming(file);
    const report = merge(deck, incoming);

    const reserve = loadReserve();
    const promoted = opts.dryRun ? { words: [], phrases: [] } : topUp(deck, reserve);

    console.log(banner('UPDATE', opts.dryRun ? c.yellow('DRY RUN - nothing written') : file));

    let changes = 0;
    for (const [id, cfg] of Object.entries(SHEETS)) {
      const m = report.mastered[id], u = report.unmarked[id], a = report.added[id];
      changes += m.length + u.length + a.length;
      console.log(`\n  ${c.bold(cfg.sheet)}`);
      console.log(`    ${c.green('+ mastered')}  ${String(m.length).padStart(3)}` +
                  (m.length ? c.dim(`   ${m.slice(0, 8).join(', ')}${m.length > 8 ? ', ...' : ''}`) : ''));
      if (u.length) {
        console.log(`    ${c.red('- un-marked')} ${String(u.length).padStart(3)}` +
                    c.dim(`   ${u.slice(0, 8).join(', ')}${u.length > 8 ? ', ...' : ''}`));
      }
      if (a.length) {
        console.log(`    ${c.cyan('+ new rows')}  ${String(a.length).padStart(3)}` +
                    c.dim(`   ${a.slice(0, 8).join(', ')}${a.length > 8 ? ', ...' : ''}`));
      }
      if (report.missing[id].length) {
        console.log(c.dim(`    ${report.missing[id].length} entries absent from the incoming file - kept, not deleted`));
      }
      if (promoted[id].length) {
        console.log(`    ${c.magenta('+ reserve')}   ${String(promoted[id].length).padStart(3)}` +
                    c.dim(`   ${promoted[id].join(', ')}`));
      }
    }

    if (opts.dryRun) {
      console.log(c.yellow(`\n  ${changes} change(s) detected. Re-run without --dry-run to apply.\n`));
      return;
    }

    const backup = backupMaster();
    save(deck);
    saveReserve(reserve);
    snapshot(progress, deck);
    saveProgress(progress);

    const s = stats(deck, progress);
    console.log('\n  ' + rule(70));
    console.log(`  ${c.green('written')}  ${MASTER_FILE}`);
    if (backup) console.log(c.dim(`  backup   ${backup}`));
    console.log('');
    console.log(statsBlock(s));
    console.log('');
  });

/* ---------------------------------------------------------------- export */

program.command('export-batch')
  .description('save a batch as a file you can study away from the terminal')
  .option('-d, --date <YYYY-MM-DD>', 'which day', today())
  .option('-f, --format <fmt>', FORMATS.join(' | '), 'txt')
  .option('-o, --out <path>', 'explicit output path')
  .action((opts) => {
    const { deck, progress } = open();
    const batch = dailyBatch(deck, progress, { date: opts.date });
    const file = exportBatch(batch, { format: opts.format, out: opts.out });
    const n = Object.keys(SHEETS).reduce((a, id) => a + batch[id].length, 0);
    console.log(banner('EXPORT'));
    console.log(`\n  ${c.green('written')}  ${file}`);
    console.log(c.dim(`  ${n} entries, each with a Google Translate pronunciation link.\n`));
  });

/* ----------------------------------------------------------- interactive */

program.command('review')
  .description("quiz today's batch: Arabic shown, you type the English")
  .option('--only <sheet>', 'words | phrases', onlyOpt)
  .option('--no-links', 'plain URLs instead of clickable links')
  .action(async (opts) => {
    const { deck, progress } = open();
    const batch = dailyBatch(deck, progress, { date: today() });
    const res = await review(deck, progress, batch, opts);
    if (res) {
      const { backup } = persist(deck);
      saveProgress(progress);
      console.log(c.dim(`  saved  ${MASTER_FILE}${backup ? `  (backup ${backup})` : ''}\n`));
    }
  });

program.command('recall')
  .description('RECALL DRILL - Arabic shown, you write the English. Known entries only.')
  .option('-n, --limit <n>', 'how many to drill', (v) => parseInt(v, 10))
  .option('--only <sheet>', 'words | phrases', onlyOpt)
  .option('--no-links', 'plain URLs instead of clickable links')
  .action(async (opts) => {
    const { deck, progress } = open();
    const res = await recall(deck, progress, opts);
    if (res) {
      const { backup } = persist(deck);
      saveProgress(progress);
      console.log(c.dim(`  saved  ${MASTER_FILE}${backup ? `  (backup ${backup})` : ''}\n`));
    }
  });

program.command('triage')
  .description('TRIAGE - sweep the unknown list and pull out what you already know')
  .option('-n, --limit <n>', 'how many to sort in this pass', (v) => parseInt(v, 10))
  .option('-a, --all', 'sweep every entry, not just the unknown ones')
  .option('--only <sheet>', 'words | phrases', onlyOpt)
  .option('--no-links', 'plain URLs instead of clickable links')
  .action(async (opts) => {
    const { deck, progress } = open();
    const res = await triage(deck, progress, opts);
    if (res) {
      const { backup } = persist(deck);
      saveProgress(progress);
      console.log(c.dim(`  saved  ${MASTER_FILE}${backup ? `  (backup ${backup})` : ''}\n`));
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(c.red(`\n  ${err.message}\n`));
  process.exit(1);
});
