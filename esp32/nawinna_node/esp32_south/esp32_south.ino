// ═══════════════════════════════════════════════
// HYDRA v10.1 — SOUTH NODE (Rain Sensor Fixed)
// Fixed: rain sensor inversion, INPUT_PULLUP removed
// Fixed: US2 crosstalk (echo settle wait + 60ms inter-sensor gap)
// ═══════════════════════════════════════════════

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ── Identity ────────────────────────────────────
const char* ROAD_ID     = "South";
//const char* WIFI_SSID   = "SLT-4G_166D59";
//const char* WIFI_PASS   = "F58EA0CF";
const char* WIFI_SSID   = "Dialog 4G 940";
const char* WIFI_PASS   = "Robbin123@hood";
const char* MQTT_SERVER = "56.228.30.50";
const int   MQTT_PORT   = 1883;

// ── Pins ────────────────────────────────────────
#define US1_TRIG      5
#define US1_ECHO      18
#define US2_TRIG      32
#define US2_ECHO      33
#define RED_LED       26
#define YELLOW_LED    27
#define GREEN_LED     14
#define RAIN_PIN      17
#define PED_BUTTON    25
#define PED_RED_LED   4
#define PED_GREEN_LED 19
#define SEG_A  2
#define SEG_B  15
#define SEG_C  12
#define SEG_D  13
#define SEG_E  22
#define SEG_F  23
#define SEG_G  21

// ── Constants ───────────────────────────────────
#define ROAD_WIDTH_CM   10.0f
#define STABLE_MS       2000UL
#define US_MEASURE_MS   200UL
#define MAX_DIST_CM     50.0f
#define BASE_GREEN_MS   3000UL
#define BASE_YELLOW_MS  3000UL
#define RAIN_EXTRA_MS   2000UL
#define PED_CROSS_S     3
#define SERVER_TIMEOUT  30000UL

// ── MQTT Topics ─────────────────────────────────
String PUB_US, PUB_RAIN_LOCAL, PUB_RAIN_ALL;
String PUB_PED, PUB_STATE, SUB_CONTROL;

WiFiClient   wifiClient;
PubSubClient mqtt(wifiClient);

// ── Traffic Light State ─────────────────────────
enum Phase { RED_PHASE, YELLOW_PHASE, GREEN_PHASE };
Phase         currentPhase     = RED_PHASE;
unsigned long phaseEndMs       = 0;
unsigned long lastServerCmdMs  = 0;
bool          serverControlled = false;
unsigned long currentGreenMs   = BASE_GREEN_MS;
unsigned long currentYellowMs  = BASE_YELLOW_MS;
unsigned long currentRedMs     = BASE_GREEN_MS + BASE_YELLOW_MS;

// ── Ultrasonic State ────────────────────────────
struct USState {
    float         lastRaw      = 999.0f;
    bool          stable       = false;
    unsigned long blockedSince = 0;
    unsigned long lastMeasMs   = 0;
};
USState us1, us2;

// ── Other Sensors ───────────────────────────────
bool          rainDetected = false;
bool          pedRequested = false;
bool          pedCrossing  = false;
unsigned long pedStartMs   = 0;
unsigned long lastUSPubMs  = 0;
unsigned long lastRainMs   = 0;

// ── 7-Segment ───────────────────────────────────
const int  SEG_PINS[7] = {SEG_A,SEG_B,SEG_C,SEG_D,SEG_E,SEG_F,SEG_G};
const byte DIGITS[10]  = {
    0b1111110, 0b0110000, 0b1101101, 0b1111001, 0b0110011,
    0b1011011, 0b1011111, 0b1110000, 0b1111111, 0b1111011
};

void clearSeg() {
    for(int i=0; i<7; i++) digitalWrite(SEG_PINS[i], LOW);
}

void showDigit(int n) {
    if(n < 1 || n > 9) { clearSeg(); return; }
    byte p = DIGITS[n];
    for(int i=0; i<7; i++)
        digitalWrite(SEG_PINS[i], (p >> (6-i)) & 1 ? HIGH : LOW);
}

