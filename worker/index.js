/**
 * The Cloudflare Worker behind the study page.
 *
 * It used to exist for one route: marking the grammar questions, whose
 * answers were bundled here and never served. The grammar tab became a map
 * of articles on 26 Sep 2026 with no questions to mark, so what is left is
 * the guard below - an /api/ route this build does not have is answered as
 * JSON rather than falling through to the page shell - and the static files.
 */
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
