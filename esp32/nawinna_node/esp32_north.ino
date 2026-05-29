// ═══════════════════════════════════════════════════════════════════════════
// HYDRA — ESP32 NORTH ROAD NODE (ULTRASONIC VERSION)
// Nawinna Junction, Kurunegala
//
// HARDWARE ON THIS ESP32:
//   - Ultrasonic Sensor 1 (US1) - at stop line (0-100cm detection)
//   - Ultrasonic Sensor 2 (US2) - 3-4m behind stop line (queue detection)
//   - Piezo Vibration Sensor    - heavy vehicle detection
//   - Rain Sensor               - ONLY ON NORTH ESP32 (shared for all roads)
//   - Pedestrian Push Button
//   - Pedestrian RED LED
//   - Pedestrian GREEN LED
//   - 7-Segment Display         (pedestrian countdown)
//   - Traffic Light Module      (RED / YELLOW / GREEN)
//
// VEHICLE DETECTION LOGIC:
//   - US1 blocked (stable for 10+ sec) = LIGHT traffic
//   - US1 + US2 both blocked (stable) = HEAVY traffic
//   - Distance readings must be stable for 10 seconds to prevent false triggers
//
// PIN ASSIGNMENTS:
//   US1_TRIG      = GPIO 5
//   US1_ECHO      = GPIO 18
//   US2_TRIG      = GPIO 17  (NEW - second ultrasonic)
//   US2_ECHO      = GPIO 16  (NEW - second ultrasonic)
//   RED_LED       = GPIO 26
//   YELLOW_LED    = GPIO 27
//   GREEN_LED     = GPIO 14
//   PIEZO_PIN     = GPIO 32   (analog)
//   RAIN_PIN      = GPIO 33   (digital, LOW = rain)
//   PED_BUTTON    = GPIO 25   (INPUT_PULLUP, LOW = pressed)
//   PED_RED_LED   = GPIO 19
//   PED_GREEN_LED = GPIO 21
//   SEG_A         = GPIO 2
//   SEG_B         = GPIO 15
//   SEG_C         = GPIO 12
//   SEG_D         = GPIO 13
//   SEG_E         = GPIO 22
//   SEG_F         = GPIO 23
//   SEG_G         = GPIO 4
// ═══════════════════════════════════════════════════════════════════════════

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ── ROAD IDENTITY ────────────────────────────────────────────────────────────
const char* ROAD_ID = "North";

// ── WIFI CREDENTIALS ─────────────────────────────────────────────────────────
const char* WIFI_SSID   = "Dialog 4G 940";
const char* WIFI_PASS   = "Robbin123@hood";

// ── MQTT (AWS CLOUD SERVER) ───────────────────────────────────────────────────
const char* MQTT_SERVER = "56.228.30.50";
const int   MQTT_PORT   = 1883;

// ── PIN DEFINITIONS ───────────────────────────────────────────────────────────
// Ultrasonic Sensor 1 (Stop Line - 0-100cm detection)
#define US1_TRIG_PIN    5
#define US1_ECHO_PIN    18

// Ultrasonic Sensor 2 (Queue Detection - 3-4m behind stop line)
#define US2_TRIG_PIN    17
#define US2_ECHO_PIN    16

// Traffic Light Module
#define RED_LED         26
#define YELLOW_LED      27
#define GREEN_LED       14

// Piezo (analog - heavy vehicle detection)
#define PIEZO_PIN       32

// Rain sensor (LOW = rain, digital output - ONLY ON NORTH ESP32)
#define RAIN_PIN        33

// Pedestrian
#define PED_BUTTON      25
#define PED_RED_LED     19
#define PED_GREEN_LED   21

// 7-Segment (common cathode)
#define SEG_A           2
#define SEG_B           15
#define SEG_C           12
#define SEG_D           13
#define SEG_E           22
#define SEG_F           23
#define SEG_G           4

