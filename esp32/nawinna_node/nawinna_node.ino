// ═══════════════════════════════════════════════════════════════════════════
// esp32/nawinna_node/nawinna_node.ino
// SOUTH ROAD — COMPLETE SENSOR INTEGRATION
// Sensors: Ultrasonic + IR x2 + Piezo + Rain + Pedestrian Button
// All sensors publish to MQTT independently
// Pedestrian and Piezo logic follows the working reference code
// ═══════════════════════════════════════════════════════════════════════════

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ── CHANGE THIS FOR EACH ESP32 ──────────────────────────────────────────────
const char* ROAD_ID     = "South";          // North / South / East / West
const char* WIFI_SSID   = "SLT-4G_166D59";
const char* WIFI_PASS   = "F58EA0CF";
const char* MQTT_SERVER = "56.228.30.50";
const int   MQTT_PORT   = 1883;

// ═══════════════════════════════════════════════════════════════════════════
// PIN DEFINITIONS - ALL SENSORS
// ═══════════════════════════════════════════════════════════════════════════

// ── ULTRASONIC SENSOR (HC-SR04) ────────────────────────────────────────────
// Placement: Facing the road, detects vehicles at distance >= 20cm
#define TRIG_PIN       5
#define ECHO_PIN       18

// ── CAR TRAFFIC LIGHTS ──────────────────────────────────────────────────────
#define CAR_RED        26
#define CAR_YELLOW     27
#define CAR_GREEN      14

// ── IR SENSORS (placed behind stop line) ────────────────────────────────────
// IR1 at 5cm from stop line   - Light traffic indicator
// IR2 at 10cm from stop line  - Heavy traffic indicator
#define IR_SENSOR_1    34   // First IR  — LOW = blocked (vehicle present)
#define IR_SENSOR_2    35   // Second IR — LOW = blocked (vehicle present)

// ── PIEZO VIBRATION SENSOR (heavy vehicle detection) ────────────────────────
// Placement: Embedded in road surface, detects trucks/buses
#define PIEZO_SENSOR   32

// ── RAIN SENSOR ─────────────────────────────────────────────────────────────
// Digital output: LOW when rain detected, HIGH when dry
#define RAIN_PIN       33

// ── PEDESTRIAN BUTTON ───────────────────────────────────────────────────────
#define BUTTON         25   // INPUT_PULLUP - LOW when pressed

// ── PEDESTRIAN LIGHTS ───────────────────────────────────────────────────────
#define PED_RED        19
#define PED_GREEN      21

// ── 7-SEGMENT DISPLAY (countdown timer) ─────────────────────────────────────
#define SEG_A          2
#define SEG_B          15
#define SEG_C          12
#define SEG_D          13
#define SEG_E          22
#define SEG_F          23
#define SEG_G          4

// ═══════════════════════════════════════════════════════════════════════════
// TIMING CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

// Base timings
const unsigned long RED_DURATION           = 3000;   // 3 seconds fixed
const unsigned long YELLOW_DURATION        = 3000;   // 3 seconds (dry)
const unsigned long YELLOW_RAIN_DURATION   = 5000;   // 5 seconds (rain)
const unsigned long GREEN_BASE_DURATION    = 3000;   // 3 seconds base

// Traffic bonuses (from IR sensors)
const unsigned long LIGHT_TRAFFIC_BONUS    = 3000;   // +3 seconds (1 IR blocked)
const unsigned long HEAVY_TRAFFIC_BONUS    = 6000;   // +6 seconds (2 IR blocked)

// Heavy vehicle bonus (from Piezo)
const unsigned long PIEZO_EXTRA            = 5000;   // +5 seconds

// Pedestrian
const unsigned long PED_CROSSING_DURATION  = 10000;  // 10 seconds fixed

// Sensor publish intervals
const unsigned long ULTRASONIC_INTERVAL    = 500;    // ms
const unsigned long IR_INTERVAL            = 1000;   // ms
const unsigned long PIEZO_INTERVAL         = 500;    // ms
const unsigned long RAIN_INTERVAL          = 2000;   // ms

