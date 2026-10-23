// orecchino_http: an always-on Orecchino Remote ID receiver for VANTAGE.
//
// Runs Orecchino's receiver core (Wi-Fi beacon, Wi-Fi NAN, BLE 4 and BLE 5
// long range), stays joined to the home network and serves the detections
// as the dump3411 schema-v1 feed at http://orecchino.local/data/remoteid.json
// (https://github.com/ifnull/dump3411/blob/main/FEED.md).
//
// The ESP32 has one Wi-Fi radio. Joined to the router it sits on the router's
// channel, so the core's own channel hop is held and this sketch visits the
// other Remote ID channels (6, 1, 11, on the core's dwell times) with short
// passive scans. A scan while associated returns to the router's channel
// afterwards, so the feed stays reachable while the radio looks elsewhere.
//
// Part of VANTAGE. Built against orecchino-esp32, GPL-3.0-or-later; so is this file.
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <math.h>
#include <sys/time.h>
#include "wifi_secrets.h"

#define FW_BOARD "vantage-http"
#define ORECCHINO_BOARD_HOOKS
#define RX_HOOK_DECODED
#include "../common/rx_core.h"

static const char* HOSTNAME = "orecchino";
static const uint32_t FEED_MAX_AGE_MS = 60000;   // dump3411: drop ids unheard for 60 s
static const uint32_t HOME_MIN_MS = 400;          // router time between channel visits
static const time_t CLOCK_SET_AFTER = 1704067200; // 2024-01-01: SNTP has answered

// ------------------------------------------------------------ feed sources

enum FeedSrc : uint8_t { FEED_WIFI_BEACON, FEED_WIFI_NAN, FEED_BLE, FEED_BLE5, FEED_SRC_N };
static const char* FEED_SRC_NAMES[FEED_SRC_N] = { "wifi_beacon", "wifi_nan", "ble", "ble5" };

// A legacy advertisement holds one 25-byte message; a message pack, or the
// coded PHY, means Bluetooth 5 extended advertising.
static FeedSrc feed_src(const RidEvt* e) {
  if (e->src == SRC_WIFI_BEACON) return FEED_WIFI_BEACON;
  if (e->src == SRC_WIFI_NAN) return FEED_WIFI_NAN;
  return e->len > 25 || e->phy == 3 ? FEED_BLE5 : FEED_BLE;
}

// ---------------------------------------------- what the feed adds to a track

// The core's Track keeps what its screens draw. The feed also reports the
// operator, the Self-ID text, vertical speed and when each part was heard,
// so each track slot gets this companion, kept under the core's table lock.
struct FeedExtra {
  uint32_t first_ms;          // the track it belongs to; a reused slot starts over
  uint32_t msgs, pos_ms, self_ms, op_ms;
  float    vspeed;            // m/s, NAN when unknown
  char     self_desc[24];
  bool     has_op_pos;
  double   op_lat, op_lon;
  float    op_alt;            // m, NAN when unknown
  uint8_t  op_loc_type;       // ODID: 0 takeoff, 1 live GNSS, 2 fixed
  char     op_id[21];
  uint8_t  sources[FEED_SRC_N], n_sources;   // most recent first
};
static FeedExtra s_extra[TRK_MAX];
static volatile uint32_t s_src_msgs[FEED_SRC_N];
static volatile uint32_t s_src_last_ms[FEED_SRC_N];
static volatile uint32_t s_last_rid_ms;
static volatile uint32_t s_frames_by_chan[15];

