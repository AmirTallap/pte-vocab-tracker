/**
 * The Cloudflare Worker behind the study page.
 *
 * It exists for one route. Everything else in the cloud build is either a
 * static file or a write into the visitor's own localStorage - there is no
 * account, no database, and nothing of anyone's stored here.
 *
 * The exception is grammar marking, and it is the same exception the local
 * server makes. /static/grammar.json ships with `answer`, `accept` and
 * `explain` cut out of it, so the page cannot be read for the answers; the
 * answers live in worker/grammar-key.json, which is bundled into this Worker
 * and never served. Marking is therefore a round trip, exactly as it is in
 * src/server.js, and it hands back the verdict for ONE question at a time.
 *
 * The verdict is all it returns. The tally - how many times you got a question
 * right or wrong - is study state, and study state stays in the browser, so
 * recordAnswer() runs there rather than here. That is the one difference from
 * the local server, which keeps the tally in progress.json because locally
 * there is a progress.json to keep it in.
 *
 * isAccepted() is imported from src/shared.js rather than reimplemented: a
 * second grader is how the same typed answer starts being marked right on one
 * host and wrong on the other.
 */
import { isAccepted } from '../src/shared.js';
import KEY from './grammar-key.json';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/grammar/answer') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

      let body;
      try { body = await request.json(); }
      catch { return json({ error: 'expected a JSON body' }, 400); }

      const { module: moduleId, q: questionId, choice, text } = body;
      const mod = KEY[moduleId];
      if (!mod) return json({ error: `unknown module: ${moduleId}` }, 404);
      const question = mod[questionId];
      if (!question) return json({ error: `unknown question: ${questionId}` }, 404);

      const correct = question.type === 'mcq'
        ? Number(choice) === question.answer
        : isAccepted(question, text);

      return json({
        ok: true,
        correct,
        answer: question.type === 'mcq' ? question.answer : question.accept,
        explain: question.explain,
      });
    }

    // wrangler.toml routes only /api/* here, so anything else that arrives is
    // a route this Worker does not have. Answered as JSON rather than falling
    // through to the SPA shell, which is what made a missing API route look
    // like a working page once.
    if (url.pathname.startsWith('/api/')) {
      return json({ error: `not found: ${url.pathname}` }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
