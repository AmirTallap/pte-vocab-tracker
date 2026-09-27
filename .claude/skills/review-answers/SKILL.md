---
name: review-answers
description: Review amir's saved PTE answers (essays, Summarize Written/Spoken Text, Re-tell Lecture, Group Discussion, Describe Image, Respond to a Situation, Free talk) from data/attempts.db - an estimated score per PTE trait, sentence-by-sentence corrections that keep his ideas, a model answer, where deck words and phrases fit, grammar faults pinned to the grammar map, task checks, and an assessment of the ideas. Use when amir asks to review his answers/attempts/essays, or types /review-answers.
---

# Reviewing amir's answers

amir is an Arabic speaker at about B2, sitting PTE Academic on 19 Dec 2026 and aiming
higher. His answers are saved as TEXT in `data/attempts.db` (never audio). This skill reads
them, writes one review per attempt, and files every grammar fault onto the grammar map,
which is what colours the map on the Grammar tab and builds his failure log.

Arguments: an attempt id (`/review-answers 12`), several ids, or nothing / `all` = every
pending attempt, oldest first.

## Steps

1. `node tools/review.js pending` - what is waiting. (`list` shows everything.)
2. Once per session: `node tools/review.js stations` (the ONLY valid fault ids) and
   `node tools/review.js deck` (the 490-odd words and phrases, `[kind] headword :: meaning`).
3. For each attempt: `node tools/review.js show <id>`. Read the prompt, the answer, the
   marked transcript and metrics, and the list of deck entries that seem to be used.
4. Write the review JSON (schema below) to the session scratchpad, then
   `node tools/review.js save <id> <file>`. It refuses unknown stations and headwords not on
   the sheet - fix and re-save; never drop a fault to get past it.
5. **Essays only:** if the prompt has no model answers yet (`ls data/models/<prompt-id>.json`
   fails), write them - see "Model answers on demand".
6. Tell amir, in a few lines per attempt: the estimated score, the headline, his most
   repeated fault, and the best deck phrase he missed. The full review is on the page (Writing/Speaking report
   → "Your saved answers"), so do not paste it all into chat.

## The rules of the review

**1. Sentence by sentence, and his ideas are never changed.** Split the answer into its
sentences (for speech, the transcript's sentences). For EVERY sentence give:
- `original` - exactly as he wrote or said it;
- `fixed` - the minimal correction: only what is wrong is changed, his words and his
  structure kept wherever they are right. If nothing is wrong, `fixed` equals `original`.
  This is the HerrWert style his mentor uses, and it is the most important field.
- `better` - how a strong C1 writer/speaker would put **the same idea**: same claim, same
  example, same stance, same degree of certainty. Better words, better structure, a deck
  phrase where it fits naturally. Never add an argument he did not make, never remove one,
  never soften or harden his position. If he was vague, stay vague, just well-expressed.
- `notes` - one or two short lines on WHY (the rule, not a lecture). Optional when
  `fixed === original` and `better` is only stylistic.
A run-on is one sentence in `original` whose `fixed` is two or three sentences - that is
fine and expected.

**2. Faults are pinned to the map.** Every grammar or mechanics error becomes a
`faults[]` entry: `station` (from `tools/review.js stations`), `excerpt` (his words, short),
`fix` (the corrected words), `why` (one sentence). One entry per occurrence - if the same
agreement slip happens three times, file three: frequency is the whole point of the log.
Precision over recall: only file what is genuinely wrong in any register. Known weak spots
to look for hard: run-ons/comma splices (`clause.boundaries`), number agreement
(`agree.*`, "this crazy urges that needs"), tense drift (`tense.consistency`), person
switching (`agree.person`), articles (`det.*`), a dropped `be` (`vpat.be`).

**Spoken tasks:** the text is a Whisper transcript. Its punctuation, capitals and spelling
are Whisper's, not his - NEVER file `punct.*` faults or spelling on a spoken attempt, and
treat a sentence boundary Whisper invented with suspicion. Whisper also tidies grammar a
little, so what survives is real. Fillers and pauses are in `marked`; comment on fluency
in `task`, not as grammar faults.

**3. The deck, especially the phrases.** `used[]` lists deck entries he actually used,
correctly (confirm the hints from `show`; drop false matches; a misused one goes in
`deck[]` with a note instead). `deck[]` is 3-8 suggestions, mostly `phrases`: `entry` (the
headword exactly as on the sheet), `kind`, `where` (the sentence of his it belongs in),
`rewrite` (that sentence rewritten with it, idea unchanged), `note` (optional). Only
suggest where it genuinely fits - a forced phrase teaches the wrong lesson.

**4. Task checks** - `task[]`, each `{label, verdict: "good"|"fix"|"note", note}`:
- essay: answered the actual question and type? clear position? structure (intro, 2 body,
  conclusion)? word count inside 200-300? time used (metrics)?
- swt: exactly ONE sentence? 5-75 words? main idea + key supporting points (the stored
  prompt includes them)? no copying long stretches verbatim?
- sst: 50-70 words? the lecture's main point and key details (compare to the lecture text
  and points in the prompt)?
