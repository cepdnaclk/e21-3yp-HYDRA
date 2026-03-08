// esp32/nawinna_node/nawinna_node.ino
// ─────────────────────────────────────────────────────────────
// H.Y.D.R.A — Nawinna Junction ESP32 Firmware
// Upload this to each ESP32. Change ROAD_ID for each board.
// ─────────────────────────────────────────────────────────────
#include <WiFi.h>
#include <PubSubClient.h>  // Install: Arduino Library Manager → "PubSubClient"
#include <ArduinoJson.h>   // Install: Arduino Library Manager → "ArduinoJson"

// ── CHANGE THESE FOR EACH ESP32 BOARD ──
const char* ROAD_ID      = "North";   // Change to "South", "East", or "West"
const char* WIFI_SSID    = "SLT-4G_166D59";     // Your WiFi network name
const char* WIFI_PASS    = "F58EA0CF"; // Your WiFi password
const char* MQTT_SERVER  = "16.171.197.109";     // Your AWS EC2 Public IP
const int   MQTT_PORT    = 1883;

// ── HC-SR04 ULTRASONIC SENSOR PINS ──
const int TRIG_PIN  = 5;   // ESP32 GPIO5 → TRIG on sensor
const int ECHO_PIN  = 18;  // ESP32 GPIO18 → ECHO on sensor

// ── TRAFFIC LIGHT LED PINS ──
const int RED_LED    = 26;  // ESP32 GPIO26 → Red LED (through 220Ω resistor)
const int YELLOW_LED = 27;  // ESP32 GPIO27 → Yellow LED (through 220Ω resistor)
const int GREEN_LED  = 14;  // ESP32 GPIO14 → Green LED (through 220Ω resistor)

// ── MQTT TOPICS ──
// This node publishes TO this topic (server reads it)
String PUBLISH_TOPIC;   // Will be set in setup() based on ROAD_ID
// This node subscribes TO this topic (server sends commands here)
String SUBSCRIBE_TOPIC; // Will be set in setup()

WiFiClient   wifiClient;
PubSubClient mqttClient(wifiClient);

// ── Current light state ──
String currentSignal = "RED";
int    greenTimeRemaining  = 0;

// ─────────────────────────────────────────────────────────────
// measureDistance()
// Returns distance in cm from HC-SR04 sensor
// Returns 5000 if no object detected (out of range)
// ─────────────────────────────────────────────────────────────
float measureDistance() {
    // Step 1: Make sure TRIG is LOW before we start
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);

    // Step 2: Send 10-microsecond HIGH pulse on TRIG
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);

    // Step 3: Wait for ECHO to go HIGH (sensor received the bounce-back)
    // timeout = 30000 microseconds (measures up to ~500cm)
    long duration = pulseIn(ECHO_PIN, HIGH, 30000);

    // Step 4: Convert time to distance
    if (duration == 0) return 5000;  // No echo = no object in range
    float distanceCm = (duration * 0.034) / 2.0;

    return distanceCm;
}

// ─────────────────────────────────────────────────────────────
// setTrafficLight()
// Turns on the correct LED and turns off the others
// ─────────────────────────────────────────────────────────────
void setTrafficLight(String signal) {
    // Safety rule: turn ALL off first before turning one on
    // This prevents a split-second where two lights are on
    digitalWrite(RED_LED,    LOW);
    digitalWrite(YELLOW_LED, LOW);
    digitalWrite(GREEN_LED,  LOW);
    delay(50);  // 50ms safety gap

    if      (signal == "RED")    digitalWrite(RED_LED,    HIGH);
    else if (signal == "YELLOW") digitalWrite(YELLOW_LED, HIGH);
    else if (signal == "GREEN")  digitalWrite(GREEN_LED,  HIGH);
}

