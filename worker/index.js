/**
 * Raid Guide WoW — Cloudflare Worker
 * API endpoints:
 *   POST /api/roster              → create new roster, returns { id }
 *   GET  /api/roster/:id          → load roster JSON
 *   PUT  /api/roster/:id          → update roster JSON
 *   GET  /api/spells/:slug        → load spell list for encounter
 *   PUT  /api/spells/:slug        → save spell list for encounter
 *   GET  /api/blizz/guild         → guild header + roster + achievements (Blizzard Armory)
 *   GET  /api/rankings            → guild raid progress + ranks (Raider.IO)
 *
 * Secrets required for the Blizzard endpoints (set via wrangler):
 *   wrangler secret put BLIZZARD_CLIENT_ID
 *   wrangler secret put BLIZZARD_CLIENT_SECRET
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Default guild identity (overridable via ?realm=&name=&region= query params)
const GUILD_DEFAULT = { realm: 'drakthul', nameSlug: 'rapid-evolution-eu', region: 'eu' };

const GUILD_CACHE_TTL = 60 * 60;        // 1 h for the base guild payload
const RANKINGS_CACHE_TTL = 60 * 30;     // 30 min for Raider.IO
const SPEC_TTL = 24 * 60 * 60 * 1000;   // 24 h before a char spec is re-probed
const SPEC_FILL_BATCH = 25;             // chars probed per /api/blizz/guild call (subrequest budget)

const CLASS_NAMES = {
  1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest',
  6: 'Death Knight', 7: 'Shaman', 8: 'Mage', 9: 'Warlock', 10: 'Monk',
  11: 'Druid', 12: 'Demon Hunter', 13: 'Evoker',
};

const RACE_NAMES = {
  1: 'Human', 2: 'Orc', 3: 'Dwarf', 4: 'Night Elf', 5: 'Undead', 6: 'Tauren',
  7: 'Gnome', 8: 'Troll', 9: 'Goblin', 10: 'Blood Elf', 11: 'Draenei',
  22: 'Worgen', 24: 'Pandaren', 25: 'Pandaren', 26: 'Pandaren',
  27: 'Nightborne', 28: 'Highmountain Tauren', 29: 'Void Elf',
  30: 'Lightforged Draenei', 31: 'Zandalari Troll', 32: 'Kul Tiran',
  34: 'Dark Iron Dwarf', 35: 'Vulpera', 36: "Mag'har Orc", 37: 'Mechagnome',
  52: 'Dracthyr', 70: 'Dracthyr',
};

// Specialization ID -> role
const SPEC_ROLE = {
  250: 'tank', 251: 'dps', 252: 'dps',          // Death Knight
  577: 'dps', 581: 'tank',                       // Demon Hunter
  102: 'dps', 103: 'dps', 104: 'tank', 105: 'healer', // Druid
  1467: 'dps', 1468: 'healer', 1473: 'dps',      // Evoker
  253: 'dps', 254: 'dps', 255: 'dps',            // Hunter
  62: 'dps', 63: 'dps', 64: 'dps',               // Mage
  268: 'tank', 269: 'dps', 270: 'healer',        // Monk
  65: 'healer', 66: 'tank', 70: 'dps',           // Paladin
  256: 'healer', 257: 'healer', 258: 'dps',      // Priest
  259: 'dps', 260: 'dps', 261: 'dps',            // Rogue
  262: 'dps', 263: 'dps', 264: 'healer',         // Shaman
  265: 'dps', 266: 'dps', 267: 'dps',            // Warlock
  71: 'dps', 72: 'dps', 73: 'tank',              // Warrior
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function generateId(len = 7) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'; // no ambiguous chars
  let id = '';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (const b of bytes) id += chars[b % chars.length];
  return id;
}

/* ---------------- Blizzard helpers ---------------- */

async function getBlizzToken(env) {
  const cached = await env.ROSTERS.get('blizz-token', { type: 'json' });
  if (cached && cached.token && cached.exp > Date.now() + 60000) return cached.token;

  const id = (env.BLIZZARD_CLIENT_ID || '').trim(), sec = (env.BLIZZARD_CLIENT_SECRET || '').trim();
  if (!id || !sec) throw new Error('Missing BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET secrets');

  const res = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(id + ':' + sec),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Blizzard token failed: ' + res.status + (body ? (' — ' + body.slice(0, 200)) : ''));
  }
  const d = await res.json();
  const token = d.access_token;
  const exp = Date.now() + (d.expires_in || 86400) * 1000;
  await env.ROSTERS.put('blizz-token', JSON.stringify({ token, exp }));
  return token;
}

async function blizzGet(token, region, path, params = {}) {
  const u = new URL(`https://${region}.api.blizzard.com${path}`);
  u.searchParams.set('namespace', params.namespace || `profile-${region}`);
  u.searchParams.set('locale', params.locale || 'en_GB');
  const res = await fetch(u.toString(), { headers: { 'Authorization': 'Bearer ' + token } });
  if (!res.ok) { const e = new Error('Blizzard ' + res.status + ' ' + path); e.status = res.status; throw e; }
  return res.json();
}

