/**
 * Real lecture excerpts for the Re-tell Lecture task.
 *
 * Open Yale Courses, which is the right source for three reasons and not just
 * the convenient one:
 *
 *   1. It is REAL academic English - a lecturer in a hall, with the hesitations,
 *      the asides and the room acoustics that a synthesised voice does not have.
 *      That gap is the whole reason this file exists: PTE plays recordings of
 *      people, and practising against clean TTS under-prepares the ear.
 *   2. CC BY-NC-SA 3.0, which permits excerpting with attribution. MIT
 *      OpenCourseWare was asked for first and would have been equally welcome,
 *      but its media is served through a video platform with no direct download
 *      and its old API is gone; ripping that is a terms-of-service problem and
 *      the recordings are not ours to redistribute. Yale serves plain MP3s.
 *   3. Every lecture carries an official transcript with CHAPTER TIMESTAMPS.
 *      That is what makes this cheap and correct at the same time - see below.
 *
 * The transcript is the important part. An earlier sketch ran the excerpt
 * through the local Whisper to get its text, which cost about forty-five
 * seconds per lecture and, worse, hallucinated: on the first real try it looped
 * "a sixth is going to end up with A minus" some thirty times and reported 392
 * words per minute. Yale's own transcript is authoritative and free, so the
 * audio is cut AT a chapter boundary and the text is taken from the same
 * chapter. Nothing is transcribed and nothing can drift.
 *
 * The chapter titles also solve the other problem that first try exposed: the
 * opening minutes of a lecture are housekeeping. "Chapter 3. (Administrative
 * Issues)" is exactly what it says, and a summary of the midterm date teaches
 * nothing. SKIP below is the list of chapter kinds that are not content.
 *
 * WHAT IS WRITTEN WHERE, and it matters:
 *   data/lectures/Y##.json   the recipe and the text - committed
 *   data/lectures/audio/     the audio itself - GITIGNORED
 * The excerpts are someone else's recording under a share-alike licence. They
 * stay on this machine, which costs nothing because the Speaking tab is
 * local-only anyway, and the JSON records the source, the offset and the
 * licence so any of it can be fetched again from scratch.
 *
 *   node tools/fetch-yale-lectures.js [how-many] [--start N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { LECTURES_DIR } from '../src/config.js';

const AUDIO_DIR = path.join(LECTURES_DIR, 'audio');
const BASE = 'https://oyc.yale.edu';

/* Roughly what a re-tell needs: PTE plays 60-90 seconds. */
const CLIP_SECONDS = 85;

/* Chapters that are not the lecture. Matched case-insensitively against the
 * chapter title; a summary of the grading scheme is not a summary of anything. */
const SKIP = /administrat|housekeep|logistic|syllabus|requirement|assignment|textbook|grading|enrol|evaluation|course mechanic|recap|summary|q\s*&\s*a|question|conclusion|introduction to the course|welcome/i;

/* Content lives past the opening, and the last chapter is usually a wrap-up. */
const EARLIEST = 180;

const CREDIT = 'Open Yale Courses, Yale University';
const LICENCE = 'https://creativecommons.org/licenses/by-nc-sa/3.0/';

/* One field per department, so a lecture carries the same kind of label the
 * written ones do rather than a course code. */
const FIELDS = {
  astronomy: 'Astronomy and space',
  'ecology-and-evolutionary-biology': 'Life sciences',
  'molecular-cellular-and-developmental-biology': 'Life sciences',
  'biomedical-engineering': 'Technology and computing',
  physics: 'Physics and chemistry',
  'geology-and-geophysics': 'Earth and environment',
  'environmental-studies': 'Earth and environment',
  economics: 'Economics and business',
  psychology: 'Psychology and neuroscience',
  'introduction-psychology': 'Psychology and neuroscience',
  sociology: 'Society and anthropology',
  'african-american-studies': 'Society and anthropology',
  'american-studies': 'Society and anthropology',
  'political-science': 'Society and anthropology',
  history: 'History and archaeology',
  classics: 'History and archaeology',
  'history-of-art': 'Arts, language and education',
  english: 'Arts, language and education',
  'italian-language-and-literature': 'Arts, language and education',
  'spanish-and-portuguese': 'Arts, language and education',
  philosophy: 'Philosophy and ideas',
  death: 'Philosophy and ideas',
  'religious-studies': 'Philosophy and ideas',
};

