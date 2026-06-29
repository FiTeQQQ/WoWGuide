# RaidGuideWOW — Project Summary & Status

_Poslední update: 2026-06-29_

Guilda **Rapid Evolution EU** (Drak'thul EU, Horde, casual ~30 lidí). Web na **Cloudflare Pages**
z GitHubu `FiTeQQQ/WoWGuide` (branch `main`, auto-deploy). Backend = **Cloudflare Worker + KV**.

## 1. Stránky / soubory
- `index.html` — Armory-style úvodka: guild header, raid progress (Raider.IO), class/role
  breakdown, achievementy, roster table + **rozcestník guides (sezóny → raidy → bossové)**.
- `roster.html` — roster/účast/loot tracker; taby (Main Roster, Loot History, vlastní listy),
  WCL/Raider.IO sloupce, unified „Aktualizovat" + checkboxy.
- `guide.html` — per-boss strategie (slidy, canvas overlay, assignmenty, timeline, prezentace,
  wowhead tooltipy, glass/classic).
- `raid.html` — sdílitelný rozcestník jednoho raidu (`raid.html?raid=<slug>`), společné pozadí.
- `heslo.html` — správa edit hesla (viz Edit-lock).
- `worker/index.js` — Cloudflare Worker (API).
- `Addons/FifakLoot/` — herní addon na logování lootu (**gitignored, nepushovat**).
- `Images/manifest.json` — fallback manifest (formát se migruje na sezóny).
- Pozadí: `Images/<Raid>/<Raid>_Background.jpg`.

Pushe dělá **VŽDY uživatel z Windows CMD**. Prefix `del ".git\index.lock" 2>nul`, pak add/commit/push.
Worker se nasazuje `cd worker && wrangler deploy`.

## 2. Cloud API (https://raidguide-api.filip-tesarik1.workers.dev)
- `GET/PUT /api/roster/:id` — libovolný KV klíč.
- `POST /api/roster` — nová náhodná kopie.
- `GET/PUT /api/spells/:slug` — knihovna spellů pro bosse.
- `GET /api/blizz/guild` — guild header + roster + achievementy + lazy spec fill (Blizzard OAuth).
- `GET /api/rankings` — raid progress (Raider.IO). `GET /api/rio-char` — iLvl + spec + M+ score.
- `GET /api/blizz/itemid` — name→id pro loot tooltipy (jen přesná shoda).
- `GET /api/haspass`, `POST /api/editpass` — správa edit hesla (NOVÉ).
- Klíče: `main`, `trial-roster`, `roster-sheets`, `loot-archive`, `index-cfg` (sezóny/raidy/bossové
  + theme/gradient), guide kopie (`:id`/`spells:*`), `wcl-creds`, `wcl-cfg`, `edit-pass`, cache klíče.
- Secrets: `BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET` (`EDIT_PASSWORD` už jen jako záloha).

## 3. ✅ Edit-lock (poslední fáze) — soft zámek proti kazičům
**Model:** veřejně read-only, edituje se po zadání hesla. Hlavní (kanonické) guidy zamčené,
vlastní sdílené kopie guidů (`?r=<nazev>`) volné.
- **Heslo v KV** (`edit-pass`), mění se z webu na **`/heslo`** (i z jiného PC). Dokud není
  nastaveno, zámek je vypnutý. První heslo = aktivace zámku.
- **Worker** vrací 403 na zápis do „chráněných" klíčů bez hlavičky `X-Edit-Pass`: statické
  (`main`, `index-cfg`, `trial-roster`, `roster-sheets`, `loot-archive`, `wcl-*`), hlavní guidy
  (cloud/slug bossů z `index-cfg`), `spells:*`. Kopie = volné.
- **Stránky:** sdílený gate skript v `<head>`, `window.unlockEdit()` vyžádá heslo a odemkne.
  - index: edit tlačítko **úplně neviditelné** (`.edit-trigger`, opacity 0, hover odhalí).
  - roster: „✏ Edit" → po heslu zapne edit mód.
  - guide: „✏ Edit Mode" → hlavní guide vyžádá heslo, kopie ne (`window.__guideMain`).
  - Modrý odznak „🔓 Edit odemčen" vpravo dole → vede na `/heslo`. `?edit=1` = rychlé odemčení.

### ⚠️ Gotchas (důležité)
- **Cloudflare Pages u tohoto projektu NEBERE `_redirects`** přesměrování → `/guide/admin`
  padalo, `/admin` dělalo ERR_TOO_MANY_REDIRECTS. `_redirects` je teď prázdný. Vždy přímé
  `.html` soubory nebo query (`?edit=1`). Pretty URL `/raid/slug` nepoužívat.
- `admin.html` smazán (`git rm`) — nahrazen `/heslo` (na `/admin` má uživatel zacachovanou smyčku).
- Validace JS: mount `RaidGuideWOW` má cache lag → ověřovat kopií v `outputs` mountu `node --check`.
  Read/Edit/Write je autoritativní.
- WCL třídy mají vlastní číslování (Shaman=9) → `_wclClassMap`. WCL nemá loot data.
- Nepushovat `Addons/` ani `loot-test-export.json`. Žádné credentials do repa.

## 4. roster.html — hotové
- Sdílený roster (`main`), alty přes `altOf` (1:1 řádky), pravý klik (spec/rank/alt/rename/del).
- Ranky default Core/Member/Trial, přejmenovatelné, vlastní barvy, výchozí skrytí, filtr chips.
- **WCL/Raider.IO sloupce jako TYPY:** účast H/M, počet H/M, progress (per-raid `z:<id>`), parse %,
  iLvl, M+ score, rank, note. Unified **„Aktualizovat" + checkboxy** (att/prog/ilvl granularně),
  výběr období (1/2/4/8 týdnů). Progress barvy: full H epic fialová, full M legendary oranžová.
- **Taby/listy:** Main Roster + Loot History (pinned) + vlastní listy (player-linked / free-form),
  pravý klik na tab = kopie. **Duplikace Main Rosteru** jako 1:1 (sloupce jako `d-*` typy).
- **Loot History** (3 pohledy: per-hráč / per-týden / log), import FifakLoot JSON, wowhead tooltipy,
  týden = reset středa, jen guildovní loot, filtry.
- Multi-realm auto-detekce, composition podle rolí, dynamické custom sloupce, glass/classic.
- Ukládání: lokálně hned, cloud na „Uložit" (+auto +beacon); všechna nastavení sdílená přes meta.

## 5. guide.html — relevantní
- Slidy, canvas overlay editor, assignmenty, timeline, prezentace, glass/classic.
- Cloud: `getCloudId()` = `?r=` nebo boss slug. Sdílení („Share"/„Make Copy") = vlastní kopie.
- Rank badge + filtr ze sdílené meta. Spelly per boss (`/api/spells/:slug`).

## 6. FifakLoot (addon, gitignored)
- Gear-only loot (equip-loc filtr), itemID+slot capture, JSON export
  `{ts,itemID,name,quality,slot,boss,raid,player,realm,class,guilded,roll}`, options (`/FL`),
  Need/Greed/Bonus roll detekce přes `C_LootHistory` + `BONUS_ROLL_RESULT`. Guild-only default.

## 7. 🔧 Zbývá dokončit edit-lock (uživatel pushuje)
1. `git add worker\index.js _redirects heslo.html index.html roster.html guide.html`,
   `git rm admin.html`, commit, push.
2. `cd worker && wrangler deploy`.
3. `wowraid.pages.dev/heslo` → nastavit první heslo.
4. Otestovat odemčení (index/roster/guide), veřejně read-only, kopie guidů volné.

## 8. 📋 V plánu (nezačato)
**Discord integrace** (viz `discord-web-propojeni-souhrn.md`, `instrukce-roster.md`):
- A) Web-only: návrhy povýšení Trial→Member→Core dle účasti (WCL) + „inactive" flag.
- B) Discord rank sync (Cron Worker + Discord REST; potřeba Discord app + `roster.json` párování).
- C) Automatizace sloupců „chce mythic" + „heroic signup" přes Raid-Helper API v4 + Discord poll.
- Nutno: vybrat směr, dodat credentials (B/C), potvrdit prahy (member 3–4, core ≥75 % z 6–8,
  inactive 3–4 týdny, „Discord wins").

**Volitelné:** ověřit Need/Greed/Bonus roll detekci ve FifakLoot naživo (Midnight bonus roll).
