// // esp32/nawinna_node/nawinna_node.ino — FULLY FIXED VERSION
// #include <WiFi.h>
// #include <PubSubClient.h>
// #include <ArduinoJson.h>

// // ── CHANGE THESE FOR EACH ESP32 BOARD ──
// const char* ROAD_ID     = "North";           // Change to "South", "East", or "West"
// const char* WIFI_SSID   = "SLT-4G_166D59";  // Your WiFi name
// const char* WIFI_PASS   = "F58EA0CF";        // Your WiFi password
// const char* MQTT_SERVER = "56.228.30.50";  // Your AWS EC2 Public IP
// const int   MQTT_PORT   = 1883;

// // ── HC-SR04 ULTRASONIC SENSOR PINS ──
// const int TRIG_PIN   = 5;    // ESP32 GPIO5  → TRIG on sensor
// const int ECHO_PIN   = 18;   // ESP32 GPIO18 → ECHO on sensor (via voltage divider)

// // ── TRAFFIC LIGHT LED PINS ──
// const int RED_LED    = 26;   // ESP32 GPIO26 → Red    LED (through 220Ω resistor)
// const int YELLOW_LED = 27;   // ESP32 GPIO27 → Yellow LED (through 220Ω resistor)
// const int GREEN_LED  = 14;   // ESP32 GPIO14 → Green  LED (through 220Ω resistor)

// // ── MQTT TOPICS ──
// String PUBLISH_TOPIC;    // traffic/ultrasonic/North  — sensor data TO server
// String SUBSCRIBE_TOPIC;  // traffic/control/North     — commands FROM server
// String STATE_TOPIC;      // traffic/state/North       — live light state TO server

// // ── MQTT CLIENTS ──
// WiFiClient   wifiClient;
// PubSubClient mqttClient(wifiClient);

// // ── LIGHT STATE MACHINE ──
// // millis() timing instead of delay() — ESP32 never freezes
// enum LightPhase { PHASE_RED, PHASE_GREEN, PHASE_YELLOW };
// LightPhase    currentPhase      = PHASE_RED;
// unsigned long phaseEndMs        = 0;
// int           pendingGreenTime  = 0;
// int           pendingYellowTime = 3;

// // ─────────────────────────────────────────────────────────────
// // setTrafficLight()
// // Physically turns the correct LED on, all others off
// // ─────────────────────────────────────────────────────────────
// void setTrafficLight(LightPhase phase) {
//     digitalWrite(RED_LED,    LOW);
//     digitalWrite(YELLOW_LED, LOW);
//     digitalWrite(GREEN_LED,  LOW);
//     delay(50);
//     if      (phase == PHASE_RED)    digitalWrite(RED_LED,    HIGH);
//     else if (phase == PHASE_YELLOW) digitalWrite(YELLOW_LED, HIGH);
//     else if (phase == PHASE_GREEN)  digitalWrite(GREEN_LED,  HIGH);
// }

// // ─────────────────────────────────────────────────────────────
// // publishLiveState()
// // Tells the server the current LED colour
// // Dashboard reads this to show correct colour in real time
// // ─────────────────────────────────────────────────────────────
// void publishLiveState(String state) {
//     String msg = "{\"road\":\"" + String(ROAD_ID) + "\",\"state\":\"" + state + "\"}";
//     mqttClient.publish(STATE_TOPIC.c_str(), msg.c_str(), true);
//     Serial.println("📢 State published: " + state);
// }

// // ─────────────────────────────────────────────────────────────
// // updateLightStateMachine()
// // Called every loop() — checks timers and moves phases
// // GREEN → YELLOW → RED happens automatically, NO blocking
// // ─────────────────────────────────────────────────────────────
// void updateLightStateMachine() {
//     if (currentPhase == PHASE_RED) return;

//     if (millis() >= phaseEndMs) {

//         if (currentPhase == PHASE_GREEN) {
//             // GREEN finished → switch to YELLOW
//             currentPhase = PHASE_YELLOW;
//             phaseEndMs   = millis() + (pendingYellowTime * 1000UL);
//             setTrafficLight(PHASE_YELLOW);
//             Serial.println("🟡 YELLOW for " + String(pendingYellowTime) + "s");
//             publishLiveState("YELLOW");

