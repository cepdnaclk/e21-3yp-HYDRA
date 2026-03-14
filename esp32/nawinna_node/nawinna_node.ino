// esp32/nawinna_node/nawinna_node.ino — FULLY FIXED VERSION
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ── CHANGE THESE FOR EACH ESP32 BOARD ──
const char* ROAD_ID     = "North";           // Change to "South", "East", or "West"
const char* WIFI_SSID   = "SLT-4G_166D59";  // Your WiFi name
const char* WIFI_PASS   = "F58EA0CF";        // Your WiFi password
const char* MQTT_SERVER = "56.228.30.50";  // Your AWS EC2 Public IP
const int   MQTT_PORT   = 1883;

// ── HC-SR04 ULTRASONIC SENSOR PINS ──
const int TRIG_PIN   = 5;    // ESP32 GPIO5  → TRIG on sensor
const int ECHO_PIN   = 18;   // ESP32 GPIO18 → ECHO on sensor (via voltage divider)

// ── TRAFFIC LIGHT LED PINS ──
const int RED_LED    = 26;   // ESP32 GPIO26 → Red    LED (through 220Ω resistor)
const int YELLOW_LED = 27;   // ESP32 GPIO27 → Yellow LED (through 220Ω resistor)
const int GREEN_LED  = 14;   // ESP32 GPIO14 → Green  LED (through 220Ω resistor)

// ── MQTT TOPICS ──
String PUBLISH_TOPIC;    // traffic/ultrasonic/North  — sensor data TO server
String SUBSCRIBE_TOPIC;  // traffic/control/North     — commands FROM server
String STATE_TOPIC;      // traffic/state/North       — live light state TO server

// ── MQTT CLIENTS ──
WiFiClient   wifiClient;
PubSubClient mqttClient(wifiClient);

// ── LIGHT STATE MACHINE ──
// millis() timing instead of delay() — ESP32 never freezes
enum LightPhase { PHASE_RED, PHASE_GREEN, PHASE_YELLOW };
LightPhase    currentPhase      = PHASE_RED;
unsigned long phaseEndMs        = 0;
int           pendingGreenTime  = 0;
int           pendingYellowTime = 3;

// ─────────────────────────────────────────────────────────────
// setTrafficLight()
// Physically turns the correct LED on, all others off
// ─────────────────────────────────────────────────────────────
void setTrafficLight(LightPhase phase) {
    digitalWrite(RED_LED,    LOW);
    digitalWrite(YELLOW_LED, LOW);
    digitalWrite(GREEN_LED,  LOW);
    delay(50);
    if      (phase == PHASE_RED)    digitalWrite(RED_LED,    HIGH);
    else if (phase == PHASE_YELLOW) digitalWrite(YELLOW_LED, HIGH);
    else if (phase == PHASE_GREEN)  digitalWrite(GREEN_LED,  HIGH);
}

// ─────────────────────────────────────────────────────────────
// publishLiveState()
// Tells the server the current LED colour
// Dashboard reads this to show correct colour in real time
// ─────────────────────────────────────────────────────────────
void publishLiveState(String state) {
    String msg = "{\"road\":\"" + String(ROAD_ID) + "\",\"state\":\"" + state + "\"}";
    mqttClient.publish(STATE_TOPIC.c_str(), msg.c_str(), true);
    Serial.println("📢 State published: " + state);
}

// ─────────────────────────────────────────────────────────────
// updateLightStateMachine()
// Called every loop() — checks timers and moves phases
// GREEN → YELLOW → RED happens automatically, NO blocking
// ─────────────────────────────────────────────────────────────
void updateLightStateMachine() {
    if (currentPhase == PHASE_RED) return;

    if (millis() >= phaseEndMs) {

        if (currentPhase == PHASE_GREEN) {
            // GREEN finished → switch to YELLOW
            currentPhase = PHASE_YELLOW;
            phaseEndMs   = millis() + (pendingYellowTime * 1000UL);
            setTrafficLight(PHASE_YELLOW);
            Serial.println("🟡 YELLOW for " + String(pendingYellowTime) + "s");
            publishLiveState("YELLOW");

        } else if (currentPhase == PHASE_YELLOW) {
            // YELLOW finished → switch to RED
            currentPhase = PHASE_RED;
            setTrafficLight(PHASE_RED);
            Serial.println("🔴 Back to RED");
            publishLiveState("RED");
        }
    }
}

// ─────────────────────────────────────────────────────────────
// measureDistance()
// Returns distance in cm. Returns 5000 if nothing detected.
// ─────────────────────────────────────────────────────────────
float measureDistance() {
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);

    long duration = pulseIn(ECHO_PIN, HIGH, 30000);
    if (duration == 0) return 5000;
    return (duration * 0.034) / 2.0;
}