async function buildGuild(env, guild) {
  const { realm, nameSlug, region } = guild;
  const token = await getBlizzToken(env);

  const [summary, roster, ach] = await Promise.all([
    blizzGet(token, region, `/data/wow/guild/${realm}/${nameSlug}`).catch(() => null),
    blizzGet(token, region, `/data/wow/guild/${realm}/${nameSlug}/roster`),
    blizzGet(token, region, `/data/wow/guild/${realm}/${nameSlug}/achievements`).catch(() => null),
  ]);

  const members = (roster.members || []).map(m => {
    const c = m.character || {};
    const classId = c.playable_class && c.playable_class.id;
    const raceId = c.playable_race && c.playable_race.id;
    return {
      name: c.name,
      realmSlug: (c.realm && c.realm.slug) || realm,
      level: c.level || 0,
      classId, className: CLASS_NAMES[classId] || '',
      raceId, raceName: RACE_NAMES[raceId] || '',
      rank: m.rank,
      faction: (c.faction && c.faction.type) || null,
    };
  });

  // Recent achievements (newest first)
  let achievements = [];
  if (ach && Array.isArray(ach.recent_events)) {
    achievements = ach.recent_events.slice(0, 8).map(ev => ({
      id: ev.achievement && ev.achievement.id,
      name: ev.achievement && ev.achievement.name,
      timestamp: ev.timestamp,
    }));
  }

  await enrichAchievements(env, achievements, region);

  const created = summary && summary.created_timestamp ? new Date(summary.created_timestamp) : null;

  return {
    name: (summary && summary.name) || nameSlug,
    realm: (summary && summary.realm && summary.realm.name) || realm,
    realmSlug: realm,
    region,
    faction: (summary && summary.faction && summary.faction.type) || (members[0] && members[0].faction) || null,
    achievementPoints: (summary && summary.achievement_points) || 0,
    memberCount: (summary && summary.member_count) || members.length,
    founded: created ? created.getUTCFullYear() : null,
    members,
    achievements,
    fetchedAt: Date.now(),
  };
}

// Enrich recent achievements with icon + points (cached in KV, static namespace).
async function enrichAchievements(env, list, region) {
  if (!list || !list.length) return;
  const cache = (await env.ROSTERS.get('blizz-ach', { type: 'json' })) || {};
  let dirty = false;
  let token = null;
  for (const ev of list.slice(0, 6)) {
    const id = ev.id; if (!id) continue;
    if (cache[id]) { ev.icon = cache[id].icon; ev.points = cache[id].points; continue; }
    try {
      if (!token) token = await getBlizzToken(env);
      const a = await blizzGet(token, region, `/data/wow/achievement/${id}`, { namespace: `static-${region}` });
      let icon = '';
      try {
        const m = await blizzGet(token, region, `/data/wow/media/achievement/${id}`, { namespace: `static-${region}` });
        const asset = (m.assets || []).find(x => x.key === 'icon');
        icon = asset ? asset.value : '';
      } catch (_) {}
      const rec = { icon, points: a.points || 0 };
      cache[id] = rec; ev.icon = rec.icon; ev.points = rec.points; dirty = true;
    } catch (e) {}
  }
  if (dirty) await env.ROSTERS.put('blizz-ach', JSON.stringify(cache));
}

// Probe up to SPEC_FILL_BATCH uncached chars; merge spec/role into payload.members.
async function attachSpecs(env, payload) {
  const region = payload.region;
  const cache = (await env.ROSTERS.get('blizz-specs', { type: 'json' })) || {};
  const now = Date.now();

  // merge what we already know
  for (const m of payload.members) {
    const key = `${m.realmSlug}:${(m.name || '').toLowerCase()}`;
    const hit = cache[key];
    if (hit) { m.specId = hit.specId || null; m.specName = hit.specName || ''; m.role = hit.role || '?'; }
    else { m.role = '?'; }
  }

  // pick a batch of stale/missing chars (max level first)
  const stale = payload.members
    .filter(m => {
      const key = `${m.realmSlug}:${(m.name || '').toLowerCase()}`;
      const hit = cache[key];
      return !hit || (now - (hit.ts || 0)) > SPEC_TTL;
    })
    .sort((a, b) => (b.level || 0) - (a.level || 0))
    .slice(0, SPEC_FILL_BATCH);

  if (!stale.length) return;

  const token = await getBlizzToken(env);
  await Promise.all(stale.map(async m => {
    const key = `${m.realmSlug}:${(m.name || '').toLowerCase()}`;
    try {
      const prof = await blizzGet(token, region,
        `/profile/wow/character/${m.realmSlug}/${encodeURIComponent((m.name || '').toLowerCase())}`);
      const sp = prof.active_spec || null;
      const specId = sp && sp.id;
      const role = SPEC_ROLE[specId] || '?';
      const rec = { specId: specId || null, specName: (sp && sp.name) || '', role, ts: now };
      cache[key] = rec;
      m.specId = rec.specId; m.specName = rec.specName; m.role = rec.role;
    } catch (e) {
      // 404 / private profile — remember the attempt so we don't hammer it
      cache[key] = { specId: null, specName: '', role: '?', ts: now };
    }
  }));

  await env.ROSTERS.put('blizz-specs', JSON.stringify(cache));
}

