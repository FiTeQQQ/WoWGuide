# 📋 Raid Guide WoW — Development Summary
**Datum posledního updatu:** 9. červen 2026 (session 4)

---

## 🎮 Co je tento projekt

**WoW Raid Guide** je single-page webová aplikace pro vedení raidu ve World of Warcraft. Slouží jako interaktivní průvodce taktikou pro boss encountery — raid leader nebo officer ji sdílí přes prohlížeč a hráči si ji otevřou na druhém monitoru.

### Co aplikace umí
- **Slidy s obrázky** — každý slide = jedna fáze bosse nebo mechanic. Každý slide může mít více variant obrázku (přepínání tečkami dole), každá varianta má vlastní canvas s kresbami.
- **Canvas editor** — kreslení šipek, kruhů, obdélníků, trojúhelníků, textu přímo přes screenshot z hry. Vkládání hráčských ikon, raid markerů, boss ikon.
- **Roster** — správa hráčů s třídou, specem, rolí, alts. Přiřazování do skupin G1–G4 a custom assignmentů.
- **Edit mode** — přepínatelný, v normálním pohledu je vše read-only pro hráče.
- **Cloud sync** — roster se automaticky syncuje do Cloudflare KV. Slidy a canvas jsou v localStorage.

### Live URL
`https://wowraid.pages.dev`

---

## 🚀 Deploy — jak pushovat změny

**Push vždy dělá uživatel z Windows CMD. Claude nemá přístup ke GitHub credentials.**

```cmd
cd "C:\Users\Filip\Desktop\Claude Projects\RaidGuideWOW"
git add -A
git commit -m "popis změny"
git push
```

Pokud git hlásí `non-fast-forward` (lokální větev je za remote):
```cmd
git push --force
```

Pokud je `.git/refs/heads/main` rozbitý (obsahuje text místo hash) nebo hlásí `fatal: cannot lock ref 'HEAD'`:
```cmd
REM Smaž rozbitné pack soubory které mohl vytvořit sandbox
del ".git\objects\pack\pack-new.pack" 2>nul
del ".git\objects\pack\pack-new.idx" 2>nul
del ".git\objects\pack\pack-new2.pack" 2>nul
REM Pak normální push
git push --force
```

**GitHub repo:** `FiTeQQQ/WoWGuide` branch `main`
**Cloudflare Pages** auto-deploy → živý deploy za ~1 minutu po pushi.

---

## 🔄 ROSTER — Cloud auto-sync

Roster se **automaticky syncuje** do Cloudflare KV při každé změně (přidání/odebrání hráče, změna specu). Žádný ruční export ani GitHub upload.

- **Live URL:** `https://wowraid.pages.dev/api/roster/main`
- **Debounce:** sync se spustí 1.5s po poslední změně
- **Silent fail:** pokud je worker down nebo offline, app funguje normálně z localStorage

### Jak Claude přistoupí k rosteru
V novém chatu stačí říct: *"Načti roster z https://wowraid.pages.dev/api/roster/main"*

### Formát odpovědi z API
```json
{
  "roster": [
    {"id":"...","name":"Jachurdudu","class":"druid","spec":"Balance","specIcon":"https://wow.zamimg.com/...","role":"dps"}
  ],
  "updatedAt": "2026-06-07T10:00:00.000Z"
}
```

### Co se syncuje kde
| Data | Úložiště |
|------|----------|
| Roster (hráči, specs) | Cloudflare KV + localStorage |
| Slidy, obrázky, canvas | **pouze localStorage** |
| Groups (G1–G4), assignments | pouze localStorage |

Tlačítko **⬇ roster.json** v horním panelu funguje pro ruční zálohu.

---

## 🏗️ Architektura

### Soubory
```
index.html          ~7200 řádků, vše inline CSS+JS
summary.md          tento soubor
how_to_deploy.md    instrukce pro Cloudflare deploy
wrangler.toml       Cloudflare Workers config
worker/             Cloudflare Worker — KV store REST API
Icons/              tank.svg, healer.svg, dps.svg
Markers/            star.png, circle.png, diamond.png, ...
Bosses/             boss PNG obrázky
Images/             slide obrázky (1.png až 26.png)
```

---

## 🖼️ Systém variant obrázků (Image Variants)

Každý slide může mít více variant obrázku — každá má vlastní canvas s kresbami.

### Jak funguje
- **⊕ New Image** tlačítko (edit mode) — přidá novou variantu se stejným obrázkem, prázdný canvas. Obrázek pak lze změnit přes 🖼 tlačítko.
- **Přepínání** — tečky dole na obrázku (◀ ●○ ▶), kliknutím nebo šipkami.
- **Smazání varianty** — červené × u aktivní tečky (edit mode).