const get = (url) => fetch(url, { headers: { 'user-agent': 'pte-vocab-tracker/1.0 (personal study tool)' } })
  .then((r) => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text(); });

/* Tags out, entities in, whitespace collapsed. The transcript is prose in
 * paragraphs and nothing here needs its markup. */
function plain(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&amp;/g, '&')
    .replace(/&mdash;|&ndash;/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

const secs = (h, m, s) => Number(h) * 3600 + Number(m) * 60 + Number(s);

/** The chapters, their titles and where each one starts. */
function chapters(text) {
  const out = [];
  const re = /Chapter\s+(\d+)\.\s*([^[]{2,120}?)\s*\[(\d\d):(\d\d):(\d\d)\]/g;
  let m;
  while ((m = re.exec(text))) {
    out.push({ n: Number(m[1]), title: m[2].trim().replace(/^\(|\)$/g, ''),
               at: secs(m[3], m[4], m[5]), index: m.index });
  }
  return out;
}

/* Things a lecture says when it is not lecturing. A slice full of these is
 * about the course, not about the subject, and summarising it teaches nothing. */
const ADMIN = /\b(final|midterm|syllabus|problem set|problem solving|homework|grade|grading|office hours|exam|due date|extra credit|discussion section|this class|this course|requirement|teaching fellow|lecture notes)\b/gi;

/* Speaker tags in the transcript: "Professor Charles Bailyn:" and "Student:". */
const SPEAKER = /(?:^|\s)(Professor|Student|Instructor)\b[^:]{0,40}:\s*/g;

/**
 * A usable slice of one chapter, and the moment the audio has to start.
 *
 * The chapter's own opening is NOT automatically the content. Yale's chapter
 * marks land where the topic changes, but a lecturer frequently spends the
 * first minute of a new chapter finishing the questions from the last one - the
 * first attempt at this produced a chapter titled "Planetary Orbits" whose text
 * was the professor answering whether someone could sit an early final.
 *
 * So leading dialogue is skipped, and - this is the part that matters - the
 * audio offset moves with it. The chapter's own words-per-second, measured from
 * its length and its word count, converts the words skipped into the seconds to
 * skip, so what is heard stays exactly what is written down.
 */
function chapterSlice(text, chs, i) {
  const c = chs[i];
  const next = chs[i + 1];
  const raw = plain(text.slice(c.index, next ? next.index : c.index + 14000))
    .replace(/^Chapter\s+\d+\.[^\]]*\]\s*/, '')
    .replace(/\[\d\d:\d\d:\d\d\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const span = next ? Math.max(30, next.at - c.at) : 600;
  const all = raw.split(/\s+/).filter(Boolean);
  if (all.length < 60) return null;
  const wps = all.length / span;

  // Where the last speaker change in the opening third is: everything up to it
  // is the tail of someone else's question.
  let skip = 0;
  SPEAKER.lastIndex = 0;
  let m;
  while ((m = SPEAKER.exec(raw))) {
    const at = raw.slice(0, m.index + m[0].length).split(/\s+/).filter(Boolean).length;
    if (at > all.length / 3) break;
    skip = at;
  }

  // The cap has to clear a fast lecturer. At 240 it was binding on a 220-wpm
  // economist and the stored text stopped about twenty-five seconds before the
  // audio did - the student would have heard content that the transcript, and
  // so the feedback prompt, knew nothing about.
  // Never cut past the end of the chapter. The transcript only covers this
  // chapter, so audio running into the next one would be content the student
  // hears and the feedback prompt has never seen.
  const at = Math.round(c.at + skip / wps);
  const left = next ? next.at - at : CLIP_SECONDS;
  const seconds = Math.min(CLIP_SECONDS, Math.max(0, left));
  if (seconds < 45) return null;

  const budget = Math.max(110, Math.min(340, Math.round(wps * seconds)));
  const words = all.slice(skip, skip + budget);
  if (words.length < 110) return null;

  const body = words.join(' ').replace(SPEAKER, ' ').replace(/\s+/g, ' ').trim();

  // Still a conversation, or still about the course rather than the subject.
  const turns = (words.join(' ').match(/\b(Student|Professor)\b/g) || []).length;
  const admin = (body.match(ADMIN) || []).length;
  // One stray "this course" is a lecturer's aside; two is a lecture about the
  // course rather than about the subject.
  if (turns > 1 || admin > 1) return null;

  return { text: body, at, seconds };
}

/** ffmpeg pulls only the window it needs, over HTTP range requests. */
function cut(url, at, seconds, out) {
  return new Promise((ok, no) => {
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-ss', String(at), '-i', url, '-t', String(seconds),
      '-ac', '1', '-ar', '22050', '-c:a', 'libmp3lame', '-b:a', '64k', out]);
    let err = '';
    ff.stderr.on('data', (d) => { err += d; });
    ff.on('error', no);
    ff.on('close', (code) => (code === 0 ? ok() : no(new Error(err.trim() || `ffmpeg ${code}`))));
  });
}

