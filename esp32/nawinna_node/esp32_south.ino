// ═══════════════════════════════════════════════════════════════════════════
// HYDRA — ESP32 SOUTH ROAD NODE
// Nawinna Junction, Kurunegala
//
// HARDWARE ON THIS ESP32:
//   - Ultrasonic Sensor HC-SR04      (vehicle distance from stop line)
//   - IR Sensor 1 (0–5cm zone)       (light traffic detection)
//   - IR Sensor 2 (5–10cm zone)      (heavy traffic detection)
//   - Piezo Vibration Sensor         (heavy vehicle detection, analog)
//   - NO Rain Sensor here            ← Rain data received from North ESP32
//   - Pedestrian Push Button
//   - Pedestrian RED LED
//   - Pedestrian GREEN LED
//   - 7-Segment Display              (pedestrian countdown, common cathode)
//   - Traffic Light Module           (RED / YELLOW / GREEN)
//
// NEXT INTERSECTION FOR GOOGLE TRAFFIC:
//   South road comes from → Clocktower Junction direction
//   (server checks Clocktower Junction traffic to decide South priority)
//
// LOGIC:
//   - Sends sensor data to AWS cloud server via MQTT
//   - Subscribes to traffic/rain/all to receive rain status from North ESP32
//   - Receives GREEN/YELLOW/RED + timing commands from server
//   - Hybrid: if server silent >30s, runs local fallback cycle
//
// PIN ASSIGNMENTS (safe defaults):
//   TRIG         = GPIO 5
//   ECHO         = GPIO 18   (use 1kΩ + 2kΩ voltage divider: 5V→3.3V)
//   RED_LED      = GPIO 26
//   YELLOW_LED   = GPIO 27
//   GREEN_LED    = GPIO 14
//   IR_SENSOR_1  = GPIO 34   (input only, external 10kΩ pullup to 3.3V)
//   IR_SENSOR_2  = GPIO 35   (input only, external 10kΩ pullup to 3.3V)
//   PIEZO_PIN    = GPIO 32   (analog)
//   PED_BUTTON   = GPIO 25   (INPUT_PULLUP, LOW = pressed)
//   PED_RED_LED  = GPIO 19
//   PED_GREEN_LED= GPIO 21
//   SEG_A        = GPIO 2
//   SEG_B        = GPIO 15
//   SEG_C        = GPIO 12
//   SEG_D        = GPIO 13
//   SEG_E        = GPIO 22
//   SEG_F        = GPIO 23
//   SEG_G        = GPIO 4
// ═══════════════════════════════════════════════════════════════════════════

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ── ROAD IDENTITY ────────────────────────────────────────────────────────────
const char* ROAD_ID = "South";

// ── WIFI CREDENTIALS ─────────────────────────────────────────────────────────
const char* WIFI_SSID   = "Dialog 4G 940";
const char* WIFI_PASS   = "Robbin123@hood";

// ── MQTT (AWS CLOUD SERVER) ───────────────────────────────────────────────────
const char* MQTT_SERVER = "56.228.30.50";
const int   MQTT_PORT   = 1883;

// ── PIN DEFINITIONS ───────────────────────────────────────────────────────────
#define TRIG_PIN        5
#define ECHO_PIN        18
#define RED_LED         26
#define YELLOW_LED      27
#define GREEN_LED       14
#define IR_SENSOR_1     34
#define IR_SENSOR_2     35
#define PIEZO_PIN       32
// NO RAIN_PIN on South — receives rain data from North via MQTT
#define PED_BUTTON      25
#define PED_RED_LED     19
#define PED_GREEN_LED   21
#define SEG_A           2
#define SEG_B           15
#define SEG_C           12
#define SEG_D           13
#define SEG_E           22
#define SEG_F           23
#define SEG_G           4

// ── TIMING DEFAULTS ───────────────────────────────────────────────────────────
#define BASE_GREEN_MS        3000UL
#define BASE_YELLOW_MS       3000UL
#define BASE_RED_MS          3000UL
#define LIGHT_TRAFFIC_BONUS  3000UL
#define HEAVY_TRAFFIC_BONUS  6000UL
#define PIEZO_BONUS          5000UL
#define RAIN_YELLOW_EXTRA    2000UL
#define PED_CROSS_TIME_S     10
#define SERVER_TIMEOUT_MS    30000UL

