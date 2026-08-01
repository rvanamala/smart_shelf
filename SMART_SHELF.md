# Smart Shelf — Project Reference

## Overview

A mobile-first React PWA that scans QR codes / barcodes using the device rear camera and sends the local shelf code to an ESP32 rack controller via HTTP POST. No native app required — runs in any modern mobile browser.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | React 19 + Vite 8 |
| QR/barcode scanner | `@yudiel/react-qr-scanner` v2 |
| Local database | `sql.js` v1 (SQLite compiled to WASM) |
| DB persistence | IndexedDB (serialised SQLite binary) |
| File parsing | `xlsx` (SheetJS) — dynamically imported, code-split |
| Styling | Inline styles + CSS variables (no CSS framework) |
| Deployment | Vercel (project linked via `.vercel/`) |

---

## Project Structure

```
smart_shelf/
├── src/
│   ├── main.jsx          # React entry point
│   ├── index.css         # Global CSS variables, reset, mobile viewport
│   ├── App.jsx           # Root router + CameraGate + ScannerScreen
│   ├── SettingsPage.jsx  # Settings UI (Connection, Mappings)
│   ├── db.js             # SQLite WASM layer (initDB, getSettings, saveSettings, lookupLocalCode)
│   └── App.css           # Empty — styles live in index.css and inline
├── esp32/
│   ├── smart_shelf_controller.ino   # ESP32 firmware (built-in WebServer, FastLED)
│   └── simulator.js                 # Node.js dev simulator matching the ESP32 API
└── SMART_SHELF.md
```

---

## Application Flow

```
App loads
  └─ initDB()                   ← loads SQLite WASM, opens IndexedDB, creates tables
  └─ CameraGate
        ├─ Permission granted?  ← navigator.permissions.query({ name: 'camera' })
        │     YES → getRearCameraConstraints() → ScannerScreen
        │     NO  → show "Camera Access Required" screen
        │           user taps Allow → getUserMedia() → enumerate devices
        │                                              → getRearCameraConstraints()
        │                                              → ScannerScreen
        └─ Permission denied?   → show device-specific fix instructions

ScannerScreen (idle)
  └─ User scans QR / barcode
  └─ handleScan(rawValue)
        └─ lookupLocalCode(rawValue) in SQLite
              found     → localCode = mapped value
                           POST /light { shelf: localCode, color: "green" } to device
                           success → success overlay (shows localCode, 2 s countdown, beep)
                           failure → error overlay + "Try Again"
              not found → "add mapping" overlay
                           user enters local code + "Add & Send"
                           saves mapping to SQLite → sends to device
```

---

## Screens

### 1. Camera Permission Gate

Shown before the scanner when permission has not been granted.

- **Explanation screen** — camera icon, mandatory notice, "Allow Camera Access" button
- **Blocked screen** — device-specific numbered instructions (iOS Safari / iOS Chrome / Android Chrome / Android generic / Desktop), "Reload Page" + "Try Again" buttons
- **No Camera screen** — shown only when `getUserMedia` throws `NotFoundError`

Camera selection after grant:
1. `enumerateDevices()` → match label containing `back / rear / environment`
2. Fallback: last device in list (Android lists back camera last)
3. Final fallback: `facingMode: { ideal: 'environment' }`

A **flip camera** button appears in the app bar (only when ≥ 2 cameras detected) to cycle through all available cameras by `deviceId`.

### 2. Scanner Screen

- Full-screen live camera feed (rear camera)
- **Processing overlay** — spinner + "Sending to device…"
- **Success overlay** — ✓ icon, **local shelf code prominently displayed**, shrinking progress bar, auto-resets in 2 s; two-tone Web Audio beep on success
- **Error overlay** — ✗ icon, specific error message, "Try Again" button
- **Add Mapping overlay** — shown when scanned code has no local mapping; user enters local code, "Add & Send" saves the mapping and immediately sends to the device
- Settings gear icon (top-right), flip camera icon (top-right, if multiple cameras)

### 3. Settings Page

#### Connection
| Field | Type | Purpose |
|---|---|---|
| Device Base URL | URL input | Base URL of the rack controller (e.g. `http://192.168.1.50`) |

#### Shelf Code Mappings

- Table of rows: **3rd-party code → Local code**
- Direction: scanned QR contains 3rd-party code → looked up → local code sent to device
- **Add Row** button — inline empty row
- **Upload File** button — accepts `.csv` or `.xlsx`/`.xls`
  - Skips header row (row 1); columns: col A = 3rd-party code, col B = local code
  - Upserts by 3rd-party code (updates existing, adds new)
  - Shows result: "X added, Y updated"
