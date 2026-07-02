# RaidGuideWOW — Project Summary & Handoff

_Poslední update: 2026-07-02_

Guilda **Rapid Evolution EU** (Drak'thul EU, Horde, casual ~30 lidí). Web na **Cloudflare Pages**
z GitHubu `FiTeQQQ/WoWGuide` (branch `main`, auto-deploy). Backend = **Cloudflare Worker + KV**.

---

## 1. Stránky / soubory
- `index.html` — Armory-style úvodka: guild header, raid progress (Raider.IO), class/role breakdown,
  achievementy, roster tabulka + rozcestník guides (sezóny → raidy → bossové).
- `roster.html` — roster/účast/loot tracker; taby, WCL/Raider.IO sloupce, alty (`altOf`), ranky, loot history.
- `guide.html` — per-boss strategie (slidy, canvas editor, assignmenty, timeline, prezentace, wowhead tooltipy).
- `raid.html` — sdílitelný rozcestník jednoho raidu (`raid.html?raid=<slug>`).
- `heslo.html` — správa edit hesla (`/heslo`).
- `worker/index.js` — Cloudflare Worker (API).
- `Addons/` — herní addony (FifakLoot atd.), **gitignored, nepushovat**.

**Pushe dělá VŽDY uživatel z Windows CMD** — a MUSÍ být ve správné složce repa
(`cd /d "C:\Users\Filip\Desktop\Claude Projects\RaidGuideWOW"`), jinak `git` hlásí
`fatal: not a git repository` a nic se nenahraje. Worker: `cd worker && wrangler deploy`.

---

## 2. Cloud API (https://raidguide-api.filip-tesarik1.workers.dev)
- `GET/PUT /api/roster/:id` — libovolný KV klíč.
- `POST /api/roster` — nová náhodná kopie.
- `GET/PUT /api/spells/:slug` — knihovna spellů pro bosse.
- `GET /api/blizz/guild` — guild header + roster + achievementy + lazy spec fill (Blizzard OAuth).
- `GET /api/rankings` (Raider.IO progress), `GET /api/rio-char` (iLvl + spec + M+), `GET /api/blizz/itemid`.
- `GET /api/haspass`, `POST /api/editpass` — správa edit hesla.
- Chráněné klíče (zápis vyžaduje hlavičku `X-Edit-Pass`): `main`, `index-cfg`, `trial-roster`,
  `roster-sheets`, `loot-archive`, `wcl-*`, `blizz-*`, `edit-pass`, **`group-templates`**,
  + hlavní guidy (cloud/slug bossů z `index-cfg`) a `spells:*`. Kopie a `asgn-*` = volné.
- Secrets: `BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET`.

---

## 3. Edit-lock model
- Veřejně **read-only**, edituje se po zadání hesla (uloženo v KV `edit-pass`, mění se na `/heslo`).
- Hlavní (kanonické) guidy zamčené; **vlastní sdílené kopie (`?r=<nazev>`) volné**.
- Odemčení: klik na Edit (guide/timeline) vyžádá heslo → uloží se do `sessionStorage` na celou session
  (do hard refreshe). `?edit=1` = rychlé odemčení.
- **Divák není nikdy dotazován na heslo** — na pozadí (auto-sync) se do chráněného klíče nezapisuje;
  heslo se vyžádá jen při **ručním** uložení (Ctrl+S / Uložit) a při 403 se jednou zopakuje.

---

## 4. Assignmenty (guide.html) — architektura ukládání
- Assignmenty (groupy/bench/kategorie/sloty) jsou provozní data → ukládají se **bez hesla**.
- Hlavní guide: assignmenty jdou do samostatného **nechráněného** klíče `asgn-<cloudId>`
  (auto-sync přes `saveState`). Při načtení hlavního guidu jsou z `asgn-` zdrojem pravdy.
- **Kopie (`?r=`) asgn side-channel NEpoužívají** — mají assignmenty ve vlastním (nechráněném) payloadu.
- **Fork/Share** natáhne aktuální assignmenty přímo z cloudu (`<cloudId>` + `asgn-<cloudId>`) do payloadu
  kopie (`_mergeAsgnIntoPayload`), aby byla kopie soběstačná (jinak by měla prázdné groupy).

---

## 5. Co bylo hotové v této fázi (guide.html + worker)

### Assignments sekce
- Pravý klik na hráče v rosteru: přibylo **Přejmenovat** (jako v roster.html).
- **Šablony group (pre-groupy):** neomezené pojmenované šablony rozdělení do Group, **globální napříč bossy**,
  cloud-synced (klíč `group-templates`). Uložit aktuální / načíst / smazat (tlačítko „▦ Šablony").
- **Bench** — přepínatelná sekce pro lidi navíc, pevně **první kategorie hned pod Groups**.
- **Dynamický počet group 1–6** (flex mythic až 25–30 lidí) — tlačítka `− N×G +` v hlavičce Groups.
- **Posouvání kategorií** ▲▼ v edit módu.
- **Filtr** má „In group" / „No group".

### Canvas editor
- **Sloučený plovoucí toolbar** (dřív markerBar + canvasBar) — jeden přetahovatelný panel, dva odlišené
  řádky: **Text** (markery, Spelly, nadpisy/obsah velikosti) a **Malování** (tvary, hráč, marker, boss, spell…),
  „✓ Done Editing" v rohu. Výchozí pozice nahoře na střed.
- **Klávesové zkratky nástrojů (S/R/C/A/T) odstraněny** (nástroje se klikají myší). Delete, Ctrl+C/V, Esc zůstaly.
- **Fix rotace:** otočený tvar už při přesunu „neuskakuje" — rotace se počítá kolem středu tvaru (ne bbox vč. handlů).
- **Grupování elementů:** multi-výběr **Shift+klik**, pravý klik → menu (Seskupit / Zrušit skupinu /
  Zamknout / Odemknout / Kopírovat / Smazat / u rect+circle „Přiřadit tag"). Grupa se hýbe společně,
  copy/paste přenese celou grupu (i na jiný slide, nové ID), **zámek** brání omylnému pohybu.

### Timeline
- **Boss tag řídí i barvu textu** a má **nezávislou barvu textury a textu** (např. modrá textura, zelený text).
  Boss přepisuje manuální nastavení.
- **Hromadné úpravy:** checkboxy u řádků (+ vybrat vše), lišta „🎨 Textura/barva" a „🅰 Barva textu"
  aplikuje na všechny vybrané; jednotlivá úprava řádku přepíše hromadnou; výběr se ruší při vypnutí editu.
- Stripe textura průhlednější; boss změny se **auto-syncují** do cloudu.

### Prezentace / slidy / poznámky
- **Šipky variant slidu** viditelné i bez najetí myší; prezentační boční šipky odstraněny (naviguje se
  spodními tlačítky + ←/→).
- **Zámek tlačítko** (Lock & Share přepínač) z horní lišty odstraněno.
- **Tooltip altů** má vždy neprůhledné pozadí; bez altů se nezobrazuje prázdná sekce.
- **Poznámky — vkládání wowhead spellu:** kopírování spell chipu se vloží 1:1 i s ikonou a odkazem.
- **Ctrl+S** ukládá do cloudu (v timeline uloží timeline). Ctrl+E přepíná edit.

### Worker
- `group-templates` přidán mezi chráněné klíče (zápis vyžaduje heslo). Vyžaduje `wrangler deploy`.

### Gotchas z této fáze
- Cloudflare Pages nebere `_redirects` → jen přímé `.html` / `?edit=1`.
- Sandbox mount měl občas cache lag → JS se ověřoval přes `node --check`.
- Kopie vzniklé před opravou asgn/fork jsou prázdné → přepsat novým Share pod stejným názvem.

---

## 6. roster.html — hotové (starší)
- Sdílený roster (`main`), alty přes `altOf` (1:1 řádky), pravý klik (spec/rank/alt/rename/del).
- Ranky Core/Member/Trial (přejmenovatelné, barvy, filtr). WCL/Raider.IO sloupce jako typy
  (účast H/M, počet, progress, parse %, iLvl, M+ score), unified „Aktualizovat" + checkboxy.
- Taby/listy, Loot History (import FifakLoot JSON), multi-realm, glass/classic.

---

## 7. ZADÁNÍ — Design rosteru a ranků (dřív `instrukce-roster.md`)

**Filozofie:** casual guilda, ~30 lidí, nábor aktivním oslovováním. **Ranky jsou za účast a setrvání
(tenure + pravidelnost), NE za výkon** — cíl nikoho neodrazovat. Roster nemá soudit, ale **navrhovat**
a zbytek automatizovat.

**Pipeline ranků:** Applicant/Rekrut → **Trial** → **Member** → **Core**.
- Trial → Member: odraidil pár raidů (návrh **3–4**), bez dalšího hodnocení.
- Member → Core: pravidelná účast (návrh **≥ 75 % z posledních 6–8 raidů**).

**Účast** = reálná přítomnost ve **WCL logu** (ne přihláška v Raid-Helperu; log nelže). U trialu se počítá
od jeho příchodu. WCL guild log se natahuje (~6 týdnů).

**Žádný auto-demote** — jen jemný **`inactive` flag** (návrh práh 3–4 týdny bez raidu): člověk drží rank,
jen vypadne z aktivních statistik, po návratu bez cirkusu.

**Zdroj pravdy = Discord, web zrcadlí + navrhuje.** Promote dělá officer rolí na Discordu; Cron Worker
role čte a propisuje na web. Web rank **nikdy nenastavuje sám**, jen navrhuje („85 % účast → navrhni core").
Smyčka: web radí → Discord rozhoduje → web zrcadlí. Konflikt: **„Discord vždy vyhrává"** (doporučeno).

**Sync detaily:** mapovat přes **role ID** (ne název); víc rolí → přednost (core > member); odchod z Discordu
→ `inactive`, nemazat; nenapárovaný → „nenapárovaný". Párování přes **Discord user ID** (stálé), ne přezdívku;
zatím ručně (`roster.json`: Discord ID → main + alts + rank).

**Layout rosteru:** NEdělit core/member (sdílí sloupce). Dva pohledy — **Hlavní roster** (core+member jako
adresář) + **Trial tracker** (rozhodovací sloupce: Od / Trial raidy / Účast / Návrh). Promote = přesun řádku
mezi tabulkami. Nedělat expandovatelné řádky.

**K rozhodnutí (prahy):** member 3–4? core ≥75 % z 6–8? inactive 3–4 týdny? konflikt Discord-wins vs override?
layout dva pohledy vs jedna stránka se sekcemi?

---

## 8. ZADÁNÍ — Propojení Discord ↔ web (dřív `discord-web-propojeni-souhrn.md`)

**Cíl:** postupně automatizovat data dělaná ručně. Stack vše zdarma: Cloudflare Pages (web),
Workers (serverless logika, 100k req/den), Cron Triggers (5/účet, polling), D1/KV (úložiště),
Raid-Helper API v4 (přihlášky), Battle.net OAuth (ověření postav — na později),
volitelně Oracle Cloud Always Free (always-on gateway bot).

**A) Párování Discord ↔ postava:** klíč = **Discord user ID (snowflake)**, ne přezdívka. Jeden user = N postav.
Model `roster.json`: `{ "<discordId>": { main, alts:[], role } }`. Vytvoření: ručně (zvolená cesta pro teď),
později slash `/link` nebo Battle.net OAuth (auto import altů + ověření vlastnictví).

**B) Sync rolí member/core:** Discord Gateway (event GUILD_MEMBER_UPDATE) Workers neumí držet →
**Cron Worker polling** `GET /guilds/{id}/members` každých pár minut, porovná role, propíše (doporučeno, zdarma).
Alternativa: gateway bot na always-on hostu (Oracle Free) pro real-time.

**C) Automatizace tabulky (hlavní cíl):** sloučit „chce mythic" (Discord anketa) + „přihlásil na heroic test"
(Raid-Helper) do tabulky s checkboxy. **Spojovací klíč = Discord user ID.**
- Raid-Helper: `GET https://raid-helper.xyz/api/v4/events/{EVENTID}` (bez autorizace, vrací `userId`, třídu,
  spec, role, **status** = signed/absence/…). Server-scoped endpointy chtějí API klíč (`/apikey` v Discordu).
  Webhooky umí push při create/update/delete eventu.
- Discord nativní anketa: `GET /channels/{ch}/polls/{msg}/answers/{answer_id}` (nesmí být anonymní,
  finální po uzavření, potřeba message ID + bot token). Pro pravidelný intent zvážit poll bota / Raid-Helper.
- Výstup: `[{jmeno, chce_mythic:bool, test_heroic:bool}]` — čte tabulka na webu. Join přes Discord ID
  funguje i když se někdo přihlásí altem.

**Přejmenování projektu (pozn.):** `.pages.dev` subdoménu ani název Pages projektu NELZE přejmenovat →
vytvořit nový Pages projekt ze stejného repa (např. `evolution-eu`), starý nechat s redirectem. Časem vlastní doména.

**Doporučené pořadí:** 1) ruční `roster.json` (Discord ID → main+alts+role); 2) Worker slévající
Raid-Helper event + anketu proti rosteru → JSON pro tabulku; 3) Cron sync rolí; 4) později Battle.net OAuth
+ Raid-Helper webhook místo ručních ID.

---

## 9. V plánu (nezačato)
- Discord integrace dle sekcí 7–8 (vybrat směr, dodat Discord/Raid-Helper credentials, potvrdit prahy).
- Interaktivnější guild roster na index.html (agregace altů pod maina, přejmenování generických ranků
  přes mapování v `index-cfg`, řazení/filtr/skupiny) — vše jako prezentační vrstva nad `_guild.members`,
  bez zásahu do dotahování z Armory.
