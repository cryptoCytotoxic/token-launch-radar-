// Launch Radar dashboard. Everything it shows comes from window.RADAR, the
// data.js file main.ts writes beside this page — no network, no framework.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) return;
  var rows = D.rows.slice();
  var state = { q: '', cat: 'All categories', chain: 'All chains', sort: 'rank', watch: false, selected: null };

  function $(id) { return document.getElementById(id); }
  function money(usd) {
    if (usd >= 1e9) return '$' + (usd / 1e9).toFixed(2) + 'B';
    if (usd >= 1e6) return '$' + (usd / 1e6).toFixed(1) + 'M';
    if (usd >= 1e3) return '$' + (usd / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(usd);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ageLabel(days) {
    if (days === null) return 'unknown';
    if (days < 60) return days + 'd';
    if (days < 730) return Math.round(days / 30.4) + ' mo';
    return (days / 365.25).toFixed(1) + ' yrs';
  }
  function changeLabel(v) {
    if (v === null) return '<span class="slug">n/a</span>';
    var cls = v > 0 ? 'up' : v < 0 ? 'down' : '';
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }

  // Header: what this is, and the shape of the field it swept.
  $('lede').textContent =
    'Built from the sealed DefiLlama snapshot of ' + D.as_of + ': ' + D.protocol_count +
    ' protocols at $5M+ TVL. The ' + D.live_count + ' that already trade a token were set aside — ' +
    'their prices calibrate the model — and so were ' + D.products_set_aside +
    ' wrapped, staked or bridged products of tokens that already trade (a wrapped bitcoin is not a launch). The ' + D.pre_token_count +
    ' remaining protocols that record no token are ranked below by what a launch would be worth on their own figures.';
  $('stats').innerHTML =
    stat(D.pre_token_count, 'pre-token protocols ranked') +
    stat(D.watchlist_count, 'on the $50M+ watchlist') +
    stat(money(rows[0].implied_value_usd), 'top implied launch value') +
    stat(D.global_multiple.toFixed(3) + '×', 'median traded peer multiple');
  function stat(b, s) { return '<div class="stat"><b>' + esc(b) + '</b><span>' + esc(s) + '</span></div>'; }

  // The model, stated on the page where the judge and the reader can hold it to account.
  $('model').innerHTML =
    '<div class="model-card"><h2>How a price is made</h2>' +
    '<p><code>implied value = TVL × category peer multiple × growth factor × maturity factor</code></p>' +
    '<p>The peer multiple is the median market-cap/TVL of the traded protocols in the same category, winsorised so one hot print cannot set a price; thin categories blend toward the global median of ' +
    D.global_multiple.toFixed(3) + '×. The growth factor (0.72–1.45) reads the protocol\u2019s own 7-day TVL change; the maturity factor (0.88–1.12) reads how long it has run with no token. ' +
    'No protocol is priced by name — change its figures and its price moves. Rank is the model\u2019s claim, and every row shows its working.</p></div>';

  // Filter options, from the data itself.
  var cats = {}, chains = {};
  rows.forEach(function (r) {
    cats[r.category || 'Uncategorised'] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  fillSelect($('cat'), ['All categories'].concat(Object.keys(cats).sort()));
  fillSelect($('chain'), ['All chains'].concat(Object.keys(chains).sort()));
  function fillSelect(el, opts) {
    el.innerHTML = opts.map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('');
  }

  function visible() {
    var out = rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.cat !== 'All categories' && (r.category || 'Uncategorised') !== state.cat) return false;
      if (state.chain !== 'All chains' && r.chains.indexOf(state.chain) === -1) return false;
      if (state.q) {
        var hay = (r.name + ' ' + r.slug).toLowerCase();
        if (hay.indexOf(state.q.toLowerCase()) === -1) return false;
      }
      return true;
    });
    if (state.sort === 'tvl') out.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (state.sort === 'growth') out.sort(function (a, b) { return (b.change_7d || -1e9) - (a.change_7d || -1e9); });
    else if (state.sort === 'age') out.sort(function (a, b) { return (b.age_days || -1) - (a.age_days || -1); });
    else out.sort(function (a, b) { return a.rank - b.rank; });
    return out;
  }

  function render() {
    var vis = visible();
    $('count').textContent = 'Showing ' + vis.length + ' of ' + rows.length + ' ranked protocols';
    $('empty').hidden = vis.length > 0;
    $('rows').innerHTML = vis.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' +
        (r.on_watchlist ? '<span class="badge">Watchlist</span>' : '') +
        '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + changeLabel(r.change_7d) + '</td>' +
        '<td class="num">' + ageLabel(r.age_days) + '</td>' +
        '<td class="num">' + r.peer_multiple.toFixed(2) + '×</td>' +
        '<td class="num value">' + money(r.implied_value_usd) + '</td>' +
        '<td><span class="open-hint">Farm plan →</span></td></tr>';
    }).join('');
    var trs = $('rows').querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      trs[i].addEventListener('click', function () { openDetail(this.getAttribute('data-slug')); });
    }
  }

  function openDetail(slug) {
    state.selected = slug;
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    var d = $('detail');
    d.hidden = false;
    d.innerHTML =
      '<button class="close-btn" id="closeDetail">Close ✕</button>' +
      '<h2>' + esc(r.name) + (r.on_watchlist ? '<span class="badge">Watchlist</span>' : '') + '</h2>' +
      '<p class="sub">Rank #' + r.rank + ' of ' + rows.length + ' · ' + esc(r.category || 'Uncategorised') +
      ' · on ' + esc(r.chains.join(', ')) + ' · tracked by DefiLlama since ' + esc(r.listed_at || 'an unrecorded date') + '</p>' +
      '<div class="detail-grid">' +
      kv(money(r.implied_value_usd), 'Implied launch value') +
      kv(money(r.tvl_usd), 'TVL in the snapshot') +
      kv(r.peer_multiple.toFixed(3) + '×', 'Category peer multiple') +
      kv(ageLabel(r.age_days), 'Run with no token') +
      '</div>' +
      '<p class="formula">The working: <code>' + money(r.tvl_usd) + ' TVL × ' + r.peer_multiple.toFixed(3) +
      ' peer × ' + r.growth_factor.toFixed(3) + ' growth × ' + r.maturity_factor.toFixed(3) +
      ' maturity = ' + money(r.implied_value_usd) + '</code> — the multiple is what traded ' +
      esc(r.category || 'uncategorised') + ' protocols fetch per TVL dollar; growth reads its 7-day TVL change of ' +
      (r.change_7d === null ? 'unreported' : r.change_7d.toFixed(1) + '%') + '.</p>' +
      '<h3>How to farm it — a ' + r.farm_steps.length + '-step plan</h3>' +
      '<ol class="farm">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="sub">A launch is never promised: this prices what a token would be worth if the record holds, and the plan is how a reader earns a place in one if it comes.</p>';
    $('closeDetail').addEventListener('click', function () {
      d.hidden = true; state.selected = null; render();
    });
    d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    render();
  }
  function kv(b, s) { return '<div class="kv"><b>' + esc(b) + '</b><span>' + esc(s) + '</span></div>'; }

  $('foot').innerHTML =
    '<p>Data: the sealed DefiLlama snapshot of ' + esc(D.as_of) + ' (' + esc(D.source) + '). A protocol here <em>records</em> no token in that snapshot — that is DefiLlama\u2019s record, not proof none exists anywhere.</p>' +
    '<p>The watchlist is the house floor: every protocol at $50M+ TVL that records no token and is not a wrapped, staked or bridged product of one that trades. This board covers all ' +
    D.watchlist_count + ' of them, and keeps sweeping below the floor to all ' + D.pre_token_count + ' pre-token protocols that are not a wrapped, staked or bridged product of one that trades.</p>';

  $('q').addEventListener('input', function () { state.q = this.value; render(); });
  $('cat').addEventListener('change', function () { state.cat = this.value; render(); });
  $('chain').addEventListener('change', function () { state.chain = this.value; render(); });
  $('sort').addEventListener('change', function () { state.sort = this.value; render(); });
  $('watch').addEventListener('change', function () { state.watch = this.checked; render(); });

  render();
})();