- **Save Changes** button — active only when unsaved changes exist (dirty tracking); disabled with "No Changes" label when clean
- Mappings are always active; no enable/disable toggle

**Save flow:** detect dirty state → write to SQLite → persist to IndexedDB → button resets to "No Changes".

---

## Database Schema (SQLite)

```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- keys: 'shelfUrl', 'ledGlowTime', 'useMappings'

CREATE TABLE mappings (
  id               TEXT PRIMARY KEY,
  local_code       TEXT NOT NULL DEFAULT '',
  third_party_code TEXT NOT NULL DEFAULT ''
);
```

Persisted to **IndexedDB** (key: `'db'`, store: `'sqlite'`, db name: `'smart_shelf'`) on every save. Reloaded on next app open.

---

## Key Design Decisions

### Mobile-first
- `100dvh` root height, `overflow: hidden` — no page scroll
- `env(safe-area-inset-*)` — notch / dynamic island safe areas
- All touch targets ≥ 44 × 44 px
- `font-size: 16px` on all inputs — prevents iOS auto-zoom on focus
- `viewport-fit=cover` + `apple-mobile-web-app-capable` meta tags

### Camera
- Never check `navigator.mediaDevices` at startup — it is `undefined` in non-secure contexts (HTTP) and would incorrectly trigger "No Camera" on Android
- Use `deviceId: { exact: … }` (not `facingMode`) for reliable rear camera on Android
- `facingMode` used only as final fallback

### `crypto.randomUUID()` fallback
Mapping row IDs use:
```js
const uid = () =>
  crypto?.randomUUID?.() ??
  Date.now().toString(36) + Math.random().toString(36).slice(2);
```
`crypto.randomUUID` requires HTTPS; fallback prevents crash over HTTP during local dev.

### Settings → Scanner reload
Settings are stored in a `useRef` inside `ScannerScreen`. The ref is repopulated from SQLite each time the scanner mounts (after returning from Settings), ensuring fresh values without extra renders.

### xlsx bundle size
`import('xlsx')` is a dynamic import inside `handleFileUpload`. Vite code-splits it into a separate chunk — xlsx is only downloaded when the user actually uploads a file.

### PWA → Device — CORS and mixed content
- The device must respond to `OPTIONS` preflight requests with `Access-Control-Allow-Origin: *` **before** the browser will send the actual POST. `curl` skips this; browsers do not.
- If the PWA is served over HTTPS and the device is HTTP, browsers block the request as **mixed content**. During development, access the PWA over HTTP (`npm run dev`). For production, the device must also be on HTTPS, or the PWA must be served from the same local network over HTTP.

---

## Device Integration

### PWA → Device request

```js
// POST to settings.shelfUrl (set in Settings page)
fetch(`${shelfUrl}/light`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ shelf: Number(localCode), color: 'green' }),
  signal: AbortSignal.timeout(5000),
});
```

Set **Device Base URL** in Settings to `http://192.168.1.50` (or `http://smart-shelf.local` if mDNS resolves on your network).

### HTTP API

| Method | Path | Body / Response | Purpose |
|---|---|---|---|
| `POST` | `/light` | `{ "shelf": N, "color": "green" }` | Activate shelf N LEDs |
| `POST` | `/off` | `{ "shelf": N }` or `{}` | Turn off one shelf / all |
| `GET` | `/status` | `{ "lit": [{ "shelf": N, "color": "…", "seconds_left": M }] }` | Current LED state |
| `GET` | `/health` | `"ok"` | Liveness check |
| `OPTIONS` | `/*` | 204 + CORS headers | Browser preflight |

---

## ESP32 Firmware

**File:** `esp32/smart_shelf_controller.ino`

### Hardware

| Part | Details |
|---|---|
| Board | ESP32 (ESP-WROOM-32, DevKitC, or any variant) |
| LEDs | WS2812B / WS2812 / SK6812 addressable strip |
| Data pin | GPIO 18 (configurable via `LED_DATA_PIN`) |
| Power | External 5 V supply for the strip; share GND with ESP32 |
| Series resistor | 300–500 Ω between GPIO 18 and strip DIN |

### Required Arduino libraries

Install via **Sketch → Include Library → Manage Libraries**:

| Library | Author | Notes |
|---|---|---|
| `ArduinoJson` | Benoit Blanchon | ≥ 7.x |
| `FastLED` | Daniel Garcia | — |

> **No async web server library needed.** The firmware uses the built-in `WebServer` from the ESP32 Arduino core. `ESPAsyncWebServer` / `AsyncTCP` have a hard incompatibility with Arduino core 3.x (ESP-IDF 5.x) due to lwIP TCPIP core locking requirements and should not be installed.

### Board setup (Arduino IDE)

