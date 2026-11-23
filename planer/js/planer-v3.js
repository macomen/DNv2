/* =========================================================
   Planiranje v3 · samo RATIO in delovni nalogi (DN)
   Planer izbere ident iz RATIO, določi količino in ustvari DN.
   Iglo kasneje določi specialist, kdaj in kje teče pa se ureja drugje.
   ========================================================= */
$(function () {
  'use strict';

  var DAY = 86400000, HOUR = 3600000;
  var RATE = DATA.machines[0].rate;                 // 130 kos/h
  var ART = {}, NDL = {};
  DATA.articles.forEach(function (a) { ART[a.id] = a; });
  DATA.needles.forEach(function (n) { NDL[n.id] = n; });

  var NOW = Date.now();
  var PLAN_WEEK = (function () { var d = new Date(NOW).getDay(), ws = weekStartOf(NOW); return d === 0 || d === 6 ? ws + 7 * DAY : ws; })();

  var STATUS = {
    planned:   { lbl: 'Planiran',  color: 'var(--st-planned)' },
    released:  { lbl: 'Sproščen',  color: 'var(--st-released)' },
    cancelled: { lbl: 'Preklican', color: 'var(--st-now)' }
  };

  var orders = [], nextNo = 1001;
  var state = { off: 0, key: null, qty: null, other: 0, filter: 'all', search: '', onlySel: false, flash: null };

  /* ---------- pomožne ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtN(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function fmtDur(ms) { var m = Math.round(ms / 60000); return Math.floor(m / 60) + ' h ' + pad(m % 60) + ' min'; }
  function fmtDT(t) { var d = new Date(t); return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function weekStartOf(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); }
  function isoWeek(t) {
    var d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    var w1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - w1) / DAY - 3 + (w1.getDay() + 6) % 7) / 7);
  }
  function weekStart(off) { return PLAN_WEEK + off * 7 * DAY; }
  function weekLabel(off) {
    var a = new Date(weekStart(off)), b = new Date(weekStart(off) + 6 * DAY);
    return 'Teden ' + isoWeek(a) + ' · ' + a.getDate() + '. ' + (a.getMonth() + 1) + '. – ' + b.getDate() + '. ' + (b.getMonth() + 1) + '.';
  }
  function rowKey(r) { return ART[r.art].ident + '@' + r.weekOffset; }
  function rowByKey(k) { return DATA.ratio.filter(function (r) { return rowKey(r) === k; })[0] || null; }
  function user() { return 'J. Horvat'; }
  function find(id) { return orders.filter(function (o) { return o.id === id; })[0]; }
  function stats(r) {
    var s = { planned: 0, released: 0, list: [] };
    orders.forEach(function (o) {
      if (o.art !== r.art || o.off !== r.weekOffset || o.status === 'cancelled') return;
      s.planned += o.qty; s.list.push(o);
      if (o.status === 'released') s.released += o.qty;
    });
    return s;
  }

  /* ---------- izmišljeni obstoječi DN ---------- */
  function seed() {
    // [artikel, teden, količina, igla ali null, status]
    [[1, 0, 3060, 4, 'released'], [1, 0, 1700, null, 'planned'],
     [2, 0, 1700, 3, 'released'],
     [3, 0, 3060, 7, 'released'], [3, 0, 3060, null, 'planned'],
     [4, 0, 1700, 12, 'released'], [4, 0, 1700, null, 'planned'],
     [5, 0, 3060, 13, 'planned'],
     [6, 0, 3060, 15, 'released'], [6, 0, 3060, 8, 'planned'],
     [1, 1, 3060, null, 'planned']
    ].forEach(function (s, i) {
      var o = mk(s[0], s[1], s[2], { needle: s[3], status: s[4], createdAt: NOW - (30 - i * 2) * HOUR, createdBy: i % 3 ? 'J. Horvat' : 'M. Zupan' });
      if (o.needle) o.history.push({ at: o.createdAt + 3 * HOUR, who: 'T. Kralj (specialist)', text: 'Dodeljena igla ' + NDL[o.needle].name });
      if (o.status === 'released') o.history.push({ at: o.createdAt + 4 * HOUR, who: o.createdBy, text: 'Sproščen' });
    });
  }
  function mk(art, off, qty, opt) {
    var o = $.extend({ id: nextNo++, art: art, off: off, qty: qty, needle: null, prio: 'normalna', notes: '', status: 'planned',
      createdBy: user(), createdAt: Date.now(), history: [] }, opt || {});
    o.history.unshift({ at: o.createdAt, who: o.createdBy, text: 'Ustvarjen iz RATIO (teden ' + isoWeek(weekStart(off)) + ')' });
    orders.push(o);
    return o;
  }

  /* ---------- RATIO ---------- */
  function renderRatio() {
    var rows = DATA.ratio.filter(function (r) { return r.weekOffset === state.off; });
    $('#ratio-week-label').text(weekLabel(state.off));
    $('#ratio-prev').prop('disabled', state.off === 0);
    $('#ratio-next').prop('disabled', state.off === 1);
    var tot = 0, cov = 0, h = [];
    rows.forEach(function (r) {
      var a = ART[r.art], s = stats(r), rest = r.week - s.planned, k = rowKey(r);
      tot += r.week; cov += Math.min(r.week, s.planned);
      var pR = Math.min(100, s.released / r.week * 100), pP = Math.min(100 - pR, (s.planned - s.released) / r.week * 100);
      h.push('<tr data-key="' + k + '"' + (state.key === k ? ' class="sel"' : '') + '>' +
        '<td class="mo">' + a.ident + '</td><td class="art">' + esc(a.desc) + '</td>' +
        '<td class="num">' + fmtN(r.week) + '</td>' +
        '<td class="num">' + fmtN(s.planned) + '<small>' + s.list.length + ' DN</small></td>' +
        '<td class="num">' + (rest > 0 ? '<b class="rest-open">' + fmtN(rest) + '</b>' : rest === 0 ? '<b class="rest-ok">✓ 0</b>' : '<b class="rest-over">+' + fmtN(-rest) + '</b>') + '</td>' +
        '<td><div class="rt-bar"><div class="cov"><i class="cov-tl" style="width:' + pR + '%"></i><i class="cov-buf" style="left:' + pR + '%;width:' + pP + '%"></i></div>' +
        '<span class="cov-pct">' + Math.round(s.planned / r.week * 100) + ' %</span></div></td></tr>');
    });
    $('#ratio-body').html(h.join(''));
    $('#ratio-total').html('<span>Potreba <b>' + fmtN(tot) + '</b></span><span>Pokrito <b>' + fmtN(cov) + '</b></span><span>Odprto <b>' + fmtN(tot - cov) + '</b></span>' +
      '<span class="legend-mini"><i class="cov-tl"></i>sproščeno <i class="cov-buf"></i>planirano</span>');

    var wk = orders.filter(function (o) { return o.off === state.off && o.status !== 'cancelled'; });
    $('#k-week').text(isoWeek(weekStart(state.off)));
    $('#k-cover').text((tot ? Math.round(cov / tot * 100) : 0) + ' %');
    $('#k-open').text(fmtN(tot - cov));
    $('#k-dn').text(wk.length);
    $('#k-wait').text(wk.filter(function (o) { return !o.needle; }).length);
  }

  /* ---------- generator ---------- */
  function curQty() { return state.qty === 'other' ? (state.other || 0) : (state.qty || 0); }

  function renderGen() {
    var r = state.key ? rowByKey(state.key) : null, $g = $('#gen');
    if (!r) { $g.html('<div class="gen-empty"><div class="gen-empty-big">←</div>Izberi ident<br>v RATIO seznamu</div>'); return; }
    var a = ART[r.art], s = stats(r), rest = r.week - s.planned;
    if (state.qty == null) state.qty = rest > 0 && rest < Math.min.apply(null, r.qtys) ? 'other' : r.qtys[r.qtys.length - 1];
    if (state.qty === 'other' && !state.other) state.other = Math.max(0, rest);
    var h = [];
    h.push('<div class="gen-head"><div class="gen-mo">RATIO · teden ' + isoWeek(weekStart(r.weekOffset)) + '</div>' +
      '<div class="gen-art">' + a.ident + '<span>' + esc(a.desc) + '</span></div>' +
      '<div class="gen-stats"><div><span>Potreba</span><b>' + fmtN(r.week) + '</b></div><div><span>Planirano</span><b>' + fmtN(s.planned) + '</b></div>' +
      '<div><span>Preostane</span><b class="' + (rest > 0 ? 'rest-open' : rest === 0 ? 'rest-ok' : 'rest-over') + '">' + (rest < 0 ? '+' + fmtN(-rest) : fmtN(rest)) + '</b></div></div></div>');
    h.push('<div class="gen-body"><div class="gen-lbl">Količina delovnega naloga</div><div class="qtiles">');
    r.qtys.forEach(function (q) {
      h.push('<button type="button" class="qtile' + (state.qty === q ? ' on' : '') + '" data-q="' + q + '"><b>' + fmtN(q) + '</b><span>≈ ' + fmtDur(q / RATE * HOUR) + '</span></button>');
    });
    h.push('<div role="button" tabindex="0" class="qtile qtile-other' + (state.qty === 'other' ? ' on' : '') + '" data-q="other"><b>Drugo</b>' +
      (state.qty === 'other' ? '<input type="number" id="gen-other" min="1" value="' + (state.other || '') + '">' : '<span>' + (rest > 0 ? 'npr. ostanek ' + fmtN(rest) : 'ročni vnos') + '</span>') + '</div></div>');
    h.push('<div class="gen-preview" id="gen-preview"></div>');
    h.push('<details class="gen-more"><summary>Dodatno (neobvezno)</summary><div class="gen-more-body">' +
      '<div class="f"><span class="f-lbl">Prioriteta</span><div class="seg seg-prio" id="gen-prio"><button type="button" data-v="normalna" class="on">Normalna</button><button type="button" data-v="visoka">Visoka</button></div></div>' +
      '<label class="f"><span>Opomba</span><textarea id="gen-notes" rows="2"></textarea></label></div></details>');
    h.push('<div class="gen-spec"><span class="nb nb-wait">čaka na iglo</span><span>Iglo, alternative in peč kasneje določi <b>specialist</b>.</span></div>');
    h.push('<button class="btn btn-primary gen-btn" id="gen-create">Ustvari delovni nalog <span class="arrow">→</span></button></div>');
    $g.html(h.join(''));
    renderPreview();
  }

  function renderPreview() {
    var r = rowByKey(state.key); if (!r) return;
    var s = stats(r), q = curQty(), after = s.planned + q, rest = r.week - after;
    var pR = Math.min(100, s.released / r.week * 100), pP = Math.min(100 - pR, (s.planned - s.released) / r.week * 100), pN = Math.max(0, Math.min(100 - pR - pP, q / r.week * 100));
    var msg = !q ? 'Vpiši količino.' :
      rest > 0 ? 'Po tem nalogu: <b>' + fmtN(after) + ' / ' + fmtN(r.week) + '</b> · preostane še <b>' + fmtN(rest) + '</b> kos' :
      rest === 0 ? 'Po tem nalogu je tedenska potreba <b>točno pokrita</b>.' :
      '<span class="warn">Presega potrebo za <b>' + fmtN(-rest) + '</b> kos.</span> Dovoljeno, a preveri.';
    $('#gen-preview').html('<div class="cov cov-big"><i class="cov-tl" style="width:' + pR + '%"></i><i class="cov-buf" style="left:' + pR + '%;width:' + pP + '%"></i>' +
      '<i class="cov-new" style="left:' + (pR + pP) + '%;width:' + pN + '%"></i></div><div class="gen-msg">' + msg + '</div>');
    $('#gen-create').prop('disabled', !q);
  }

  function create() {
    var r = rowByKey(state.key), q = curQty();
    if (!r) return;
    if (!q || q < 1) { toast('Manjka količina', 'Izberi ali vpiši količino.'); return; }
    var o = mk(r.art, r.weekOffset, q, { prio: $('#gen-prio .on').data('v') || 'normalna', notes: $.trim($('#gen-notes').val() || '') });
    var rest = r.week - stats(r).planned;
    state.qty = null; state.other = 0; state.flash = o.id;
    renderAll();
    toast('DN ' + o.id + ' ustvarjen', ART[r.art].ident + ' · ' + fmtN(q) + ' kos · ' + (rest > 0 ? 'preostane še ' + fmtN(rest) + ' kos' : 'potreba pokrita'));
  }

  /* ---------- seznam DN ---------- */
  function renderDN() {
    var q = state.search.toLowerCase(), selArt = state.key ? rowByKey(state.key).art : null;
    var list = orders.filter(function (o) {
      if (o.off !== state.off) return false;
      if (state.onlySel && selArt && o.art !== selArt) return false;
      if (state.filter === 'wait' && (o.needle || o.status === 'cancelled')) return false;
      if (state.filter === 'ready' && (!o.needle || o.status === 'cancelled')) return false;
      if (q && (o.id + ' ' + ART[o.art].ident + ' ' + ART[o.art].desc).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return (a.status === 'cancelled') - (b.status === 'cancelled') || b.id - a.id; });

    $('#dn-hint').text(weekLabel(state.off) + ' · ' + list.length + ' nalogov');
    var h = [];
    if (!list.length) h.push('<tr class="wt-empty"><td colspan="10">Ni delovnih nalogov za ta izbor.</td></tr>');
    list.forEach(function (o) {
      var a = ART[o.art], st = STATUS[o.status], c = o.status === 'cancelled';
      h.push('<tr data-id="' + o.id + '" class="' + (c ? 'is-cancelled' : '') + (state.flash === o.id ? ' flash-row' : '') + (selArt === o.art ? ' same-art' : '') + '">' +
        '<td class="no">' + o.id + '</td><td><b>' + a.ident + '</b></td><td>' + esc(a.desc) + '</td>' +
        '<td class="num"><b>' + fmtN(o.qty) + '</b></td><td>' + fmtDur(o.qty / RATE * HOUR) + '</td>' +
        '<td>' + (o.needle ? '<span class="nb nb-ok">igla ' + NDL[o.needle].name + '</span>' : '<span class="nb nb-wait">čaka na iglo</span>') + '</td>' +
        '<td>' + (o.prio === 'visoka' ? '<span class="tag tag-high">Visoka</span>' : '<span class="muted">normalna</span>') + '</td>' +
        '<td><span class="spill"><i style="background:' + st.color + '"></i>' + st.lbl + '</span></td>' +
        '<td class="muted">' + esc(o.createdBy) + ' · ' + fmtDT(o.createdAt) + '</td>' +
        '<td class="act"><div>' + (c ? '' :
          (o.status === 'planned' ? '<button class="btn btn-sm" data-act="release">Sprosti</button>' : '') +
          '<button class="btn btn-sm btn-ghost" data-act="qty">Količina</button>' +
          '<button class="btn btn-sm btn-danger" data-act="cancel">Prekliči</button>') + '</div></td></tr>');
      if (o.notes || c) h.push('<tr class="dn-note' + (c ? ' is-cancelled' : '') + '"><td></td><td colspan="9">' + esc(o.notes || '') +
        (c ? ' <em>Preklican: ' + esc(o.cancelReason) + '</em>' : '') + '</td></tr>');
    });
    $('#dn-body').html(h.join(''));
    state.flash = null;
  }

  /* ---------- akcije ---------- */
  function release(o) {
    o.status = 'released'; o.history.push({ at: Date.now(), who: user(), text: 'Sproščen' });
    renderAll(); toast('DN ' + o.id + ' sproščen', 'Spremembe so odslej možne le z razlogom.');
  }
  function changeQty(o) {
    var locked = o.status === 'released';
    modal('Količina DN ' + o.id,
      '<label class="f"><span>Nova količina</span><input type="number" id="m-qty" min="1" value="' + o.qty + '"></label>' +
      (locked ? '<label class="f"><span>Razlog spremembe *</span><textarea id="m-reason" rows="2" placeholder="DN je sproščen – zakaj se spreminja?"></textarea></label>' : ''),
      'Shrani', function () {
        var v = parseInt($('#m-qty').val(), 10), r = locked ? $.trim($('#m-reason').val()) : '';
        if (!v || v < 1) { $('#m-qty').trigger('focus'); return false; }
        if (locked && !r) { $('#m-reason').trigger('focus').css('border-color', 'var(--st-now)'); return false; }
        if (v !== o.qty) {
          o.history.push({ at: Date.now(), who: user(), text: 'Količina ' + o.qty + ' → ' + v + (r ? ' (' + r + ')' : '') });
          o.qty = v; renderAll(); toast('DN ' + o.id + ' spremenjen', 'Nova količina ' + fmtN(v) + ' kos.');
        }
        return true;
      });
  }
  function cancel(o) {
    modal('Prekliči DN ' + o.id,
      '<p>DN ne bo izbrisan, ostane s statusom <b>preklican</b> in se ne šteje več v RATIO.</p>' +
      '<label class="f"><span>Razlog *</span><textarea id="m-reason" rows="2"></textarea></label>', 'Prekliči DN', function () {
        var r = $.trim($('#m-reason').val());
        if (!r) { $('#m-reason').trigger('focus').css('border-color', 'var(--st-now)'); return false; }
        o.status = 'cancelled'; o.cancelReason = r; o.history.push({ at: Date.now(), who: user(), text: 'Preklican (' + r + ')' });
        renderAll(); toast('DN ' + o.id + ' preklican', r);
        return true;
      }, true);
  }
  function modal(title, body, ok, onOk, danger) {
    $('#modal-box').html('<div class="modal-head">' + esc(title) + '</div><div class="modal-body">' + body + '</div>' +
      '<div class="modal-foot"><button class="btn btn-ghost" data-m="x">Opusti</button><button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" data-m="ok">' + esc(ok) + '</button></div>');
    $('#modal').removeClass('hidden');
    $('#modal-box').find('input, textarea').first().trigger('focus');
    $('#modal-box').off('click').on('click', '[data-m]', function () {
      if ($(this).data('m') === 'ok' && onOk() === false) return;
      $('#modal').addClass('hidden');
    });
  }
  function toast(t, x) {
    var $t = $('<div class="toast"><b>' + esc(t) + '</b>' + esc(x) + '</div>').appendTo('#toasts');
    setTimeout(function () { $t.fadeOut(300, function () { $t.remove(); }); }, 4000);
  }

  function renderAll() { renderRatio(); renderGen(); renderDN(); }

  /* ---------- dogodki ---------- */
  $('#ratio-prev').on('click', function () { if (state.off > 0) { state.off--; state.key = null; renderAll(); } });
  $('#ratio-next').on('click', function () { if (state.off < 1) { state.off++; state.key = null; renderAll(); } });
  $('#ratio-body').on('click', 'tr[data-key]', function () {
    state.key = String($(this).data('key')); state.qty = null; state.other = 0; renderAll();
  });
  $('#gen').on('click', '.qtile', function (e) {
    if ($(e.target).is('input')) return;
    var v = $(this).data('q'); state.qty = v === 'other' ? 'other' : +v; renderGen();
    if (v === 'other') $('#gen-other').trigger('focus').trigger('select');
  });
  $('#gen').on('input', '#gen-other', function () { state.other = parseInt(this.value, 10) || 0; renderPreview(); });
  $('#gen').on('keydown', '#gen-other', function (e) { if (e.key === 'Enter') create(); });
  $('#gen').on('click', '#gen-prio button', function () { $(this).addClass('on').siblings().removeClass('on'); });
  $('#gen').on('click', '#gen-create', create);
  $('#dn-filter').on('click', 'button', function () { $(this).addClass('on').siblings().removeClass('on'); state.filter = $(this).data('v'); renderDN(); });
  $('#dn-search').on('input', function () { state.search = this.value; renderDN(); });
  $('#dn-only-sel').on('change', function () { state.onlySel = this.checked; renderDN(); });
  $('#dn-body').on('click', '[data-act]', function (e) {
    e.stopPropagation();
    var o = find(+$(this).closest('tr').data('id')), act = $(this).data('act');
    if (act === 'release') release(o); else if (act === 'qty') changeQty(o); else if (act === 'cancel') cancel(o);
  });
  $('#dn-body').on('click', 'tr[data-id]', function () {
    var o = find(+$(this).data('id')), r = DATA.ratio.filter(function (x) { return x.art === o.art && x.weekOffset === o.off; })[0];
    if (r) { state.key = rowKey(r); state.qty = null; state.other = 0; renderRatio(); renderGen(); renderDN(); }
  });
  $(document).on('keydown', function (e) { if (e.key === 'Escape') $('#modal').addClass('hidden'); });

  function tick() {
    var d = new Date(), h = d.getHours();
    $('#clock-time').text(pad(h) + ':' + pad(d.getMinutes()));
    $('#clock-shift').text(h >= 6 && h < 14 ? '1. izmena · 6–14' : h >= 14 && h < 22 ? '2. izmena · 14–22' : '3. izmena · 22–6');
  }

  seed();
  renderAll();
  tick(); setInterval(tick, 10000);
});