void rx_hook_decoded(const RidEvt* e, const OdidUas* u, const Track* t, uint32_t now) {
  FeedExtra& x = s_extra[t - g_trk_live];
  if (x.first_ms != t->first_ms) {
    memset(&x, 0, sizeof(x));
    x.first_ms = t->first_ms;
    x.vspeed = NAN;
    x.op_alt = NAN;
  }
  FeedSrc src = feed_src(e);
  s_src_msgs[src] += 1;
  s_src_last_ms[src] = now;
  s_last_rid_ms = now;
  x.msgs += 1;
  uint8_t keep = 0;
  for (uint8_t i = 0; i < x.n_sources; i++)
    if (x.sources[i] != src) x.sources[++keep] = x.sources[i];
  x.sources[0] = src;
  x.n_sources = keep + 1;

  if (u->has_loc) {
    if (odid_coord_plausible(u->lat, u->lon)) x.pos_ms = now;
    x.vspeed = u->vspeed > -900 ? u->vspeed : NAN;
  }
  if (u->has_self && u->self_desc[0]) {
    odid_copy_text(x.self_desc, sizeof(x.self_desc), (const uint8_t*)u->self_desc, strlen(u->self_desc));
    x.self_ms = now;
  }
  if (u->has_sys) {
    x.has_op_pos = odid_coord_plausible(u->op_lat, u->op_lon);
    x.op_lat = u->op_lat;
    x.op_lon = u->op_lon;
    x.op_alt = u->op_alt > -999 ? u->op_alt : NAN;
    x.op_loc_type = u->op_loc_type;
    x.op_ms = now;
  }
  if (u->has_op && u->op_id[0]) {
    odid_copy_text(x.op_id, sizeof(x.op_id), (const uint8_t*)u->op_id, strlen(u->op_id));
    x.op_ms = now;
  }
}

void rx_hook_wifi_frame(uint8_t chan, int8_t) {
  if (chan < 15) s_frames_by_chan[chan] += 1;
}
bool rx_hook_paused() { return false; }
bool rx_hook_host_line(const char*, char*, uint32_t, HostSrc) { return false; }
void rx_hook_track(Track*, bool, bool) {}

// ------------------------------------------------------------------ the feed

// One feed row, copied out under the lock so formatting never holds it.
struct FeedRow { Track t; FeedExtra x; };
static FeedRow* s_rows = ext_new<FeedRow>(TRK_MAX);

static const size_t FEED_MAX = 24576;
static char* s_feed = ext_new<char>(FEED_MAX);
static size_t s_feed_len;

static void out(const char* fmt, ...) {
  if (s_feed_len >= FEED_MAX) return;
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(s_feed + s_feed_len, FEED_MAX - s_feed_len, fmt, ap);
  va_end(ap);
  if (n > 0) s_feed_len = min(s_feed_len + (size_t)n, FEED_MAX - 1);
}

static const char* id_type_name(uint8_t v) {
  switch (v) {
    case 1: return "serial";
    case 2: return "caa_reg";
    case 3: return "utm_uuid";
    case 4: return "session";
    default: return "unknown";
  }
}

// dump3411's names for the F3411 UA types.
static const char* ua_type_name(uint8_t v) {
  static const char* NAMES[] = {
    "None", "Aeroplane", "Helicopter/Multirotor", "Gyroplane", "Hybrid Lift", "Ornithopter",
    "Glider", "Kite", "Free Balloon", "Captive Balloon", "Airship", "Free Fall/Parachute",
    "Rocket", "Tethered Powered Aircraft", "Ground Obstacle",
  };
  return v < sizeof(NAMES) / sizeof(NAMES[0]) ? NAMES[v] : "Other";
}

static const char* op_loc_name(uint8_t v) {
  return v == 1 ? "live_gnss" : v == 2 ? "fixed" : "takeoff";
}

// The decode task can stamp a time a little newer than the caller's `now`;
// unsigned, that difference would wrap to 49 days.
static double age_s(uint32_t now, uint32_t at) {
  int32_t ms = (int32_t)(now - at);
  return ms > 0 ? ms / 1000.0 : 0.0;
}

