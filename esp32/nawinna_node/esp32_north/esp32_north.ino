// ═══════════════════════════════════════════════════════════════════════════
// HYDRA v8.0 — ESP32 NORTH ROAD NODE
// Nawinna Junction, Kurunegala
//
// HARDWARE:
//   US1 HC-SR04  — 5cm  back from stop line, points across 7cm road width
//   US2 HC-SR04  — 15cm back from stop line, points across 7cm road width
//   Piezo vibration sensor (analog) — heavy vehicle detection
//   Rain sensor  — ONLY on North ESP32, broadcast to all roads
//   Pedestrian push button
//   Pedestrian RED LED + GREEN LED
//   7-Segment display (pedestrian countdown, common cathode)
//   Traffic light module (RED / YELLOW / GREEN)
//
// QUEUE DETECTION LOGIC:
//   distance < ROAD_WIDTH_CM (7cm) for STABLE_MS (5000ms) → vehicle confirmed
//   US1 stable only              → Light traffic  → publishes queueLevel=Light
//   US1 + US2 both stable        → Heavy traffic  → publishes queueLevel=Heavy
//   US2 stable but US1 not       → Ignored
//   Neither stable               → No traffic     → queueLevel=None
//
// MQTT PUBLISH:
//   traffic/us/<road>            → { us1Stable, us2Stable, us1Raw, us2Raw, queueLevel }
//   traffic/piezo/<road>         → { piezoValue, heavyVehicle }
//   traffic/rain/<road>          → { rainDetected, yellowTime }
//   traffic/rain/all             → same (retained, broadcast to all roads)
//   traffic/pedestrian/<road>    → { requested/crossing/duration }
//   traffic/state/<road>         → { state: RED/YELLOW/GREEN }
//
// MQTT SUBSCRIBE:
//   traffic/control/<road>       → { signal, greenTime, yellowTime, redTime }
//   traffic/pedestrian/cmd/<road>→ { action: START_CROSSING / END_CROSSING / SHOW_YELLOW_COUNTDOWN }
//
// PIN ASSIGNMENTS:
//   US1_TRIG = GPIO 5   US1_ECHO = GPIO 18
//   US2_TRIG = GPIO 19  US2_ECHO = GPIO 21   ← second ultrasonic
//   RED_LED  = GPIO 26  YELLOW_LED = GPIO 27  GREEN_LED = GPIO 14
//   PIEZO    = GPIO 32  (analog)
//   RAIN_PIN = GPIO 33  (digital, LOW = rain) ← North only
//   PED_BTN  = GPIO 25  (INPUT_PULLUP, LOW = pressed)
//   PED_RED  = GPIO 4   PED_GRN = GPIO 16
//   SEG_A=2  SEG_B=15  SEG_C=12  SEG_D=13  SEG_E=22  SEG_F=23  SEG_G=17
// ═══════════════════════════════════════════════════════════════════════════

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ── Identity ──────────────────────────────────────────────────────────────────
const char* ROAD_ID     = "North";
const char* WIFI_SSID   = "Dialog 4G 940";
const char* WIFI_PASS   = "Robbin123@hood";
const char* MQTT_SERVER = "56.228.30.50";
const int   MQTT_PORT   = 1883;

// ── Pins ──────────────────────────────────────────────────────────────────────
#define US1_TRIG      5
#define US1_ECHO      18
#define US2_TRIG      19
#define US2_ECHO      21

#define RED_LED       26
#define YELLOW_LED    27
#define GREEN_LED     14

#define PIEZO_PIN     32
#define RAIN_PIN      33    // North only

#define PED_BUTTON    25
#define PED_RED_LED   4
#define PED_GREEN_LED 16

#define SEG_A  2
#define SEG_B  15
#define SEG_C  12
#define SEG_D  13
#define SEG_E  22
#define SEG_F  23
#define SEG_G  17

// ── Queue detection constants ─────────────────────────────────────────────────
#define ROAD_WIDTH_CM   7.0f    // vehicle present if distance < this
#define STABLE_MS       5000UL  // must hold < ROAD_WIDTH_CM for this long
#define US_MEASURE_MS   200UL   // measure every 200ms
#define MAX_DIST_CM     50.0f   // ignore readings above this (noise)

