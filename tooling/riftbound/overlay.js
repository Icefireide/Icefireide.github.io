'use strict';

// Riftbound Broadcast Tool — Display overlay client.
//
// Redesigned per ADR-0023/0024/0025/0026/0028/0029. The invariants from the
// original Step 4 build are unchanged and still govern this file:
//
//   * Every DOM node is looked up ONCE below, against markup that already
//     exists in index.html. Nothing here calls createElement or rewrites
//     innerHTML for a snapshot update — only textContent, classList, and a
//     handful of attributes, for the whole life of the page. The one
//     exception is buildTrack()/buildSeries(), which run ONCE at startup to
//     lay out a fixed number of pips and never again.
//   * ADR-0016: the overlay never visibly changes during a data-uncertain
//     interval. Not on a discarded snapshot, not on a dead socket, not before
//     a first connection, not during the recovery window. Reconnecting is not
//     a visual event.
//   * ADR-0015: elements render EMPTY until a real snapshot arrives — never a
//     placeholder, not even 0.
//
// Snapshot fields read here are the ones server.js buildSnapshot() actually
// sends. Every addition is read defensively: an older server that does not
// send activeTurnSide / camerasPresent / championA / etc. degrades to the
// absent state rather than throwing, which is also exactly the correct render.

var els = {
  stage: document.getElementById('stage'),
  track: document.getElementById('track'),
  colA: document.getElementById('colA'),
  colB: document.getElementById('colB'),
  nameA: document.getElementById('nameA'),
  nameB: document.getElementById('nameB'),
  pnameA: document.getElementById('pnameA'),
  pnameB: document.getElementById('pnameB'),
  seriesA: document.getElementById('seriesA'),
  seriesB: document.getElementById('seriesB'),
  camGapA: document.getElementById('camGapA'),
  camGapB: document.getElementById('camGapB'),
  ctrlBarA: document.getElementById('ctrlBarA'),
  ctrlBarB: document.getElementById('ctrlBarB'),
  eventBlock: document.getElementById('eventBlock'),
  eventName: document.getElementById('eventName'),
  eventLogo: document.getElementById('eventLogo'),
  hlFlip: document.getElementById('hlFlip'),
  hlBackLogo: document.getElementById('hlBackLogo'),
};

// Card slots. Each is one persistent <img> plus its missing-asset fallback,
// wired identically, so applyCardSlot() below is the only card-rendering path.
function slot(wrapId, imgId, missNameId) {
  return {
    wrap: document.getElementById(wrapId),
    img: document.getElementById(imgId),
    missName: document.getElementById(missNameId),
    lastUrl: null,
  };
}
var slots = {
  champA: slot('champWrapA', 'champImgA', 'champMissNameA'),
  champB: slot('champWrapB', 'champImgB', 'champMissNameB'),
  bfA: slot('bfWrapA', 'bfImgA', 'bfMissNameA'),
  bfB: slot('bfWrapB', 'bfImgB', 'bfMissNameB'),
  highlight: slot('hlWrap', 'hlImg', 'hlMissName'),
};
// The highlight slot alone reveals by flipping a two-faced frame (ADR-0034).
// Everything else about it — the missing-asset path, the URL diff, the
// persistent nodes — is identical to the other four.
slots.highlight.flip = true;
slots.highlight.flipToken = 0;

// -1 so version 0 — the very first snapshot a fresh DB produces — is still
// strictly greater and gets applied. Mirrors the server's own default.
var lastAppliedVersion = -1;
var lastAppliedBrandingRevision = null;

window.__diag = {
  snapshotsApplied: 0,
  snapshotsDiscarded: 0,
  cardTriggers: 0,
  domNodeCount: 0,
  lastAppliedVersion: -1,
};

