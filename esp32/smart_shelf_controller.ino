/**
 * Smart Shelf — ESP32 Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * HTTP API:
 *   POST /light   { "shelf": 42, "color": "green" }  → activate shelf LEDs
 *   POST /off     { "shelf": 42 }  or  {}            → off one shelf / all
 *   GET  /status  → { "lit": [{ "shelf":42, "color":"green", "seconds_left":21 }] }
 *   GET  /health  → plain "ok"
 *   OPTIONS /*    → CORS preflight (browser requires this before every POST)
 *
 * LIBRARY NOTES
 *   Uses the built-in ESP32 WebServer (no external library) instead of
 *   ESPAsyncWebServer, which has a hard incompatibility with ESP-IDF 5.x
 *   (Arduino core 3.x) due to lwIP TCPIP core locking requirements.
 *
 * REQUIRED LIBRARIES (Arduino Library Manager)
 *   ArduinoJson   (Benoit Blanchon) >= 7.x
 *   FastLED       (Daniel Garcia)
 *   — no async web server library needed —
 *
 * HARDWARE
 *   Board   : ESP32 (any variant)
 *   LEDs    : WS2812B / WS2812 / SK6812 addressable strip
 *   Wiring  : LED_DATA_PIN → strip DIN  (add 300–500 Ω in-series)
 *             External 5 V supply for the strip, shared GND with ESP32
 *
 * BOARD SETUP
 *   Tools → Board → "ESP32 Dev Module"
 *   Tools → Partition Scheme → "Default 4MB with spiffs"
 */

#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <FastLED.h>
#include <Preferences.h>
#include <ArduinoOTA.h>
#include <ESPmDNS.h>
#include <esp_task_wdt.h>

// ═══════════════════════════════════════════════════════════════════════════════
//  EDIT THESE
// ═══════════════════════════════════════════════════════════════════════════════

#define WIFI_SSID            "WiFI Name"
#define WIFI_PASSWORD        "PASSWORD"

// Static IP — must sit outside your router's DHCP pool
#define STATIC_IP            "192.168.1.50"
#define GATEWAY_IP           "192.168.1.1"
#define SUBNET_MASK          "255.255.255.0"
#define DNS_IP               "8.8.8.8"

// LED strip
#define LED_DATA_PIN         18
#define LED_COUNT            100
#define LEDS_PER_SHELF       3        // LEDs per shelf; shelf N → LEDs [(N-1)*3 … N*3-1]
#define LED_TYPE             WS2812B
#define COLOR_ORDER          GRB
#define MAX_BRIGHTNESS       180

// ─── Defaults ────────────────────────────────────────────────────────────────
#define DEFAULT_GLOW_SECS    15
#define MAX_ACTIVE_SHELVES   20
#define WDT_TIMEOUT_S        30
#define WIFI_BASE_RETRY_MS   3000
#define HOSTNAME             "smart-shelf"
#define HTTP_PORT            80

// ═══════════════════════════════════════════════════════════════════════════════
//  Data types
// ═══════════════════════════════════════════════════════════════════════════════

struct ActiveShelf {
  int32_t  shelf;    // -1 = unused slot
  CRGB     color;
  uint32_t offAt;    // millis() when this shelf should go dark
};

// ═══════════════════════════════════════════════════════════════════════════════
//  Globals
// ═══════════════════════════════════════════════════════════════════════════════
CRGB       leds[LED_COUNT];
WebServer  server(HTTP_PORT);
Preferences prefs;

ActiveShelf active[MAX_ACTIVE_SHELVES];
uint32_t    glowMs = DEFAULT_GLOW_SECS * 1000UL;

