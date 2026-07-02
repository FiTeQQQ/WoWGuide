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
  'Access-Control-Allow-Headers': 'Content-Type, X-Edit-Pass, X-Roster-Pass',
};

/* ---------------- Edit lock (soft) ----------------
 * Zápis do "chráněných" klíčů vyžaduje hlavičku X-Edit-Pass == aktuální heslo.
 * Heslo je uložené v KV ('edit-pass') a dá se měnit z webu (POST /api/editpass).
 * Fallback: secret EDIT_PASSWORD (pokud KV prázdné). Když není ani jedno → zámek vypnutý.
 * Chráněné = statická konfigurace + HLAVNÍ guidy (cloud/slug bossů z index-cfg) + spells.
 * Vlastní sdílené kopie zůstávají volně zapisovatelné. */
const PROTECTED_STATIC = new Set([
  'main', 'index-cfg', 'trial-roster', 'roster-sheets', 'loot-archive',
  'wcl-cfg', 'wcl-creds', 'blizz-specs', 'blizz-ach', 'blizz-token',
  'group-templates', 'lb-raw',
]);

async function guideMainKeys(env) {
  try {
    const cfg = await env.ROSTERS.get('index-cfg', { type: 'json' });
    if (!cfg) return new Set();
    const out = new Set();
    const seasons = Array.isArray(cfg.seasons) ? cfg.seasons
      : (Array.isArray(cfg.raids) ? [{ raids: cfg.raids }] : []);
    for (const se of seasons)
      for (const raid of (se.raids || []))
        for (const b of (raid.bosses || [])) {
          if (b && b.cloud) out.add(String(b.cloud));
          if (b && b.slug) out.add(String(b.slug));
        }
    return out;
  } catch (e) { return new Set(); }
}

async function isProtectedKey(env, id) {
  if (PROTECTED_STATIC.has(id)) return true;
  const mk = await guideMainKeys(env);
  return mk.has(id);
}

async function getConfiguredPass(env) {
  try {
    const kv = await env.ROSTERS.get('edit-pass');
    if (kv != null && kv !== '') return kv;
  } catch (e) {}
  return (env.EDIT_PASSWORD || '');
}

async function editAuthOK(request, env) {
  const pass = await getConfiguredPass(env);
  if (!pass) return true;                               // zámek vypnutý dokud heslo není
  return (request.headers.get('X-Edit-Pass') || '') === pass;
}

/* Samostatné roster heslo (jen pro párování altů / dormant) — klíč 'roster-pass'.
 * Zápis do 'roster-alts' projde s X-Roster-Pass NEBO s admin X-Edit-Pass. */
async function getRosterPass(env) {
  try { const kv = await env.ROSTERS.get('roster-pass'); if (kv != null && kv !== '') return kv; } catch (e) {}
  return '';
}
async function rosterAuthOK(request, env) {
  const rpass = await getRosterPass(env);
  if (!rpass) return true;                              // roster zámek vypnutý dokud heslo není
  if ((request.headers.get('X-Roster-Pass') || '') === rpass) return true;
  const apass = await getConfiguredPass(env);           // admin override
  if (apass && (request.headers.get('X-Edit-Pass') || '') === apass) return true;
  return false;
}

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

