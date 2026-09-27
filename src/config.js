import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');

export const MASTER_FILE = path.join(DATA_DIR, 'PTE_Vocabulary_Master.xlsx');
export const BACKUP_FILE = path.join(DATA_DIR, 'backup_words.json');
export const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
// The grammar map: one JSON file per line of the map, each station an article.
// Static content, read at startup - see grammarmap.js.
export const GRAMMARMAP_DIR = path.join(DATA_DIR, 'grammarmap');
// Your answers and the reviews of them - see attempts.js. Text only, never audio.
// PTE_ATTEMPTS_DB points it elsewhere, for testing without touching the real one.
export const ATTEMPTS_FILE = process.env.PTE_ATTEMPTS_DB || path.join(DATA_DIR, 'attempts.db');
// Respond to a Situation and Summarize Written Text, one JSON file per set of ten.
export const SITUATIONS_DIR = path.join(DATA_DIR, 'situations');
export const SWT_DIR = path.join(DATA_DIR, 'swt');
export const LISTENING_DIR = path.join(DATA_DIR, 'listening');
export const SENTENCES_DIR = path.join(DATA_DIR, 'sentences');
export const IMAGES_DIR = path.join(DATA_DIR, 'images');
// The Reading tab's passages, one JSON file per set of ten - see reading.js.
export const READING_DIR = path.join(DATA_DIR, 'reading');
// Highlight Incorrect Words, one JSON file per set of ten - see hiw.js.
export const HIW_DIR = path.join(DATA_DIR, 'hiw');
// Example sentences, one JSON file per sheet. Static too, and read at startup.
export const USAGE_DIR = path.join(DATA_DIR, 'usage');
// The Write Essay prompts. Static as well, and one file - see essays.js.
export const ESSAYS_FILE = path.join(DATA_DIR, 'essays.json');
// How to write the thing: the general method and one recipe per question type.
export const ESSAY_GUIDE_FILE = path.join(DATA_DIR, 'essay_guides.json');
// Three worked model answers per prompt, one file per prompt - see models.js.
export const MODELS_DIR = path.join(DATA_DIR, 'models');
export const LECTURES_DIR = path.join(DATA_DIR, 'lectures');
export const DISCUSSIONS_DIR = path.join(DATA_DIR, 'discussions');
export const EXPORT_DIR = path.join(ROOT, 'exports');

// SHEETS, EXAM_DATE, HEADERS, LISTEN_LABEL and the date helpers moved to
// shared.js so the browser can load them - see the note at the top of that
// file. They are re-exported here so every existing importer of config.js is
// unaffected; there is still one definition of each.
export {
  SHEETS, EXAM_DATE, HEADERS, LISTEN_LABEL, EMPTY_PROGRESS, today, daysBetween,
} from './shared.js';