async function lecturesOf(coursePath) {
  const html = await get(BASE + coursePath);
  const seen = new Set();
  for (const m of html.matchAll(new RegExp(`href="(${coursePath}/lecture-\\d+)"`, 'g'))) seen.add(m[1]);
  return [...seen];
}

async function main() {
  const want = Number(process.argv[2]) || 10;
  const startAt = Number((process.argv.includes('--start')
    ? process.argv[process.argv.indexOf('--start') + 1] : 1)) || 1;

  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  const index = await get(`${BASE}/courses`);
  const courses = [...new Set([...index.matchAll(/href="(\/[a-z-]+\/[a-z]+-\d+)"/g)].map((m) => m[1]))];
  console.log(`${courses.length} courses on Open Yale Courses`);

  let made = 0, n = startAt, round = 0;
  // Round-robin across courses rather than draining one: twenty excerpts from
  // the same lecturer is twenty times the same voice, and the point is variety.
  while (made < want && round < 12) {
    for (const course of courses) {
      if (made >= want) break;
      const id = 'Y' + String(n).padStart(3, '0');
      try {
        const lectures = await lecturesOf(course);
        const pick = lectures[round % lectures.length];
        if (!pick) continue;

        const page = await get(BASE + pick);
        const mp3 = (page.match(/\/sites\/default\/files\/[^"']+\.mp3/) || [])[0];
        if (!mp3) { console.log(`  ${id} ${pick}: no mp3`); continue; }

        const tIdx = page.indexOf('id="transcript');
        if (tIdx < 0) { console.log(`  ${id} ${pick}: no transcript`); continue; }
        const tHtml = page.slice(tIdx);
        const chs = chapters(tHtml);
        const usable = chs.filter((c, i) => c.at >= EARLIEST && !SKIP.test(c.title) && i < chs.length - 1);
        if (!usable.length) { console.log(`  ${id} ${pick}: no content chapter`); continue; }

        // Try the content chapters middle-outwards until one yields a clean
        // slice; a lecture with nothing usable is skipped rather than forced.
        let chosen = null, slice = null;
        const order = usable.slice().sort((a, b) =>
          Math.abs(usable.length / 2 - usable.indexOf(a)) - Math.abs(usable.length / 2 - usable.indexOf(b)));
        for (const cand of order) {
          const got = chapterSlice(tHtml, chs, chs.indexOf(cand));
          if (got) { chosen = cand; slice = got; break; }
        }
        if (!slice) { console.log(`  ${id} ${pick}: no clean slice`); continue; }
        const text = slice.text;
        const words = text.split(/\s+/).filter(Boolean).length;

        const audio = `${id}.mp3`;
        await cut(BASE + mp3, slice.at, slice.seconds, path.join(AUDIO_DIR, audio));

        const dept = course.split('/')[1];
        fs.writeFileSync(path.join(LECTURES_DIR, `${id}.json`), JSON.stringify({
          id,
          title: chosen.title,
          field: FIELDS[dept] || 'General academic',
          text,
          points: [],                       // authored in a second pass
          audio,
          source: {
            page: BASE + pick,
            mp3: BASE + mp3,
            start: slice.at,
            seconds: slice.seconds,
            chapter: `${chosen.n}. ${chosen.title}`,
            credit: CREDIT,
            licence: LICENCE,
          },
        }, null, 2) + '\n');

        console.log(`  ${id}  ${String(words).padStart(3)}w  ${slice.seconds}s  ${Math.floor(slice.at / 60)}m  ${chosen.title.slice(0, 44)}`);
        made++; n++;
      } catch (err) {
        console.log(`  ${id} ${course}: ${err.message}`);
      }
    }
    round++;
  }
  console.log(`\n${made} excerpts written. Audio in ${AUDIO_DIR} (gitignored).`);
  console.log('Points are empty - author them from the text in a second pass.');
}

main().catch((e) => { console.error(e); process.exit(1); });