// ── Traffic timing defaults ───────────────────────────────────────────────────
#define BASE_GREEN_MS        3000UL
#define BASE_YELLOW_MS       3000UL
#define RAIN_YELLOW_EXTRA_MS 2000UL
#define PED_CROSS_TIME_S     10
#define SERVER_TIMEOUT_MS    30000UL

// ── MQTT topics ───────────────────────────────────────────────────────────────
String PUB_US, PUB_PIEZO, PUB_RAIN_LOCAL, PUB_RAIN_ALL, PUB_PED, PUB_STATE, SUB_CONTROL;

WiFiClient   wifiClient;
PubSubClient mqttClient(wifiClient);

// ── Traffic light state machine ───────────────────────────────────────────────
enum LightPhase { PHASE_RED, PHASE_YELLOW, PHASE_GREEN };
LightPhase    currentPhase    = PHASE_RED;
unsigned long phaseEndMs      = 0;
unsigned long lastServerCmdMs = 0;
bool          serverControlled = false;

unsigned long currentGreenMs  = BASE_GREEN_MS;
unsigned long currentYellowMs = BASE_YELLOW_MS;
unsigned long currentRedMs    = BASE_GREEN_MS + BASE_YELLOW_MS;

// ── Queue detection state per sensor ─────────────────────────────────────────
struct USState {
    float        lastRaw       = 999.0f; // last measured distance
    bool         stable        = false;  // confirmed blocked for STABLE_MS
    unsigned long blockedSince = 0;      // millis when first blocked
    unsigned long lastMeasMs   = 0;      // last measurement time
};

USState us1State, us2State;

// ── Other sensor state ────────────────────────────────────────────────────────
bool rainDetected = false;
bool heavyVehicle = false;

// ── Pedestrian ────────────────────────────────────────────────────────────────
bool          pedRequested = false;
bool          pedCrossing  = false;
unsigned long pedStartMs   = 0;

// ── Publish intervals ─────────────────────────────────────────────────────────
unsigned long lastUSPublishMs  = 0;
unsigned long lastPiezoMs      = 0;
unsigned long lastRainMs       = 0;

// ── 7-Segment display ─────────────────────────────────────────────────────────
const int  SEG_PINS[7]       = { SEG_A, SEG_B, SEG_C, SEG_D, SEG_E, SEG_F, SEG_G };
const byte DIGIT_PATTERNS[10] = {
    0b1111110, 0b0110000, 0b1101101, 0b1111001, 0b0110011,
    0b1011011, 0b1011111, 0b1110000, 0b1111111, 0b1111011
};

void clearDisplay() { for (int i = 0; i < 7; i++) digitalWrite(SEG_PINS[i], LOW); }
void displayDigit(int n) {
    if (n < 0 || n > 9) { clearDisplay(); return; }
    byte p = DIGIT_PATTERNS[n];
    for (int i = 0; i < 7; i++) digitalWrite(SEG_PINS[i], (p >> (6 - i)) & 1 ? HIGH : LOW);
}

struct CDState { bool active=false; int rem=0; unsigned long nextMs=0; } pedCD;
void startCD(int s) { pedCD.active=true; pedCD.rem=s; pedCD.nextMs=millis(); displayDigit(s>9?9:s); }
void updateCD() {
    if (!pedCD.active) return;
    if (millis() >= pedCD.nextMs) {
        pedCD.rem--; pedCD.nextMs = millis() + 1000UL;
        if (pedCD.rem <= 0) { pedCD.active = false; clearDisplay(); }
        else displayDigit(pedCD.rem > 9 ? 9 : pedCD.rem);
    }
}

// ── Traffic light control ─────────────────────────────────────────────────────
void setLight(LightPhase p) {
    digitalWrite(RED_LED, LOW); digitalWrite(YELLOW_LED, LOW); digitalWrite(GREEN_LED, LOW);
    delay(30);
    if (p == PHASE_RED)    digitalWrite(RED_LED,    HIGH);
    if (p == PHASE_YELLOW) digitalWrite(YELLOW_LED, HIGH);
    if (p == PHASE_GREEN)  digitalWrite(GREEN_LED,  HIGH);
}
void publishState(const char* s) {
    StaticJsonDocument<128> d; d["road"] = ROAD_ID; d["state"] = s;
    char b[128]; serializeJson(d, b);
    mqttClient.publish(PUB_STATE.c_str(), b, true);
    Serial.printf("💡 LED → %s\n", s);
}

