// // ═══════════════════════════════════════════════════════════════════════════
// // server/index.js — HYDRA Smart Traffic Control System
// // MODIFIED: Dynamic RED time for non-priority roads = winner's GREEN + YELLOW
// // MODIFIED: Analytics integration added (Step 7)
// // PHASE 2: ESP32 Failure Detection + Synthetic Timing
// // PHASE 3: Fixed Traffic Light Sequence (RED→YELLOW→GREEN and GREEN→YELLOW→RED)
// // PHASE 4: Fixed Piezo (Heavy Vehicle) Logic
// // PHASE 5: Fixed Google Traffic Refresh Interval (15 min)
// // PHASE 6: Fixed Pedestrian Logic (v5.0 - Server-side countdown)
// // ═══════════════════════════════════════════════════════════════════════════

// require('dotenv').config();
// const express        = require('express');
// const cors           = require('cors');
// const mongoose       = require('mongoose');
// const aedes          = require('aedes')();
// const net            = require('net');
// const http           = require('http');
// const path           = require('path');
// const { Server }     = require('socket.io');

// const TrafficData    = require('./models/TrafficData');
// const UltrasonicData = require('./models/UltrasonicData');
// const { getAllTrafficConditions } = require('./services/googleTrafficService');
// const { makeSignalDecision } = require('./logic/signalDecision');
// const { saveAnalyticsRecord, getPeakHourAnalysis, getRoadPerformance, getLiveCongestionTrend, getSystemEfficiency } = require('./services/analyticsService');

// const app        = express();
// const httpServer = http.createServer(app);

// const io = new Server(httpServer, {
//     cors: { origin: '*', methods: ['GET', 'POST'] }
// });

// const PORT      = process.env.PORT      || 5000;
// const MQTT_PORT = parseInt(process.env.MQTT_PORT) || 1883;

// app.use(cors({ origin: '*' }));
// app.use(express.json());

// app.use(express.static(path.join(__dirname, '../client/build')));

// mongoose.connect(process.env.MONGODB_URI)
//     .then(() => console.log('✅  MongoDB Connected'))
//     .catch(err => console.error('❌  MongoDB Error:', err));

// // ════════════════════════════════════════════════════════════════════════════
// // SECTION 2: IN-MEMORY STATE
// // ════════════════════════════════════════════════════════════════════════════
// const ROADS = ['North', 'South', 'East', 'West'];

// let sensorData       = { North: 5000, South: 5000, East: 5000, West: 5000 };
// let googleTraffic    = { North: 'Unknown', South: 'Unknown', East: 'Unknown', West: 'Unknown' };
// let sensorWorking    = { North: false, South: false, East: false, West: false };
// let googleWorking    = false;
// let liveSignalState  = { North: 'RED', South: 'RED', East: 'RED', West: 'RED' };
// let liveCountdown    = { North: 0, South: 0, East: 0, West: 0 };
// let livePhase        = { North: 'RED', South: 'RED', East: 'RED', West: 'RED' };
// let latestDecision   = null;
// let forceOverride    = null;

// let currentWinner = null;
// let phaseTimer    = null;
// let currentPhase  = 'RED';

// let irData = {
//     North: { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' },
//     South: { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' },
//     East:  { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' },
//     West:  { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' }
// };

// let piezoData = { North: false, South: false, East: false, West: false };

// // PHASE 4.2: Heavy vehicle active tracking
// let heavyVehicleActive = { North: false, South: false, East: false, West: false };

// // Rain Sensor Data - 3s normal, 5s when raining
// let rainDetected = false;
// let yellowTime = 3;

// let pedStatus = {
//     North: { requested: false, crossing: false, duration: 0 },
//     South: { requested: false, crossing: false, duration: 0 },
//     East:  { requested: false, crossing: false, duration: 0 },
//     West:  { requested: false, crossing: false, duration: 0 }
// };

// // PHASE 6.1: Pedestrian phase tracker
// let pedPressedDuringPhase = {
//     North: null, South: null, East: null, West: null
// };

// // Pedestrian crossing timers for server-side countdown
// let pedCrossingTimers = {};

// let greenTime = { North: 3, South: 3, East: 3, West: 3 };

// // ── MODIFIED: redTime is now DYNAMIC per cycle, not fixed ────────────────────
// let redTime = 3; // Will be updated each cycle dynamically

// // PHASE 2.1: ESP32 health tracking — 20 minute timeout
// const ESP32_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
// let espLastSeen = { North: Date.now(), South: Date.now(), East: Date.now(), West: Date.now() };
// let espOnline   = { North: true, South: true, East: true, West: true };

// // ════════════════════════════════════════════════════════════════════════════
// // SECTION 3: MQTT BROKER SETUP
// // ════════════════════════════════════════════════════════════════════════════
// const mqttServer = net.createServer(aedes.handle);

// aedes.on('client', (client) => {
//     console.log(`🔌  ESP32 Connected: ${client ? client.id : 'Unknown'}`);
// });

// aedes.on('clientDisconnect', (client) => {
//     console.log(`📴  ESP32 Disconnected: ${client ? client.id : 'Unknown'}`);
// });

// // Pedestrian helper functions
// function _startPedCrossing(road, durationSec) {
//     if (pedStatus[road].crossing) return; // already crossing
    
//     const dur = durationSec || 3;
//     pedStatus[road].crossing  = true;
//     pedStatus[road].requested = false;
//     pedStatus[road].duration  = dur;
//     pedPressedDuringPhase[road] = null;
    
//     console.log(`🚶 [${road}] CROSSING STARTED — ${dur}s`);
    
//     // Tell ESP32 to show PED_GREEN with countdown
//     aedes.publish({
//         topic: `traffic/pedestrian/cmd/${road}`,
//         payload: Buffer.from(JSON.stringify({ action: 'START_CROSSING', duration: dur })),
//         qos: 1
//     }, () => {});
    
//     // Broadcast to dashboard — crossing started with duration
//     io.emit('pedestrianUpdate', { road, ...pedStatus[road],
//         action: 'CROSSING_STARTED', countdown: dur });
    
//     // Server-side countdown: update duration every second so dashboard shows it
//     let remaining = dur;
//     if (pedCrossingTimers[road]) clearInterval(pedCrossingTimers[road]);
    
//     pedCrossingTimers[road] = setInterval(() => {
//         remaining--;
//         pedStatus[road].duration = Math.max(0, remaining);
//         io.emit('pedestrianUpdate', { road, ...pedStatus[road], countdown: remaining });
        
//         if (remaining <= 0) {
//             clearInterval(pedCrossingTimers[road]);
//             pedCrossingTimers[road] = null;
//             _endPedCrossing(road);
//         }
//     }, 1000);
// }

// function _endPedCrossing(road) {
//     if (pedCrossingTimers[road]) {
//         clearInterval(pedCrossingTimers[road]);
//         pedCrossingTimers[road] = null;
//     }
    
//     pedStatus[road].crossing  = false;
//     pedStatus[road].requested = false;
//     pedStatus[road].duration  = 0;
//     pedPressedDuringPhase[road] = null;
    
//     console.log(`🚶 [${road}] CROSSING ENDED`);
    
//     // Tell ESP32 to end crossing
//     aedes.publish({
//         topic: `traffic/pedestrian/cmd/${road}`,
//         payload: Buffer.from(JSON.stringify({ action: 'END_CROSSING' })),
//         qos: 1
//     }, () => {});
    
//     io.emit('pedestrianUpdate', { road, ...pedStatus[road], action: 'CROSSING_ENDED' });
// }

// aedes.on('publish', async (packet, client) => {
//     if (!client) return;
//     const topic   = packet.topic;
//     const payload = packet.payload.toString();

//     // PHASE 2.2: Update ESP32 last-seen timestamp whenever any message arrives
//     const topicParts = topic.split('/');
//     if (topicParts.length >= 3 && ROADS.includes(topicParts[2])) {
//         const road = topicParts[2];
//         espLastSeen[road] = Date.now();
//         if (!espOnline[road]) {
//             espOnline[road] = true;
//             console.log(`✅ ESP32 [${road}] RECONNECTED`);
//             io.emit('espStatusUpdate', { road, online: true });
//         }
//     }

