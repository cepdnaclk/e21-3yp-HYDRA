// ═══════════════════════════════════════════════════════════════════════════
// HYDRA — ESP32 NORTH ROAD NODE
// Nawinna Junction, Kurunegala
//
// HARDWARE ON THIS ESP32:
//   - Ultrasonic Sensor HC-SR04      (vehicle distance from stop line)
//   - IR Sensor 1 (0–5cm zone)       (light traffic detection)
//   - IR Sensor 2 (5–10cm zone)      (heavy traffic detection)
//   - Piezo Vibration Sensor         (heavy vehicle detection, analog)
//   - Rain Sensor                    ← ONLY ON NORTH ESP32 (shared for all roads)
//   - Pedestrian Push Button
//   - Pedestrian RED LED
//   - Pedestrian GREEN LED
//   - 7-Segment Display              (pedestrian countdown, common cathode)
//   - Traffic Light Module           (RED / YELLOW / GREEN)
//
// NEXT INTERSECTION FOR GOOGLE TRAFFIC:
//   North road leads to → Clocktower Junction, Kurunegala
//
// LOGIC:
//   - Sends all sensor data to AWS cloud server via MQTT
//   - Rain sensor data broadcast to ALL roads via topic traffic/rain/all
//   - Receives GREEN/YELLOW/RED + timing commands from server
//   - Hybrid: if server silent >30s, runs local fallback cycle
//   - Green time controlled by server decision (sensor + Google traffic)
//   - Yellow time: 3s dry, 5s when raining (server sends correct value)
//   - Red time for non-priority roads = winner green + yellow (dynamic)
//
// PIN ASSIGNMENTS (safe defaults — change if your wiring differs):
//   TRIG         = GPIO 5
//   ECHO         = GPIO 18   (use 1kΩ + 2kΩ voltage divider: 5V→3.3V)
//   RED_LED      = GPIO 26
//   YELLOW_LED   = GPIO 27
//   GREEN_LED    = GPIO 14
//   IR_SENSOR_1  = GPIO 34   (input only, no pullup on 34/35)
//   IR_SENSOR_2  = GPIO 35   (input only, no pullup on 34/35)
//   PIEZO_PIN    = GPIO 32   (analog)
//   RAIN_PIN     = GPIO 33   (digital, LOW = rain)
//   PED_BUTTON   = GPIO 25   (INPUT_PULLUP, LOW = pressed)
//   PED_RED_LED  = GPIO 19
//   PED_GREEN_LED= GPIO 21
//   SEG_A        = GPIO 2
//   SEG_B        = GPIO 15
//   SEG_C        = GPIO 16
//   SEG_D        = GPIO 17
//   SEG_E        = GPIO 22
//   SEG_F        = GPIO 23
//   SEG_G        = GPIO 4
// ═══════════════════════════════════════════════════════════════════════════

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ── ROAD IDENTITY ────────────────────────────────────────────────────────────
const char* ROAD_ID = "North";

// ── WIFI CREDENTIALS ─────────────────────────────────────────────────────────
const char* WIFI_SSID   = "SLT-4G_166D59";
const char* WIFI_PASS   = "F58EA0CF";

// ── MQTT (AWS CLOUD SERVER) ───────────────────────────────────────────────────
const char* MQTT_SERVER = "56.228.30.50";
const int   MQTT_PORT   = 1883;

// ── PIN DEFINITIONS ───────────────────────────────────────────────────────────
// Ultrasonic
#define TRIG_PIN        5
#define ECHO_PIN        18

// Traffic Light Module (pre-built, no extra resistors needed)
#define RED_LED         26
#define YELLOW_LED      27
#define GREEN_LED       14

// IR Sensors (LOW = blocked = vehicle present, use external 10kΩ pullup to 3.3V)
// GPIO 34 and 35 are input-only on ESP32 — no internal pullup available
#define IR_SENSOR_1     34
#define IR_SENSOR_2     35

// Piezo (analog)
#define PIEZO_PIN       32

// Rain sensor (LOW = rain, digital output)
// *** ONLY ON NORTH ESP32 ***
#define RAIN_PIN        33

// Pedestrian
#define PED_BUTTON      25
#define PED_RED_LED     19
#define PED_GREEN_LED   21

