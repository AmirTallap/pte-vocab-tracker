import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');

export const MASTER_FILE = path.join(DATA_DIR, 'PTE_Vocabulary_Master.xlsx');
export const BACKUP_FILE = path.join(DATA_DIR, 'backup_words.json');
export const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
// One JSON file per grammar module. Static content, read at startup.
export const GRAMMAR_DIR = path.join(DATA_DIR, 'grammar');
// Example sentences, one JSON file per sheet. Static too, and read at startup.
export const USAGE_DIR = path.join(DATA_DIR, 'usage');
// The Write Essay prompts. Static as well, and one file - see essays.js.
export const ESSAYS_FILE = path.join(DATA_DIR, 'essays.json');
// How to write the thing: the general method and one recipe per question type.
export const ESSAY_GUIDE_FILE = path.join(DATA_DIR, 'essay_guides.json');
// Three worked model answers per prompt, one file per prompt - see models.js.
export const MODELS_DIR = path.join(DATA_DIR, 'models');
export const EXPORT_DIR = path.join(ROOT, 'exports');

// The two sheets, and how many of each go into a daily batch.
export const SHEETS = {
  words:   { sheet: 'Academic Words',  label: 'words',   perDay: 50 },
  phrases: { sheet: 'Complex Phrases', label: 'phrases', perDay: 20 },
};

export const EXAM_DATE = '2026-12-19';

// Canonical headers written back to Excel. Input headers are matched loosely
// (see loader.js) so a file re-saved by Excel still loads.
export const HEADERS = {
  word:    'Word',
  arabic:  'Arabic Translation',
  meaning: 'English Meaning',
  known:   'Known (T/F)',
  listen:  'Listen (EN>AR)',
};

// Cell text for the pronunciation hyperlink column written into the workbook.
export const LISTEN_LABEL = 'play';
