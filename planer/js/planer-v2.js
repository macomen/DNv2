/* =========================================================
   Planiranje v2 · Delovni nalogi
   Novo: nalogi nastanejo iz RATIO plana, iglo določi specialist.
   Vsa logika je zaenkrat v brskalniku z izmišljenimi podatki.
   Kasneje: izračun plana v PHP (pogl. 8.4), tukaj samo prikaz.
   ========================================================= */
$(function () {
  'use strict';

  var S = DATA.settings;
  var MIN = 60000, HOUR = 3600000, DAY = 86400000;
  var DAYS = ['ned', 'pon', 'tor', 'sre', 'čet', 'pet', 'sob'];
  var DAYS_LONG = ['nedelja', 'ponedeljek', 'torek', 'sreda', 'četrtek', 'petek', 'sobota'];

  var NOW = floorMin(Date.now());
  var SIM_START = NOW - 70 * HOUR;
  var SIM_DAYS = 16;
  // teden planiranja: ob sobotah in nedeljah se planira naslednji teden
  var PLAN_WEEK = (function () { var d = new Date(NOW).getDay(), ws = weekStartOf(NOW); return d === 0 || d === 6 ? ws + 7 * DAY : ws; })();

  var ART = index(DATA.articles), NDL = index(DATA.needles), MACH = index(DATA.machines), FURN = index(DATA.furnaces);

  var STATUS = {
    planned:           { lbl: 'Planiran',            color: 'var(--st-planned)', step: 0 },
    released:          { lbl: 'Sproščen',            color: 'var(--st-released)', step: 1 },
    in_production:     { lbl: 'V proizvodnji',       color: 'var(--st-running)', step: 2 },
    waiting_hardening: { lbl: 'Čaka na kaljenje',    color: 'var(--st-done)', step: 3 },
    hardening:         { lbl: 'V kaljenju',          color: 'var(--st-done)', step: 4 },
    classification:    { lbl: 'Klasifikacija odprta', color: 'var(--st-done)', step: 5 },
    closed:            { lbl: 'Zaključen',           color: 'var(--ink)', step: 6 },
    cancelled:         { lbl: 'Preklican',           color: 'var(--st-now)', step: -1 }
  };
  var FLOW = ['Planiran', 'Sproščen', 'V proizvodnji', 'Čaka na kaljenje', 'V kaljenju', 'Klasifikacija odprta', 'Zaključen'];
  var NEEDLE_ST = { available: 'Na voljo', in_machine: 'V stroju', in_refurb: 'Na obnovi', retired: 'Izločena' };

  var orders = [];
  var changeovers = [];
  var nextNo = 1001;
  var state = {
    weekStart: 0,
    machine: 0,
    pph: 14,
    selected: null,
    search: '',
    ratioOff: 0,
    mo: null,
    genQty: null,
    genOther: 0
  };

  /* ================= pomožne ================= */
  function index(arr) { var m = {}; arr.forEach(function (x) { m[x.id] = x; }); return m; }
  function floorMin(t) { return Math.floor(t / MIN) * MIN; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtN(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function fmtT(t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmtD(t) { var d = new Date(t); return DAYS[d.getDay()] + ' ' + d.getDate() + '. ' + (d.getMonth() + 1) + '.'; }
  function fmtDT(t) { return t == null ? '—' : fmtD(t) + ' ' + fmtT(t); }
  function fmtDur(ms) {
    var m = Math.round(ms / MIN), h = Math.floor(m / 60);
    return h + ' h ' + pad(m % 60) + ' min';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function weekStartOf(t) {
    var d = new Date(t); d.setHours(0, 0, 0, 0);
    var dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow);
    return d.getTime();
  }
  function isoWeek(t) {
    var d = new Date(t); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    var w1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - w1) / DAY - 3 + (w1.getDay() + 6) % 7) / 7);
  }
  function weekLabel(ws) {
    var a = new Date(ws), b = new Date(ws + 6 * DAY);
    return 'Teden ' + isoWeek(ws) + ' · ' + a.getDate() + '. ' + (a.getMonth() + 1) + '. – ' + b.getDate() + '. ' + (b.getMonth() + 1) + '. ' + b.getFullYear();
  }
  function shiftOf(t) {
    var h = new Date(t).getHours();
    return h >= 6 && h < 14 ? '1. izmena · 6–14' : h >= 14 && h < 22 ? '2. izmena · 14–22' : '3. izmena · 22–6';
  }
  function artLabel(a) { return a.ident + ' ' + a.desc; }
  function needleRemaining(n) {
    var cycle = n.refurbs === 0 ? 10000 : 5000;
    return { refurb: Math.max(0, cycle - n.since), cycle: cycle, life: Math.max(0, 90000 - n.total) };
  }
  function dobDiff(a, b) { return Math.max(Math.abs(a.dobMin - b.dobMin), Math.abs(a.dobMax - b.dobMax)); }
  function needleUsable(n) { return n.status === 'available' || n.status === 'in_machine'; }
  function find(id) { for (var i = 0; i < orders.length; i++) if (orders[i].id === id) return orders[i]; return null; }
  function user() { return 'J. Horvat'; }
  function log(o, text, extra) { o.history.unshift($.extend({ at: Date.now(), who: user(), text: text }, extra || {})); }

  /* ================= izdelava podatkov ================= */
  function mkOrder(artId, needleId, qty, opts) {
    var art = ART[artId], n = needleId ? NDL[needleId] : null;
    var alts = !n ? [] : DATA.needles.filter(function (x) {
      return x.id !== needleId && x.fits.indexOf(artId) >= 0 && needleUsable(x);
    }).sort(function (a, b) { return dobDiff(a, n) - dobDiff(b, n); }).slice(0, (qty % 2) + 1).map(function (x) { return x.id; });
    return $.extend({
      id: 0, article: artId, qty: qty, needle: needleId, alts: alts,
      rod: art.rod, prio: 'normalna', batch: '', furnace: null, notes: '',
      locked: false, cancelled: false, started: false,
      createdBy: DATA.planners[qty % 2], createdAt: SIM_START - DAY,
      needleAge: n ? n.total : null, mo: null, slot: null, lagMin: 0, extraMin: 0, history: []
    }, opts || {});
  }

  function build() {
    var tmp = [];
    DATA.lanes.forEach(function (l) {
      l[2].forEach(function (it, i) {
        var o = mkOrder(it[0], it[1], it[2], { notes: it[3] || '', locked: true });
        var fixed = it[4] != null;
        o.slot = { machine: l[0], lane: l[1], seq: i, chain: i > 0 && !fixed, anchor: fixed ? NOW + it[4] * HOUR : SIM_START };
        o.batch = (i + l[0]) % 3 === 0 ? 'K-26-' + (412 + i * 7 + l[1]) : '';
        tmp.push(o);
      });
    });
    orders = tmp;
    simulate(true);
    // številke nalogov po vrstnem redu začetka
    orders.sort(function (a, b) { return (a._start || 9e15) - (b._start || 9e15); });
    orders.forEach(function (o) {
      o.id = nextNo++;
      o.createdAt = (o._start || NOW) - 2 * DAY;
      o.history.push({ at: o.createdAt, who: o.createdBy, text: 'Nalog ustvarjen' });
      o.history.unshift({ at: o.createdAt + 3 * HOUR, who: o.createdBy, text: 'Sproščen in zaklenjen' });
    });
    // povezava z RATIO: ident + teden začetka
    orders.forEach(function (o) {
      var off = o._start == null ? 0 : Math.floor((o._start - PLAN_WEEK) / (7 * DAY));
      var r = DATA.ratio.filter(function (x) { return x.art === o.article && x.weekOffset === off; })[0];
      o.mo = r ? r.mo : ART[o.article].ident + '@' + off;
    });
    DATA.bufferV2.forEach(function (b, i) {
      var o = mkOrder(b[0], b[1], b[2], { prio: b[3], locked: b[4], notes: b[5], createdBy: 'J. Horvat', createdAt: NOW - (8 - i) * 3 * HOUR });
      o.id = nextNo++;
      o.mo = DATA.ratio.filter(function (x) { return x.art === o.article && x.weekOffset === 0; })[0].mo;
      o.history.push({ at: o.createdAt, who: o.createdBy, text: 'Nalog ustvarjen iz RATIO (' + ratioLabel(o.mo) + ')' });
      if (o.needle) o.history.unshift({ at: o.createdAt + 2 * HOUR, who: 'T. Kralj (specialist)', text: 'Dodeljena igla ' + NDL[o.needle].name });
      if (o.locked) o.history.unshift({ at: o.createdAt + HOUR, who: o.createdBy, text: 'Sproščen in zaklenjen' });
      orders.push(o);
    });
    // en nalog zaostaja za planom
    var late = orders.filter(function (o) { return o.slot && o.slot.machine === 1 && o.slot.lane === 1 && status(o) === 'in_production'; })[0];
    if (late) late.lagMin = 45;
  }

  /* ================= izračun plana (simulacija po minutah) ================= */
  var stopArr = null;
  function buildStops() {
    var n = SIM_DAYS * 1440;
    stopArr = new Uint8Array(n);
    var starts = S.shiftStarts.map(function (h) { return h * 60; });
    for (var i = 0; i < n; i++) {
      var d = new Date(SIM_START + i * MIN), m = d.getHours() * 60 + d.getMinutes();
      for (var k = 0; k < starts.length; k++) {
        var a = (starts[k] - S.shiftStopMin + 1440) % 1440;
        if (m >= a && m < starts[k]) { stopArr[i] = 1; break; }
      }
    }
  }
  function isStopAt(t) { var i = Math.floor((t - SIM_START) / MIN); return i >= 0 && i < stopArr.length && stopArr[i] === 1; }

  function simulate(initial) {
    if (!stopArr) buildStops();
    changeovers = [];
    orders.forEach(function (o) { o._start = o._end = o._prodStart = o._doneNow = null; o._co = false; });
    DATA.machines.forEach(function (m) { simMachine(m, initial); });
    orders.forEach(function (o) { if (o._start != null && o._start <= NOW) o.started = true; });
  }

  function simMachine(m, initial) {
    var N = SIM_DAYS * 1440, nowIdx = Math.floor((NOW - SIM_START) / MIN), perMin = m.rate / 60;
    var lanes = [];
    for (var p = 1; p <= m.positions; p++) {
      lanes.push({
        p: p, idx: 0, state: 'idle', cur: null, prev: null, rem: 0, co: null,
        items: orders.filter(function (o) { return o.slot && !o.cancelled && o.slot.machine === m.id && o.slot.lane === p; })
                     .sort(function (a, b) { return a.slot.seq - b.slot.seq; })
      });
    }
    var co = null;
    for (var i = 0; i < N; i++) {
      var t = SIM_START + i * MIN;
      if (co && t >= co.end) co = null;
      lanes.forEach(function (L) { if (L.state === 'co' && t >= L.co.end) { L.state = 'prod'; L.cur._prodStart = t; } });
      var stop = stopArr[i] === 1;
      if (!stop) {
        lanes.forEach(function (L) {
          if (L.state !== 'idle' || L.idx >= L.items.length) return;
          var o = L.items[L.idx];
          var earliest = o.slot.chain ? 0 : o.slot.anchor;
          if (!initial && !o.started) earliest = Math.max(earliest, NOW);
          if (t < earliest) return;
          var need = !L.prev || !o.needle || !L.prev.needle || L.prev.needle !== o.needle || L.prev.article !== o.article;
          if (need) {
            if (co && co.start === t) { co.lanes.push(L.p); }       // hkratni preklop – isti 30 min
            else if (co) return;                                      // počaka, da se preklop konča
            else { co = { machine: m.id, start: t, end: t + m.changeoverMin * MIN, lanes: [L.p], orders: [] }; changeovers.push(co); }
            co.orders.push(o); L.state = 'co'; L.co = co; o._co = true;
          } else { L.state = 'prod'; o._prodStart = t; }
          L.cur = o; o._start = t; L.rem = o.qty + o.extraMin * perMin; L.init = L.rem;
        });
      }
      var running = !stop && !co;
      if (i === nowIdx) {
        lanes.forEach(function (L) {
          if (!L.cur) return;
          var extra = L.cur.extraMin * perMin;
          L.cur._doneNow = Math.max(0, Math.min(L.cur.qty, (L.init - L.rem) - extra));
        });
      }
      if (running) {
        lanes.forEach(function (L) {
          if (L.state !== 'prod') return;
          L.rem -= perMin;
          if (L.rem <= 1e-9) { L.cur._end = t + MIN; L.prev = L.cur; L.cur = null; L.state = 'idle'; L.idx++; }
        });
      }
    }
  }

  function status(o) {
    if (o.cancelled) return 'cancelled';
    if (o.slot && o._start != null && o._start <= NOW) {
      if (o._end != null && o._end <= NOW) {
        var ago = NOW - o._end;
        return ago > 50 * HOUR ? 'closed' : ago > 30 * HOUR ? 'classification' : ago > 10 * HOUR ? 'hardening' : 'waiting_hardening';
      }
      return 'in_production';
    }
    return o.locked ? 'released' : 'planned';
  }
  function barClass(o) {
    var s = status(o);
    if (s === 'in_production') return 'st-running';
    if (s === 'planned') return 'st-planned';
    if (s === 'released') return 'st-released';
    return 'st-done';
  }
  function laneItems(machine, lane, except) {
    return orders.filter(function (o) { return o !== except && o.slot && !o.cancelled && o.slot.machine === machine && o.slot.lane === lane; })
                 .sort(function (a, b) { return a.slot.seq - b.slot.seq; });
  }
  function machineStateAt(mId, t) {
    if (isStopAt(t)) return { stopped: true, text: 'Postanek izmene' };
    for (var i = 0; i < changeovers.length; i++) {
      var c = changeovers[i];
      if (c.machine === mId && t >= c.start && t < c.end) return { stopped: true, text: 'Preklop' };
    }
    var run = orders.some(function (o) { return o.slot && o.slot.machine === mId && status(o) === 'in_production'; });
    return run ? { stopped: false, text: 'Teče' } : { stopped: true, text: 'Prosto' };
  }

  /* ================= akcije ================= */
  function place(o, machine, lane, t) {
    if (o.started) { toast('Ni mogoče', 'Nalog ' + o.id + ' se že izvaja.'); return; }
    t = Math.round(t / (10 * MIN)) * 10 * MIN;
    if (t < NOW) t = Math.ceil(NOW / (10 * MIN)) * 10 * MIN;
    var items = laneItems(machine, lane, o);
    var idx = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i], st = it._start != null ? it._start : it.slot.anchor;
      if (it.started || st <= t) idx = i + 1;
    }
    var prev = items[idx - 1];
    var chain = !!(prev && (prev._end == null || t <= prev._end + 60 * MIN));
    var wasOn = o.slot ? MACH[o.slot.machine].name + ' / P' + o.slot.lane : null;
    o.slot = { machine: machine, lane: lane, chain: chain, anchor: t, seq: 0 };
    items.splice(idx, 0, o);
    items.forEach(function (x, k) { x.slot.seq = k; });
    log(o, (wasOn ? 'Premaknjen z ' + wasOn + ' na ' : 'Postavljen na ') + MACH[machine].name + ' / P' + lane + (chain ? ' (takoj za nalogom ' + prev.id + ')' : ' ob ' + fmtDT(t)));
    simulate();
    state.selected = o.id;
    renderAll();
    var ctext = o._co ? ' · s preklopom 30 min' : ' · brez preklopa';
    toast('Nalog ' + o.id + ' na časovnici', MACH[machine].name + ' / P' + lane + ': ' + fmtDT(o._start) + ' → ' + (o._end ? fmtDT(o._end) : 'izven obsega') + ctext);
    flashBar(o.id);
  }

  function unschedule(o) {
    if (o.started) { toast('Ni mogoče', 'Nalog ' + o.id + ' se že izvaja.'); return; }
    var items = laneItems(o.slot.machine, o.slot.lane, o);
    log(o, 'Odstranjen s časovnice (' + MACH[o.slot.machine].name + ' / P' + o.slot.lane + ')');
    o.slot = null;
    items.forEach(function (x, k) { x.slot.seq = k; });
    simulate(); renderAll();
    toast('Nazaj v medpomnilniku', 'Nalog ' + o.id + ' nima več mesta na časovnici. Naslednji nalogi so preračunani.');
  }

  function release(o) {
    o.locked = true; log(o, 'Sproščen in zaklenjen');
    renderAll(); toast('Nalog ' + o.id + ' sproščen', 'Spremembe so odslej možne le z razlogom.');
  }

  function confirmShift(o) {
    var lag = o.lagMin;
    o.extraMin += lag; o.lagMin = 0;
    log(o, 'Potrjen premik plana +' + lag + ' min (zaostanek v proizvodnji)');
    simulate(); renderAll();
    toast('Plan premaknjen', 'Nalogi za ' + o.id + ' na ' + MACH[o.slot.machine].name + ' so premaknjeni za ' + lag + ' min. Zapisano v zgodovino.');
  }

  /* ================= izris: hero ================= */
  function renderHero() {
    var ws = weekStartOf(NOW);
    var buf = orders.filter(function (o) { return !o.slot && !o.cancelled; });
    var run = orders.filter(function (o) { return status(o) === 'in_production'; });
    var done = 0, planned = 0;
    orders.forEach(function (o) {
      if (!o.slot || o.cancelled) return;
      if (o._end != null && o._end <= NOW && o._end >= NOW - 7 * DAY) done += o.qty;
      else if (status(o) === 'in_production') done += Math.max(0, o._doneNow - o.lagMin * 130 / 60);
      if (!o.started && o._start != null && o._start < NOW + 7 * DAY) planned += o.qty;
    });
    var high = buf.filter(function (o) { return o.prio === 'visoka'; }).length;
    var mach = {}; run.forEach(function (o) { mach[o.slot.machine] = 1; });
    $('#kpi-buffer').text(buf.length);
    $('#kpi-buffer-sub').html(high ? '<span style="color:var(--molten-2)">' + high + ' visoka prioriteta</span>' : 'brez nujnih');
    $('#kpi-running').text(run.length);
    $('#kpi-running-sub').text('na ' + Object.keys(mach).length + ' od ' + DATA.machines.length + ' strojev');
    var noNeedle = orders.filter(function (o) { return !o.cancelled && !o.needle; });
    $('#kpi-noneedle').text(noNeedle.length);
    $('#kpi-noneedle').next().next().text(noNeedle.filter(function (o) { return o.slot; }).length + ' že na časovnici · specialist');
    $('#hero-week').text('Planiranje · ' + weekLabel(PLAN_WEEK));
  }

  /* ================= izris: medpomnilnik ================= */
  function renderBuffer() {
    var q = state.search.toLowerCase();
    var list = orders.filter(function (o) { return !o.slot && !o.cancelled; });
    $('#buffer-count').text(list.length);
    list = list.filter(function (o) {
      if (!q) return true;
      var a = ART[o.article];
      return (o.id + ' ' + a.ident + ' ' + a.desc + ' ' + needleText(o)).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return (a.prio === 'visoka' ? 0 : 1) - (b.prio === 'visoka' ? 0 : 1) || a.id - b.id; });
    var $l = $('#buffer-list').empty();
    if (!list.length) { $l.append('<li class="buffer-empty">Ni nerazporejenih nalogov.</li>'); return; }
    list.forEach(function (o) {
      var a = ART[o.article];
      var cls = 'bcard' + (o.prio === 'visoka' ? ' is-high' : '') + (o.locked ? ' is-released' : '') + (state.selected === o.id ? ' selected' : '');
      $l.append(
        '<li class="' + cls + '" data-id="' + o.id + '">' +
          '<div class="bcard-top"><span class="bcard-no">' + o.id + '</span>' +
          '<span class="bcard-art">' + esc(artLabel(a)) + '</span><span class="spacer"></span>' +
          (o.prio === 'visoka' ? '<span class="tag tag-high">Visoka</span>' : '') +
          (o.locked ? '<span class="tag tag-lock">Sproščen</span>' : '') + '</div>' +
          '<div class="bcard-meta">' + needleBadge(o) + '<span><b>' + fmtN(o.qty) + '</b> kos</span><span>RATIO <b>' + ratioLabel(o.mo, true) + '</b></span>' +
          '<span>≈ ' + fmtDur(o.qty / 130 * HOUR) + '</span>' +
          (o.machinePref ? '<span>→ <b>' + MACH[o.machinePref].name + '</b></span>' : '') + '</div>' +
        '</li>');
    });
    $l.find('.bcard').draggable({
      helper: 'clone', appendTo: 'body', zIndex: 1000, revert: 'invalid', revertDuration: 150,
      cursorAt: { left: 12, top: 18 }, distance: 4,
      start: function () { $('.tl-lane').addClass('drop-armed'); },
      stop: function () { $('.tl-lane').removeClass('drop-armed'); }
    });
  }

  /* ================= v2: RATIO + generator naloga ================= */
  function ratioWeekStart(off) { return PLAN_WEEK + (off || 0) * 7 * DAY; }
  function ratioRows(off) { return DATA.ratio.filter(function (r) { return r.weekOffset === off; }); }
  function ratioLabel(mo, short) {
    var off = +String(mo).split('@')[1] || 0, w = isoWeek(PLAN_WEEK + off * 7 * DAY);
    return short ? 't' + w : 'teden ' + w;
  }
  function ratioRow(mo) { for (var i = 0; i < DATA.ratio.length; i++) if (DATA.ratio[i].mo === mo) return DATA.ratio[i]; return null; }
  function moStats(mo) {
    var s = { planned: 0, onTl: 0, inBuf: 0, orders: [] };
    orders.forEach(function (o) {
      if (o.cancelled || o.mo !== mo) return;
      s.planned += o.qty; s.orders.push(o);
      if (!o.slot) s.inBuf += o.qty; else s.onTl += o.qty;
    });
    return s;
  }
  function needleText(o) { return o.needle ? NDL[o.needle].name : 'čaka'; }
  function needleBadge(o) {
    return o.needle ? '<span class="nb nb-ok">igla ' + NDL[o.needle].name + '</span>' : '<span class="nb nb-wait">čaka na iglo</span>';
  }

  function initRatio() {
    $('#ratio-prev').on('click', function () { if (state.ratioOff > 0) { state.ratioOff--; state.mo = null; renderRatio(); renderGen(); } });
    $('#ratio-next').on('click', function () { if (state.ratioOff < 1) { state.ratioOff++; state.mo = null; renderRatio(); renderGen(); } });
    $('#ratio-body').on('click', 'tr[data-mo]', function () {
      state.mo = String($(this).data('mo')); state.genQty = null; state.genOther = 0;
      renderRatio(); renderGen();
    });
    $('#gen').on('click', '.qtile', function (e) {
      if ($(e.target).is('input')) return;
      var v = $(this).data('q');
      state.genQty = v === 'other' ? 'other' : +v;
      renderGen();
      if (v === 'other') $('#gen-other').trigger('focus').trigger('select');
    });
    $('#gen').on('input', '#gen-other', function () { state.genOther = parseInt(this.value, 10) || 0; renderGenPreview(); });
    $('#gen').on('click', '#gen-prio button', function () { $(this).addClass('on').siblings().removeClass('on'); });
    $('#gen').on('click', '#gen-create', createFromRatio);
    $('#gen').on('keydown', '#gen-other', function (e) { if (e.key === 'Enter') createFromRatio(); });
    $('#gen').on('click', '.mo-ord', function () { var id = +$(this).data('id'); var o = find(id); if (o && o.slot) showOnTimeline(id); else select(id); });
  }

  function renderRatio() {
    var off = state.ratioOff, rows = ratioRows(off), ws = ratioWeekStart(off);
    $('#ratio-week-label').text('Teden ' + isoWeek(ws) + ' · od ' + new Date(ws).getDate() + '. ' + (new Date(ws).getMonth() + 1) + '.');
    $('#ratio-prev').prop('disabled', off === 0); $('#ratio-next').prop('disabled', off === 1);
    var tot = 0, pl = 0, h = [];
    rows.forEach(function (r) {
      var a = ART[r.art], s = moStats(r.mo), rest = r.week - s.planned;
      tot += r.week; pl += Math.min(s.planned, r.week);
      var pT = Math.min(100, s.onTl / r.week * 100), pB = Math.min(100 - pT, s.inBuf / r.week * 100);
      var restHtml = rest > 0 ? '<b class="rest-open">' + fmtN(rest) + '</b>' : rest === 0 ? '<b class="rest-ok">✓ 0</b>' : '<b class="rest-over">+' + fmtN(-rest) + '</b>';
      h.push('<tr data-mo="' + r.mo + '"' + (state.mo === r.mo ? ' class="sel"' : '') + '>' +
        '<td class="mo">' + a.ident + '</td>' +
        '<td class="art">' + esc(a.desc) + '</td>' +
        '<td class="num">' + fmtN(r.week) + '</td>' +
        '<td class="num">' + fmtN(s.planned) + '<small>' + s.orders.length + ' DN</small></td>' +
        '<td class="num">' + restHtml + '</td>' +
        '<td><div class="rt-bar"><div class="cov"><i class="cov-tl" style="width:' + pT + '%"></i><i class="cov-buf" style="left:' + pT + '%;width:' + pB + '%"></i></div>' +
          '<span class="cov-pct">' + Math.round(s.planned / r.week * 100) + ' %</span></div></td></tr>');
    });
    $('#ratio-body').html(h.join(''));
    var pct = tot ? Math.round(pl / tot * 100) : 0;
    $('#ratio-total').html('<span>Potreba <b>' + fmtN(tot) + '</b></span><span>Pokrito <b>' + fmtN(pl) + '</b></span><span>Odprto <b>' + fmtN(tot - pl) + '</b></span>' +
      '<span class="legend-mini"><i class="cov-tl"></i>na časovnici <i class="cov-buf"></i>v medpomnilniku</span>');
    if (off === 0) {
      $('#kpi-ratio').text(pct + ' %');
      $('#kpi-ratio-sub').text('teden ' + isoWeek(ws) + ' · odprto ' + fmtN(tot - pl) + ' kos');
    }
  }

  function genQty() { return state.genQty === 'other' ? (state.genOther || 0) : (state.genQty || 0); }

  function renderGen() {
    var $g = $('#gen');
    var r = state.mo ? ratioRow(state.mo) : null;
    if (!r) {
      $g.html('<div class="gen-empty"><div class="gen-empty-big">←</div>Izberi ident<br>v RATIO seznamu</div>');
      return;
    }
    var a = ART[r.art], s = moStats(r.mo), rest = r.week - s.planned;
    if (state.genQty == null) state.genQty = rest > 0 && rest < Math.min.apply(null, r.qtys) ? 'other' : r.qtys[r.qtys.length - 1];
    if (state.genQty === 'other' && !state.genOther) state.genOther = Math.max(0, rest);
    var h = [];
    h.push('<div class="gen-head"><div class="gen-mo">RATIO · teden ' + isoWeek(ratioWeekStart(r.weekOffset)) + '</div>' +
      '<div class="gen-art">' + a.ident + '<span>' + esc(a.desc) + '</span></div>' +
      '<div class="gen-stats"><div><span>Potreba</span><b>' + fmtN(r.week) + '</b></div><div><span>Planirano</span><b>' + fmtN(s.planned) + '</b></div>' +
      '<div><span>Preostane</span><b class="' + (rest > 0 ? 'rest-open' : rest === 0 ? 'rest-ok' : 'rest-over') + '">' + (rest < 0 ? '+' + fmtN(-rest) : fmtN(rest)) + '</b></div></div></div>');
    h.push('<div class="gen-body">');
    h.push('<div class="gen-lbl">Količina delovnega naloga</div><div class="qtiles">');
    r.qtys.forEach(function (q) {
      h.push('<button type="button" class="qtile' + (state.genQty === q ? ' on' : '') + '" data-q="' + q + '"><b>' + fmtN(q) + '</b><span>≈ ' + fmtDur(q / 130 * HOUR) + '</span></button>');
    });
    h.push('<div role="button" tabindex="0" class="qtile qtile-other' + (state.genQty === 'other' ? ' on' : '') + '" data-q="other"><b>Drugo</b>' +
      (state.genQty === 'other' ? '<input type="number" id="gen-other" min="1" value="' + (state.genOther || '') + '">' : '<span>' + (rest > 0 ? 'npr. ostanek ' + fmtN(rest) : 'ročni vnos') + '</span>') + '</div>');
    h.push('</div>');
    h.push('<div class="gen-preview" id="gen-preview"></div>');
    h.push('<details class="gen-more"><summary>Dodatno (neobvezno)</summary><div class="gen-more-body">' +
      '<div class="f"><span class="f-lbl">Prioriteta</span><div class="seg seg-prio" id="gen-prio"><button type="button" data-v="normalna" class="on">Normalna</button><button type="button" data-v="visoka">Visoka</button></div></div>' +
      '<label class="f"><span>Opomba za proizvodnjo</span><textarea id="gen-notes" rows="2"></textarea></label></div></details>');
    h.push('<div class="gen-spec"><span class="nb nb-wait">čaka na iglo</span><span>Iglo, alternativne igle in peč kasneje določi <b>specialist</b>. Do takrat časovnica pred nalogom vedno računa preklop 30 min.</span></div>');
    h.push('<button class="btn btn-primary gen-btn" id="gen-create">Ustvari delovni nalog <span class="arrow">→</span></button>');
    if (s.orders.length) {
      h.push('<div class="gen-lbl gen-lbl-list">Delovni nalogi za ta ident v tednu <span>' + s.orders.length + '</span></div><ul class="mo-orders">');
      s.orders.slice().sort(function (x, y) { return y.id - x.id; }).forEach(function (o) {
        var st = STATUS[status(o)];
        h.push('<li class="mo-ord" data-id="' + o.id + '"><b>' + o.id + '</b><span class="q">' + fmtN(o.qty) + ' kos</span>' + needleBadge(o) +
          '<span class="spill"><i style="background:' + st.color + '"></i>' + (o.slot ? MACH[o.slot.machine].name + ' · P' + o.slot.lane : 'medpomnilnik') + '</span></li>');
      });
      h.push('</ul>');
    }
    h.push('</div>');
    $g.html(h.join(''));
    renderGenPreview();
  }

  function renderGenPreview() {
    var r = ratioRow(state.mo); if (!r) return;
    var s = moStats(r.mo), q = genQty(), after = s.planned + q, rest = r.week - after;
    var pT = Math.min(100, s.onTl / r.week * 100), pB = Math.min(100 - pT, s.inBuf / r.week * 100), pN = Math.max(0, Math.min(100 - pT - pB, q / r.week * 100));
    var msg = !q ? 'Vpiši količino.' :
      rest > 0 ? 'Po tem nalogu: <b>' + fmtN(after) + ' / ' + fmtN(r.week) + '</b> · preostane še <b>' + fmtN(rest) + '</b> kos' :
      rest === 0 ? 'Po tem nalogu je tedenska potreba <b>točno pokrita</b>.' :
      '<span class="warn">Presega potrebo za <b>' + fmtN(-rest) + '</b> kos.</span> Dovoljeno, a preveri.';
    $('#gen-preview').html('<div class="cov cov-big"><i class="cov-tl" style="width:' + pT + '%"></i><i class="cov-buf" style="left:' + pT + '%;width:' + pB + '%"></i>' +
      '<i class="cov-new" style="left:' + (pT + pB) + '%;width:' + pN + '%"></i></div><div class="gen-msg">' + msg + '</div>');
    $('#gen-create').prop('disabled', !q);
  }

  function createFromRatio() {
    var r = ratioRow(state.mo), q = genQty();
    if (!r) return;
    if (!q || q < 1) { toast('Manjka količina', 'Izberi ali vpiši količino.'); return; }
    var o = mkOrder(r.art, null, q, {
      mo: r.mo, prio: $('#gen-prio .on').data('v') || 'normalna', notes: $.trim($('#gen-notes').val() || ''),
      createdBy: user(), createdAt: Date.now()
    });
    o.id = nextNo++;
    o.history.push({ at: o.createdAt, who: user(), text: 'Nalog ustvarjen iz RATIO (' + ratioLabel(r.mo) + ')' });
    orders.push(o);
    state.selected = o.id;
    var rest = r.week - moStats(r.mo).planned;
    state.genQty = null; state.genOther = 0;
    renderAll();
    toast('Nalog ' + o.id + ' ustvarjen', ART[r.art].ident + ' · ' + fmtN(q) + ' kos · čaka na iglo. ' + (rest > 0 ? 'Preostane še ' + fmtN(rest) + ' kos.' : 'Potreba pokrita.'));
    $('#buffer-list .bcard[data-id="' + o.id + '"]').each(function () { this.scrollIntoView({ block: 'nearest' }); });
  }

  /* ================= izris: časovnica ================= */
  function renderTimeline() {
    var $tl = $('#timeline'), keep = $tl.scrollLeft();
    var pph = state.pph, ws = state.weekStart, we = ws + 7 * DAY, W = 7 * 24 * pph;
    var X = function (t) { return (t - ws) / HOUR * pph; };
    var step = pph >= 24 ? 1 : pph >= 12 ? 2 : 6;
    var todayStart = new Date(NOW); todayStart.setHours(0, 0, 0, 0);

    var h = [];
    h.push('<div class="tl-inner" style="width:calc(var(--lw) + ' + W + 'px)">');
    h.push('<div class="tl-head"><div class="tl-corner">Stroj · poz.</div><div class="tl-scale" style="width:' + W + 'px">');
    for (var d = 0; d < 7; d++) {
      var dt = ws + d * DAY, dd = new Date(dt);
      h.push('<div class="tl-day' + (dt === todayStart.getTime() ? ' today' : '') + '" style="left:' + X(dt) + 'px;width:' + 24 * pph + 'px">' +
        DAYS_LONG[dd.getDay()] + ' ' + dd.getDate() + '. ' + (dd.getMonth() + 1) + '.</div>');
      for (var hr = 0; hr < 24; hr += step) {
        if (hr === 0) continue;
        var sh = S.shiftStarts.indexOf(hr) >= 0;
        h.push('<div class="tl-hour' + (sh ? ' shift' : '') + '" style="left:' + X(dt + hr * HOUR) + 'px">' + pad(hr) + '</div>');
      }
    }
    h.push('</div></div>');

    var lateInfo = lateOrders();
    DATA.machines.forEach(function (m) {
      if (state.machine && state.machine !== m.id) return;
      var ms = machineStateAt(m.id, NOW);
      h.push('<div class="tl-machine">');
      h.push('<div class="tl-mlabel"><div class="tl-mname"><b>' + m.name + '</b><small>' + m.code + ' · ' + m.rate + ' kos/h</small>' +
        '<span class="tl-mstate' + (ms.stopped ? ' stopped' : '') + '"><i></i>' + ms.text + '</span></div><div class="tl-pos">');
      for (var p = 1; p <= m.positions; p++) h.push('<span>P' + p + '</span>');
      h.push('</div></div>');
      h.push('<div class="tl-track" style="width:' + W + 'px">');
      // mreža in postanki izmen
      for (var dd2 = 0; dd2 < 7; dd2++) {
        var ds = ws + dd2 * DAY;
        if (dd2) h.push('<div class="tl-grid day" style="left:' + X(ds) + 'px"></div>');
        for (var hh = step; hh < 24; hh += step) h.push('<div class="tl-grid" style="left:' + X(ds + hh * HOUR) + 'px"></div>');
        S.shiftStarts.forEach(function (sh) {
          var s1 = ds + sh * HOUR - S.shiftStopMin * MIN;
          h.push('<div class="tl-stop" style="left:' + X(s1) + 'px;width:' + Math.max(2, S.shiftStopMin / 60 * pph) + 'px" title="Postanek izmene ' + fmtT(s1) + '–' + fmtT(s1 + S.shiftStopMin * MIN) + '"></div>');
        });
      }
      // preklopi čez vse 3 steze
      changeovers.forEach(function (c) {
        if (c.machine !== m.id || c.end <= ws || c.start >= we) return;
        var t = 'Preklop ' + fmtT(c.start) + '–' + fmtT(c.end) + ' · ustavi ves ' + m.name + ' · ' +
          c.orders.map(function (o) { return 'P' + o.slot.lane + ' → ' + o.id + ' (igla ' + needleText(o) + ')'; }).join(', ');
        h.push('<div class="tl-co" style="left:' + X(c.start) + 'px;width:' + Math.max(3, X(c.end) - X(c.start)) + 'px" title="' + esc(t) + '"></div>');
      });
      // steze
      for (var p2 = 1; p2 <= m.positions; p2++) {
        h.push('<div class="tl-lane" data-m="' + m.id + '" data-p="' + p2 + '">');
        laneItems(m.id, p2).forEach(function (o) {
          if (o._start == null) return;
          var s = o._prodStart != null ? o._prodStart : o._start, e = o._end != null ? o._end : NOW + 400 * DAY;
          if (e <= ws || s >= we) return;
          var l = Math.max(0, X(s)), r = Math.min(W, X(e)), w = Math.max(3, r - l);
          var a = ART[o.article], cls = barClass(o);
          var late = lateInfo.byId[o.id];
          var inner = '<span class="b-no">' + o.id + '</span><span class="b-art">' + esc(artLabel(a)) + '</span>' +
            '<span class="b-meta">igla ' + needleText(o) + ' · ' + fmtN(o.qty) + '</span>';
          if (cls === 'st-running') {
            var planPct = o._doneNow / o.qty * 100, actPct = Math.max(0, o._doneNow - o.lagMin * m.rate / 60) / o.qty * 100;
            inner += '<i class="b-plan" style="width:' + planPct + '%"></i><i class="b-prog" style="width:' + actPct + '%"></i>';
            if (o.lagMin) inner += '<span class="b-late">−' + o.lagMin + ' MIN</span>';
          }
          h.push('<div class="tl-bar-o ' + cls + (o.needle ? '' : ' no-needle') + (late === 'follow' ? ' is-late' : '') + (state.selected === o.id ? ' sel' : '') +
            '" data-id="' + o.id + '" style="left:' + l + 'px;width:' + w + 'px">' + inner + '</div>');
          if (cls === 'st-running' && o.lagMin && o._end) {
            var gl = X(o._end), gw = o.lagMin / 60 * pph;
            if (gl < W) h.push('<div class="tl-gap-late" style="left:' + gl + 'px;width:' + gw + 'px" title="Predviden zaostanek ' + o.lagMin + ' min"></div>');
          }
        });
        h.push('</div>');
      }
      h.push('</div></div>');
    });
    if (NOW >= ws && NOW < we) h.push('<div class="tl-now" data-t="' + fmtT(NOW) + '" style="left:calc(var(--lw) + ' + X(NOW) + 'px)"></div>');
    h.push('</div>');
    $tl.html(h.join(''));
    $tl.scrollLeft(keep);

    $('#week-label').text(weekLabel(ws));
    $('#last-refresh').text(fmtT(Date.now()) + ':' + pad(new Date().getSeconds()));

    // vleka
    $tl.find('.tl-bar-o.st-planned, .tl-bar-o.st-released').draggable({
      helper: 'clone', appendTo: 'body', zIndex: 1000, revert: 'invalid', revertDuration: 150, distance: 5,
      start: function () { $('.panel-buffer').addClass('drop-armed'); $('.tl-lane').addClass('drop-armed'); hideTip(); },
      stop: function () { $('.panel-buffer').removeClass('drop-armed drop-hover'); $('.tl-lane').removeClass('drop-armed'); }
    });
    $tl.find('.tl-lane').droppable({
      accept: '.bcard, .tl-bar-o', tolerance: 'pointer', hoverClass: 'drop-hover',
      drop: function (e, ui) {
        var o = find(+ui.draggable.data('id')); if (!o) return;
        var x = ui.offset.left - $(this).offset().left;
        place(o, +$(this).data('m'), +$(this).data('p'), state.weekStart + x / state.pph * HOUR);
      }
    });
    renderLateBanner(lateInfo);
  }

  function lateOrders() {
    var res = { list: [], byId: {} };
    orders.forEach(function (o) {
      if (!o.lagMin || status(o) !== 'in_production') return;
      res.list.push(o); res.byId[o.id] = 'late';
      var items = laneItems(o.slot.machine, o.slot.lane), i = items.indexOf(o) + 1;
      while (i < items.length && items[i].slot.chain) { res.byId[items[i].id] = 'follow'; i++; }
    });
    return res;
  }

  function renderLateBanner(info) {
    var $b = $('#late-banner');
    if (!info.list.length) { $b.addClass('hidden'); return; }
    var o = info.list[0], m = MACH[o.slot.machine];
    var follow = Object.keys(info.byId).filter(function (k) { return info.byId[k] === 'follow'; });
    $b.removeClass('hidden').html(
      '<span class="lb-icon">ZAMUDA</span>' +
      '<span class="lb-text">Nalog <b>' + o.id + '</b> na ' + m.name + ' / P' + o.slot.lane + ' zaostaja za planom <b>' + o.lagMin + ' min</b>. ' +
      (follow.length ? 'Naslednji nalogi (' + follow.join(', ') + ') so označeni kot pozni. ' : '') +
      'Predlog: premakni plan za ' + o.lagMin + ' min.</span>' +
      '<span class="lb-actions"><button class="btn btn-sm btn-ghost" data-act="show" data-id="' + o.id + '">Pokaži</button>' +
      '<button class="btn btn-sm btn-primary" data-act="shift" data-id="' + o.id + '">Potrdi premik</button></span>');
  }

  /* ================= izris: tedenski pregled ================= */
  function renderWeek() {
    var ws = state.weekStart, we = ws + 7 * DAY;
    var inWeek = function (o) { return o.slot && o._start != null && o._start < we && (o._end == null || o._end > ws); };
    var vis = orders.filter(function (o) { return !o.cancelled && inWeek(o) && (!state.machine || o.slot.machine === state.machine); });
    var running = vis.filter(function (o) { return status(o) === 'in_production'; });
    var done = vis.filter(function (o) { return o._end != null && o._end <= NOW; }).sort(function (a, b) { return b._end - a._end; });
    var planned = vis.filter(function (o) { return !o.started; }).sort(function (a, b) { return a._start - b._start; });
    var unfit = orders.filter(function (o) { return o.slot && !o.cancelled && o._start == null; });
    planned = planned.concat(unfit);

    var groups = [
      { k: 'running', t: 'V teku zdaj', c: 'var(--st-running)', rows: running },
      { k: 'done', t: 'Končani', c: 'var(--st-done)', rows: done },
      { k: 'planned', t: 'Še planirani', c: 'var(--st-planned)', rows: planned }
    ];
    var h = [];
    groups.forEach(function (g) {
      var pcs = g.rows.reduce(function (s, o) { return s + o.qty; }, 0);
      h.push('<div class="wgroup"><div class="wgroup-head"><i class="dot" style="background:' + g.c + '"></i><h3>' + g.t + '</h3>' +
        '<span class="sum"><b>' + g.rows.length + '</b> nalogov · <b>' + fmtN(pcs) + '</b> kos</span></div>');
      h.push('<table class="wt"><thead><tr><th>Nalog</th><th>Artikel</th><th>Igla</th><th>Stroj</th><th class="num">Količina</th>' +
        '<th>' + (g.k === 'done' ? 'Končan' : 'Začetek') + '</th><th>' + (g.k === 'done' ? 'Trajanje' : 'Konec') + '</th>' +
        '<th class="mini">Napredek</th><th>Status</th></tr></thead><tbody>');
      if (!g.rows.length) h.push('<tr class="wt-empty"><td colspan="9">Ni nalogov v tem tednu.</td></tr>');
      g.rows.forEach(function (o) {
        var a = ART[o.article], st = status(o), S2 = STATUS[st];
        var pct = st === 'in_production' ? Math.max(0, o._doneNow - o.lagMin * 130 / 60) / o.qty * 100 : (o._end != null && o._end <= NOW ? 100 : 0);
        h.push('<tr data-id="' + o.id + '"' + (state.selected === o.id ? ' class="sel"' : '') + '>' +
          '<td class="no">' + o.id + '</td>' +
          '<td><b>' + a.ident + '</b> ' + esc(a.desc) + '</td>' +
          '<td>' + (o.needle ? NDL[o.needle].name : '<span class="nb nb-wait">čaka</span>') + '</td>' +
          '<td>' + MACH[o.slot.machine].name + ' · P' + o.slot.lane + '</td>' +
          '<td class="num">' + (st === 'in_production' ? fmtN(Math.max(0, o._doneNow - o.lagMin * 130 / 60)) + ' / ' : '') + fmtN(o.qty) + '</td>' +
          '<td>' + (g.k === 'done' ? fmtDT(o._end) : o._start != null ? fmtDT(o._start) : '<span style="color:var(--st-now)">izven obsega</span>') + '</td>' +
          '<td>' + (g.k === 'done' ? fmtDur(o._end - o._start) : fmtDT(o._end)) + (o.lagMin ? ' <span class="tag tag-high">+' + o.lagMin + ' min</span>' : '') + '</td>' +
          '<td class="mini"><div class="mini-bar' + (pct >= 100 ? ' done' : '') + '"><i style="width:' + pct + '%"></i></div></td>' +
          '<td><span class="spill"><i style="background:' + S2.color + '"></i>' + S2.lbl + '</span></td></tr>');
      });
      h.push('</tbody></table></div>');
    });
    $('#week-groups').html(h.join(''));
    $('#week-hint').text(weekLabel(ws) + (state.machine ? ' · ' + MACH[state.machine].name : ' · vsi stroji') + ' · klik na vrstico označi nalog');
  }

  /* ================= izris: detajl (predal) ================= */
  function renderDetail() {
    var $d = $('#detail');
    var o = state.selected ? find(state.selected) : null;
    if (!o) { $d.removeClass('open'); return; }
    var a = ART[o.article], n = o.needle ? NDL[o.needle] : null, st = status(o), S2 = STATUS[st];
    var m = o.slot ? MACH[o.slot.machine] : null;
    var h = [];
    h.push('<button class="drawer-x" data-act="close" title="Zapri">×</button>');
    h.push('<div class="det-id"><div class="det-no-lbl">Delovni nalog</div><div class="det-no">' + o.id + '</div>' +
      '<div class="det-art">' + a.ident + '<small>' + esc(a.desc) + ' · referenca MFG/PRO</small></div>' +
      '<div class="det-pills"><span class="pill"><i style="background:' + S2.color + '"></i>' + S2.lbl + '</span>' +
      (o.locked ? '<span class="pill">🔒 Zaklenjen</span>' : '') +
      (o.prio === 'visoka' ? '<span class="pill" style="background:var(--molten)">Visoka prioriteta</span>' : '') +
      (!o.needle ? '<span class="pill" style="background:#ffd9c7">Čaka na iglo</span>' : '') + '</div></div>');

    if (st === 'in_production') {
      var act = Math.max(0, o._doneNow - o.lagMin * 130 / 60);
      h.push('<div class="det-prog"><div class="kv"><span>Narejeno (števec stroja)</span><b>' + fmtN(act) + ' / ' + fmtN(o.qty) + ' kos' +
        (o.lagMin ? ' · <span style="color:var(--molten)">zaostanek ' + o.lagMin + ' min</span>' : '') + '</b></div>' +
        '<div class="progress"><i class="ghost" style="width:' + (o._doneNow / o.qty * 100) + '%"></i><i style="width:' + (act / o.qty * 100) + '%"></i></div></div>');
    }

    h.push('<div class="det-body">');
    var kv = function (k, v, wide) { h.push('<div class="kv' + (wide ? ' wide' : '') + '"><span>' + k + '</span><b>' + v + '</b></div>'); };
    kv('Količina (plan)', fmtN(o.qty) + ' kos');
    kv('Proizvodni čas', fmtDur(o.qty / (m ? m.rate : 130) * HOUR));
    kv('Stroj / pozicija', m ? m.name + ' · P' + o.slot.lane : (o.machinePref ? MACH[o.machinePref].name + ' · <em style="font-weight:500">brez mesta</em>' : '— medpomnilnik —'));
    kv('Začetek', o.slot ? fmtDT(o._start) : '—');
    kv('Konec', o.slot ? fmtDT(o._end) : '—');
    kv('Preklop pred', o.slot ? (o._co ? 'da · 30 min' : 'ne') : '—');
    kv('RATIO', o.mo ? ratioLabel(o.mo) : '—');
    kv('Primarna igla', n ? n.name + ' <span style="font-weight:500;color:var(--muted)">DOB ' + n.dobMin + '–' + n.dobMax + '</span>' : '<span class="nb nb-wait">čaka na specialista</span>');
    kv('Starost igle', n ? fmtN(o.needleAge) + ' kos' : '—');
    kv('Palica', o.rod);
    kv('Alternative', o.alts.length ? o.alts.map(function (id) {
      var x = NDL[id], d = dobDiff(x, n);
      return '<span class="alt-chip' + (d > S.dobDiffThreshold ? ' big' : '') + '">' + x.name + ' Δ' + d + '</span>';
    }).join('') : '—', true);
    kv('Šarža odkovkov', o.batch || '—');
    kv('Peč', o.furnace ? FURN[o.furnace].name : '—');
    kv('Ustvaril', esc(o.createdBy) + ' · ' + fmtD(o.createdAt));
    if (o.notes) kv('Opombe', esc(o.notes), true);
    h.push('</div>');

    // potek
    h.push('<div class="det-flow"><div class="kv"><span>Potek naloga</span></div><div class="flow">');
    FLOW.forEach(function (f, i) {
      var c = S2.step > i ? 'done' : S2.step === i ? 'cur' : '';
      h.push('<div class="flow-step ' + c + '"><i></i>' + f + '</div>');
    });
    h.push('</div></div>');

    // akcije
    var can = !o.started && !o.cancelled;
    h.push('<div class="det-actions">');
    if (!o.locked && !o.cancelled) h.push('<button class="btn btn-primary btn-sm" data-act="release">Sprosti</button>');
    if (can) h.push('<button class="btn btn-sm" data-act="edit">Spremeni</button>');
    if (o.slot && can) h.push('<button class="btn btn-sm" data-act="unslot">V medpomnilnik</button>');
    if (o.slot) h.push('<button class="btn btn-sm btn-ghost" data-act="show" data-id="' + o.id + '">Na časovnici</button>');
    if (o.lagMin) h.push('<button class="btn btn-sm btn-molten" data-act="shift" data-id="' + o.id + '">Potrdi premik +' + o.lagMin + ' min</button>');
    if (can) h.push('<button class="btn btn-sm btn-danger" data-act="cancel">Prekliči</button>');
    h.push('</div>');

    // zgodovina
    h.push('<div class="hist"><div class="kv"><span>Zgodovina (samo za branje)</span></div><ul>');
    o.history.forEach(function (x) {
      h.push('<li>' + fmtDT(x.at) + ' · <b>' + esc(x.who) + '</b> · ' + esc(x.text) +
        (x.field ? ' · ' + esc(x.field) + ': <b>' + esc(x.old) + ' → ' + esc(x.new) + '</b>' : '') + (x.reason ? ' <em>(“' + esc(x.reason) + '”)</em>' : '') + '</li>');
    });
    h.push('</ul></div>');

    $d.html(h.join('')).addClass('open');
  }

  /* ================= modal: sprememba / preklic ================= */
  function openEdit(o) {
    var a = ART[o.article];
    modal('Spremeni nalog ' + o.id,
      (o.locked ? '<p style="color:var(--maroon);font-weight:700">Nalog je zaklenjen. Sprememba zahteva razlog in se zapiše v zgodovino.</p>' : '') +
      '<div class="f-row"><label class="f"><span>Količina</span><input type="number" id="m-qty" min="1" value="' + o.qty + '" list="m-qtys"></label>' +
      '<label class="f"><span>Palica</span><select id="m-rod">' + ['majhna', 'srednja', 'velika'].map(function (r) { return '<option' + (r === o.rod ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></label></div>' +
      '<datalist id="m-qtys">' + a.qtys.map(function (q) { return '<option value="' + q + '">'; }).join('') + '</datalist>' +
      '<div class="f-row"><label class="f"><span>Prioriteta</span><select id="m-prio"><option' + (o.prio === 'normalna' ? ' selected' : '') + '>normalna</option><option' + (o.prio === 'visoka' ? ' selected' : '') + '>visoka</option></select></label>' +
      '<label class="f"><span>Šarža odkovkov</span><input type="text" id="m-batch" value="' + esc(o.batch) + '"></label></div>' +
      '<label class="f"><span>Opombe</span><textarea id="m-notes" rows="2">' + esc(o.notes) + '</textarea></label>' +
      (o.locked ? '<label class="f"><span>Razlog spremembe *</span><textarea id="m-reason" rows="2" placeholder="Zakaj se nalog spreminja?"></textarea></label>' : ''),
      'Shrani spremembo',
      function () {
        var reason = o.locked ? $.trim($('#m-reason').val()) : '';
        if (o.locked && !reason) { $('#m-reason').trigger('focus').css('border-color', 'var(--st-now)'); return false; }
        var nv = { qty: parseInt($('#m-qty').val(), 10), rod: $('#m-rod').val(), prio: $('#m-prio').val(), batch: $.trim($('#m-batch').val()), notes: $.trim($('#m-notes').val()) };
        if (!nv.qty || nv.qty < 1) { $('#m-qty').trigger('focus'); return false; }
        var names = { qty: 'količina', rod: 'palica', prio: 'prioriteta', batch: 'šarža', notes: 'opombe' }, changed = 0;
        Object.keys(nv).forEach(function (k) {
          if (String(nv[k]) !== String(o[k])) {
            log(o, 'Sprememba', { field: names[k], old: o[k] === '' ? '—' : o[k], new: nv[k] === '' ? '—' : nv[k], reason: reason });
            o[k] = nv[k]; changed++;
          }
        });
        if (changed) { simulate(); renderAll(); toast('Nalog ' + o.id + ' spremenjen', changed + ' polj(e) · zapisano v zgodovino'); }
        return true;
      });
  }
  function openCancel(o) {
    modal('Prekliči nalog ' + o.id,
      '<p>Nalog ne bo izbrisan. Ostane v sistemu s statusom <b>preklican</b>.</p>' +
      '<label class="f"><span>Razlog preklica *</span><textarea id="m-reason" rows="2"></textarea></label>',
      'Prekliči nalog',
      function () {
        var r = $.trim($('#m-reason').val());
        if (!r) { $('#m-reason').trigger('focus').css('border-color', 'var(--st-now)'); return false; }
        if (o.slot) { var items = laneItems(o.slot.machine, o.slot.lane, o); items.forEach(function (x, k) { x.slot.seq = k; }); }
        o.cancelled = true; o.slot = null; log(o, 'Preklican', { reason: r });
        simulate(); renderAll(); toast('Nalog ' + o.id + ' preklican', r);
        return true;
      }, true);
  }
  function modal(title, body, okText, onOk, danger) {
    $('#modal-box').html('<div class="modal-head">' + esc(title) + '</div><div class="modal-body">' + body + '</div>' +
      '<div class="modal-foot"><button class="btn btn-ghost" data-m="x">Opusti</button><button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" data-m="ok">' + esc(okText) + '</button></div>');
    $('#modal').removeClass('hidden');
    $('#modal-box').find('input, textarea').first().trigger('focus');
    $('#modal-box').off('click').on('click', '[data-m]', function () {
      if ($(this).data('m') === 'ok' && onOk() === false) return;
      $('#modal').addClass('hidden');
    });
  }

  /* ================= toast + tooltip ================= */
  function toast(title, text) {
    var $t = $('<div class="toast"><b>' + esc(title) + '</b>' + esc(text) + '</div>').appendTo('#toasts');
    setTimeout(function () { $t.fadeOut(300, function () { $t.remove(); }); }, 4200);
  }
  var $tip = $('<div class="tip hidden"></div>').appendTo('body');
  function showTip(o, e) {
    var a = ART[o.article], n = o.needle ? NDL[o.needle] : null, st = status(o);
    var r = function (k, v) { return '<div class="r"><span>' + k + '</span><b>' + v + '</b></div>'; };
    $tip.html('<b class="t">' + o.id + ' · ' + esc(artLabel(a)) + '</b>' +
      r('Status', STATUS[st].lbl) + r('RATIO', ratioLabel(o.mo)) + r('Igla', n ? n.name + ' (DOB ' + n.dobMin + '–' + n.dobMax + ')' : 'čaka na specialista') +
      r('Količina', (st === 'in_production' ? fmtN(Math.max(0, o._doneNow - o.lagMin * 130 / 60)) + ' / ' : '') + fmtN(o.qty)) +
      r('Začetek', fmtDT(o._start)) + r('Konec', fmtDT(o._end)) + r('Preklop pred', o._co ? 'da' : 'ne') +
      (o.lagMin ? r('Zaostanek', o.lagMin + ' min') : '')).removeClass('hidden');
    moveTip(e);
  }
  function moveTip(e) {
    var x = e.clientX + 16, y = e.clientY + 16, w = $tip.outerWidth(), hh = $tip.outerHeight();
    if (x + w > window.innerWidth - 8) x = e.clientX - w - 16;
    if (y + hh > window.innerHeight - 8) y = e.clientY - hh - 16;
    $tip.css({ left: x, top: y });
  }
  function hideTip() { $tip.addClass('hidden'); }

  /* ================= izbira in poudarek ================= */
  function select(id) {
    state.selected = id;
    $('.bcard').removeClass('selected').filter('[data-id="' + id + '"]').addClass('selected');
    $('.tl-bar-o').removeClass('sel').filter('[data-id="' + id + '"]').addClass('sel');
    $('.wt tbody tr').removeClass('sel').filter('[data-id="' + id + '"]').addClass('sel');
    renderDetail();
  }
  function showOnTimeline(id) {
    var o = find(id); if (!o || !o.slot || o._start == null) return;
    var ws = weekStartOf(Math.max(o._start, Math.min(NOW, o._end || o._start)));
    if (o._start >= state.weekStart && o._start < state.weekStart + 7 * DAY) ws = state.weekStart;
    var rerender = false;
    if (ws !== state.weekStart) { state.weekStart = ws; rerender = true; }
    if (state.machine && state.machine !== o.slot.machine) { state.machine = 0; syncMachineFilter(); rerender = true; }
    state.selected = id;
    if (rerender) renderAll(); else select(id);
    document.getElementById('sec-timeline').scrollIntoView({ behavior: 'smooth', block: 'start' });
    flashBar(id);
  }
  function flashBar(id) {
    var $b = $('.tl-bar-o[data-id="' + id + '"]');
    if (!$b.length) return;
    var $tl = $('#timeline'), left = parseFloat($b.css('left'));
    $tl.animate({ scrollLeft: Math.max(0, left - 220) }, 300);
    $b.removeClass('flash'); void $b[0].offsetWidth; $b.addClass('flash');
  }

  /* ================= filtri ================= */
  function initFilters() {
    var $mf = $('#machine-filter');
    $mf.append('<button type="button" data-v="0" class="on">Vsi stroji</button>');
    DATA.machines.forEach(function (m) { $mf.append('<button type="button" data-v="' + m.id + '">' + m.name + '</button>'); });
    $mf.on('click', 'button', function () { state.machine = +$(this).data('v'); syncMachineFilter(); renderTimeline(); renderWeek(); });
    $('#zoom').on('click', 'button', function () {
      var $tl = $('#timeline'), old = state.pph, center = ($tl.scrollLeft() + $tl.width() / 2) / old;
      state.pph = +$(this).data('v');
      $(this).addClass('on').siblings().removeClass('on');
      renderTimeline();
      $tl.scrollLeft(center * state.pph - $tl.width() / 2);
    });
    $('#week-prev').on('click', function () { state.weekStart -= 7 * DAY; renderTimeline(); renderWeek(); });
    $('#week-next').on('click', function () { state.weekStart += 7 * DAY; renderTimeline(); renderWeek(); });
    $('#week-today').on('click', function () { state.weekStart = weekStartOf(NOW); renderTimeline(); renderWeek(); scrollToNow(); });
    $('#buffer-search').on('input', function () { state.search = this.value; renderBuffer(); });
  }
  function syncMachineFilter() { $('#machine-filter button').removeClass('on').filter('[data-v="' + state.machine + '"]').addClass('on'); }
  function scrollToNow() {
    if (NOW < state.weekStart || NOW >= state.weekStart + 7 * DAY) { $('#timeline').scrollLeft(0); return; }
    var x = (NOW - state.weekStart) / HOUR * state.pph;
    $('#timeline').scrollLeft(Math.max(0, x - $('#timeline').width() * 0.35));
  }

  /* ================= dogodki ================= */
  function initEvents() {
    $(document).on('click', '.bcard', function () { select(+$(this).data('id')); });
    $(document).on('click', '.tl-bar-o', function () { select(+$(this).data('id')); });
    $(document).on('mouseenter', '.tl-bar-o', function (e) { showTip(find(+$(this).data('id')), e); })
               .on('mousemove', '.tl-bar-o', moveTip)
               .on('mouseleave', '.tl-bar-o', hideTip);
    $(document).on('click', '.wt tbody tr[data-id]', function () { showOnTimeline(+$(this).data('id')); });
    $(document).on('click', '[data-act]', function () {
      var act = $(this).data('act'), o = find(+($(this).data('id') || state.selected));
      if (act === 'close') { state.selected = null; select(null); return; }
      if (!o) return;
      if (act === 'release') release(o);
      else if (act === 'edit') openEdit(o);
      else if (act === 'unslot') unschedule(o);
      else if (act === 'cancel') openCancel(o);
      else if (act === 'shift') confirmShift(o);
      else if (act === 'show') showOnTimeline(o.id);
    });
    $(document).on('keydown', function (e) {
      if (e.key === 'Escape') { if (!$('#modal').hasClass('hidden')) $('#modal').addClass('hidden'); else { state.selected = null; select(null); } }
    });
    $('.panel-buffer').droppable({
      accept: '.tl-bar-o', tolerance: 'pointer',
      over: function () { $(this).addClass('drop-hover'); }, out: function () { $(this).removeClass('drop-hover'); },
      drop: function (e, ui) { var o = find(+ui.draggable.data('id')); if (o) unschedule(o); }
    });
  }

  /* ================= osveževanje ================= */
  function tick() {
    var now = new Date();
    $('#clock-time').text(pad(now.getHours()) + ':' + pad(now.getMinutes()));
    $('#clock-shift').text(shiftOf(now.getTime()));
  }
  function refresh() {
    NOW = floorMin(Date.now());
    simulate(); renderAll();
  }

  function renderAll() {
    renderHero(); renderBuffer(); renderTimeline(); renderWeek(); renderDetail();
    renderRatio(); renderGen();
  }

  /* ================= zagon ================= */
  build();
  initRatio();
  initFilters();
  initEvents();
  state.weekStart = PLAN_WEEK;                   // v2: časovnica se odpre na tednu planiranja
  var hm = /nalog=(\d+)/.exec(location.hash);    // povezava #nalog=1033 odpre nalog
  if (hm && find(+hm[1])) state.selected = +hm[1];
  var hp = /ident=(\d+)/.exec(location.hash);   // povezava #ident=10256182 izbere ident v tednu planiranja
  if (hp && ratioRow(hp[1] + '@0')) { state.mo = hp[1] + '@0'; state.ratioOff = 0; }
  renderAll();
  scrollToNow();
  tick();
  setInterval(tick, 10000);
  setInterval(refresh, 30000);
});