//     // ── Ultrasonic Data ──────────────────────────────────────────────────────
//     if (topic.startsWith('traffic/ultrasonic/')) {
//         try {
//             const data = JSON.parse(payload);
//             const road = topic.split('/')[2];
//             if (!ROADS.includes(road)) return;
            
//             sensorData[road] = data.distanceCm;
//             sensorWorking[road] = true;
            
//             await UltrasonicData.findOneAndUpdate(
//                 { road },
//                 { 
//                     road, 
//                     distanceCm: data.distanceCm, 
//                     vehicleDetected: data.distanceCm <= 400, 
//                     timestamp: new Date() 
//                 },
//                 { upsert: true, returnDocument: 'after' }
//             );
            
//             console.log(`📡 Ultrasonic [${road}]: ${data.distanceCm < 5000 ? data.distanceCm + 'cm' : 'No vehicle'}`);
//             io.emit('sensorUpdate', { road, distanceCm: data.distanceCm });
            
//         } catch (e) { 
//             console.error('⚠️ Ultrasonic parse error:', e.message); 
//         }
//     }

//     // ── IR Sensors Data ──────────────────────────────────────────────────────
//     if (topic.startsWith('traffic/ir/')) {
//         try {
//             const data = JSON.parse(payload);
//             const road = topic.split('/')[2];
//             if (!ROADS.includes(road)) return;
            
//             irData[road] = {
//                 ir1Blocked: data.ir1Blocked || false,
//                 ir2Blocked: data.ir2Blocked || false,
//                 queueLevel: data.queueLevel || 'None'
//             };
            
//             let trafficDensity = 'None';
//             if (data.ir1Blocked && data.ir2Blocked) {
//                 trafficDensity = 'Heavy';
//                 greenTime[road] = 9;
//             } else if (data.ir1Blocked || data.ir2Blocked) {
//                 trafficDensity = 'Light';
//                 greenTime[road] = 6;
//             } else {
//                 trafficDensity = 'None';
//                 greenTime[road] = 3;
//             }
            
//             console.log(`🔦 IR [${road}]: ${data.ir1Blocked ? 'BLOCKED' : 'CLEAR'} | ${data.ir2Blocked ? 'BLOCKED' : 'CLEAR'} → ${trafficDensity} Traffic (Green: ${greenTime[road]}s)`);
//             io.emit('irUpdate', { road, ir1Blocked: data.ir1Blocked, ir2Blocked: data.ir2Blocked, queueLevel: trafficDensity });
            
//         } catch (e) { 
//             console.error('⚠️ IR parse error:', e.message); 
//         }
//     }

//     // ── Piezo Sensor Data (PHASE 4.1 - Fixed Logic) ─────────────────────────────
//     if (topic.startsWith('traffic/piezo/')) {
//         try {
//             const data = JSON.parse(payload);
//             const road = topic.split('/')[2];
//             if (!ROADS.includes(road)) return;

//             const irRoad = irData[road] || { ir1Blocked: false, ir2Blocked: false };
//             // Heavy vehicle only counts if at least one IR is also blocked
//             const heavyConfirmed = data.heavyVehicle &&
//                                    (irRoad.ir1Blocked || irRoad.ir2Blocked);

//             piezoData[road] = heavyConfirmed;
//             heavyVehicleActive[road] = heavyConfirmed;

//             if (heavyConfirmed) {
//                 console.log(`🚛 HEAVY VEHICLE confirmed on ${road} (IR+Piezo)`);
//             }
//             io.emit('piezoUpdate', { road, heavyVehicle: heavyConfirmed, rawValue: data.piezoValue });
//             io.emit('heavyVehicleUpdate', { road, active: heavyConfirmed });

//         } catch (e) { 
//             console.error('⚠️ Piezo parse error:', e.message); 
//         }
//     }

//     // ── Rain Sensor Data ─────────────────────────────────────────────────────
//     if (topic.startsWith('traffic/rain/')) {
//         try {
//             const data = JSON.parse(payload);
//             rainDetected = data.rainDetected || false;
//             yellowTime = rainDetected ? 5 : 3;
            
//             console.log(`🌧️ Rain Sensor: ${rainDetected ? 'RAINING (Yellow: 5s = 3s + 2s)' : 'DRY (Yellow: 3s)'}`);
//             io.emit('rainUpdate', { rainDetected, yellowTime });
            
//         } catch (e) { 
//             console.error('⚠️ Rain parse error:', e.message); 
//         }
//     }

//     // ── Pedestrian Button Data (v5.0 - Fixed with server-side countdown) ──────
//     if (topic.startsWith('traffic/pedestrian/')) {
//         try {
//             const data = JSON.parse(payload);
//             const road = topic.split('/')[2];
//             if (!ROADS.includes(road)) return;

//             if (data.requested !== undefined && data.requested === true && !pedStatus[road].requested && !pedStatus[road].crossing) {
//                 pedStatus[road].requested = true;
//                 pedPressedDuringPhase[road] = livePhase[road];
//                 console.log(`🚶 Ped button [${road}] pressed during CAR_${livePhase[road]}`);

//                 // CASE A: Button pressed during CAR_RED
//                 if (livePhase[road] === 'RED') {
//                     const remaining = liveCountdown[road] || 0;
//                     if (remaining > 3) {
//                         // Start crossing immediately — 3 second crossing time
//                         _startPedCrossing(road, 3);
//                     } else {
//                         // Not enough time left in RED — pedestrian waits
//                         io.emit('pedestrianUpdate', { road, ...pedStatus[road],
//                             case: 'A_WAIT', action: 'WAIT_TOO_SHORT_RED' });
//                     }
//                 }
//                 // CASE B: Button pressed during YELLOW (coming BEFORE green — pre-green yellow)
//                 else if (livePhase[road] === 'YELLOW' && currentPhase === 'PRE_GREEN_YELLOW') {
//                     // Vehicles about to get GREEN — never allow crossing
//                     io.emit('pedestrianUpdate', { road, ...pedStatus[road],
//                         case: 'B', action: 'WAIT_YELLOW_UNSAFE' });
//                 }
//                 // CASE C: Button pressed during GREEN
//                 else if (livePhase[road] === 'GREEN') {
//                     io.emit('pedestrianUpdate', { road, ...pedStatus[road],
//                         case: 'C', action: 'WAIT_FOR_GREEN_END',
//                         yellowRemaining: liveCountdown[road] });
//                 }
//                 // CASE D: Button pressed during YELLOW (post-green yellow)
//                 else if (livePhase[road] === 'YELLOW') {
//                     const remaining = liveCountdown[road] || 0;
//                     // Show yellow countdown on 7-segment
//                     aedes.publish({
//                         topic: `traffic/pedestrian/cmd/${road}`,
//                         payload: Buffer.from(JSON.stringify({ action: 'SHOW_YELLOW_COUNTDOWN', duration: remaining })),
//                         qos: 1
//                     }, () => {});
//                     io.emit('pedestrianUpdate', { road, ...pedStatus[road],
//                         case: 'D', action: 'WAIT_YELLOW_THEN_CROSS', yellowRemaining: remaining });
//                 }
//             }

//             // ESP32 reports crossing started or finished
//             if (data.crossing !== undefined) {
//                 if (data.crossing === true && !pedStatus[road].crossing) {
//                     _startPedCrossing(road, data.duration || 3);
//                 } else if (data.crossing === false && pedStatus[road].crossing) {
//                     _endPedCrossing(road);
//                 }
//             }

//             io.emit('pedestrianUpdate', { road, ...pedStatus[road] });

//         } catch (e) {
//             console.error('⚠️ Pedestrian parse error:', e.message);
//         }
//     }

//     // ── LED State from ESP32 ─────────────────────────────────────────────────
//     if (topic.startsWith('traffic/state/')) {
//         try {
//             const data = JSON.parse(payload);
//             const road = topic.split('/')[2];
//             if (!ROADS.includes(road)) return;
            
//             liveSignalState[road] = data.state;
//             livePhase[road] = data.state;
            
//             console.log(`💡 LED State [${road}]: ${data.state}`);
//             io.emit('ledStateUpdate', { road, state: data.state });
            