// ---------------------------------------------------------------------------
// Texture rasterisation — ADR-0029. Runs ONCE, at startup.
//
// These were live SVG feTurbulence filters. That is the wrong mechanism for a
// page that is never reloaded during a nine-to-twelve hour show: feTurbulence
// is CPU-evaluated in most browsers, AND a filtered element that animates a
// transform can force the whole field to recompute every frame. With grain on
// every panel plus an animated smoke layer that was several noise fields per
// panel per frame — a cost a short preview only makes "feel sluggish" and a
// full show does not forgive.
//
// Baking to a data URI turns all of it into a texture blit. Smoke is baked as
// an ALPHA MASK and tinted live from a palette token, so re-theming for a
// client (ADR-0026) costs nothing: the expensive part never recomputes.
//
// Same discipline ADR-0005 already applies to card art: build at startup, hold
// a strong reference, never recompute.
// ---------------------------------------------------------------------------
(function bakeTextures() {
  function rnd(x, y, s) {
    var n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 362437);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }
  function vnoise(x, y, s) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = rnd(xi, yi, s), b = rnd(xi + 1, yi, s);
    var c = rnd(xi, yi + 1, s), d = rnd(xi + 1, yi + 1, s);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }
  function fbm(x, y, oct, s) {
    var sum = 0, amp = 0.5, f = 1, norm = 0;
    for (var i = 0; i < oct; i++) {
      sum += amp * vnoise(x * f, y * f, s + i);
      norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  }
  function tile(w, h, paint) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    var img = ctx.createImageData(w, h), d = img.data;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var px = paint(x, y, w, h), i = (y * w + x) * 4;
        d[i] = px[0]; d[i + 1] = px[1]; d[i + 2] = px[2]; d[i + 3] = px[3];
      }
    }
    ctx.putImageData(img, 0, 0);
    return 'url("' + c.toDataURL('image/png') + '")';
  }

  try {
    // Grain: per-pixel noise, tiles seamlessly because it has no spatial
    // coherence to break at the edge. Neutral — never tinted.
    var grain = tile(128, 128, function (x, y) {
      return [255, 255, 255, rnd(x, y, 11) * 128];
    });
    // Smoke: low-frequency fBm as an alpha mask, stretched to the panel rather
    // than tiled so there are no seams to hide.
    var smoke = tile(150, 300, function (x, y, w, h) {
      var v = fbm(x / w * 3.2, y / h * 6.4, 4, 3);
      v = Math.max(0, (v - 0.42) * 2.1);
      return [255, 255, 255, Math.min(255, v * 235)];
    });
    var r = document.documentElement.style;
    r.setProperty('--tex-grain', grain);
    r.setProperty('--tex-smoke', smoke);
  } catch (err) {
    // A canvas failure must never take the overlay down — the panels simply
    // render without texture, which is a correct, legible fallback.
    console.error('texture bake failed:', err);
  }
})();

// ---------------------------------------------------------------------------
// One-time DOM construction. Runs at startup only — never per snapshot.
// ---------------------------------------------------------------------------

var TRACK_PIPS = [];
(function buildTrack() {
  // 1..8 for Side A, then 8..1 for Side B. The centre 8 is rendered twice, one
  // per side, so each side owns its own final pip — neither has to win a tie
  // for a shared node, and each can light independently at match point.
  function add(side, value) {
    var el = document.createElement('span');
    el.className = 'track-pip' + (value === 8 ? ' eight' : '');
    el.textContent = String(value);
    els.track.appendChild(el);
    TRACK_PIPS.push({ el: el, side: side, value: value });
  }
  var i;
  for (i = 1; i <= 8; i++) add('A', i);
  for (i = 8; i >= 1; i--) add('B', i);
})();

var seriesPips = { A: [], B: [] };
function buildSeries(container, side, count) {
  container.textContent = '';
  seriesPips[side] = [];
  for (var i = 0; i < count; i++) {
    var el = document.createElement('span');
    el.className = 'series-pip';
    container.appendChild(el);
    seriesPips[side].push(el);
  }
}
var seriesLengthBuilt = null;

// ---------------------------------------------------------------------------
// Renderers. Each touches only classList / textContent / attributes.
// ---------------------------------------------------------------------------

function applyTrack(scoreA, scoreB) {
  for (var i = 0; i < TRACK_PIPS.length; i++) {
    var p = TRACK_PIPS[i];
    var score = p.side === 'A' ? scoreA : scoreB;
    p.el.classList.remove('trail-a', 'trail-b', 'lead-a', 'lead-b');
    if (typeof score !== 'number' || score <= 0) continue;
    if (p.value === score) {
      p.el.classList.add(p.side === 'A' ? 'lead-a' : 'lead-b');
    } else if (p.value < score) {
      p.el.classList.add(p.side === 'A' ? 'trail-a' : 'trail-b');
    }
  }
}

function applySeries(side, won, length) {
  var container = side === 'A' ? els.seriesA : els.seriesB;
  if (!length || length < 1) {
    // ADR-0014: the tool must not assume a best-of format. With no length set,
    // fall back to a plain numeral rather than inventing a denominator.
    container.textContent = '';
    var n = document.createElement('span');
    n.className = 'series-num';
    n.textContent = typeof won === 'number' ? String(won) : '';
    container.appendChild(n);
    seriesPips[side] = [];
    return;
  }
  if (seriesLengthBuilt !== length || seriesPips[side].length !== length) {
    buildSeries(container, side, length);
  }
  for (var i = 0; i < seriesPips[side].length; i++) {
    seriesPips[side][i].classList.toggle('won', i < (won || 0));
  }
}