// ─────────────────────────────────────────────────────────────
// mqttCallback()
// Called automatically whenever a message arrives on our subscribed topic
// ─────────────────────────────────────────────────────────────
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    // Convert byte array to String
    String msg = "";
    for (int i = 0; i < length; i++) msg += (char)payload[i];

    // Parse the JSON command from the server
    StaticJsonDocument<256> doc;
    DeserializationError error = deserializeJson(doc, msg);
    if (error) {
        Serial.println("JSON parse error: " + String(error.c_str()));
        return;
    }

    currentSignal     = doc["signal"].as<String>();
    greenTimeRemaining = doc["greenTime"].as<int>();
    int yellowTime    = doc["yellowTime"].as<int>();

    Serial.println("📩 Command received: " + currentSignal + " for " + String(greenTimeRemaining) + "s");

    // ── Execute the light sequence ──
    if (currentSignal == "GREEN") {
        // Phase 1: GREEN for the allocated time
        setTrafficLight("GREEN");
        Serial.println("🟢 GREEN for " + String(greenTimeRemaining) + " seconds");
        delay(greenTimeRemaining * 1000);

        // Phase 2: YELLOW for 3 seconds (warning)
        setTrafficLight("YELLOW");
        Serial.println("🟡 YELLOW for " + String(yellowTime) + " seconds");
        delay(yellowTime * 1000);

        // Phase 3: Back to RED
        setTrafficLight("RED");
        Serial.println("🔴 Back to RED");

    } else {
        // RED command — stay RED
        setTrafficLight("RED");
    }
}

// ─────────────────────────────────────────────────────────────
// connectToWiFi()
// ─────────────────────────────────────────────────────────────
void connectToWiFi() {
    Serial.print("Connecting to WiFi: ");
    Serial.println(WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println("");
    Serial.println("✅ WiFi Connected! IP: " + WiFi.localIP().toString());
}

// ─────────────────────────────────────────────────────────────
// connectToMQTT()
// ─────────────────────────────────────────────────────────────
void connectToMQTT() {
    String clientId = "HYDRA-" + String(ROAD_ID) + "-ESP32";
    while (!mqttClient.connected()) {
        Serial.print("Connecting to MQTT...");
        if (mqttClient.connect(clientId.c_str())) {
            Serial.println(" ✅ Connected!");
            mqttClient.subscribe(SUBSCRIBE_TOPIC.c_str());
            Serial.println("📡 Subscribed to: " + SUBSCRIBE_TOPIC);
        } else {
            Serial.print(" ❌ Failed. Retrying in 5s... rc=");
            Serial.println(mqttClient.state());
            delay(5000);
        }
    }
}

// ─────────────────────────────────────────────────────────────
// setup()  — runs ONCE when ESP32 powers on
// ─────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    Serial.println("\n🚦 H.Y.D.R.A ESP32 Node Starting — Road: " + String(ROAD_ID));

    // Set pin modes
    pinMode(TRIG_PIN,   OUTPUT);
    pinMode(ECHO_PIN,   INPUT);
    pinMode(RED_LED,    OUTPUT);
    pinMode(YELLOW_LED, OUTPUT);
    pinMode(GREEN_LED,  OUTPUT);

    // Start safe — all lights off, then RED on
    setTrafficLight("RED");

    // Set MQTT topic strings
    PUBLISH_TOPIC   = "traffic/ultrasonic/" + String(ROAD_ID);
    SUBSCRIBE_TOPIC = "traffic/control/"   + String(ROAD_ID);

    // Connect to WiFi
    connectToWiFi();

    // Set up MQTT
    mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
    mqttClient.setCallback(mqttCallback);
    connectToMQTT();
}

// ─────────────────────────────────────────────────────────────
// loop()  — runs REPEATEDLY forever
// ─────────────────────────────────────────────────────────────
void loop() {
    // Keep MQTT connection alive
    if (!mqttClient.connected()) {
        connectToMQTT();
    }
    mqttClient.loop();  // Process any incoming messages

    // Measure distance every 500ms
    static unsigned long lastMeasure = 0;
    if (millis() - lastMeasure >= 500) {
        lastMeasure = millis();

        float distance = measureDistance();

        // Prepare JSON payload
        StaticJsonDocument<128> doc;
        doc["road"]          = ROAD_ID;
        doc["distanceCm"]    = distance;
        doc["vehicleNearby"] = (distance <= 400);
        doc["timestamp"]     = millis();

        char buffer[128];
        serializeJson(doc, buffer);

        // Publish to server
        mqttClient.publish(PUBLISH_TOPIC.c_str(), buffer);
        Serial.println("📤 Published: " + String(buffer));
    }
}