//         } catch (e) { 
//             console.error('⚠️ State parse error:', e.message); 
//         }
//     }
// });

// // ════════════════════════════════════════════════════════════════════════════
// // SECTION 4: SIGNAL CYCLE ENGINE (PHASE 3 - Fixed Sequence)
// // ════════════════════════════════════════════════════════════════════════════

// // ── Send command to a road via MQTT ─────────────────────────────────────────
// function sendCommandToRoad(road, signal, greenDuration, yellowOverride, dynamicRedTime) {
//     const yt  = (yellowOverride !== undefined && yellowOverride > 0) ? yellowOverride : yellowTime;
//     const rt  = (dynamicRedTime !== undefined && dynamicRedTime > 0) ? dynamicRedTime : 0;

//     const msg = JSON.stringify({
//         signal,
//         greenTime:  greenDuration || 5,
//         yellowTime: yt,
//         redTime:    rt,
//         timestamp:  new Date().toISOString()
//     });
    
//     aedes.publish({
//         topic:   `traffic/control/${road}`,
//         payload: Buffer.from(msg),
//         qos:     1,
//         retain:  true
//     }, (err) => {
//         if (err) console.error(`❌ Failed to send to ${road}:`, err);
//         else console.log(`📤 Sent to ${road}: ${signal} (green=${greenDuration}s, yellow=${yt}s, red=${rt}s)`);
//     });
// }

// function decideNextWinner() {
//     // PHASE 2.5: Pass espOnline to makeSignalDecision
//     latestDecision = makeSignalDecision(
//         sensorData, 
//         googleTraffic, 
//         sensorWorking, 
//         googleWorking,
//         irData, 
//         piezoData,
//         rainDetected,
//         pedStatus,
//         espOnline
//     );
    
//     if (latestDecision && latestDecision.winner) {
//         const winnerRoad = latestDecision.winner;
//         latestDecision.greenDuration  = greenTime[winnerRoad] || 5;
//         latestDecision.yellowDuration = yellowTime;
//         latestDecision.redForOthers = latestDecision.greenDuration + latestDecision.yellowDuration;
//     }
    
//     io.emit('newDecision', latestDecision);
//     console.log(`🧠 Decision: ${latestDecision.winner} gets GREEN (${latestDecision.greenDuration}s) ` +
//                 `YELLOW (${latestDecision.yellowDuration}s) — ` +
//                 `Others RED (${latestDecision.redForOthers}s) — Mode: ${latestDecision.mode}`);
//     return latestDecision;
// }

// // ── Main cycle engine (PHASE 3 - Complete fixed sequence) ───────────────────
// function runOneCycle() {
//     if (forceOverride && forceOverride.active) return;

//     const decision       = decideNextWinner();
//     const winner         = decision.winner;
//     const greenDuration  = decision.greenDuration  || greenTime[winner] || 5;
//     const yellowDuration = decision.yellowDuration || yellowTime;
//     const dynamicRedTime = greenDuration + yellowDuration;

//     redTime = dynamicRedTime;
//     currentWinner = winner;
//     currentPhase  = 'RED_TO_GREEN';

//     // STEP 1: All roads go RED first (including winner briefly)
//     ROADS.forEach(road => {
//         // PHASE 2.6: Synthetic timing for downed lanes
//         if (!espOnline[road]) {
//             sendCommandToRoad(road, 'RED',
//                 greenTime[road] || 3, yellowTime, dynamicRedTime);
//             console.log(`⚠️  [${road}] ESP32 OFFLINE — synthetic RED sent`);
//         } else {
//             sendCommandToRoad(road, 'RED', 0, 0, dynamicRedTime);
//         }
//         livePhase[road]       = 'RED';
//         liveSignalState[road] = 'RED';
//         startCountdown(road, 'RED', dynamicRedTime);
//     });

//     broadcastFullState();

//     // STEP 2: After 1s, winner goes YELLOW (RED→YELLOW→GREEN sequence)
//     setTimeout(() => {
//         currentPhase = 'PRE_GREEN_YELLOW';
//         sendCommandToRoad(winner, 'YELLOW', 0, 2, 0); // 2s pre-green yellow
//         livePhase[winner]       = 'YELLOW';
//         liveSignalState[winner] = 'YELLOW';
//         startCountdown(winner, 'YELLOW', 2);
//         broadcastFullState();

//         // STEP 3: After 2s yellow, winner goes GREEN
//         phaseTimer = setTimeout(() => {
//             currentPhase = 'GREEN';
//             sendCommandToRoad(winner, 'GREEN', greenDuration, yellowDuration, 0);
//             livePhase[winner]       = 'GREEN';
//             liveSignalState[winner] = 'GREEN';
//             startCountdown(winner, 'GREEN', greenDuration);
//             console.log(`\n🟢 [CYCLE] ${winner} GREEN for ${greenDuration}s | Others RED for ${dynamicRedTime}s`);
//             broadcastFullState();

//             // PHASE 6.3: Check for pending pedestrian requests (Cases C and D) before YELLOW
//             ROADS.forEach(road => {
//                 if (pedStatus[road].requested && !pedStatus[road].crossing) {
//                     const pressedPhase = pedPressedDuringPhase[road];
//                     if (pressedPhase === 'GREEN' || pressedPhase === 'YELLOW') {
//                         io.emit('pedestrianUpdate', {
//                             road, ...pedStatus[road],
//                             case: pressedPhase === 'GREEN' ? 'C' : 'D',
//                             action: 'YELLOW_COUNTDOWN_SHOWING',
//                             yellowRemaining: yellowDuration
//                         });
//                     }
//                 }
//             });

//             // STEP 4: GREEN ends → winner goes YELLOW (GREEN→YELLOW→RED)
//             phaseTimer = setTimeout(() => {
//                 currentPhase = 'POST_GREEN_YELLOW';
//                 const nextDecision = decideNextWinner();
//                 console.log(`🟡 [CYCLE] ${winner} YELLOW ${yellowDuration}s — NEXT: ${nextDecision.winner}`);

//                 sendCommandToRoad(winner, 'YELLOW', 0, yellowDuration, 0);
//                 livePhase[winner]       = 'YELLOW';
//                 liveSignalState[winner] = 'YELLOW';
//                 startCountdown(winner, 'YELLOW', yellowDuration);
//                 broadcastFullState();

//                 // STEP 5: YELLOW ends → winner goes RED
//                 phaseTimer = setTimeout(() => {
//                     currentPhase = 'RED';
//                     sendCommandToRoad(winner, 'RED', 0, 0, 0);
//                     livePhase[winner]       = 'RED';
//                     liveSignalState[winner] = 'RED';
//                     liveCountdown[winner]   = 0;
//                     broadcastFullState();
//                     console.log(`🔴 [CYCLE] ${winner} RED — 1s pause`);

//                     // PHASE 6.3: After winner goes RED, check for pending ped requests
//                     ROADS.forEach(road => {
//                         if (pedStatus[road].requested && !pedStatus[road].crossing) {
//                             _startPedCrossing(road, 3);
//                         }
//                     });

//                     // STEP 6: 1s pause then next cycle
//                     phaseTimer = setTimeout(async () => {
//                         // SAVE ANALYTICS for each road after each cycle
//                         const ROADS_LIST = ['North', 'South', 'East', 'West'];
//                         for (const road of ROADS_LIST) {
//                             await saveAnalyticsRecord(road, {
//                                 distanceCm: sensorData[road] || 5000,
//                                 queueLevel: irData[road]?.queueLevel || 'None',
//                                 googleTraffic: googleTraffic[road] || 'Unknown',
//                                 rainDetected: rainDetected,
//                                 greenTime: greenTime[road] || 3,
//                                 waitTime: redTime,
//                                 isWinner: currentWinner === road,
//                                 systemMode: latestDecision?.mode || 'FALLBACK'
//                             });
//                         }
//                         runOneCycle();
//                     }, 1000);

//                 }, yellowDuration * 1000);

//             }, greenDuration * 1000);

//         }, 2000); // 2s pre-green yellow

//     }, 1000); // 1s all-red gap
// }

// // ── Countdown helper ─────────────────────────────────────────────────────────
// let countdownIntervals = {};

