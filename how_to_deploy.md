# Jak nasadit Raid Guide na Cloudflare

## Co kde běží
- **guide.html** → Cloudflare Pages (statický hosting, napojený na GitHub)
- **worker/** → Cloudflare Workers + KV (backend API pro ukládání rosterů)

---

## 1. Nastav KV Namespace

```bash
# Nainstaluj Wrangler CLI (pokud ještě nemáš)
npm install -g wrangler
wrangler login

# Vytvoř KV namespace pro produkci
wrangler kv:namespace create ROSTERS

# Vytvoř KV namespace pro preview (local dev)
wrangler kv:namespace create ROSTERS --preview
```

Wrangler vypíše dvě ID. Vlož je do `worker/wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "ROSTERS"
id = "TADY_VLOZ_PRODUCTION_ID"
preview_id = "TADY_VLOZ_PREVIEW_ID"
```

---

## 2. Nasaď Worker

```bash
cd worker
wrangler deploy
```

Po deployi dostaneš URL:
`https://raidguide-api.TVUJ-JMENO.workers.dev`

---

## 2b. Nastav Blizzard API secrets (pro úvodní stránku / Armory data)

Založ si Blizzard API klienta na https://develop.battle.net/access/clients
(Create Client → dostaneš **Client ID** a **Client Secret**).

```bash
cd worker
wrangler secret put BLIZZARD_CLIENT_ID
# vlož Client ID

wrangler secret put BLIZZARD_CLIENT_SECRET
# vlož Client Secret

wrangler deploy
```

Worker pak sám dělá OAuth a tahá guild roster / achievementy z `eu.api.blizzard.com`.
Rankings (progress + World/Region/Realm) jdou přes Raider.IO (bez klíče).

Guild se dá změnit přes query param: `/api/blizz/guild?realm=drakthul&name=rapid-evolution-eu&region=eu`
(default je Rapid Evolution EU). Stejně tak `/api/rankings?realm=...&name=Rapid Evolution EU&region=eu`.

---

## 3. Aktualizuj API_BASE v guide.html

Najdi v `guide.html`:
```js
const API_BASE = 'https://raidguide-api.TVUJ-SUBDOMAIN.workers.dev';
```
Nahraď za svou Worker URL. Commitni a pushni na GitHub.

---

## 4. Napoj GitHub na Cloudflare Pages

1. Jdi na [Cloudflare Dashboard](https://dash.cloudflare.com) → **Pages**
2. **Create a project** → **Connect to Git** → vyber GitHub repo
3. Build settings:
   - Framework preset: **None**
   - Build command: *(prázdné)*
   - Build output directory: `/`
4. Deploy!

Každý push na `main` se automaticky nasadí.

---

## 5. Použití

1. Otevři Pages URL (např. `https://raidguide.pages.dev`)
2. Uprav roster a assignmenty
3. Klikni **🔗 Share** → roster se uloží, URL se změní na `?r=abc123`
4. Pošli link guildě — kdokoli může editovat a uložit

---

## Lokální vývoj

```bash
cd worker
wrangler dev   # Worker lokálně na http://localhost:8787
```

Otevři `guide.html` přímo v prohlížeči — volá lokální Worker.

---

## Cena

| Služba | Free tier | Kdy platit |
|--------|-----------|------------|
| Cloudflare Pages | Zdarma | Nikdy pro osobní use |
| Cloudflare Workers | 100K req/den zdarma | Workers Paid $5/měs pokud překročíš |
| KV Storage | 100K čtení / 1K zápisů denně zdarma | Téměř nikdy pro guild use |
