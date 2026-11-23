/* =========================================================
   v2: tedenski RATIO plan (izmišljeni podatki).
   Ena vrstica = ident (manufacturingOrder, npr. 10256182) s tedensko
   potrebo. Kasneje to bere PHP iz RATIO / MFG/PRO.
   ========================================================= */
(function () {

  // art = id artikla (ident), week = tedenska potreba, qtys = privzete količine naloga
  // weekOffset 0 = teden planiranja, 1 = naslednji teden
  // polni nazivi artiklov, kot jih vodi RATIO (samo v2; v1 ostane s kratkimi)
  var NAMES = { 1: 'SX8.1-41', 2: 'SXL8.4-44', 3: 'MK6.5-32', 4: 'TR7.0-38', 5: 'HB7.2-45', 6: 'PX6.6-30' };
  DATA.articles.forEach(function (a) { if (NAMES[a.id]) a.desc = NAMES[a.id]; });

  DATA.ratio = [
    { art: 1, weekOffset: 0, week: 15000, qtys: [1700, 3060] },
    { art: 2, weekOffset: 0, week: 6800,  qtys: [1700, 3060] },
    { art: 3, weekOffset: 0, week: 12240, qtys: [1700, 3060] },
    { art: 4, weekOffset: 0, week: 5100,  qtys: [1700] },
    { art: 5, weekOffset: 0, week: 9180,  qtys: [1700, 3060] },
    { art: 6, weekOffset: 0, week: 6120,  qtys: [1700, 3060] },

    { art: 1, weekOffset: 1, week: 13600, qtys: [1700, 3060] },
    { art: 2, weekOffset: 1, week: 5100,  qtys: [1700, 3060] },
    { art: 3, weekOffset: 1, week: 15300, qtys: [1700, 3060] },
    { art: 4, weekOffset: 1, week: 3400,  qtys: [1700] },
    { art: 5, weekOffset: 1, week: 9180,  qtys: [1700, 3060] },
    { art: 6, weekOffset: 1, week: 4080,  qtys: [1700, 3060] }
  ];

  // notranji ključ vrstice: ident + teden (ni prikazan)
  DATA.ratio.forEach(function (r) {
    var a = DATA.articles.filter(function (x) { return x.id === r.art; })[0];
    r.mo = a.ident + '@' + r.weekOffset;
  });

  /* Medpomnilnik v2: [artikel, igla ali null, količina, prioriteta, sproščen, opomba]
     null = specialist igle še ni dodelil */
  DATA.bufferV2 = [
    [3, null, 3060, 'visoka',   false, 'Kupec čaka – odpremi do petka.'],
    [6, 8,    3060, 'normalna', false, ''],
    [1, null, 1700, 'normalna', false, ''],
    [5, 14,   3060, 'normalna', true,  ''],
    [4, null, 1700, 'normalna', false, '']
  ];
})();