// ── DETECTION PARAMETERS ──────────────────────────────────────────────────────
#define US1_STOP_LINE_THRESHOLD_CM    100    // Vehicle at stop line
#define US2_QUEUE_THRESHOLD_CM        350    // 3.5m detection (queue length)
#define STABILITY_REQUIRED_MS        10000  // 10 seconds stability required
#define SENSOR_READ_INTERVAL_MS       500   // Read sensors every 500ms

// ── TIMING DEFAULTS (fallback when server is silent) ─────────────────────────
#define BASE_GREEN_MS        3000UL
#define BASE_YELLOW_MS       3000UL
#define BASE_RED_MS          3000UL
#define LIGHT_TRAFFIC_BONUS  3000UL   // +3s when US1 blocked
#define HEAVY_TRAFFIC_BONUS  6000UL   // +6s when both US blocked
#define PIEZO_BONUS          5000UL   // +5s on top of heavy traffic
#define RAIN_YELLOW_EXTRA    2000UL   // +2s yellow when raining
#define PED_CROSS_TIME_S     10       // seconds pedestrian gets to cross
#define SERVER_TIMEOUT_MS    30000UL  // if no command in 30s, use local fallback

// ── MQTT TOPICS ───────────────────────────────────────────────────────────────
String PUB_ULTRASONIC;   // traffic/ultrasonic/North (NOW SENDS BOTH US1 & US2)
String PUB_TRAFFIC;      // traffic/queue/North (traffic level detection)
String PUB_PIEZO;        // traffic/piezo/North
String PUB_RAIN_LOCAL;   // traffic/rain/North
String PUB_RAIN_ALL;     // traffic/rain/all
String PUB_PED;          // traffic/pedestrian/North
String PUB_STATE;        // traffic/state/North
String SUB_CONTROL;      // traffic/control/North

// ── MQTT CLIENT ───────────────────────────────────────────────────────────────
WiFiClient   wifiClient;
PubSubClient mqttClient(wifiClient);

// ── ULTRASONIC STABILITY TRACKING ────────────────────────────────────────────
struct UltrasonicState {
    bool   us1Blocked = false;
    bool   us2Blocked = false;
    bool   us1Stable = false;
    bool   us2Stable = false;
    unsigned long us1BlockStartMs = 0;
    unsigned long us2BlockStartMs = 0;
    float  us1LastDist = 0;
    float  us2LastDist = 0;
};

UltrasonicState usState;

// ── LIGHT STATE MACHINE ───────────────────────────────────────────────────────
enum LightPhase { PHASE_RED, PHASE_YELLOW, PHASE_GREEN };
LightPhase    currentPhase       = PHASE_RED;
unsigned long phaseEndMs         = 0;
unsigned long lastServerCmdMs    = 0;
bool          serverControlled   = false;

// Current cycle timings
unsigned long currentGreenMs     = BASE_GREEN_MS;
unsigned long currentYellowMs    = BASE_YELLOW_MS;
unsigned long currentRedMs       = BASE_RED_MS;

// ── SENSOR STATE ──────────────────────────────────────────────────────────────
String        currentTrafficLevel = "None";  // "None", "Light", "Heavy"
bool          rainDetected        = false;
bool          heavyVehicle        = false;

// ── PEDESTRIAN STATE ──────────────────────────────────────────────────────────
bool          pedRequested  = false;
bool          pedCrossing   = false;
unsigned long pedStartMs    = 0;

// ── PUBLISH INTERVALS ────────────────────────────────────────────────────────
unsigned long lastUltrasonicMs  = 0;
unsigned long lastTrafficMs     = 0;
unsigned long lastPiezoMs       = 0;
unsigned long lastRainMs        = 0;

// ─────────────────────────────────────────────────────────────────────────────
// 7-SEGMENT DISPLAY HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const int SEG_PINS[7] = { SEG_A, SEG_B, SEG_C, SEG_D, SEG_E, SEG_F, SEG_G };