- **Tools → Board → "ESP32 Dev Module"**
- **Tools → Partition Scheme → "Default 4MB with spiffs"**
- **Tools → Upload Speed → 921600**

### Configuration (edit top of `.ino`)

| Constant | Current value | Purpose |
|---|---|---|
| `WIFI_SSID` / `WIFI_PASSWORD` | — | Factory WiFi credentials |
| `STATIC_IP` | `192.168.1.50` | Must be outside router's DHCP pool |
| `GATEWAY_IP` | `192.168.1.1` | Router gateway |
| `LED_DATA_PIN` | `18` | GPIO connected to strip DIN |
| `LED_COUNT` | `100` | Total LEDs in strip |
| `LEDS_PER_SHELF` | `3` | LEDs per shelf position; shelf N → LEDs `[(N-1)*3 … N*3-1]` |
| `DEFAULT_GLOW_SECS` | `15` | LED on-time after a scan (seconds) |
| `MAX_BRIGHTNESS` | `180` | 0–255 brightness cap |

### LED colour names accepted

`red`, `green`, `blue`, `yellow`, `orange`, `cyan`, `purple`, `white`, `pink`

### OTA updates

```bash
# Arduino IDE: Sketch → Upload → Port → smart-shelf.local (ESP32)
# Or via espota:
python3 espota.py -i smart-shelf.local -f smart_shelf_controller.ino.bin
```

### Robustness features

- **Hardware watchdog** (30 s) — reboots automatically if `loop()` hangs; uses `esp_task_wdt_reconfigure()` on Arduino core 3.x
- **WiFi reconnect** with exponential back-off (3 s → 60 s cap); only retries when fully disconnected, not mid-attempt
- **LED auto-expiry** — checked every 500 ms in `loop()`; shelves go dark after `DEFAULT_GLOW_SECS` automatically
- **Multiple simultaneous shelves** — up to `MAX_ACTIVE_SHELVES` (20) can be lit at once with independent timers
- **CORS on every response** — browser POSTs work without a reverse proxy; `OPTIONS` preflight handled on all paths

---

## Dev Simulator

**File:** `esp32/simulator.js` (Node.js ES module)

Implements the same HTTP API as the ESP32 and serves a live visual shelf rack UI.

```bash
npm run sim          # GLOW_SECS=30 (default)
npm run sim:fast     # GLOW_SECS=5  (faster for testing)
```

Open `http://localhost:3001` in a browser to see the visual rack. The simulator uses SSE (`GET /events`) to push live updates to the UI.

---

## Running Locally

```bash
npm install
npm run dev        # Vite dev server, accessible on local network (--host flag set)
```

> **HTTPS required on mobile** — Chrome and Safari on Android/iOS hide `navigator.mediaDevices` on plain HTTP. For real-device testing, use a tunnel (e.g. `ngrok`), deploy to Vercel, or use a self-signed cert. During local testing with the simulator, HTTP is fine.
>
> **Mixed content warning** — if the PWA is on HTTPS (e.g. Vercel) and the ESP32 is on plain HTTP, browsers will block the fetch. Test against the simulator over HTTP, or access the Vercel deployment from the same local network over HTTP.

## Build & Deploy

```bash
npm run build      # outputs to dist/
vercel             # preview deploy, or push to linked repo for auto-deploy
vercel --prod      # production deploy
```

---

## Known Issues / Resolved

| Issue | Status | Resolution |
|---|---|---|
| PWA could not reach ESP32 despite curl working | Resolved | ESP32 wasn't answering OPTIONS preflight; firmware now handles OPTIONS on all paths with CORS headers |
| `esp_task_wdt_init` crash on Arduino core 3.x | Resolved | Switched to `esp_task_wdt_reconfigure()` on core 3.x |
| `mbedtls_md5_starts_ret` compile error | Resolved | ESPAsyncWebServer replaced with built-in `WebServer`; library removed |
| `tcp_alloc` lwIP assert crash | Resolved | ESPAsyncWebServer incompatible with ESP-IDF 5.x; replaced with built-in `WebServer` |
| Front camera used on Android | Resolved | `enumerateDevices()` label matching for back/rear/environment; `deviceId: exact` constraint |
| xlsx large initial bundle | Resolved | Dynamic `import('xlsx')` — Vite code-splits into separate chunk, loaded only on file upload |

---

## Pending / Next Steps

- [ ] **Authentication** — login screen; only authorised users can scan and adjust settings
- [ ] **Client / User model** — Users belong to Clients; Settings are per-Client and editable only by that Client's users
- [ ] **3rd-party API fallback** — if scanned QR is not in local mappings, fetch the local shelf code from a 3rd-party API before sending to device
