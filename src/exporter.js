import fs from 'node:fs';
import path from 'node:path';
import { EXPORT_DIR, SHEETS } from './config.js';
import { translateUrl } from './links.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Every export carries the Google Translate URL for the entry, because the
 * point of exporting is to study away from this terminal - on a phone, or
 * printed - and a link you cannot click is the one thing the file must not
 * become. txt spells the URL out, md and html make it clickable.
 */
function asText(batch) {
  const out = [`PTE VOCABULARY - DAILY BATCH  ${batch.date}`, '='.repeat(64), ''];
  for (const [id, cfg] of Object.entries(SHEETS)) {
    const entries = batch[id] || [];
    out.push(`${cfg.sheet.toUpperCase()}  (${entries.length})`, '-'.repeat(64), '');
    entries.forEach((e, i) => {
      out.push(`${String(i + 1).padStart(3)}. ${e.word}`);
      out.push(`     ${e.arabic}`);
      if (e.meaning) out.push(`     ${e.meaning}`);
      out.push(`     listen: ${translateUrl(e.word)}`);
      out.push('');
    });
  }
  return out.join('\n');
}

function asMarkdown(batch) {
  const out = [`# PTE Vocabulary - Daily Batch (${batch.date})`, ''];
  for (const [id, cfg] of Object.entries(SHEETS)) {
    const entries = batch[id] || [];
    out.push(`## ${cfg.sheet} (${entries.length})`, '');
    out.push('| # | Word | Arabic | Meaning | Listen |');
    out.push('|---|------|--------|---------|--------|');
    entries.forEach((e, i) => {
      const cell = (s) => String(s ?? '').replace(/\|/g, '\\|');
      out.push(`| ${i + 1} | **${cell(e.word)}** | ${cell(e.arabic)} | ${cell(e.meaning)} |` +
               ` [play](${translateUrl(e.word)}) |`);
    });
    out.push('');
  }
  return out.join('\n');
}

function asHtml(batch) {
  const rows = (entries) => entries.map((e, i) => `
      <tr>
        <td class="n">${i + 1}</td>
        <td class="w"><a href="${esc(translateUrl(e.word))}" target="_blank" rel="noopener">${esc(e.word)}</a></td>
        <td class="ar" dir="rtl" lang="ar">${esc(e.arabic)}</td>
        <td class="m">${esc(e.meaning)}</td>
      </tr>`).join('');

  const sections = Object.entries(SHEETS).map(([id, cfg]) => `
    <h2>${esc(cfg.sheet)} <span class="count">${(batch[id] || []).length}</span></h2>
    <table>
      <thead><tr><th>#</th><th>Word</th><th>Arabic</th><th>Meaning</th></tr></thead>
      <tbody>${rows(batch[id] || [])}</tbody>
    </table>`).join('');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PTE Batch ${esc(batch.date)}</title>
<style>
  :root { color-scheme: light dark; --fg:#111; --dim:#666; --line:#e3e3e3; --bg:#fff; --accent:#0b5fff; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#e8e8e8; --dim:#9a9a9a; --line:#2c2c2c; --bg:#151515; --accent:#7aa7ff; }
  }
  body { margin:0; padding:24px; background:var(--bg); color:var(--fg);
         font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:var(--dim); margin-bottom:24px; font-size:13px; }
  h2 { font-size:15px; margin:28px 0 8px; text-transform:uppercase; letter-spacing:.06em; }
  .count { color:var(--dim); font-weight:400; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.06em;
       color:var(--dim); border-bottom:1px solid var(--line); padding:6px 8px; font-weight:600; }
  td { padding:8px; border-bottom:1px solid var(--line); vertical-align:top; }
  td.n { color:var(--dim); width:34px; font-variant-numeric:tabular-nums; }
  td.w a { color:var(--accent); font-weight:600; text-decoration:none; }
  td.w a:hover { text-decoration:underline; }
  td.ar { font-size:17px; white-space:nowrap; }
  td.m { color:var(--dim); }
</style></head><body>
<h1>PTE Vocabulary &mdash; daily batch</h1>
<div class="sub">${esc(batch.date)} &middot; tap any word to hear it on Google Translate</div>
${sections}
</body></html>`;
}

const RENDERERS = { txt: asText, md: asMarkdown, html: asHtml };

export function exportBatch(batch, { format = 'txt', out } = {}) {
  const render = RENDERERS[format];
  if (!render) throw new Error(`Unknown format "${format}". Use: ${Object.keys(RENDERERS).join(', ')}`);

  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const file = out || path.join(EXPORT_DIR, `batch-${batch.date}.${format}`);
  fs.writeFileSync(file, render(batch));
  return file;
}

export const FORMATS = Object.keys(RENDERERS);