// function startCountdown(road, phase, seconds) {
//     if (countdownIntervals[road]) clearInterval(countdownIntervals[road]);

//     let remaining = seconds;
//     liveCountdown[road] = remaining;

//     countdownIntervals[road] = setInterval(() => {
//         remaining--;
//         liveCountdown[road] = Math.max(0, remaining);
//         io.emit('countdown', { road, phase, remaining: liveCountdown[road] });
//         if (remaining <= 0) clearInterval(countdownIntervals[road]);
//     }, 1000);
// }

// // ── Broadcast full state to all dashboard clients (PHASE 2.4) ────────────────
// function broadcastFullState() {
//     io.emit('fullState', {
//         liveSignalState,
//         liveCountdown,
//         livePhase,
//         latestDecision,
//         sensorData,
//         googleTraffic,
//         sensorWorking,
//         googleWorking,
//         irData,
//         piezoData,
//         rainDetected,
//         yellowTime,
//         pedStatus,
//         greenTime,
//         redTime,
//         espOnline,           // PHASE 2.4
//         heavyVehicleActive,  // PHASE 4.2
//         forceOverride: forceOverride 
//             ? { active: forceOverride.active, road: forceOverride.road, command: forceOverride.command }
//             : null
//     });
// }

// // ════════════════════════════════════════════════════════════════════════════
// // SECTION 5: FORCE OVERRIDE HANDLER
// // ════════════════════════════════════════════════════════════════════════════
// function applyForceOverride(road, command, duration) {
//     console.log(`🚨 FORCE OVERRIDE: ${road} → ${command} for ${duration}s`);

//     if (phaseTimer) clearTimeout(phaseTimer);
//     Object.values(countdownIntervals).forEach(i => clearInterval(i));

//     const overrideRedTime = command === 'GREEN' ? (duration + yellowTime) : duration;

//     ROADS.forEach(r => {
//         if (r !== road) {
//             sendCommandToRoad(r, 'RED', 0, 0, overrideRedTime);
//             livePhase[r]      = 'RED';
//             liveSignalState[r] = 'RED';
//             startCountdown(r, 'RED', overrideRedTime);
//         }
//     });

//     forceOverride = { road, command, duration, active: true };

//     setTimeout(() => {
//         sendCommandToRoad(road, command, duration, yellowTime, 0);
//         livePhase[road]      = command;
//         liveSignalState[road] = command;
//         startCountdown(road, command, duration);
//         broadcastFullState();

//         setTimeout(() => {
//             console.log('✅ Force override ended — resuming normal cycle');
//             forceOverride = null;

//             ROADS.forEach(r => {
//                 sendCommandToRoad(r, 'RED', 0, 0, 0);
//                 livePhase[r]      = 'RED';
//                 liveSignalState[r] = 'RED';
//                 liveCountdown[r]  = 0;
//             });

//             broadcastFullState();
//             setTimeout(() => runOneCycle(), 2000);
//         }, duration * 1000);

//     }, 500);
// }

// // ════════════════════════════════════════════════════════════════════════════
// // SECTION 6: GOOGLE TRAFFIC REFRESH (PHASE 5 - 15 minute interval)
// // ════════════════════════════════════════════════════════════════════════════
// async function refreshGoogleTraffic() {
//     try {
//         const result = await getAllTrafficConditions();
//         const hasRealData = Object.values(result).some(v => v !== 'Unknown');
//         googleWorking = hasRealData;
//         googleTraffic = result;
//         console.log(`🗺️ Google Traffic: N=${result.North} S=${result.South} E=${result.East} W=${result.West} | Working: ${googleWorking}`);
//         io.emit('googleTrafficUpdate', { googleTraffic, googleWorking });
//     } catch (err) {
//         googleWorking = false;
//         console.log('⚠️ Google Traffic unavailable — using sensor-only mode');
//     }
// }

// // ════════════════════════════════════════════════════════════════════════════
// // SECTION 7: HTTP API ROUTES
// // ════════════════════════════════════════════════════════════════════════════
// app.get('/api/traffic', async (req, res) => {
//     try {
//         res.json({
//             ultrasonicReadings: sensorData,
//             googleTraffic,
//             liveSignalState,
//             liveCountdown,
//             livePhase,
//             sensorWorking,
//             googleWorking,
//             currentDecision: latestDecision,
//             irData,
//             piezoData,
//             rainDetected,
//             yellowTime,
//             pedStatus,
//             greenTime,
//             redTime,
//             espOnline,
//             heavyVehicleActive,
//             note: 'redTime is dynamic: equals winner greenTime + yellowTime each cycle'
//         });
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });

// app.get('/api/decision', (req, res) => {
//     if (!latestDecision) return res.json({ message: 'No decision yet — system starting up' });
//     res.json(latestDecision);
// });

// app.get('/api/sensor-data', async (req, res) => {
//     try {
//         const data = await UltrasonicData.find().sort({ timestamp: -1 }).limit(100);
//         res.json(data);
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });

// app.get('/api/ir-data', (req, res) => {
//     res.json(irData);
// });

// app.get('/api/rain-status', (req, res) => {
//     res.json({ rainDetected, yellowTime });
// });

// app.post('/api/traffic/control', (req, res) => {
//     const { location, command, duration } = req.body;
//     if (!ROADS.includes(location))              return res.status(400).json({ error: 'Invalid road' });
//     if (!['RED', 'YELLOW', 'GREEN'].includes(command)) return res.status(400).json({ error: 'Invalid command' });

//     const dur = parseInt(duration) || 30;
//     applyForceOverride(location, command, dur);
//     res.json({
//         message:  `Force ${command} applied to ${location} for ${dur}s`,
//         location, command, duration: dur,
//         othersRedFor: command === 'GREEN' ? dur + yellowTime : dur
//     });
// });

// app.post('/api/system/resume', (req, res) => {
//     forceOverride = null;
//     if (phaseTimer) clearTimeout(phaseTimer);
//     ROADS.forEach(r => {
//         sendCommandToRoad(r, 'RED', 0, 0, 0);
//         livePhase[r]      = 'RED';
//         liveSignalState[r] = 'RED';
//         liveCountdown[r]  = 0;
//     });
//     setTimeout(() => runOneCycle(), 2000);
//     res.json({ message: 'Normal cycle resumed' });
// });

// // ── Analytics API Routes ─────────────────────────────────────────────────────
// app.get('/api/analytics/peak-hours', async (req, res) => {
//     try {
//         const data = await getPeakHourAnalysis();
//         res.json(data);
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });

// app.get('/api/analytics/road-performance', async (req, res) => {
//     try {
//         const data = await getRoadPerformance();
//         res.json(data);
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });

// app.get('/api/analytics/live-trend', async (req, res) => {
//     try {
//         const data = await getLiveCongestionTrend();
//         res.json(data);
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });

// app.get('/api/analytics/system-efficiency', async (req, res) => {
//     try {
//         const data = await getSystemEfficiency();
//         res.json(data);
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });

// app.get('/api/health', (req, res) => {
//     res.json({ 
//         status: 'online', 
//         googleWorking, 
//         sensorWorking, 
//         currentWinner, 
//         currentPhase, 
//         uptime: process.uptime(),
//         rainDetected,
//         yellowTime,
//         currentRedTime: redTime,
//         redTimeNote: 'Dynamic: winner greenTime + yellowTime',
//         irData,
//         espOnline
//     });
// });

// // ════════════════════════════════════════════════════════════════════════════
// // SECTION 8: SOCKET.IO CONNECTION
// // ════════════════════════════════════════════════════════════════════════════
// io.on('connection', (socket) => {
//     console.log('🖥️ Dashboard connected:', socket.id);
    
//     socket.emit('fullState', {
//         liveSignalState,
//         liveCountdown,
//         livePhase,
//         latestDecision,
//         sensorData,
//         googleTraffic,
//         sensorWorking,
//         googleWorking,
//         irData,
//         piezoData,
//         rainDetected,
//         yellowTime,
//         pedStatus,
//         greenTime,
//         redTime,
//         espOnline,
//         heavyVehicleActive
//     });
    
//     socket.on('disconnect', () => console.log('🖥️ Dashboard disconnected:', socket.id));
// });

