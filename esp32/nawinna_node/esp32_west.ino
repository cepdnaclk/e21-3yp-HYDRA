// // ═══════════════════════════════════════════════════════════════════════════
// // HYDRA — ESP32 WEST ROAD NODE
// // Nawinna Junction, Kurunegala
// //
// // HARDWARE ON THIS ESP32:
// //   - Ultrasonic Sensor HC-SR04
// //   - IR Sensor 1 (0–5cm zone)
// //   - IR Sensor 2 (5–10cm zone)
// //   - Piezo Vibration Sensor (analog)
// //   - NO Rain Sensor here  ← receives rain data from North ESP32 via MQTT
// //   - Pedestrian Push Button
// //   - Pedestrian RED LED + GREEN LED
// //   - 7-Segment Display (common cathode)
// //   - Traffic Light Module (RED / YELLOW / GREEN)
// //
// // NEXT INTERSECTION FOR GOOGLE TRAFFIC:
// //   West road leads to → Puwakgashandiya Junction direction (west side)
// //
// // PIN ASSIGNMENTS (same safe defaults as other nodes):
// //   TRIG=5, ECHO=18, RED=26, YELLOW=27, GREEN=14
// //   IR1=34, IR2=35, PIEZO=32
// //   PED_BTN=25, PED_RED=19, PED_GRN=21
// //   SEG: A=2,B=15,C=16,D=17,E=22,F=23,G=4
// // ═══════════════════════════════════════════════════════════════════════════

// #include <WiFi.h>
// #include <PubSubClient.h>
// #include <ArduinoJson.h>

// const char* ROAD_ID     = "West";
// const char* WIFI_SSID   = "SLT-4G_166D59";
// const char* WIFI_PASS   = "F58EA0CF";
// const char* MQTT_SERVER = "56.228.30.50";
// const int   MQTT_PORT   = 1883;

// #define TRIG_PIN        5
// #define ECHO_PIN        18
// #define RED_LED         26
// #define YELLOW_LED      27
// #define GREEN_LED       14
// #define IR_SENSOR_1     34
// #define IR_SENSOR_2     35
// #define PIEZO_PIN       32
// #define PED_BUTTON      25
// #define PED_RED_LED     19
// #define PED_GREEN_LED   21
// #define SEG_A  2
// #define SEG_B  15
// #define SEG_C  16
// #define SEG_D  17
// #define SEG_E  22
// #define SEG_F  23
// #define SEG_G  4

// #define BASE_GREEN_MS        3000UL
// #define BASE_YELLOW_MS       3000UL
// #define BASE_RED_MS          3000UL
// #define LIGHT_TRAFFIC_BONUS  3000UL
// #define HEAVY_TRAFFIC_BONUS  6000UL
// #define PIEZO_BONUS          5000UL
// #define RAIN_YELLOW_EXTRA    2000UL
// #define PED_CROSS_TIME_S     10
// #define SERVER_TIMEOUT_MS    30000UL

// String PUB_ULTRASONIC, PUB_IR, PUB_PIEZO, PUB_PED, PUB_STATE, SUB_CONTROL;
// const char* SUB_RAIN_ALL = "traffic/rain/all";

// WiFiClient   wifiClient;
// PubSubClient mqttClient(wifiClient);

// enum LightPhase { PHASE_RED, PHASE_YELLOW, PHASE_GREEN };
// LightPhase    currentPhase     = PHASE_RED;
// unsigned long phaseEndMs       = 0;
// unsigned long lastServerCmdMs  = 0;
// bool          serverControlled = false;

// unsigned long currentGreenMs  = BASE_GREEN_MS;
// unsigned long currentYellowMs = BASE_YELLOW_MS;
// unsigned long currentRedMs    = BASE_RED_MS;

// bool ir1Blocked = false, ir2Blocked = false;
// bool rainDetected = false;
// bool heavyVehicle = false;
// bool pedRequested = false, pedCrossing = false;
// unsigned long pedStartMs = 0;

// unsigned long lastUltrasonicMs = 0, lastIRMs = 0, lastPiezoMs = 0;

// // ── 7-SEGMENT ─────────────────────────────────────────────────────────────────
// const int SEG_PINS[7] = { SEG_A,SEG_B,SEG_C,SEG_D,SEG_E,SEG_F,SEG_G };
// const byte DIGIT_PATTERNS[10] = {
//     0b1111110,0b0110000,0b1101101,0b1111001,0b0110011,
//     0b1011011,0b1011111,0b1110000,0b1111111,0b1111011
// };
// void clearDisplay(){ for(int i=0;i<7;i++) digitalWrite(SEG_PINS[i],LOW); }
// void displayDigit(int n){
//     if(n<0||n>9){clearDisplay();return;}
//     byte p=DIGIT_PATTERNS[n];
//     for(int i=0;i<7;i++) digitalWrite(SEG_PINS[i],(p>>(6-i))&1?HIGH:LOW);
// }
// struct CountdownState{ bool active=false;int remaining=0;unsigned long nextTickMs=0; } pedCD;
// void startPedCountdown(int s){ pedCD.active=true;pedCD.remaining=s;pedCD.nextTickMs=millis();displayDigit(s>9?9:s); }
// void updatePedCountdown(){
//     if(!pedCD.active)return;
//     if(millis()>=pedCD.nextTickMs){
//         pedCD.remaining--; pedCD.nextTickMs=millis()+1000UL;
//         if(pedCD.remaining<=0){pedCD.active=false;clearDisplay();}
//         else displayDigit(pedCD.remaining>9?9:pedCD.remaining);
//     }
// }

