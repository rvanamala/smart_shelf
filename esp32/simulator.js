#!/usr/bin/env node
/**
 * Smart Shelf — ESP32 Simulator
 *
 * Runs a real HTTP server that mirrors the rack controller API so the PWA
 * can be tested end-to-end without physical hardware.
 *
 * Usage:
 *   npm run sim                        default port 3001, 30 s glow, 50 shelves
 *   PORT=8080 npm run sim              custom port
 *   GLOW_SECS=10 npm run sim           shorter glow for quick testing
 *   SHELF_COUNT=100 npm run sim        larger rack
 *
 * API  (same as real ESP32):
 *   POST /light  { "shelf": 42, "color": "green" }
 *   POST /off    { "shelf": 42 }   or   {}  to clear all
 *   GET  /status → { "lit": [{ "shelf": 42, "color": "green", "seconds_left": 21 }] }
 *   GET  /health → "ok"
 *   GET  /       → live visual simulator UI (open in browser)
 *
 * Point the PWA's "ESP32 Base URL" setting to:
 *   http://<your-lan-ip>:3001
 */

import http from 'http';
import os   from 'os';

const PORT        = Number(process.env.PORT)        || 3001;
const GLOW_SECS   = Number(process.env.GLOW_SECS)   || 30;
const SHELF_COUNT = Number(process.env.SHELF_COUNT)  || 50;

// ── State ─────────────────────────────────────────────────────────────────────
// shelf (number) → { color: string, expiresAt: number, timerId }
const shelves    = new Map();
const sseClients = new Set();
const apiLog     = [];   // newest first; capped at LOG_MAX
const LOG_MAX    = 50;

// ── Helpers ───────────────────────────────────────────────────────────────────
function localIP() {
  for (const nets of Object.values(os.networkInterfaces()))
    for (const n of nets)
      if (n.family === 'IPv4' && !n.internal) return n.address;
  return 'localhost';
}

function getSnapshot() {
  const t = Date.now();
  return [...shelves.entries()]
    .map(([shelf, { color, expiresAt }]) => ({
      shelf,
      color,
      seconds_left: Math.max(0, Math.ceil((expiresAt - t) / 1000)),
    }))
    .sort((a, b) => a.shelf - b.shelf);
}

function pushLog(method, url, body, status) {
  apiLog.unshift({ t: new Date().toLocaleTimeString('en-GB'), method, url, body, status });
  if (apiLog.length > LOG_MAX) apiLog.length = LOG_MAX;
}

function broadcast() {
  const msg = 'data: ' + JSON.stringify({ lit: getSnapshot(), log: apiLog }) + '\n\n';
  for (const r of sseClients) r.write(msg);
}

// ── LED actions ───────────────────────────────────────────────────────────────
function lightShelf(shelf, color) {
  const existing = shelves.get(shelf);
  if (existing) clearTimeout(existing.timerId);
  const expiresAt = Date.now() + GLOW_SECS * 1000;
  const timerId   = setTimeout(() => { shelves.delete(shelf); broadcast(); }, GLOW_SECS * 1000);
  shelves.set(shelf, { color, expiresAt, timerId });
  broadcast();
}

function offShelf(shelf) {
  const e = shelves.get(shelf);
  if (e) { clearTimeout(e.timerId); shelves.delete(shelf); }
  broadcast();
}

function offAll() {
  for (const { timerId } of shelves.values()) clearTimeout(timerId);
  shelves.clear();
  broadcast();
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJSON(res, status, body) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise(resolve => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 8192) buf = buf.slice(0, 8192); });
    req.on('end',  () => { try { resolve(JSON.parse(buf || '{}')); } catch { resolve({}); } });
  });
}

// ── Request handler ───────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  // CORS preflight
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  // GET /health
  if (req.method === 'GET' && url === '/health') {
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    pushLog('GET', '/health', null, 200);
    broadcast();
    return;
  }

  // GET /status
  if (req.method === 'GET' && url === '/status') {
    sendJSON(res, 200, { lit: getSnapshot() });
    pushLog('GET', '/status', null, 200);
    broadcast();
    return;
  }

  // GET /events  (SSE — for the live UI)
  if (req.method === 'GET' && url === '/events') {
    cors(res);
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection:      'keep-alive',
    });
    res.write('data: ' + JSON.stringify({ lit: getSnapshot(), log: apiLog }) + '\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // GET /  — visual UI
  if (req.method === 'GET' && (url === '/' || url === '')) {
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(UI);
    return;
  }

  // POST /light
  if (req.method === 'POST' && url === '/light') {
    const body = await readBody(req);
    if (typeof body.shelf !== 'number' || !Number.isFinite(body.shelf)) {
      sendJSON(res, 400, { error: 'shelf must be a number' });
      pushLog('POST', '/light', body, 400);
      broadcast();
      return;
    }
    const color = (typeof body.color === 'string' && body.color) ? body.color : 'green';
    lightShelf(body.shelf, color);
    sendJSON(res, 200, { ok: true });
    pushLog('POST', '/light', body, 200);
    console.log('  [LIGHT] shelf=' + body.shelf + '  color=' + color + '  (' + GLOW_SECS + 's)');
    return;
  }

  // POST /off
  if (req.method === 'POST' && url === '/off') {
    const body = await readBody(req);
    if (body.shelf !== undefined) {
      offShelf(Number(body.shelf));
      console.log('  [OFF]   shelf=' + body.shelf);
    } else {
      offAll();
      console.log('  [OFF]   all shelves');
    }
    sendJSON(res, 200, { ok: true });
    pushLog('POST', '/off', body, 200);
    return;
  }

  sendJSON(res, 404, { error: 'Not found' });
});