// ═══════════════════════════════════════════════════════════════════════════
// MQTT TOPICS
// ═══════════════════════════════════════════════════════════════════════════
String PUB_ULTRASONIC;   // traffic/ultrasonic/South
String PUB_IR;           // traffic/ir/South
String PUB_PIEZO;        // traffic/piezo/South
String PUB_RAIN;         // traffic/rain/South
String PUB_PEDESTRIAN;   // traffic/pedestrian/South
String PUB_STATE;        // traffic/state/South
String SUB_CONTROL;      // traffic/control/South

// ═══════════════════════════════════════════════════════════════════════════
// MQTT CLIENT
// ═══════════════════════════════════════════════════════════════════════════
WiFiClient   wifiClient;
PubSubClient mqttClient(wifiClient);

// ═══════════════════════════════════════════════════════════════════════════
// PHASE STATE MACHINE (from working reference)
// ═══════════════════════════════════════════════════════════════════════════
// 0 = RED
// 1 = YELLOW (after RED)
// 2 = GREEN
// 3 = YELLOW (after GREEN)
int phase = 0;

// ═══════════════════════════════════════════════════════════════════════════
// PEDESTRIAN STATE (from working reference)
// ═══════════════════════════════════════════════════════════════════════════
bool pedestrianRequest = false;
bool requestDuringGreen = false;
bool skipRedAfterCrossing = false;

// ═══════════════════════════════════════════════════════════════════════════
// PIEZO STATE (from working reference)
// ═══════════════════════════════════════════════════════════════════════════
bool extendNextGreen = false;

// ═══════════════════════════════════════════════════════════════════════════
// SENSOR STATES
// ═══════════════════════════════════════════════════════════════════════════
// IR Sensors
bool ir1Blocked = false;
bool ir2Blocked = false;

// Rain Sensor
bool rainDetected = false;

// Ultrasonic last reading
float lastDistance = 5000.0;

// ═══════════════════════════════════════════════════════════════════════════
// TIMESTAMP TRACKING FOR NON-BLOCKING SENSOR PUBLISHING
// ═══════════════════════════════════════════════════════════════════════════
unsigned long lastUltrasonicPublish = 0;
unsigned long lastIRPublish = 0;
unsigned long lastPiezoPublish = 0;
unsigned long lastRainPublish = 0;
unsigned long lastStatePublish = 0;

// ═══════════════════════════════════════════════════════════════════════════
// LIGHT CONTROL FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════
void setCarRed() {
    digitalWrite(CAR_RED, HIGH);
    digitalWrite(CAR_YELLOW, LOW);
    digitalWrite(CAR_GREEN, LOW);
}

void setCarYellow() {
    digitalWrite(CAR_RED, LOW);
    digitalWrite(CAR_YELLOW, HIGH);
    digitalWrite(CAR_GREEN, LOW);
}

void setCarGreen() {
    digitalWrite(CAR_RED, LOW);
    digitalWrite(CAR_YELLOW, LOW);
    digitalWrite(CAR_GREEN, HIGH);
}

void setPedestrianRed() {
    digitalWrite(PED_RED, HIGH);
    digitalWrite(PED_GREEN, LOW);
}

void setPedestrianGreen() {
    digitalWrite(PED_RED, LOW);
    digitalWrite(PED_GREEN, HIGH);
}

// ═══════════════════════════════════════════════════════════════════════════
// 7-SEGMENT DISPLAY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════
void clearDisplay() {
    digitalWrite(SEG_A, LOW);
    digitalWrite(SEG_B, LOW);
    digitalWrite(SEG_C, LOW);
    digitalWrite(SEG_D, LOW);
    digitalWrite(SEG_E, LOW);
    digitalWrite(SEG_F, LOW);
    digitalWrite(SEG_G, LOW);
}