// // ════════════════════════════════════════════════════════════════════════════
// // SECTION 9: START EVERYTHING
// // ════════════════════════════════════════════════════════════════════════════
// mqttServer.listen(MQTT_PORT, () => console.log(`📡 MQTT Broker running on port ${MQTT_PORT}`));
// httpServer.listen(PORT, () => console.log(`✅ API + Dashboard Server running on port ${PORT}`));

// setTimeout(async () => {
//     console.log('\n🚦 Starting HYDRA Signal Cycle Engine...');
//     console.log(`📋 Configuration:`);
//     console.log(`   - RED Time: DYNAMIC (= winner's GREEN + YELLOW each cycle)`);
//     console.log(`   - YELLOW Time: ${yellowTime}s (3s normal, 5s when raining)`);
//     console.log(`   - GREEN Time: 3s base + traffic bonus (Light: +3s → 6s, Heavy: +6s → 9s)`);
//     console.log(`   - ESP32 Timeout: 20 minutes offline detection`);
//     await refreshGoogleTraffic();
//     // PHASE 5: 15 minute Google Traffic refresh interval
//     setInterval(refreshGoogleTraffic, 15 * 60 * 1000);
//     runOneCycle();
// }, 3000);

// setInterval(broadcastFullState, 2000);

// // PHASE 2.3: Check ESP32 health every 30 seconds
// setInterval(() => {
//     ROADS.forEach(road => {
//         const age = Date.now() - espLastSeen[road];
//         const wasOnline = espOnline[road];
//         espOnline[road] = age < ESP32_TIMEOUT_MS;
//         if (wasOnline && !espOnline[road]) {
//             console.log(`❌ ESP32 [${road}] OFFLINE — no message for ${Math.round(age/60000)} min`);
//             io.emit('espStatusUpdate', { road, online: false });
//         }
//     });
// }, 30000);

// // Broadcast analytics every 30 seconds to dashboard
// setInterval(async () => {
//     try {
//         const [peakHours, roadPerf, efficiency] = await Promise.all([
//             getPeakHourAnalysis(),
//             getRoadPerformance(),
//             getSystemEfficiency()
//         ]);
//         io.emit('analyticsUpdate', { peakHours, roadPerf, efficiency });
//     } catch (err) {
//         console.error('Analytics broadcast error:', err.message);
//     }
// }, 30000);


// ═══════════════════════════════════════════════════════════════════════════
// server/index.js — HYDRA Smart Traffic Control System
// PIEZO FIX v7.0:
//   - Piezo tap stored with timestamp + locked flag per road
//   - Subsequent taps ignored while locked (one tap per cycle)
//   - Badge persists from tap moment → through next cycle's extended green → until green ends
//   - clearPiezoForRoad(road) called after winner's green countdown completes
//   - IR check still required (piezo alone does not confirm heavy vehicle)
// ═══════════════════════════════════════════════════════════════════════════

require('dotenv').config();
const express        = require('express');
const cors           = require('cors');
const mongoose       = require('mongoose');
const aedes          = require('aedes')();
const net            = require('net');
const http           = require('http');
const path           = require('path');
const { Server }     = require('socket.io');

const TrafficData    = require('./models/TrafficData');
const UltrasonicData = require('./models/UltrasonicData');
const { getAllTrafficConditions } = require('./services/googleTrafficService');
const { makeSignalDecision } = require('./logic/signalDecision');
const { saveAnalyticsRecord, getPeakHourAnalysis, getRoadPerformance, getLiveCongestionTrend, getSystemEfficiency } = require('./services/analyticsService');

const app        = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT      = process.env.PORT      || 5000;
const MQTT_PORT = parseInt(process.env.MQTT_PORT) || 1883;

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/build')));

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅  MongoDB Connected'))
    .catch(err => console.error('❌  MongoDB Error:', err));

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2: IN-MEMORY STATE
// ════════════════════════════════════════════════════════════════════════════
const ROADS = ['North', 'South', 'East', 'West'];

let sensorData       = { North: 5000, South: 5000, East: 5000, West: 5000 };
let googleTraffic    = { North: 'Unknown', South: 'Unknown', East: 'Unknown', West: 'Unknown' };
let sensorWorking    = { North: false, South: false, East: false, West: false };
let googleWorking    = false;
let liveSignalState  = { North: 'RED', South: 'RED', East: 'RED', West: 'RED' };
let liveCountdown    = { North: 0, South: 0, East: 0, West: 0 };
let livePhase        = { North: 'RED', South: 'RED', East: 'RED', West: 'RED' };
let latestDecision   = null;
let forceOverride    = null;

let currentWinner = null;
let phaseTimer    = null;
let currentPhase  = 'RED';

let queueData = {
    North: { queueLevel: 'None' },
    South: { queueLevel: 'None' },
    East:  { queueLevel: 'None' },
    West:  { queueLevel: 'None' }
};

let queueStability = {
    North: { candidateLevel: 'None', stableSince: 0, queueLevel: 'None' },
    South: { candidateLevel: 'None', stableSince: 0, queueLevel: 'None' },
    East:  { candidateLevel: 'None', stableSince: 0, queueLevel: 'None' },
    West:  { candidateLevel: 'None', stableSince: 0, queueLevel: 'None' }
};

// ── PIEZO STATE (v7.0 — persistent, locked per road) ─────────────────────
// Structure per road:
//   heavy     : boolean  — is a heavy vehicle confirmed (IR + piezo)?
//   timestamp : number   — when the tap was first registered (Date.now())
//   locked    : boolean  — true = ignore further taps until this cycle clears
//
// Safety window: PIEZO_SAFETY_WINDOW_MS (10 min). If a road somehow never
// gets green in 10 minutes the lock is auto-released so the system doesn't
// get permanently stuck.
const PIEZO_SAFETY_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

let piezoData = {
    North: { heavy: false, timestamp: 0, locked: false },
    South: { heavy: false, timestamp: 0, locked: false },
    East:  { heavy: false, timestamp: 0, locked: false },
    West:  { heavy: false, timestamp: 0, locked: false }
};

// Called by the cycle engine after a road finishes its extended green
function clearPiezoForRoad(road) {
    if (!ROADS.includes(road)) return;
    piezoData[road] = { heavy: false, timestamp: 0, locked: false };
    heavyVehicleActive[road] = false;
    console.log(`🚛 [${road}] Piezo cleared — green cycle complete`);
    io.emit('piezoUpdate',        { road, heavyVehicle: false, rawValue: 0 });
    io.emit('heavyVehicleUpdate', { road, active: false });
    broadcastFullState();
}

// Safety sweep: auto-release any piezo lock older than PIEZO_SAFETY_WINDOW_MS
setInterval(() => {
    const now = Date.now();
    ROADS.forEach(road => {
        if (piezoData[road].locked && (now - piezoData[road].timestamp) > PIEZO_SAFETY_WINDOW_MS) {
            console.log(`⚠️  [${road}] Piezo safety-release (10-min timeout)`);
            clearPiezoForRoad(road);
        }
    });
}, 60000); // check every minute

// Heavy vehicle active tracking (mirrors piezoData.heavy, kept separate for dashboard compat)
let heavyVehicleActive = { North: false, South: false, East: false, West: false };

let rainDetected = false;
let yellowTime = 3;

let pedStatus = {
    North: { requested: false, crossing: false, duration: 0 },
    South: { requested: false, crossing: false, duration: 0 },
    East:  { requested: false, crossing: false, duration: 0 },
    West:  { requested: false, crossing: false, duration: 0 }
};

let pedPressedDuringPhase = {
    North: null, South: null, East: null, West: null
};

let pedCrossingTimers = {};

let greenTime = { North: 3, South: 3, East: 3, West: 3 };
let redTime = 3;

// ESP32 health tracking — 20 minute timeout
const ESP32_TIMEOUT_MS = 20 * 60 * 1000;
let espLastSeen = { North: Date.now(), South: Date.now(), East: Date.now(), West: Date.now() };
let espOnline   = { North: true, South: true, East: true, West: true };

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3: MQTT BROKER SETUP
// ════════════════════════════════════════════════════════════════════════════
const mqttServer = net.createServer(aedes.handle);

aedes.on('client', (client) => {
    console.log(`🔌  ESP32 Connected: ${client ? client.id : 'Unknown'}`);
});

