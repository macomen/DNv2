# Delovni nalogi – planiranje

Konceptni prikaz sistema delovnih nalogov za oblikovanje notranjega ozobja.
Vse strani uporabljajo izmišljene podatke. Baza (MariaDB) in PHP še nista povezana.

Koncept je opisan v dokumentu `Work Order System for Production – Concept Draft.md`.

## Strani

| Stran | Vsebina |
| --- | --- |
| `planer/index.html` (v1) | Medpomnilnik, obrazec za nov nalog z izbiro igel, časovnica 3 strojev × 3 igle, tedenski pregled |
| `planer/v2.html` (v2) | Nalogi nastanejo iz RATIO plana; iglo kasneje določi specialist; medpomnilnik ob časovnici |
| `planer/v3.html` (v3) | Samo RATIO in delovni nalogi, brez časovnice |

## Zagon

Potreben je PHP (samo kot preprost spletni strežnik):

```powershell
php -S localhost:8090 -t planer
```

Nato odpri http://localhost:8090/index.html, http://localhost:8090/v2.html ali http://localhost:8090/v3.html.

## Tehnologija

- HTML, CSS, JavaScript, jQuery 3.7.1 in jQuery UI 1.14.1 (lokalno v `planer/js/lib`)
- Pisava Archivo (lokalno v `planer/fonts`), stran deluje brez interneta
- Izmišljeni podatki: `planer/js/data.js` (v1, v2) in `planer/js/ratio.js` (RATIO za v2, v3)