// 7-Segment (common cathode — HIGH = segment ON)
#define SEG_A           2
#define SEG_B           15
#define SEG_C           16
#define SEG_D           17
#define SEG_E           22
#define SEG_F           23
#define SEG_G           4

// ── TIMING DEFAULTS (fallback when server is silent) ─────────────────────────
#define BASE_GREEN_MS        3000UL
#define BASE_YELLOW_MS       3000UL
#define BASE_RED_MS          3000UL
#define LIGHT_TRAFFIC_BONUS  3000UL   // +3s when IR1 only blocked
#define HEAVY_TRAFFIC_BONUS  6000UL   // +6s when both IR blocked
#define PIEZO_BONUS          5000UL   // +5s on top of heavy IR
#define RAIN_YELLOW_EXTRA    2000UL   // +2s yellow when raining
#define PED_CROSS_TIME_S     10       // seconds pedestrian gets to cross
#define SERVER_TIMEOUT_MS    30000UL  // if no command in 30s, use local fallback

// ── MQTT TOPICS ───────────────────────────────────────────────────────────────
// Publish (ESP32 → Server)
String PUB_ULTRASONIC;   // traffic/ultrasonic/North
String PUB_IR;           // traffic/ir/North
String PUB_PIEZO;        // traffic/piezo/North
String PUB_RAIN_LOCAL;   // traffic/rain/North  (own road copy)
String PUB_RAIN_ALL;     // traffic/rain/all    (broadcast to all roads)
String PUB_PED;          // traffic/pedestrian/North
String PUB_STATE;        // traffic/state/North

// Subscribe (Server → ESP32)
String SUB_CONTROL;      // traffic/control/North

// ── MQTT CLIENT ───────────────────────────────────────────────────────────────
WiFiClient   wifiClient;
PubSubClient mqttClient(wifiClient);

// ── LIGHT STATE MACHINE ───────────────────────────────────────────────────────
enum LightPhase { PHASE_RED, PHASE_YELLOW, PHASE_GREEN };
LightPhase    currentPhase       = PHASE_RED;
unsigned long phaseEndMs         = 0;
unsigned long lastServerCmdMs    = 0;   // last time server sent a command
bool          serverControlled   = false;

// Current cycle timings (set by server or calculated locally)
unsigned long currentGreenMs     = BASE_GREEN_MS;
unsigned long currentYellowMs    = BASE_YELLOW_MS;
unsigned long currentRedMs       = BASE_RED_MS;

// ── SENSOR STATE ──────────────────────────────────────────────────────────────
bool ir1Blocked      = false;
bool ir2Blocked      = false;
bool rainDetected    = false;
bool heavyVehicle    = false;

// ── PEDESTRIAN STATE ──────────────────────────────────────────────────────────
bool          pedRequested  = false;
bool          pedCrossing   = false;
unsigned long pedStartMs    = 0;

// ── PUBLISH INTERVALS ────────────────────────────────────────────────────────
unsigned long lastUltrasonicMs  = 0;
unsigned long lastIRMs          = 0;
unsigned long lastPiezoMs       = 0;
unsigned long lastRainMs        = 0;

// ─────────────────────────────────────────────────────────────────────────────
// 7-SEGMENT DISPLAY HELPERS (Common Cathode: HIGH = segment ON)
// ─────────────────────────────────────────────────────────────────────────────
const int SEG_PINS[7] = { SEG_A, SEG_B, SEG_C, SEG_D, SEG_E, SEG_F, SEG_G };

// Segment patterns for digits 0–9
// Bit order: A B C D E F G
const byte DIGIT_PATTERNS[10] = {
    0b1111110, // 0: A B C D E F
    0b0110000, // 1: B C
    0b1101101, // 2: A B D E G
    0b1111001, // 3: A B C D G
    0b0110011, // 4: B C F G
    0b1011011, // 5: A C D F G
    0b1011111, // 6: A C D E F G
    0b1110000, // 7: A B C
    0b1111111, // 8: all
    0b1111011  // 9: A B C D F G
};

void clearDisplay() {
    for (int i = 0; i < 7; i++) digitalWrite(SEG_PINS[i], LOW);
}

void displayDigit(int num) {
    if (num < 0 || num > 9) { clearDisplay(); return; }
    byte pattern = DIGIT_PATTERNS[num];
    for (int i = 0; i < 7; i++) {
        digitalWrite(SEG_PINS[i], (pattern >> (6 - i)) & 1 ? HIGH : LOW);
    }
}

