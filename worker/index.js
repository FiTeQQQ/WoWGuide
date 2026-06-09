/**
 * Raid Guide WoW — Cloudflare Worker
 * API endpoints:
 *   POST /api/roster          → create new roster, returns { id }
 *   GET  /api/roster/:id      → load roster JSON
 *   PUT  /api/roster/:id      → update roster JSON
 *   GET  /api/spells/:slug    → load spell list for encounter
 *   PUT  /api/spells/:slug    → save spell list for encounter
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function generateId(len = 7) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'; // no ambiguous chars
  let id = '';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (const b of bytes) id += chars[b % chars.length];
  return id;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // POST /api/roster — create new roster
    if (request.method === 'POST' && pathname === '/api/roster') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON' }, 400);
      }

      const id = generateId();
      const payload = {
        ...body,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await env.ROSTERS.put(id, JSON.stringify(payload));
      return json({ id });
    }

    // GET /api/roster/:id — load roster
    const matchGet = pathname.match(/^\/api\/roster\/([a-z0-9-]+)$/);
    if (request.method === 'GET' && matchGet) {
      const id = matchGet[1];
      const data = await env.ROSTERS.get(id);
      if (!data) return json({ error: 'Not found' }, 404);
      return json(JSON.parse(data));
    }

    // PUT /api/roster/:id — upsert roster (creates if not exists)
    const matchPut = pathname.match(/^\/api\/roster\/([a-z0-9-]+)$/);
    if (request.method === 'PUT' && matchPut) {
      const id = matchPut[1];
      const existing = await env.ROSTERS.get(id);

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON' }, 400);
      }

      const prev = existing ? JSON.parse(existing) : null;
      const payload = {
        ...body,
        createdAt: prev?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await env.ROSTERS.put(id, JSON.stringify(payload));
      return json({ ok: true });
    }

    // GET /api/spells/:slug — load spell list for encounter
    const matchSpellGet = pathname.match(/^\/api\/spells\/([a-z0-9-]+)$/);
    if (request.method === 'GET' && matchSpellGet) {
      const slug = matchSpellGet[1];
      const data = await env.ROSTERS.get(`spells:${slug}`);
      if (!data) return json({ bosses: [] });
      return json(JSON.parse(data));
    }

    // PUT /api/spells/:slug — save spell list for encounter
    const matchSpellPut = pathname.match(/^\/api\/spells\/([a-z0-9-]+)$/);
    if (request.method === 'PUT' && matchSpellPut) {
      const slug = matchSpellPut[1];
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON' }, 400);
      }
      const payload = { ...body, updatedAt: new Date().toISOString() };
      await env.ROSTERS.put(`spells:${slug}`, JSON.stringify(payload));
      return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  },
};