- retell / discussion: coverage of the points; for discussion, positions attributed to the
  right speakers and the disagreement conveyed; fluency from `marked` (long pauses,
  fillers, restarts).
- image: every figure he stated checked against the chart data in the prompt - a wrong
  number is a `fix`; did he give the headline trend, extremes, a comparison, a conclusion?
- situation: right register (formal/informal as the prompt says), did the job (apologise,
  persuade ...), the points in the prompt.
- free: fluency and range only.

**5. The ideas assessment - last, and separate from PTE.** `ideas` =
`{verdict: "accurate"|"mostly accurate"|"mixed"|"inaccurate"|"n/a", body, claims[]}`.
Judge how accurate and well-informed what he SAID about the subject is, as a
knowledgeable friend would: are the facts right, are the causal claims sound, what does
current evidence say, what did he miss or overstate? `claims[]` =
`{claim, verdict: "right"|"partly"|"wrong"|"unclear", note}` for the specific factual
claims worth checking. Be honest and specific; say when something is contested rather
than settled. Do not mark him down for a position you disagree with - only for claims that
are factually wrong. For Describe Image this is about his reading of the chart; for a
situation it is whether his proposed solution is sensible.

**6. `summary`** - 2-4 sentences: the overall picture and the ONE thing to work on next.

**7. `model` - a model answer, for EVERY attempt, whatever the task.** `{text, note}`.
The answer he should have given to THIS item, at the length the exam rewards, and
sayable in the time for a spoken task. Bold (`**...**`) the deck words and phrases it
uses, and use several - it is how he sees them working. Paragraphs are separated by a
blank line.
- essay: 230-280 words, intro, two body paragraphs, conclusion, **taking his stance** so
  he can compare like with like (say so in `note` if he took none). Also write the
  prompt's `data/models/<id>.json` if it has none - see below.
- swt: ONE sentence, 30-55 words, main idea plus the key supporting points.
- sst: 55-65 words.
- retell: about 90-110 words for 40 seconds, opening "The lecture/speaker ...", the
  main points in order, a closing sentence.
- discussion: about 120-140 words for 60 seconds, naming who said what.
- image: 90-110 words: what it shows, the key features with their figures, an overall
  conclusion.
- situation: about 80-100 words, spoken TO the person, in the register asked for.
- free: his own content said fluently, about the length he spoke.
`note` is one line on what the model does that his answer did not.

**8. `score` - an ESTIMATED score for EVERY attempt**, trait by trait, on PTE's published
traits. `{traits: [{trait, got, max, note}], unscored: [...], note}`. Every `note` says
why that number, quoting his answer. It is an estimate, and the page says so: PTE's
real marker is a machine model whose workings are not public. **Never guess
pronunciation** from a transcript: list it in `unscored`, and mention in `score.note`
any content words the transcriber misheard, as the only signal there is.

The traits and maximums, from Pearson's PTE Academic score guide (verify against the
current official guide if in doubt; this table is the one place to change them):