aedes.on('clientDisconnect', (client) => {
    console.log(`📴  ESP32 Disconnected: ${client ? client.id : 'Unknown'}`);
});

// ── Pedestrian helper functions ───────────────────────────────────────────
function _startPedCrossing(road, durationSec) {
    if (pedStatus[road].crossing) return;
    const dur = durationSec || 3;
    pedStatus[road].crossing  = true;
    pedStatus[road].requested = false;
    pedStatus[road].duration  = dur;
    pedPressedDuringPhase[road] = null;
    console.log(`🚶 [${road}] CROSSING STARTED — ${dur}s`);
    aedes.publish({
        topic: `traffic/pedestrian/cmd/${road}`,
        payload: Buffer.from(JSON.stringify({ action: 'START_CROSSING', duration: dur })),
        qos: 1
    }, () => {});
    io.emit('pedestrianUpdate', { road, ...pedStatus[road], action: 'CROSSING_STARTED', countdown: dur });
    let remaining = dur;
    if (pedCrossingTimers[road]) clearInterval(pedCrossingTimers[road]);
    pedCrossingTimers[road] = setInterval(() => {
        remaining--;
        pedStatus[road].duration = Math.max(0, remaining);
        io.emit('pedestrianUpdate', { road, ...pedStatus[road], countdown: remaining });
        if (remaining <= 0) {
            clearInterval(pedCrossingTimers[road]);
            pedCrossingTimers[road] = null;
            _endPedCrossing(road);
        }
    }, 1000);
}

function _endPedCrossing(road) {
    if (pedCrossingTimers[road]) {
        clearInterval(pedCrossingTimers[road]);
        pedCrossingTimers[road] = null;
    }
    pedStatus[road].crossing  = false;
    pedStatus[road].requested = false;
    pedStatus[road].duration  = 0;
    pedPressedDuringPhase[road] = null;
    console.log(`🚶 [${road}] CROSSING ENDED`);
    aedes.publish({
        topic: `traffic/pedestrian/cmd/${road}`,
        payload: Buffer.from(JSON.stringify({ action: 'END_CROSSING' })),
        qos: 1
    }, () => {});
    io.emit('pedestrianUpdate', { road, ...pedStatus[road], action: 'CROSSING_ENDED' });
}