// Tick the countdown every second while any shelf is lit
setInterval(() => { if (shelves.size > 0) broadcast(); }, 1000);

// ── Startup ───────────────────────────────────────────────────────────────────
const IP = localIP();
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Smart Shelf Simulator');
  console.log('  ─────────────────────────────────────────');
  console.log('  UI      →  http://localhost:' + PORT);
  console.log('  Network →  http://' + IP + ':' + PORT);
  console.log('  Glow    →  ' + GLOW_SECS + 's  (override: GLOW_SECS=10 npm run sim)');
  console.log('  Shelves →  ' + SHELF_COUNT + '  (override: SHELF_COUNT=100 npm run sim)');
  console.log('\n  Set PWA "ESP32 Base URL" to:  http://' + IP + ':' + PORT);
  console.log('  ─────────────────────────────────────────\n');
});

// ── Embedded live UI ──────────────────────────────────────────────────────────
const UI = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Smart Shelf Simulator</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:        #07111e;
  --surface:   #0c1929;
  --surface2:  #142235;
  --border:    #1b2d42;
  --border2:   #243850;
  --text:      #cdd9e8;
  --dim:       #4a6480;
  --muted:     #253547;
  --accent:    #22c55e;
  --font-mono: 'SF Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
}

html, body {
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.5;
}

body { display: flex; flex-direction: column; }

/* ── Header ── */
header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 10px 18px;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
}

.logo {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--text);
  white-space: nowrap;
}

.logo em {
  font-style: normal;
  color: var(--accent);
}

.header-meta {
  display: flex;
  gap: 16px;
  color: var(--dim);
  font-size: 11px;
  flex-wrap: wrap;
}

.pill {
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 2px 9px;
  white-space: nowrap;
}

.conn {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: 11px;
  color: var(--dim);
  white-space: nowrap;
}

.dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: #ef4444;
  flex-shrink: 0;
  transition: background .3s, box-shadow .3s;
}
.dot.live { background: var(--accent); box-shadow: 0 0 8px var(--accent); }

/* ── Layout ── */
main {
  display: grid;
  grid-template-columns: 1fr 300px;
  flex: 1;
  min-height: 0;
}
@media (max-width: 780px) {
  main { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
}

/* ── Shelf panel ── */
.shelf-panel {
  padding: 16px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-hd {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--dim);
}

.panel-hd .count {
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 7px;
  color: var(--text);
  font-size: 11px;
  text-transform: none;
  letter-spacing: 0;
}

.shelf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
  gap: 5px;
}

.cell {
  aspect-ratio: 1;
  border-radius: 5px;
  background: var(--surface);
  border: 1px solid var(--border);
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: background .35s ease, border-color .35s ease, box-shadow .35s ease;
  cursor: default;
  user-select: none;
}

.cell-num {
  position: absolute;
  top: 5px; left: 6px;
  font-size: 9px;
  font-weight: 600;
  color: var(--muted);
  transition: color .35s;
}

.cell.lit .cell-num { color: rgba(255,255,255,.55); }

.cell-cd {
  font-size: 20px;
  font-weight: 700;
  color: transparent;
  line-height: 1;
  transition: color .35s;
}

.cell-label {
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: transparent;
  margin-top: 3px;
  transition: color .35s;
}

