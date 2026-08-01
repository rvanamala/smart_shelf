# Smart Shelf — Production Readiness Checklist

**Audit date:** 2026-08-01  
**Scope:** ESP32 firmware · PWA (React) · Security · Backend (missing) · Ops

---

## Summary

| Priority | Label | Count |
|---|---|---|
| P0 | Blocker — cannot ship | 5 |
| P1 | High — must fix before production | 10 |
| P2 | Medium — fix soon after launch | 11 |
| P3 | Low — polish / nice to have | 6 |
| | **Total** | **32** |

---

## P0 — Blockers

### [FIRMWARE] WiFi credentials hardcoded in source code and git history

SSID and password sit in plain text at lines 45–46 of the `.ino` file. Once committed, they live in git history permanently — even if the lines are later removed. Everyone with repo access sees production network credentials.

**File:** `esp32/smart_shelf_controller.ino:45–46`

**Fix:** Remove credentials from source immediately. Use ESP BLE Unified Provisioning (Espressif library) or a WiFi AP captive-portal setup page to let operators configure credentials at device boot, never at compile time. Scrub the committed values from git history with `git filter-repo`.

---

### [FIRMWARE] No device provisioning flow — every unit requires USB and Arduino IDE

Deploying a new ESP32 means opening the `.ino`, editing `WIFI_SSID`, `WIFI_PASSWORD`, and `STATIC_IP`, recompiling, and flashing over USB. Static IPs must be manually unique across all devices on a network. This does not scale beyond a handful of units.

**File:** `esp32/smart_shelf_controller.ino:45–54`

**Fix:** Build a provisioning flow: BLE setup app or WiFi AP captive portal sets credentials + IP + device name on first boot and stores them in NVS. The firmware binary is then generic — one `.bin` works on every unit.

---

### [PWA] No authentication — any URL visitor can activate shelf LEDs

The PWA has no login, no session, and no user identity. Anyone who knows the URL — or scans the QR on the screen — can control any shelf on the factory floor. No access control, no role model, no way to disable a rogue user.

**File:** `src/App.jsx` (entire app)

**Fix:** Add an authentication layer before the scanner is accessible. At minimum: username + PIN with a backend-issued JWT. Longer term: per-client user provisioning with roles (scanner / manager / admin). The client/user model is already noted in requirements.

---

### [PWA] Hardcoded `DUMMY_BASE` fallback — all users silently share one device

When the Device URL setting is empty, `sendToESP32` falls back to the literal string `http://192.168.1.50`. A worker who hasn't configured settings, or whose settings were cleared, will unknowingly send all scans to that hardcoded address — silently overriding another factory's shelf state.

**File:** `src/App.jsx:6, 89`

**Fix:** Remove the fallback entirely. If `shelfUrl` is not set, block the scan with a clear "Device not configured — go to Settings" message. Never silently fall back to a hardcoded IP.

---

### [PWA] All data is browser-local — cleared by OS, not shared across users or devices

Settings and all shelf code mappings live in IndexedDB on one browser on one phone. If a worker switches phones, browser storage is cleared, or iOS Safari hits its quota, everything is lost silently. Two workers on the same factory floor must each configure the app independently.

**File:** `src/db.js` (entire module)

**Fix:** Move mappings and settings to a backend API. SQLite/IndexedDB can remain as an offline cache, but the source of truth must be server-side, synced on app load. This also unblocks multi-user and multi-factory use cases.

---

## P1 — High Priority

### [PWA] HTTPS ↔ HTTP mixed content: will block production on some browsers

The current dev setup (`npm run dev` over HTTP → ESP32 over HTTP) has no mixed content issue and works fine. However, once the PWA is deployed to Vercel (HTTPS), browsers enforce mixed content policy and block outbound HTTP fetches to the ESP32.