### Datová struktura
```javascript
images[slideId] = {
  variants: [{src: 'url', label: 'v1'}, {src: 'url2', label: 'v2'}],
  activeIdx: 0,
  defaultIdx: 0
}
variantCanvasData[slideId] = {
  0: [{id, type, x, y, ...}],  // canvas pro variantu 0
  1: []                         // canvas pro variantu 1
}
```

### Klíčové funkce
| Funkce | Popis |
|--------|-------|
| `_imgAddVariant(id)` | Přidá variantu (zkopíruje src aktuální, prázdný canvas) |
| `_imgSwitchVariant(id, idx)` | Přepne variantu (uloží canvas aktuální, načte nový) |
| `_imgDeleteVariant(id, idx)` | Smaže variantu |
| `_imgNormalize(id)` | Normalizuje starý string/main+video formát na variants[] |

---

## 🎨 Canvas Editor — Kompletní přehled

### Toolbar nástroje
| Ikona | Nástroj | Klávesa |
|-------|---------|---------|
| ↖ | Select | S |
| ▭ | Rectangle (kreslí čtverec) | R |
| ◯ | Circle (kreslí kruh) | E |
| ↗ | Arrow | A |
| T | Text | T |
| ▲ | Triangle | — |
| 👤 | Hráč (otevře mini panel) | — |
| ★ | Raid marker | — |
| ☠ | Generic ikony (boss, add, tank...) | — |
| 🗑 | Smaž vybraný objekt | Del |
| ⬆ | Bulk upload obrázků | — |

**Poznámka:** Rect a Circle se kreslí vždy jako čtverec/kruh. Po nakreslení lze roztáhnout do obdélníku/oválu přes resize handles.

### Toolbar chování
- Toolbar je **draggable** — chyť za ⠿ handle a přetáhni
- Props panel se přichytí vlevo od toolbaru
- Při přepnutí na draw/select nástroj se mini panel zavře
- Při otevření mini panelu se props panel skryje

### Mini panely (kliknutí na ikonu v toolbaru)
- **Hráči** — seznam z `roster[]`, search pole, vložení jednoho nebo více najednou
- **Markery** — 8 raid markerů z `Markers/` složky
- **Generic ikony** — Boss, Add, Danger (wowhead), Tank/Heal/DPS (lokální SVG) + GitHub Bosses/ složka + custom URL

### Props panel (Vlastnosti) — kontextový podle typu objektu
| Sekce | Zobrazí se pro |
|-------|---------------|
| Text (volný vstup + barva + vel.) | rect, circle, triangle |
| Fill (barva + alpha) | rect, circle, triangle |
| Border (barva + alpha + šírka) | rect, circle, arrow, text |
| Text (barva + fontSize) | text |
| Vel. (iconSize slider) | player, group, marker, boss |
| Label (Full/2L/— + →/↓) | **pouze player** |
| Barva + alpha + tvar | group/assignment |
| Kruh barva + alpha + text popisek | boss |