// ── Ultrasonic: measure one sensor ───────────────────────────────────────────
float measureUS(int trigPin, int echoPin) {
    digitalWrite(trigPin, LOW);  delayMicroseconds(2);
    digitalWrite(trigPin, HIGH); delayMicroseconds(10);
    digitalWrite(trigPin, LOW);
    long dur = pulseIn(echoPin, HIGH, 20000UL); // 20ms timeout = ~340cm max
    if (dur == 0) return MAX_DIST_CM + 1.0f;    // no echo = clear
    float cm = (dur * 0.034f) / 2.0f;
    return cm;
}

// ── Update queue detection state for one US sensor ───────────────────────────
// Returns true if the sensor is NOW confirmed stable (blocked for ≥ STABLE_MS)
bool updateUSState(USState &st, int trigPin, int echoPin) {
    unsigned long now = millis();
    if (now - st.lastMeasMs < US_MEASURE_MS) return st.stable;
    st.lastMeasMs = now;

    float dist = measureUS(trigPin, echoPin);
    st.lastRaw  = dist;

    bool blocked = (dist < ROAD_WIDTH_CM && dist > 0.1f);

    if (blocked) {
        if (st.blockedSince == 0) st.blockedSince = now;          // start timer
        if (!st.stable && (now - st.blockedSince >= STABLE_MS)) {
            st.stable = true;                                      // confirmed!
        }
    } else {
        st.blockedSince = 0;
        st.stable       = false;                                   // cleared
    }

    return st.stable;
}

// ── Compute queue level and publish US data every 500ms ──────────────────────
void publishUS() {
    if (millis() - lastUSPublishMs < 500) return;
    lastUSPublishMs = millis();

    bool s1 = updateUSState(us1State, US1_TRIG, US1_ECHO);
    bool s2 = updateUSState(us2State, US2_TRIG, US2_ECHO);

    // US2 alone (without US1) = invalid queue — treat as None
    String ql = "None";
    if (s1 && s2)  ql = "Heavy";
    else if (s1)   ql = "Light";

    StaticJsonDocument<192> doc;
    doc["road"]      = ROAD_ID;
    doc["us1Stable"] = s1;
    doc["us2Stable"] = s2;
    doc["us1Raw"]    = (int)us1State.lastRaw;
    doc["us2Raw"]    = (int)us2State.lastRaw;
    doc["queueLevel"] = ql;
    doc["timestamp"]  = millis();
    char buf[192]; serializeJson(doc, buf);
    mqttClient.publish(PUB_US.c_str(), buf);

    Serial.printf("📡 US [%s]: US1=%s(%.1fcm) US2=%s(%.1fcm) → %s\n",
        ROAD_ID,
        s1 ? "STABLE" : "clear", us1State.lastRaw,
        s2 ? "STABLE" : "clear", us2State.lastRaw,
        ql.c_str());
}

// ── Piezo ─────────────────────────────────────────────────────────────────────
void publishPiezo() {
    if (millis() - lastPiezoMs < 1000) return;
    lastPiezoMs = millis();
    int  pz  = analogRead(PIEZO_PIN);
    bool pv  = (pz > 500);
    if (pv != heavyVehicle) {
        heavyVehicle = pv;
        if (pv) Serial.printf("🚛 Piezo: heavy vehicle! val=%d\n", pz);
    }
    StaticJsonDocument<128> doc;
    doc["road"] = ROAD_ID; doc["piezoValue"] = pz; doc["heavyVehicle"] = pv;
    char buf[128]; serializeJson(doc, buf);
    mqttClient.publish(PUB_PIEZO.c_str(), buf);
}