// // ── TRAFFIC LIGHT ─────────────────────────────────────────────────────────────
// void setLight(LightPhase p){
//     digitalWrite(RED_LED,LOW);digitalWrite(YELLOW_LED,LOW);digitalWrite(GREEN_LED,LOW);delay(30);
//     if(p==PHASE_RED)    digitalWrite(RED_LED,HIGH);
//     if(p==PHASE_YELLOW) digitalWrite(YELLOW_LED,HIGH);
//     if(p==PHASE_GREEN)  digitalWrite(GREEN_LED,HIGH);
// }
// void publishState(const char* s){
//     StaticJsonDocument<128> d; d["road"]=ROAD_ID; d["state"]=s;
//     char b[128]; serializeJson(d,b);
//     mqttClient.publish(PUB_STATE.c_str(),b,true);
//     Serial.printf("💡 LED → %s\n",s);
// }

// // ── LOCAL TIMING ──────────────────────────────────────────────────────────────
// unsigned long calcLocalGreenMs(){
//     bool b1=(digitalRead(IR_SENSOR_1)==LOW),b2=(digitalRead(IR_SENSOR_2)==LOW);
//     bool pv=(analogRead(PIEZO_PIN)>500);
//     unsigned long g=BASE_GREEN_MS;
//     if(b1&&b2){g+=HEAVY_TRAFFIC_BONUS;if(pv)g+=PIEZO_BONUS;}
//     else if(b1)g+=LIGHT_TRAFFIC_BONUS;
//     return g;
// }
// unsigned long calcLocalYellowMs(){ return BASE_YELLOW_MS+(rainDetected?RAIN_YELLOW_EXTRA:0); }

// // ── PEDESTRIAN ────────────────────────────────────────────────────────────────
// void startPedestrianCrossing(){
//     Serial.println("🚶 PEDESTRIAN CROSSING");
//     pedCrossing=true; pedRequested=false;
//     currentPhase=PHASE_RED; phaseEndMs=millis()+(PED_CROSS_TIME_S*1000UL);
//     setLight(PHASE_RED); publishState("RED");
//     digitalWrite(PED_RED_LED,LOW); digitalWrite(PED_GREEN_LED,HIGH);
//     startPedCountdown(PED_CROSS_TIME_S);
//     StaticJsonDocument<128> d; d["road"]=ROAD_ID; d["crossing"]=true; d["duration"]=PED_CROSS_TIME_S;
//     char b[128]; serializeJson(d,b); mqttClient.publish(PUB_PED.c_str(),b);
//     pedStartMs=millis();
// }
// void updatePedestrianCrossing(){
//     if(!pedCrossing)return;
//     updatePedCountdown();
//     if(millis()-pedStartMs<(PED_CROSS_TIME_S*1000UL))return;
//     pedCrossing=false;
//     digitalWrite(PED_GREEN_LED,LOW); digitalWrite(PED_RED_LED,HIGH); clearDisplay();
//     StaticJsonDocument<128> d; d["road"]=ROAD_ID; d["crossing"]=false; d["duration"]=PED_CROSS_TIME_S;
//     char b[128]; serializeJson(d,b); mqttClient.publish(PUB_PED.c_str(),b);
//     Serial.println("✅ Ped crossing done");
//     currentYellowMs=calcLocalYellowMs();
//     currentPhase=PHASE_YELLOW; phaseEndMs=millis()+currentYellowMs;
//     setLight(PHASE_YELLOW); publishState("YELLOW");
// }
// void checkPedestrianButton(){
//     if(pedCrossing||pedRequested)return;
//     if(digitalRead(PED_BUTTON)!=LOW)return;
//     delay(50); if(digitalRead(PED_BUTTON)!=LOW)return;
//     pedRequested=true;
//     StaticJsonDocument<128> d; d["road"]=ROAD_ID; d["requested"]=true;
//     char b[128]; serializeJson(d,b); mqttClient.publish(PUB_PED.c_str(),b);
//     Serial.printf("🚶 Btn: %s\n",currentPhase==PHASE_RED?"RED (immediate)":currentPhase==PHASE_YELLOW?"YELLOW":"GREEN (wait)");
//     if(currentPhase==PHASE_RED) startPedestrianCrossing();
// }

// // ── LIGHT STATE MACHINE ───────────────────────────────────────────────────────
// void updateLightPhase(){
//     if(pedCrossing)return;
//     if(millis()<phaseEndMs)return;
//     switch(currentPhase){
//         case PHASE_GREEN:
//             currentYellowMs=serverControlled?currentYellowMs:calcLocalYellowMs();
//             currentPhase=PHASE_YELLOW; phaseEndMs=millis()+currentYellowMs;
//             setLight(PHASE_YELLOW); publishState("YELLOW");
//             Serial.printf("🟡 YELLOW %.1fs\n",currentYellowMs/1000.0);
//             break;
//         case PHASE_YELLOW:
//             if(pedRequested&&!pedCrossing){ startPedestrianCrossing(); }
//             else{
//                 currentPhase=PHASE_RED;
//                 bool alive=(millis()-lastServerCmdMs<SERVER_TIMEOUT_MS);
//                 phaseEndMs=millis()+(alive?60000UL:currentRedMs);
//                 setLight(PHASE_RED); publishState("RED"); Serial.println("🔴 RED");
//                 serverControlled=false;
//             }
//             break;
//         case PHASE_RED:
//             if(millis()-lastServerCmdMs>=SERVER_TIMEOUT_MS){
//                 currentGreenMs=calcLocalGreenMs(); currentYellowMs=calcLocalYellowMs();
//                 currentPhase=PHASE_GREEN; phaseEndMs=millis()+currentGreenMs;
//                 setLight(PHASE_GREEN); publishState("GREEN");
//                 Serial.printf("🟢 [FALLBACK] GREEN %.1fs\n",currentGreenMs/1000.0);
//             } else { phaseEndMs=millis()+2000UL; }
//             break;
//     }
// }