Chrome on Android has inconsistent enforcement for private network addresses (`192.168.x.x`) — it may work today but can break silently when Chrome tightens its [Private Network Access](https://developer.chrome.com/blog/private-network-access-update) policy. Other browsers are stricter.

| Deployment scenario | Status |
|---|---|
| `npm run dev` (HTTP) → ESP32 (HTTP) | ✅ Works — no issue |
| Vercel (HTTPS) → ESP32 (HTTP) on Chrome Android | ⚠️ Works today, not guaranteed |
| Vercel (HTTPS) → ESP32 (HTTP) on Firefox / Samsung Internet | ❌ Blocked |
| Vercel (HTTPS) → ESP32 (HTTP) after Chrome tightens policy | ❌ Will break |

**File:** `src/App.jsx:89–96` (`sendToESP32`)

**Fix:** Three viable paths:
1. **Backend proxy** — PWA posts to an HTTPS backend that forwards to the ESP32 over HTTP on the LAN. Aligns with the auth and backend requirements and is the recommended path.
2. **Serve PWA locally over HTTP** — requires a local server on-site; camera then works only on same-origin HTTP.
3. **HTTPS on ESP32** — technically possible with self-signed certs but operationally complex.

---

### [BACKEND] No backend server — auth, devices, mappings, and audit are all missing

There is no API server. Without one there is no central auth, no device registry, no shared mapping store, no scan audit log, and no way to manage users. The system cannot scale beyond a single phone talking to a single ESP32.

**Fix:** Design and build a thin backend: user auth (JWT), client/factory model, device registry (register ESP32 by MAC + location), central mappings CRUD, scan event log. A lightweight Node/Express or Python FastAPI service is sufficient for v1.

---

### [BACKEND] No multi-factory or multi-client isolation

There is no data model that ties users to factories or factories to their devices. Factory A workers can be given the same URL as Factory B with no restriction. Settings and mappings are not namespaced by client or location.

**Fix:** Model: `Client → Factories → Devices → Shelves`. Users belong to a Client and can only access that Client's factories. This drives the backend data schema from day one.

---

### [FIRMWARE] No device identity — can't tell which ESP controls which rack in software

No device name, serial number, or location is stored in NVS or returned by any endpoint. If you have 20 units, you cannot identify which one is at which rack from software. The `/health` endpoint returns only `"ok"`.

**File:** `esp32/smart_shelf_controller.ino` (`/health` handler)

**Fix:** Write a unique ID, physical location label, and firmware version to NVS during provisioning. Return them in `/health`:
```json
{ "id": "shelf-01", "location": "Factory A / Aisle 3", "fw": "1.2.0", "heap": 142000, "rssi": -61, "uptime_s": 3821 }
```

---

### [FIRMWARE] Glow time is compile-only — no runtime configuration

`DEFAULT_GLOW_SECS` is a `#define`. The Preferences NVS key `glow_ms` is read at boot but nothing in the firmware ever writes it. There is no API to change glow time without recompiling and reflashing.

**File:** `esp32/smart_shelf_controller.ino:69, 416–419`

**Fix:** Add a `POST /config { "glow_secs": 20 }` endpoint that validates the value, updates `glowMs`, and writes it to NVS via Preferences. Include the current value in the `/status` response.

---

### [FIRMWARE] LED state lost on reboot — active shelves go dark silently

The `active[]` shelf table lives in RAM. On power cut, watchdog reset, or OTA reboot all shelf states are wiped. The PWA has no mechanism to detect or recover from this. Workers may not notice that a shelf that should be lit is dark.

**File:** `esp32/smart_shelf_controller.ino:87–88` (`active[]`)

**Fix:** On a `POST /light`, persist the active shelf + expiry timestamp to NVS. On boot, reload and replay any entries that haven't yet expired. Alternatively, rely on backend re-delivery: the backend resends the activate command after detecting a device reconnect event.

---

### [FIRMWARE] No rate limiting — endpoints accept unlimited concurrent requests

Any LAN device can flood `POST /light`. `WebServer.handleClient()` processes one request at a time but the WiFi TCP stack queues unlimited connections. A buggy client or malicious device can freeze the ESP32 indefinitely.

**File:** `esp32/smart_shelf_controller.ino` (`loop()`, `setupServer()`)

**Fix:** Track the timestamp of the last accepted request per endpoint. Reject requests arriving faster than a configurable minimum interval (e.g. 200 ms) with HTTP 429. Log the rejection to Serial.

---

### [PWA] `useMappings` flag still drives scan flow — old saved data bypasses mappings

The Settings UI removed the enable/disable toggle, but `ScannerScreen` still reads `settingsRef.current.useMappings` at line 360. Any device whose IndexedDB has `useMappings = 'false'` from a previous version silently skips all mapping lookups and sends raw scanned codes directly to the device.

**File:** `src/App.jsx:289, 360–368`

**Fix:** Remove the `useMappings` gate in `handleScan` entirely. Mapping lookup should always run. The DB flag can be kept for schema compatibility but must not gate the scan path.

---

### [PWA] No scan audit log — no accountability for shelf activations

When a shelf is activated there is no record of what code was scanned, when, by whom, from which device, or whether the ESP32 acknowledged the request. Factory floor operations typically require traceability.

**File:** `src/App.jsx:370` (`sendToESP32` call site)

**Fix:** After a successful send, POST a scan event to the backend:
```json
{ "user": "...", "factory": "...", "device": "...", "scanned_code": "...", "local_code": "...", "shelf": 42, "timestamp": "...", "result": "ok" }
```
Store failures too. This can be fire-and-forget with a local retry queue.

---

### [SECURITY] ESP32 HTTP endpoints are completely unauthenticated

Any device on the same WiFi network — including personal phones on a factory guest network — can call `POST /light` or `POST /off` with no credential. A BYOD environment or unsegmented network makes this trivially exploitable.

**File:** `esp32/smart_shelf_controller.ino` (`setupServer()`)

**Fix:** Add a static API token stored in NVS: `Authorization: Bearer <token>`. The PWA sends it; the ESP32 checks it on every non-OPTIONS request. The token is set during provisioning, not compiled in.

---

## P2 — Medium Priority

### [FIRMWARE] WiFi credential rotation requires physical USB reflash

If the factory WiFi password changes, every deployed ESP32 must be physically collected, connected to a laptop, updated in source, recompiled, and reflashed. For 10+ units across multiple sites this is an operational problem.

**Fix:** Once a provisioning flow exists (see P0 item), credential updates can use the same BLE/AP channel. Alternatively, expose an authenticated `POST /provision` endpoint that updates NVS credentials and reboots.

---

### [FIRMWARE] `/health` returns only `"ok"` — no actionable telemetry

Operators have no signal of impending device failure. A device running on 12 KB heap with –85 dBm RSSI looks identical to a healthy device.

**File:** `esp32/smart_shelf_controller.ino` (`/health` handler)

**Fix:** Return a JSON object:
```json
{ "ok": true, "heap_free": 145320, "rssi": -58, "uptime_s": 7200, "fw": "1.0.0", "lit": 2 }
```
The backend can poll this and alert on low heap or poor RSSI.

---

### [FIRMWARE] No fleet OTA strategy — firmware updates are manual per-device

ArduinoOTA requires knowing each device's IP and performing updates one at a time. With a fleet of devices across factories, distributing a firmware update is a manual multi-hour operation.

**Fix:** Have the device periodically poll a backend endpoint for the current firmware version. If a newer `.bin` is available, the device downloads and self-flashes it via the ESP-IDF HTTPS OTA API. The backend controls rollout per device group.

---

### [FIRMWARE] All `Serial.printf` debug output active in production builds

Every request, LED state change, and WiFi retry is logged to Serial. On deployed hardware this wastes CPU cycles, fills the UART buffer, and produces noise if someone accidentally opens Serial Monitor on a live unit.

**File:** `esp32/smart_shelf_controller.ino` (throughout)

**Fix:** Wrap all Serial output in a `#ifdef DEBUG_LOG` guard. Production builds compile without `DEBUG_LOG` defined. Keep error-level output (crashes, failed NVS writes) unconditional.

---

### [PWA] "ESP32" still visible in processing and success overlays

The success overlay reads "Sent to ESP32" and the processing overlay reads "Sending to ESP32…" — inconsistent with the goal of using "device" in all user-facing copy.

**File:** `src/App.jsx:453, 464`

**Fix:** Change to "Sending to device…" and "Sent to device".

---

### [PWA] No offline retry or resilience — single network failure = permanent error

The scan-to-send flow makes a single HTTP fetch with a 5-second timeout. If WiFi blips, the user sees "Send Failed". There is no automatic retry and no way to know if the failure was transient.

**File:** `src/App.jsx:88–97` (`sendToESP32`)

**Fix:** Implement 2 automatic retries with 500 ms backoff before surfacing an error. Consider a local scan queue that persists across page reloads so failed scans can be retried when connectivity returns.

---

### [PWA] No pre-scan device connectivity check

The user has no feedback on whether the shelf device is reachable before they scan a code. If the device is offline, they discover it only after a successful scan and a failed send.

**Fix:** Poll `GET /health` every 30 seconds in the background. Show a small status indicator in the app bar (green = reachable, amber = degraded, grey = no URL configured). Requires the backend-proxy approach to avoid mixed-content issues.

---

### [PWA] No mapping export or backup mechanism

The mapping table exists only in the browser's IndexedDB. There is no export button, no backup, and no way for a manager to push a canonical mapping set to all worker phones.

**Fix:** Add an "Export CSV" button that generates and downloads the current mapping table. Long-term, canonical mappings live on the backend and are synced down on login.

---

### [SECURITY] No guidance on network segmentation for ESP32 devices

The firmware is designed for a factory LAN but there is no guidance on whether ESP32s should sit on an isolated IoT VLAN, a general production network, or a guest network. The CORS wildcard and lack of auth make this placement decision more consequential.

**Fix:** Document the required network topology: ESP32s on a dedicated IoT VLAN, reachable only from the backend proxy or the production management network. Restrict CORS to the backend's origin once a proxy exists.

---

### [BACKEND] No admin or operations dashboard

There is no UI for a manager or ops person to see which devices are online, their last-seen time, which shelves are currently lit, or a history of scan activity. The system is opaque after deployment.

**Fix:** Build a minimal admin view as part of the backend: device list (online/offline, last ping, firmware version), per-device shelf status, and a scan log with timestamp, user, and result. A read-only web page hitting the backend API is sufficient for v1.

---

### [OPS] No firmware CI/CD — manual compile with no versioned artifacts

Every firmware release requires a developer to open Arduino IDE, set the correct board config, compile, and manually flash or distribute. There are no versioned `.bin` files and no reproducible build process.

**Fix:** Use the Arduino CLI in a GitHub Actions workflow to compile on every push to `main`. Upload the `.bin` as a GitHub release artifact tagged with a semantic version. The fleet OTA system references these artifacts by URL.

---

## P3 — Low Priority

### [FIRMWARE] CORS `Access-Control-Allow-Origin: *` allows any LAN origin

Any web page served on the same LAN can invoke `POST /light` from a browser. Once endpoint authentication (P1) is in place this risk is greatly reduced, but the wildcard is still imprecise.

**Fix:** Once a backend proxy exists, restrict CORS to the backend's origin. Keep `*` only in debug builds.

---

### [OPS] mDNS (`smart-shelf.local`) is unreliable on enterprise networks

mDNS relies on multicast UDP which many managed enterprise and factory networks filter at the switch layer. `smart-shelf.local` may resolve on a home router but silently fail on the production network.

**Fix:** Use static IPs (configured during provisioning) as the authoritative address. Treat mDNS as a convenience for developers only. Document this constraint in the deployment guide.

---

### [OPS] Simulator co-located with production code — no environment boundary

`esp32/simulator.js` sits alongside the firmware with no indication it is development-only. A production deployment checklist should explicitly exclude it, but nothing in the repo structure enforces this.

**File:** `esp32/simulator.js`

**Fix:** Move to `tools/simulator.js` or `dev/simulator.js`. Document in `SMART_SHELF.md` that it is never deployed to production.

---

### [OPS] No per-factory PWA configuration at deploy time

The device URL is set per-browser in Settings. If each factory has a different device IP, there's no way to ship a factory-specific build with the URL pre-set. Every worker must configure it manually.

**File:** `src/SettingsPage.jsx:87` (`DEFAULT.shelfUrl = ''`)

**Fix:** Use Vite environment variables (`VITE_DEFAULT_SHELF_URL`) to pre-populate the settings default at build time. A Vercel deployment per factory can set different env vars. Workers still see the Settings page but the URL is already correct.

---

### [PWA] IndexedDB data can be silently evicted by iOS Safari

iOS Safari is aggressive about clearing "best effort" storage (which includes IndexedDB) under disk pressure or after extended periods of non-use. Mappings can disappear overnight with no warning to the user.

**Fix:** Request persistent storage on supported browsers: `navigator.storage.persist()`. If granted, data is not evicted without explicit user action. Long-term, the backend is the durable store — local DB is a fast cache.

---

### [PWA] No app version displayed anywhere in the UI

Workers and support staff have no way to confirm which version of the PWA they are running. This makes bug reports ambiguous and rollout verification impossible.

**Fix:** Inject `import.meta.env.VITE_APP_VERSION` (set from `package.json` in `vite.config.js`) and display it in a small label at the bottom of the Settings page. Include it in scan audit log entries and support-facing error messages.

---

## Recommended Build Order

Given the interdependencies, the pragmatic sequence is:

1. **Backend first** — auth, device registry, central mappings, scan log (unblocks P0 auth, P0 data-local, P1 audit, P1 multi-factory)
2. **Backend proxy for PWA→ESP32** — solves the HTTPS↔HTTP deadlock without touching firmware (unblocks P0 mixed-content)
3. **Firmware provisioning flow** — BLE or AP captive portal (unblocks P0 credentials, P0 static IP, P2 credential rotation)
4. **Firmware auth token** — add after provisioning flow so token can be set without recompile (P1 security)
5. **`useMappings` gate removal** — one-line code fix, do immediately (P1 code bug)
6. **`DUMMY_BASE` removal** — one-line code fix, do immediately (P0 code bug)
7. **PWA "ESP32" copy fix** — two strings, do immediately (P2 copy)
8. **Remaining P2 items** — retry logic, health polling, export, CI/CD
9. **P3 items** — as capacity allows