void displayDigit(int num) {
    clearDisplay();
    switch (num) {
        case 0:
            digitalWrite(SEG_A, HIGH);
            digitalWrite(SEG_B, HIGH);
            digitalWrite(SEG_C, HIGH);
            digitalWrite(SEG_D, HIGH);
            digitalWrite(SEG_E, HIGH);
            digitalWrite(SEG_F, HIGH);
            break;
        case 1:
            digitalWrite(SEG_B, HIGH);
            digitalWrite(SEG_C, HIGH);
            break;
        case 2:
            digitalWrite(SEG_A, HIGH);
            digitalWrite(SEG_B, HIGH);
            digitalWrite(SEG_D, HIGH);
            digitalWrite(SEG_E, HIGH);
            digitalWrite(SEG_G, HIGH);
            break;
        case 3:
            digitalWrite(SEG_A, HIGH);
            digitalWrite(SEG_B, HIGH);
            digitalWrite(SEG_C, HIGH);
            digitalWrite(SEG_D, HIGH);
            digitalWrite(SEG_G, HIGH);
            break;
        case 4:
            digitalWrite(SEG_B, HIGH);
            digitalWrite(SEG_C, HIGH);
            digitalWrite(SEG_F, HIGH);
            digitalWrite(SEG_G, HIGH);
            break;
        case 5:
            digitalWrite(SEG_A, HIGH);
            digitalWrite(SEG_C, HIGH);
            digitalWrite(SEG_D, HIGH);
            digitalWrite(SEG_F, HIGH);
            digitalWrite(SEG_G, HIGH);
            break;
        case 6:
            digitalWrite(SEG_A, HIGH);
            digitalWrite(SEG_C, HIGH);
            digitalWrite(SEG_D, HIGH);
            digitalWrite(SEG_E, HIGH);
            digitalWrite(SEG_F, HIGH);
            digitalWrite(SEG_G, HIGH);
            break;
        case 7:
            digitalWrite(SEG_A, HIGH);
            digitalWrite(SEG_B, HIGH);
            digitalWrite(SEG_C, HIGH);
            break;
        case 8:
            digitalWrite(SEG_A, HIGH);
            digitalWrite(SEG_B, HIGH);
            digitalWrite(SEG_C, HIGH);
            digitalWrite(SEG_D, HIGH);
            digitalWrite(SEG_E, HIGH);
            digitalWrite(SEG_F, HIGH);
            digitalWrite(SEG_G, HIGH);
            break;
        case 9:
            digitalWrite(SEG_A, HIGH);
            digitalWrite(SEG_B, HIGH);
            digitalWrite(SEG_C, HIGH);
            digitalWrite(SEG_D, HIGH);
            digitalWrite(SEG_F, HIGH);
            digitalWrite(SEG_G, HIGH);
            break;
    }
}

void startCountdown(int seconds) {
    for (int i = seconds; i >= 1; i--) {
        displayDigit(i > 9 ? 9 : i);
        unsigned long end = millis() + 1000UL;
        while (millis() < end) {
            mqttClient.loop();
            checkButton();      // Keep checking button
            checkPiezo();       // Keep checking piezo
            sensorPublish();    // Keep publishing sensor data
        }
    }
    clearDisplay();
}

// ═══════════════════════════════════════════════════════════════════════════
// SENSOR READING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

// ── ULTRASONIC SENSOR ───────────────────────────────────────────────────────
float measureDistance() {
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
    long dur = pulseIn(ECHO_PIN, HIGH, 30000);
    if (dur == 0) return 5000.0;
    return (dur * 0.034) / 2.0;
}