uint8_t     wifiRetryCount  = 0;
uint32_t    wifiNextRetryAt = 0;

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
  if (c == CRGB::Red)          return "red";
  if (c == CRGB::Green)        return "green";
  if (c == CRGB::Blue)         return "blue";
  if (c == CRGB::Yellow)       return "yellow";
  if (c == CRGB(255,69,0))     return "orange";
  if (c == CRGB(0,255,255))    return "cyan";
  if (c == CRGB(128,0,128))    return "purple";
  if (c == CRGB::White)        return "white";
  if (c == CRGB(255,20,147))   return "pink";
  return "on";
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LED helpers
// ═══════════════════════════════════════════════════════════════════════════════
void applyShelfLeds(int32_t shelf, CRGB color) {
  if (shelf < 1) return;
  uint16_t start = (uint16_t)((shelf - 1) * LEDS_PER_SHELF);
  uint16_t end   = start + LEDS_PER_SHELF - 1;
  if (start >= LED_COUNT) return;
  end = min(end, (uint16_t)(LED_COUNT - 1));
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
//  HTTP routes
// ═══════════════════════════════════════════════════════════════════════════════
void setupServer() {

  // OPTIONS preflight for every endpoint the browser will POST to
  server.on("/light",  HTTP_OPTIONS, handleCorsOptions);
  server.on("/off",    HTTP_OPTIONS, handleCorsOptions);
  server.on("/status", HTTP_OPTIONS, handleCorsOptions);
  server.on("/health", HTTP_OPTIONS, handleCorsOptions);

  // GET /health
  server.on("/health", HTTP_GET, []() {
    addCors();
    server.send(200, "text/plain", "ok");
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
    lightShelf(shelf, colorFromName(colorName), glowMs);
    String resp = "{\"ok\":true,\"shelf\":" + String(shelf) +
                  ",\"color\":\"" + colorName + "\"}";
    sendJson(200, resp);
    Serial.printf("[LIGHT] shelf=%d color=%s\n", shelf, colorName);
  });

  // POST /off  { "shelf": N }  or  {}
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
  WiFi.setHostname(HOSTNAME);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);

  IPAddress ip, gw, sn, dns;
  ip.fromString(STATIC_IP);  gw.fromString(GATEWAY_IP);
  sn.fromString(SUBNET_MASK); dns.fromString(DNS_IP);
  if (!WiFi.config(ip, gw, sn, dns))
    Serial.println("[WiFi] WARNING: static IP config failed — using DHCP.");

  Serial.printf("[WiFi] Connecting to '%s' (static %s)…", WIFI_SSID, STATIC_IP);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

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
  ArduinoOTA.setHostname(HOSTNAME);
  ArduinoOTA.onStart([]()  { Serial.println("[OTA] Starting…"); offAll(); });
  ArduinoOTA.onEnd([]()    { Serial.println("[OTA] Done. Rebooting."); });
  ArduinoOTA.onError([](ota_error_t e) { Serial.printf("[OTA] Error[%u]\n", e); });
  ArduinoOTA.begin();
  Serial.println("[OTA] Ready.");
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Config persistence
// ═══════════════════════════════════════════════════════════════════════════════
void loadConfig() {
  prefs.begin("shelf", true);
  glowMs = prefs.getUInt("glow_ms", DEFAULT_GLOW_SECS * 1000UL);
  prefs.end();
  Serial.printf("[Config] glow=%u ms\n", glowMs);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  setup()
// ═══════════════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[SmartShelf] Booting…");

  // Watchdog — core 3.x initialises TWDT itself; use reconfigure() not init()
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
  {
    const esp_task_wdt_config_t wdtCfg = {
      .timeout_ms    = (uint32_t)WDT_TIMEOUT_S * 1000,
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

  FastLED.addLeds<LED_TYPE, LED_DATA_PIN, COLOR_ORDER>(leds, LED_COUNT)
         .setCorrection(TypicalLEDStrip);
  FastLED.setBrightness(MAX_BRIGHTNESS);
  FastLED.clear(true);

  // Brief white flash confirms wiring is good
  fill_solid(leds, LED_COUNT, CRGB::White);
  FastLED.show();
  delay(350);
  FastLED.clear(true);
  Serial.printf("[LED] %d LEDs on GPIO %d, %d per shelf\n",
                LED_COUNT, LED_DATA_PIN, LEDS_PER_SHELF);

  loadConfig();
  setupWifi();

  if (MDNS.begin(HOSTNAME)) {
    MDNS.addService("http", "tcp", HTTP_PORT);
    Serial.printf("[mDNS] http://%s.local\n", HOSTNAME);
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
  checkWifi();
  ArduinoOTA.handle();
  server.handleClient();    // process one HTTP request per iteration

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