| task | traits (max) |
|---|---|
| essay | Content 6, Development, structure and coherence 6, Form 2, Grammar 2, General linguistic range 6, Vocabulary range 2, Spelling 2 |
| swt | Content 4, Form 1, Grammar 2, Vocabulary 2 |
| sst | Content 4, Form 2, Grammar 2, Vocabulary 2, Spelling 2 |
| retell, discussion, image | Content 6, Oral fluency 5 (Pronunciation 5: unscored) |
| situation | Appropriacy 6, Oral fluency 5 (Pronunciation 5: unscored) |
| free | not a PTE task: Oral fluency 5, Language range 5 |

How to judge:
- **Form** is mechanical. Essay: 2 for 200-300 words, 1 for 120-199 or 301-380, 0
  otherwise. SWT: 1 for one sentence of 5-75 words, else 0. SST: 2 for 50-70 words, 1 for
  40-49 or 71-100, else 0. PTE scores Form 0 (and then the whole item 0) for an answer
  that is off-topic or in capitals; say so if it applies.
- **Content** (spoken, 0-6): 6 all key points plus the conclusion or implication, 5 most
  points and the main idea clearly, 4 the main idea and several points, 3 the main idea
  and a few points, 2 some relevant elements but the main idea weak or missing, 1 barely
  relevant, 0 nothing relevant. Wrong figures in Describe Image pull it down hard.
- **Oral fluency** (0-5), from `marked` and the metrics: 5 smooth, natural pace, no
  hesitations; 4 an occasional pause or filler that does not break the flow; 3 some
  uneven stretches or hesitations; 2 frequent pauses or fillers, choppy; 1 very hesitant,
  long pauses; 0 disfluent. As a rough guide, count fillers plus silences over 0.7s per
  10 seconds spoken: under 0.5 is 4-5, about 1 is 3, about 2 or more is 2 or lower.
  Restarts and repetitions count against it too.
- **Written grammar / vocabulary (0-2)**: 2 few or no errors and a good range, 1 errors
  that do not block meaning, 0 errors that do. General linguistic range and Development
  (0-6) use the same logic stretched over six steps.
- **Appropriacy** (situation, 0-6): did he do the job asked, in the right register, with
  a reason or alternative and a polite close.

## Schema

```json
{
  "summary": "string",
  "sentences": [{ "original": "", "fixed": "", "better": "", "notes": "" }],
  "faults": [{ "station": "agree.number-noun", "excerpt": "", "fix": "", "why": "" }],
  "used": [{ "entry": "In the long run", "kind": "phrases" }],
  "deck": [{ "entry": "", "kind": "phrases", "where": "", "rewrite": "", "note": "" }],
  "task": [{ "label": "", "verdict": "good", "note": "" }],
  "ideas": { "verdict": "mostly accurate", "body": "", "claims": [{ "claim": "", "verdict": "right", "note": "" }] },
  "model": { "text": "", "note": "" },
  "score": { "traits": [{ "trait": "Content", "got": 3, "max": 6, "note": "" }], "unscored": ["Pronunciation"], "note": "" }
}
```

Style for everything he reads: British spelling, plain words, short sentences. NO em or en
dashes (he has asked for none) - use commas, colons or full stops.

## Model answers on demand (essays)

The 60 original prompts have three model answers each; the 440 added on 26 Sep 2026 do
not, by design. When you review an essay whose prompt has none, write
`data/models/<prompt-id>.json` in exactly the shape of `data/models/e01.json` (three
models with different stances/approaches, `plan`, `paras` with `role` and `text`), 200-300
words each, deck words marked `[[form|Headword]]` (the pipe ONLY for inflections), no
dashes. Then `node tools/check-models.js <prompt-id>` must pass. The server reads models
at startup, so tell amir to restart `npm run web` to see them.

## Do not

- Do not store or ask for audio. Do not edit `answer`, `prompt` or `marked` - they are his.
- Never present the score as PTE's. It is an estimate against the published traits,
  and a trait that cannot be judged from text is listed as unscored, not guessed.
- Do not use Claude in Chrome to look at the page (CLAUDE.md Rule 1).