void publishUltrasonic() {
    lastDistance = measureDistance();
    bool hasVehicle = (lastDistance < 5000 && lastDistance <= 400);
    
    StaticJsonDocument<128> doc;
    doc["road"]          = ROAD_ID;
    doc["distanceCm"]    = lastDistance;
    doc["vehicleNearby"] = hasVehicle;
    doc["timestamp"]     = millis();
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_ULTRASONIC.c_str(), buf);
    
    if (hasVehicle) {
        Serial.println("📡 Ultrasonic: " + String(lastDistance, 1) + "cm - VEHICLE DETECTED");
    } else if (lastDistance < 5000) {
        Serial.println("📡 Ultrasonic: " + String(lastDistance, 1) + "cm");
    } else {
        Serial.println("📡 Ultrasonic: No vehicle");
    }
}

// ── IR SENSORS ──────────────────────────────────────────────────────────────
void readIRSensors() {
    bool newIr1 = (digitalRead(IR_SENSOR_1) == LOW);
    bool newIr2 = (digitalRead(IR_SENSOR_2) == LOW);
    
    if (newIr1 != ir1Blocked || newIr2 != ir2Blocked) {
        ir1Blocked = newIr1;
        ir2Blocked = newIr2;
        Serial.print("🔦 IR State Changed - IR1: ");
        Serial.print(ir1Blocked ? "BLOCKED" : "CLEAR");
        Serial.print(" | IR2: ");
        Serial.println(ir2Blocked ? "BLOCKED" : "CLEAR");
    }
}

void publishIR() {
    readIRSensors();
    
    String queueLevel = "None";
    if (ir1Blocked && ir2Blocked) {
        queueLevel = "Heavy";
    } else if (ir1Blocked || ir2Blocked) {
        queueLevel = "Light";
    }
    
    StaticJsonDocument<128> doc;
    doc["road"]       = ROAD_ID;
    doc["ir1Blocked"] = ir1Blocked;
    doc["ir2Blocked"] = ir2Blocked;
    doc["queueLevel"] = queueLevel;
    doc["timestamp"]  = millis();
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_IR.c_str(), buf);
    
    Serial.println("🔦 IR Published - Queue: " + queueLevel);
}

// ── PIEZO SENSOR (Heavy Vehicle Detection) ──────────────────────────────────
void checkPiezo() {
    if (digitalRead(PIEZO_SENSOR) == HIGH && !extendNextGreen) {
        Serial.println("🚛 VIBRATION DETECTED! Next CAR_GREEN extended by 5 seconds");
        extendNextGreen = true;
        
        // Publish to MQTT immediately
        StaticJsonDocument<128> doc;
        doc["road"] = ROAD_ID;
        doc["heavyVehicle"] = true;
        doc["extendNextGreen"] = true;
        doc["timestamp"] = millis();
        char buf[128];
        serializeJson(doc, buf);
        mqttClient.publish(PUB_PIEZO.c_str(), buf);
    }
}

void publishPiezo() {
    // Just read and publish current state (non-blocking)
    bool vibration = (digitalRead(PIEZO_SENSOR) == HIGH);
    
    StaticJsonDocument<128> doc;
    doc["road"] = ROAD_ID;
    doc["vibrationDetected"] = vibration;
    doc["timestamp"] = millis();
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_PIEZO.c_str(), buf);
}

// ── RAIN SENSOR ─────────────────────────────────────────────────────────────
void readRainSensor() {
    bool newRain = (digitalRead(RAIN_PIN) == LOW);
    
    if (newRain != rainDetected) {
        rainDetected = newRain;
        if (rainDetected) {
            Serial.println("🌧️ RAIN DETECTED - Yellow extended to 5 seconds");
        } else {
            Serial.println("☀️ RAIN STOPPED - Yellow back to 3 seconds");
        }
    }
}

void publishRain() {
    readRainSensor();
    
    StaticJsonDocument<128> doc;
    doc["road"] = ROAD_ID;
    doc["rainDetected"] = rainDetected;
    doc["timestamp"] = millis();
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_RAIN.c_str(), buf);
    
    Serial.println("🌧️ Rain Status: " + String(rainDetected ? "RAINING" : "DRY"));
}

