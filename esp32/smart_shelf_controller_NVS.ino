/**
 * Smart Shelf — ESP32 Controller (NVS Edition v2.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * All field-configurable values live in NVS (Non-Volatile Storage) — no WiFi
 * credentials, IPs, or LED counts are baked into the firmware.
 *
 * FIRST BOOT / PROVISIONING
 *   On first boot (or after credentials are cleared) the device creates a WiFi
 *   AP called "SmartShelf-XXXX" and serves a provisioning form at
 *   http://192.168.4.1.  Fill in WiFi credentials and LED config, tap
 *   "Save & Connect" — device reboots into normal mode.
 *
 *   To re-provision at any time: hold the BOOT button (GPIO 0) for 5 seconds.
 *
 * HTTP API (STA / normal mode):
 *   POST /light   { "shelf": 42, "color": "green" }  → activate shelf LEDs
 *   POST /off     { "shelf": 42 }  or  {}            → off one shelf / all
 *   GET  /status  → { "lit": [{ "shelf":42, "color":"green", "seconds_left":21 }] }
 *   GET  /health  → { "ok":true, "id":"...", "fw":"2.0.0", ... }
 *   POST /config  { "glow_secs":N, "brightness":N, ... }  → update runtime params
 *   OPTIONS /*    → CORS preflight
 *
 * LIBRARY NOTES
 *   Uses the built-in ESP32 WebServer (no external library). ESPAsyncWebServer
 *   has a hard incompatibility with ESP-IDF 5.x / Arduino core 3.x.
 *
 * REQUIRED LIBRARIES (Arduino Library Manager)
 *   ArduinoJson   (Benoit Blanchon) >= 7.x
 *   FastLED       (Daniel Garcia)
 *   — no async web server library needed —
 *
 * BOARD SETUP
 *   Tools → Board → "ESP32 Dev Module"
 *   Tools → Partition Scheme → "Default 4MB with spiffs"
 *   Tools → Upload Speed → 921600
 */

#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <ArduinoJson.h>
#include <FastLED.h>
#include <Preferences.h>
#include <ArduinoOTA.h>
#include <ESPmDNS.h>
#include <esp_task_wdt.h>

// ═══════════════════════════════════════════════════════════════════════════════
//  Compile-time constants — hardware-only, never field-configurable
// ═══════════════════════════════════════════════════════════════════════════════
#define LED_DATA_PIN       18        // GPIO wired to strip DIN (add 300–500 Ω in-series)
#define LED_TYPE           WS2812B
#define COLOR_ORDER        GRB
#define MAX_LED_COUNT      300       // static array upper bound; runtime uses cfg.ledCount

#define PROVISION_BTN      0         // BOOT button GPIO
#define PROVISION_HOLD_MS  5000      // hold ms to trigger runtime re-provision

#define FW_VERSION         "2.0.0"
#define HTTP_PORT          80
#define DNS_PORT           53
#define WDT_TIMEOUT_S      30
#define WIFI_BASE_RETRY_MS 3000
#define MAX_ACTIVE_SHELVES 100

// ═══════════════════════════════════════════════════════════════════════════════
//  NVS defaults — used on first boot when a key is absent
// ═══════════════════════════════════════════════════════════════════════════════
#define DEF_DEVICE_ID       "smartshelf-01"
#define DEF_WIFI_SSID       ""               // empty → captive-portal mode
#define DEF_WIFI_PASS       ""
#define DEF_STATIC_IP       "192.168.1.50"
#define DEF_GATEWAY         "192.168.1.1"
#define DEF_SUBNET          "255.255.255.0"
#define DEF_DNS_IP          "8.8.8.8"
#define DEF_LED_COUNT       500
#define DEF_LEDS_PER_SHELF  3
#define DEF_GLOW_SECS       15
#define DEF_BRIGHTNESS      180

// ═══════════════════════════════════════════════════════════════════════════════
//  Config struct — all user-configurable settings
// ═══════════════════════════════════════════════════════════════════════════════
struct Config {
  char     deviceId[32];
  char     wifiSsid[64];    // empty string = provisioning mode
  char     wifiPass[64];
  char     staticIp[16];
  char     gateway[16];
  char     subnet[16];
  char     dnsIp[16];
  uint16_t ledCount;
  uint8_t  ledsPerShelf;
  uint32_t glowMs;
  uint8_t  brightness;
};