// ── Countdown ───────────────────────────────────
struct CD {
    bool          active = false;
    int           rem    = 0;
    unsigned long nextMs = 0;
} countdown;

void startCountdown(int s) {
    countdown.active = true;
    countdown.rem    = s;
    countdown.nextMs = millis();
    showDigit(s);
    Serial.printf("⏱️  Countdown started: %ds\n", s);
}

void updateCountdown() {
    if(!countdown.active) return;
    if(millis() >= countdown.nextMs) {
        countdown.rem--;
        countdown.nextMs = millis() + 1000UL;
        if(countdown.rem <= 0) {
            countdown.active = false;
            clearSeg();
            Serial.println("⏱️  Countdown finished");
        } else {
            showDigit(countdown.rem);
            Serial.printf("⏱️  Countdown: %d\n", countdown.rem);
        }
    }
}

// ── Traffic Light Control ───────────────────────
void setLight(Phase p) {
    digitalWrite(RED_LED,    LOW);
    digitalWrite(YELLOW_LED, LOW);
    digitalWrite(GREEN_LED,  LOW);
    delay(30);
    if(p == RED_PHASE)    digitalWrite(RED_LED,    HIGH);
    if(p == YELLOW_PHASE) digitalWrite(YELLOW_LED, HIGH);
    if(p == GREEN_PHASE)  digitalWrite(GREEN_LED,  HIGH);

    const char* name = p==GREEN_PHASE ? "GREEN" :
                       p==YELLOW_PHASE? "YELLOW": "RED";
    Serial.printf("\n🚦 [%s] Light → %s\n", ROAD_ID, name);
}

void publishState(const char* s) {
    StaticJsonDocument<128> d;
    d["road"]  = ROAD_ID;
    d["state"] = s;
    char b[128];
    serializeJson(d, b);
    mqtt.publish(PUB_STATE.c_str(), b, true);
}

// ── Ultrasonic Measurement ──────────────────────
float measureUS(int trig, int echo) {
    // FIX: wait for the echo line to settle LOW before triggering.
    // Prevents reading a leftover pulse from the other sensor.
    unsigned long wait = micros();
    while(digitalRead(echo) == HIGH) {
        if(micros() - wait > 25000UL) break;
    }

    digitalWrite(trig, LOW);  delayMicroseconds(5);
    digitalWrite(trig, HIGH); delayMicroseconds(10);
    digitalWrite(trig, LOW);
    long dur = pulseIn(echo, HIGH, 20000UL);
    if(dur == 0) return MAX_DIST_CM + 1.0f;
    return (dur * 0.034f) / 2.0f;
}

bool updateUS(USState &st, int trig, int echo, const char* name) {
    unsigned long now = millis();
    if(now - st.lastMeasMs < US_MEASURE_MS) return st.stable;
    st.lastMeasMs = now;

    float dist    = measureUS(trig, echo);
    st.lastRaw    = dist;
    bool blocked  = (dist < ROAD_WIDTH_CM && dist > 0.5f);

    if(blocked) {
        if(st.blockedSince == 0) st.blockedSince = now;
        if(!st.stable && (now - st.blockedSince >= STABLE_MS)) {
            st.stable = true;
            Serial.printf("📡 [%s] %s CONFIRMED STABLE (%.1fcm)\n",
                ROAD_ID, name, dist);
        }
    } else {
        if(st.stable)
            Serial.printf("📡 [%s] %s CLEARED\n", ROAD_ID, name);
        st.blockedSince = 0;
        st.stable       = false;
    }
    return st.stable;
}