//         } else if (currentPhase == PHASE_YELLOW) {
//             // YELLOW finished → switch to RED
//             currentPhase = PHASE_RED;
//             setTrafficLight(PHASE_RED);
//             Serial.println("🔴 Back to RED");
//             publishLiveState("RED");
//         }
//     }
// }

// // ─────────────────────────────────────────────────────────────
// // measureDistance()
// // Returns distance in cm. Returns 5000 if nothing detected.
// // ─────────────────────────────────────────────────────────────
// float measureDistance() {
//     digitalWrite(TRIG_PIN, LOW);
//     delayMicroseconds(2);
//     digitalWrite(TRIG_PIN, HIGH);
//     delayMicroseconds(10);
//     digitalWrite(TRIG_PIN, LOW);

//     long duration = pulseIn(ECHO_PIN, HIGH, 30000);
//     if (duration == 0) return 5000;
//     return (duration * 0.034) / 2.0;
// }

// // ─────────────────────────────────────────────────────────────
// // mqttCallback()
// // Called when server sends a command
// // Stores timing and starts phase — NO delay()
// // ─────────────────────────────────────────────────────────────
// void mqttCallback(char* topic, byte* payload, unsigned int length) {
//     String msg = "";
//     for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

//     StaticJsonDocument<256> doc;
//     if (deserializeJson(doc, msg)) {
//         Serial.println("❌ JSON parse error");
//         return;
//     }

//     String signal     = doc["signal"].as<String>();
//     int    greenTime  = doc["greenTime"].as<int>();
//     int    yellowTime = doc["yellowTime"] | 3;

//     Serial.println("📩 Command: " + signal + " greenTime=" + String(greenTime) + "s");

//     if (signal == "GREEN") {
//         pendingGreenTime  = greenTime;
//         pendingYellowTime = yellowTime;
//         currentPhase      = PHASE_GREEN;
//         phaseEndMs        = millis() + (greenTime * 1000UL);
//         setTrafficLight(PHASE_GREEN);
//         Serial.println("🟢 GREEN started (" + String(greenTime) + "s)");
//         publishLiveState("GREEN");

//     } else {
//         currentPhase = PHASE_RED;
//         setTrafficLight(PHASE_RED);
//         Serial.println("🔴 RED");
//         publishLiveState("RED");
//     }
// }

// // ─────────────────────────────────────────────────────────────
// // connectToWiFi()
// // ─────────────────────────────────────────────────────────────
// void connectToWiFi() {
//     Serial.print("Connecting to WiFi: ");
//     Serial.println(WIFI_SSID);
//     WiFi.begin(WIFI_SSID, WIFI_PASS);
//     int tries = 0;
//     while (WiFi.status() != WL_CONNECTED && tries < 30) {
//         delay(500);
//         Serial.print(".");
//         tries++;
//     }
//     if (WiFi.status() == WL_CONNECTED) {
//         Serial.println("\n✅ WiFi Connected! IP: " + WiFi.localIP().toString());
//     } else {
//         Serial.println("\n❌ WiFi FAILED — check SSID and password");
//     }
// }

// // ─────────────────────────────────────────────────────────────
// // connectToMQTT()
// // ─────────────────────────────────────────────────────────────
// void connectToMQTT() {
//     String clientId = "HYDRA-" + String(ROAD_ID) + "-ESP32";
//     Serial.print("Connecting to MQTT...");
//     if (mqttClient.connect(clientId.c_str())) {
//         Serial.println(" ✅ Connected!");
//         mqttClient.subscribe(SUBSCRIBE_TOPIC.c_str());
//         Serial.println("📡 Subscribed to: " + SUBSCRIBE_TOPIC);
//     } else {
//         Serial.println(" ❌ Failed rc=" + String(mqttClient.state()));
//     }
// }

// // ─────────────────────────────────────────────────────────────
// // setup() — runs ONCE on power on
// // ─────────────────────────────────────────────────────────────
// void setup() {
//     Serial.begin(115200);
//     Serial.println("\n🚦 H.Y.D.R.A Node Starting — Road: " + String(ROAD_ID));