function applyControl(barEl, control, nameA, nameB) {
  barEl.classList.remove('ctrl-a', 'ctrl-b');
  if (control === 'controlled-by-A') {
    barEl.classList.add('ctrl-a');
    barEl.textContent = (nameA || 'Side A') + ' holds';
  } else if (control === 'controlled-by-B') {
    barEl.classList.add('ctrl-b');
    barEl.textContent = (nameB || 'Side B') + ' holds';
  } else {
    // 'uncontested', or anything unrecognised — neutral is the safe default,
    // never a coloured state for a value that is not actually A or B.
    barEl.textContent = 'Uncontested';
  }
}

// The single card-rendering path, used by all five slots. Tracks the applied
// URL rather than reading els.img.src back, because a browser normalises an
// assigned relative src into an absolute one — comparing against the
// snapshot's own relative imageUrl would otherwise always read as "changed".
// Read back from the stylesheet rather than repeating 450ms here. It keeps one
// source of truth for the duration, and it means prefers-reduced-motion — which
// sets transition:none, so this reads 0 — makes every deferred step below run
// immediately, with no separate branch for it.
function flipDurationMs() {
  var d = String(getComputedStyle(els.hlFlip).transitionDuration || '0s').split(',')[0].trim();
  var n = parseFloat(d) || 0;
  return /ms$/.test(d) ? n : n * 1000;
}
function afterFlip(fn) {
  // setTimeout rather than 'transitionend', for two reasons. An interrupted
  // transition does not fire the event, and an interrupted flip is the normal
  // case here (trigger a second card while the first is still turning). And a
  // hidden page does not run transitions at all, so transitionend would never
  // arrive and the deferred cleanup would simply never happen. A timer always
  // resolves; the token check is what makes a superseded one harmless.
  //
  // Timers are throttled on a hidden page, so a flip can take longer than
  // 450ms to finish resolving there. That is only ever true when the source is
  // not being rendered, and the end state is correct regardless of when it
  // lands, so it costs nothing on air.
  setTimeout(fn, flipDurationMs() + 20);
}

// The highlight card's reveal (ADR-0034). Flips ONLY on a genuine card change —
// same URL diff the other slots use — so a reconnect or a redelivered snapshot
// never moves it. That is the property that keeps this inside ADR-0016.
function applyHighlightSlot(s, card) {
  var url = card && card.imageUrl ? card.imageUrl : null;
  if (url === s.lastUrl) return; // covers same-card AND empty-stays-empty
  s.lastUrl = url;

  // Every deferred step below is stamped. A newer change invalidates an older
  // one mid-flight, so triggering card B while card A is still turning away
  // cannot have A's cleanup land on top of B.
  var token = ++s.flipToken;

  if (!url) {
    s.wrap.classList.remove('revealed');
    afterFlip(function () {
      if (token !== s.flipToken) return;
      // Deferred, not immediate: clearing src or adding .empty up front would
      // blank the front face while it is still the visible half of the turn.
      s.wrap.classList.add('empty');
      s.wrap.classList.remove('asset-missing');
      s.img.removeAttribute('src');
      s.missName.textContent = '';
    });
    return;
  }

  var reveal = function () {
    if (token !== s.flipToken) return;
    s.wrap.classList.remove('empty');
    s.wrap.classList.remove('asset-missing');
    s.missName.textContent = card.displayName || '';
    s.img.src = url;
    window.__diag.cardTriggers += 1;
    // Force a synchronous style flush so the browser has committed the
    // pre-flip transform, then flip in the same task. The transition still
    // runs, because the old value is now the committed one.
    //
    // DELIBERATELY NOT requestAnimationFrame, which is the obvious way to
    // write this and is wrong here. rAF does not fire at all while a page is
    // hidden, and a browser source that is not currently being rendered is
    // precisely the source that is about to be cut to. Written with rAF this
    // set the src and then never added .revealed, leaving the card face-down
    // permanently — measured, not theorised: the harness page reports
    // visibilityState 'hidden' and no rAF callback inside 200ms.
    //
    // A hidden page will not animate the rotation either, but that only costs
    // the motion: the end state is applied by class, so the card is correct
    // the moment the page is rendered again.
    void s.wrap.offsetWidth;
    s.wrap.classList.add('revealed');
  };

  // C21 replaces immediately. A card already showing turns back to the brand
  // face first, then out again with the new card — so the two are never seen
  // cross-fading into each other, and the back always reads as the boundary
  // between them.
  if (s.wrap.classList.contains('revealed')) {
    s.wrap.classList.remove('revealed');
    afterFlip(reveal);
  } else {
    reveal();
  }
}