// ── Publish Ultrasonic ──────────────────────────
void publishUS() {
    if(millis() - lastUSPubMs < 500) return;
    lastUSPubMs = millis();

    bool s1 = updateUS(us1, US1_TRIG, US1_ECHO, "US1");
    delay(60);                                   // FIX: let US1's burst die out
    bool s2 = updateUS(us2, US2_TRIG, US2_ECHO, "US2");

    String ql = "None";
    if(s1 && s2) ql = "Heavy";
    else if(s1)  ql = "Light";

    Serial.printf("📡 [%s] US1=%s(%.1fcm) US2=%s(%.1fcm) Queue=%s\n",
        ROAD_ID,
        s1?"STABLE":"clear", us1.lastRaw,
        s2?"STABLE":"clear", us2.lastRaw,
        ql.c_str());

    StaticJsonDocument<200> doc;
    doc["road"]       = ROAD_ID;
    doc["us1Stable"]  = s1;
    doc["us2Stable"]  = s2;
    doc["us1Raw"]     = (int)us1.lastRaw;
    doc["us2Raw"]     = (int)us2.lastRaw;
    doc["queueLevel"] = ql;
    doc["timestamp"]  = millis();
    char buf[200];
    serializeJson(doc, buf);
    mqtt.publish(PUB_US.c_str(), buf);
}

// ── Publish Rain (FIXED) ────────────────────────
void publishRain() {
    if(millis() - lastRainMs < 2000) return;
    lastRainMs = millis();

    // FIX: HIGH = rain detected, LOW = dry
    bool nr = (digitalRead(RAIN_PIN) == HIGH);

    if(nr != rainDetected) {
        rainDetected = nr;
        Serial.printf("🌧️  [%s] Rain: %s → Yellow now %ds\n",
            ROAD_ID,
            rainDetected ? "RAINING" : "DRY",
            rainDetected ? 5 : 3);
    }

    StaticJsonDocument<128> doc;
    doc["road"]         = ROAD_ID;
    doc["rainDetected"] = rainDetected;
    doc["yellowTime"]   = rainDetected ? 5 : 3;
    char buf[128];
    serializeJson(doc, buf);
    mqtt.publish(PUB_RAIN_LOCAL.c_str(), buf);
    mqtt.publish(PUB_RAIN_ALL.c_str(),   buf, true);
}

// ── Yellow Time ─────────────────────────────────
unsigned long calcYellow() {
    return BASE_YELLOW_MS + (rainDetected ? RAIN_EXTRA_MS : 0);
}

// ── Pedestrian Logic ────────────────────────────
void startPedCross() {
    pedCrossing  = true;
    pedRequested = false;
    pedStartMs   = millis();
    digitalWrite(PED_RED_LED,   LOW);
    digitalWrite(PED_GREEN_LED, HIGH);
    startCountdown(PED_CROSS_S);
    Serial.printf("🚶 [%s] CROSSING STARTED — %ds\n", ROAD_ID, PED_CROSS_S);

    StaticJsonDocument<128> d;
    d["road"]     = ROAD_ID;
    d["crossing"] = true;
    d["duration"] = PED_CROSS_S;
    char b[128]; serializeJson(d, b);
    mqtt.publish(PUB_PED.c_str(), b);
}

void endPedCross() {
    pedCrossing  = false;
    pedRequested = false;
    digitalWrite(PED_GREEN_LED, LOW);
    digitalWrite(PED_RED_LED,   HIGH);
    clearSeg();
    Serial.printf("🚶 [%s] CROSSING ENDED\n", ROAD_ID);

    StaticJsonDocument<128> d;
    d["road"]     = ROAD_ID;
    d["crossing"] = false;
    d["duration"] = 0;
    char b[128]; serializeJson(d, b);
    mqtt.publish(PUB_PED.c_str(), b);
}

void updatePedCrossing() {
    if(!pedCrossing) return;
    updateCountdown();
    if(millis() - pedStartMs >= (PED_CROSS_S * 1000UL)) {
        endPedCross();
    }
}