// // ── MQTT CALLBACK ─────────────────────────────────────────────────────────────
// void mqttCallback(char* topic, byte* payload, unsigned int length){
//     String msg="";
//     for(unsigned int i=0;i<length;i++) msg+=(char)payload[i];

//     if(String(topic)==String(SUB_RAIN_ALL)){
//         StaticJsonDocument<128> d;
//         if(!deserializeJson(d,msg)){
//             bool nr=d["rainDetected"]|false;
//             if(nr!=rainDetected){ rainDetected=nr; Serial.printf("🌧️ Rain: %s\n",rainDetected?"RAIN":"DRY"); }
//         }
//         return;
//     }

//     StaticJsonDocument<256> doc;
//     if(deserializeJson(doc,msg)){Serial.println("❌ JSON error");return;}
//     String sig=doc["signal"].as<String>();
//     int gs=doc["greenTime"]|5, ys=doc["yellowTime"]|3, rs=doc["redTime"]|0;
//     lastServerCmdMs=millis(); serverControlled=true;

//     Serial.println("════════════════════════════════════════");
//     Serial.printf("  Road: %s | Signal: %s\n",ROAD_ID,sig.c_str());
//     Serial.printf("  Green:%ds  Yellow:%ds  Red:%ds\n",gs,ys,rs>0?rs:gs+ys);
//     Serial.printf("  IR1:%s  IR2:%s  Rain:%s  Heavy:%s\n",
//         ir1Blocked?"BLK":"CLR",ir2Blocked?"BLK":"CLR",
//         rainDetected?"YES":"NO",heavyVehicle?"YES":"NO");
//     Serial.println("════════════════════════════════════════");

//     if(pedCrossing){Serial.println("⚠️  Ped crossing active — ignoring");return;}

//     if(sig=="GREEN"){
//         currentGreenMs=(unsigned long)gs*1000UL;
//         currentYellowMs=(unsigned long)ys*1000UL;
//         currentRedMs=rs>0?(unsigned long)rs*1000UL:currentGreenMs+currentYellowMs;
//         currentPhase=PHASE_GREEN; phaseEndMs=millis()+currentGreenMs;
//         setLight(PHASE_GREEN); publishState("GREEN"); Serial.printf("🟢 GREEN %ds\n",gs);
//     } else if(sig=="YELLOW"){
//         currentYellowMs=(unsigned long)ys*1000UL;
//         currentPhase=PHASE_YELLOW; phaseEndMs=millis()+currentYellowMs;
//         setLight(PHASE_YELLOW); publishState("YELLOW"); Serial.printf("🟡 YELLOW %ds\n",ys);
//     } else if(sig=="RED"){
//         currentRedMs=rs>0?(unsigned long)rs*1000UL:BASE_RED_MS;
//         currentPhase=PHASE_RED; phaseEndMs=millis()+currentRedMs;
//         setLight(PHASE_RED); publishState("RED"); Serial.printf("🔴 RED %ds\n",rs>0?rs:3);
//     }
// }

// // ── SENSOR PUBLISHING ─────────────────────────────────────────────────────────
// float measureDistance(){
//     digitalWrite(TRIG_PIN,LOW); delayMicroseconds(2);
//     digitalWrite(TRIG_PIN,HIGH); delayMicroseconds(10); digitalWrite(TRIG_PIN,LOW);
//     long dur=pulseIn(ECHO_PIN,HIGH,30000UL);
//     if(dur==0)return 5000.0f;
//     return(dur*0.034f)/2.0f;
// }
// void publishUltrasonic(){
//     if(millis()-lastUltrasonicMs<500)return; lastUltrasonicMs=millis();
//     float d=measureDistance(); bool hv=(d<5000.0f&&d<=400.0f);
//     StaticJsonDocument<128> doc;
//     doc["road"]=ROAD_ID; doc["distanceCm"]=d; doc["vehicleNearby"]=hv; doc["timestamp"]=millis();
//     char buf[128]; serializeJson(doc,buf); mqttClient.publish(PUB_ULTRASONIC.c_str(),buf);
//     if(hv)Serial.printf("📡 %.1fcm\n",d); else Serial.println("📡 No vehicle");
// }
// void publishIR(){
//     if(millis()-lastIRMs<1000)return; lastIRMs=millis();
//     bool n1=(digitalRead(IR_SENSOR_1)==LOW),n2=(digitalRead(IR_SENSOR_2)==LOW);
//     if(n1!=ir1Blocked||n2!=ir2Blocked){
//         ir1Blocked=n1; ir2Blocked=n2;
//         Serial.printf("🔦 IR1:%s IR2:%s\n",ir1Blocked?"BLK":"CLR",ir2Blocked?"BLK":"CLR");
//     }
//     String ql="None";
//     if(ir1Blocked&&ir2Blocked)ql="Heavy"; else if(ir1Blocked)ql="Light";
//     StaticJsonDocument<128> doc;
//     doc["road"]=ROAD_ID; doc["ir1Blocked"]=ir1Blocked; doc["ir2Blocked"]=ir2Blocked; doc["queueLevel"]=ql;
//     char buf[128]; serializeJson(doc,buf); mqttClient.publish(PUB_IR.c_str(),buf);
// }
// void publishPiezo(){
//     if(millis()-lastPiezoMs<1000)return; lastPiezoMs=millis();
//     int pz=analogRead(PIEZO_PIN); bool pv=(pz>500);
//     if(pv!=heavyVehicle){ heavyVehicle=pv; if(pv)Serial.printf("🚛 Heavy! val=%d\n",pz); }
//     StaticJsonDocument<128> doc;
//     doc["road"]=ROAD_ID; doc["piezoValue"]=pz; doc["heavyVehicle"]=pv;
//     char buf[128]; serializeJson(doc,buf); mqttClient.publish(PUB_PIEZO.c_str(),buf);
// }