### Pravý klik na rect/circle/triangle
Context menu s volbou skupiny:
- **G1–G4** (s barvami #4f8eff, #f87171, #4ade80, #facc15)
- **Assignments** (dynamicky z `assignmentExtras[]`)
- **Odebrat přiřazení**

Po přiřazení se na tvaru zobrazí tooltip s hráči skupiny (spec icon + class-colored name) při hoveru.

---

## 👥 Roster — Groups logika

### G1–G4 přiřazování
- Hráče přiřadíš do skupiny přes assign picker (klik na řádek v rosteru nebo chip)
- Drag & drop mezi skupinami je povolen
- Přiřazení do custom assignments (mimo G1-G4) je volné bez omezení

### Main/Alt konflikt — vizuální indikace
Pokud je Main nebo Alt hráče přiřazený do G1–G4, ostatní členové stejné "rodiny" (main + alti) dostanou v rosteru lehký červený highlight pozadí. Significa: tento hráč nemůže jít do skupiny protože jeho main/alt tam už je.

Logika je v `isGroupBlocked(pid, group)` která vrací:
- `'other_group'` — hráč je v jiné G skupině
- `'alt_conflict'` — main nebo alt je v dané skupině
- `false` — ok

---

## 💾 State & Data

### State variables
```javascript
let canvasData = {};          // {slideId: [{id, type, x, y, w, h, fill, ...}]}
let variantCanvasData = {};   // {slideId: {variantIdx: [objects]}}
let _cvTool = 'select';
let _cvSelSlide, _cvSelId;
let _cvDraw = null;           // právě kreslený objekt
let _cvDrag = null;           // právě táhnutý objekt
let roster = [];              // [{id, name, class, spec, specIcon, role, altOf?}]
let slots = {};               // {exec1:[id,...], exec2:[], ...}
let assignmentExtras = [...]; // [{id, label, color, size}]
let images = {};              // {slideId: {variants, activeIdx, defaultIdx}}
```

### Canvas object formáty
```javascript
// rect/circle/triangle:
{id, type, x, y, w, h, fill, fillA, stroke, strokeA, strokeW,
 shapeText, shapeTextColor, shapeTextSize,
 groupTag, groupColor, assignTag}

// arrow:  {id, type, x1, y1, x2, y2, stroke, strokeA, strokeW}
// text:   {id, type, x, y, text, fontSize, fill, stroke, strokeW}
// player: {id, type, x, y, iconSize(default:25), labelMode, labelLayout, name, cls, showIcon, specIcon}
// marker: {id, type, x, y, iconSize, markerIdx(0-7)}
// boss:   {id, type, x, y, iconSize, bossUrl, bossEmoji, bossName, fill, fillA, bossLabel}
```

### Koordináty
Všechny x, y, w, h jsou v % z rozměrů slidu (0–100). Funguje při resize okna.

### saveState
```javascript
localStorage.setItem('lvg4', JSON.stringify({
  roster, slots, images, assignmentExtras,
  showGroups, groupsLabel, groupsColor, canvasData, variantCanvasData
}));
```

---

## 🎨 Renderování hráčů (buildCvEl player)

### Right layout (default)
Pill tvar: tmavé pozadí `rgba(0,4,20,0.88)`, border v barvě třídy, icon circle vlevo (spec icon), jméno vpravo.

### Below layout
Standalone circle s border + tmavý label pod ním.

### None layout
Jen circle se spec ikonou.

### Barvy tříd (CC object)
```javascript
warrior:'#c79c6e', paladin:'#f58cba', hunter:'#abd473',
rogue:'#fff468', priest:'#ffffff', deathknight:'#c41e3a',
shaman:'#0070de', mage:'#69ccf0', warlock:'#9482c9',
monk:'#00ff98', druid:'#ff7d0a', demonhunter:'#a330c9',
evoker:'#33937f'
```

---

## 🔑 Klíčové funkce

| Funkce | Popis |
|--------|-------|
| `buildCvEl(obj,sel,sid,svg)` | Vytvoří SVG `<g>` pro canvas objekt |
| `renderCvOverlay(sid)` | Překreslí SVG pro jeden slide |
| `syncPropsPanel(obj)` | Naplní props panel hodnotami vybraného objektu |
| `setCvTool(tool)` | Přepne nástroj, zavře mini panel, zobrazí/skryje props |
| `openCvMiniPanel(mode)` | Otevře picker (player/marker/boss), skryje props panel |
| `cvApplyProp(prop, val)` | Změní property vybraného objektu + překreslí |
| `showCvGroupTip(obj, e)` | Tooltip se spec ikonami a jmény hráčů skupiny |
| `showCvCtxMenu(e, obj, sid)` | Pravý klik menu pro přiřazení skupiny |
| `saveState()` | Uloží do localStorage |
| `applyImages()` | Aplikuje `images{}` na slide divy, přidává variant switcher |
| `isGroupBlocked(pid, group)` | Zkontroluje main/alt konflikt pro skupinu |
| `cloneSlide(btn)` | ⊕ New Image — přidá variantu obrázku do aktuálního slidu |

---

## 🌐 URL konstanty
```javascript
GH_IMG_BASE = 'https://raw.githubusercontent.com/fiteqqq/WoWGuide/main/Images/'
// Markers: Markers/{star,circle,diamond,triangle,moon,square,cross,skull}.png
// Icons:   Icons/tank.svg, Icons/healer.svg, Icons/dps.svg
// Bosses:  https://raw.githubusercontent.com/fiteqqq/WoWGuide/main/Bosses/
// Wowhead: https://wow.zamimg.com/images/wow/icons/medium/{name}.jpg
```

---



## 📦 Session 3 — Přehled změn

### Auto cloud sync
- **`_autoCloudSync()`** — po každém `saveState()` debounced (2s) PUT plného payloadu na `?r=` klíč
- **Fallback na boss slug** — `getCloudId()` vrátí `?r=` nebo `_getBossSlug()`. Takže `?boss=lightblinded-vanguard` auto-syncuje do `/api/roster/lightblinded-vanguard` bez nutnosti manuálního uložení
- Forky (`?r=jiny-slug`) jsou oddělené KV záznamy, nepřepisují se navzájem (leda stejným slugem)

### FOUC fix
- `#assignments-panel` má na startu `visibility:hidden` přes inline `<style>` tag v `<head>`
- Po `renderAll()` v `DOMContentLoaded` se odstraní → žádný záblesk starých hardcoded hodnot

---

## 📦 Session 2 — Přehled změn

### UI / UX opravy
- **Variant switcher** — přepínání variant obrázků funguje i v edit mode (šipky a tečky mají z-index 15, nad SVG overlayem na z-index 13)
- **Dot indikátor** — vždy viditelný (opacity 0.65), 14px tečky, zvýrazní se automaticky při interakci
- **Flash animace** — `::after` pseudo-element přes celý slide (rgba modrá fadující za 1.1s) při vytvoření/kopírování varianty
- **v1 ochrana** — první varianta každého slidu nejde smazat (× tlačítko zobrazeno jen pro `activeIdx > 0`)
- **Copy Image** — vedle New Image tlačítka, zkopíruje aktuální variantu včetně canvas dat; obě tlačítka v `.img-btn-group` pill wrapperu
- **Nadpis tlačítko** — opraveno: init loop nyní doplňuje chybějící onclick handlery na hardcoded `rc-add-choice` divech
- **Notes slide 1** — smazána hardcoded note "Lust na pull + Mass Dispel na bubliny"

### Props panel
- **Šipka → Tloušťka** — slider pro `strokeW` šipky (`cvS_arrowWidth`), místo neexistujícího "Border"
- **Boss ikony panel** — swatches v CSS gridu `repeat(8, 16px)`, panel `min-width:270px; max-width:310px`
- **Text styling** — sekce `cvBossLabelStyle` zobrazena pokud je text neprázdný (Barva + Vel. + Outline)

### Groups logika
- **assignPlayer** — hráč může být v G1–G4 pouze jednou; přiřazení do jiné skupiny ho automaticky odebere ze staré

### Dead code cleanup (~126 řádků odstraněno)
- `initImgZoomPan`, `updateImgTransform`, `restoreImgSettings`
- Scale/X/Y toolbar controls
- `downloadHTML` + dlBtn
- 4 `img-hotspot` divů ze slidu 5
- CSS `--img-scale/offset` vars

---

## ⚠️ Známé problémy / omezení

- **Triangle resize handles** — sdílí rect logiku (funguje ale vizuálně handle body neodpovídají rohům trojúhelníku)
- **Font-size v % pro polygon** — SVG `polygon points` nepodporuje %, trojúhelník počítá px přes `getBoundingClientRect()`
- **Toolbar drag** — při prvním chycení čte pozici před odstraněním CSS `transform: translateY(-50%)`
- **Slidy a canvas nejsou v cloudu** — pouze localStorage; při vymazání prohlížeče se ztratí. Pro zálohu použij export tlačítko nebo commit do gitu.
- **Sandbox nemůže commitovat** — git credentials jsou ve Windows Credential Manageru, push vždy dělá uživatel ručně.

---

## 🛠️ Pravidlo: NIKDY nepoužívat Edit tool na index.html

Edit tool **opakovaně truncuje `index.html`** — soubor se zkrátí uprostřed věty, chybí stovky řádků. Projevuje se jako `toggleEditMode is not defined` v konzoli nebo soubor nekončí `</html>`.

### Řešení: vždy Python přes Bash
```python
python3 << 'PYEOF'
with open('/sessions/inspiring-tender-bell/mnt/RaidGuideWOW/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

html = html.replace('STARÝ_TEXT', 'NOVÝ_TEXT')

with open('/sessions/inspiring-tender-bell/mnt/RaidGuideWOW/index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print('Done, lines:', html.count('\n'))
PYEOF
```

### Kontrola po každé změně
```bash
tail -1 /sessions/inspiring-tender-bell/mnt/RaidGuideWOW/index.html  # musí být </html>
wc -l /sessions/inspiring-tender-bell/mnt/RaidGuideWOW/index.html    # musí být ~7000+ řádků
```

### Sandbox cesta k souboru
```
Windows:  C:\Users\Filip\Desktop\Claude Projects\RaidGuideWOW\index.html
Sandbox:  /sessions/inspiring-tender-bell/mnt/RaidGuideWOW/index.html
```