// ── MQTT TOPICS ───────────────────────────────────────────────────────────────
String PUB_ULTRASONIC;
String PUB_IR;
String PUB_PIEZO;
String PUB_PED;
String PUB_STATE;
String SUB_CONTROL;
// South subscribes to rain broadcast from North
const char* SUB_RAIN_ALL = "traffic/rain/all";

// ── MQTT CLIENT ───────────────────────────────────────────────────────────────
WiFiClient   wifiClient;
PubSubClient mqttClient(wifiClient);

// ── STATE ─────────────────────────────────────────────────────────────────────
enum LightPhase { PHASE_RED, PHASE_YELLOW, PHASE_GREEN };
LightPhase    currentPhase     = PHASE_RED;
unsigned long phaseEndMs       = 0;
unsigned long lastServerCmdMs  = 0;
bool          serverControlled = false;

unsigned long currentGreenMs   = BASE_GREEN_MS;
unsigned long currentYellowMs  = BASE_YELLOW_MS;
unsigned long currentRedMs     = BASE_RED_MS;

bool ir1Blocked   = false;
bool ir2Blocked   = false;
bool rainDetected = false;   // received from North ESP32 via MQTT
bool heavyVehicle = false;

bool          pedRequested = false;
bool          pedCrossing  = false;
unsigned long pedStartMs   = 0;

unsigned long lastUltrasonicMs = 0;
unsigned long lastIRMs         = 0;
unsigned long lastPiezoMs      = 0;

// ── 7-SEGMENT ─────────────────────────────────────────────────────────────────
const int SEG_PINS[7] = { SEG_A, SEG_B, SEG_C, SEG_D, SEG_E, SEG_F, SEG_G };
const byte DIGIT_PATTERNS[10] = {
    0b1111110, 0b0110000, 0b1101101, 0b1111001, 0b0110011,
    0b1011011, 0b1011111, 0b1110000, 0b1111111, 0b1111011
};

void clearDisplay() {
    for (int i = 0; i < 7; i++) digitalWrite(SEG_PINS[i], LOW);
}
void displayDigit(int num) {
    if (num < 0 || num > 9) { clearDisplay(); return; }
    byte p = DIGIT_PATTERNS[num];
    for (int i = 0; i < 7; i++)
        digitalWrite(SEG_PINS[i], (p >> (6 - i)) & 1 ? HIGH : LOW);
}

struct CountdownState {
    bool active = false; int remaining = 0; unsigned long nextTickMs = 0;
} pedCountdown;

void startPedCountdown(int s) {
    pedCountdown.active = true;
    pedCountdown.remaining = s;
    pedCountdown.nextTickMs = millis();
    displayDigit(s > 9 ? 9 : s);
}
void updatePedCountdown() {
    if (!pedCountdown.active) return;
    if (millis() >= pedCountdown.nextTickMs) {
        pedCountdown.remaining--;
        pedCountdown.nextTickMs = millis() + 1000UL;
        if (pedCountdown.remaining <= 0) { pedCountdown.active = false; clearDisplay(); }
        else displayDigit(pedCountdown.remaining > 9 ? 9 : pedCountdown.remaining);
    }
}

// ── TRAFFIC LIGHT ─────────────────────────────────────────────────────────────
void setLight(LightPhase phase) {
    digitalWrite(RED_LED, LOW); digitalWrite(YELLOW_LED, LOW); digitalWrite(GREEN_LED, LOW);
    delay(30);
    if (phase == PHASE_RED)    digitalWrite(RED_LED,    HIGH);
    if (phase == PHASE_YELLOW) digitalWrite(YELLOW_LED, HIGH);
    if (phase == PHASE_GREEN)  digitalWrite(GREEN_LED,  HIGH);
}
void publishState(const char* state) {
    StaticJsonDocument<128> doc;
    doc["road"] = ROAD_ID; doc["state"] = state;
    char buf[128]; serializeJson(doc, buf);
    mqttClient.publish(PUB_STATE.c_str(), buf, true);
    Serial.printf("💡 LED State → %s\n", state);
}