// // ── WIFI / MQTT ───────────────────────────────────────────────────────────────
// void connectWiFi(){
//     Serial.printf("\n📶 WiFi: %s\n",WIFI_SSID);
//     WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID,WIFI_PASS);
//     int t=0; while(WiFi.status()!=WL_CONNECTED&&t<40){delay(500);Serial.print(".");t++;}
//     if(WiFi.status()==WL_CONNECTED)Serial.printf("\n✅ IP: %s\n",WiFi.localIP().toString().c_str());
//     else Serial.println("\n❌ WiFi FAILED");
// }
// void connectMQTT(){
//     String cid=String("HYDRA-")+ROAD_ID+"-"+String(random(0xffff),HEX);
//     if(mqttClient.connect(cid.c_str())){
//         mqttClient.subscribe(SUB_CONTROL.c_str());
//         mqttClient.subscribe(SUB_RAIN_ALL);
//         Serial.printf("✅ MQTT OK. Sub: %s + rain/all\n",SUB_CONTROL.c_str());
//     } else { Serial.printf("❌ MQTT fail rc=%d\n",mqttClient.state()); }
// }

// // ── SETUP ─────────────────────────────────────────────────────────────────────
// void setup(){
//     Serial.begin(115200); delay(500);
//     Serial.println("\n╔════════════════════════════════════════════════╗");
//     Serial.println("║  HYDRA — WEST ROAD NODE                        ║");
//     Serial.println("║  Nawinna Junction, Kurunegala                  ║");
//     Serial.println("║  Google traffic: Puwakgashandiya west side     ║");
//     Serial.println("╚════════════════════════════════════════════════╝");

//     pinMode(TRIG_PIN,OUTPUT);
//     pinMode(RED_LED,OUTPUT); pinMode(YELLOW_LED,OUTPUT); pinMode(GREEN_LED,OUTPUT);
//     pinMode(PED_RED_LED,OUTPUT); pinMode(PED_GREEN_LED,OUTPUT);
//     for(int i=0;i<7;i++) pinMode(SEG_PINS[i],OUTPUT);
//     pinMode(ECHO_PIN,INPUT);
//     pinMode(IR_SENSOR_1,INPUT);  // external 10kΩ pullup to 3.3V
//     pinMode(IR_SENSOR_2,INPUT);  // external 10kΩ pullup to 3.3V
//     pinMode(PIEZO_PIN,INPUT);
//     pinMode(PED_BUTTON,INPUT_PULLUP);

//     setLight(PHASE_RED);
//     digitalWrite(PED_RED_LED,HIGH); digitalWrite(PED_GREEN_LED,LOW);
//     clearDisplay();

//     ir1Blocked=(digitalRead(IR_SENSOR_1)==LOW);
//     ir2Blocked=(digitalRead(IR_SENSOR_2)==LOW);
//     heavyVehicle=(analogRead(PIEZO_PIN)>500);
//     rainDetected=false;

//     PUB_ULTRASONIC=String("traffic/ultrasonic/")+ROAD_ID;
//     PUB_IR        =String("traffic/ir/")+ROAD_ID;
//     PUB_PIEZO     =String("traffic/piezo/")+ROAD_ID;
//     PUB_PED       =String("traffic/pedestrian/")+ROAD_ID;
//     PUB_STATE     =String("traffic/state/")+ROAD_ID;
//     SUB_CONTROL   =String("traffic/control/")+ROAD_ID;

//     connectWiFi();
//     mqttClient.setServer(MQTT_SERVER,MQTT_PORT);
//     mqttClient.setCallback(mqttCallback);
//     connectMQTT();

//     currentPhase=PHASE_RED; phaseEndMs=millis()+SERVER_TIMEOUT_MS;
//     serverControlled=false; lastServerCmdMs=millis();
//     setLight(PHASE_RED); publishState("RED");
//     Serial.println("\n🔴 RED — waiting for server...\n");
// }