/* ---------------- Worker ---------------- */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    /* ----- Blizzard guild ----- */
    if (request.method === 'GET' && pathname === '/api/blizz/guild') {
      const guild = {
        realm: url.searchParams.get('realm') || GUILD_DEFAULT.realm,
        nameSlug: url.searchParams.get('name') || GUILD_DEFAULT.nameSlug,
        region: url.searchParams.get('region') || GUILD_DEFAULT.region,
      };
      const cacheKey = `blizz-guild:${guild.region}:${guild.realm}:${guild.nameSlug}`;
      try {
        let payload = await env.ROSTERS.get(cacheKey, { type: 'json' });
        if (!payload || (Date.now() - (payload.fetchedAt || 0)) > GUILD_CACHE_TTL * 1000) {
          payload = await buildGuild(env, guild);
          await env.ROSTERS.put(cacheKey, JSON.stringify(payload), { expirationTtl: GUILD_CACHE_TTL * 2 });
        }
        // always merge latest spec cache + grow it a bit
        await attachSpecs(env, payload);
        return json(payload);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 502);
      }
    }

    /* ----- Raider.IO rankings ----- */
    if (request.method === 'GET' && pathname === '/api/rankings') {
      const region = url.searchParams.get('region') || GUILD_DEFAULT.region;
      const realm = url.searchParams.get('realm') || GUILD_DEFAULT.realm;
      const name = url.searchParams.get('name') || 'Rapid Evolution EU';
      const cacheKey = `rio:${region}:${realm}:${name}`;
      try {
        let payload = await env.ROSTERS.get(cacheKey, { type: 'json' });
        if (!payload || (Date.now() - (payload._fetchedAt || 0)) > RANKINGS_CACHE_TTL * 1000) {
          const rio = new URL('https://raider.io/api/v1/guilds/profile');
          rio.searchParams.set('region', region);
          rio.searchParams.set('realm', realm);
          rio.searchParams.set('name', name);
          rio.searchParams.set('fields', 'raid_progression,raid_rankings');
          const res = await fetch(rio.toString());
          if (!res.ok) return json({ error: 'Raider.IO ' + res.status }, 502);
          payload = await res.json();
          payload._fetchedAt = Date.now();
          await env.ROSTERS.put(cacheKey, JSON.stringify(payload), { expirationTtl: RANKINGS_CACHE_TTL * 2 });
        }
        return json(payload);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 502);
      }
    }

    // POST /api/roster — create new roster
    if (request.method === 'POST' && pathname === '/api/roster') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const id = generateId();
      const payload = { ...body, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await env.ROSTERS.put(id, JSON.stringify(payload));
      return json({ id });
    }

    // GET /api/roster/:id
    const matchGet = pathname.match(/^\/api\/roster\/([a-z0-9-]+)$/);
    if (request.method === 'GET' && matchGet) {
      const data = await env.ROSTERS.get(matchGet[1]);
      if (!data) return json({ error: 'Not found' }, 404);
      return json(JSON.parse(data));
    }

    // PUT /api/roster/:id
    const matchPut = pathname.match(/^\/api\/roster\/([a-z0-9-]+)$/);
    if (request.method === 'PUT' && matchPut) {
      const id = matchPut[1];
      const existing = await env.ROSTERS.get(id);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const prev = existing ? JSON.parse(existing) : null;
      const payload = { ...body, createdAt: prev?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
      await env.ROSTERS.put(id, JSON.stringify(payload));
      return json({ ok: true });
    }

    // GET /api/spells/:slug
    const matchSpellGet = pathname.match(/^\/api\/spells\/([a-z0-9-]+)$/);
    if (request.method === 'GET' && matchSpellGet) {
      const data = await env.ROSTERS.get(`spells:${matchSpellGet[1]}`);
      if (!data) return json({ bosses: [] });
      return json(JSON.parse(data));
    }

    // PUT /api/spells/:slug
    const matchSpellPut = pathname.match(/^\/api\/spells\/([a-z0-9-]+)$/);
    if (request.method === 'PUT' && matchSpellPut) {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const payload = { ...body, updatedAt: new Date().toISOString() };
      await env.ROSTERS.put(`spells:${matchSpellPut[1]}`, JSON.stringify(payload));
      return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  },
};
