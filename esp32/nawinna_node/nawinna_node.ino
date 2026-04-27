// ═══════════════════════════════════════════════════════════════════════════
// esp32/nawinna_node/nawinna_node.ino
// COMPLETE VERSION - Pedestrian + Piezo + IR + Rain + Ultrasonic
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
#define IR_SENSOR_1    34   // First IR  — 0-5cm from stop line (light traffic)
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

// Seven Segment Display (optional - for countdown)
// Define your 7-segment pins here if used
// #define SEG_A_PIN      22
// #define SEG_B_PIN      23
// #define SEG_C_PIN      24
// #define SEG_D_PIN      25
// #define SEG_E_PIN      26
// #define SEG_F_PIN      27
// #define SEG_G_PIN      28

// ── TIMING CONSTANTS ────────────────────────────────────────────────────────
// Red is always fixed at 3 seconds
const unsigned long BASE_RED_TIME      = 3000;  // 3 seconds

// Yellow: 3s base, +2s when raining = 5s total
const unsigned long BASE_YELLOW_TIME   = 3000;  // 3 seconds
const unsigned long RAIN_YELLOW_EXTRA  = 2000;  // +2 seconds when raining

// Green: 3s base, +3s for light traffic, +6s for heavy traffic, +5s for heavy vehicle
const unsigned long BASE_GREEN_TIME     = 3000;  // 3 seconds
const unsigned long LIGHT_TRAFFIC_BONUS = 3000;  // +3 seconds (1 IR blocked)
const unsigned long HEAVY_TRAFFIC_BONUS = 6000;  // +6 seconds (2 IR blocked)
const unsigned long HEAVY_VEHICLE_BONUS = 5000;  // +5 seconds when heavy vehicle detected

// Pedestrian crossing time (fixed 3 seconds as requested)
const unsigned long PED_CROSSING_TIME  = 3000;   // 3 seconds fixed

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

// ── TRAFFIC LIGHT STATE MACHINE ─────────────────────────────────────────────
enum TrafficPhase { TRAFFIC_RED, TRAFFIC_GREEN, TRAFFIC_YELLOW, TRAFFIC_PEDESTRIAN };
TrafficPhase  currentTrafficPhase = TRAFFIC_RED;
unsigned long phaseEndMs          = 0;
unsigned long currentGreenTime    = BASE_GREEN_TIME;
unsigned long currentYellowTime   = BASE_YELLOW_TIME;
unsigned long currentRedTime      = BASE_RED_TIME;

// ── PEDESTRIAN STATE ────────────────────────────────────────────────────────
enum PedestrianState { PED_IDLE, PED_WAITING, PED_CROSSING };
PedestrianState pedState = PED_IDLE;
unsigned long   pedRequestTime = 0;
unsigned long   pedestrianEndMs = 0;

// ── SENSOR STATES ───────────────────────────────────────────────────────────
bool ir1Blocked = false;
bool ir2Blocked = false;
bool rainDetected = false;
bool heavyVehicleDetected = false;
unsigned long heavyVehicleDetectTime = 0;
bool heavyVehicleBonusApplied = false;

// ── SENSOR PUBLISH INTERVALS ─────────────────────────────────────────────────
unsigned long lastUltraPublish = 0;
unsigned long lastIRPublish    = 0;
unsigned long lastPiezoPublish = 0;
unsigned long lastRainPublish  = 0;

// ── SEVEN SEGMENT DISPLAY (for countdown) ───────────────────────────────────
// Uncomment and implement if you have 7-segment display
/*
void displayNumber(int number) {
    // Implement 7-segment display logic here
    // This is a placeholder
}
*/

void showCountdown(int seconds) {
    Serial.print("⏱️ Countdown: ");
    Serial.print(seconds);
    Serial.println("s remaining");
    // If you have 7-segment, call displayNumber(seconds) here
}

// ─────────────────────────────────────────────────────────────────────────────
// LIGHT CONTROL FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────
void setTrafficLight(TrafficPhase phase) {
    digitalWrite(RED_LED,    LOW);
    digitalWrite(YELLOW_LED, LOW);
    digitalWrite(GREEN_LED,  LOW);
    
    switch(phase) {
        case TRAFFIC_RED:
            digitalWrite(RED_LED, HIGH);
            break;
        case TRAFFIC_YELLOW:
            digitalWrite(YELLOW_LED, HIGH);
            break;
        case TRAFFIC_GREEN:
            digitalWrite(GREEN_LED, HIGH);
            break;
        case TRAFFIC_PEDESTRIAN:
            digitalWrite(RED_LED, HIGH);
            break;
    }
}

