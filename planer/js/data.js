/* =========================================================
   Izmišljeni podatki za prikaz planerske strani.
   Kasneje to zamenja PHP, ki vrne JSON iz MariaDB.
   ========================================================= */
var DATA = (function () {

  var settings = {
    shiftStarts: [6, 14, 22],      // ure začetka izmen
    shiftStopMin: 20,              // postanek na koncu izmene
    dobDiffThreshold: 3            // nad to razliko se alternativa obarva
  };

  var machines = [
    { id: 1, name: 'Stroj 1', code: 'SK-1', positions: 3, rate: 130, changeoverMin: 30 },
    { id: 2, name: 'Stroj 2', code: 'SK-2', positions: 3, rate: 130, changeoverMin: 30 },
    { id: 3, name: 'Stroj 3', code: 'SK-3', positions: 3, rate: 130, changeoverMin: 30 }
  ];

  var furnaces = [
    { id: 1, name: 'Peč 1' }, { id: 2, name: 'Peč 2' }, { id: 3, name: 'Peč 3' },
    { id: 4, name: 'Peč 4' }, { id: 5, name: 'Peč 5' }, { id: 6, name: 'Peč 6' },
    { id: 7, name: 'Peč 7' }, { id: 8, name: 'Velika peč A' }, { id: 9, name: 'Velika peč B' }
  ];

  var articles = [
    { id: 1, ident: '10256182', desc: 'SX',   rod: 'srednja', qtys: [1700, 3000] },
    { id: 2, ident: '10256190', desc: 'SX-L', rod: 'velika',  qtys: [1700, 2400] },
    { id: 3, ident: '10261544', desc: 'MK2',  rod: 'majhna',  qtys: [1700, 3000, 4500] },
    { id: 4, ident: '10261551', desc: 'TR40', rod: 'srednja', qtys: [1200, 1700] },
    { id: 5, ident: '10270318', desc: 'HB7',  rod: 'velika',  qtys: [1700, 3000] },
    { id: 6, ident: '10270402', desc: 'PX',   rod: 'majhna',  qtys: [2000, 3000] }
  ];

  // status: available | in_machine | in_refurb | retired
  var needles = [
    { id: 1,  name: '5.8', dobMin: 95,  dobMax: 114, status: 'retired',    since: 0,    total: 94200, refurbs: 17, fits: [1] },
    { id: 2,  name: '6.0', dobMin: 98,  dobMax: 118, status: 'in_machine', since: 2100, total: 34100, refurbs: 5,  fits: [1, 2] },
    { id: 3,  name: '6.1', dobMin: 99,  dobMax: 119, status: 'in_machine', since: 7400, total: 7400,  refurbs: 0,  fits: [1, 2] },
    { id: 4,  name: '6.2', dobMin: 100, dobMax: 120, status: 'in_machine', since: 3800, total: 41800, refurbs: 6,  fits: [1, 2, 4] },
    { id: 5,  name: '6.3', dobMin: 101, dobMax: 121, status: 'available',  since: 4600, total: 77600, refurbs: 14, fits: [1, 2] },
    { id: 6,  name: '6.4', dobMin: 103, dobMax: 122, status: 'available',  since: 900,  total: 900,   refurbs: 0,  fits: [1, 4] },
    { id: 7,  name: '6.5', dobMin: 104, dobMax: 124, status: 'in_machine', since: 1200, total: 18200, refurbs: 2,  fits: [3, 6] },
    { id: 8,  name: '6.6', dobMin: 105, dobMax: 125, status: 'in_machine', since: 300,  total: 300,   refurbs: 0,  fits: [3, 6] },
    { id: 9,  name: '6.8', dobMin: 108, dobMax: 129, status: 'in_refurb',  since: 0,    total: 52000, refurbs: 9,  fits: [3] },
    { id: 10, name: '6.9', dobMin: 107, dobMax: 126, status: 'available',  since: 3300, total: 28300, refurbs: 4,  fits: [3, 6] },
    { id: 11, name: '7.0', dobMin: 112, dobMax: 132, status: 'in_machine', since: 2900, total: 22900, refurbs: 3,  fits: [4, 5] },
    { id: 12, name: '7.1', dobMin: 113, dobMax: 133, status: 'in_machine', since: 4950, total: 86950, refurbs: 16, fits: [4, 5] },
    { id: 13, name: '7.2', dobMin: 115, dobMax: 135, status: 'in_machine', since: 1500, total: 11500, refurbs: 1,  fits: [5] },
    { id: 14, name: '7.3', dobMin: 116, dobMax: 136, status: 'available',  since: 4100, total: 64100, refurbs: 11, fits: [4, 5] },
    { id: 15, name: '7.4', dobMin: 118, dobMax: 139, status: 'in_machine', since: 600,  total: 600,   refurbs: 0,  fits: [3, 6] }
  ];

  var planners = ['J. Horvat', 'M. Zupan'];

  /* ---- Nalogi na časovnici: verige po stezah ----
     [stroj, pozicija, [[artikel, igla, količina, opombe?], ...]]
     Prvi nalog v stezi se začne ob začetku simulacije, ostali tečejo takoj za njim. */
  var lanes = [
    [1, 1, [[1, 4, 3000], [1, 4, 3000], [1, 4, 1700], [4, 4, 1700, 'Prva serija nove šarže.'], [4, 4, 1200], [2, 4, 1700]]],
    [1, 2, [[2, 3, 1700], [2, 3, 1700], [1, 3, 3000], [1, 3, 1700], [2, 3, 2400]]],
    [1, 3, [[4, 11, 1700], [4, 11, 1200], [5, 11, 3000], [5, 11, 1700], [5, 11, 1700]]],
    [2, 1, [[3, 7, 4500], [3, 7, 3000], [6, 7, 2000], [6, 7, 3000, 'Kontrola DOB vsakih 45 min.']]],
    [2, 2, [[6, 15, 3000], [6, 15, 2000], [3, 15, 3000], [3, 15, 1700]]],
    [2, 3, [[3, 8, 1700], [3, 8, 1700], [6, 8, 3000, 'Začni po vzdrževanju.', 8]]],  // 5. polje: fiksni začetek (ure od zdaj)
    [3, 1, [[5, 13, 3000], [5, 13, 3000], [5, 13, 1700], [5, 13, 3000]]],
    [3, 2, [[5, 12, 1700], [4, 12, 1700], [4, 12, 1200], [4, 12, 1700], [4, 12, 1700]]],
    [3, 3, [[2, 2, 2400], [2, 2, 1700], [1, 2, 3000], [1, 2, 1700]]]
  ];

  /* Nalogi v medpomnilniku (brez mesta na časovnici) */
  var buffer = [
    [3, 10, 3000, 'visoka', true,  'Kupec čaka – odpremi do petka.'],
    [6, 8,  3000, 'normalna', false, ''],
    [1, 5,  1700, 'normalna', true,  ''],
    [5, 14, 3000, 'visoka', false, 'Nova šarža odkovkov, preveri prvi DOB.'],
    [4, 6,  1700, 'normalna', false, ''],
    [2, 5,  2400, 'normalna', false, ''],
    [3, 10, 1700, 'normalna', false, '']
  ];

  return {
    settings: settings, machines: machines, furnaces: furnaces,
    articles: articles, needles: needles, planners: planners,
    lanes: lanes, buffer: buffer
  };
})();
