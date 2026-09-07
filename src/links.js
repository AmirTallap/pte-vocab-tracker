/**
 * Google Translate links, so an unknown word can be played back for pronunciation.
 * Requested by the user: EN -> AR, translate view.
 */
export const TRANSLATE_BASE = 'https://translate.google.com/';

export function translateUrl(text, { from = 'en', to = 'ar' } = {}) {
  const q = encodeURIComponent(String(text ?? '').trim());
  return `${TRANSLATE_BASE}?sl=${from}&tl=${to}&text=${q}&op=translate`;
}

const ESC = String.fromCharCode(27);
const ST = ESC + String.fromCharCode(92);

/**
 * OSC 8 terminal hyperlink. Supported by iTerm2, GNOME Terminal, Windows
 * Terminal, VS Code, Kitty, WezTerm. Terminals that do not understand it strip
 * the sequence and still show the label, so the word is never lost. Emitted
 * only to a TTY — a redirected stream should stay plain text.
 */
export function osc8(url, label, enabled = process.stdout.isTTY) {
  if (!enabled) return label;
  return ESC + ']8;;' + url + ST + label + ESC + ']8;;' + ST;
}

/** A word rendered as a clickable pronunciation link where the terminal allows it. */
export function linkedWord(word, enabled) {
  return osc8(translateUrl(word), word, enabled);
}