// // ── LOOP ──────────────────────────────────────────────────────────────────────
// void loop(){
//     if(WiFi.status()!=WL_CONNECTED){Serial.println("📶 Reconnecting...");connectWiFi();}
//     if(!mqttClient.connected())connectMQTT();
//     mqttClient.loop();
//     updateLightPhase();
//     updatePedestrianCrossing();
//     checkPedestrianButton();
//     publishUltrasonic();
//     publishIR();
//     publishPiezo();
// }



// ═══════════════════════════════════════════════════════════════════════════
// HYDRA — ESP32 WEST ROAD NODE
// Nawinna Junction, Kurunegala
//
// HARDWARE ON THIS ESP32:
//   - Ultrasonic Sensor HC-SR04
//   - IR Sensor 1 (0–5cm zone)
//   - IR Sensor 2 (5–10cm zone)
//   - Piezo Vibration Sensor (analog)
//   - NO Rain Sensor here  ← receives rain data from North ESP32 via MQTT
//   - Pedestrian Push Button
//   - Pedestrian RED LED + GREEN LED
//   - 7-Segment Display (common cathode)
//   - Traffic Light Module (RED / YELLOW / GREEN)
//
// NEXT INTERSECTION FOR GOOGLE TRAFFIC:
//   West road leads to → Puwakgashandiya Junction direction (west side)
//
// PIN ASSIGNMENTS (same safe defaults as other nodes):
//   TRIG=5, ECHO=18, RED=26, YELLOW=27, GREEN=14
//   IR1=34, IR2=35, PIEZO=32
//   PED_BTN=25, PED_RED=19, PED_GRN=21
//   SEG: A=2,B=15,C=12,D=13,E=22,F=23,G=4
// ═══════════════════════════════════════════════════════════════════════════

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

const char* ROAD_ID     = "West";
const char* WIFI_SSID   = "SLT-4G_166D59";
const char* WIFI_PASS   = "F58EA0CF";
const char* MQTT_SERVER = "56.228.30.50";
const int   MQTT_PORT   = 1883;

#define TRIG_PIN        5
#define ECHO_PIN        18
#define RED_LED         26
#define YELLOW_LED      27
#define GREEN_LED       14
#define IR_SENSOR_1     34
#define IR_SENSOR_2     35
#define PIEZO_PIN       32
#define PED_BUTTON      25
#define PED_RED_LED     19
#define PED_GREEN_LED   21
#define SEG_A  2
#define SEG_B  15
#define SEG_C  12
#define SEG_D  13
#define SEG_E  22
#define SEG_F  23
#define SEG_G  4

#define BASE_GREEN_MS        3000UL
#define BASE_YELLOW_MS       3000UL
#define BASE_RED_MS          3000UL
#define LIGHT_TRAFFIC_BONUS  3000UL
#define HEAVY_TRAFFIC_BONUS  6000UL
#define PIEZO_BONUS          5000UL
#define RAIN_YELLOW_EXTRA    2000UL
#define PED_CROSS_TIME_S     10
#define SERVER_TIMEOUT_MS    30000UL

String PUB_ULTRASONIC, PUB_IR, PUB_PIEZO, PUB_PED, PUB_STATE, SUB_CONTROL;
const char* SUB_RAIN_ALL = "traffic/rain/all";

WiFiClient   wifiClient;
PubSubClient mqttClient(wifiClient);

enum LightPhase { PHASE_RED, PHASE_YELLOW, PHASE_GREEN };
LightPhase    currentPhase     = PHASE_RED;
unsigned long phaseEndMs       = 0;
unsigned long lastServerCmdMs  = 0;
bool          serverControlled = false;

unsigned long currentGreenMs  = BASE_GREEN_MS;
unsigned long currentYellowMs = BASE_YELLOW_MS;
unsigned long currentRedMs    = BASE_RED_MS;

bool ir1Blocked = false, ir2Blocked = false;
bool rainDetected = false;
bool heavyVehicle = false;
bool pedRequested = false, pedCrossing = false;
unsigned long pedStartMs = 0;

unsigned long lastUltrasonicMs = 0, lastIRMs = 0, lastPiezoMs = 0;

// ── 7-SEGMENT ─────────────────────────────────────────────────────────────────
const int SEG_PINS[7] = { SEG_A,SEG_B,SEG_C,SEG_D,SEG_E,SEG_F,SEG_G };
const byte DIGIT_PATTERNS[10] = {
    0b1111110,0b0110000,0b1101101,0b1111001,0b0110011,
    0b1011011,0b1011111,0b1110000,0b1111111,0b1111011
};
void clearDisplay(){ for(int i=0;i<7;i++) digitalWrite(SEG_PINS[i],LOW); }
void displayDigit(int n){
    if(n<0||n>9){clearDisplay();return;}
    byte p=DIGIT_PATTERNS[n];
    for(int i=0;i<7;i++) digitalWrite(SEG_PINS[i],(p>>(6-i))&1?HIGH:LOW);
}
struct CountdownState{ bool active=false;int remaining=0;unsigned long nextTickMs=0; } pedCD;
void startPedCountdown(int s){ pedCD.active=true;pedCD.remaining=s;pedCD.nextTickMs=millis();displayDigit(s>9?9:s); }
void updatePedCountdown(){
    if(!pedCD.active)return;
    if(millis()>=pedCD.nextTickMs){
        pedCD.remaining--; pedCD.nextTickMs=millis()+1000UL;
        if(pedCD.remaining<=0){pedCD.active=false;clearDisplay();}
        else displayDigit(pedCD.remaining>9?9:pedCD.remaining);
    }
}