void checkPedButton() {
    if(pedCrossing)  return;
    if(digitalRead(PED_BUTTON) != LOW) return;
    delay(50);
    if(digitalRead(PED_BUTTON) != LOW) return;
    if(pedRequested) return;

    Serial.printf("🚶 [%s] BUTTON PRESSED during %s\n",
        ROAD_ID,
        currentPhase==GREEN_PHASE  ? "GREEN"  :
        currentPhase==YELLOW_PHASE ? "YELLOW" : "RED");

    // Case A: During RED
    if(currentPhase == RED_PHASE) {
        unsigned long remaining = (phaseEndMs > millis())
                                ? phaseEndMs - millis() : 0;
        if(remaining > 3000UL) {
            Serial.printf("🚶 [%s] Case A: Cross now (%lus remaining)\n",
                ROAD_ID, remaining/1000);
            startPedCross();
        } else {
            pedRequested = true;
            Serial.printf("🚶 [%s] Case A: Not enough time — wait next RED\n",
                ROAD_ID);
            StaticJsonDocument<128> d;
            d["road"]      = ROAD_ID;
            d["requested"] = true;
            char b[128]; serializeJson(d, b);
            mqtt.publish(PUB_PED.c_str(), b);
        }
    }
    // Case B: During YELLOW before GREEN (pre-green yellow)
    else if(currentPhase == YELLOW_PHASE && !serverControlled) {
        pedRequested = true;
        Serial.printf("🚶 [%s] Case B: Pre-GREEN yellow — not safe, wait\n",
            ROAD_ID);
        StaticJsonDocument<128> d;
        d["road"]      = ROAD_ID;
        d["requested"] = true;
        char b[128]; serializeJson(d, b);
        mqtt.publish(PUB_PED.c_str(), b);
    }
    // Case C: During GREEN
    else if(currentPhase == GREEN_PHASE) {
        pedRequested = true;
        Serial.printf("🚶 [%s] Case C: GREEN active — wait for RED\n",
            ROAD_ID);
        StaticJsonDocument<128> d;
        d["road"]      = ROAD_ID;
        d["requested"] = true;
        char b[128]; serializeJson(d, b);
        mqtt.publish(PUB_PED.c_str(), b);
    }
    // Case D: During post-GREEN YELLOW
    else if(currentPhase == YELLOW_PHASE && serverControlled) {
        pedRequested = true;
        unsigned long rem    = (phaseEndMs > millis())
                             ? phaseEndMs - millis() : 0;
        int           remSec = (int)(rem / 1000) + 1;
        if(remSec > 0) startCountdown(remSec);
        Serial.printf("🚶 [%s] Case D: Post-GREEN yellow — countdown %ds\n",
            ROAD_ID, remSec);
        StaticJsonDocument<128> d;
        d["road"]      = ROAD_ID;
        d["requested"] = true;
        char b[128]; serializeJson(d, b);
        mqtt.publish(PUB_PED.c_str(), b);
    }
}

// ── Phase State Machine ─────────────────────────
void updatePhase() {
    if(pedCrossing) return;
    if(millis() < phaseEndMs) return;

    switch(currentPhase) {

        case GREEN_PHASE:
            currentYellowMs = calcYellow();
            currentPhase    = YELLOW_PHASE;
            phaseEndMs      = millis() + currentYellowMs;
            setLight(YELLOW_PHASE);
            publishState("YELLOW");
            Serial.printf("🟡 [%s] GREEN→YELLOW (%.1fs)\n",
                ROAD_ID, currentYellowMs/1000.0);
            if(pedRequested) {
                int remSec = (int)(currentYellowMs / 1000);
                startCountdown(remSec);
                Serial.printf("🚶 [%s] Case D: Countdown %ds\n",
                    ROAD_ID, remSec);
            }
            break;

        case YELLOW_PHASE:
            if(pedRequested && !pedCrossing) {
                currentPhase = RED_PHASE;
                phaseEndMs   = millis() + (PED_CROSS_S * 1000UL) + 2000UL;
                setLight(RED_PHASE);
                publishState("RED");
                startPedCross();
            } else {
                currentPhase     = RED_PHASE;
                bool alive       = (millis() - lastServerCmdMs < SERVER_TIMEOUT);
                phaseEndMs       = millis() + (alive ? 60000UL : currentRedMs);
                serverControlled = false;
                setLight(RED_PHASE);
                publishState("RED");
                Serial.printf("🔴 [%s] YELLOW→RED\n", ROAD_ID);
            }
            break;

        case RED_PHASE:
            if(millis() - lastServerCmdMs >= SERVER_TIMEOUT) {
                currentGreenMs  = BASE_GREEN_MS;
                currentYellowMs = calcYellow();
                currentPhase    = GREEN_PHASE;
                phaseEndMs      = millis() + currentGreenMs;
                setLight(GREEN_PHASE);
                publishState("GREEN");
                Serial.printf("🟢 [%s] FALLBACK GREEN (3s)\n", ROAD_ID);
            } else {
                phaseEndMs = millis() + 2000UL;
            }
            break;
    }
}