/* ---------------- Leaderboard: staty per postava ---------------- */
function flattenStats(statsJson) {
  const out = {};
  const walk = (cat) => {
    if (!cat) return;
    (cat.statistics || []).forEach(s => { if (s && s.name) out[String(s.name).toLowerCase()] = (s.quantity || 0); });
    (cat.sub_categories || []).forEach(walk);
  };
  ((statsJson && statsJson.categories) || []).forEach(walk);
  return out;
}
function sumStats(flat, pred) { let t = 0; for (const k in flat) { if (pred(k)) t += flat[k]; } return Math.round(t); }
function firstStat(flat, names) {
  for (const n of names) { if (flat[n] != null) return Math.round(flat[n]); }
  for (const k in flat) { if (names.some(n => k.includes(n))) return Math.round(flat[k]); }
  return 0;
}
async function fetchCharLB(token, region, realm, nameRaw) {
  const name = encodeURIComponent(String(nameRaw || '').toLowerCase());
  const base = `/profile/wow/character/${realm}/${name}`;
  const g = (p) => blizzGet(token, region, base + p).catch(() => null);
  const [ach, stats, mounts, pets, toys, heirlooms, titles, reps, pvp, summary] = await Promise.all([
    g('/achievements'), g('/achievements/statistics'),
    g('/collections/mounts'), g('/collections/pets'), g('/collections/toys'), g('/collections/heirlooms'),
    g('/titles'), g('/reputations'), g('/pvp-summary'), g(''),
  ]);
  const flat = flattenStats(stats);
  let io = 0, ioW = 0, ioR = 0, ioRealm = 0;
  try {
    const rioUrl = `https://raider.io/api/v1/characters/profile?region=${region}&realm=${realm}&name=${name}&fields=mythic_plus_scores_by_season:current,mythic_plus_ranks`;
    const rio = await fetch(rioUrl).then(r => r.ok ? r.json() : null).catch(() => null);
    const s = (rio && rio.mythic_plus_scores_by_season || [])[0];
    io = (s && s.scores && Math.round(s.scores.all)) || 0;
    const rk = rio && rio.mythic_plus_ranks && rio.mythic_plus_ranks.overall;
    if (rk) { ioW = rk.world || 0; ioR = rk.region || 0; ioRealm = rk.realm || 0; }
  } catch (e) {}
  const repsExalted = (((reps && reps.reputations) || []).filter(r => r && r.standing && r.standing.name === 'Exalted')).length;
  return {
    specId: (summary && summary.active_spec && summary.active_spec.id) || 0,
    achPoints: (ach && ach.total_points) || 0,
    achCount: (ach && ach.total_quantity) || 0,
    mounts: ((mounts && mounts.mounts) || []).length,
    pets: ((pets && pets.pets) || []).length,
    toys: ((toys && toys.toys) || []).length,
    heirlooms: ((heirlooms && heirlooms.heirlooms) || []).length,
    titles: ((titles && titles.titles) || []).length,
    repsExalted,
    ilvl: Math.round((summary && (summary.equipped_item_level || summary.average_item_level)) || 0),
    io, ioW, ioR, ioRealm,
    honorLevel: (pvp && pvp.honor_level) || 0,
    quests: firstStat(flat, ['quests completed']),
    hk: firstStat(flat, ['total honorable kills', 'honorable kills']),
    deaths: firstStat(flat, ['total deaths']),
    deathsFall: sumStats(flat, k => k.includes('death') && k.includes('fall')),
    deathsEnv: sumStats(flat, k => k.includes('death') && (k.includes('drown') || k.includes('lava') || k.includes('fire') || k.includes('fatigue'))),
    junkFished: Math.max(0, firstStat(flat, ['fish and other things caught']) - firstStat(flat, ['fish caught'])),
  };
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
      // re-probe i když je role dosud neznámá ('?') a postava má spec (max level) — vyřeší nové specy
      if (hit && hit.role === '?' && hit.specId) return true;
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
      let role = SPEC_ROLE[specId] || '?';
      if (role === '?' && specId) {
        // neznámý (nový) spec — dotáhni roli přímo z Blizzardu, ať nemusíme ručně updatovat mapu
        try {
          const spec = await blizzGet(token, region, `/data/wow/playable-specialization/${specId}`, { namespace: `static-${region}` });
          const rt = spec && spec.role && spec.role.type;
          role = rt === 'TANK' ? 'tank' : rt === 'HEALER' ? 'healer' : rt === 'DAMAGE' ? 'dps' : '?';
        } catch (e) {}
      }
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

    /* ----- Edit heslo: stav ----- */
    if (request.method === 'GET' && pathname === '/api/haspass') {
      const pass = await getConfiguredPass(env);
      return json({ configured: !!pass });
    }

    /* ----- Edit heslo: nastavení / změna ----- */
    if (request.method === 'POST' && pathname === '/api/editpass') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const current = await getConfiguredPass(env);
      const supplied = (body.current != null ? body.current : (request.headers.get('X-Edit-Pass') || ''));
      if (current && supplied !== current) {
        return json({ error: 'bad-current' }, 403);
      }
      const next = (body.next == null ? '' : String(body.next));
      if (!next) {
        await env.ROSTERS.delete('edit-pass');          // prázdné = vypnout zámek
        return json({ ok: true, configured: false });
      }
      await env.ROSTERS.put('edit-pass', next);
      return json({ ok: true, configured: true });
    }

    /* ----- Roster heslo: stav ----- */
    if (request.method === 'GET' && pathname === '/api/haspass-roster') {
      return json({ configured: !!(await getRosterPass(env)) });
    }
    /* ----- Roster heslo: ověření zadaného ----- */
    if (request.method === 'POST' && pathname === '/api/roster-pass/verify') {
      const rpass = await getRosterPass(env);
      if (!rpass) return json({ ok: true, configured: false });
      const supplied = request.headers.get('X-Roster-Pass') || '';
      return json({ ok: supplied === rpass, configured: true });
    }
    /* ----- Roster heslo: nastavení / změna (autorizuje admin edit-pass NEBO stávající roster heslo) ----- */
    if (request.method === 'POST' && pathname === '/api/roster-pass') {
      let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const cur = await getRosterPass(env);
      const admOK = await editAuthOK(request, env) && (await getConfiguredPass(env));
      const rosterOK = !cur || (request.headers.get('X-Roster-Pass') || '') === cur || (body.current != null && body.current === cur);
      if (!admOK && !rosterOK) return json({ error: 'bad-current' }, 403);
      const next = (body.next == null ? '' : String(body.next));
      if (!next) { await env.ROSTERS.delete('roster-pass'); return json({ ok: true, configured: false }); }
      await env.ROSTERS.put('roster-pass', next);
      return json({ ok: true, configured: true });
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

    /* ----- Raider.IO character (iLvl + spec + M+ score) ----- */
    if (request.method === 'GET' && pathname === '/api/rio-char') {
      const region = (url.searchParams.get('region') || 'eu').toLowerCase();
      const realm = url.searchParams.get('realm') || '';
      const name = url.searchParams.get('name') || '';
      if (!realm || !name) return json({ ilvl: 0 });
      const cacheKey = `riochar:${region}:${realm}:${name}`.toLowerCase();
      try {
        const cached = await env.ROSTERS.get(cacheKey, { type: 'json' });
        if (cached && (Date.now() - (cached._t || 0)) < 60 * 60 * 1000) return json(cached);
        const rio = new URL('https://raider.io/api/v1/characters/profile');
        rio.searchParams.set('region', region);
        rio.searchParams.set('realm', realm);
        rio.searchParams.set('name', name);
        rio.searchParams.set('fields', 'gear,mythic_plus_scores_by_season:current');
        const res = await fetch(rio.toString());
        if (!res.ok) return json({ ilvl: 0 });
        const d = await res.json();
        const gear = d.gear || {};
        let mplus = 0, mcolor = '';
        try {
          const s = (d.mythic_plus_scores_by_season || [])[0];
          mplus = (s && s.scores && Math.round(s.scores.all)) || 0;
          const seg = s && s.segments && s.segments.all;
          mcolor = (seg && seg.color) || '';
        } catch (e) {}
        const rec = { ilvl: Math.round(gear.item_level_equipped || 0), ilvlTotal: Math.round(gear.item_level_total || 0), spec: d.active_spec_name || '', mplus, mcolor, _t: Date.now() };
        await env.ROSTERS.put(cacheKey, JSON.stringify(rec), { expirationTtl: 60 * 60 * 3 });
        return json(rec);
      } catch (e) {
        return json({ ilvl: 0, error: String(e && e.message || e) });
      }
    }

    /* ----- Raider.IO season cutoffs (percentilové brackety + barvy) ----- */
    if (request.method === 'GET' && pathname === '/api/rio-cutoffs') {
      const region = (url.searchParams.get('region') || 'eu').toLowerCase();
      const season = url.searchParams.get('season') || 'season-mn-1';
      const faction = (url.searchParams.get('faction') || 'all').toLowerCase();
      const cacheKey = `riocut:${region}:${season}:${faction}`.toLowerCase();
      try {
        const cached = await env.ROSTERS.get(cacheKey, { type: 'json' });
        if (cached && (Date.now() - (cached._t || 0)) < 6 * 60 * 60 * 1000) return json(cached);
        const u = new URL('https://raider.io/api/v1/mythic-plus/season-cutoffs');
        u.searchParams.set('region', region);
        u.searchParams.set('season', season);
        const res = await fetch(u.toString());
        if (!res.ok) return json({ brackets: [], error: 'HTTP ' + res.status });
        const d = await res.json();
        const c = (d && d.cutoffs) || {};
        const pick = (node) => {
          const f = node && node[faction];
          const col = node && node[faction + 'Color'];
          return f ? { min: Math.round(f.quantileMinValue || 0), color: col || '' } : null;
        };
        const map = [['p999', 'Top 0.1%'], ['p990', 'Top 1%'], ['p900', 'Top 10%'], ['p750', 'Top 25%'], ['p600', 'Top 40%']];
        const brackets = [];
        for (const [k, label] of map) { const b = pick(c[k]); if (b && b.min > 0) brackets.push({ label, min: b.min, color: b.color }); }
        const rec = { season, region, faction, brackets, updatedAt: c.updatedAt || '', _t: Date.now() };
        await env.ROSTERS.put(cacheKey, JSON.stringify(rec), { expirationTtl: 6 * 60 * 60 });
        return json(rec);
      } catch (e) {
        return json({ brackets: [], error: String(e && e.message || e) });
      }
    }

    /* ----- Leaderboard: čtení raw dat (public) ----- */
    if (request.method === 'GET' && pathname === '/api/lb/raw') {
      const raw = await env.ROSTERS.get('lb-raw');
      if (!raw) return json({ chars: {}, updatedAt: null, total: 0 });
      return new Response(raw, { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    /* ----- Leaderboard: debug názvů statistik jedné postavy (admin) ----- */
    if (request.method === 'GET' && pathname === '/api/lb/debug') {
      const region = (url.searchParams.get('region') || GUILD_DEFAULT.region).toLowerCase();
      const realm = url.searchParams.get('realm') || GUILD_DEFAULT.realm;
      const name = (url.searchParams.get('name') || '').toLowerCase();
      if (!name) return json({ error: 'name required' }, 400);
      try {
        const token = await getBlizzToken(env);
        const st = await blizzGet(token, region, `/profile/wow/character/${realm}/${encodeURIComponent(name)}/achievements/statistics`).catch(() => null);
        const flat = flattenStats(st);
        const all = Object.keys(flat).sort().map(k => [k, flat[k]]);
        return json({ count: all.length, all });
      } catch (e) { return json({ error: String(e && e.message || e) }, 500); }
    }

    /* ----- Leaderboard: dávkový build (admin) ----- */
    if (request.method === 'GET' && pathname === '/api/lb/build') {
      if (!(await editAuthOK(request, env))) return json({ error: 'locked', locked: true }, 403);
      const guild = {
        realm: url.searchParams.get('realm') || GUILD_DEFAULT.realm,
        nameSlug: url.searchParams.get('name') || GUILD_DEFAULT.nameSlug,
        region: url.searchParams.get('region') || GUILD_DEFAULT.region,
      };
      const batch = Math.min(4, Math.max(1, parseInt(url.searchParams.get('batch') || '3', 10) || 3));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      try {
        let members;
        const gcache = await env.ROSTERS.get(`blizz-guild:${guild.region}:${guild.realm}:${guild.nameSlug}`, { type: 'json' });
        if (gcache && Array.isArray(gcache.members)) members = gcache.members;
        else { const gd = await buildGuild(env, guild); members = gd.members; }
        members = members.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
        const total = members.length;
        const slice = members.slice(offset, offset + batch);
        const token = await getBlizzToken(env);
        const raw = (await env.ROSTERS.get('lb-raw', { type: 'json' })) || { chars: {} };
        if (!raw.chars) raw.chars = {};
        for (const m of slice) {
          const key = `${m.realmSlug}:${String(m.name).toLowerCase()}`;
          try {
            const s = await fetchCharLB(token, guild.region, m.realmSlug, m.name);
            raw.chars[key] = { name: m.name, realmSlug: m.realmSlug, className: m.className, raceName: m.raceName, level: m.level, rank: m.rank, specId: s.specId || 0, t: Date.now(), s };
          } catch (e) {}
        }
        raw.region = guild.region; raw.realm = guild.realm; raw.total = total;
        raw.updatedAt = new Date().toISOString();
        await env.ROSTERS.put('lb-raw', JSON.stringify(raw));
        const next = offset + batch;
        return json({ done: next >= total, next, total, processed: slice.length, updatedAt: raw.updatedAt });
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500);
      }
    }

    /* ----- Blizzard item ID lookup (name -> id) for loot tooltips ----- */
    if (request.method === 'GET' && pathname === '/api/blizz/itemid') {
      const name = (url.searchParams.get('name') || '').trim();
      const region = url.searchParams.get('region') || GUILD_DEFAULT.region;
      if (!name) return json({ id: 0 });
      const cacheKey = `itemid2:${region}:${name.toLowerCase()}`;
      try {
        const cached = await env.ROSTERS.get(cacheKey, { type: 'json' });
        if (cached) return json(cached);
        const token = await getBlizzToken(env);
        const u = new URL(`https://${region}.api.blizzard.com/data/wow/search/item`);
        u.searchParams.set('namespace', `static-${region}`);
        u.searchParams.set('name.en_US', name);
        u.searchParams.set('orderby', 'id');
        u.searchParams.set('_pageSize', '10');
        const res = await fetch(u.toString(), { headers: { 'Authorization': 'Bearer ' + token } });
        let id = 0;
        if (res.ok) {
          const d = await res.json();
          const results = d.results || [];
          const lc = name.toLowerCase();
          for (const r of results) {
            const nm = r.data && r.data.name;
            const vals = (nm && typeof nm === 'object') ? Object.values(nm) : [nm];
            if (vals.some(v => String(v || '').toLowerCase() === lc)) { id = (r.data && r.data.id) || 0; break; }
          }
          // jen PŘESNÁ shoda názvu — žádné hádání (jinak vrátí nesmyslný item)
        }
        const rec = { id };
        await env.ROSTERS.put(cacheKey, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 30 });
        return json(rec);
      } catch (e) {
        return json({ id: 0, error: String(e && e.message || e) });
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
      if (id === 'roster-alts') {
        if (!(await rosterAuthOK(request, env))) return json({ error: 'locked', locked: true }, 403);
      } else if (await isProtectedKey(env, id) && !(await editAuthOK(request, env))) {
        return json({ error: 'locked', locked: true }, 403);
      }
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
      if (!(await editAuthOK(request, env))) return json({ error: 'locked', locked: true }, 403);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const payload = { ...body, updatedAt: new Date().toISOString() };
      await env.ROSTERS.put(`spells:${matchSpellPut[1]}`, JSON.stringify(payload));
      return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  },
};