aedes.on('publish', async (packet, client) => {
    if (!client) return;
    const topic   = packet.topic;
    const payload = packet.payload.toString();

    // Update ESP32 last-seen
    const topicParts = topic.split('/');
    if (topicParts.length >= 3 && ROADS.includes(topicParts[2])) {
        const road = topicParts[2];
        espLastSeen[road] = Date.now();
        if (!espOnline[road]) {
            espOnline[road] = true;
            console.log(`✅ ESP32 [${road}] RECONNECTED`);
            io.emit('espStatusUpdate', { road, online: true });
        }
    }

    // ── Ultrasonic Data ──────────────────────────────────────────────────
    if (topic.startsWith('traffic/ultrasonic/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            sensorData[road] = data.distanceCm;
            sensorWorking[road] = true;
            await UltrasonicData.findOneAndUpdate(
                { road },
                { road, distanceCm: data.distanceCm, vehicleDetected: data.distanceCm <= 400, timestamp: new Date() },
                { upsert: true, returnDocument: 'after' }
            );

            const now = Date.now();
            const level = classifyQueueByUltrasonic(data.distanceCm);
            const stable = queueStability[road];

            if (level !== stable.candidateLevel) {
                stable.candidateLevel = level;
                stable.stableSince = now;
            }

            if (level === 'None') {
                stable.queueLevel = 'None';
            } else if (now - stable.stableSince >= 10000) {
                stable.queueLevel = level;
            }

            queueData[road] = {
                queueLevel: stable.queueLevel
            };

            console.log(`📡 Ultrasonic [${road}]: ${data.distanceCm < 5000 ? data.distanceCm + 'cm' : 'No vehicle'} → ${stable.queueLevel}`);
            io.emit('sensorUpdate', { road, distanceCm: data.distanceCm });
            io.emit('queueUpdate', { road, queueLevel: stable.queueLevel });
        } catch (e) { console.error('⚠️ Ultrasonic parse error:', e.message); }
    }

    // ── Piezo Sensor Data (v7.0 — persistent locked state) ───────────────
    if (topic.startsWith('traffic/piezo/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;

            const distanceCm = sensorData[road];
            const vehicleAtStopLine = distanceCm !== undefined && distanceCm !== null && distanceCm <= 400;

            // Only process if:
            //   1. Ultrasonic reports a vehicle near the stop line
            //   2. The piezo sensor detected vibration
            //   3. This road is NOT already locked (first tap wins, subsequent ignored)
            if (data.heavyVehicle && vehicleAtStopLine && !piezoData[road].locked) {
                piezoData[road] = {
                    heavy:     true,
                    timestamp: Date.now(),
                    locked:    true   // lock: ignore all further taps until clearPiezoForRoad()
                };
                heavyVehicleActive[road] = true;

                console.log(`🚛 HEAVY VEHICLE confirmed on ${road} (Ultrasonic+Piezo) — locked until green complete`);
                io.emit('piezoUpdate',        { road, heavyVehicle: true, rawValue: data.piezoValue });
                io.emit('heavyVehicleUpdate', { road, active: true });
                broadcastFullState();

            } else if (data.heavyVehicle && piezoData[road].locked) {
                // Subsequent tap on an already-locked road — silently ignore
                console.log(`🚛 [${road}] Piezo tap ignored — already locked for this cycle`);
            } else if (data.heavyVehicle && !vehicleAtStopLine) {
                // Piezo detected vibration but no vehicle currently near the stop line
                console.log(`🚛 [${road}] Piezo tap ignored — no ultrasonic vehicle at stop line`);
            }

        } catch (e) { console.error('⚠️ Piezo parse error:', e.message); }
    }

    // ── Rain Sensor Data ──────────────────────────────────────────────────
    if (topic.startsWith('traffic/rain/')) {
        try {
            const data = JSON.parse(payload);
            rainDetected = data.rainDetected || false;
            yellowTime = rainDetected ? 5 : 3;
            console.log(`🌧️ Rain Sensor: ${rainDetected ? 'RAINING (Yellow: 5s)' : 'DRY (Yellow: 3s)'}`);
            io.emit('rainUpdate', { rainDetected, yellowTime });
        } catch (e) { console.error('⚠️ Rain parse error:', e.message); }
    }

    // ── Pedestrian Button Data ────────────────────────────────────────────
    if (topic.startsWith('traffic/pedestrian/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;

            if (data.requested !== undefined && data.requested === true && !pedStatus[road].requested && !pedStatus[road].crossing) {
                pedStatus[road].requested = true;
                pedPressedDuringPhase[road] = livePhase[road];
                console.log(`🚶 Ped button [${road}] pressed during CAR_${livePhase[road]}`);

                if (livePhase[road] === 'RED') {
                    const remaining = liveCountdown[road] || 0;
                    if (remaining > 3) {
                        _startPedCrossing(road, 3);
                    } else {
                        io.emit('pedestrianUpdate', { road, ...pedStatus[road], case: 'A_WAIT', action: 'WAIT_TOO_SHORT_RED' });
                    }
                } else if (livePhase[road] === 'YELLOW' && currentPhase === 'PRE_GREEN_YELLOW') {
                    io.emit('pedestrianUpdate', { road, ...pedStatus[road], case: 'B', action: 'WAIT_YELLOW_UNSAFE' });
                } else if (livePhase[road] === 'GREEN') {
                    io.emit('pedestrianUpdate', { road, ...pedStatus[road], case: 'C', action: 'WAIT_FOR_GREEN_END', yellowRemaining: liveCountdown[road] });
                } else if (livePhase[road] === 'YELLOW') {
                    const remaining = liveCountdown[road] || 0;
                    aedes.publish({
                        topic: `traffic/pedestrian/cmd/${road}`,
                        payload: Buffer.from(JSON.stringify({ action: 'SHOW_YELLOW_COUNTDOWN', duration: remaining })),
                        qos: 1
                    }, () => {});
                    io.emit('pedestrianUpdate', { road, ...pedStatus[road], case: 'D', action: 'WAIT_YELLOW_THEN_CROSS', yellowRemaining: remaining });
                }
            }

            if (data.crossing !== undefined) {
                if (data.crossing === true && !pedStatus[road].crossing) {
                    _startPedCrossing(road, data.duration || 3);
                } else if (data.crossing === false && pedStatus[road].crossing) {
                    _endPedCrossing(road);
                }
            }

            io.emit('pedestrianUpdate', { road, ...pedStatus[road] });
        } catch (e) { console.error('⚠️ Pedestrian parse error:', e.message); }
    }

    // ── LED State from ESP32 ──────────────────────────────────────────────
    if (topic.startsWith('traffic/state/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            liveSignalState[road] = data.state;
            livePhase[road] = data.state;
            console.log(`💡 LED State [${road}]: ${data.state}`);
            io.emit('ledStateUpdate', { road, state: data.state });
        } catch (e) { console.error('⚠️ State parse error:', e.message); }
    }
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 4: SIGNAL CYCLE ENGINE
// ════════════════════════════════════════════════════════════════════════════

function sendCommandToRoad(road, signal, greenDuration, yellowOverride, dynamicRedTime) {
    const yt  = (yellowOverride !== undefined && yellowOverride > 0) ? yellowOverride : yellowTime;
    const rt  = (dynamicRedTime !== undefined && dynamicRedTime > 0) ? dynamicRedTime : 0;
    const msg = JSON.stringify({
        signal,
        greenTime:  greenDuration || 5,
        yellowTime: yt,
        redTime:    rt,
        timestamp:  new Date().toISOString()
    });
    aedes.publish({
        topic:   `traffic/control/${road}`,
        payload: Buffer.from(msg),
        qos:     1,
        retain:  true
    }, (err) => {
        if (err) console.error(`❌ Failed to send to ${road}:`, err);
        else console.log(`📤 Sent to ${road}: ${signal} (green=${greenDuration}s, yellow=${yt}s, red=${rt}s)`);
    });
}

function decideNextWinner() {
    // Pass piezoData (structured objects) to makeSignalDecision
    latestDecision = makeSignalDecision(
        sensorData,
        googleTraffic,
        sensorWorking,
        googleWorking,
        queueData,
        piezoData,   // { road: { heavy, timestamp, locked } }
        rainDetected,
        pedStatus,
        espOnline
    );

    if (latestDecision && latestDecision.winner) {
        const winnerRoad = latestDecision.winner;
        // greenDuration is computed by signalDecision (already includes piezo bonus)
        latestDecision.greenDuration  = latestDecision.greenDuration || greenTime[winnerRoad] || 5;
        latestDecision.yellowDuration = yellowTime;
        latestDecision.redForOthers   = latestDecision.greenDuration + latestDecision.yellowDuration;
    }

    io.emit('newDecision', latestDecision);
    console.log(`🧠 Decision: ${latestDecision.winner} gets GREEN (${latestDecision.greenDuration}s) ` +
                `YELLOW (${latestDecision.yellowDuration}s) — Others RED (${latestDecision.redForOthers}s) — Mode: ${latestDecision.mode}`);
    return latestDecision;
}

// ── Main cycle engine ────────────────────────────────────────────────────
function runOneCycle() {
    if (forceOverride && forceOverride.active) return;

    const decision       = decideNextWinner();
    const winner         = decision.winner;
    const greenDuration  = decision.greenDuration || greenTime[winner] || 5;
    const yellowDuration = decision.yellowDuration || yellowTime;
    const dynamicRedTime = greenDuration + yellowDuration;

    redTime = dynamicRedTime;
    currentWinner = winner;
    currentPhase  = 'RED_TO_GREEN';

    // Log whether piezo is contributing to this winner's green
    if (piezoData[winner] && piezoData[winner].heavy) {
        console.log(`🚛 [${winner}] Heavy vehicle active — green extended with piezo bonus (total: ${greenDuration}s)`);
    }

    // STEP 1: All roads RED
    ROADS.forEach(road => {
        if (!espOnline[road]) {
            sendCommandToRoad(road, 'RED', greenTime[road] || 3, yellowTime, dynamicRedTime);
            console.log(`⚠️  [${road}] ESP32 OFFLINE — synthetic RED sent`);
        } else {
            sendCommandToRoad(road, 'RED', 0, 0, dynamicRedTime);
        }
        livePhase[road]       = 'RED';
        liveSignalState[road] = 'RED';
        startCountdown(road, 'RED', dynamicRedTime);
    });

    broadcastFullState();

    // STEP 2: Winner goes YELLOW (pre-green)
    setTimeout(() => {
        currentPhase = 'PRE_GREEN_YELLOW';
        sendCommandToRoad(winner, 'YELLOW', 0, 2, 0);
        livePhase[winner]       = 'YELLOW';
        liveSignalState[winner] = 'YELLOW';
        startCountdown(winner, 'YELLOW', 2);
        broadcastFullState();

        // STEP 3: Winner goes GREEN
        phaseTimer = setTimeout(() => {
            currentPhase = 'GREEN';
            sendCommandToRoad(winner, 'GREEN', greenDuration, yellowDuration, 0);
            livePhase[winner]       = 'GREEN';
            liveSignalState[winner] = 'GREEN';
            startCountdown(winner, 'GREEN', greenDuration);
            console.log(`\n🟢 [CYCLE] ${winner} GREEN for ${greenDuration}s | Others RED for ${dynamicRedTime}s`);
            broadcastFullState();

            // STEP 4: GREEN ends → winner goes YELLOW (post-green)
            phaseTimer = setTimeout(() => {
                currentPhase = 'POST_GREEN_YELLOW';

                // ── PIEZO CLEAR POINT ────────────────────────────────────
                // Green countdown has finished for the winner.
                // If this road had a heavy vehicle flag, clear it now.
                if (piezoData[winner] && piezoData[winner].heavy) {
                    clearPiezoForRoad(winner);
                }

                const nextDecision = decideNextWinner();
                console.log(`🟡 [CYCLE] ${winner} YELLOW ${yellowDuration}s — NEXT: ${nextDecision.winner}`);

                sendCommandToRoad(winner, 'YELLOW', 0, yellowDuration, 0);
                livePhase[winner]       = 'YELLOW';
                liveSignalState[winner] = 'YELLOW';
                startCountdown(winner, 'YELLOW', yellowDuration);
                broadcastFullState();

                // STEP 5: YELLOW ends → winner RED
                phaseTimer = setTimeout(() => {
                    currentPhase = 'RED';
                    sendCommandToRoad(winner, 'RED', 0, 0, 0);
                    livePhase[winner]       = 'RED';
                    liveSignalState[winner] = 'RED';
                    liveCountdown[winner]   = 0;
                    broadcastFullState();
                    console.log(`🔴 [CYCLE] ${winner} RED — 1s pause`);

                    // Check for pending pedestrian requests
                    ROADS.forEach(road => {
                        if (pedStatus[road].requested && !pedStatus[road].crossing) {
                            _startPedCrossing(road, 3);
                        }
                    });

                    // STEP 6: 1s pause then next cycle
                    phaseTimer = setTimeout(async () => {
                        for (const road of ROADS) {
                            await saveAnalyticsRecord(road, {
                                distanceCm:   sensorData[road] || 5000,
                                queueLevel:   queueData[road]?.queueLevel || 'None',
                                googleTraffic: googleTraffic[road] || 'Unknown',
                                rainDetected:  rainDetected,
                                greenTime:     greenTime[road] || 3,
                                waitTime:      redTime,
                                isWinner:      currentWinner === road,
                                systemMode:    latestDecision?.mode || 'FALLBACK'
                            });
                        }
                        runOneCycle();
                    }, 1000);

                }, yellowDuration * 1000);

            }, greenDuration * 1000);

        }, 2000); // 2s pre-green yellow

    }, 1000); // 1s all-red gap
}

// ── Countdown helper ─────────────────────────────────────────────────────
let countdownIntervals = {};

function startCountdown(road, phase, seconds) {
    if (countdownIntervals[road]) clearInterval(countdownIntervals[road]);
    let remaining = seconds;
    liveCountdown[road] = remaining;
    countdownIntervals[road] = setInterval(() => {
        remaining--;
        liveCountdown[road] = Math.max(0, remaining);
        io.emit('countdown', { road, phase, remaining: liveCountdown[road] });
        if (remaining <= 0) clearInterval(countdownIntervals[road]);
    }, 1000);
}

// ── Broadcast full state ─────────────────────────────────────────────────
function broadcastFullState() {
    io.emit('fullState', {
        liveSignalState,
        liveCountdown,
        livePhase,
        latestDecision,
        sensorData,
        googleTraffic,
        sensorWorking,
        googleWorking,
        queueData,
        piezoData,           // structured objects with heavy/timestamp/locked
        rainDetected,
        yellowTime,
        pedStatus,
        greenTime,
        redTime,
        espOnline,
        heavyVehicleActive,
        forceOverride: forceOverride
            ? { active: forceOverride.active, road: forceOverride.road, command: forceOverride.command }
            : null
    });
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 5: FORCE OVERRIDE HANDLER
// ════════════════════════════════════════════════════════════════════════════
function applyForceOverride(road, command, duration) {
    console.log(`🚨 FORCE OVERRIDE: ${road} → ${command} for ${duration}s`);
    if (phaseTimer) clearTimeout(phaseTimer);
    Object.values(countdownIntervals).forEach(i => clearInterval(i));

    const overrideRedTime = command === 'GREEN' ? (duration + yellowTime) : duration;

    ROADS.forEach(r => {
        if (r !== road) {
            sendCommandToRoad(r, 'RED', 0, 0, overrideRedTime);
            livePhase[r]       = 'RED';
            liveSignalState[r] = 'RED';
            startCountdown(r, 'RED', overrideRedTime);
        }
    });

    forceOverride = { road, command, duration, active: true };

    setTimeout(() => {
        sendCommandToRoad(road, command, duration, yellowTime, 0);
        livePhase[road]       = command;
        liveSignalState[road] = command;
        startCountdown(road, command, duration);
        broadcastFullState();

        setTimeout(() => {
            console.log('✅ Force override ended — resuming normal cycle');
            forceOverride = null;
            ROADS.forEach(r => {
                sendCommandToRoad(r, 'RED', 0, 0, 0);
                livePhase[r]       = 'RED';
                liveSignalState[r] = 'RED';
                liveCountdown[r]   = 0;
            });
            broadcastFullState();
            setTimeout(() => runOneCycle(), 2000);
        }, duration * 1000);

    }, 500);
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 6: GOOGLE TRAFFIC REFRESH (15-minute interval)
// ════════════════════════════════════════════════════════════════════════════
async function refreshGoogleTraffic() {
    try {
        const result = await getAllTrafficConditions();
        const hasRealData = Object.values(result).some(v => v !== 'Unknown');
        googleWorking = hasRealData;
        googleTraffic = result;
        console.log(`🗺️ Google Traffic: N=${result.North} S=${result.South} E=${result.East} W=${result.West} | Working: ${googleWorking}`);
        io.emit('googleTrafficUpdate', { googleTraffic, googleWorking });
    } catch (err) {
        googleWorking = false;
        console.log('⚠️ Google Traffic unavailable — using sensor-only mode');
    }
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 7: HTTP API ROUTES
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/traffic', async (req, res) => {
    try {
        res.json({
            ultrasonicReadings: sensorData,
            googleTraffic,
            liveSignalState,
            liveCountdown,
            livePhase,
            sensorWorking,
            googleWorking,
            currentDecision: latestDecision,
            queueData,
            piezoData,
            rainDetected,
            yellowTime,
            pedStatus,
            greenTime,
            redTime,
            espOnline,
            heavyVehicleActive,
            note: 'redTime is dynamic: equals winner greenTime + yellowTime each cycle'
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/decision', (req, res) => {
    if (!latestDecision) return res.json({ message: 'No decision yet — system starting up' });
    res.json(latestDecision);
});

app.get('/api/sensor-data', async (req, res) => {
    try {
        const data = await UltrasonicData.find().sort({ timestamp: -1 }).limit(100);
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/queue-data', (req, res) => res.json(queueData));
app.get('/api/rain-status', (req, res) => res.json({ rainDetected, yellowTime }));

app.post('/api/traffic/control', (req, res) => {
    const { location, command, duration } = req.body;
    if (!ROADS.includes(location))                       return res.status(400).json({ error: 'Invalid road' });
    if (!['RED', 'YELLOW', 'GREEN'].includes(command))   return res.status(400).json({ error: 'Invalid command' });
    const dur = parseInt(duration) || 30;
    applyForceOverride(location, command, dur);
    res.json({ message: `Force ${command} applied to ${location} for ${dur}s`, location, command, duration: dur });
});

app.post('/api/system/resume', (req, res) => {
    forceOverride = null;
    if (phaseTimer) clearTimeout(phaseTimer);
    ROADS.forEach(r => {
        sendCommandToRoad(r, 'RED', 0, 0, 0);
        livePhase[r]       = 'RED';
        liveSignalState[r] = 'RED';
        liveCountdown[r]   = 0;
    });
    setTimeout(() => runOneCycle(), 2000);
    res.json({ message: 'Normal cycle resumed' });
});

app.get('/api/analytics/peak-hours',       async (req, res) => { try { res.json(await getPeakHourAnalysis());   } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/analytics/road-performance', async (req, res) => { try { res.json(await getRoadPerformance());    } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/analytics/live-trend',       async (req, res) => { try { res.json(await getLiveCongestionTrend()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/analytics/system-efficiency',async (req, res) => { try { res.json(await getSystemEfficiency());  } catch (e) { res.status(500).json({ error: e.message }); } });

app.get('/api/health', (req, res) => {
    res.json({
        status: 'online', googleWorking, sensorWorking, currentWinner, currentPhase,
        uptime: process.uptime(), rainDetected, yellowTime,
        currentRedTime: redTime, redTimeNote: 'Dynamic: winner greenTime + yellowTime',
        queueData, espOnline
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 8: SOCKET.IO CONNECTION
// ════════════════════════════════════════════════════════════════════════════
io.on('connection', (socket) => {
    console.log('🖥️ Dashboard connected:', socket.id);
    socket.emit('fullState', {
        liveSignalState, liveCountdown, livePhase, latestDecision,
        sensorData, googleTraffic, sensorWorking, googleWorking,
        queueData, piezoData, rainDetected, yellowTime,
        pedStatus, greenTime, redTime, espOnline, heavyVehicleActive
    });
    socket.on('disconnect', () => console.log('🖥️ Dashboard disconnected:', socket.id));
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 9: START EVERYTHING
// ════════════════════════════════════════════════════════════════════════════
mqttServer.listen(MQTT_PORT, () => console.log(`📡 MQTT Broker running on port ${MQTT_PORT}`));
httpServer.listen(PORT, () => console.log(`✅ API + Dashboard Server running on port ${PORT}`));

setTimeout(async () => {
    console.log('\n🚦 Starting HYDRA Signal Cycle Engine...');
    await refreshGoogleTraffic();
    setInterval(refreshGoogleTraffic, 15 * 60 * 1000);
    runOneCycle();
}, 3000);

setInterval(broadcastFullState, 2000);

// ESP32 health check every 30 seconds
setInterval(() => {
    ROADS.forEach(road => {
        const age = Date.now() - espLastSeen[road];
        const wasOnline = espOnline[road];
        espOnline[road] = age < ESP32_TIMEOUT_MS;
        if (wasOnline && !espOnline[road]) {
            console.log(`❌ ESP32 [${road}] OFFLINE — no message for ${Math.round(age / 60000)} min`);
            io.emit('espStatusUpdate', { road, online: false });
        }
    });
}, 30000);

// Analytics broadcast every 30 seconds
setInterval(async () => {
    try {
        const [peakHours, roadPerf, efficiency] = await Promise.all([
            getPeakHourAnalysis(),
            getRoadPerformance(),
            getSystemEfficiency()
        ]);
        io.emit('analyticsUpdate', { peakHours, roadPerf, efficiency });
    } catch (err) { console.error('Analytics broadcast error:', err.message); }
}, 30000);