// ── TRAFFIC LIGHT ─────────────────────────────────────────────────────────────
void setLight(LightPhase p){
    digitalWrite(RED_LED,LOW);digitalWrite(YELLOW_LED,LOW);digitalWrite(GREEN_LED,LOW);delay(30);
    if(p==PHASE_RED)    digitalWrite(RED_LED,HIGH);
    if(p==PHASE_YELLOW) digitalWrite(YELLOW_LED,HIGH);
    if(p==PHASE_GREEN)  digitalWrite(GREEN_LED,HIGH);
}
void publishState(const char* s){
    StaticJsonDocument<128> d; d["road"]=ROAD_ID; d["state"]=s;
    char b[128]; serializeJson(d,b);
    mqttClient.publish(PUB_STATE.c_str(),b,true);
    Serial.printf("💡 LED → %s\n",s);
}

// ── LOCAL TIMING ──────────────────────────────────────────────────────────────
unsigned long calcLocalGreenMs(){
    bool b1=(digitalRead(IR_SENSOR_1)==LOW),b2=(digitalRead(IR_SENSOR_2)==LOW);
    bool pv=(analogRead(PIEZO_PIN)>500);
    unsigned long g=BASE_GREEN_MS;
    if(b1&&b2){g+=HEAVY_TRAFFIC_BONUS;if(pv)g+=PIEZO_BONUS;}
    else if(b1)g+=LIGHT_TRAFFIC_BONUS;
    return g;
}
unsigned long calcLocalYellowMs(){ return BASE_YELLOW_MS+(rainDetected?RAIN_YELLOW_EXTRA:0); }

// ── PEDESTRIAN ────────────────────────────────────────────────────────────────
void startPedestrianCrossing(){
    Serial.println("🚶 PEDESTRIAN CROSSING");
    pedCrossing=true; pedRequested=false;
    currentPhase=PHASE_RED; phaseEndMs=millis()+(PED_CROSS_TIME_S*1000UL);
    setLight(PHASE_RED); publishState("RED");
    digitalWrite(PED_RED_LED,LOW); digitalWrite(PED_GREEN_LED,HIGH);
    startPedCountdown(PED_CROSS_TIME_S);
    StaticJsonDocument<128> d; d["road"]=ROAD_ID; d["crossing"]=true; d["duration"]=PED_CROSS_TIME_S;
    char b[128]; serializeJson(d,b); mqttClient.publish(PUB_PED.c_str(),b);
    pedStartMs=millis();
}
void updatePedestrianCrossing(){
    if(!pedCrossing)return;
    updatePedCountdown();
    if(millis()-pedStartMs<(PED_CROSS_TIME_S*1000UL))return;
    pedCrossing=false;
    digitalWrite(PED_GREEN_LED,LOW); digitalWrite(PED_RED_LED,HIGH); clearDisplay();
    StaticJsonDocument<128> d; d["road"]=ROAD_ID; d["crossing"]=false; d["duration"]=PED_CROSS_TIME_S;
    char b[128]; serializeJson(d,b); mqttClient.publish(PUB_PED.c_str(),b);
    Serial.println("✅ Ped crossing done");
    currentYellowMs=calcLocalYellowMs();
    currentPhase=PHASE_YELLOW; phaseEndMs=millis()+currentYellowMs;
    setLight(PHASE_YELLOW); publishState("YELLOW");
}
void checkPedestrianButton(){
    if(pedCrossing||pedRequested)return;
    if(digitalRead(PED_BUTTON)!=LOW)return;
    delay(50); if(digitalRead(PED_BUTTON)!=LOW)return;
    pedRequested=true;
    StaticJsonDocument<128> d; d["road"]=ROAD_ID; d["requested"]=true;
    char b[128]; serializeJson(d,b); mqttClient.publish(PUB_PED.c_str(),b);
    Serial.printf("🚶 Btn: %s\n",currentPhase==PHASE_RED?"RED (immediate)":currentPhase==PHASE_YELLOW?"YELLOW":"GREEN (wait)");
    if(currentPhase==PHASE_RED) startPedestrianCrossing();
}

// ── LIGHT STATE MACHINE ───────────────────────────────────────────────────────
void updateLightPhase(){
    if(pedCrossing)return;
    if(millis()<phaseEndMs)return;
    switch(currentPhase){
        case PHASE_GREEN:
            currentYellowMs=serverControlled?currentYellowMs:calcLocalYellowMs();
            currentPhase=PHASE_YELLOW; phaseEndMs=millis()+currentYellowMs;
            setLight(PHASE_YELLOW); publishState("YELLOW");
            Serial.printf("🟡 YELLOW %.1fs\n",currentYellowMs/1000.0);
            break;
        case PHASE_YELLOW:
            if(pedRequested&&!pedCrossing){ startPedestrianCrossing(); }
            else{
                currentPhase=PHASE_RED;
                bool alive=(millis()-lastServerCmdMs<SERVER_TIMEOUT_MS);
                phaseEndMs=millis()+(alive?60000UL:currentRedMs);
                setLight(PHASE_RED); publishState("RED"); Serial.println("🔴 RED");
                serverControlled=false;
            }
            break;
        case PHASE_RED:
            if(millis()-lastServerCmdMs>=SERVER_TIMEOUT_MS){
                currentGreenMs=calcLocalGreenMs(); currentYellowMs=calcLocalYellowMs();
                currentPhase=PHASE_GREEN; phaseEndMs=millis()+currentGreenMs;
                setLight(PHASE_GREEN); publishState("GREEN");
                Serial.printf("🟢 [FALLBACK] GREEN %.1fs\n",currentGreenMs/1000.0);
            } else { phaseEndMs=millis()+2000UL; }
            break;
    }
}

