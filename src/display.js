import chalk from 'chalk';
import { SHEETS } from './config.js';
import { translateUrl, osc8 } from './links.js';

export const c = chalk;

const pad = (s, n) => String(s) + ' '.repeat(Math.max(n - String(s).length, 0));
const padStart = (s, n) => ' '.repeat(Math.max(n - String(s).length, 0)) + String(s);

export function rule(width = 72) {
  return c.dim('─'.repeat(width));
}

export function banner(title, subtitle = '') {
  const line = [];
  line.push('');
  line.push(c.bold.cyan(`  ${title}`));
  if (subtitle) line.push(c.dim(`  ${subtitle}`));
  line.push('  ' + rule(70));
  return line.join('\n');
}

export function bar(pct, width = 28, tone = 'green') {
  const filled = Math.round((Math.min(Math.max(pct, 0), 100) / 100) * width);
  return c[tone]('█'.repeat(filled)) + c.dim('░'.repeat(width - filled));
}

/**
 * One study line. The English term carries the Google Translate link so it can
 * be clicked and played back; Arabic goes last on the line, because a
 * right-to-left run in the middle of a left-to-right line reorders everything
 * after it in most terminals.
 */
export function entryLine(i, entry, { links = true, width = 26 } = {}) {
  const n = c.dim(padStart(i, 3) + '.');
  const label = links ? osc8(translateUrl(entry.word), c.bold(entry.word)) : c.bold(entry.word);
  const gap = ' '.repeat(Math.max(width - entry.word.length, 1));
  const head = `${n} ${label}${gap}${c.yellow(entry.arabic)}`;
  const meaning = entry.meaning ? `\n     ${c.dim(entry.meaning)}` : '';
  return head + meaning;
}

export function section(title, entries, opts = {}) {
  const out = [`\n  ${c.bold.white(title)}  ${c.dim(`(${entries.length})`)}`, ''];
  entries.forEach((e, i) => out.push('  ' + entryLine(i + 1, e, opts).replace(/\n/g, '\n  ')));
  return out.join('\n');
}

/* ---- stats -------------------------------------------------------------- */

function toneFor(pct) {
  if (pct >= 90) return 'green';
  if (pct >= 50) return 'yellow';
  return 'red';
}

export function statsBlock(s) {
  const out = [];
  out.push(banner('PTE VOCABULARY — PROGRESS', `${s.date}  ·  exam ${s.examDate}`));

  for (const id of Object.keys(SHEETS)) {
    const p = s.per[id];
    const tone = toneFor(p.pct);
    out.push('');
    out.push(`  ${c.bold(pad(p.label.toUpperCase(), 9))} ${bar(p.pct, 28, tone)} ` +
             `${c.bold(padStart(p.known, 4))}${c.dim('/' + p.total)} mastered  ` +
             `${c[tone](p.pct.toFixed(1) + '%')}`);
    out.push(`  ${' '.repeat(9)} ${c.dim('seen at least once')} ` +
             `${padStart(p.seenOnce, 4)}${c.dim('/' + p.total)} ` +
             `${c.dim(`(${p.seenPct.toFixed(0)}%, ${p.neverSeen} never seen)`)}`);
  }

  out.push('');
  out.push('  ' + rule(70));
  out.push('');

  const cycle = s.cycleDay ? `day ${s.cycleDay} · week ${s.week}`
    : s.startsIn ? c.dim(`starts in ${s.startsIn} day${s.startsIn === 1 ? '' : 's'} (${s.cycleStart})`)
    : c.dim('not started');
  out.push(`  ${c.dim('Cycle')}        ${cycle}   ${c.dim(`(${s.batchesRun} batches drawn)`)}`);

  const dte = s.daysToExam;
  const dteTone = dte < 0 ? 'red' : dte < 21 ? 'yellow' : 'green';
  out.push(`  ${c.dim('Exam')}         ${c[dteTone](dte >= 0 ? `${dte} days away` : `${-dte} days ago`)}` +
           `   ${c.dim(`(${(dte / 7).toFixed(1)} weeks)`)}`);

  out.push('');
  for (const id of Object.keys(SHEETS)) {
    const p = s.per[id];
    if (p.requiredPerDay == null) continue;
    const need = p.requiredPerDay;
    const tone = p.onTrack ? 'green' : 'red';
    const verdict = p.onTrack
      ? c.green(`${p.perDay}/day clears it in ${p.daysAtCurrentPace} days`)
      : c.red(`BEHIND — ${p.perDay}/day is not enough`);
    out.push(`  ${c.dim('Pace')}  ${pad(p.label, 8)} need ${c[tone](need.toFixed(1))}${c.dim('/day')}` +
             ` to clear ${p.unknown} unknown   ${verdict}`);
  }
  return out.join('\n');
}

/**
 * The plan's own success criteria, checked against reality rather than assumed.
 * Milestones are expressed in cycle weeks, which is why they read "pending"
 * until a cycle has actually started.
 */
export function milestoneBlock(s) {
  const M = [
    { week: 4,  label: 'every entry seen at least once', metric: (p) => p.seenPct, target: 100 },
    { week: 8,  label: '50% mastered',                   metric: (p) => p.pct,     target: 50 },
    { week: 12, label: '90% locked in',                  metric: (p) => p.pct,     target: 90 },
    { week: 16, label: 'exam ready',                     metric: (p) => p.pct,     target: 100 },
  ];
  const out = ['', `  ${c.bold.white('MILESTONES')}`, ''];
  for (const m of M) {
    const vals = Object.keys(SHEETS).map((id) => m.metric(s.per[id]));
    const worst = Math.min(...vals);
    const due = s.week == null ? null : s.week >= m.week;
    const hit = worst >= m.target;
    const mark = hit ? c.green('✔') : due ? c.red('✘') : c.dim('·');
    const state = hit ? c.green('met') : due ? c.red('MISSED') : c.dim('pending');
    out.push(`  ${mark} ${c.dim(pad(`week ${m.week}`, 9))} ${pad(m.label, 34)} ` +
             `${padStart(worst.toFixed(0) + '%', 5)} / ${m.target}%  ${state}`);
  }
  return out.join('\n');
}
