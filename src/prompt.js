import readline from 'node:readline';
import { stdin, stdout } from 'node:process';

/**
 * A prompt that buffers input lines instead of dropping them.
 *
 * `readline/promises`.question() only captures a line while a question is
 * actually pending: anything typed (or piped) in between is emitted and
 * discarded. Worse, when stdin closes mid-session the pending promise never
 * settles, the loop's `finally` never runs, and the process exits 0 with the
 * study session unsaved - a silent loss reported as success.
 *
 * So lines are queued as they arrive and handed out on demand, and EOF (Ctrl-D,
 * or the end of piped input) resolves as 'q', which every mode treats as
 * "stop and save".
 */
export function createPrompt() {
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
  const queue = [];
  const waiting = [];
  let closed = false;

  rl.on('line', (line) => {
    if (waiting.length) waiting.shift()(line);
    else queue.push(line);
  });

  rl.on('close', () => {
    closed = true;
    while (waiting.length) waiting.shift()('q');
  });

  return {
    ask(question) {
      stdout.write(question);
      if (queue.length) return Promise.resolve(queue.shift());
      if (closed) return Promise.resolve('q');
      return new Promise((resolve) => waiting.push(resolve));
    },
    close: () => rl.close(),
    rl,
  };
}

/** Normalise a typed answer for comparison: case, punctuation and spacing. */
export function normaliseAnswer(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein distance, used only to tell a typo from a wrong answer. */
export function distance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Grade a typed answer: 'blank' | 'exact' | 'close' | 'wrong'.
 * 'close' exists so a one-character slip is not scored the same as not knowing
 * the word - but it is reported as close, never quietly counted as correct.
 */
export function grade(typed, expected) {
  const t = normaliseAnswer(typed);
  const e = normaliseAnswer(expected);
  if (!t) return 'blank';
  if (t === e) return 'exact';
  const tolerance = e.length <= 4 ? 1 : e.length <= 8 ? 2 : 3;
  return distance(t, e) <= tolerance ? 'close' : 'wrong';
}