const byte DIGIT_PATTERNS[10] = {
    0b0000001, // 0
    0b1001111, // 1
    0b0010010, // 2
    0b0000110, // 3
    0b1001100, // 4
    0b0100100, // 5
    0b0100000, // 6
    0b0001111, // 7
    0b0000000, // 8
    0b0000100  // 9
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
// ULTRASONIC SENSOR READING
// ─────────────────────────────────────────────────────────────────────────────
float readUltrasonic(int trigPin, int echoPin) {
    digitalWrite(trigPin, LOW);
    delayMicroseconds(2);
    digitalWrite(trigPin, HIGH);
    delayMicroseconds(10);
    digitalWrite(trigPin, LOW);
    
    long duration = pulseIn(echoPin, HIGH, 30000UL); // 30ms timeout
    if (duration == 0) return 5000.0f; // No echo - return max range
    
    float distance = (duration * 0.034f) / 2.0f;
    return distance;
}

// ── Update ultrasonic states with 10-second stability check ─────────────────
void updateUltrasonicState() {
    // Read both sensors
    float us1Dist = readUltrasonic(US1_TRIG_PIN, US1_ECHO_PIN);
    float us2Dist = readUltrasonic(US2_TRIG_PIN, US2_ECHO_PIN);
    
    unsigned long now = millis();
    bool us1CurrentlyBlocked = (us1Dist < US1_STOP_LINE_THRESHOLD_CM);
    bool us2CurrentlyBlocked = (us2Dist < US2_QUEUE_THRESHOLD_CM);
    
    // ── US1 Stability Check ────────────────────────────────────────────────
    if (us1CurrentlyBlocked) {
        if (!usState.us1Blocked) {
            // Just became blocked - start timer
            usState.us1BlockStartMs = now;
            usState.us1Stable = false;
            Serial.printf("📡 US1 BLOCKED START - distance: %.1f cm (stability timer started)\n", us1Dist);
        } else {
            // Check if stable period has passed
            if (!usState.us1Stable && (now - usState.us1BlockStartMs) >= STABILITY_REQUIRED_MS) {
                usState.us1Stable = true;
                Serial.printf("✅ US1 STABLE for 10 seconds - LIGHT TRAFFIC DETECTED\n");
            }
        }
        usState.us1Blocked = true;
    } else {
        if (usState.us1Blocked) {
            // Vehicle left - reset
            Serial.printf("📡 US1 CLEARED - distance: %.1f cm\n", us1Dist);
            usState.us1Blocked = false;
            usState.us1Stable = false;
            usState.us1BlockStartMs = 0;
        }
    }
    
    // ── US2 Stability Check ────────────────────────────────────────────────
    if (us2CurrentlyBlocked) {
        if (!usState.us2Blocked) {
            usState.us2BlockStartMs = now;
            usState.us2Stable = false;
            Serial.printf("📡 US2 BLOCKED START - distance: %.1f cm\n", us2Dist);
        } else {
            if (!usState.us2Stable && (now - usState.us2BlockStartMs) >= STABILITY_REQUIRED_MS) {
                usState.us2Stable = true;
                Serial.printf("✅ US2 STABLE for 10 seconds - HEAVY TRAFFIC DETECTED\n");
            }
        }
        usState.us2Blocked = true;
    } else {
        if (usState.us2Blocked) {
            Serial.printf("📡 US2 CLEARED - distance: %.1f cm\n", us2Dist);
            usState.us2Blocked = false;
            usState.us2Stable = false;
            usState.us2BlockStartMs = 0;
        }
    }
    
    // Store last distances for publishing
    usState.us1LastDist = us1Dist;
    usState.us2LastDist = us2Dist;
    
    // Determine traffic level based on STABLE readings
    String newTrafficLevel = "None";
    if (usState.us1Stable && usState.us2Stable) {
        newTrafficLevel = "Heavy";
    } else if (usState.us1Stable) {
        newTrafficLevel = "Light";
    }
    
    if (newTrafficLevel != currentTrafficLevel) {
        currentTrafficLevel = newTrafficLevel;
        Serial.printf("🚦 TRAFFIC LEVEL CHANGED: %s\n", currentTrafficLevel.c_str());
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRAFFIC LIGHT CONTROL
// ─────────────────────────────────────────────────────────────────────────────
void setLight(LightPhase phase) {
    digitalWrite(RED_LED,    LOW);
    digitalWrite(YELLOW_LED, LOW);
    digitalWrite(GREEN_LED,  LOW);
    delay(30);
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

// ── LOCAL GREEN TIME CALCULATION (using ultrasonic states) ──────────────────
unsigned long calcLocalGreenMs() {
    updateUltrasonicState();  // Refresh sensor states
    
    unsigned long g = BASE_GREEN_MS;
    
    if (currentTrafficLevel == "Heavy") {
        g += HEAVY_TRAFFIC_BONUS;
        if (heavyVehicle) g += PIEZO_BONUS;
        Serial.printf("  Local calc: HEAVY traffic → %d ms + piezo=%s\n", g, heavyVehicle?"yes":"no");
    } else if (currentTrafficLevel == "Light") {
        g += LIGHT_TRAFFIC_BONUS;
        Serial.printf("  Local calc: LIGHT traffic → %d ms\n", g);
    } else {
        Serial.printf("  Local calc: NO traffic → %d ms\n", g);
    }
    
    return g;
}

unsigned long calcLocalYellowMs() {
    return BASE_YELLOW_MS + (rainDetected ? RAIN_YELLOW_EXTRA : 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// PEDESTRIAN CROSSING
// ─────────────────────────────────────────────────────────────────────────────
void startPedestrianCrossing() {
    Serial.println("🚶 PEDESTRIAN CROSSING STARTED");
    pedCrossing   = true;
    pedRequested  = false;
    
    currentPhase  = PHASE_RED;
    phaseEndMs    = millis() + (PED_CROSS_TIME_S * 1000UL);
    setLight(PHASE_RED);
    publishState("RED");
    
    digitalWrite(PED_RED_LED,   LOW);
    digitalWrite(PED_GREEN_LED, HIGH);
    startPedCountdown(PED_CROSS_TIME_S);
    
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
        
        StaticJsonDocument<128> doc;
        doc["road"]     = ROAD_ID;
        doc["crossing"] = false;
        char buf[128];
        serializeJson(doc, buf);
        mqttClient.publish(PUB_PED.c_str(), buf);
        
        Serial.println("✅ Pedestrian crossing finished");
        
        currentYellowMs = calcLocalYellowMs();
        currentPhase    = PHASE_YELLOW;
        phaseEndMs      = millis() + currentYellowMs;
        setLight(PHASE_YELLOW);
        publishState("YELLOW");
        Serial.printf("🟡 Post-crossing YELLOW for %.1fs\n", currentYellowMs / 1000.0);
    }
}

void checkPedestrianButton() {
    if (pedCrossing) return;
    if (digitalRead(PED_BUTTON) != LOW) return;
    if (pedRequested) return;
    delay(50);
    if (digitalRead(PED_BUTTON) != LOW) return;
    
    pedRequested = true;
    Serial.printf("🚶 Button pressed during %s\n",
        currentPhase == PHASE_RED ? "RED" :
        currentPhase == PHASE_YELLOW ? "YELLOW" : "GREEN");
    
    StaticJsonDocument<128> doc;
    doc["road"]      = ROAD_ID;
    doc["requested"] = true;
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_PED.c_str(), buf);
    
    if (currentPhase == PHASE_RED) {
        startPedestrianCrossing();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// LIGHT PHASE STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────
void updateLightPhase() {
    if (pedCrossing) return;
    if (millis() < phaseEndMs) return;
    
    switch (currentPhase) {
        case PHASE_GREEN:
            currentYellowMs = serverControlled ? currentYellowMs : calcLocalYellowMs();
            currentPhase    = PHASE_YELLOW;
            phaseEndMs      = millis() + currentYellowMs;
            setLight(PHASE_YELLOW);
            publishState("YELLOW");
            Serial.printf("🟡 YELLOW for %.1fs\n", currentYellowMs / 1000.0);
            break;
            
        case PHASE_YELLOW:
            if (pedRequested && !pedCrossing) {
                startPedestrianCrossing();
            } else {
                currentPhase = PHASE_RED;
                bool serverAlive = (millis() - lastServerCmdMs < SERVER_TIMEOUT_MS);
                if (serverAlive) {
                    phaseEndMs = millis() + 60000UL;
                } else {
                    phaseEndMs = millis() + currentRedMs;
                }
                setLight(PHASE_RED);
                publishState("RED");
                Serial.printf("🔴 RED\n");
                serverControlled = false;
            }
            break;
            
        case PHASE_RED:
            bool serverAlive = (millis() - lastServerCmdMs < SERVER_TIMEOUT_MS);
            if (!serverAlive) {
                currentGreenMs  = calcLocalGreenMs();
                currentYellowMs = calcLocalYellowMs();
                currentPhase    = PHASE_GREEN;
                phaseEndMs      = millis() + currentGreenMs;
                setLight(PHASE_GREEN);
                publishState("GREEN");
                Serial.printf("🟢 [FALLBACK] LOCAL GREEN for %.1fs (traffic: %s)\n", 
                    currentGreenMs / 1000.0, currentTrafficLevel.c_str());
            } else {
                phaseEndMs = millis() + 2000UL;
            }
            break;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MQTT CALLBACK
// ─────────────────────────────────────────────────────────────────────────────
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    String msg = "";
    for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
    
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
        }
        return;
    }
    
    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, msg)) {
        Serial.println("❌ JSON parse error");
        return;
    }
    
    String signal    = doc["signal"].as<String>();
    int    greenSec  = doc["greenTime"]  | 5;
    int    yellowSec = doc["yellowTime"] | 3;
    int    redSec    = doc["redTime"]    | 0;
    
    lastServerCmdMs  = millis();
    serverControlled = true;
    
    Serial.printf("📩 SERVER CMD: %s  green=%ds  yellow=%ds\n", signal.c_str(), greenSec, yellowSec);
    Serial.println("════════════════════════════════════════");
    Serial.printf("  Traffic Level: %s\n", currentTrafficLevel.c_str());
    Serial.printf("  US1 Stable: %s | US2 Stable: %s\n", 
        usState.us1Stable ? "YES" : "NO",
        usState.us2Stable ? "YES" : "NO");
    Serial.printf("  Rain: %s | Heavy Vehicle: %s\n", 
        rainDetected ? "YES" : "NO",
        heavyVehicle ? "YES" : "NO");
    Serial.println("════════════════════════════════════════");
    
    if (pedCrossing) {
        Serial.println("⚠️ Pedestrian crossing active — ignoring");
        return;
    }
    
    if (signal == "GREEN") {
        currentGreenMs   = (unsigned long)greenSec  * 1000UL;
        currentYellowMs  = (unsigned long)yellowSec * 1000UL;
        currentPhase     = PHASE_GREEN;
        phaseEndMs       = millis() + currentGreenMs;
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
        phaseEndMs   = millis() + 60000UL;
        setLight(PHASE_RED);
        publishState("RED");
        Serial.printf("🔴 RED\n");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SENSOR PUBLISH FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────
void publishUltrasonic() {
    if (millis() - lastUltrasonicMs < 500) return;
    lastUltrasonicMs = millis();
    
    updateUltrasonicState();  // Update states before publishing
    
    StaticJsonDocument<192> doc;
    doc["road"]           = ROAD_ID;
    doc["us1DistanceCm"]  = usState.us1LastDist;
    doc["us2DistanceCm"]  = usState.us2LastDist;
    doc["us1Blocked"]     = usState.us1Blocked;
    doc["us2Blocked"]     = usState.us2Blocked;
    doc["us1Stable"]      = usState.us1Stable;
    doc["us2Stable"]      = usState.us2Stable;
    doc["trafficLevel"]   = currentTrafficLevel;
    doc["timestamp"]      = millis();
    
    char buf[192];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_ULTRASONIC.c_str(), buf);
    
    Serial.printf("📡 US1: %.1fcm (%s) | US2: %.1fcm (%s) | Traffic: %s\n",
        usState.us1LastDist, usState.us1Stable ? "STABLE" : "unstable",
        usState.us2LastDist, usState.us2Stable ? "STABLE" : "unstable",
        currentTrafficLevel.c_str());
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

void publishRain() {
    if (millis() - lastRainMs < 2000) return;
    lastRainMs = millis();
    
    bool newRain = (digitalRead(RAIN_PIN) == LOW);
    
    if (newRain != rainDetected) {
        rainDetected = newRain;
        Serial.printf("🌧️ Rain: %s (Yellow %ds)\n",
            rainDetected ? "RAINING" : "DRY",
            rainDetected ? 5 : 3);
    }
    
    StaticJsonDocument<128> doc;
    doc["road"]         = ROAD_ID;
    doc["rainDetected"] = rainDetected;
    doc["yellowTime"]   = rainDetected ? 5 : 3;
    char buf[128];
    serializeJson(doc, buf);
    
    mqttClient.publish(PUB_RAIN_LOCAL.c_str(), buf);
    mqttClient.publish(PUB_RAIN_ALL.c_str(), buf, true);
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
        Serial.println("\n❌ WiFi FAILED");
}

void connectMQTT() {
    String clientId = String("HYDRA-") + ROAD_ID + "-" + String(random(0xffff), HEX);
    Serial.printf("🔌 Connecting to MQTT %s:%d ...\n", MQTT_SERVER, MQTT_PORT);
    if (mqttClient.connect(clientId.c_str())) {
        mqttClient.subscribe(SUB_CONTROL.c_str());
        String pedCmdTopic = String("traffic/pedestrian/cmd/") + ROAD_ID;
        mqttClient.subscribe(pedCmdTopic.c_str());
        Serial.printf("✅ MQTT connected\n");
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
    Serial.println("║  HYDRA — NORTH ROAD NODE (ULTRASONIC)    ║");
    Serial.println("║  Nawinna Junction, Kurunegala            ║");
    Serial.println("╚══════════════════════════════════════════╝");
    Serial.println("VEHICLE DETECTION:");
    Serial.println("  - US1 (stop line): <100cm = vehicle present");
    Serial.println("  - US2 (queue): <350cm = queue detected");
    Serial.println("  - 10 second stability required");
    Serial.println("  - Light traffic = US1 stable only");
    Serial.println("  - Heavy traffic = US1 + US2 stable");
    
    // Output pins
    pinMode(US1_TRIG_PIN, OUTPUT);
    pinMode(US2_TRIG_PIN, OUTPUT);
    pinMode(RED_LED,      OUTPUT);
    pinMode(YELLOW_LED,   OUTPUT);
    pinMode(GREEN_LED,    OUTPUT);
    pinMode(PED_RED_LED,  OUTPUT);
    pinMode(PED_GREEN_LED,OUTPUT);
    for (int i = 0; i < 7; i++) pinMode(SEG_PINS[i], OUTPUT);
    
    // Input pins
    pinMode(US1_ECHO_PIN, INPUT);
    pinMode(US2_ECHO_PIN, INPUT);
    pinMode(PIEZO_PIN,    INPUT);
    pinMode(RAIN_PIN,     INPUT_PULLUP);
    pinMode(PED_BUTTON,   INPUT_PULLUP);
    
    // Safe start
    setLight(PHASE_RED);
    digitalWrite(PED_RED_LED,   HIGH);
    digitalWrite(PED_GREEN_LED, LOW);
    clearDisplay();
    
    // Initial sensor read
    rainDetected = (digitalRead(RAIN_PIN) == LOW);
    heavyVehicle = (analogRead(PIEZO_PIN) > 500);
    
    // Build MQTT topics
    PUB_ULTRASONIC  = String("traffic/ultrasonic/") + ROAD_ID;
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
    
    currentPhase    = PHASE_RED;
    phaseEndMs      = millis() + SERVER_TIMEOUT_MS;
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
    if (WiFi.status() != WL_CONNECTED) {
        connectWiFi();
    }
    
    if (!mqttClient.connected()) {
        connectMQTT();
    }
    mqttClient.loop();
    
    updateLightPhase();
    updatePedestrianCrossing();
    checkPedestrianButton();
    
    publishUltrasonic();
    publishPiezo();
    publishRain();
}