.cell.lit .cell-cd    { color: #fff; }
.cell.lit .cell-label { color: rgba(255,255,255,.65); }

/* ── Log + controls panel ── */
.side-panel {
  border-left: 1px solid var(--border);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.side-hd {
  padding: 11px 14px;
  border-bottom: 1px solid var(--border);
  font-size: 10px;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--dim);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.log-scroll { overflow-y: auto; flex: 1; min-height: 0; }

.log-row {
  padding: 7px 14px;
  border-bottom: 1px solid var(--border);
  animation: slideIn .18s ease;
}
@keyframes slideIn {
  from { opacity: 0; transform: translateY(-3px); }
  to   { opacity: 1; transform: none; }
}

.log-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  flex-wrap: wrap;
}

.log-time  { color: var(--dim); }

.badge {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.badge.POST { background: #2d1500; color: #fb923c; }
.badge.GET  { background: #071b3b; color: #60a5fa; }
.badge.s200 { background: #052214; color: #4ade80; }
.badge.s400 { background: #2d0707; color: #f87171; }

.log-url { color: var(--text); font-size: 10px; }

.log-body {
  font-size: 9px;
  color: var(--dim);
  margin-top: 2px;
  word-break: break-all;
}

/* ── Controls ── */
.controls {
  border-top: 1px solid var(--border);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  flex-shrink: 0;
}

.ctrl-label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: .1em;
  color: var(--dim);
}

.ctrl-row { display: flex; gap: 5px; align-items: center; }

.ctrl-row input, .ctrl-row select {
  background: var(--surface2);
  border: 1px solid var(--border2);
  border-radius: 4px;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 5px 7px;
  outline: none;
  transition: border-color .15s;
}
.ctrl-row input:focus, .ctrl-row select:focus { border-color: var(--accent); }
.ctrl-row input[type=number] { width: 58px; }
.ctrl-row select { flex: 1; }

.btn {
  background: var(--surface2);
  border: 1px solid var(--border2);
  border-radius: 4px;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  padding: 5px 10px;
  cursor: pointer;
  white-space: nowrap;
  transition: background .15s, border-color .15s;
}
.btn:hover  { background: var(--border2); }
.btn.go     { background: #092b16; border-color: #16613a; color: #4ade80; }
.btn.go:hover { background: #15803d; color: #fff; }
.btn.off    { background: #1a0a0a; border-color: #5b1c1c; color: #f87171; }
.btn.off:hover { background: #7f1d1d; color: #fff; }

/* ── Empty state ── */
.empty {
  padding: 24px 14px;
  color: var(--dim);
  font-size: 11px;
  text-align: center;
}
</style>
</head>
<body>

<header>
  <div class="logo">Smart Shelf <em>//</em> ESP32 Simulator</div>
  <div class="header-meta">
    <span class="pill" id="pillPort">:${PORT}</span>
    <span class="pill">glow&nbsp;${GLOW_SECS}s</span>
    <span class="pill" id="pillLit">0 lit</span>
  </div>
  <div class="conn">
    <div class="dot" id="dot"></div>
    <span id="connTxt">connecting…</span>
  </div>
</header>

<main>
  <section class="shelf-panel">
    <div class="panel-hd">
      Rack
      <span class="count" id="litCount">0 / ${SHELF_COUNT}</span>
    </div>
    <div class="shelf-grid" id="grid"></div>
  </section>

  <aside class="side-panel">
    <div class="side-hd">
      API Log
      <button class="btn" style="font-size:9px;padding:2px 7px" onclick="clearLog()">Clear</button>
    </div>
    <div class="log-scroll" id="log">
      <p class="empty">Waiting for requests…</p>
    </div>
    <div class="controls">
      <div class="ctrl-label">Light a shelf</div>
      <div class="ctrl-row">
        <input  type="number" id="inShelf" placeholder="42" min="1" value="1">
        <select id="inColor">
          <option value="green">green</option>
          <option value="red">red</option>
          <option value="blue">blue</option>
          <option value="yellow">yellow</option>
          <option value="orange">orange</option>
          <option value="cyan">cyan</option>
          <option value="purple">purple</option>
          <option value="white">white</option>
        </select>
        <button class="btn go" onclick="doLight()">Light</button>
      </div>
      <div class="ctrl-label">Turn off</div>
      <div class="ctrl-row">
        <input type="number" id="inOff" placeholder="shelf #" min="1">
        <button class="btn" onclick="doOffOne()">Off shelf</button>
        <button class="btn off" onclick="doOffAll()">Off all</button>
      </div>
    </div>
  </aside>
</main>

<script>
// ── Color map ──────────────────────────────────────────────────────────────────
var COLORS = {
  green:  '#22c55e',
  red:    '#ef4444',
  blue:   '#3b82f6',
  yellow: '#eab308',
  orange: '#f97316',
  cyan:   '#06b6d4',
  purple: '#a855f7',
  pink:   '#ec4899',
  white:  '#e2e8f0',
};
var SHELF_COUNT = ${SHELF_COUNT};

function hex(name) { return COLORS[name] || name || '#22c55e'; }

// ── Build static grid ─────────────────────────────────────────────────────────
var grid = document.getElementById('grid');
for (var i = 1; i <= SHELF_COUNT; i++) {
  var c = document.createElement('div');
  c.className = 'cell';
  c.id = 'c' + i;
  c.innerHTML = '<span class="cell-num">' + i + '</span>' +
                '<span class="cell-cd"    id="cd' + i + '"></span>' +
                '<span class="cell-label" id="cl' + i + '"></span>';
  grid.appendChild(c);
}

// ── State update ──────────────────────────────────────────────────────────────
var litMap = {};

function applyState(lit) {
  // Build lookup
  var next = {};
  for (var i = 0; i < lit.length; i++) next[lit[i].shelf] = lit[i];
  litMap = next;

  // Update known cells
  for (var s = 1; s <= SHELF_COUNT; s++) {
    var cell = document.getElementById('c' + s);
    var cd   = document.getElementById('cd' + s);
    var cl   = document.getElementById('cl' + s);
    if (!cell) continue;
    var entry = litMap[s];
    if (entry) {
      var h = hex(entry.color);
      cell.className = 'cell lit';
      cell.style.background  = h + '1e';
      cell.style.borderColor = h + 'aa';
      cell.style.boxShadow   = '0 0 18px ' + h + '44, inset 0 0 10px ' + h + '16';
      cd.textContent = entry.seconds_left;
      cl.textContent = entry.color || 'on';
      cd.style.color = h;
    } else {
      cell.className = 'cell';
      cell.style.background  = '';
      cell.style.borderColor = '';
      cell.style.boxShadow   = '';
      cd.textContent = '';
      cl.textContent = '';
      cd.style.color = '';
    }
  }

  // Dynamically add cells for shelf numbers beyond the initial grid
  for (var key in litMap) {
    var n = Number(key);
    if (n > SHELF_COUNT && !document.getElementById('c' + n)) {
      var extra = document.createElement('div');
      extra.className = 'cell';
      extra.id = 'c' + n;
      extra.innerHTML = '<span class="cell-num">' + n + '</span>' +
                        '<span class="cell-cd"    id="cd' + n + '"></span>' +
                        '<span class="cell-label" id="cl' + n + '"></span>';
      grid.appendChild(extra);
      // trigger update for this new cell on next tick
      setTimeout(function() { applyState(Object.values(litMap)); }, 0);
    }
  }

  var count = lit.length;
  document.getElementById('litCount').textContent = count + ' / ' + SHELF_COUNT;
  document.getElementById('pillLit').textContent  = count + ' lit';
}

// ── Log rendering ──────────────────────────────────────────────────────────────
var lastLogLen = 0;

function applyLog(entries) {
  if (entries.length === lastLogLen) return;
  lastLogLen = entries.length;

  var el = document.getElementById('log');
  el.innerHTML = '';
  if (!entries.length) {
    el.innerHTML = '<p class="empty">Waiting for requests…</p>';
    return;
  }
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var sc = e.status < 400 ? 's200' : 's400';
    var bodyStr = e.body ? JSON.stringify(e.body) : '';
    var row = document.createElement('div');
    row.className = 'log-row';
    row.innerHTML =
      '<div class="log-meta">' +
        '<span class="log-time">' + e.t + '</span>' +
        '<span class="badge ' + e.method + '">' + e.method + '</span>' +
        '<span class="log-url">' + e.url + '</span>' +
        '<span class="badge ' + sc + '" style="margin-left:auto">' + e.status + '</span>' +
      '</div>' +
      (bodyStr ? '<div class="log-body">' + bodyStr + '</div>' : '');
    el.appendChild(row);
  }
}

function clearLog() {
  document.getElementById('log').innerHTML = '<p class="empty">Log cleared.</p>';
  lastLogLen = -1;
}

// ── SSE connection ─────────────────────────────────────────────────────────────
var es;
function connect() {
  if (es) { try { es.close(); } catch(e) {} }
  es = new EventSource('/events');
  es.onopen = function() {
    document.getElementById('dot').className = 'dot live';
    document.getElementById('connTxt').textContent = 'connected';
  };
  es.onmessage = function(ev) {
    var d = JSON.parse(ev.data);
    applyState(d.lit  || []);
    applyLog  (d.log  || []);
  };
  es.onerror = function() {
    document.getElementById('dot').className = 'dot';
    document.getElementById('connTxt').textContent = 'reconnecting…';
    setTimeout(connect, 2500);
  };
}
connect();

// ── Test controls ──────────────────────────────────────────────────────────────
function post(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function doLight() {
  var shelf = parseInt(document.getElementById('inShelf').value, 10);
  var color = document.getElementById('inColor').value;
  if (!shelf || shelf < 1) return;
  post('/light', { shelf: shelf, color: color });
}

function doOffOne() {
  var shelf = parseInt(document.getElementById('inOff').value, 10);
  if (!shelf || shelf < 1) return;
  post('/off', { shelf: shelf });
}

function doOffAll() {
  post('/off', {});
}
</script>
</body>
</html>`;