// Non-blocking countdown — call repeatedly from loop()
// Returns true when countdown is still running
struct CountdownState {
    bool     active    = false;
    int      remaining = 0;
    unsigned long nextTickMs = 0;
} pedCountdown;

void startPedCountdown(int seconds) {
    pedCountdown.active    = true;
    pedCountdown.remaining = seconds;
    pedCountdown.nextTickMs = millis();
    displayDigit(seconds > 9 ? 9 : seconds);
}

void updatePedCountdown() {
    if (!pedCountdown.active) return;
    if (millis() >= pedCountdown.nextTickMs) {
        pedCountdown.remaining--;
        pedCountdown.nextTickMs = millis() + 1000UL;
        if (pedCountdown.remaining <= 0) {
            pedCountdown.active = false;
            clearDisplay();
        } else {
            displayDigit(pedCountdown.remaining > 9 ? 9 : pedCountdown.remaining);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRAFFIC LIGHT CONTROL
// ─────────────────────────────────────────────────────────────────────────────
void setLight(LightPhase phase) {
    digitalWrite(RED_LED,    LOW);
    digitalWrite(YELLOW_LED, LOW);
    digitalWrite(GREEN_LED,  LOW);
    delay(30); // tiny gap prevents both LEDs on simultaneously
    switch (phase) {
        case PHASE_RED:    digitalWrite(RED_LED,    HIGH); break;
        case PHASE_YELLOW: digitalWrite(YELLOW_LED, HIGH); break;
        case PHASE_GREEN:  digitalWrite(GREEN_LED,  HIGH); break;
    }
}

void publishState(const char* state) {
    StaticJsonDocument<128> doc;
    doc["road"]  = ROAD_ID;
    doc["state"] = state;
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_STATE.c_str(), buf, true);
    Serial.printf("💡 LED State → %s\n", state);
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL GREEN TIME CALCULATION (used when server is silent / fallback)
// ─────────────────────────────────────────────────────────────────────────────
unsigned long calcLocalGreenMs() {
    // Read fresh sensor states
    bool b1 = (digitalRead(IR_SENSOR_1) == LOW);
    bool b2 = (digitalRead(IR_SENSOR_2) == LOW);
    int  pz = analogRead(PIEZO_PIN);
    bool pv = (pz > 500);

    unsigned long g = BASE_GREEN_MS;
    if (b1 && b2) {
        g += HEAVY_TRAFFIC_BONUS;
        if (pv) g += PIEZO_BONUS;
    } else if (b1) {
        g += LIGHT_TRAFFIC_BONUS;
    }
    return g;
}

unsigned long calcLocalYellowMs() {
    bool rain = (digitalRead(RAIN_PIN) == LOW);
    return BASE_YELLOW_MS + (rain ? RAIN_YELLOW_EXTRA : 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// PEDESTRIAN CROSSING
// ─────────────────────────────────────────────────────────────────────────────
void startPedestrianCrossing() {
    Serial.println("🚶 PEDESTRIAN CROSSING STARTED");
    pedCrossing   = true;
    pedRequested  = false;

    // Force RED on traffic light
    currentPhase  = PHASE_RED;
    phaseEndMs    = millis() + (PED_CROSS_TIME_S * 1000UL);
    setLight(PHASE_RED);
    publishState("RED");

    // Pedestrian signal: green walk light + countdown
    digitalWrite(PED_RED_LED,   LOW);
    digitalWrite(PED_GREEN_LED, HIGH);
    startPedCountdown(PED_CROSS_TIME_S);

    // Notify server
    StaticJsonDocument<128> doc;
    doc["road"]     = ROAD_ID;
    doc["crossing"] = true;
    doc["duration"] = PED_CROSS_TIME_S;
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_PED.c_str(), buf);
    pedStartMs = millis();
}

void updatePedestrianCrossing() {
    if (!pedCrossing) return;
    updatePedCountdown();

    if (millis() - pedStartMs >= (PED_CROSS_TIME_S * 1000UL)) {
        pedCrossing = false;
        digitalWrite(PED_GREEN_LED, LOW);
        digitalWrite(PED_RED_LED,   HIGH);
        clearDisplay();

        // Notify server crossing finished
        StaticJsonDocument<128> doc;
        doc["road"]     = ROAD_ID;
        doc["crossing"] = false;
        doc["duration"] = PED_CROSS_TIME_S;
        char buf[128];
        serializeJson(doc, buf);
        mqttClient.publish(PUB_PED.c_str(), buf);

        Serial.println("✅ Pedestrian crossing finished");

        // Go to YELLOW briefly then resume normal cycle
        currentYellowMs = calcLocalYellowMs();
        currentPhase    = PHASE_YELLOW;
        phaseEndMs      = millis() + currentYellowMs;
        setLight(PHASE_YELLOW);
        publishState("YELLOW");
        Serial.printf("🟡 Post-crossing YELLOW for %.1fs\n", currentYellowMs / 1000.0);
    }
}

void checkPedestrianButton() {
    if (pedCrossing) return; // already crossing
    if (digitalRead(PED_BUTTON) != LOW) return; // not pressed
    if (pedRequested) return; // already waiting
    delay(50); // debounce
    if (digitalRead(PED_BUTTON) != LOW) return;

    pedRequested = true;
    Serial.printf("🚶 Button pressed during %s\n",
        currentPhase == PHASE_RED ? "RED" :
        currentPhase == PHASE_YELLOW ? "YELLOW" : "GREEN");

    // Notify server about button press
    StaticJsonDocument<128> doc;
    doc["road"]      = ROAD_ID;
    doc["requested"] = true;
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_PED.c_str(), buf);

    // If RED now → immediate crossing (no need to wait)
    if (currentPhase == PHASE_RED) {
        startPedestrianCrossing();
    }
    // If YELLOW → crossing will start after yellow ends (handled in state machine)
    // If GREEN  → crossing will start after green ends (handled in state machine)
}

// ─────────────────────────────────────────────────────────────────────────────
// LIGHT PHASE STATE MACHINE (non-blocking, runs in loop)
// ─────────────────────────────────────────────────────────────────────────────
void updateLightPhase() {
    if (pedCrossing) return; // pedestrian has full control

    if (phaseEndMs > 0 && millis() < phaseEndMs) return; // current phase not finished yet

    // ── Phase just ended — decide next phase ─────────────────────────────────
    switch (currentPhase) {

        case PHASE_GREEN:
            // GREEN ended → go YELLOW
            currentYellowMs = serverControlled ? currentYellowMs : calcLocalYellowMs();
            currentPhase    = PHASE_YELLOW;
            phaseEndMs      = millis() + currentYellowMs;
            setLight(PHASE_YELLOW);
            publishState("YELLOW");
            Serial.printf("🟡 YELLOW for %.1fs\n", currentYellowMs / 1000.0);
            break;

        case PHASE_YELLOW:
            // YELLOW ended
            if (pedRequested && !pedCrossing) {
                // Pedestrian was waiting during GREEN/YELLOW → now start crossing
                startPedestrianCrossing();
            } else {
                // Normal: go RED
                currentPhase = PHASE_RED;

                // In hybrid mode: if server is alive, wait for next server command
                // If server is silent (fallback), use local red time
                bool serverAlive = (millis() - lastServerCmdMs < SERVER_TIMEOUT_MS);
                if (serverAlive) {
                    // Set a long red — server will send next command
                    phaseEndMs = millis() + 60000UL; // 60s max wait
                } else {
                    phaseEndMs = millis() + currentRedMs;
                }
                setLight(PHASE_RED);
                publishState("RED");
                Serial.printf("🔴 RED\n");
                serverControlled = false; // ready for next server command
            }
            break;

        case PHASE_RED:
            // RED ended (only reached in full fallback mode)
            // Fallback: calculate local green and start cycle
            bool serverAlive = (millis() - lastServerCmdMs < SERVER_TIMEOUT_MS);
            if (!serverAlive) {
                // Server is truly silent — run local cycle
                currentGreenMs  = calcLocalGreenMs();
                currentYellowMs = calcLocalYellowMs();
                currentPhase    = PHASE_GREEN;
                phaseEndMs      = millis() + currentGreenMs;
                setLight(PHASE_GREEN);
                publishState("GREEN");
                Serial.printf("🟢 [FALLBACK] LOCAL GREEN for %.1fs\n", currentGreenMs / 1000.0);
            } else {
                // Server alive but hasn't sent a command yet — keep waiting
                phaseEndMs = millis() + 2000UL; // check again in 2s
            }
            break;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MQTT CALLBACK — receives commands from server
// ─────────────────────────────────────────────────────────────────────────────
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    String msg = "";
    for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, msg)) {
        Serial.println("❌ JSON parse error in MQTT callback");
        return;
    }

    String signal    = doc["signal"].as<String>();
    int    greenSec  = doc["greenTime"]  | 5;
    int    yellowSec = doc["yellowTime"] | 3;
    int    redSec    = doc["redTime"]    | 0;

    lastServerCmdMs  = millis();
    serverControlled = true;

    Serial.printf("📩 SERVER CMD: %s  green=%ds  yellow=%ds  red=%ds\n",
        signal.c_str(), greenSec, yellowSec, redSec);

    // ── Print full decision to Serial Monitor ────────────────────────────────
    Serial.println("════════════════════════════════════════");
    Serial.printf("  Road:        %s\n", ROAD_ID);
    Serial.printf("  Signal:      %s\n", signal.c_str());
    Serial.printf("  Green Time:  %d s\n", greenSec);
    Serial.printf("  Yellow Time: %d s\n", yellowSec);
    Serial.printf("  Red Time:    %d s (dynamic)\n", redSec > 0 ? redSec : greenSec + yellowSec);
    Serial.printf("  IR1 Blocked: %s\n", ir1Blocked ? "YES" : "NO");
    Serial.printf("  IR2 Blocked: %s\n", ir2Blocked ? "YES" : "NO");
    Serial.printf("  Rain:        %s\n", rainDetected ? "YES" : "NO");
    Serial.printf("  HeavyVehicle:%s\n", heavyVehicle ? "YES" : "NO");
    Serial.println("════════════════════════════════════════");

    if (pedCrossing) {
        Serial.println("⚠️  Pedestrian crossing active — ignoring server command");
        return;
    }

    // Cancel any running local fallback timers
    if (currentPhase != PHASE_GREEN && signal == "GREEN") {
        // Clear previous phase cleanly
        setLight(PHASE_RED);
    }

    if (signal == "GREEN") {
        currentGreenMs   = (unsigned long)greenSec  * 1000UL;
        currentYellowMs  = (unsigned long)yellowSec * 1000UL;
        currentRedMs     = redSec > 0 ? (unsigned long)redSec * 1000UL : currentGreenMs + currentYellowMs;

        currentPhase = PHASE_GREEN;
        phaseEndMs   = millis() + currentGreenMs;
        setLight(PHASE_GREEN);
        publishState("GREEN");
        Serial.printf("🟢 GREEN for %ds\n", greenSec);

    } else if (signal == "YELLOW") {
        currentYellowMs = (unsigned long)yellowSec * 1000UL;
        currentPhase    = PHASE_YELLOW;
        phaseEndMs      = millis() + currentYellowMs;
        setLight(PHASE_YELLOW);
        publishState("YELLOW");
        Serial.printf("🟡 YELLOW for %ds\n", yellowSec);

    } else if (signal == "RED") {
        currentPhase = PHASE_RED;
        setLight(PHASE_RED);
        publishState("RED");
        if (redSec > 0) {
            currentRedMs = (unsigned long)redSec * 1000UL;
            phaseEndMs   = millis() + currentRedMs;
            Serial.printf("🔴 RED for %ds\n", redSec);
        } else {
            // Indefinite RED until next server command (for winner after yellow)
            phaseEndMs = 0; // Disable timeout
            Serial.println("🔴 RED (indefinite until next command)");
        }
}

// ─────────────────────────────────────────────────────────────────────────────
// SENSOR PUBLISH FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────
float measureDistance() {
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
    long dur = pulseIn(ECHO_PIN, HIGH, 30000UL);
    if (dur == 0) return 5000.0f;
    return (dur * 0.034f) / 2.0f;
}

void publishUltrasonic() {
    if (millis() - lastUltrasonicMs < 500) return;
    lastUltrasonicMs = millis();

    float dist = measureDistance();
    bool  hasVehicle = (dist < 5000.0f && dist <= 400.0f);

    StaticJsonDocument<128> doc;
    doc["road"]          = ROAD_ID;
    doc["distanceCm"]    = dist;
    doc["vehicleNearby"] = hasVehicle;
    doc["timestamp"]     = millis();
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_ULTRASONIC.c_str(), buf);

    if (hasVehicle)
        Serial.printf("📡 Ultrasonic: %.1f cm\n", dist);
    else
        Serial.println("📡 Ultrasonic: No vehicle");
}

void publishIR() {
    if (millis() - lastIRMs < 1000) return;
    lastIRMs = millis();

    bool newIR1 = (digitalRead(IR_SENSOR_1) == LOW);
    bool newIR2 = (digitalRead(IR_SENSOR_2) == LOW);

    if (newIR1 != ir1Blocked || newIR2 != ir2Blocked) {
        ir1Blocked = newIR1;
        ir2Blocked = newIR2;
        Serial.printf("🔦 IR changed: IR1=%s IR2=%s\n",
            ir1Blocked ? "BLOCKED" : "CLEAR",
            ir2Blocked ? "BLOCKED" : "CLEAR");
    }

    String queueLevel = "None";
    if (ir1Blocked && ir2Blocked) queueLevel = "Heavy";
    else if (ir1Blocked)          queueLevel = "Light";

    StaticJsonDocument<128> doc;
    doc["road"]       = ROAD_ID;
    doc["ir1Blocked"] = ir1Blocked;
    doc["ir2Blocked"] = ir2Blocked;
    doc["queueLevel"] = queueLevel;
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_IR.c_str(), buf);
}

void publishPiezo() {
    if (millis() - lastPiezoMs < 1000) return;
    lastPiezoMs = millis();

    int  pzVal = analogRead(PIEZO_PIN);
    bool pzHeavy = (pzVal > 500);

    if (pzHeavy != heavyVehicle) {
        heavyVehicle = pzHeavy;
        if (heavyVehicle)
            Serial.printf("🚛 Heavy vehicle detected! val=%d\n", pzVal);
    }

    StaticJsonDocument<128> doc;
    doc["road"]         = ROAD_ID;
    doc["piezoValue"]   = pzVal;
    doc["heavyVehicle"] = pzHeavy;
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_PIEZO.c_str(), buf);
}

