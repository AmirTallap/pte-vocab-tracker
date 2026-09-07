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

// SHEETS, EXAM_DATE, HEADERS, LISTEN_LABEL and the date helpers moved to
// shared.js so the browser can load them - see the note at the top of that
// file. They are re-exported here so every existing importer of config.js is
// unaffected; there is still one definition of each.
export {
  SHEETS, EXAM_DATE, HEADERS, LISTEN_LABEL, EMPTY_PROGRESS, today, daysBetween,
} from './shared.js';