// ── Rain (North only) ─────────────────────────────────────────────────────────
void publishRain() {
    if (millis() - lastRainMs < 2000) return;
    lastRainMs = millis();
    bool nr = (digitalRead(RAIN_PIN) == LOW);
    if (nr != rainDetected) {
        rainDetected = nr;
        Serial.printf("🌧️ Rain: %s\n", rainDetected ? "RAINING" : "DRY");
    }
    StaticJsonDocument<128> doc;
    doc["road"] = ROAD_ID; doc["rainDetected"] = rainDetected;
    doc["yellowTime"] = rainDetected ? 5 : 3;
    char buf[128]; serializeJson(doc, buf);
    mqttClient.publish(PUB_RAIN_LOCAL.c_str(), buf);
    mqttClient.publish(PUB_RAIN_ALL.c_str(), buf, true); // retained broadcast
}

// ── Local yellow time ─────────────────────────────────────────────────────────
unsigned long calcLocalYellowMs() {
    return BASE_YELLOW_MS + (rainDetected ? RAIN_YELLOW_EXTRA_MS : 0);
}

// ── Pedestrian ────────────────────────────────────────────────────────────────
void startPedCrossing() {
    Serial.println("🚶 CROSSING STARTED");
    pedCrossing = true; pedRequested = false;
    currentPhase = PHASE_RED;
    phaseEndMs   = millis() + (PED_CROSS_TIME_S * 1000UL);
    setLight(PHASE_RED); publishState("RED");
    digitalWrite(PED_RED_LED, LOW); digitalWrite(PED_GREEN_LED, HIGH);
    startCD(PED_CROSS_TIME_S);
    StaticJsonDocument<128> d;
    d["road"] = ROAD_ID; d["crossing"] = true; d["duration"] = PED_CROSS_TIME_S;
    char b[128]; serializeJson(d, b);
    mqttClient.publish(PUB_PED.c_str(), b);
    pedStartMs = millis();
}
void updatePedCrossing() {
    if (!pedCrossing) return;
    updateCD();
    if (millis() - pedStartMs < (PED_CROSS_TIME_S * 1000UL)) return;
    pedCrossing = false;
    digitalWrite(PED_GREEN_LED, LOW); digitalWrite(PED_RED_LED, HIGH); clearDisplay();
    StaticJsonDocument<128> d;
    d["road"] = ROAD_ID; d["crossing"] = false; d["duration"] = PED_CROSS_TIME_S;
    char b[128]; serializeJson(d, b);
    mqttClient.publish(PUB_PED.c_str(), b);
    Serial.println("✅ Crossing done");
    currentYellowMs = calcLocalYellowMs();
    currentPhase = PHASE_YELLOW; phaseEndMs = millis() + currentYellowMs;
    setLight(PHASE_YELLOW); publishState("YELLOW");
}
void checkPedButton() {
    if (pedCrossing || pedRequested) return;
    if (digitalRead(PED_BUTTON) != LOW) return;
    delay(50); if (digitalRead(PED_BUTTON) != LOW) return;
    pedRequested = true;
    StaticJsonDocument<128> d;
    d["road"] = ROAD_ID; d["requested"] = true;
    char b[128]; serializeJson(d, b);
    mqttClient.publish(PUB_PED.c_str(), b);
    Serial.printf("🚶 Button during %s\n",
        currentPhase==PHASE_RED?"RED":currentPhase==PHASE_YELLOW?"YELLOW":"GREEN");
    if (currentPhase == PHASE_RED) startPedCrossing();
}

// ── Light state machine ───────────────────────────────────────────────────────
void updateLightPhase() {
    if (pedCrossing) return;
    if (millis() < phaseEndMs) return;
    switch (currentPhase) {
        case PHASE_GREEN:
            currentYellowMs = serverControlled ? currentYellowMs : calcLocalYellowMs();
            currentPhase = PHASE_YELLOW; phaseEndMs = millis() + currentYellowMs;
            setLight(PHASE_YELLOW); publishState("YELLOW");
            Serial.printf("🟡 YELLOW %.1fs\n", currentYellowMs / 1000.0);
            break;
        case PHASE_YELLOW:
            if (pedRequested && !pedCrossing) { startPedCrossing(); }
            else {
                currentPhase = PHASE_RED;
                bool alive = (millis() - lastServerCmdMs < SERVER_TIMEOUT_MS);
                phaseEndMs = millis() + (alive ? 60000UL : currentRedMs);
                setLight(PHASE_RED); publishState("RED");
                Serial.println("🔴 RED");
                serverControlled = false;
            }
            break;
        case PHASE_RED:
            if (millis() - lastServerCmdMs >= SERVER_TIMEOUT_MS) {
                currentGreenMs  = BASE_GREEN_MS;
                currentYellowMs = calcLocalYellowMs();
                currentPhase = PHASE_GREEN; phaseEndMs = millis() + currentGreenMs;
                setLight(PHASE_GREEN); publishState("GREEN");
                Serial.printf("🟢 [FALLBACK] GREEN %.1fs\n", currentGreenMs / 1000.0);
            } else {
                phaseEndMs = millis() + 2000UL;
            }
            break;
    }
}