// *** RAIN SENSOR — NORTH ESP32 ONLY ***
// Publishes to traffic/rain/North AND traffic/rain/all
// The server and other ESP32s listen to traffic/rain/all
void publishRain() {
    if (millis() - lastRainMs < 2000) return;
    lastRainMs = millis();

    bool newRain = (digitalRead(RAIN_PIN) == LOW);

    if (newRain != rainDetected) {
        rainDetected = newRain;
        Serial.printf("🌧️ Rain sensor changed: %s\n",
            rainDetected ? "RAINING (Yellow will be 5s)" : "DRY (Yellow 3s)");
    }

    StaticJsonDocument<128> doc;
    doc["road"]         = ROAD_ID;
    doc["rainDetected"] = rainDetected;
    doc["yellowTime"]   = rainDetected ? 5 : 3;
    char buf[128];
    serializeJson(doc, buf);

    // Publish to own road topic
    mqttClient.publish(PUB_RAIN_LOCAL.c_str(), buf);

    // Broadcast to all roads (server and other ESP32s subscribe to this)
    mqttClient.publish(PUB_RAIN_ALL.c_str(), buf, true); // retained = all get it on connect
}

// ─────────────────────────────────────────────────────────────────────────────
// WIFI + MQTT CONNECTION
// ─────────────────────────────────────────────────────────────────────────────
void connectWiFi() {
    Serial.printf("\n📶 Connecting to WiFi: %s\n", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    int tries = 0;
    while (WiFi.status() != WL_CONNECTED && tries < 40) {
        delay(500); Serial.print("."); tries++;
    }
    if (WiFi.status() == WL_CONNECTED)
        Serial.printf("\n✅ WiFi connected! IP: %s\n", WiFi.localIP().toString().c_str());
    else
        Serial.println("\n❌ WiFi FAILED — check SSID/password");
}

void connectMQTT() {
    String clientId = String("HYDRA-") + ROAD_ID + "-" + String(random(0xffff), HEX);
    Serial.printf("🔌 Connecting to MQTT %s:%d ...\n", MQTT_SERVER, MQTT_PORT);
    if (mqttClient.connect(clientId.c_str())) {
        mqttClient.subscribe(SUB_CONTROL.c_str());
        Serial.printf("✅ MQTT connected. Subscribed to: %s\n", SUB_CONTROL.c_str());
    } else {
        Serial.printf("❌ MQTT failed rc=%d\n", mqttClient.state());
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n");
    Serial.println("╔══════════════════════════════════════════╗");
    Serial.println("║  HYDRA — NORTH ROAD NODE                 ║");
    Serial.println("║  Nawinna Junction, Kurunegala            ║");
    Serial.println("║  Next intersection: Clocktower Junction  ║");
    Serial.println("╚══════════════════════════════════════════╝");
    Serial.println("TIMING CONFIG:");
    Serial.println("  GREEN:  3s base | Light+3s=6s | Heavy+6s=9s | Piezo+5s=14s");
    Serial.println("  YELLOW: 3s dry  | Rain+2s=5s");
    Serial.println("  RED:    Dynamic = winner green + yellow");
    Serial.println("  RAIN SENSOR: on this ESP32, broadcast to all roads");

    // Output pins
    pinMode(TRIG_PIN,       OUTPUT);
    pinMode(RED_LED,        OUTPUT);
    pinMode(YELLOW_LED,     OUTPUT);
    pinMode(GREEN_LED,      OUTPUT);
    pinMode(PED_RED_LED,    OUTPUT);
    pinMode(PED_GREEN_LED,  OUTPUT);
    for (int i = 0; i < 7; i++) pinMode(SEG_PINS[i], OUTPUT);

    // Input pins
    // Note: GPIO 34, 35 are input-only on ESP32 — no internal pullup
    // Connect external 10kΩ resistor from GPIO34/35 to 3.3V
    pinMode(ECHO_PIN,    INPUT);
    pinMode(IR_SENSOR_1, INPUT);         // external pullup required
    pinMode(IR_SENSOR_2, INPUT);         // external pullup required
    pinMode(PIEZO_PIN,   INPUT);
    pinMode(RAIN_PIN,    INPUT_PULLUP);
    pinMode(PED_BUTTON,  INPUT_PULLUP);

    // Safe start: RED on, pedestrian RED on, display clear
    setLight(PHASE_RED);
    digitalWrite(PED_RED_LED,   HIGH);
    digitalWrite(PED_GREEN_LED, LOW);
    clearDisplay();

    // Initial sensor read
    ir1Blocked   = (digitalRead(IR_SENSOR_1) == LOW);
    ir2Blocked   = (digitalRead(IR_SENSOR_2) == LOW);
    rainDetected = (digitalRead(RAIN_PIN) == LOW);
    heavyVehicle = (analogRead(PIEZO_PIN) > 500);

    // Build MQTT topic strings
    PUB_ULTRASONIC  = String("traffic/ultrasonic/") + ROAD_ID;
    PUB_IR          = String("traffic/ir/")         + ROAD_ID;
    PUB_PIEZO       = String("traffic/piezo/")      + ROAD_ID;
    PUB_RAIN_LOCAL  = String("traffic/rain/")       + ROAD_ID;
    PUB_RAIN_ALL    = "traffic/rain/all";            // broadcast
    PUB_PED         = String("traffic/pedestrian/") + ROAD_ID;
    PUB_STATE       = String("traffic/state/")      + ROAD_ID;
    SUB_CONTROL     = String("traffic/control/")    + ROAD_ID;

    connectWiFi();
    mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
    mqttClient.setCallback(mqttCallback);
    connectMQTT();

    // Start in RED, waiting for server command
    currentPhase    = PHASE_RED;
    phaseEndMs      = millis() + SERVER_TIMEOUT_MS; // give server time to connect
    serverControlled = false;
    lastServerCmdMs  = millis();

    setLight(PHASE_RED);
    publishState("RED");
    Serial.println("\n🔴 Starting RED — waiting for server command...\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// LOOP
// ─────────────────────────────────────────────────────────────────────────────
void loop() {
    // Keep WiFi alive
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("📶 WiFi lost — reconnecting...");
        connectWiFi();
    }

    // Keep MQTT alive
    if (!mqttClient.connected()) {
        connectMQTT();
    }
    mqttClient.loop();

    // Light state machine
    updateLightPhase();

    // Pedestrian crossing timer
    updatePedestrianCrossing();

    // Button check
    checkPedestrianButton();

    // Sensor publishing
    publishUltrasonic();
    publishIR();
    publishPiezo();
    publishRain();   // ← ONLY North ESP32 publishes rain
}