// ═══════════════════════════════════════════════════════════════════════════════
//  Globals
// ═══════════════════════════════════════════════════════════════════════════════
Config      cfg;
CRGB        leds[MAX_LED_COUNT];
WebServer   server(HTTP_PORT);
DNSServer   dnsServer;
Preferences prefs;

bool provisioning = false;

struct ActiveShelf {
  int32_t  shelf;    // -1 = unused slot
  CRGB     color;
  uint32_t offAt;    // millis() when shelf should go dark
};
ActiveShelf active[MAX_ACTIVE_SHELVES];

uint8_t  wifiRetryCount  = 0;
uint32_t wifiNextRetryAt = 0;

// ═══════════════════════════════════════════════════════════════════════════════
//  NVS helpers
// ═══════════════════════════════════════════════════════════════════════════════
void loadConfig() {
  prefs.begin("shelf", true);  // read-only

  // Use String-returning overload to avoid buffer aliasing when a key is absent
  String s;

  s = prefs.getString("device_id",  DEF_DEVICE_ID); strlcpy(cfg.deviceId,  s.c_str(), sizeof(cfg.deviceId));
  s = prefs.getString("wifi_ssid",  DEF_WIFI_SSID); strlcpy(cfg.wifiSsid,  s.c_str(), sizeof(cfg.wifiSsid));
  s = prefs.getString("wifi_pass",  DEF_WIFI_PASS); strlcpy(cfg.wifiPass,  s.c_str(), sizeof(cfg.wifiPass));
  s = prefs.getString("static_ip",  DEF_STATIC_IP); strlcpy(cfg.staticIp,  s.c_str(), sizeof(cfg.staticIp));
  s = prefs.getString("gateway",    DEF_GATEWAY);    strlcpy(cfg.gateway,   s.c_str(), sizeof(cfg.gateway));
  s = prefs.getString("subnet",     DEF_SUBNET);     strlcpy(cfg.subnet,    s.c_str(), sizeof(cfg.subnet));
  s = prefs.getString("dns_ip",     DEF_DNS_IP);     strlcpy(cfg.dnsIp,     s.c_str(), sizeof(cfg.dnsIp));

  cfg.ledCount     = prefs.getUShort("led_count",      DEF_LED_COUNT);
  cfg.ledsPerShelf = prefs.getUChar( "leds_per_shelf", DEF_LEDS_PER_SHELF);
  cfg.glowMs       = prefs.getUInt(  "glow_ms",        (uint32_t)DEF_GLOW_SECS * 1000UL);
  cfg.brightness   = prefs.getUChar( "brightness",     DEF_BRIGHTNESS);

  prefs.end();

  // Clamp to sane ranges
  cfg.ledCount     = constrain(cfg.ledCount,     1,      MAX_LED_COUNT);
  cfg.ledsPerShelf = constrain(cfg.ledsPerShelf, 1,      20);
  cfg.glowMs       = constrain(cfg.glowMs,       1000UL, 300000UL);
  cfg.brightness   = constrain(cfg.brightness,   10,     255);

  Serial.printf("[Config] id=%s ssid='%s' ip=%s led=%d/shelf=%d glow=%ums bright=%d\n",
                cfg.deviceId, cfg.wifiSsid[0] ? cfg.wifiSsid : "(none)",
                cfg.staticIp, cfg.ledCount, cfg.ledsPerShelf, cfg.glowMs, cfg.brightness);
}

void saveConfig() {
  prefs.begin("shelf", false);  // read-write
  prefs.putString("device_id",      cfg.deviceId);
  prefs.putString("wifi_ssid",      cfg.wifiSsid);
  prefs.putString("wifi_pass",      cfg.wifiPass);
  prefs.putString("static_ip",      cfg.staticIp);
  prefs.putString("gateway",        cfg.gateway);
  prefs.putString("subnet",         cfg.subnet);
  prefs.putString("dns_ip",         cfg.dnsIp);
  prefs.putUShort("led_count",      cfg.ledCount);
  prefs.putUChar( "leds_per_shelf", cfg.ledsPerShelf);
  prefs.putUInt(  "glow_ms",        cfg.glowMs);
  prefs.putUChar( "brightness",     cfg.brightness);
  prefs.end();
  Serial.println("[Config] Saved to NVS.");
}