void setPedestrianLight(bool isGreen) {
    if (isGreen) {
        digitalWrite(PED_RED_LED,   LOW);
        digitalWrite(PED_GREEN_LED, HIGH);
        Serial.println("🚶 PEDESTRIAN LIGHT: GREEN");
    } else {
        digitalWrite(PED_RED_LED,   HIGH);
        digitalWrite(PED_GREEN_LED, LOW);
        Serial.println("🚶 PEDESTRIAN LIGHT: RED");
    }
}

void publishState(String state) {
    StaticJsonDocument<128> doc;
    doc["road"]  = ROAD_ID;
    doc["state"] = state;
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_STATE.c_str(), buf, true);
    Serial.println("💡 Traffic State → " + state);
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE TIMINGS BASED ON SENSORS
// ─────────────────────────────────────────────────────────────────────────────
void updateTimings() {
    // 1. RED is always fixed (3 seconds)
    currentRedTime = BASE_RED_TIME;
    
    // 2. GREEN time based on traffic density (IR sensors)
    unsigned long calculatedGreen = BASE_GREEN_TIME;
    
    if (ir1Blocked && ir2Blocked) {
        // BOTH sensors blocked = HEAVY TRAFFIC
        calculatedGreen = BASE_GREEN_TIME + HEAVY_TRAFFIC_BONUS;  // 3s + 6s = 9s
        Serial.println("🔴 HEAVY TRAFFIC — Base Green: 9s");
    } else if (ir1Blocked || ir2Blocked) {
        // ONE sensor blocked = LIGHT TRAFFIC
        calculatedGreen = BASE_GREEN_TIME + LIGHT_TRAFFIC_BONUS;  // 3s + 3s = 6s
        Serial.println("🟡 LIGHT TRAFFIC — Base Green: 6s");
    } else {
        // NO sensors blocked = NO TRAFFIC
        calculatedGreen = BASE_GREEN_TIME;  // 3s
        Serial.println("🟢 NO TRAFFIC — Base Green: 3s");
    }
    
    // 3. Add heavy vehicle bonus if detected (and bonus not already applied in this cycle)
    if (heavyVehicleDetected && !heavyVehicleBonusApplied) {
        calculatedGreen += HEAVY_VEHICLE_BONUS;  // +5 seconds
        Serial.println("🚛 HEAVY VEHICLE — Adding +5s to Green Time");
        heavyVehicleBonusApplied = true;
    }
    
    currentGreenTime = calculatedGreen;
    Serial.print("📊 FINAL GREEN TIME: ");
    Serial.print(currentGreenTime / 1000);
    Serial.println(" seconds");
    
    // 4. YELLOW time based on rain
    if (rainDetected) {
        currentYellowTime = BASE_YELLOW_TIME + RAIN_YELLOW_EXTRA;  // 3s + 2s = 5s
        Serial.println("🌧️ RAIN DETECTED — Yellow: 5s");
    } else {
        currentYellowTime = BASE_YELLOW_TIME;  // 3s
        Serial.println("☀️ DRY — Yellow: 3s");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PEDESTRIAN REQUEST HANDLING - THE CORE LOGIC
// ─────────────────────────────────────────────────────────────────────────────
void handlePedestrianRequest() {
    if (pedState != PED_WAITING) return;
    
    switch(currentTrafficPhase) {
        case TRAFFIC_RED:
            // RED light: Immediately give pedestrian crossing
            Serial.println("🚦 PEDESTRIAN: RED light detected — IMMEDIATE CROSSING");
            startPedestrianCrossing();
            break;
            
        case TRAFFIC_YELLOW:
            // YELLOW light: Show countdown, then go to RED with pedestrian crossing
            {
                unsigned long remaining = (phaseEndMs > millis()) ? (phaseEndMs - millis()) / 1000 : 0;
                Serial.print("🚦 PEDESTRIAN: YELLOW light detected — ");
                Serial.print(remaining);
                Serial.println("s remaining");
                showCountdown(remaining);
                // Will start crossing after YELLOW finishes
            }
            break;
            
        case TRAFFIC_GREEN:
            // GREEN light: Wait until GREEN finishes, then go YELLOW → RED → Pedestrian
            Serial.println("🚦 PEDESTRIAN: GREEN light detected — WILL WAIT for cycle to complete");
            break;
            
        case TRAFFIC_PEDESTRIAN:
            // Already in pedestrian mode
            break;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// START PEDESTRIAN CROSSING
// ─────────────────────────────────────────────────────────────────────────────
void startPedestrianCrossing() {
    Serial.println("🚶 PEDESTRIAN CROSSING STARTED (3 seconds)");
    
    pedState = PED_CROSSING;
    currentTrafficPhase = TRAFFIC_PEDESTRIAN;
    
    // Turn traffic light to RED
    setTrafficLight(TRAFFIC_RED);
    
    // Turn pedestrian light to GREEN
    setPedestrianLight(true);
    
    // Set crossing duration (3 seconds fixed)
    pedestrianEndMs = millis() + PED_CROSSING_TIME;
    phaseEndMs = pedestrianEndMs;
    
    // Notify server
    StaticJsonDocument<128> doc;
    doc["road"]     = ROAD_ID;
    doc["crossing"] = true;
    doc["duration"] = PED_CROSSING_TIME / 1000;
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_PED.c_str(), buf);
    
    publishState("PEDESTRIAN_CROSSING");
}

// ─────────────────────────────────────────────────────────────────────────────
// FINISH PEDESTRIAN CROSSING
// ─────────────────────────────────────────────────────────────────────────────
void finishPedestrianCrossing() {
    Serial.println("✅ PEDESTRIAN CROSSING FINISHED");
    
    pedState = PED_IDLE;
    
    // Turn pedestrian light back to RED
    setPedestrianLight(false);
    
    // Turn traffic light to YELLOW (as per logic: after pedestrian, YELLOW then GREEN)
    currentTrafficPhase = TRAFFIC_YELLOW;
    phaseEndMs = millis() + currentYellowTime;
    setTrafficLight(TRAFFIC_YELLOW);
    publishState("YELLOW");
    
    Serial.print("🟡 YELLOW for ");
    Serial.print(currentYellowTime / 1000);
    Serial.println("s (after pedestrian)");
    
    // Notify server crossing finished
    StaticJsonDocument<128> doc;
    doc["road"]     = ROAD_ID;
    doc["crossing"] = false;
    doc["duration"] = 0;
    char buf[128];
    serializeJson(doc, buf);
    mqttClient.publish(PUB_PED.c_str(), buf);
}

// ─────────────────────────────────────────────────────────────────────────────
// TRAFFIC LIGHT STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────
void updateTrafficLight() {
    if (millis() < phaseEndMs) return;
    
    switch(currentTrafficPhase) {
        case TRAFFIC_RED:
            // RED finished → start GREEN
            currentTrafficPhase = TRAFFIC_GREEN;
            phaseEndMs = millis() + currentGreenTime;
            setTrafficLight(TRAFFIC_GREEN);
            publishState("GREEN");
            Serial.print("🟢 GREEN for ");
            Serial.print(currentGreenTime / 1000);
            Serial.println("s");
            
            // Reset heavy vehicle bonus flag for next cycle
            heavyVehicleBonusApplied = false;
            break;
            
        case TRAFFIC_GREEN:
            // GREEN finished → check for waiting pedestrian
            if (pedState == PED_WAITING) {
                // Pedestrian is waiting, go to YELLOW then pedestrian
                Serial.println("🚦 Pedestrian waiting — proceeding to YELLOW");
            }
            currentTrafficPhase = TRAFFIC_YELLOW;
            phaseEndMs = millis() + currentYellowTime;
            setTrafficLight(TRAFFIC_YELLOW);
            publishState("YELLOW");
            Serial.print("🟡 YELLOW for ");
            Serial.print(currentYellowTime / 1000);
            Serial.println("s");
            break;
            
        case TRAFFIC_YELLOW:
            // YELLOW finished → check if pedestrian waiting
            if (pedState == PED_WAITING) {
                // Serve pedestrian crossing
                startPedestrianCrossing();
            } else {
                // No pedestrian, go back to RED
                currentTrafficPhase = TRAFFIC_RED;
                phaseEndMs = millis() + currentRedTime;
                setTrafficLight(TRAFFIC_RED);
                publishState("RED");
                Serial.print("🔴 RED for ");
                Serial.print(currentRedTime / 1000);
                Serial.println("s");
            }
            break;
            
        case TRAFFIC_PEDESTRIAN:
            // Pedestrian crossing finished
            finishPedestrianCrossing();
            break;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE PEDESTRIAN CROSSING TIMER
// ─────────────────────────────────────────────────────────────────────────────
void updatePedestrianCrossing() {
    if (pedState != PED_CROSSING) return;
    
    if (millis() >= pedestrianEndMs) {
        finishPedestrianCrossing();
    } else {
        // Show countdown on 7-segment display during crossing
        unsigned long remaining = (pedestrianEndMs - millis()) / 1000;
        if (remaining <= 3) {  // Only show last 3 seconds
            showCountdown(remaining);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PEDESTRIAN BUTTON CHECK
// ─────────────────────────────────────────────────────────────────────────────
void checkPedestrianButton() {
    // Button pressed (LOW because INPUT_PULLUP)
    if (digitalRead(PED_BUTTON) == LOW) {
        // Debounce delay
        delay(50);
        if (digitalRead(PED_BUTTON) == LOW) {
            
            if (pedState == PED_IDLE) {
                pedState = PED_WAITING;
                pedRequestTime = millis();
                Serial.println("🚶🚦 PEDESTRIAN BUTTON PRESSED — Waiting for crossing opportunity");
                
                // Notify server
                StaticJsonDocument<128> doc;
                doc["road"]      = ROAD_ID;
                doc["requested"] = true;
                char buf[128];
                serializeJson(doc, buf);
                mqttClient.publish(PUB_PED.c_str(), buf);
                
                // Handle based on current traffic light phase
                handlePedestrianRequest();
                
                // Wait for button release
                while(digitalRead(PED_BUTTON) == LOW) {
                    delay(10);
                }
            } else if (pedState == PED_WAITING) {
                Serial.println("🚶 Pedestrian already waiting...");
            } else if (pedState == PED_CROSSING) {
                Serial.println("🚶 Pedestrian already crossing...");
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PIEZO SENSOR - HEAVY VEHICLE DETECTION
// ─────────────────────────────────────────────────────────────────────────────
void updatePiezoSensor() {
    int piezoValue = analogRead(PIEZO_PIN);
    
    // Detect heavy vehicle (vibration/shock)
    // Threshold can be adjusted based on testing
    bool currentHeavyVehicle = (piezoValue > 400);
    
    if (currentHeavyVehicle && !heavyVehicleDetected) {
        // New heavy vehicle detected
        heavyVehicleDetected = true;
        heavyVehicleDetectTime = millis();
        Serial.print("🚛🚛 HEAVY VEHICLE DETECTED! Value: ");
        Serial.print(piezoValue);
        Serial.println(" - Adding +5s to next GREEN phase");
        
        // Update timings immediately
        updateTimings();
        
        // Notify server
        StaticJsonDocument<128> doc;
        doc["road"]         = ROAD_ID;
        doc["piezoValue"]   = piezoValue;
        doc["heavyVehicle"] = true;
        char buf[128];
        serializeJson(doc, buf);
        mqttClient.publish(PUB_PIEZO.c_str(), buf);
        
    } else if (!currentHeavyVehicle && heavyVehicleDetected) {
        // Vehicle passed, but keep heavyVehicleDetected true until next cycle
        // It will be reset when GREEN phase starts
        Serial.println("🚛 Heavy vehicle passed - bonus will apply to current cycle");
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
    bool hasVehicle = (dist < 5000 && dist <= 400);
    
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
// IR SENSORS
// ─────────────────────────────────────────────────────────────────────────────
void publishIR() {
    if (millis() - lastIRPublish < 1000) return;
    lastIRPublish = millis();
    
    bool newIr1 = (digitalRead(IR_SENSOR_1) == LOW);
    bool newIr2 = (digitalRead(IR_SENSOR_2) == LOW);
    
    if (newIr1 != ir1Blocked || newIr2 != ir2Blocked) {
        ir1Blocked = newIr1;
        ir2Blocked = newIr2;
        updateTimings();
    }
    
    String queueLevel = "None";
    if (ir1Blocked && ir2Blocked) queueLevel = "Heavy";
    else if (ir1Blocked || ir2Blocked) queueLevel = "Light";
    
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
// RAIN SENSOR
// ─────────────────────────────────────────────────────────────────────────────
void publishRain() {
    if (millis() - lastRainPublish < 2000) return;
    lastRainPublish = millis();
    
    bool newRain = (digitalRead(RAIN_PIN) == LOW);
    
    if (newRain != rainDetected) {
        rainDetected = newRain;
        updateTimings();
        
        if (rainDetected) {
            Serial.println("🌧️🌧️ RAIN DETECTED — Yellow extended to 5s");
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
// MQTT CALLBACK (Force Override)
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
    
    Serial.println("📩 FORCE CMD: " + signal + " green=" + String(greenTime) + "s");
    
    if (signal == "GREEN") {
        currentTrafficPhase = TRAFFIC_GREEN;
        phaseEndMs = millis() + (greenTime * 1000UL);
        setTrafficLight(TRAFFIC_GREEN);
        publishState("GREEN");
        Serial.println("🟢 FORCE GREEN for " + String(greenTime) + "s");
        
    } else if (signal == "YELLOW") {
        currentTrafficPhase = TRAFFIC_YELLOW;
        phaseEndMs = millis() + (yellowTime * 1000UL);
        setTrafficLight(TRAFFIC_YELLOW);
        publishState("YELLOW");
        Serial.println("🟡 FORCE YELLOW for " + String(yellowTime) + "s");
        
    } else if (signal == "RED") {
        currentTrafficPhase = TRAFFIC_RED;
        setTrafficLight(TRAFFIC_RED);
        publishState("RED");
        Serial.println("🔴 FORCE RED");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// WiFi + MQTT CONNECTION
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
    Serial.println("═══════════════════════════════════════════════════════════");
    Serial.println("TIMING CONFIGURATION:");
    Serial.println("  RED:   3s (fixed)");
    Serial.println("  YELLOW: 3s base + 2s when raining = 5s");
    Serial.println("  GREEN:  3s base + traffic bonus + heavy vehicle bonus");
    Serial.println("    - Light Traffic (1 IR): +3s = 6s total");
    Serial.println("    - Heavy Traffic (2 IR): +6s = 9s total");
    Serial.println("    - Heavy Vehicle: +5s additional");
    Serial.println("  PEDESTRIAN:");
    Serial.println("    - Crossing time: 3s fixed");
    Serial.println("    - Button during RED: Immediate crossing");
    Serial.println("    - Button during YELLOW: Shows countdown, then crossing");
    Serial.println("    - Button during GREEN: Waits for cycle to complete");
    Serial.println("═══════════════════════════════════════════════════════════\n");
    
    // Output pins
    pinMode(TRIG_PIN,      OUTPUT);
    pinMode(RED_LED,       OUTPUT);
    pinMode(YELLOW_LED,    OUTPUT);
    pinMode(GREEN_LED,     OUTPUT);
    pinMode(PED_RED_LED,   OUTPUT);
    pinMode(PED_GREEN_LED, OUTPUT);
    
    // Input pins
    pinMode(ECHO_PIN,      INPUT);
    pinMode(IR_SENSOR_1,   INPUT_PULLUP);
    pinMode(IR_SENSOR_2,   INPUT_PULLUP);
    pinMode(PIEZO_PIN,     INPUT);
    pinMode(RAIN_PIN,      INPUT_PULLUP);
    pinMode(PED_BUTTON,    INPUT_PULLUP);
    
    // Safe start state
    setTrafficLight(TRAFFIC_RED);
    setPedestrianLight(false);
    
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
    currentTrafficPhase = TRAFFIC_RED;
    phaseEndMs = millis() + currentRedTime;
    setTrafficLight(TRAFFIC_RED);
    publishState("RED");
    Serial.println("🔴 Starting with RED for " + String(currentRedTime / 1000) + "s");
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN LOOP
// ─────────────────────────────────────────────────────────────────────────────
void loop() {
    // Keep MQTT alive
    if (!mqttClient.connected()) connectMQTT();
    mqttClient.loop();
    
    // Update traffic light phase
    updateTrafficLight();
    
    // Update pedestrian crossing timer
    updatePedestrianCrossing();
    
    // Check pedestrian button
    checkPedestrianButton();
    
    // Update piezo sensor for heavy vehicle detection
    updatePiezoSensor();
    
    // Publish all sensor data
    publishUltrasonic();
    publishIR();
    publishRain();
    
    // Publish piezo periodically (but heavy vehicle detection already publishes on detection)
    if (millis() - lastPiezoPublish > 5000) {
        lastPiezoPublish = millis();
        StaticJsonDocument<128> doc;
        doc["road"]         = ROAD_ID;
        doc["piezoValue"]   = analogRead(PIEZO_PIN);
        doc["heavyVehicle"] = heavyVehicleDetected;
        char buf[128];
        serializeJson(doc, buf);
        mqttClient.publish(PUB_PIEZO.c_str(), buf);
    }
}