// ── MQTT Callback ───────────────────────────────
void mqttCallback(char* topic, byte* payload, unsigned int len) {
    String msg = "";
    for(unsigned int i=0; i<len; i++) msg += (char)payload[i];
    String t = String(topic);

    // Rain broadcast
    if(t == "traffic/rain/all") {
        StaticJsonDocument<128> d;
        if(!deserializeJson(d, msg)) {
            bool nr = d["rainDetected"] | false;
            if(nr != rainDetected) {
                rainDetected = nr;
                Serial.printf("🌧️  Rain update received: %s\n",
                    rainDetected ? "RAIN" : "DRY");
            }
        }
        return;
    }

    // Pedestrian commands from server
    String pedTopic = "traffic/pedestrian/cmd/" + String(ROAD_ID);
    if(t == pedTopic) {
        StaticJsonDocument<128> d;
        if(!deserializeJson(d, msg)) {
            String action = d["action"] | "";
            if(action == "START_CROSSING") startPedCross();
            else if(action == "END_CROSSING") endPedCross();
        }
        return;
    }

    // Traffic control from server
    StaticJsonDocument<256> doc;
    if(deserializeJson(doc, msg)) return;

    String signal  = doc["signal"]     | "RED";
    int    greenS  = doc["greenTime"]  | 3;
    int    yellowS = doc["yellowTime"] | 3;
    int    redS    = doc["redTime"]    | 0;

    lastServerCmdMs  = millis();
    serverControlled = true;

    Serial.println("\n════════════════════════════════════");
    Serial.printf("  ROAD   : %s\n",   ROAD_ID);
    Serial.printf("  SIGNAL : %s\n",   signal.c_str());
    Serial.printf("  GREEN  : %ds\n",  greenS);
    Serial.printf("  YELLOW : %ds\n",  yellowS);
    Serial.printf("  RED    : %ds\n",  redS>0 ? redS : greenS+yellowS);
    Serial.printf("  US1    : %s (%.1fcm)\n",
        us1.stable?"STABLE":"clear", us1.lastRaw);
    Serial.printf("  US2    : %s (%.1fcm)\n",
        us2.stable?"STABLE":"clear", us2.lastRaw);
    Serial.printf("  QUEUE  : %s\n",
        (us1.stable&&us2.stable)?"HEAVY":us1.stable?"LIGHT":"NONE");
    Serial.printf("  RAIN   : %s\n",   rainDetected?"YES":"NO");
    Serial.println("════════════════════════════════════\n");

    if(pedCrossing) {
        Serial.println("⚠️  Pedestrian crossing — ignoring signal");
        return;
    }

    if(signal == "GREEN") {
        currentGreenMs  = (unsigned long)greenS  * 1000UL;
        currentYellowMs = (unsigned long)yellowS * 1000UL;
        currentRedMs    = redS > 0
                        ? (unsigned long)redS * 1000UL
                        : currentGreenMs + currentYellowMs;
        currentPhase = GREEN_PHASE;
        phaseEndMs   = millis() + currentGreenMs;
        setLight(GREEN_PHASE);
        publishState("GREEN");
        Serial.printf("🟢 [%s] GREEN for %ds\n", ROAD_ID, greenS);

    } else if(signal == "YELLOW") {
        currentYellowMs = (unsigned long)yellowS * 1000UL;
        currentPhase    = YELLOW_PHASE;
        phaseEndMs      = millis() + currentYellowMs;
        setLight(YELLOW_PHASE);
        publishState("YELLOW");
        Serial.printf("🟡 [%s] YELLOW for %ds\n", ROAD_ID, yellowS);

    } else if(signal == "RED") {
        currentRedMs = redS > 0
                     ? (unsigned long)redS * 1000UL
                     : BASE_YELLOW_MS;
        currentPhase = RED_PHASE;
        phaseEndMs   = millis() + currentRedMs;
        setLight(RED_PHASE);
        publishState("RED");
        Serial.printf("🔴 [%s] RED for %ds\n",
            ROAD_ID, redS>0 ? redS : 3);
    }
}