// ── MQTT CALLBACK ─────────────────────────────────────────────────────────────
void mqttCallback(char* topic, byte* payload, unsigned int length){
    String msg="";
    for(unsigned int i=0;i<length;i++) msg+=(char)payload[i];

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

    if(String(topic)==String(SUB_RAIN_ALL)){
        StaticJsonDocument<128> d;
        if(!deserializeJson(d,msg)){
            bool nr=d["rainDetected"]|false;
            if(nr!=rainDetected){ rainDetected=nr; Serial.printf("🌧️ Rain: %s\n",rainDetected?"RAIN":"DRY"); }
        }
        return;
    }

    StaticJsonDocument<256> doc;
    if(deserializeJson(doc,msg)){Serial.println("❌ JSON error");return;}
    String sig=doc["signal"].as<String>();
    int gs=doc["greenTime"]|5, ys=doc["yellowTime"]|3, rs=doc["redTime"]|0;
    lastServerCmdMs=millis(); serverControlled=true;

    Serial.println("════════════════════════════════════════");
    Serial.printf("  Road: %s | Signal: %s\n",ROAD_ID,sig.c_str());
    Serial.printf("  Green:%ds  Yellow:%ds  Red:%ds\n",gs,ys,rs>0?rs:gs+ys);
    Serial.printf("  IR1:%s  IR2:%s  Rain:%s  Heavy:%s\n",
        ir1Blocked?"BLK":"CLR",ir2Blocked?"BLK":"CLR",
        rainDetected?"YES":"NO",heavyVehicle?"YES":"NO");
    Serial.println("════════════════════════════════════════");

    if(pedCrossing){Serial.println("⚠️  Ped crossing active — ignoring");return;}

    if(sig=="GREEN"){
        currentGreenMs=(unsigned long)gs*1000UL;
        currentYellowMs=(unsigned long)ys*1000UL;
        currentRedMs=rs>0?(unsigned long)rs*1000UL:currentGreenMs+currentYellowMs;
        currentPhase=PHASE_GREEN; phaseEndMs=millis()+currentGreenMs;
        setLight(PHASE_GREEN); publishState("GREEN"); Serial.printf("🟢 GREEN %ds\n",gs);
    } else if(sig=="YELLOW"){
        currentYellowMs=(unsigned long)ys*1000UL;
        currentPhase=PHASE_YELLOW; phaseEndMs=millis()+currentYellowMs;
        setLight(PHASE_YELLOW); publishState("YELLOW"); Serial.printf("🟡 YELLOW %ds\n",ys);
    } else if(sig=="RED"){
        currentRedMs=rs>0?(unsigned long)rs*1000UL:BASE_RED_MS;
        currentPhase=PHASE_RED; phaseEndMs=millis()+currentRedMs;
        setLight(PHASE_RED); publishState("RED"); Serial.printf("🔴 RED %ds\n",rs>0?rs:3);
    }
}

// ── SENSOR PUBLISHING ─────────────────────────────────────────────────────────
float measureDistance(){
    digitalWrite(TRIG_PIN,LOW); delayMicroseconds(2);
    digitalWrite(TRIG_PIN,HIGH); delayMicroseconds(10); digitalWrite(TRIG_PIN,LOW);
    long dur=pulseIn(ECHO_PIN,HIGH,30000UL);
    if(dur==0)return 5000.0f;
    return(dur*0.034f)/2.0f;
}
void publishUltrasonic(){
    if(millis()-lastUltrasonicMs<500)return; lastUltrasonicMs=millis();
    float d=measureDistance(); bool hv=(d<5000.0f&&d<=400.0f);
    StaticJsonDocument<128> doc;
    doc["road"]=ROAD_ID; doc["distanceCm"]=d; doc["vehicleNearby"]=hv; doc["timestamp"]=millis();
    char buf[128]; serializeJson(doc,buf); mqttClient.publish(PUB_ULTRASONIC.c_str(),buf);
    if(hv)Serial.printf("📡 %.1fcm\n",d); else Serial.println("📡 No vehicle");
}
void publishIR(){
    if(millis()-lastIRMs<1000)return; lastIRMs=millis();
    bool n1=(digitalRead(IR_SENSOR_1)==LOW),n2=(digitalRead(IR_SENSOR_2)==LOW);
    if(n1!=ir1Blocked||n2!=ir2Blocked){
        ir1Blocked=n1; ir2Blocked=n2;
        Serial.printf("🔦 IR1:%s IR2:%s\n",ir1Blocked?"BLK":"CLR",ir2Blocked?"BLK":"CLR");
    }
    String ql="None";
    if(ir1Blocked&&ir2Blocked)ql="Heavy"; else if(ir1Blocked)ql="Light";
    StaticJsonDocument<128> doc;
    doc["road"]=ROAD_ID; doc["ir1Blocked"]=ir1Blocked; doc["ir2Blocked"]=ir2Blocked; doc["queueLevel"]=ql;
    char buf[128]; serializeJson(doc,buf); mqttClient.publish(PUB_IR.c_str(),buf);
}
void publishPiezo(){
    if(millis()-lastPiezoMs<1000)return; lastPiezoMs=millis();
    int pz=analogRead(PIEZO_PIN); bool pv=(pz>500);
    if(pv!=heavyVehicle){ heavyVehicle=pv; if(pv)Serial.printf("🚛 Heavy! val=%d\n",pz); }
    StaticJsonDocument<128> doc;
    doc["road"]=ROAD_ID; doc["piezoValue"]=pz; doc["heavyVehicle"]=pv;
    char buf[128]; serializeJson(doc,buf); mqttClient.publish(PUB_PIEZO.c_str(),buf);
}