//     pinMode(TRIG_PIN,   OUTPUT);
//     pinMode(ECHO_PIN,   INPUT);
//     pinMode(RED_LED,    OUTPUT);
//     pinMode(YELLOW_LED, OUTPUT);
//     pinMode(GREEN_LED,  OUTPUT);

//     setTrafficLight(PHASE_RED);  // start safe — RED on

//     PUBLISH_TOPIC   = "traffic/ultrasonic/" + String(ROAD_ID);
//     SUBSCRIBE_TOPIC = "traffic/control/"    + String(ROAD_ID);
//     STATE_TOPIC     = "traffic/state/"      + String(ROAD_ID);

//     connectToWiFi();
//     mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
//     mqttClient.setCallback(mqttCallback);
//     connectToMQTT();
// }

// // ─────────────────────────────────────────────────────────────
// // loop() — runs FOREVER, never blocks
// // ─────────────────────────────────────────────────────────────
// void loop() {
//     // 1. Keep MQTT alive
//     if (!mqttClient.connected()) {
//         connectToMQTT();
//     }
//     mqttClient.loop();

//     // 2. Check light phase timers — GREEN→YELLOW→RED automatically
//     updateLightStateMachine();

//     // 3. Measure sensor and publish every 500ms
//     static unsigned long lastMeasure = 0;
//     if (millis() - lastMeasure >= 500) {
//         lastMeasure = millis();

//         float distance = measureDistance();

//         if (distance >= 5000) {
//             Serial.println("📡 Sensor: NO object detected");
//         } else {
//             Serial.println("📡 Sensor: " + String(distance, 1) + " cm  ← OBJECT DETECTED");
//         }

//         StaticJsonDocument<128> jsonPayload;
//         jsonPayload["road"]          = ROAD_ID;
//         jsonPayload["distanceCm"]    = distance;
//         jsonPayload["vehicleNearby"] = (distance <= 400);
//         jsonPayload["timestamp"]     = millis();

//         char buffer[128];
//         serializeJson(jsonPayload, buffer);
//         mqttClient.publish(PUBLISH_TOPIC.c_str(), buffer);
//         Serial.println("📤 Published: " + String(buffer));
//     }
// }


// ═══════════════════════════════════════════════════════════════════════════
// esp32/nawinna_node/nawinna_node.ino
// SOUTH ROAD — Full sensor integration
// Sensors: Ultrasonic + IR x2 + Piezo + Rain + Pedestrian Button
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

// ── PIN DEFINITIONS ─────────────────────────────────────────────────────────
// Ultrasonic
#define TRIG_PIN       5
#define ECHO_PIN       18

// Traffic LEDs
#define RED_LED        26
#define YELLOW_LED     27
#define GREEN_LED      14

// IR sensors (placed alongside road, behind stop line)
#define IR_SENSOR_1    34   // First IR  — 0-5cm from stop line  (light traffic)
#define IR_SENSOR_2    35   // Second IR — 5-10cm from stop line (heavy traffic)

// Piezo vibration sensor (heavy vehicle detection)
#define PIEZO_PIN      32

// Rain sensor (digital output — LOW when rain detected)
#define RAIN_PIN       33

// Pedestrian push button
#define PED_BUTTON     25

// Pedestrian LEDs
#define PED_RED_LED    19
#define PED_GREEN_LED  21

// 7-segment countdown display pins (change these if your wiring differs)
#define SEG_A          2
#define SEG_B          15
#define SEG_C          16
#define SEG_D          17
#define SEG_E          22
#define SEG_F          23
#define SEG_G          4

// ── TIMING CONSTANTS (MATCH ESP32 BASE CODE) ────────────────────────────────
// Red is always fixed at 3 seconds
const unsigned long BASE_RED_TIME      = 3000;  // 3 seconds

// Yellow: 3s base, +2s when raining = 5s total
const unsigned long BASE_YELLOW_TIME   = 3000;  // 3 seconds
const unsigned long RAIN_YELLOW_EXTRA  = 2000;  // +2 seconds when raining