function applyCardSlot(s, card) {
  if (s.flip) { applyHighlightSlot(s, card); return; }
  if (!card || !card.imageUrl) {
    s.wrap.classList.add('empty');
    s.wrap.classList.remove('asset-missing');
    s.img.removeAttribute('src');
    s.missName.textContent = '';
    s.lastUrl = null;
    return;
  }
  s.wrap.classList.remove('empty');
  if (card.imageUrl !== s.lastUrl) {
    s.lastUrl = card.imageUrl;
    s.wrap.classList.remove('asset-missing');
    s.missName.textContent = card.displayName || '';
    s.img.src = card.imageUrl;
    window.__diag.cardTriggers += 1;
  }
}

// Attached once, for the life of the page. This is the one case (C16) where
// the overlay DOES visibly change to show absence — distinct from ADR-0016's
// connection-uncertainty rule, which this does not touch.
Object.keys(slots).forEach(function (k) {
  var s = slots[k];
  s.img.addEventListener('error', function () {
    // A bare <img> with no src attribute does not fire 'error' in a real
    // browser, but stay defensive rather than relying on that.
    if (!s.img.getAttribute('src')) return;
    s.wrap.classList.add('asset-missing');
  });
});

// ADR-0026: the whole palette is client-themeable and resolves from the active
// Profile. Derives the -rgb triples the glow rules need, because rgba() cannot
// take a hex token and color-mix() is not safe to assume in the Chromium builds
// OBS and vMix embed (C20).
function hexToRgbTriple(hex) {
  var c = String(hex || '').trim().replace(/^#/, '');
  if (c.length === 3) c = c.split('').map(function (x) { return x + x; }).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(c)) return null;
  var n = parseInt(c, 16);
  return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
}

var PALETTE_KEYS = {
  sideA: '--side-a',
  sideB: '--side-b',
  bgVoid: '--bg-void',
  bgVoid2: '--bg-void-2',
  glow3: '--glow-3',
  textBright: '--text-bright',
  textDim: '--text-dim',
  bfNeutral: '--bf-neutral',
  ink: '--ink',
};
var RGB_KEYS = { sideA: '--side-a-rgb', sideB: '--side-b-rgb', glow3: '--glow-3-rgb', textBright: '--text-bright-rgb' };

function applyBranding(activeProfileId) {
  var url = '/api/branding/resolved';
  if (activeProfileId !== null && activeProfileId !== undefined) {
    url += '?profileId=' + encodeURIComponent(activeProfileId);
  }
  fetch(url)
    .then(function (res) { return res.json(); })
    .then(function (b) {
      var root = document.documentElement.style;
      var p = b && b.palette;
      if (p) {
        Object.keys(PALETTE_KEYS).forEach(function (k) {
          if (p[k]) root.setProperty(PALETTE_KEYS[k], p[k]);
        });
        Object.keys(RGB_KEYS).forEach(function (k) {
          var triple = hexToRgbTriple(p[k]);
          if (triple) root.setProperty(RGB_KEYS[k], triple);
        });
      }
      // Empty string is a deliberate, valid value — it is what puts the CSS
      // "no src at all" rule back in effect when a profile has no logo.
      els.eventLogo.src = b && b.logoUrl ? b.logoUrl : '';
      // The card back carries the same logo (ADR-0034). Same empty-string
      // convention, which is what re-arms the CSS "no src" rule on the back.
      els.hlBackLogo.src = b && b.logoUrl ? b.logoUrl : '';
      updateEventVisibility();
    })
    .catch(function (err) {
      // A failed branding fetch leaves whatever was already applied in place.
      // Never a visual event of its own — ADR-0016 governs this exactly as it
      // governs a dead socket.
      console.error('branding fetch failed:', err);
    });
}

function updateEventVisibility() {
  var hasName = els.eventName.textContent !== '';
  var hasLogo = !!els.eventLogo.getAttribute('src');
  els.eventBlock.classList.toggle('empty', !hasName && !hasLogo);
}

// ---------------------------------------------------------------------------