// ── PEDESTRIAN BUTTON ───────────────────────────────────────────────────────
void checkButton() {
    if (digitalRead(BUTTON) == LOW) {
        pedestrianRequest = true;
        Serial.println("🚶 Pedestrian button PRESSED!");
        
        // Publish to MQTT
        StaticJsonDocument<128> doc;
        doc["road"] = ROAD_ID;
        doc["requested"] = true;
        doc["timestamp"] = millis();
        char buf[128];
        serializeJson(doc, buf);
        mqttClient.publish(PUB_PEDESTRIAN.c_str(), buf);
    }
}

// ── ALL SENSOR PUBLISH (non-blocking) ───────────────────────────────────────
void sensorPublish() {
    unsigned long now = millis();
    
    // Ultrasonic every 500ms
    if (now - lastUltrasonicPublish >= ULTRASONIC_INTERVAL) {
        lastUltrasonicPublish = now;
        publishUltrasonic();
    }
    
    // IR every 1000ms
    if (now - lastIRPublish >= IR_INTERVAL) {
        lastIRPublish = now;
        publishIR();
    }
    
    // Piezo every 500ms
    if (now - lastPiezoPublish >= PIEZO_INTERVAL) {
        lastPiezoPublish = now;
        publishPiezo();
    }
    
    // Rain every 2000ms
    if (now - lastRainPublish >= RAIN_INTERVAL) {
        lastRainPublish = now;
        publishRain();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// TIMING CALCULATIONS (based on sensor readings)
// ═══════════════════════════════════════════════════════════════════════════

unsigned long getCurrentGreenDuration() {
    unsigned long duration = GREEN_BASE_DURATION;
    
    // IR Traffic detection
    if (ir1Blocked && ir2Blocked) {
        duration += HEAVY_TRAFFIC_BONUS;  // 3s + 6s = 9s total
        Serial.println("  → HEAVY traffic: +6s (Total: " + String(duration/1000) + "s)");
    } else if (ir1Blocked || ir2Blocked) {
        duration += LIGHT_TRAFFIC_BONUS;  // 3s + 3s = 6s total
        Serial.println("  → LIGHT traffic: +3s (Total: " + String(duration/1000) + "s)");
    } else {
        Serial.println("  → NO traffic: base " + String(duration/1000) + "s");
    }
    
    // Piezo heavy vehicle bonus
    if (extendNextGreen) {
        duration += PIEZO_EXTRA;
        Serial.println("  → PIEZO bonus: +5s (Total: " + String(duration/1000) + "s)");
        extendNextGreen = false;  // Clear after applying
    }
    
    return duration;
}

unsigned long getCurrentYellowDuration() {
    if (rainDetected) {
        Serial.println("  → RAIN: Yellow " + String(YELLOW_RAIN_DURATION/1000) + "s");
        return YELLOW_RAIN_DURATION;
    } else {
        Serial.println("  → DRY: Yellow " + String(YELLOW_DURATION/1000) + "s");
        return YELLOW_DURATION;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PEDESTRIAN CROSSING (from working reference)
// ═══════════════════════════════════════════════════════════════════════════
void pedestrianCross() {
    setCarRed();
    setPedestrianGreen();
    
    Serial.println("🚶 PEDESTRIAN CROSSING - " + String(PED_CROSSING_DURATION/1000) + " seconds");
    publishState("PED_CROSSING");
    
    // Show countdown on 7-segment during crossing
    for (int i = PED_CROSSING_DURATION / 1000; i >= 1; i--) {
        displayDigit(i > 9 ? 9 : i);
        unsigned long end = millis() + 1000UL;
        while (millis() < end) {
            mqttClient.loop();
            checkButton();      // Allow button press during crossing
            checkPiezo();       // Allow piezo detection during crossing
            sensorPublish();    // Keep publishing sensor data
        }
    }
    
    clearDisplay();
    setPedestrianRed();
    
    pedestrianRequest = false;
    skipRedAfterCrossing = true;
    
    Serial.println("✅ Pedestrian crossing FINISHED");
    publishState("PED_FINISHED");
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE PUBLISH
// ═══════════════════════════════════════════════════════════════════════════
void publishState(String state) {
    if (millis() - lastStatePublish < 200) return;
    lastStatePublish = millis();
    
    StaticJsonDocument<128> doc;
    doc["road"]  = ROAD_ID;
    doc["state"] = state;
    doc["phase"] = phase;
    doc["timestamp"] = millis();
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_STATE.c_str(), buf, true);
    Serial.println("💡 State Published: " + state);
}

// ═══════════════════════════════════════════════════════════════════════════
// MQTT CALLBACK (server override)
// ═══════════════════════════════════════════════════════════════════════════
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    String msg = "";
    for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
    
    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, msg)) { 
        Serial.println("❌ JSON parse error"); 
        return; 
    }
    
    String signal = doc["signal"].as<String>();
    int greenTime  = doc["greenTime"]  | 5;
    int yellowTime = doc["yellowTime"] | 3;
    
    Serial.println("📩 MQTT COMMAND: " + signal + " (green=" + String(greenTime) + "s, yellow=" + String(yellowTime) + "s)");
    
    // Reset pedestrian states on forced command
    if (signal == "GREEN") {
        phase = 2;
        setCarGreen();
        publishState("GREEN");
        Serial.println("🟢 FORCE GREEN for " + String(greenTime) + "s");
        delay(greenTime * 1000);
        phase = 3;
    } else if (signal == "YELLOW") {
        phase = 3;
        setCarYellow();
        publishState("YELLOW");
        Serial.println("🟡 FORCE YELLOW for " + String(yellowTime) + "s");
        delay(yellowTime * 1000);
        phase = 0;
    } else if (signal == "RED") {
        phase = 0;
        setCarRed();
        publishState("RED");
        Serial.println("🔴 FORCE RED");
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// WiFi & MQTT CONNECTION
// ═══════════════════════════════════════════════════════════════════════════
void connectWiFi() {
    Serial.print("Connecting to WiFi: ");
    Serial.println(WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
        delay(500);
        Serial.print(".");
        attempts++;
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n✅ WiFi Connected! IP: " + WiFi.localIP().toString());
    } else {
        Serial.println("\n❌ WiFi FAILED - Check credentials");
    }
}

void connectMQTT() {
    String clientId = "HYDRA-" + String(ROAD_ID);
    Serial.print("Connecting to MQTT... ");
    if (mqttClient.connect(clientId.c_str())) {
        Serial.println("✅ Connected!");
        mqttClient.subscribe(SUB_CONTROL.c_str());
        Serial.println("   Subscribed to: " + SUB_CONTROL);
    } else {
        Serial.println("❌ Failed, rc=" + String(mqttClient.state()));
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════════════════════
void setup() {
    Serial.begin(115200);
    Serial.println("\n");
    Serial.println("╔═══════════════════════════════════════════════════════════╗");
    Serial.println("║     H.Y.D.R.A Traffic Control Node - " + String(ROAD_ID) + " Road      ║");
    Serial.println("╚═══════════════════════════════════════════════════════════╝");
    Serial.println();
    Serial.println("SENSORS CONFIGURED:");
    Serial.println("  • Ultrasonic (HC-SR04) - Trig:5, Echo:18");
    Serial.println("  • IR Sensor 1 (Light traffic) - GPIO34");
    Serial.println("  • IR Sensor 2 (Heavy traffic) - GPIO35");
    Serial.println("  • Piezo (Heavy vehicle) - GPIO32");
    Serial.println("  • Rain Sensor - GPIO33");
    Serial.println("  • Pedestrian Button - GPIO25");
    Serial.println();
    Serial.println("PEDESTRIAN LOGIC (Working Reference):");
    Serial.println("  • Button during RED     → Immediate crossing (10s)");
    Serial.println("  • Button during YELLOW  → Countdown remaining, then crossing");
    Serial.println("  • Button during GREEN   → Wait, YELLOW countdown, then crossing");
    Serial.println("  • After crossing        → Skip RED, go to YELLOW then GREEN");
    Serial.println();
    Serial.println("PIEZO LOGIC (Working Reference):");
    Serial.println("  • Vibration detected    → Next GREEN extended by 5 seconds");
    Serial.println();
    Serial.println("TRAFFIC TIMING:");
    Serial.println("  • RED: 3s (fixed)");
    Serial.println("  • YELLOW: 3s (dry) / 5s (rain)");
    Serial.println("  • GREEN: 3s base + IR bonuses + Piezo bonus");
    Serial.println("═══════════════════════════════════════════════════════════\n");
    
    // ── Configure pins ──────────────────────────────────────────────────────
    // Outputs
    pinMode(TRIG_PIN, OUTPUT);
    pinMode(CAR_RED, OUTPUT);
    pinMode(CAR_YELLOW, OUTPUT);
    pinMode(CAR_GREEN, OUTPUT);
    pinMode(PED_RED, OUTPUT);
    pinMode(PED_GREEN, OUTPUT);
    pinMode(SEG_A, OUTPUT);
    pinMode(SEG_B, OUTPUT);
    pinMode(SEG_C, OUTPUT);
    pinMode(SEG_D, OUTPUT);
    pinMode(SEG_E, OUTPUT);
    pinMode(SEG_F, OUTPUT);
    pinMode(SEG_G, OUTPUT);
    
    // Inputs
    pinMode(ECHO_PIN, INPUT);
    pinMode(IR_SENSOR_1, INPUT_PULLUP);
    pinMode(IR_SENSOR_2, INPUT_PULLUP);
    pinMode(PIEZO_SENSOR, INPUT);
    pinMode(RAIN_PIN, INPUT_PULLUP);
    pinMode(BUTTON, INPUT_PULLUP);
    
    // ── Initial state ───────────────────────────────────────────────────────
    setCarRed();
    setPedestrianRed();
    clearDisplay();
    
    // ── Initial sensor readings ─────────────────────────────────────────────
    ir1Blocked = (digitalRead(IR_SENSOR_1) == LOW);
    ir2Blocked = (digitalRead(IR_SENSOR_2) == LOW);
    rainDetected = (digitalRead(RAIN_PIN) == LOW);
    
    // ── MQTT Topics ─────────────────────────────────────────────────────────
    PUB_ULTRASONIC  = "traffic/ultrasonic/" + String(ROAD_ID);
    PUB_IR          = "traffic/ir/" + String(ROAD_ID);
    PUB_PIEZO       = "traffic/piezo/" + String(ROAD_ID);
    PUB_RAIN        = "traffic/rain/" + String(ROAD_ID);
    PUB_PEDESTRIAN  = "traffic/pedestrian/" + String(ROAD_ID);
    PUB_STATE       = "traffic/state/" + String(ROAD_ID);
    SUB_CONTROL     = "traffic/control/" + String(ROAD_ID);
    
    // ── Connect to network ──────────────────────────────────────────────────
    connectWiFi();
    mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
    mqttClient.setCallback(mqttCallback);
    connectMQTT();
    
    Serial.println("\n🔴 Starting with RED for " + String(RED_DURATION/1000) + " seconds\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN LOOP (Phase machine from working reference)
// ═══════════════════════════════════════════════════════════════════════════
void loop() {
    // Keep MQTT connection alive
    if (!mqttClient.connected()) {
        connectMQTT();
    }
    mqttClient.loop();
    
    // Check sensors continuously (these are non-blocking)
    checkButton();
    checkPiezo();
    sensorPublish();  // Publishes ultrasonic, IR, piezo, rain at their intervals
    
    // Phase machine (from your working reference)
    switch (phase) {
        
        // ═══════════════════════════════════════════════════════════════════
        // PHASE 0: RED
        // ═══════════════════════════════════════════════════════════════════
        case 0:
            setCarRed();
            publishState("RED");
            
            if (skipRedAfterCrossing) {
                skipRedAfterCrossing = false;
                phase = 1;
                break;
            }
            
            {
                unsigned long start = millis();
                while (millis() - start < RED_DURATION) {
                    mqttClient.loop();
                    checkButton();
                    checkPiezo();
                    sensorPublish();
                    
                    if (pedestrianRequest) {
                        Serial.println("🚶 Button pressed during RED → Immediate crossing");
                        pedestrianCross();
                        phase = 1;
                        break;
                    }
                }
                if (pedestrianRequest) break;
            }
            phase = 1;
            break;
        
        // ═══════════════════════════════════════════════════════════════════
        // PHASE 1: YELLOW (after RED)
        // ═══════════════════════════════════════════════════════════════════
        case 1:
            setCarYellow();
            publishState("YELLOW");
            clearDisplay();
            
            {
                unsigned long start = millis();
                unsigned long duration = getCurrentYellowDuration();
                
                while (millis() - start < duration) {
                    mqttClient.loop();
                    checkButton();
                    checkPiezo();
                    sensorPublish();
                    
                    if (pedestrianRequest) {
                        int remaining = (duration - (millis() - start)) / 1000;
                        if (remaining > 0) {
                            startCountdown(remaining);
                        }
                        break;
                    }
                }
            }
            
            if (pedestrianRequest) {
                pedestrianCross();
                phase = 0;
            } else {
                phase = 2;
            }
            break;
        
        // ═══════════════════════════════════════════════════════════════════
        // PHASE 2: GREEN
        // ═══════════════════════════════════════════════════════════════════
        case 2:
            setCarGreen();
            publishState("GREEN");
            
            {
                unsigned long start = millis();
                requestDuringGreen = false;
                unsigned long greenDuration = getCurrentGreenDuration();
                
                Serial.println("🟢 GREEN phase - Duration: " + String(greenDuration/1000) + " seconds");
                
                while (millis() - start < greenDuration) {
                    mqttClient.loop();
                    checkButton();
                    checkPiezo();
                    sensorPublish();
                    
                    if (pedestrianRequest) {
                        requestDuringGreen = true;
                        Serial.println("🚶 Button pressed during GREEN - Will cross after green");
                    }
                    
                    // Show countdown on 7-segment during bonus time
                    if (greenDuration > GREEN_BASE_DURATION && millis() - start >= GREEN_BASE_DURATION) {
                        int remaining = (greenDuration - (millis() - start)) / 1000;
                        if (remaining > 0 && remaining <= 9) {
                            displayDigit(remaining);
                            delay(100);
                        }
                    }
                }
            }
            
            extendNextGreen = false;  // Clear piezo flag
            clearDisplay();
            phase = 3;
            break;
        
        // ═══════════════════════════════════════════════════════════════════
        // PHASE 3: YELLOW (after GREEN)
        // ═══════════════════════════════════════════════════════════════════
        case 3:
            setCarYellow();
            publishState("YELLOW");
            clearDisplay();
            
            {
                unsigned long start = millis();
                unsigned long duration = getCurrentYellowDuration();
                bool countdownStarted = false;
                
                while (millis() - start < duration) {
                    mqttClient.loop();
                    checkButton();
                    checkPiezo();
                    sensorPublish();
                    
                    if (requestDuringGreen && !countdownStarted) {
                        countdownStarted = true;
                        startCountdown(duration / 1000);
                        break;
                    }
                    
                    if (pedestrianRequest && !countdownStarted) {
                        int remaining = (duration - (millis() - start)) / 1000;
                        if (remaining > 0) {
                            countdownStarted = true;
                            startCountdown(remaining);
                        }
                        break;
                    }
                }
            }
            
            if (pedestrianRequest || requestDuringGreen) {
                pedestrianCross();
            }
            
            phase = 0;
            break;
    }
}