// Green: 3s base, +3s for light traffic, +6s for heavy traffic
const unsigned long BASE_GREEN_TIME    = 3000;  // 3 seconds
const unsigned long LIGHT_TRAFFIC_BONUS = 3000; // +3 seconds (1 IR blocked)
const unsigned long HEAVY_TRAFFIC_BONUS = 6000; // +6 seconds (2 IR blocked)

// ── MQTT TOPICS ─────────────────────────────────────────────────────────────
String PUB_SENSOR;    // traffic/ultrasonic/South
String PUB_IR;        // traffic/ir/South
String PUB_PIEZO;     // traffic/piezo/South
String PUB_RAIN;      // traffic/rain/South
String PUB_PED;       // traffic/pedestrian/South
String PUB_STATE;     // traffic/state/South
String SUB_CONTROL;   // traffic/control/South

// ── MQTT CLIENT ──────────────────────────────────────────────────────────────
WiFiClient   wifiClient;
PubSubClient mqttClient(wifiClient);

// ── LIGHT STATE MACHINE ─────────────────────────────────────────────────────
enum LightPhase { PHASE_RED, PHASE_GREEN, PHASE_YELLOW };
LightPhase    currentPhase     = PHASE_RED;
unsigned long phaseEndMs       = 0;
unsigned long currentGreenTime = BASE_GREEN_TIME;
unsigned long currentYellowTime = BASE_YELLOW_TIME;
unsigned long currentRedTime   = BASE_RED_TIME;

// ── PEDESTRIAN STATE ─────────────────────────────────────────────────────────
bool          pedRequested     = false;
bool          pedCrossing      = false;
bool          afterPedestrianCrossing = false;
bool          yellowCountdownDisplayed = false;
unsigned long pedStartMs       = 0;
const int     PED_CROSS_TIME   = 10; // seconds for pedestrian to cross

// ── SENSOR PUBLISH INTERVALS ─────────────────────────────────────────────────
unsigned long lastUltraPublish = 0;
unsigned long lastIRPublish    = 0;
unsigned long lastPiezoPublish = 0;
unsigned long lastRainPublish  = 0;

// ── SENSOR STATES ───────────────────────────────────────────────────────────
bool ir1Blocked = false;
bool ir2Blocked = false;
bool rainDetected = false;
bool heavyVehicleDetected = false;

// ─────────────────────────────────────────────────────────────────────────────
// LIGHT CONTROL
// ─────────────────────────────────────────────────────────────────────────────
void setTrafficLight(LightPhase phase) {
    digitalWrite(RED_LED,    LOW);
    digitalWrite(YELLOW_LED, LOW);
    digitalWrite(GREEN_LED,  LOW);
    if (phase == PHASE_RED)    digitalWrite(RED_LED,    HIGH);
    if (phase == PHASE_YELLOW) digitalWrite(YELLOW_LED, HIGH);
    if (phase == PHASE_GREEN)  digitalWrite(GREEN_LED,  HIGH);
}