// ── LOCAL TIMING CALC ─────────────────────────────────────────────────────────
unsigned long calcLocalGreenMs() {
    bool b1 = (digitalRead(IR_SENSOR_1) == LOW);
    bool b2 = (digitalRead(IR_SENSOR_2) == LOW);
    bool pv = (analogRead(PIEZO_PIN) > 500);
    unsigned long g = BASE_GREEN_MS;
    if (b1 && b2) { g += HEAVY_TRAFFIC_BONUS; if (pv) g += PIEZO_BONUS; }
    else if (b1) g += LIGHT_TRAFFIC_BONUS;
    return g;
}
unsigned long calcLocalYellowMs() {
    return BASE_YELLOW_MS + (rainDetected ? RAIN_YELLOW_EXTRA : 0);
}

// ── PEDESTRIAN ────────────────────────────────────────────────────────────────
void startPedestrianCrossing() {
    Serial.println("🚶 PEDESTRIAN CROSSING STARTED");
    pedCrossing = true; pedRequested = false;
    currentPhase = PHASE_RED;
    phaseEndMs   = millis() + (PED_CROSS_TIME_S * 1000UL);
    setLight(PHASE_RED); publishState("RED");
    digitalWrite(PED_RED_LED, LOW); digitalWrite(PED_GREEN_LED, HIGH);
    startPedCountdown(PED_CROSS_TIME_S);
    StaticJsonDocument<128> doc;
    doc["road"] = ROAD_ID; doc["crossing"] = true; doc["duration"] = PED_CROSS_TIME_S;
    char buf[128]; serializeJson(doc, buf);
    mqttClient.publish(PUB_PED.c_str(), buf);
    pedStartMs = millis();
}
void updatePedestrianCrossing() {
    if (!pedCrossing) return;
    updatePedCountdown();
    if (millis() - pedStartMs < (PED_CROSS_TIME_S * 1000UL)) return;
    pedCrossing = false;
    digitalWrite(PED_GREEN_LED, LOW); digitalWrite(PED_RED_LED, HIGH); clearDisplay();
    StaticJsonDocument<128> doc;
    doc["road"] = ROAD_ID; doc["crossing"] = false; doc["duration"] = PED_CROSS_TIME_S;
    char buf[128]; serializeJson(doc, buf);
    mqttClient.publish(PUB_PED.c_str(), buf);
    Serial.println("✅ Pedestrian crossing finished");
    currentYellowMs = calcLocalYellowMs();
    currentPhase = PHASE_YELLOW;
    phaseEndMs   = millis() + currentYellowMs;
    setLight(PHASE_YELLOW); publishState("YELLOW");
}
void checkPedestrianButton() {
    if (pedCrossing || pedRequested) return;
    if (digitalRead(PED_BUTTON) != LOW) return;
    delay(50);
    if (digitalRead(PED_BUTTON) != LOW) return;
    pedRequested = true;
    StaticJsonDocument<128> doc;
    doc["road"] = ROAD_ID; doc["requested"] = true;
    char buf[128]; serializeJson(doc, buf);
    mqttClient.publish(PUB_PED.c_str(), buf);
    Serial.printf("🚶 Button pressed during %s\n",
        currentPhase==PHASE_RED?"RED":currentPhase==PHASE_YELLOW?"YELLOW":"GREEN");
    if (currentPhase == PHASE_RED) startPedestrianCrossing();
}

// ── LIGHT STATE MACHINE ───────────────────────────────────────────────────────
void updateLightPhase() {
    if (pedCrossing) return;
    if (millis() < phaseEndMs) return;
    switch (currentPhase) {
        case PHASE_GREEN:
            currentYellowMs = serverControlled ? currentYellowMs : calcLocalYellowMs();
            currentPhase = PHASE_YELLOW;
            phaseEndMs   = millis() + currentYellowMs;
            setLight(PHASE_YELLOW); publishState("YELLOW");
            Serial.printf("🟡 YELLOW for %.1fs\n", currentYellowMs/1000.0);
            break;
        case PHASE_YELLOW:
            if (pedRequested && !pedCrossing) {
                startPedestrianCrossing();
            } else {
                currentPhase = PHASE_RED;
                bool serverAlive = (millis() - lastServerCmdMs < SERVER_TIMEOUT_MS);
                phaseEndMs = millis() + (serverAlive ? 60000UL : currentRedMs);
                setLight(PHASE_RED); publishState("RED");
                Serial.println("🔴 RED");
                serverControlled = false;
            }
            break;
        case PHASE_RED:
            if (millis() - lastServerCmdMs >= SERVER_TIMEOUT_MS) {
                currentGreenMs  = calcLocalGreenMs();
                currentYellowMs = calcLocalYellowMs();
                currentPhase = PHASE_GREEN;
                phaseEndMs   = millis() + currentGreenMs;
                setLight(PHASE_GREEN); publishState("GREEN");
                Serial.printf("🟢 [FALLBACK] GREEN for %.1fs\n", currentGreenMs/1000.0);
            } else {
                phaseEndMs = millis() + 2000UL;
            }
            break;
    }
}