// ── MQTT callback ─────────────────────────────────────────────────────────────
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    String msg = ""; for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

    // Pedestrian command from server
    String pedTopic = String("traffic/pedestrian/cmd/") + ROAD_ID;
    if (String(topic) == pedTopic) {
        StaticJsonDocument<128> pd;
        if (!deserializeJson(pd, msg)) {
            String action = pd["action"].as<String>();
            if (action == "START_CROSSING") {
                int dur = pd["duration"] | 3;
                pedCrossing = true; pedRequested = false; pedStartMs = millis();
                currentPhase = PHASE_RED;
                phaseEndMs = millis() + (unsigned long)(dur * 1000UL);
                setLight(PHASE_RED); publishState("RED");
                digitalWrite(PED_RED_LED, LOW); digitalWrite(PED_GREEN_LED, HIGH);
                startCD(dur);
            } else if (action == "END_CROSSING") {
                pedCrossing = false; pedRequested = false;
                digitalWrite(PED_GREEN_LED, LOW); digitalWrite(PED_RED_LED, HIGH); clearDisplay();
            } else if (action == "SHOW_YELLOW_COUNTDOWN") {
                startCD(pd["duration"] | 3);
            }
        }
        return;
    }

    // Traffic control command from server
    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, msg)) { Serial.println("❌ JSON error"); return; }

    String signal  = doc["signal"].as<String>();
    int greenSec   = doc["greenTime"]  | 3;
    int yellowSec  = doc["yellowTime"] | 3;
    int redSec     = doc["redTime"]    | 0;

    lastServerCmdMs  = millis();
    serverControlled = true;

    Serial.println("════════════════════════════════════════");
    Serial.printf("  Road: %s  Signal: %s\n", ROAD_ID, signal.c_str());
    Serial.printf("  Green:%ds  Yellow:%ds  Red:%ds\n", greenSec, yellowSec, redSec > 0 ? redSec : greenSec + yellowSec);
    Serial.printf("  US1:%s  US2:%s  Rain:%s  Heavy:%s\n",
        us1State.stable ? "STABLE" : "clear",
        us2State.stable ? "STABLE" : "clear",
        rainDetected ? "YES" : "NO",
        heavyVehicle ? "YES" : "NO");
    Serial.printf("  Queue: %s\n",
        (us1State.stable && us2State.stable) ? "HEAVY" :
        us1State.stable ? "LIGHT" : "NONE");
    Serial.println("════════════════════════════════════════");

    if (pedCrossing) { Serial.println("⚠️  Ped crossing — ignoring"); return; }

    if (signal == "GREEN") {
        currentGreenMs  = (unsigned long)greenSec  * 1000UL;
        currentYellowMs = (unsigned long)yellowSec * 1000UL;
        currentRedMs    = redSec > 0 ? (unsigned long)redSec * 1000UL : currentGreenMs + currentYellowMs;
        currentPhase = PHASE_GREEN; phaseEndMs = millis() + currentGreenMs;
        setLight(PHASE_GREEN); publishState("GREEN");
        Serial.printf("🟢 GREEN %ds\n", greenSec);
    } else if (signal == "YELLOW") {
        currentYellowMs = (unsigned long)yellowSec * 1000UL;
        currentPhase = PHASE_YELLOW; phaseEndMs = millis() + currentYellowMs;
        setLight(PHASE_YELLOW); publishState("YELLOW");
        Serial.printf("🟡 YELLOW %ds\n", yellowSec);
    } else if (signal == "RED") {
        currentRedMs = redSec > 0 ? (unsigned long)redSec * 1000UL : BASE_YELLOW_MS;
        currentPhase = PHASE_RED; phaseEndMs = millis() + currentRedMs;
        setLight(PHASE_RED); publishState("RED");
        Serial.printf("🔴 RED %ds\n", redSec > 0 ? redSec : 3);
    }
}