// ── WiFi ────────────────────────────────────────
void connectWiFi() {
    Serial.printf("\n📶 Connecting to %s...\n", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    int t = 0;
    while(WiFi.status() != WL_CONNECTED && t < 40) {
        delay(500); Serial.print("."); t++;
    }
    if(WiFi.status() == WL_CONNECTED)
        Serial.printf("\n✅ WiFi: %s\n",
            WiFi.localIP().toString().c_str());
    else
        Serial.println("\n❌ WiFi FAILED");
}

// ── MQTT ────────────────────────────────────────
void connectMQTT() {
    String cid = "HYDRA-" + String(ROAD_ID) + "-" +
                 String(random(0xffff), HEX);
    if(mqtt.connect(cid.c_str())) {
        mqtt.subscribe(SUB_CONTROL.c_str());
        mqtt.subscribe("traffic/rain/all");
        String pedCmd = "traffic/pedestrian/cmd/" + String(ROAD_ID);
        mqtt.subscribe(pedCmd.c_str());
        Serial.printf("✅ MQTT connected. Sub: %s\n",
            SUB_CONTROL.c_str());
    } else {
        Serial.printf("❌ MQTT failed rc=%d\n", mqtt.state());
    }
}

// ── Setup ───────────────────────────────────────
void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n╔══════════════════════════════════╗");
    Serial.println("║  HYDRA v10.1 — NORTH NODE        ║");
    Serial.println("║  Rain sensor FIXED               ║");
    Serial.println("╚══════════════════════════════════╝");

    pinMode(US1_TRIG,      OUTPUT);
    pinMode(US1_ECHO,      INPUT);
    pinMode(US2_TRIG,      OUTPUT);
    pinMode(US2_ECHO,      INPUT);
    pinMode(RED_LED,       OUTPUT);
    pinMode(YELLOW_LED,    OUTPUT);
    pinMode(GREEN_LED,     OUTPUT);
    pinMode(PED_RED_LED,   OUTPUT);
    pinMode(PED_GREEN_LED, OUTPUT);
    for(int i=0; i<7; i++) pinMode(SEG_PINS[i], OUTPUT);

    // FIX: INPUT only — sensor has its own pull-up
    pinMode(RAIN_PIN,   INPUT);
    pinMode(PED_BUTTON, INPUT_PULLUP);

    // Initial states
    setLight(RED_PHASE);
    digitalWrite(PED_RED_LED,   HIGH);
    digitalWrite(PED_GREEN_LED, LOW);
    clearSeg();

    // FIX: HIGH = rain detected
    rainDetected = (digitalRead(RAIN_PIN) == HIGH);
    Serial.printf("🌧️  Initial rain state: %s\n",
        rainDetected ? "RAINING" : "DRY");

    // MQTT topics
    PUB_US         = "traffic/us/"         + String(ROAD_ID);
    PUB_RAIN_LOCAL = "traffic/rain/"       + String(ROAD_ID);
    PUB_RAIN_ALL   = "traffic/rain/all";
    PUB_PED        = "traffic/pedestrian/" + String(ROAD_ID);
    PUB_STATE      = "traffic/state/"      + String(ROAD_ID);
    SUB_CONTROL    = "traffic/control/"    + String(ROAD_ID);

    connectWiFi();
    mqtt.setServer(MQTT_SERVER, MQTT_PORT);
    mqtt.setCallback(mqttCallback);
    connectMQTT();

    currentPhase     = RED_PHASE;
    phaseEndMs       = millis() + SERVER_TIMEOUT;
    serverControlled = false;
    lastServerCmdMs  = millis();

    Serial.println("🔴 Waiting for server...\n");
}

// ── Loop ────────────────────────────────────────
void loop() {
    if(WiFi.status() != WL_CONNECTED) connectWiFi();
    if(!mqtt.connected()) connectMQTT();
    mqtt.loop();

    updatePhase();
    updatePedCrossing();
    checkPedButton();
    publishUS();
    publishRain();
}