// ── MQTT CALLBACK ─────────────────────────────────────────────────────────────
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    String msg = "";
    for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

    // ── Pedestrian command from server ─────────────────────────────────────
    String pedCmdTopic = String("traffic/pedestrian/cmd/") + ROAD_ID;
    if(String(topic) == pedCmdTopic){
        StaticJsonDocument<128> pd;
        if(!deserializeJson(pd, msg)){
            String action = pd["action"].as<String>();
            if(action == "START_CROSSING"){
                int dur = pd["duration"] | 3;
                Serial.printf("🚶 Server: START_CROSSING %ds\n", dur);
                pedCrossing  = true;
                pedRequested = false;
                pedStartMs   = millis();
                currentPhase = PHASE_RED;
                phaseEndMs   = millis() + (unsigned long)(dur * 1000UL);
                setLight(PHASE_RED);
                publishState("RED");
                digitalWrite(PED_RED_LED,   LOW);
                digitalWrite(PED_GREEN_LED, HIGH);
                startPedCountdown(dur);
            }
            else if(action == "END_CROSSING"){
                Serial.println("🚶 Server: END_CROSSING");
                pedCrossing  = false;
                pedRequested = false;
                digitalWrite(PED_GREEN_LED, LOW);
                digitalWrite(PED_RED_LED,   HIGH);
                clearDisplay();
            }
            else if(action == "SHOW_YELLOW_COUNTDOWN"){
                int dur = pd["duration"] | 3;
                Serial.printf("🚶 Server: SHOW_YELLOW_COUNTDOWN %ds on 7-seg\n", dur);
                startPedCountdown(dur);
            }
        }
        return;
    }

    // ── Handle rain broadcast from North ESP32 ────────────────────────────────
    if (String(topic) == String(SUB_RAIN_ALL)) {
        StaticJsonDocument<128> rdoc;
        if (!deserializeJson(rdoc, msg)) {
            bool newRain = rdoc["rainDetected"] | false;
            if (newRain != rainDetected) {
                rainDetected = newRain;
                Serial.printf("🌧️ Rain update received from North: %s\n",
                    rainDetected ? "RAINING" : "DRY");
            }
        }
        return;
    }

    // ── Handle server traffic control command ─────────────────────────────────
    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, msg)) {
        Serial.println("❌ JSON parse error"); return;
    }

    String signal    = doc["signal"].as<String>();
    int    greenSec  = doc["greenTime"]  | 5;
    int    yellowSec = doc["yellowTime"] | 3;
    int    redSec    = doc["redTime"]    | 0;

    lastServerCmdMs  = millis();
    serverControlled = true;

    Serial.println("════════════════════════════════════════");
    Serial.printf("  Road:        %s\n", ROAD_ID);
    Serial.printf("  Signal:      %s\n", signal.c_str());
    Serial.printf("  Green Time:  %d s\n", greenSec);
    Serial.printf("  Yellow Time: %d s\n", yellowSec);
    Serial.printf("  Red Time:    %d s\n", redSec > 0 ? redSec : greenSec + yellowSec);
    Serial.printf("  IR1:         %s\n", ir1Blocked ? "BLOCKED" : "CLEAR");
    Serial.printf("  IR2:         %s\n", ir2Blocked ? "BLOCKED" : "CLEAR");
    Serial.printf("  Rain:        %s\n", rainDetected ? "YES (5s yellow)" : "NO (3s yellow)");
    Serial.printf("  HeavyVehicle:%s\n", heavyVehicle ? "YES" : "NO");
    Serial.println("════════════════════════════════════════");

    if (pedCrossing) { Serial.println("⚠️  Pedestrian crossing active — ignoring"); return; }

    if (signal == "GREEN") {
        currentGreenMs  = (unsigned long)greenSec  * 1000UL;
        currentYellowMs = (unsigned long)yellowSec * 1000UL;
        currentRedMs    = redSec > 0 ? (unsigned long)redSec * 1000UL : currentGreenMs + currentYellowMs;
        currentPhase = PHASE_GREEN;
        phaseEndMs   = millis() + currentGreenMs;
        setLight(PHASE_GREEN); publishState("GREEN");
        Serial.printf("🟢 GREEN for %ds\n", greenSec);
    } else if (signal == "YELLOW") {
        currentYellowMs = (unsigned long)yellowSec * 1000UL;
        currentPhase = PHASE_YELLOW;
        phaseEndMs   = millis() + currentYellowMs;
        setLight(PHASE_YELLOW); publishState("YELLOW");
        Serial.printf("🟡 YELLOW for %ds\n", yellowSec);
    } else if (signal == "RED") {
        currentRedMs = redSec > 0 ? (unsigned long)redSec * 1000UL : BASE_RED_MS;
        currentPhase = PHASE_RED;
        phaseEndMs   = millis() + currentRedMs;
        setLight(PHASE_RED); publishState("RED");
        Serial.printf("🔴 RED for %ds\n", redSec > 0 ? redSec : 3);
    }
}