function applySnapshot(snapshot) {
  // Client discard rule (ADR-0009/A12): a snapshot at or behind what is
  // already applied is dropped silently, with no DOM touched and no re-render.
  // "Not strictly newer" means <=, not <. This is what stops a reconnect-
  // delivered stale snapshot reverting a correct on-air score.
  if (!snapshot || typeof snapshot.version !== 'number' || snapshot.version <= lastAppliedVersion) {
    window.__diag.snapshotsDiscarded += 1;
    return;
  }

  var m = snapshot.match || {};
  var a = m.playerA || {};
  var b = m.playerB || {};

  els.nameA.textContent = a.name || '';
  els.nameB.textContent = b.name || '';

  applyTrack(a.score, b.score);

  var len = typeof m.seriesLength === 'number' ? m.seriesLength : 3;
  if (seriesLengthBuilt !== len) {
    buildSeries(els.seriesA, 'A', len > 0 ? len : 0);
    buildSeries(els.seriesB, 'B', len > 0 ? len : 0);
    seriesLengthBuilt = len;
  }
  applySeries('A', a.series, len);
  applySeries('B', b.series, len);

  // ADR-0023: null activeTurnSide is a real value meaning "no active turn" —
  // it lights neither dot and dims neither column, so a forgotten turn advance
  // reads as absent rather than as the wrong player being live.
  // The active side's NAME lights up rather than a leading dot: a dot in the
  // text flow is asymmetric and drags the name off the axis the series pips
  // centre on, which no spacer can fix (see .pname in overlay.css). Glowing the
  // name is symmetric for any name length.
  var turn = m.activeTurnSide || null;
  els.pnameA.classList.toggle('live', turn === 'A');
  els.pnameB.classList.toggle('live', turn === 'B');
  els.colA.classList.toggle('idle', turn === 'B');
  els.colB.classList.toggle('idle', turn === 'A');

  // ADR-0025: cameras are a rig property. Off closes the column up entirely
  // rather than leaving a framed gap with nothing behind it.
  els.stage.classList.toggle('no-cams', !m.camerasPresent);

  var bfs = Array.isArray(m.battlefields) ? m.battlefields : [];
  for (var i = 0; i < bfs.length; i++) {
    var bar = bfs[i].id === 1 ? els.ctrlBarA : bfs[i].id === 2 ? els.ctrlBarB : null;
    if (bar) applyControl(bar, bfs[i].control, a.name, b.name);
  }
  // scoredThisTurn and scoredBy are deliberately never read here — they are
  // panel-only advisory state and must not reach air (ADR-0008).

  applyCardSlot(slots.champA, m.championA);
  applyCardSlot(slots.champB, m.championB);
  applyCardSlot(slots.bfA, m.battlefieldACard);
  applyCardSlot(slots.bfB, m.battlefieldBCard);
  applyCardSlot(slots.highlight, m.activeCard);

  // ADR-0028: champion colour as light. transparent means "no champion set"
  // and renders as no wash at all, which is a correct empty state.
  var root = document.documentElement.style;
  root.setProperty('--champ-a', (m.championA && m.championA.accentColor) || 'transparent');
  root.setProperty('--champ-b', (m.championB && m.championB.accentColor) || 'transparent');

  els.eventName.textContent = typeof m.eventName === 'string' ? m.eventName : '';
  updateEventVisibility();

  // Branding re-fetches only when brandingRevision actually moves — never on
  // every snapshot. A profile switch or a palette edit is what bumps it.
  if (typeof m.brandingRevision === 'number' && m.brandingRevision !== lastAppliedBrandingRevision) {
    lastAppliedBrandingRevision = m.brandingRevision;
    applyBranding(m.activeProfileId);
  }

  lastAppliedVersion = snapshot.version;
  window.__diag.snapshotsApplied += 1;
  window.__diag.lastAppliedVersion = lastAppliedVersion;
  window.__diag.domNodeCount = document.querySelectorAll('*').length;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ack', version: lastAppliedVersion }));
  }
}

// --- WebSocket connect + exponential reconnect backoff ---------------------
//
// The ONLY setTimeout in this file, and only one instance is ever outstanding.
// Reconnecting is never a visual event (ADR-0016) — nothing here touches the
// DOM.

var ws = null;
var reconnectTimer = null;
var reconnectDelay = 1000;
var RECONNECT_CEILING_MS = 10000;

function connect() {
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/overlay/');

  ws.addEventListener('open', function () {
    reconnectDelay = 1000;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  });

  ws.addEventListener('message', function (event) {
    var msg;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      return; // malformed frame — silently ignored, never a visual event
    }
    if (msg && msg.type === 'state') applySnapshot(msg);
  });

  ws.addEventListener('close', scheduleReconnect);
  ws.addEventListener('error', function () {
    try { ws.close(); } catch (err) { /* already closing */ }
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return; // one timer at a time, forever
  reconnectTimer = setTimeout(function () {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_CEILING_MS);
    connect();
  }, reconnectDelay);
}

connect();