void publishState(String state) {
    StaticJsonDocument<128> doc;
    doc["road"]  = ROAD_ID;
    doc["state"] = state;
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_STATE.c_str(), buf, true);
    Serial.println("💡 State → " + state);
}

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
    if (seconds <= 0) {
        clearDisplay();
        return;
    }
    for (int remaining = seconds; remaining >= 1; remaining--) {
        displayDigit(remaining > 9 ? 9 : remaining);
        unsigned long end = millis() + 1000UL;
        while (millis() < end) {
            delay(1);
        }
    }
    clearDisplay();
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE TIMINGS BASED ON SENSORS (MATCHES ESP32 BASE CODE)
// ─────────────────────────────────────────────────────────────────────────────
void updateTimings() {
    // 1. RED is always fixed (3 seconds)
    currentRedTime = BASE_RED_TIME;
    
    // 2. GREEN time based on traffic density (IR sensors)
    if (ir1Blocked && ir2Blocked) {
        // BOTH sensors blocked = HEAVY TRAFFIC
        currentGreenTime = BASE_GREEN_TIME + HEAVY_TRAFFIC_BONUS;  // 3s + 6s = 9s
        Serial.println("🔴 HEAVY TRAFFIC — Green: 9s (+6s bonus)");
    } else if (ir1Blocked || ir2Blocked) {
        // ONE sensor blocked = LIGHT TRAFFIC
        currentGreenTime = BASE_GREEN_TIME + LIGHT_TRAFFIC_BONUS;  // 3s + 3s = 6s
        Serial.println("🟡 LIGHT TRAFFIC — Green: 6s (+3s bonus)");
    } else {
        // NO sensors blocked = NO TRAFFIC
        currentGreenTime = BASE_GREEN_TIME;  // 3s
        Serial.println("🟢 NO TRAFFIC — Green: 3s (base)");
    }
    
    // 3. YELLOW time based on rain
    if (rainDetected) {
        currentYellowTime = BASE_YELLOW_TIME + RAIN_YELLOW_EXTRA;  // 3s + 2s = 5s
        Serial.println("🌧️ RAIN DETECTED — Yellow: 5s (+2s safety)");
    } else {
        currentYellowTime = BASE_YELLOW_TIME;  // 3s
        Serial.println("☀️ DRY — Yellow: 3s (normal)");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE STATE MACHINE (non-blocking)
// ─────────────────────────────────────────────────────────────────────────────
void updateLightPhase() {
    if (currentPhase == PHASE_RED && pedRequested && !pedCrossing) {
        Serial.println("🚶 Button pressed during RED — immediate crossing");
        startPedestrianCrossing();
        return;
    }

    if (currentPhase == PHASE_YELLOW && pedRequested && !pedCrossing && !yellowCountdownDisplayed) {
        unsigned long remainingMs = (phaseEndMs > millis() ? phaseEndMs - millis() : 0);
        int remainingSec = remainingMs ? ((remainingMs + 999) / 1000) : 0;
        if (remainingSec > 0) {
            Serial.println("⏳ Pedestrian waiting during YELLOW — showing countdown");
            startCountdown(remainingSec);
        }
        yellowCountdownDisplayed = true;
        return;
    }

    if (millis() < phaseEndMs) return;
    
    if (currentPhase == PHASE_RED) {
        currentPhase = PHASE_GREEN;
        phaseEndMs = millis() + currentGreenTime;
        setTrafficLight(PHASE_GREEN);
        publishState("GREEN");
        Serial.println("🟢 GREEN for " + String(currentGreenTime / 1000) + "s");
        
    } else if (currentPhase == PHASE_GREEN) {
        currentPhase = PHASE_YELLOW;
        phaseEndMs = millis() + currentYellowTime;
        setTrafficLight(PHASE_YELLOW);
        publishState("YELLOW");
        Serial.println("🟡 YELLOW for " + String(currentYellowTime / 1000) + "s");
        yellowCountdownDisplayed = false;

        if (pedRequested && !pedCrossing) {
            Serial.println("🚶 Pedestrian waiting — will cross after yellow");
        }
        
    } else if (currentPhase == PHASE_YELLOW) {
        if (pedRequested && !pedCrossing) {
            startPedestrianCrossing();
        } else if (afterPedestrianCrossing) {
            afterPedestrianCrossing = false;
            currentPhase = PHASE_GREEN;
            phaseEndMs = millis() + currentGreenTime;
            setTrafficLight(PHASE_GREEN);
            publishState("GREEN");
            Serial.println("🟢 GREEN for " + String(currentGreenTime / 1000) + "s");
            setTrafficLight(PHASE_RED);
            publishState("RED");
            Serial.println("🔴 RED for " + String(currentRedTime / 1000) + "s");
        }
        yellowCountdownDisplayed = false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PEDESTRIAN CROSSING
// ─────────────────────────────────────────────────────────────────────────────
void startPedestrianCrossing() {
    Serial.println("🚶 PEDESTRIAN CROSSING STARTED");
    pedCrossing = true;
    pedRequested = false;
    afterPedestrianCrossing = false;
    yellowCountdownDisplayed = false;
    currentPhase = PHASE_RED;
    phaseEndMs = millis() + (PED_CROSS_TIME * 1000UL);
    
    setTrafficLight(PHASE_RED);
    publishState("RED");
    
    digitalWrite(PED_RED_LED,   LOW);
    digitalWrite(PED_GREEN_LED, HIGH);
    
    StaticJsonDocument<128> doc;
    doc["road"]     = ROAD_ID;
    doc["crossing"] = true;
    doc["duration"] = PED_CROSS_TIME;
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_PED.c_str(), buf);
    
    pedStartMs = millis();
}

void updatePedestrianCrossing() {
    if (!pedCrossing) return;
    if (millis() - pedStartMs >= (PED_CROSS_TIME * 1000UL)) {
        pedCrossing = false;
        digitalWrite(PED_GREEN_LED, LOW);
        digitalWrite(PED_RED_LED,   HIGH);
        
        StaticJsonDocument<128> doc;
        doc["road"]     = ROAD_ID;
        doc["crossing"] = false;
        doc["duration"] = PED_CROSS_TIME;
        char buf[128];
        serializeJson(doc, buf);
        mqttClient.publish(PUB_PED.c_str(), buf);
        
        Serial.println("✅ Pedestrian crossing finished — moving to YELLOW then GREEN");
        
        afterPedestrianCrossing = true;
        currentPhase = PHASE_YELLOW;
        phaseEndMs = millis() + currentYellowTime;
        setTrafficLight(PHASE_YELLOW);
        publishState("YELLOW");
        yellowCountdownDisplayed = false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ULTRASONIC SENSOR
// ─────────────────────────────────────────────────────────────────────────────
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
    if (millis() - lastUltraPublish < 500) return;
    lastUltraPublish = millis();
    
    float dist = measureDistance();
    bool  hasVehicle = (dist < 5000 && dist <= 400);
    
    StaticJsonDocument<128> doc;
    doc["road"]          = ROAD_ID;
    doc["distanceCm"]    = dist;
    doc["vehicleNearby"] = hasVehicle;
    doc["timestamp"]     = millis();
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_SENSOR.c_str(), buf);
    
    if (hasVehicle)
        Serial.println("📡 Ultrasonic: " + String(dist, 1) + "cm");
    else
        Serial.println("📡 Ultrasonic: No vehicle");
}

// ─────────────────────────────────────────────────────────────────────────────
// IR SENSORS (UPDATED WITH TIMING UPDATE)
// ─────────────────────────────────────────────────────────────────────────────
void publishIR() {
    if (millis() - lastIRPublish < 1000) return;
    lastIRPublish = millis();
    
    // Read IR sensors (LOW = blocked (vehicle present), HIGH = clear)
    bool newIr1 = (digitalRead(IR_SENSOR_1) == LOW);
    bool newIr2 = (digitalRead(IR_SENSOR_2) == LOW);
    
    // Check if state changed
    if (newIr1 != ir1Blocked || newIr2 != ir2Blocked) {
        ir1Blocked = newIr1;
        ir2Blocked = newIr2;
        updateTimings();  // Recalculate timings when IR state changes
    }
    
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
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_IR.c_str(), buf);
    
    Serial.println("🔦 IR: IR1=" + String(ir1Blocked ? "BLOCKED" : "CLEAR") + 
                   " IR2=" + String(ir2Blocked ? "BLOCKED" : "CLEAR") + 
                   " Queue=" + queueLevel);
}

// ─────────────────────────────────────────────────────────────────────────────
// PIEZO SENSOR (HEAVY VEHICLE DETECTION)
// ─────────────────────────────────────────────────────────────────────────────
void publishPiezo() {
    if (millis() - lastPiezoPublish < 1000) return;
    lastPiezoPublish = millis();
    
    int piezoVal = analogRead(PIEZO_PIN);
    bool heavyVehicle = (piezoVal > 500); // Adjust threshold for your sensor
    
    if (heavyVehicle != heavyVehicleDetected) {
        heavyVehicleDetected = heavyVehicle;
        if (heavyVehicleDetected) {
            Serial.println("🚛 Heavy vehicle detected! Increasing priority");
            // Optionally update timings for heavy vehicle
            updateTimings();
        }
    }
    
    StaticJsonDocument<128> doc;
    doc["road"]         = ROAD_ID;
    doc["piezoValue"]   = piezoVal;
    doc["heavyVehicle"] = heavyVehicle;
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_PIEZO.c_str(), buf);
    
    if (heavyVehicle)
        Serial.println("🚛 PIEZO: Heavy vehicle detected! val=" + String(piezoVal));
}

// ─────────────────────────────────────────────────────────────────────────────
// RAIN SENSOR (UPDATED WITH TIMING UPDATE)
// ─────────────────────────────────────────────────────────────────────────────
void publishRain() {
    if (millis() - lastRainPublish < 2000) return;
    lastRainPublish = millis();
    
    bool newRain = (digitalRead(RAIN_PIN) == LOW); // LOW = rain
    
    if (newRain != rainDetected) {
        rainDetected = newRain;
        updateTimings();  // Recalculate timings when rain state changes
        
        if (rainDetected) {
            Serial.println("🌧️ RAIN DETECTED — Yellow extended to 5s (3s + 2s)");
        } else {
            Serial.println("☀️ RAIN STOPPED — Yellow back to 3s");
        }
    }
    
    StaticJsonDocument<128> doc;
    doc["road"]         = ROAD_ID;
    doc["rainDetected"] = rainDetected;
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_RAIN.c_str(), buf);
}