void clearWifiCredentials() {
  prefs.begin("shelf", false);
  prefs.putString("wifi_ssid", "");
  prefs.putString("wifi_pass", "");
  prefs.end();
  Serial.println("[Config] WiFi credentials cleared.");
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Color helpers
// ═══════════════════════════════════════════════════════════════════════════════
CRGB colorFromName(const char* name) {
  if (!name || !*name)                return CRGB::Green;
  if (strcasecmp(name,"red")    == 0) return CRGB::Red;
  if (strcasecmp(name,"green")  == 0) return CRGB::Green;
  if (strcasecmp(name,"blue")   == 0) return CRGB::Blue;
  if (strcasecmp(name,"yellow") == 0) return CRGB::Yellow;
  if (strcasecmp(name,"orange") == 0) return CRGB(255,  69,   0);
  if (strcasecmp(name,"cyan")   == 0) return CRGB(  0, 255, 255);
  if (strcasecmp(name,"purple") == 0) return CRGB(128,   0, 128);
  if (strcasecmp(name,"white")  == 0) return CRGB::White;
  if (strcasecmp(name,"pink")   == 0) return CRGB(255,  20, 147);
  return CRGB::Green;
}

const char* nameFromColor(CRGB c) {
  if (c == CRGB::Red)           return "red";
  if (c == CRGB::Green)         return "green";
  if (c == CRGB::Blue)          return "blue";
  if (c == CRGB::Yellow)        return "yellow";
  if (c == CRGB(255, 69,  0))   return "orange";
  if (c == CRGB(  0, 255, 255)) return "cyan";
  if (c == CRGB(128,   0, 128)) return "purple";
  if (c == CRGB::White)         return "white";
  if (c == CRGB(255,  20, 147)) return "pink";
  return "on";
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LED helpers  (all sizes come from cfg at runtime)
// ═══════════════════════════════════════════════════════════════════════════════
void applyShelfLeds(int32_t shelf, CRGB color) {
  if (shelf < 1) return;
  uint16_t start = (uint16_t)((shelf - 1) * cfg.ledsPerShelf);
  uint16_t end   = start + cfg.ledsPerShelf - 1;
  if (start >= cfg.ledCount) return;
  end = min(end, (uint16_t)(cfg.ledCount - 1));
  for (uint16_t i = start; i <= end; i++) leds[i] = color;
}

void rebuildLeds() {
  FastLED.clear();
  uint32_t now = millis();
  for (uint8_t i = 0; i < MAX_ACTIVE_SHELVES; i++) {
    if (active[i].shelf < 0) continue;
    if (now >= active[i].offAt) { active[i].shelf = -1; continue; }
    applyShelfLeds(active[i].shelf, active[i].color);
  }
  FastLED.show();
}

void lightShelf(int32_t shelf, CRGB color, uint32_t ms) {
  for (uint8_t i = 0; i < MAX_ACTIVE_SHELVES; i++) {
    if (active[i].shelf == shelf || active[i].shelf < 0) {
      active[i] = { shelf, color, millis() + ms };
      rebuildLeds();
      return;
    }
  }
  // No free slot — evict the entry closest to expiry
  uint8_t oldest = 0;
  for (uint8_t i = 1; i < MAX_ACTIVE_SHELVES; i++)
    if (active[i].offAt < active[oldest].offAt) oldest = i;
  active[oldest] = { shelf, color, millis() + ms };
  rebuildLeds();
}

void offShelf(int32_t shelf) {
  for (uint8_t i = 0; i < MAX_ACTIVE_SHELVES; i++)
    if (active[i].shelf == shelf) active[i].shelf = -1;
  rebuildLeds();
}

void offAll() {
  for (uint8_t i = 0; i < MAX_ACTIVE_SHELVES; i++) active[i].shelf = -1;
  FastLED.clear(true);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HTTP helpers
// ═══════════════════════════════════════════════════════════════════════════════
void addCors() {
  server.sendHeader("Access-Control-Allow-Origin",  "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  server.sendHeader("Access-Control-Max-Age",       "86400");
}

void sendJson(int code, const String& body) {
  addCors();
  server.send(code, "application/json", body);
}

void handleCorsOptions() {
  addCors();
  server.send(204);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Captive portal
// ═══════════════════════════════════════════════════════════════════════════════
static const char PORTAL_HTML[] PROGMEM = R"rawhtml(<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SmartShelf Setup</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#111;color:#eee;min-height:100vh;
     display:flex;align-items:center;justify-content:center;padding:16px}
.card{background:#1e1e1e;border:1px solid #333;border-radius:12px;padding:24px;
      width:100%;max-width:440px}
h1{font-size:1.3rem;margin-bottom:4px;color:#fff}
.sub{font-size:.8rem;color:#888;margin-bottom:20px}
label{display:block;font-size:.8rem;color:#aaa;margin-bottom:4px;margin-top:14px}
input{width:100%;background:#2a2a2a;border:1px solid #444;border-radius:6px;
      padding:9px 12px;color:#fff;font-size:.95rem}
input:focus{outline:none;border-color:#4a9eff}
.sect{border-top:1px solid #333;margin-top:20px;padding-top:14px;
      font-size:.7rem;color:#666;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px}
button{margin-top:22px;width:100%;padding:12px;background:#4a9eff;color:#fff;
       border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer}
button:hover{background:#3a8eef}
.note{font-size:.72rem;color:#666;margin-top:8px;text-align:center}
</style></head><body>
<div class="card">
<h1>SmartShelf Setup</h1>
<div class="sub">Device: {{DEVICE_ID}}&nbsp;&nbsp;|&nbsp;&nbsp;FW: {{FW_VER}}</div>
<form method="POST" action="/save">
  <div class="sect">WiFi</div>
  <label>SSID *</label>
  <input name="ssid" value="{{SSID}}" required autocomplete="off" placeholder="Your WiFi network name">
  <label>Password</label>
  <input name="pass" type="password" autocomplete="new-password" placeholder="Leave blank to keep current">

  <div class="sect">Network (blank = DHCP)</div>
  <label>Static IP</label>  <input name="ip"  value="{{IP}}"  placeholder="e.g. 192.168.1.50">
  <label>Gateway</label>    <input name="gw"  value="{{GW}}"  placeholder="e.g. 192.168.1.1">
  <label>Subnet</label>     <input name="sn"  value="{{SN}}"  placeholder="e.g. 255.255.255.0">
  <label>DNS</label>        <input name="dns" value="{{DNS}}" placeholder="e.g. 8.8.8.8">

  <div class="sect">Device</div>
  <label>Device ID</label>
  <input name="id" value="{{DEVICE_ID}}" maxlength="31" required placeholder="unique-name, no spaces">

  <div class="sect">LED strip</div>
  <label>Total LED count</label>
  <input name="led_count"  type="number" min="1"  max="300" value="{{LED_COUNT}}">
  <label>LEDs per shelf</label>
  <input name="leds_shelf" type="number" min="1"  max="20"  value="{{LEDS_SHELF}}">
  <label>Brightness (10–255)</label>
  <input name="brightness" type="number" min="10" max="255" value="{{BRIGHT}}">
  <label>Glow time (seconds)</label>
  <input name="glow_secs"  type="number" min="1"  max="300" value="{{GLOW}}">

  <button type="submit">Save &amp; Connect</button>
  <div class="note">Device reboots and joins your WiFi network.</div>
</form>
</div></body></html>)rawhtml";

String buildPortalHtml() {
  String html = FPSTR(PORTAL_HTML);
  html.replace("{{DEVICE_ID}}",  cfg.deviceId);
  html.replace("{{FW_VER}}",     FW_VERSION);
  html.replace("{{SSID}}",       cfg.wifiSsid);
  html.replace("{{IP}}",         cfg.staticIp);
  html.replace("{{GW}}",         cfg.gateway);
  html.replace("{{SN}}",         cfg.subnet);
  html.replace("{{DNS}}",        cfg.dnsIp);
  html.replace("{{LED_COUNT}}",  String(cfg.ledCount));
  html.replace("{{LEDS_SHELF}}", String(cfg.ledsPerShelf));
  html.replace("{{BRIGHT}}",     String(cfg.brightness));
  html.replace("{{GLOW}}",       String(cfg.glowMs / 1000));
  return html;
}

// Decode application/x-www-form-urlencoded values from the portal POST
String urlDecode(const String& s) {
  String out;
  out.reserve(s.length());
  for (int i = 0; i < (int)s.length(); i++) {
    if (s[i] == '+') { out += ' '; continue; }
    if (s[i] == '%' && i + 2 < (int)s.length()) {
      auto hv = [](char c) -> uint8_t {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        return 0;
      };
      out += (char)((hv(s[i+1]) << 4) | hv(s[i+2]));
      i += 2;
      continue;
    }
    out += s[i];
  }
  return out;
}

void handlePortalRoot() {
  server.send(200, "text/html", buildPortalHtml());
}

void handlePortalSave() {
  String ssid = urlDecode(server.arg("ssid"));
  String pass = urlDecode(server.arg("pass"));
  String ip   = server.arg("ip");
  String gw   = server.arg("gw");
  String sn   = server.arg("sn");
  String dns  = server.arg("dns");
  String id   = urlDecode(server.arg("id"));

  if (ssid.length() == 0) {
    server.send(400, "text/html",
      "<html><body style='font-family:sans-serif;background:#111;color:#f66;"
      "text-align:center;padding:40px'><h2>SSID is required.</h2>"
      "<a href='/' style='color:#4a9eff'>Back</a></body></html>");
    return;
  }

  if (id.length() > 0)   strlcpy(cfg.deviceId,  id.c_str(),   sizeof(cfg.deviceId));
  strlcpy(cfg.wifiSsid,  ssid.c_str(), sizeof(cfg.wifiSsid));
  if (pass.length() > 0) strlcpy(cfg.wifiPass,  pass.c_str(), sizeof(cfg.wifiPass));
  strlcpy(cfg.staticIp,  ip.c_str(),   sizeof(cfg.staticIp));
  strlcpy(cfg.gateway,   gw.c_str(),   sizeof(cfg.gateway));
  strlcpy(cfg.subnet,    sn.c_str(),   sizeof(cfg.subnet));
  strlcpy(cfg.dnsIp,     dns.c_str(),  sizeof(cfg.dnsIp));

  int lc = server.arg("led_count").toInt();
  int ls = server.arg("leds_shelf").toInt();
  int br = server.arg("brightness").toInt();
  int gs = server.arg("glow_secs").toInt();

  if (lc > 0) cfg.ledCount     = constrain(lc, 1, MAX_LED_COUNT);
  if (ls > 0) cfg.ledsPerShelf = constrain(ls, 1, 20);
  if (br > 0) cfg.brightness   = constrain(br, 10, 255);
  if (gs > 0) cfg.glowMs       = (uint32_t)constrain(gs, 1, 300) * 1000UL;

  saveConfig();

  server.send(200, "text/html",
    "<html><head><meta charset='utf-8'>"
    "<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;"
    "display:flex;align-items:center;justify-content:center;min-height:100vh;"
    "text-align:center}h2{color:#4a9eff}p{margin-top:12px}small{color:#888}"
    "</style></head><body><div><h2>Saved!</h2>"
    "<p>Connecting to <b>" + ssid + "</b>&hellip;</p>"
    "<p><small>The device will reboot. You can close this page.</small></p>"
    "</div></body></html>");

  delay(800);
  ESP.restart();
}

void setupPortal() {
  provisioning = true;

  // AP SSID = SmartShelf-XXXX (last 4 hex digits of MAC for uniqueness)
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char apSsid[24];
  snprintf(apSsid, sizeof(apSsid), "SmartShelf-%02X%02X", mac[4], mac[5]);

  WiFi.mode(WIFI_AP);
  WiFi.softAP(apSsid);

  dnsServer.start(DNS_PORT, "*", WiFi.softAPIP());  // redirect all DNS → 192.168.4.1

  server.on("/",     HTTP_GET,  handlePortalRoot);
  server.on("/save", HTTP_POST, handlePortalSave);
  server.onNotFound([]() {
    // Captive-portal redirect for iOS/Android connectivity probes
    server.sendHeader("Location", "http://192.168.4.1/");
    server.send(302);
  });
  server.begin();

  Serial.printf("[Portal] AP '%s' at %s\n", apSsid, WiFi.softAPIP().toString().c_str());
  Serial.println("[Portal] Connect and open http://192.168.4.1 to configure.");
}

void loopPortal() {
  dnsServer.processNextRequest();
  server.handleClient();

  // Orange blink on LED 0 — visual indicator of provisioning mode
  static uint32_t lastBlink = 0;
  static bool     blinkOn   = false;
  uint32_t now = millis();
  if (now - lastBlink >= 500) {
    lastBlink = now;
    blinkOn   = !blinkOn;
    leds[0]   = blinkOn ? CRGB(255, 69, 0) : CRGB::Black;
    FastLED.show();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HTTP routes (STA / normal mode)
// ═══════════════════════════════════════════════════════════════════════════════
void setupServer() {
  // OPTIONS preflight for every POST endpoint
  server.on("/light",  HTTP_OPTIONS, handleCorsOptions);
  server.on("/off",    HTTP_OPTIONS, handleCorsOptions);
  server.on("/status", HTTP_OPTIONS, handleCorsOptions);
  server.on("/health", HTTP_OPTIONS, handleCorsOptions);
  server.on("/config", HTTP_OPTIONS, handleCorsOptions);

  // GET /health — extended JSON (v2; v1 returned plain "ok")
  server.on("/health", HTTP_GET, []() {
    uint8_t litCount = 0;
    for (uint8_t i = 0; i < MAX_ACTIVE_SHELVES; i++)
      if (active[i].shelf >= 0) litCount++;

    JsonDocument doc;
    doc["ok"]        = true;
    doc["id"]        = cfg.deviceId;
    doc["fw"]        = FW_VERSION;
    doc["heap_free"] = ESP.getFreeHeap();
    doc["rssi"]      = WiFi.RSSI();
    doc["uptime_s"]  = millis() / 1000;
    doc["ip"]        = WiFi.localIP().toString();
    doc["lit"]       = litCount;

    String body;
    serializeJson(doc, body);
    sendJson(200, body);
  });

  // GET /status
  server.on("/status", HTTP_GET, []() {
    uint32_t now = millis();
    JsonDocument doc;
    JsonArray arr = doc["lit"].to<JsonArray>();
    for (uint8_t i = 0; i < MAX_ACTIVE_SHELVES; i++) {
      if (active[i].shelf < 0) continue;
      uint32_t sl = (active[i].offAt > now) ? (active[i].offAt - now) / 1000 : 0;
      JsonObject o = arr.add<JsonObject>();
      o["shelf"]        = active[i].shelf;
      o["color"]        = nameFromColor(active[i].color);
      o["seconds_left"] = (int)sl;
    }
    String body;
    serializeJson(doc, body);
    sendJson(200, body);
  });

  // POST /light  { "shelf": N, "color": "green" }
  server.on("/light", HTTP_POST, []() {
    String raw = server.arg("plain");
    JsonDocument doc;
    if (deserializeJson(doc, raw) || !doc["shelf"].is<int>()) {
      sendJson(400, "{\"error\":\"Expected {\\\"shelf\\\":N,\\\"color\\\":\\\"...\\\"}\"}");
      return;
    }
    int32_t shelf = doc["shelf"].as<int32_t>();
    if (shelf < 1) { sendJson(400, "{\"error\":\"shelf must be >= 1\"}"); return; }
    const char* colorName = doc["color"].is<const char*>()
                            ? doc["color"].as<const char*>() : "green";
    lightShelf(shelf, colorFromName(colorName), cfg.glowMs);
    String resp = "{\"ok\":true,\"shelf\":" + String(shelf) +
                  ",\"color\":\"" + colorName + "\"}";
    sendJson(200, resp);
    Serial.printf("[LIGHT] shelf=%d color=%s\n", shelf, colorName);
  });

  // POST /off  { "shelf": N } or {}
  server.on("/off", HTTP_POST, []() {
    String raw = server.arg("plain");
    JsonDocument doc;
    deserializeJson(doc, raw);
    if (doc["shelf"].is<int>()) {
      int32_t s = doc["shelf"].as<int32_t>();
      offShelf(s);
      Serial.printf("[OFF] shelf=%d\n", s);
    } else {
      offAll();
      Serial.println("[OFF] all");
    }
    sendJson(200, "{\"ok\":true}");
  });

  // POST /config  { "glow_secs":N, "brightness":N, "led_count":N, "leds_per_shelf":N }
  //   glow_secs and brightness take effect immediately.
  //   led_count and leds_per_shelf require a reboot (reboot_needed:true in response).
  server.on("/config", HTTP_POST, []() {
    String raw = server.arg("plain");
    JsonDocument doc;
    if (deserializeJson(doc, raw)) {
      sendJson(400, "{\"error\":\"Invalid JSON\"}");
      return;
    }

    bool changed      = false;
    bool rebootNeeded = false;

    if (doc["glow_secs"].is<int>()) {
      cfg.glowMs = (uint32_t)constrain(doc["glow_secs"].as<int>(), 1, 300) * 1000UL;
      changed = true;
    }
    if (doc["brightness"].is<int>()) {
      cfg.brightness = constrain(doc["brightness"].as<int>(), 10, 255);
      FastLED.setBrightness(cfg.brightness);
      FastLED.show();
      changed = true;
    }
    if (doc["led_count"].is<int>()) {
      cfg.ledCount  = constrain(doc["led_count"].as<int>(), 1, MAX_LED_COUNT);
      changed = rebootNeeded = true;
    }
    if (doc["leds_per_shelf"].is<int>()) {
      cfg.ledsPerShelf = constrain(doc["leds_per_shelf"].as<int>(), 1, 20);
      changed = rebootNeeded = true;
    }

    if (changed) saveConfig();

    JsonDocument resp;
    resp["ok"]              = true;
    resp["reboot_needed"]   = rebootNeeded;
    resp["glow_secs"]       = cfg.glowMs / 1000;
    resp["brightness"]      = cfg.brightness;
    resp["led_count"]       = cfg.ledCount;
    resp["leds_per_shelf"]  = cfg.ledsPerShelf;
    String body;
    serializeJson(resp, body);
    sendJson(200, body);
    Serial.printf("[Config] Updated glow=%ums bright=%d led=%d/shelf=%d reboot=%s\n",
                  cfg.glowMs, cfg.brightness, cfg.ledCount, cfg.ledsPerShelf,
                  rebootNeeded ? "yes" : "no");
  });

  // 404 + OPTIONS catch-all
  server.onNotFound([]() {
    if (server.method() == HTTP_OPTIONS) { handleCorsOptions(); return; }
    sendJson(404, "{\"error\":\"Not found\"}");
  });

  server.begin();
  Serial.printf("[Server] Listening on port %d\n", HTTP_PORT);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WiFi
// ═══════════════════════════════════════════════════════════════════════════════
void setupWifi() {
  WiFi.setHostname(cfg.deviceId);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);

  // Apply static IP only when all three address fields are present
  if (cfg.staticIp[0] && cfg.gateway[0] && cfg.subnet[0]) {
    IPAddress ip, gw, sn, dns;
    if (ip.fromString(cfg.staticIp) && gw.fromString(cfg.gateway) && sn.fromString(cfg.subnet)) {
      dns.fromString(cfg.dnsIp[0] ? cfg.dnsIp : DEF_DNS_IP);
      if (!WiFi.config(ip, gw, sn, dns))
        Serial.println("[WiFi] WARNING: static IP config failed — using DHCP.");
      else
        Serial.printf("[WiFi] Static IP: %s\n", cfg.staticIp);
    } else {
      Serial.println("[WiFi] Invalid IP fields — using DHCP.");
    }
  } else {
    Serial.println("[WiFi] No static IP configured — using DHCP.");
  }

  Serial.printf("[WiFi] Connecting to '%s'…", cfg.wifiSsid);
  WiFi.begin(cfg.wifiSsid, cfg.wifiPass);

  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(500);
    Serial.print(".");
    esp_task_wdt_reset();
  }
  if (WiFi.status() == WL_CONNECTED)
    Serial.printf("\n[WiFi] Connected. IP=%s RSSI=%d dBm\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
  else
    Serial.println("\n[WiFi] Initial connect failed — will retry in loop().");
}

void checkWifi() {
  wl_status_t s = WiFi.status();
  if (s == WL_CONNECTED) { wifiRetryCount = 0; wifiNextRetryAt = 0; return; }
  uint32_t now = millis();
  if (now < wifiNextRetryAt) return;
  wifiRetryCount++;
  Serial.printf("[WiFi] status=%d Retry #%d…\n", s, wifiRetryCount);
  if (s == WL_DISCONNECTED || s == WL_CONNECT_FAILED || s == WL_CONNECTION_LOST)
    WiFi.reconnect();
  uint32_t backoff = (uint32_t)WIFI_BASE_RETRY_MS << min(wifiRetryCount - 1, (uint8_t)4);
  wifiNextRetryAt  = now + min(backoff, (uint32_t)60000);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  OTA
// ═══════════════════════════════════════════════════════════════════════════════
void setupOTA() {
  ArduinoOTA.setHostname(cfg.deviceId);
  ArduinoOTA.onStart([]()  { Serial.println("[OTA] Starting…"); offAll(); });
  ArduinoOTA.onEnd([]()    { Serial.println("[OTA] Done. Rebooting."); });
  ArduinoOTA.onError([](ota_error_t e) { Serial.printf("[OTA] Error[%u]\n", e); });
  ArduinoOTA.begin();
  Serial.println("[OTA] Ready.");
}

// ═══════════════════════════════════════════════════════════════════════════════
//  setup()
// ═══════════════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[SmartShelf] NVS Edition v" FW_VERSION " booting…");

  // Watchdog — core 3.x initialises TWDT itself; use reconfigure(), not init()
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
  {
    const esp_task_wdt_config_t wdtCfg = {
      .timeout_ms     = (uint32_t)WDT_TIMEOUT_S * 1000,
      .idle_core_mask = 0,
      .trigger_panic  = true,
    };
    esp_task_wdt_reconfigure(&wdtCfg);
  }
#else
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
#endif
  esp_task_wdt_add(NULL);

  for (uint8_t i = 0; i < MAX_ACTIVE_SHELVES; i++) active[i].shelf = -1;

  // Load config before FastLED so we use the provisioned led count / brightness
  loadConfig();

  // FastLED: PIN must be compile-time; count and brightness can be runtime
  FastLED.addLeds<LED_TYPE, LED_DATA_PIN, COLOR_ORDER>(leds, cfg.ledCount)
         .setCorrection(TypicalLEDStrip);
  FastLED.setBrightness(cfg.brightness);
  FastLED.clear(true);
  Serial.printf("[LED] %d LEDs on GPIO %d, %d per shelf, brightness=%d\n",
                cfg.ledCount, LED_DATA_PIN, cfg.ledsPerShelf, cfg.brightness);

  // Check BOOT button held at power-on → clear WiFi and enter captive portal
  pinMode(PROVISION_BTN, INPUT_PULLUP);
  if (digitalRead(PROVISION_BTN) == LOW) {
    Serial.println("[Boot] BOOT button held at power-on — clearing WiFi credentials.");
    fill_solid(leds, cfg.ledCount, CRGB::Red);
    FastLED.show();
    delay(1000);
    FastLED.clear(true);
    clearWifiCredentials();
    cfg.wifiSsid[0] = '\0';
    cfg.wifiPass[0] = '\0';
  }

  if (cfg.wifiSsid[0] == '\0') {
    // No credentials stored — enter captive portal
    setupPortal();
    return;
  }

  // Normal mode: brief white flash confirms wiring, then connect
  fill_solid(leds, cfg.ledCount, CRGB::White);
  FastLED.show();
  delay(350);
  FastLED.clear(true);

  setupWifi();

  if (MDNS.begin(cfg.deviceId)) {
    MDNS.addService("http", "tcp", HTTP_PORT);
    Serial.printf("[mDNS] http://%s.local\n", cfg.deviceId);
  }

  setupOTA();
  setupServer();

  Serial.println("[SmartShelf] Ready.\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
//  loop()
// ═══════════════════════════════════════════════════════════════════════════════
void loop() {
  esp_task_wdt_reset();

  if (provisioning) {
    loopPortal();
    return;
  }

  // BOOT button hold in normal mode → clear credentials and re-provision
  static uint32_t btnPressedAt = 0;
  if (digitalRead(PROVISION_BTN) == LOW) {
    if (btnPressedAt == 0) btnPressedAt = millis();
    if (millis() - btnPressedAt >= PROVISION_HOLD_MS) {
      Serial.println("[Boot] BOOT button held 5 s — entering provisioning mode.");
      offAll();
      clearWifiCredentials();
      delay(200);
      ESP.restart();
    }
  } else {
    btnPressedAt = 0;
  }

  checkWifi();
  ArduinoOTA.handle();
  server.handleClient();

  // Auto-expire shelves whose glow time has elapsed
  static uint32_t lastExpiry = 0;
  uint32_t now = millis();
  if (now - lastExpiry >= 500) {
    lastExpiry = now;
    bool any = false;
    for (uint8_t i = 0; i < MAX_ACTIVE_SHELVES; i++)
      if (active[i].shelf >= 0 && now >= active[i].offAt) { active[i].shelf = -1; any = true; }
    if (any) rebuildLeds();
  }
}