static void build_feed(double epoch) {
  int n = 0;
  RX_LOCK();
  // Read under the lock: every last_ms in the table is then at or before it.
  uint32_t now = millis();
  for (int i = 0; i < TRK_MAX; i++) {
    const Track* t = &g_trk_live[i];
    if (!t->used || !t->uas[0] || now - t->last_ms > FEED_MAX_AGE_MS) continue;
    if (s_extra[i].first_ms != t->first_ms) continue;
    s_rows[n].t = *t;
    s_rows[n].x = s_extra[i];
    n++;
  }
  RX_UNLOCK();

  s_feed_len = 0;
  out("{\"schema_version\":1,\"now\":%.3f,\"messages\":%lu,\"drones\":[", epoch, (unsigned long)s_cnt_rid);
  for (int i = 0; i < n; i++) {
    const Track& t = s_rows[i].t;
    const FeedExtra& x = s_rows[i].x;
    char id[41];
    odid_copy_text(id, sizeof(id), (const uint8_t*)t.uas, strnlen(t.uas, sizeof(t.uas)));
    out("%s{\"id\":\"%s\",\"id_type\":\"%s\"", i ? "," : "", id, id_type_name(t.uas_type));
    if (t.ua_type) out(",\"ua_type\":\"%s\"", ua_type_name(t.ua_type));
    if (t.has_pos) out(",\"lat\":%.7f,\"lon\":%.7f", t.lat, t.lon);
    if (!isnan(t.alt_geo)) out(",\"alt_geom_ft\":%.1f", t.alt_geo / 0.3048);
    if (!isnan(t.height)) out(",\"agl_ft\":%.1f", t.height / 0.3048);
    if (!isnan(t.speed)) out(",\"gs\":%.2f", t.speed / 0.514444);
    if (!isnan(t.heading)) out(",\"track\":%.0f", t.heading);
    if (!isnan(x.vspeed)) out(",\"geom_rate\":%.0f", x.vspeed / 0.3048 * 60);
    out(",\"rssi\":%d,\"message_count\":%lu,\"seen\":%.1f", t.rssi, (unsigned long)x.msgs, age_s(now, t.last_ms));
    if (t.has_pos && x.pos_ms) out(",\"seen_pos\":%.1f", age_s(now, x.pos_ms));
    out(",\"rid_source\":\"%s\",\"rid_sources\":[", FEED_SRC_NAMES[x.sources[0]]);
    for (uint8_t s = 0; s < x.n_sources; s++) out("%s\"%s\"", s ? "," : "", FEED_SRC_NAMES[x.sources[s]]);
    out("]");
    if (x.self_ms) out(",\"self_id\":\"%s\",\"self_id_seen\":%.1f", x.self_desc, age_s(now, x.self_ms));
    if (x.op_ms) {
      out(",\"operator\":{\"seen\":%.1f", age_s(now, x.op_ms));
      if (x.has_op_pos) out(",\"lat\":%.7f,\"lon\":%.7f,\"location_type\":\"%s\"", x.op_lat, x.op_lon, op_loc_name(x.op_loc_type));
      if (!isnan(x.op_alt)) out(",\"alt_takeoff_ft\":%.1f", x.op_alt / 0.3048);
      if (x.op_id[0]) out(",\"id\":\"%s\"", x.op_id);
      out("}");
    }
    out("}");
  }
  out("]}");
}

// ------------------------------------------------------------- HTTP and mDNS

static WebServer s_http(80);
static uint32_t s_boot_ms;
static uint8_t s_visits_by_chan[15];

static bool clock_set(double* epoch) {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  *epoch = tv.tv_sec + tv.tv_usec / 1e6;
  return tv.tv_sec > CLOCK_SET_AFTER;
}

static void send_json(int code, const char* body, size_t len) {
  s_http.sendHeader("Cache-Control", "no-store");
  s_http.setContentLength(len);
  s_http.send(code, "application/json", "");
  s_http.sendContent(body, len);
}

// VANTAGE dates every report from `now`, so a feed before SNTP has answered
// would place every drone decades ago; say so instead.
static void serve_feed() {
  double epoch;
  if (!clock_set(&epoch)) {
    static const char ERR[] = "{\"error\":\"clock_not_set\",\"message\":\"The receiver has not reached a time server yet.\"}";
    send_json(503, ERR, sizeof(ERR) - 1);
    return;
  }
  build_feed(epoch);
  send_json(200, s_feed, s_feed_len);
}

