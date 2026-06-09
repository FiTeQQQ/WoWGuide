# WoW Raid Tool – Roadmap & Poznámky

## Současný stav
- Jedna stránka: Lightblinded Vanguard (Voidspire)
- Guide se slides + images
- Assignment tool (skupiny, soakers, baiter)
- Roster s alt/main vazbami
- Share link (dlouhé URL, LZString komprese)
- Hosting: GitHub Pages (fiteqqq.github.io/WoWGuide)

---

## Plánované změny

### 1. Cloudflare migrace (priorita: vysoká)
- Přesun hostingu na Cloudflare Pages (free)
- Cloudflare Workers + KV (free tier) pro:
  - **Krátké share URL** – data uložena v KV, URL ve formátu `/s/abc123`
  - **Push to GitHub button** – nebo Worker přímo ukládá soubory, bez ručního uploadu
- Řeší: zdlouhavý upload roster.json a guide.html, monster share linky

### 2. Multi-boss navigace
- Celý nástroj jako platforma, ne jedna stránka
- Struktura: `Raid > Voidspire > Lightblinded Vanguard` (sidebar/tabs)
- Každý boss = vlastní guide sekce + vlastní assignments (per-boss datový model)
- Časem přibydou další bossi a raidy
- Odhad náročnosti: 1–2 dny

### 3. Drawing Tool (jako raidplan.io / raidstrats.gg)
- Canvas-based nástroj (Fabric.js nebo Konva.js)
- **Background**: odkaz na mapu arény (URL, bez uploadu)
- **Hráčské tokeny**: drag-and-drop z rosteru přímo na mapu
- **Boss ikony**: předdefinované nebo vlastní
- **Základní tvary**: kruh, čtverec, šipka, text label
- **Group linkage**: pojmenuješ kruh "Group 1" → hover ukáže jména hráčů z Group 1
- Napojení na roster (třídy, specy, barvy)
- Save/share stavu (přes Cloudflare KV)
- Nahradí současné statické obrázky uploadované přes GitHub
- Odhad náročnosti: 3–5 dní

---

## Doporučené pořadí
1. **Roster.json re-export** (okamžitý fix – alt vztahy chybí v aktuálním souboru)
2. **Cloudflare setup** (základ pro vše ostatní)
3. **Multi-boss navigace** (správně rozšíří datový model)
4. **Drawing tool** (staví na hotovém rosteru + skupinách)

---

## Technické poznámky
- Alt/main tooltip fix již implementován (encodeShare přidává `altsData` do URL)
- Share link: anon režim načítá roster.json z GitHubu – musí mít `altOf` pole
- Drawing tool nepotřebuje být tak komplexní jako raidplan.io – stačí mapa + tokeny + základní tvary + group hover
