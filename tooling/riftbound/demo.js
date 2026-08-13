/* Riftbound overlay — portfolio demo driver.
 *
 * THE POINT OF THIS FILE: overlay.js and overlay.css beside it are byte-for-byte
 * copies of the production broadcast tool. Nothing in them was changed to make
 * this demo work. Instead this file stands in for the two things the real tool
 * provides — a WebSocket pushing state snapshots, and an HTTP endpoint serving
 * the client's branding — so the genuine overlay code runs against its real
 * message contract. What you see on this page is what goes to air, driven the
 * same way.
 *
 * Both mocks are installed synchronously, before overlay.js (which is deferred)
 * gets to run its own connect() and applyBranding().
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. Stand in for the tool's WebSocket.
  // ---------------------------------------------------------------------------
  var listeners = {};
  var RealWebSocket = window.WebSocket;

  function FakeSocket() {
    this.readyState = 1;              // OPEN
    var self = this;
    listeners = {};
    setTimeout(function () { self._fire('open', {}); }, 0);
  }
  FakeSocket.prototype.addEventListener = function (type, fn) {
    (listeners[type] = listeners[type] || []).push(fn);
  };
  FakeSocket.prototype._fire = function (type, ev) {
    (listeners[type] || []).forEach(function (fn) { fn(ev); });
  };
  // The overlay acks every applied snapshot. Swallow it — there is no server.
  FakeSocket.prototype.send = function () {};
  FakeSocket.prototype.close = function () { this.readyState = 3; };
  FakeSocket.OPEN = 1;
  window.WebSocket = FakeSocket;
  window.WebSocket.OPEN = 1;
  window.__realWebSocket = RealWebSocket;

  function push(snapshot) {
    (listeners.message || []).forEach(function (fn) {
      fn({ data: JSON.stringify(snapshot) });
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Stand in for GET /api/branding/resolved.
  // ---------------------------------------------------------------------------
  // These are the real shipped client palettes, lifted from the tool's own
  // seed/default-profile.json. Every one passes the tool's six-way colour
  // separation check (ADR-0027).
  // Key names must match overlay.js's PALETTE_KEYS exactly (sideA, not
  // colorSideA). It skips any key it does not recognise without complaining,
  // so a wrong name here is silent: the palette button relabels itself and
  // changes nothing on screen.
  var PALETTES = [
    { id: 0, name: 'Riftbound Void',
      sideA: '#E63DFF', sideB: '#FFB020', bgVoid: '#0D0518', bgVoid2: '#1C0A30',
      glow3: '#8C3CDC', textBright: '#F3ECFF', textDim: '#B7A9D6',
      bfNeutral: '#5B5770', ink: '#170314' },
    { id: 1, name: 'Ember & Steel',
      sideA: '#FF7A1A', sideB: '#3FA7FF', bgVoid: '#0B0D12', bgVoid2: '#161C26',
      glow3: '#2E6BB8', textBright: '#EFF3F8', textDim: '#9FAEC2',
      bfNeutral: '#4B5462', ink: '#0B0D12' },
    { id: 2, name: 'Jade Court',
      sideA: '#2FD69A', sideB: '#FFC53D', bgVoid: '#04140F', bgVoid2: '#0B2A20',
      glow3: '#17806A', textBright: '#ECFBF4', textDim: '#9EC7B6',
      bfNeutral: '#48605A', ink: '#04140F' },
    { id: 3, name: 'Crimson League',
      sideA: '#FF3B4E', sideB: '#24E0E0', bgVoid: '#100A0C', bgVoid2: '#241318',
      glow3: '#9E2436', textBright: '#FBEFF1', textDim: '#C4A6AC',
      bfNeutral: '#5E4A4E', ink: '#100A0C' }
  ];

  var activePalette = 0;
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url) {
    if (typeof url === 'string' && url.indexOf('/api/branding/resolved') === 0) {
      var p = PALETTES[activePalette];
      return Promise.resolve({
        json: function () {
          return Promise.resolve({ palette: p, logoUrl: '' });
        }
      });
    }
    return realFetch ? realFetch.apply(null, arguments)
                     : Promise.reject(new Error('no fetch'));
  };

  // ---------------------------------------------------------------------------
  // 3. Demo state, shaped exactly like a real snapshot.
  // ---------------------------------------------------------------------------
  var CARDS = {
    champA:  { imageUrl: 'cards/champ-a.webp',   displayName: 'Vi — Piltover Enforcer',   accentColor: '#3FA7FF' },
    champB:  { imageUrl: 'cards/champ-b.webp',   displayName: 'Pyke — Bloodharbor Ripper', accentColor: '#2FD69A' },
    bfA:     { imageUrl: 'cards/bf-a.webp',      displayName: 'Star Spring' },
    bfB:     { imageUrl: 'cards/bf-b.webp',      displayName: 'Black Flame Altar' },
    hl:      { imageUrl: 'cards/highlight.webp', displayName: 'LeBlanc — Deceiver' }
  };

  var version = 0;
  var state = {
    nameA: 'VANGUARD', nameB: 'ECLIPSE',
    scoreA: 5, scoreB: 3,
    seriesA: 1, seriesB: 1, seriesLength: 3,
    turn: 'A',
    cameras: true,
    bf1: 'controlled-by-A', bf2: 'neutral',
    showHighlight: false,
    eventName: 'RIFTBOUND SHOWCASE'
  };

  function snapshot() {
    version += 1;
    return {
      type: 'state',
      version: version,
      match: {
        playerA: { name: state.nameA, score: state.scoreA, series: state.seriesA },
        playerB: { name: state.nameB, score: state.scoreB, series: state.seriesB },
        seriesLength: state.seriesLength,
        activeTurnSide: state.turn,
        camerasPresent: state.cameras,
        battlefields: [
          { id: 1, control: state.bf1 },
          { id: 2, control: state.bf2 }
        ],
        championA: CARDS.champA,
        championB: CARDS.champB,
        battlefieldACard: CARDS.bfA,
        battlefieldBCard: CARDS.bfB,
        activeCard: state.showHighlight ? CARDS.hl : null,
        eventName: state.eventName,
        activeProfileId: activePalette,
        // Bumping this is what makes the overlay re-fetch branding, exactly as a
        // profile switch does in the real tool.
        brandingRevision: activePalette + 1
      }
    };
  }

  function render() { push(snapshot()); }

  // ---------------------------------------------------------------------------
  // 4. Controls.
  // ---------------------------------------------------------------------------
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  var ACTIONS = {
    'score-a-up':   function () { state.scoreA = clamp(state.scoreA + 1, 0, 8); },
    'score-a-down': function () { state.scoreA = clamp(state.scoreA - 1, 0, 8); },
    'score-b-up':   function () { state.scoreB = clamp(state.scoreB + 1, 0, 8); },
    'score-b-down': function () { state.scoreB = clamp(state.scoreB - 1, 0, 8); },
    'turn':         function () {
      state.turn = state.turn === 'A' ? 'B' : state.turn === 'B' ? null : 'A';
    },
    'cameras':      function () { state.cameras = !state.cameras; },
    'highlight':    function () { state.showHighlight = !state.showHighlight; },
    'control':      function () {
      var cyc = ['neutral', 'controlled-by-A', 'controlled-by-B'];
      state.bf2 = cyc[(cyc.indexOf(state.bf2) + 1) % cyc.length];
      state.bf1 = cyc[(cyc.indexOf(state.bf1) + 2) % cyc.length];
    },
    'palette':      function () {
      activePalette = (activePalette + 1) % PALETTES.length;
    },
    'reset':        function () {
      state.scoreA = 5; state.scoreB = 3; state.turn = 'A';
      state.cameras = true; state.showHighlight = false;
      state.bf1 = 'controlled-by-A'; state.bf2 = 'neutral';
      activePalette = 0;
    }
  };

  var LABELS = {
    turn: function () {
      return 'Turn: ' + (state.turn === null ? 'none' : state.turn);
    },
    cameras: function () { return 'Cameras: ' + (state.cameras ? 'on' : 'off'); },
    highlight: function () {
      return state.showHighlight ? 'Highlight: shown' : 'Highlight: card back';
    },
    palette: function () { return 'Palette: ' + PALETTES[activePalette].name; }
  };

  function refreshLabels() {
    Object.keys(LABELS).forEach(function (k) {
      var el = document.querySelector('[data-act="' + k + '"] .lbl');
      if (el) el.textContent = LABELS[k]();
    });
  }

  // Scale the fixed 1920x1080 stage down to whatever width the page gives it.
  // A transformed ancestor becomes the containing block for position:fixed
  // descendants, which is what lets the real stage sit inside this page at all.
  function fit() {
    var frame = document.getElementById('stage-frame');
    var box = document.getElementById('stage-box');
    if (!frame || !box) return;
    var s = box.clientWidth / 1920;
    frame.style.transform = 'scale(' + s + ')';
    box.style.height = (1080 * s) + 'px';
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-act]');
      if (!btn) return;
      var fn = ACTIONS[btn.getAttribute('data-act')];
      if (!fn) return;
      fn();
      refreshLabels();
      render();
    });
    window.addEventListener('resize', fit);
    fit();
    refreshLabels();
    render();
  });
})();