static void serve_status() {
  double epoch;
  bool clock = clock_set(&epoch);
  int active = 0;
  RX_LOCK();
  uint32_t now = millis();
  for (int i = 0; i < TRK_MAX; i++)
    if (g_trk_live[i].used && now - g_trk_live[i].last_ms <= FEED_MAX_AGE_MS) active++;
  RX_UNLOCK();
  s_feed_len = 0;
  out("{\"schema_version\":1,\"version\":\"%s+%s\",\"uptime_s\":%lu,\"messages_total\":%lu,\"drones_active\":%d,",
      FW_VERSION, FW_BOARD, (unsigned long)((now - s_boot_ms) / 1000), (unsigned long)s_cnt_rid, active);
  if (s_last_rid_ms) out("\"last_seen_s\":%.1f,", age_s(now, s_last_rid_ms)); else out("\"last_seen_s\":null,");
  out("\"by_source\":{");
  for (int s = 0; s < FEED_SRC_N; s++) {
    out("%s\"%s\":{\"messages\":%lu,\"last_seen_s\":", s ? "," : "", FEED_SRC_NAMES[s], (unsigned long)s_src_msgs[s]);
    if (s_src_last_ms[s]) out("%.1f}", age_s(now, s_src_last_ms[s])); else out("null}");
  }
  out("},\"clock_set\":%s,\"radios\":{\"wifi\":%s,\"ble\":%s,\"ble_ext\":%s},",
      clock ? "true" : "false", s_wifi_ok ? "true" : "false", s_ble_ok ? "true" : "false", s_ble_ext ? "true" : "false");
  out("\"network\":{\"channel\":%d,\"rssi\":%d,\"ip\":\"%s\"},", WiFi.channel(), WiFi.RSSI(), WiFi.localIP().toString().c_str());
  out("\"wifi_frames_by_channel\":{\"1\":%lu,\"6\":%lu,\"11\":%lu},",
      (unsigned long)s_frames_by_chan[1], (unsigned long)s_frames_by_chan[6], (unsigned long)s_frames_by_chan[11]);
  out("\"channel_visits\":{\"1\":%u,\"6\":%u,\"11\":%u}}", s_visits_by_chan[1], s_visits_by_chan[6], s_visits_by_chan[11]);
  send_json(200, s_feed, s_feed_len);
}

// ------------------------------------------------------------ channel visits

// Walks the core's HOP table. A slot on the router's channel is time at home;
// any other slot is a passive scan of that channel for the slot's dwell, with
// at least HOME_MIN_MS at home in between so the feed keeps answering.
static void visit_channels(uint32_t now) {
  static size_t slot = 0;
  static uint32_t home_until = 0;
  static bool scanning = false;

  if (scanning) {
    int16_t r = WiFi.scanComplete();
    if (r == WIFI_SCAN_RUNNING) return;
    WiFi.scanDelete();
    scanning = false;
    home_until = now + HOME_MIN_MS;
    slot = (slot + 1) % HOP_N;
    return;
  }
  if ((int32_t)(now - home_until) < 0 || WiFi.status() != WL_CONNECTED) return;

  uint8_t home = WiFi.channel();
  const HopSlot& s = HOP[slot];
  if (s.chan == home) {
    home_until = now + s.dwell_ms;
    slot = (slot + 1) % HOP_N;
    return;
  }
  if (WiFi.scanNetworks(true, true, true, s.dwell_ms, s.chan) == WIFI_SCAN_RUNNING) {
    scanning = true;
    if (s.chan < 15 && s_visits_by_chan[s.chan] < 255) s_visits_by_chan[s.chan] += 1;
  } else {
    home_until = now + HOME_MIN_MS;
    slot = (slot + 1) % HOP_N;
  }
}

// -------------------------------------------------------------------- sketch

void setup() {
  s_boot_ms = millis();
  Serial.setRxBufferSize(4096);
  Serial.begin(115200);
  WiFi.setHostname(HOSTNAME);
  rx_begin(",\"feed\":\"http\"");
  // The router decides the channel from here on; visit_channels does the hopping.
  rx_hop_hold(true);
  WiFi.setAutoReconnect(true);
  // macOS asks mDNS for an IPv6 address too and waits 5 s for one that never
  // comes; with a link-local address the board answers both lookups at once.
  WiFi.enableIPv6();
  WiFi.begin(ORECCHINO_WIFI_SSID, ORECCHINO_WIFI_PASS);
  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");
  s_http.on("/data/remoteid.json", HTTP_GET, serve_feed);
  s_http.on("/status", HTTP_GET, serve_status);
  s_http.onNotFound([] { static const char E[] = "{\"error\":\"not_found\"}"; send_json(404, E, sizeof(E) - 1); });
  s_http.begin();
}

void loop() {
  uint32_t now = millis();
  static bool mdns = false;
  if (!mdns && WiFi.status() == WL_CONNECTED && MDNS.begin(HOSTNAME)) {
    MDNS.addService("http", "tcp", 80);
    mdns = true;
    host_printf("{\"type\":\"net\",\"ip\":\"%s\",\"ch\":%d,\"host\":\"%s.local\"}\n",
                WiFi.localIP().toString().c_str(), WiFi.channel(), HOSTNAME);
  }
  rx_tick(now);
  visit_channels(now);
  s_http.handleClient();
  delay(2);
}