// ── WiFi / MQTT ───────────────────────────────────────────────────────────────
void connectWiFi() {
    Serial.printf("\n📶 WiFi: %s\n", WIFI_SSID);
    WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID, WIFI_PASS);
    int t = 0;
    while (WiFi.status() != WL_CONNECTED && t < 40) { delay(500); Serial.print("."); t++; }
    if (WiFi.status() == WL_CONNECTED)
        Serial.printf("\n✅ IP: %s\n", WiFi.localIP().toString().c_str());
    else
        Serial.println("\n❌ WiFi FAILED");
}
void connectMQTT() {
    String cid = String("HYDRA-") + ROAD_ID + "-" + String(random(0xffff), HEX);
    if (mqttClient.connect(cid.c_str())) {
        mqttClient.subscribe(SUB_CONTROL.c_str());
        String pedTopic = String("traffic/pedestrian/cmd/") + ROAD_ID;
        mqttClient.subscribe(pedTopic.c_str());
        Serial.printf("✅ MQTT OK. Sub: %s\n", SUB_CONTROL.c_str());
    } else {
        Serial.printf("❌ MQTT fail rc=%d\n", mqttClient.state());
    }
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200); delay(500);
    Serial.println("\n╔══════════════════════════════════════════╗");
    Serial.println("║  HYDRA v8.0 — NORTH ROAD NODE            ║");
    Serial.println("║  Dual Ultrasonic Queue Detection         ║");
    Serial.println("║  US1=5cm US2=15cm Road=7cm wide          ║");
    Serial.println("╚══════════════════════════════════════════╝");

    pinMode(US1_TRIG, OUTPUT); pinMode(US1_ECHO, INPUT);
    pinMode(US2_TRIG, OUTPUT); pinMode(US2_ECHO, INPUT);
    pinMode(RED_LED, OUTPUT); pinMode(YELLOW_LED, OUTPUT); pinMode(GREEN_LED, OUTPUT);
    pinMode(PED_RED_LED, OUTPUT); pinMode(PED_GREEN_LED, OUTPUT);
    for (int i = 0; i < 7; i++) pinMode(SEG_PINS[i], OUTPUT);
    pinMode(PIEZO_PIN, INPUT);
    pinMode(RAIN_PIN, INPUT_PULLUP);
    pinMode(PED_BUTTON, INPUT_PULLUP);

    setLight(PHASE_RED);
    digitalWrite(PED_RED_LED, HIGH); digitalWrite(PED_GREEN_LED, LOW);
    clearDisplay();

    rainDetected = (digitalRead(RAIN_PIN) == LOW);
    heavyVehicle = (analogRead(PIEZO_PIN) > 500);

    PUB_US          = String("traffic/us/")         + ROAD_ID;
    PUB_PIEZO       = String("traffic/piezo/")      + ROAD_ID;
    PUB_RAIN_LOCAL  = String("traffic/rain/")       + ROAD_ID;
    PUB_RAIN_ALL    = "traffic/rain/all";
    PUB_PED         = String("traffic/pedestrian/") + ROAD_ID;
    PUB_STATE       = String("traffic/state/")      + ROAD_ID;
    SUB_CONTROL     = String("traffic/control/")    + ROAD_ID;

    connectWiFi();
    mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
    mqttClient.setCallback(mqttCallback);
    connectMQTT();

    currentPhase     = PHASE_RED;
    phaseEndMs       = millis() + SERVER_TIMEOUT_MS;
    serverControlled = false;
    lastServerCmdMs  = millis();

    setLight(PHASE_RED); publishState("RED");
    Serial.println("\n🔴 RED — waiting for server...\n");
}

// ── Loop ──────────────────────────────────────────────────────────────────────
void loop() {
    if (WiFi.status() != WL_CONNECTED) { Serial.println("📶 Reconnecting..."); connectWiFi(); }
    if (!mqttClient.connected()) connectMQTT();
    mqttClient.loop();
    updateLightPhase();
    updatePedCrossing();
    checkPedButton();
    publishUS();
    publishPiezo();
    publishRain(); // North only
}