// ── WIFI / MQTT ───────────────────────────────────────────────────────────────
void connectWiFi(){
    Serial.printf("\n📶 WiFi: %s\n",WIFI_SSID);
    WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID,WIFI_PASS);
    int t=0; while(WiFi.status()!=WL_CONNECTED&&t<40){delay(500);Serial.print(".");t++;}
    if(WiFi.status()==WL_CONNECTED)Serial.printf("\n✅ IP: %s\n",WiFi.localIP().toString().c_str());
    else Serial.println("\n❌ WiFi FAILED");
}
void connectMQTT(){
    String cid=String("HYDRA-")+ROAD_ID+"-"+String(random(0xffff),HEX);
    if(mqttClient.connect(cid.c_str())){
        mqttClient.subscribe(SUB_CONTROL.c_str());
        mqttClient.subscribe(SUB_RAIN_ALL);
        // ── Add pedestrian command subscription ─────────────────────────────
        String pedCmdTopic = String("traffic/pedestrian/cmd/") + ROAD_ID;
        mqttClient.subscribe(pedCmdTopic.c_str());
        Serial.printf("✅ MQTT OK. Sub: %s + rain/all\n",SUB_CONTROL.c_str());
        Serial.printf("✅ Also subscribed to ped cmd topic: %s\n", pedCmdTopic.c_str());
    } else { Serial.printf("❌ MQTT fail rc=%d\n",mqttClient.state()); }
}

// ── SETUP ─────────────────────────────────────────────────────────────────────
void setup(){
    Serial.begin(115200); delay(500);
    Serial.println("\n╔════════════════════════════════════════════════╗");
    Serial.println("║  HYDRA — WEST ROAD NODE                        ║");
    Serial.println("║  Nawinna Junction, Kurunegala                  ║");
    Serial.println("║  Google traffic: Puwakgashandiya west side     ║");
    Serial.println("╚════════════════════════════════════════════════╝");

    pinMode(TRIG_PIN,OUTPUT);
    pinMode(RED_LED,OUTPUT); pinMode(YELLOW_LED,OUTPUT); pinMode(GREEN_LED,OUTPUT);
    pinMode(PED_RED_LED,OUTPUT); pinMode(PED_GREEN_LED,OUTPUT);
    for(int i=0;i<7;i++) pinMode(SEG_PINS[i],OUTPUT);
    pinMode(ECHO_PIN,INPUT);
    pinMode(IR_SENSOR_1,INPUT);  // external 10kΩ pullup to 3.3V
    pinMode(IR_SENSOR_2,INPUT);  // external 10kΩ pullup to 3.3V
    pinMode(PIEZO_PIN,INPUT);
    pinMode(PED_BUTTON,INPUT_PULLUP);

    setLight(PHASE_RED);
    digitalWrite(PED_RED_LED,HIGH); digitalWrite(PED_GREEN_LED,LOW);
    clearDisplay();

    ir1Blocked=(digitalRead(IR_SENSOR_1)==LOW);
    ir2Blocked=(digitalRead(IR_SENSOR_2)==LOW);
    heavyVehicle=(analogRead(PIEZO_PIN)>500);
    rainDetected=false;

    PUB_ULTRASONIC=String("traffic/ultrasonic/")+ROAD_ID;
    PUB_IR        =String("traffic/ir/")+ROAD_ID;
    PUB_PIEZO     =String("traffic/piezo/")+ROAD_ID;
    PUB_PED       =String("traffic/pedestrian/")+ROAD_ID;
    PUB_STATE     =String("traffic/state/")+ROAD_ID;
    SUB_CONTROL   =String("traffic/control/")+ROAD_ID;

    connectWiFi();
    mqttClient.setServer(MQTT_SERVER,MQTT_PORT);
    mqttClient.setCallback(mqttCallback);
    connectMQTT();

    currentPhase=PHASE_RED; phaseEndMs=millis()+SERVER_TIMEOUT_MS;
    serverControlled=false; lastServerCmdMs=millis();
    setLight(PHASE_RED); publishState("RED");
    Serial.println("\n🔴 RED — waiting for server...\n");
}

// ── LOOP ──────────────────────────────────────────────────────────────────────
void loop(){
    if(WiFi.status()!=WL_CONNECTED){Serial.println("📶 Reconnecting...");connectWiFi();}
    if(!mqttClient.connected())connectMQTT();
    mqttClient.loop();
    updateLightPhase();
    updatePedestrianCrossing();
    checkPedestrianButton();
    publishUltrasonic();
    publishIR();
    publishPiezo();
}