// ─────────────────────────────────────────────────────────────────────────────
// PEDESTRIAN BUTTON CHECK
// ─────────────────────────────────────────────────────────────────────────────
void checkPedestrianButton() {
    if (digitalRead(PED_BUTTON) == LOW && !pedRequested && !pedCrossing) {
        pedRequested = true;
        if (currentPhase == PHASE_RED) {
            Serial.println("🚶 Pedestrian button pressed during RED — immediate crossing");
            startPedestrianCrossing();
        } else if (currentPhase == PHASE_YELLOW) {
            Serial.println("🚶 Pedestrian button pressed during YELLOW — countdown then crossing");
        } else {
            Serial.println("🚶 Pedestrian button pressed during GREEN — waiting until green finishes");
        }
        
        StaticJsonDocument<128> doc;
        doc["road"]      = ROAD_ID;
        doc["requested"] = true;
        char buf[128];
        serializeJson(doc, buf);
        mqttClient.publish(PUB_PED.c_str(), buf);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MQTT CALLBACK — receives commands from server (force override)
// ─────────────────────────────────────────────────────────────────────────────
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    String msg = "";
    for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
    
    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, msg)) { 
        Serial.println("❌ JSON error"); 
        return; 
    }
    
    String signal = doc["signal"].as<String>();
    int greenTime  = doc["greenTime"]  | 5;
    int yellowTime = doc["yellowTime"] | 5;
    
    Serial.println("📩 CMD: " + signal + " green=" + String(greenTime) + "s yellow=" + String(yellowTime) + "s");
    
    if (signal == "GREEN") {
        // Override normal cycle
        currentPhase = PHASE_GREEN;
        phaseEndMs = millis() + (greenTime * 1000UL);
        setTrafficLight(PHASE_GREEN);
        publishState("GREEN");
        Serial.println("🟢 FORCE GREEN for " + String(greenTime) + "s");
        
    } else if (signal == "YELLOW") {
        currentPhase = PHASE_YELLOW;
        phaseEndMs = millis() + (yellowTime * 1000UL);
        setTrafficLight(PHASE_YELLOW);
        publishState("YELLOW");
        Serial.println("🟡 FORCE YELLOW for " + String(yellowTime) + "s");
        
    } else if (signal == "RED") {
        currentPhase = PHASE_RED;
        setTrafficLight(PHASE_RED);
        publishState("RED");
        Serial.println("🔴 FORCE RED");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// WiFi + MQTT CONNECT
// ─────────────────────────────────────────────────────────────────────────────
void connectWiFi() {
    Serial.print("Connecting WiFi: ");
    Serial.println(WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    int t = 0;
    while (WiFi.status() != WL_CONNECTED && t < 30) { 
        delay(500); 
        Serial.print("."); 
        t++; 
    }
    if (WiFi.status() == WL_CONNECTED)
        Serial.println("\n✅ WiFi OK: " + WiFi.localIP().toString());
    else
        Serial.println("\n❌ WiFi FAILED");
}

void connectMQTT() {
    String cid = "HYDRA-" + String(ROAD_ID);
    if (mqttClient.connect(cid.c_str())) {
        mqttClient.subscribe(SUB_CONTROL.c_str());
        Serial.println("✅ MQTT connected, subscribed: " + SUB_CONTROL);
    } else {
        Serial.println("❌ MQTT failed rc=" + String(mqttClient.state()));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    Serial.println("\n🚦 HYDRA Node — Road: " + String(ROAD_ID));
    Serial.println("═══════════════════════════════════════════════════");
    Serial.println("TIMING CONFIGURATION (ESP32 Base Code):");
    Serial.println("  RED:   3s (fixed)");
    Serial.println("  YELLOW: 3s base + 2s when raining = 5s");
    Serial.println("  GREEN:  3s base + traffic bonus");
    Serial.println("    - Light Traffic (1 IR): +3s = 6s total");
    Serial.println("    - Heavy Traffic (2 IR): +6s = 9s total");
    Serial.println("═══════════════════════════════════════════════════\n");
    
    // Output pins
    pinMode(TRIG_PIN,    OUTPUT);
    pinMode(RED_LED,     OUTPUT);
    pinMode(YELLOW_LED,  OUTPUT);
    pinMode(GREEN_LED,   OUTPUT);
    pinMode(PED_RED_LED,   OUTPUT);
    pinMode(PED_GREEN_LED, OUTPUT);
    pinMode(SEG_A, OUTPUT);
    pinMode(SEG_B, OUTPUT);
    pinMode(SEG_C, OUTPUT);
    pinMode(SEG_D, OUTPUT);
    pinMode(SEG_E, OUTPUT);
    pinMode(SEG_F, OUTPUT);
    pinMode(SEG_G, OUTPUT);
    
    // Input pins
    pinMode(ECHO_PIN,    INPUT);
    pinMode(IR_SENSOR_1, INPUT_PULLUP);
    pinMode(IR_SENSOR_2, INPUT_PULLUP);
    pinMode(PIEZO_PIN,   INPUT);
    pinMode(RAIN_PIN,    INPUT_PULLUP);
    pinMode(PED_BUTTON,  INPUT_PULLUP);
    
    // Safe start state
    setTrafficLight(PHASE_RED);
    digitalWrite(PED_RED_LED,   HIGH);
    digitalWrite(PED_GREEN_LED, LOW);
    clearDisplay();
    
    // Initial sensor readings
    ir1Blocked = (digitalRead(IR_SENSOR_1) == LOW);
    ir2Blocked = (digitalRead(IR_SENSOR_2) == LOW);
    rainDetected = (digitalRead(RAIN_PIN) == LOW);
    updateTimings();
    
    // Build topic strings
    PUB_SENSOR  = "traffic/ultrasonic/" + String(ROAD_ID);
    PUB_IR      = "traffic/ir/"         + String(ROAD_ID);
    PUB_PIEZO   = "traffic/piezo/"      + String(ROAD_ID);
    PUB_RAIN    = "traffic/rain/"       + String(ROAD_ID);
    PUB_PED     = "traffic/pedestrian/" + String(ROAD_ID);
    PUB_STATE   = "traffic/state/"      + String(ROAD_ID);
    SUB_CONTROL = "traffic/control/"    + String(ROAD_ID);
    
    connectWiFi();
    mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
    mqttClient.setCallback(mqttCallback);
    connectMQTT();
    
    // Start with RED phase
    currentPhase = PHASE_RED;
    phaseEndMs = millis() + currentRedTime;
    setTrafficLight(PHASE_RED);
    publishState("RED");
    Serial.println("🔴 Starting with RED for " + String(currentRedTime / 1000) + "s");
}

// ─────────────────────────────────────────────────────────────────────────────
// LOOP
// ─────────────────────────────────────────────────────────────────────────────
void loop() {
    // Keep MQTT alive
    if (!mqttClient.connected()) connectMQTT();
    mqttClient.loop();
    
    // Update light phase timer
    updateLightPhase();
    
    // Update pedestrian crossing timer
    updatePedestrianCrossing();
    
    // Check pedestrian button
    checkPedestrianButton();
    
    // Publish all sensor data
    publishUltrasonic();
    publishIR();
    publishPiezo();
    publishRain();
}