// ─────────────────────────────────────────────────────────────
// mqttCallback()
// Called when server sends a command
// Stores timing and starts phase — NO delay()
// ─────────────────────────────────────────────────────────────
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    String msg = "";
    for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, msg)) {
        Serial.println("❌ JSON parse error");
        return;
    }

    String signal     = doc["signal"].as<String>();
    int    greenTime  = doc["greenTime"].as<int>();
    int    yellowTime = doc["yellowTime"] | 3;

    Serial.println("📩 Command: " + signal + " greenTime=" + String(greenTime) + "s");

    if (signal == "GREEN") {
        pendingGreenTime  = greenTime;
        pendingYellowTime = yellowTime;
        currentPhase      = PHASE_GREEN;
        phaseEndMs        = millis() + (greenTime * 1000UL);
        setTrafficLight(PHASE_GREEN);
        Serial.println("🟢 GREEN started (" + String(greenTime) + "s)");
        publishLiveState("GREEN");

    } else {
        currentPhase = PHASE_RED;
        setTrafficLight(PHASE_RED);
        Serial.println("🔴 RED");
        publishLiveState("RED");
    }
}

// ─────────────────────────────────────────────────────────────
// connectToWiFi()
// ─────────────────────────────────────────────────────────────
void connectToWiFi() {
    Serial.print("Connecting to WiFi: ");
    Serial.println(WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    int tries = 0;
    while (WiFi.status() != WL_CONNECTED && tries < 30) {
        delay(500);
        Serial.print(".");
        tries++;
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n✅ WiFi Connected! IP: " + WiFi.localIP().toString());
    } else {
        Serial.println("\n❌ WiFi FAILED — check SSID and password");
    }
}

// ─────────────────────────────────────────────────────────────
// connectToMQTT()
// ─────────────────────────────────────────────────────────────
void connectToMQTT() {
    String clientId = "HYDRA-" + String(ROAD_ID) + "-ESP32";
    Serial.print("Connecting to MQTT...");
    if (mqttClient.connect(clientId.c_str())) {
        Serial.println(" ✅ Connected!");
        mqttClient.subscribe(SUBSCRIBE_TOPIC.c_str());
        Serial.println("📡 Subscribed to: " + SUBSCRIBE_TOPIC);
    } else {
        Serial.println(" ❌ Failed rc=" + String(mqttClient.state()));
    }
}

// ─────────────────────────────────────────────────────────────
// setup() — runs ONCE on power on
// ─────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    Serial.println("\n🚦 H.Y.D.R.A Node Starting — Road: " + String(ROAD_ID));

    pinMode(TRIG_PIN,   OUTPUT);
    pinMode(ECHO_PIN,   INPUT);
    pinMode(RED_LED,    OUTPUT);
    pinMode(YELLOW_LED, OUTPUT);
    pinMode(GREEN_LED,  OUTPUT);

    setTrafficLight(PHASE_RED);  // start safe — RED on

    PUBLISH_TOPIC   = "traffic/ultrasonic/" + String(ROAD_ID);
    SUBSCRIBE_TOPIC = "traffic/control/"    + String(ROAD_ID);
    STATE_TOPIC     = "traffic/state/"      + String(ROAD_ID);

    connectToWiFi();
    mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
    mqttClient.setCallback(mqttCallback);
    connectToMQTT();
}

// ─────────────────────────────────────────────────────────────
// loop() — runs FOREVER, never blocks
// ─────────────────────────────────────────────────────────────
void loop() {
    // 1. Keep MQTT alive
    if (!mqttClient.connected()) {
        connectToMQTT();
    }
    mqttClient.loop();

    // 2. Check light phase timers — GREEN→YELLOW→RED automatically
    updateLightStateMachine();

    // 3. Measure sensor and publish every 500ms
    static unsigned long lastMeasure = 0;
    if (millis() - lastMeasure >= 500) {
        lastMeasure = millis();

        float distance = measureDistance();

        if (distance >= 5000) {
            Serial.println("📡 Sensor: NO object detected");
        } else {
            Serial.println("📡 Sensor: " + String(distance, 1) + " cm  ← OBJECT DETECTED");
        }

        StaticJsonDocument<128> jsonPayload;
        jsonPayload["road"]          = ROAD_ID;
        jsonPayload["distanceCm"]    = distance;
        jsonPayload["vehicleNearby"] = (distance <= 400);
        jsonPayload["timestamp"]     = millis();

        char buffer[128];
        serializeJson(jsonPayload, buffer);
        mqttClient.publish(PUBLISH_TOPIC.c_str(), buffer);
        Serial.println("📤 Published: " + String(buffer));
    }
}