// ── SENSOR PUBLISHING ─────────────────────────────────────────────────────────
float measureDistance() {
    digitalWrite(TRIG_PIN, LOW); delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
    long dur = pulseIn(ECHO_PIN, HIGH, 30000UL);
    if (dur == 0) return 5000.0f;
    return (dur * 0.034f) / 2.0f;
}
void publishUltrasonic() {
    if (millis() - lastUltrasonicMs < 500) return;
    lastUltrasonicMs = millis();
    float dist = measureDistance();
    bool hasV = (dist < 5000.0f && dist <= 400.0f);
    StaticJsonDocument<128> doc;
    doc["road"] = ROAD_ID; doc["distanceCm"] = dist;
    doc["vehicleNearby"] = hasV; doc["timestamp"] = millis();
    char buf[128]; serializeJson(doc, buf);
    mqttClient.publish(PUB_ULTRASONIC.c_str(), buf);
    if (hasV) Serial.printf("📡 Ultrasonic: %.1f cm\n", dist);
    else Serial.println("📡 Ultrasonic: No vehicle");
}
void publishIR() {
    if (millis() - lastIRMs < 1000) return;
    lastIRMs = millis();
    bool n1 = (digitalRead(IR_SENSOR_1) == LOW);
    bool n2 = (digitalRead(IR_SENSOR_2) == LOW);
    if (n1 != ir1Blocked || n2 != ir2Blocked) {
        ir1Blocked = n1; ir2Blocked = n2;
        Serial.printf("🔦 IR: IR1=%s IR2=%s\n",
            ir1Blocked?"BLOCKED":"CLEAR", ir2Blocked?"BLOCKED":"CLEAR");
    }
    String ql = "None";
    if (ir1Blocked && ir2Blocked) ql = "Heavy";
    else if (ir1Blocked) ql = "Light";
    StaticJsonDocument<128> doc;
    doc["road"] = ROAD_ID; doc["ir1Blocked"] = ir1Blocked;
    doc["ir2Blocked"] = ir2Blocked; doc["queueLevel"] = ql;
    char buf[128]; serializeJson(doc, buf);
    mqttClient.publish(PUB_IR.c_str(), buf);
}
void publishPiezo() {
    if (millis() - lastPiezoMs < 1000) return;
    lastPiezoMs = millis();
    int pz = analogRead(PIEZO_PIN);
    bool pv = (pz > 500);
    if (pv != heavyVehicle) {
        heavyVehicle = pv;
        if (heavyVehicle) Serial.printf("🚛 Heavy vehicle! val=%d\n", pz);
    }
    StaticJsonDocument<128> doc;
    doc["road"] = ROAD_ID; doc["piezoValue"] = pz; doc["heavyVehicle"] = pv;
    char buf[128]; serializeJson(doc, buf);
    mqttClient.publish(PUB_PIEZO.c_str(), buf);
}

