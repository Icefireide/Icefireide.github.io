/* Icefireide — shared behaviour. Everything data-driven reads the published
   production-log sheet, same workbook the old pages used. */
(function () {
  var BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR300p3G6_5hn7Ydez7mY6XVhfoWeLUBFpM0C9oJdd__WP8xhVVwZp4bxFZwvxJvODbJ3_o_p-I8EUe/pub?single=true&output=csv&gid=';
  var SHEETS = {
    totals: BASE + '0',
    years: { 2026: BASE + '584832786', 2025: BASE + '1262254364', 2024: BASE + '106338310' }
  };
  // Season tab columns: A Date, B Event, C Game, D Organization, E Role, F Hours, G Link
  // Totals tab columns: Game, Total Hours, Number of Events, 2024 Hours, 2024 Events,
  //   2025 Hours, 2025 Events, 2026 Hours, 2026 Events, Available For Work? (J2)

  function parseCSV(text) {
    var out = [], row = [], cur = '', inQ = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQ) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { row.push(cur.trim()); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur.trim()); out.push(row); row = []; cur = '';
      } else cur += c;
    }
    if (cur.length || row.length) { row.push(cur.trim()); out.push(row); }
    return out.filter(function (r) { return r.some(function (x) { return x; }); });
  }
  function fetchCSV(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(parseCSV);
  }
  function cleanURL(s) {
    // Sheet cells sometimes arrive wrapped in markdown (*_`) or with stray
    // whitespace. Trim those from the ends only; underscores and dashes are
    // legal inside URLs and YouTube ids.
    if (!s) return '';
    var c = String(s).replace(/[*`\s]/g, '');
    if (c.length > 2 && c[0] === '_' && c[c.length - 1] === '_') c = c.slice(1, -1); // _url_ italics
    return /^https?:\/\//.test(c) ? c : '';
  }
  function youtubeId(url) {
    var m = url.match(/(?:youtube\.com\/(?:watch\?v=|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : '';
  }
  function embedURL(url) {
    var id = youtubeId(url);
    return id ? 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0' : url;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtDate(s) {
    var d = new Date(s);
    if (isNaN(d)) return s || '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function num(s) { var n = parseFloat(String(s).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
  function fmtNum(n) { return n.toLocaleString('en-US', { maximumFractionDigits: 2 }); }

  // Rows from all season tabs, deduped (a show pasted into two tabs keeps the copy with hours),
  // newest first.
  // Resolves to { rows, failed } where failed counts season tabs that did not load.
  var allShowsPromise = null;
  function allShows() {
    if (allShowsPromise) return allShowsPromise;
    var urls = Object.keys(SHEETS.years).map(function (y) { return SHEETS.years[y]; });
    allShowsPromise = Promise.all(urls.map(function (u) { return fetchCSV(u).catch(function () { return null; }); }))
      .then(function (tabs) {
        var failed = tabs.filter(function (t) { return t === null; }).length;
        // A show pasted into two tabs (paid late, wrong season) is the same show:
        // merge it across tabs, keeping the copy with hours. Rows inside one tab
        // are always distinct shows, even with the same name on the same date.
        var seen = new Map(), list = [];
        tabs.forEach(function (rows, ti) {
          if (!rows) return;
          rows.slice(1).forEach(function (r) {
            if (!r[0] || !r[1]) return;
            var key = [r[0], r[1], r[2], r[3], r[4]].join('|');
            var have = seen.get(key);
            if (have && have.tab !== ti) {
              if (!have.row[5] && r[5]) { list[list.indexOf(have.row)] = r; have.row = r; }
              return;
            }
            seen.set(key, { tab: ti, row: r });
            list.push(r);
          });
        });
        list.sort(function (a, b) { return new Date(b[0]) - new Date(a[0]); });
        return { rows: list, failed: failed };
      });
    return allShowsPromise;
  }
  var totalsPromise = null;
  function totals() {
    if (!totalsPromise) totalsPromise = fetchCSV(SHEETS.totals);
    return totalsPromise;
  }

  // Availability, nav
  function availability() {
    var el = document.querySelector('[data-avail]');
    if (!el) return;
    totals().then(function (rows) {
      var v = (rows[1] && rows[1][9] || '').toUpperCase();
      if (v === 'TRUE') { el.textContent = 'Available for work'; el.classList.add('is-yes'); }
      else if (v === 'FALSE') { el.textContent = 'Booked up right now'; el.classList.add('is-no'); }
      else el.textContent = '';
    }).catch(function () { el.textContent = ''; });
  }

  // Totals line (home, services): "1,689 hours on air · 396 shows"
  function totalsLine() {
    var els = document.querySelectorAll('[data-total]');
    if (!els.length) return;
    totals().then(function (rows) {
      var t = rows.find(function (r) { return /^total$/i.test(r[0] || ''); });
      if (!t) return;
      els.forEach(function (el) {
        var k = el.getAttribute('data-total');
        if (k === 'hours') el.textContent = fmtNum(num(t[1]));
        if (k === 'shows') el.textContent = fmtNum(num(t[2]));
      });
      document.querySelectorAll('[data-totals-ready]').forEach(function (el) { el.hidden = false; });
    }).catch(function () {});
  }

  // Latest show with a VOD (home)
  function latest() {
    var box = document.querySelector('[data-latest]');
    if (!box) return;
    allShows().then(function (res) {
      // If any season tab failed, an older show could pose as the latest. Leave the slot empty.
      if (res.failed) return;
      var hit = res.rows.find(function (r) { return cleanURL(r[6]); });
      if (!hit) return;
      box.querySelector('iframe').src = embedURL(cleanURL(hit[6]));
      var cap = box.querySelector('[data-latest-cap]');
      if (cap) cap.innerHTML = '<span><b>' + esc(hit[1]) + '</b>' + (hit[2] ? ' · ' + esc(hit[2]) : '') + (hit[4] ? ' · ' + esc(hit[4]) : '') + '</span><span>' + esc(fmtDate(hit[0])) + '</span>';
      box.hidden = false;
    }).catch(function () {});
  }

  // Totals table by game (work)
  function totalsTable() {
    var tb = document.querySelector('[data-totals-table] tbody');
    if (!tb) return;
    totals().then(function (rows) {
      var games = rows.slice(1).filter(function (r) { return r[0] && !/^total$/i.test(r[0]); });
      games.sort(function (a, b) { return num(b[1]) - num(a[1]); });
      var html = games.map(function (r) {
        return '<tr><td>' + esc(r[0]) + '</td><td class="num">' + fmtNum(num(r[1])) + '</td><td class="num">' + fmtNum(num(r[2])) + '</td><td class="num">' + fmtNum(num(r[7])) + '</td><td class="num">' + fmtNum(num(r[5])) + '</td><td class="num">' + fmtNum(num(r[3])) + '</td></tr>';
      }).join('');
      var t = rows.find(function (r) { return /^total$/i.test(r[0] || ''); });
      if (t) html += '<tr class="total"><td>All games</td><td class="num">' + fmtNum(num(t[1])) + '</td><td class="num">' + fmtNum(num(t[2])) + '</td><td class="num">' + fmtNum(num(t[7])) + '</td><td class="num">' + fmtNum(num(t[5])) + '</td><td class="num">' + fmtNum(num(t[3])) + '</td></tr>';
      tb.innerHTML = html;
      var st = document.querySelector('[data-totals-state]'); if (st) st.hidden = true;
      document.querySelector('[data-totals-table]').hidden = false;
    }).catch(function () {
      var st = document.querySelector('[data-totals-state]'); if (st) st.textContent = 'The totals didn’t load. Try again in a minute.';
    });
  }

  // Show log with year filter (work)
  function showLog() {
    var tb = document.querySelector('[data-log] tbody');
    if (!tb) return;
    var state = document.querySelector('[data-log-state]');
    var filters = document.querySelector('[data-log-filters]');
    var current = (location.hash.match(/\d{4}/) || [])[0] || String(new Date().getFullYear());
    var rows = [];
    function render() {
      var sel = rows.filter(function (r) { return current === 'all' || String(new Date(r[0]).getFullYear()) === current; });
      if (!sel.length) { tb.innerHTML = ''; state.hidden = false; state.textContent = 'Nothing logged for ' + current + ' yet.'; return; }
      state.hidden = true;
      tb.innerHTML = sel.map(function (r) {
        var link = cleanURL(r[6]);
        var vod = link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener">Watch</a>' : '<span class="muted">' + esc(r[6] && !/^https?/.test(r[6]) ? r[6] : '—') + '</span>';
        return '<tr><td>' + esc(fmtDate(r[0])) + '</td><td>' + esc(r[1]) + '</td><td>' + esc(r[2] || '—') + '</td><td>' + esc(r[3] || '—') + '</td><td>' + esc(r[4] || '—') + '</td><td class="num">' + (r[5] ? esc(r[5]) : '—') + '</td><td>' + vod + '</td></tr>';
      }).join('');
      var count = document.querySelector('[data-log-count]');
      if (count) count.textContent = sel.length + (sel.length === 1 ? ' show' : ' shows');
    }
    if (filters) {
      filters.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-year') === current ? 'true' : 'false');
        b.addEventListener('click', function () {
          current = b.getAttribute('data-year');
          filters.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
          history.replaceState(null, '', current === 'all' ? location.pathname + location.search : '#' + current);
          render();
        });
      });
    }
    allShows().then(function (res) {
      rows = res.rows;
      if (!rows.length) throw new Error('empty');
      render();
      if (res.failed) {
        var warn = document.querySelector('[data-log-warn]');
        if (warn) { warn.hidden = false; warn.textContent = 'Part of the log didn’t load (' + res.failed + ' of 3 seasons). Refresh to try again.'; }
      }
    }).catch(function () { state.hidden = false; state.textContent = 'The show log didn’t load. Try again in a minute.'; });
  }

  // Scraper-safe email
  function email() {
    var els = document.querySelectorAll('[data-email]');
    if (!els.length) return;
    var addr = ['icefireideproduction', 'gmail.com'].join('@');
    els.forEach(function (el) {
      if (el.tagName === 'A') el.href = 'mailto:' + addr;
      var t = el.querySelector('[data-email-text]') || el;
      if (t !== el || el.getAttribute('data-email') === 'text') t.textContent = addr;
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    availability(); totalsLine(); latest(); totalsTable(); showLog(); email();
  });
})();