// ── WIFI / MQTT ───────────────────────────────────────────────────────────────
void connectWiFi() {
    Serial.printf("\n📶 Connecting to WiFi: %s\n", WIFI_SSID);
    WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID, WIFI_PASS);
    int t = 0;
    while (WiFi.status() != WL_CONNECTED && t < 40) { delay(500); Serial.print("."); t++; }
    if (WiFi.status() == WL_CONNECTED)
        Serial.printf("\n✅ WiFi connected! IP: %s\n", WiFi.localIP().toString().c_str());
    else
        Serial.println("\n❌ WiFi FAILED");
}
void connectMQTT() {
    String cid = String("HYDRA-") + ROAD_ID + "-" + String(random(0xffff), HEX);
    if (mqttClient.connect(cid.c_str())) {
        mqttClient.subscribe(SUB_CONTROL.c_str());
        mqttClient.subscribe(SUB_RAIN_ALL);   // ← Subscribe to rain broadcast
        // ── Add pedestrian command subscription ─────────────────────────────
        String pedCmdTopic = String("traffic/pedestrian/cmd/") + ROAD_ID;
        mqttClient.subscribe(pedCmdTopic.c_str());
        Serial.printf("✅ MQTT connected. Sub: %s + rain/all\n", SUB_CONTROL.c_str());
        Serial.printf("✅ Also subscribed to ped cmd topic: %s\n", pedCmdTopic.c_str());
    } else {
        Serial.printf("❌ MQTT failed rc=%d\n", mqttClient.state());
    }
}

// ── SETUP ─────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200); delay(500);
    Serial.println("\n╔══════════════════════════════════════════╗");
    Serial.println("║  HYDRA — SOUTH ROAD NODE                 ║");
    Serial.println("║  Nawinna Junction, Kurunegala            ║");
    Serial.println("║  Google traffic: Clocktower direction    ║");
    Serial.println("╚══════════════════════════════════════════╝");

    pinMode(TRIG_PIN, OUTPUT);
    pinMode(RED_LED, OUTPUT); pinMode(YELLOW_LED, OUTPUT); pinMode(GREEN_LED, OUTPUT);
    pinMode(PED_RED_LED, OUTPUT); pinMode(PED_GREEN_LED, OUTPUT);
    for (int i = 0; i < 7; i++) pinMode(SEG_PINS[i], OUTPUT);
    pinMode(ECHO_PIN, INPUT);
    pinMode(IR_SENSOR_1, INPUT);   // external 10kΩ pullup needed
    pinMode(IR_SENSOR_2, INPUT);   // external 10kΩ pullup needed
    pinMode(PIEZO_PIN, INPUT);
    pinMode(PED_BUTTON, INPUT_PULLUP);

    setLight(PHASE_RED);
    digitalWrite(PED_RED_LED, HIGH); digitalWrite(PED_GREEN_LED, LOW);
    clearDisplay();

    ir1Blocked = (digitalRead(IR_SENSOR_1) == LOW);
    ir2Blocked = (digitalRead(IR_SENSOR_2) == LOW);
    heavyVehicle = (analogRead(PIEZO_PIN) > 500);
    rainDetected = false; // Will be updated by North ESP32 via MQTT

    PUB_ULTRASONIC = String("traffic/ultrasonic/") + ROAD_ID;
    PUB_IR         = String("traffic/ir/")         + ROAD_ID;
    PUB_PIEZO      = String("traffic/piezo/")      + ROAD_ID;
    PUB_PED        = String("traffic/pedestrian/") + ROAD_ID;
    PUB_STATE      = String("traffic/state/")      + ROAD_ID;
    SUB_CONTROL    = String("traffic/control/")    + ROAD_ID;

    connectWiFi();
    mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
    mqttClient.setCallback(mqttCallback);
    connectMQTT();

    currentPhase    = PHASE_RED;
    phaseEndMs      = millis() + SERVER_TIMEOUT_MS;
    serverControlled = false;
    lastServerCmdMs  = millis();

    setLight(PHASE_RED); publishState("RED");
    Serial.println("\n🔴 Starting RED — waiting for server command...\n");
}

// ── LOOP ──────────────────────────────────────────────────────────────────────
void loop() {
    if (WiFi.status() != WL_CONNECTED) { Serial.println("📶 WiFi lost — reconnecting..."); connectWiFi(); }
    if (!mqttClient.connected()) connectMQTT();
    mqttClient.loop();
    updateLightPhase();
    updatePedestrianCrossing();
    checkPedestrianButton();
    publishUltrasonic();
    publishIR();
    publishPiezo();
    // No publishRain() here — only North ESP32 has rain sensor
}