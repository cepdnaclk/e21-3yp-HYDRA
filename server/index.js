// // server/index.js — HYDRA v9.0 COLLISION-FREE
// //
// // KEY DESIGN PRINCIPLES:
// //   1. ONE decision per cycle — made ONCE at the start, reused throughout
// //   2. nextWinner decided at post-green YELLOW start — broadcast to dashboard
// //   3. Cooldown — last winner excluded for 1 cycle
// //   4. Fallback rotation — managed HERE, advances only when used
// //   5. Offline roads — skipped entirely from rotation
// //   6. Google Traffic — kept for driver info display ONLY, not used in scoring
// //   7. Phase sequence: ALL RED (1s) → WINNER PRE-GREEN YELLOW (2s) → GREEN → POST-GREEN YELLOW → ALL RED...
// //   8. No double-counting of fallback index

// 'use strict';

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
// const { makeSignalDecision, ROADS } = require('./logic/signalDecision');
// const {
//     saveAnalyticsRecord, getPeakHourAnalysis, getRoadPerformance,
//     getLiveCongestionTrend, getSystemEfficiency
// } = require('./services/analyticsService');

// const app        = express();
// const httpServer = http.createServer(app);
// const io         = new Server(httpServer, {
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
// // IN-MEMORY STATE
// // ════════════════════════════════════════════════════════════════════════════

// // ── Dual ultrasonic sensor state ──────────────────────────────────────────────
// let usData = {
//     North: { us1Stable: false, us2Stable: false, us1Raw: 999, us2Raw: 999 },
//     South: { us1Stable: false, us2Stable: false, us1Raw: 999, us2Raw: 999 },
//     East:  { us1Stable: false, us2Stable: false, us1Raw: 999, us2Raw: 999 },
//     West:  { us1Stable: false, us2Stable: false, us1Raw: 999, us2Raw: 999 }
// };
// let usWorking = { North: false, South: false, East: false, West: false };

// // ── Google Traffic — kept ONLY for driver info display, not used in scoring ───
// let googleTraffic = { North: 'Unknown', South: 'Unknown', East: 'Unknown', West: 'Unknown' };
// let googleWorking = false;

// // ── Signal state ──────────────────────────────────────────────────────────────
// let livePhase       = { North: 'RED', South: 'RED', East: 'RED', West: 'RED' };
// let liveCountdown   = { North: 0,     South: 0,     East: 0,     West: 0 };
// let latestDecision  = null;   // current cycle's decision
// let nextDecision    = null;   // next cycle's decision (preview)
// let forceOverride   = null;
// let currentWinner   = null;   // road currently with GREEN
// let nextWinnerRoad  = null;   // road that will get GREEN next (broadcast during post-green yellow)
// let lastWinnerRoad  = null;   // road that JUST finished GREEN (cooldown target)
// let phaseTimer      = null;
// let currentPhase    = 'IDLE';

// // ── Piezo ─────────────────────────────────────────────────────────────────────
// const PIEZO_SAFETY_WINDOW_MS = 10 * 60 * 1000; // 10 min safety release
// let piezoData = {
//     North: { heavy: false, timestamp: 0, locked: false },
//     South: { heavy: false, timestamp: 0, locked: false },
//     East:  { heavy: false, timestamp: 0, locked: false },
//     West:  { heavy: false, timestamp: 0, locked: false }
// };

// // ── Rain ──────────────────────────────────────────────────────────────────────
// let rainDetected = false;
// let yellowTime   = 3;

// // ── Pedestrian ────────────────────────────────────────────────────────────────
// let pedStatus = {
//     North: { requested: false, crossing: false, duration: 0 },
//     South: { requested: false, crossing: false, duration: 0 },
//     East:  { requested: false, crossing: false, duration: 0 },
//     West:  { requested: false, crossing: false, duration: 0 }
// };
// let pedCrossingTimers = {};

// // ── ESP32 health ──────────────────────────────────────────────────────────────
// const ESP32_TIMEOUT_MS = 60 * 1000; // 60 seconds
// let espLastSeen = { North: 0, South: 0, East: 0, West: 0 };
// let espOnline   = { North: false, South: false, East: false, West: false };

// // ── Fallback round-robin ──────────────────────────────────────────────────────
// // Managed HERE — only advances when FALLBACK mode is actually used
// // Only online roads are included in rotation
// let _fallbackPointer = 0; // index into the list of currently-online roads

// // ── Countdown intervals ───────────────────────────────────────────────────────
// let countdownIntervals = {};

// // ════════════════════════════════════════════════════════════════════════════
// // HELPERS
// // ════════════════════════════════════════════════════════════════════════════

// // Returns the next fallback road from online roads only, then advances pointer
// function getNextFallbackRoad() {
//     const onlineRoads = ROADS.filter(r => espOnline[r]);
//     if (onlineRoads.length === 0) {
//         // No ESP32s online — use full ROADS list
//         const road = ROADS[_fallbackPointer % ROADS.length];
//         _fallbackPointer = (_fallbackPointer + 1) % ROADS.length;
//         return road;
//     }
//     const road = onlineRoads[_fallbackPointer % onlineRoads.length];
//     _fallbackPointer = (_fallbackPointer + 1) % onlineRoads.length;
//     return road;
// }

// // Returns fallback road WITHOUT advancing the pointer (for peek / tie-breaking)
// function peekFallbackRoad() {
//     const onlineRoads = ROADS.filter(r => espOnline[r]);
//     if (onlineRoads.length === 0) {
//         return ROADS[_fallbackPointer % ROADS.length];
//     }
//     return onlineRoads[_fallbackPointer % onlineRoads.length];
// }

// function clearPiezoForRoad(road) {
//     if (!ROADS.includes(road)) return;
//     piezoData[road] = { heavy: false, timestamp: 0, locked: false };
//     console.log(`🚛 [${road}] Piezo cleared after green cycle`);
//     io.emit('piezoUpdate', { road, heavyVehicle: false, rawValue: 0 });
//     broadcastFullState();
// }

// function startCountdown(road, phase, seconds) {
//     if (countdownIntervals[road]) clearInterval(countdownIntervals[road]);
//     let rem = Math.max(0, seconds);
//     liveCountdown[road] = rem;
//     if (rem === 0) return;
//     countdownIntervals[road] = setInterval(() => {
//         rem--;
//         liveCountdown[road] = Math.max(0, rem);
//         io.emit('countdown', { road, phase, remaining: liveCountdown[road] });
//         if (rem <= 0) clearInterval(countdownIntervals[road]);
//     }, 1000);
// }

// function stopAllCountdowns() {
//     Object.values(countdownIntervals).forEach(i => clearInterval(i));
//     countdownIntervals = {};
// }

// function broadcastFullState() {
//     io.emit('fullState', {
//         livePhase,
//         liveCountdown,
//         latestDecision,
//         nextWinnerRoad,   // ← dashboard uses this for pre-announce green border
//         usData,
//         googleTraffic,    // kept for driver info display only
//         usWorking,
//         googleWorking,
//         piezoData,
//         rainDetected,
//         yellowTime,
//         pedStatus,
//         espOnline,
//         currentPhase
//     });
// }

// function sendCommandToRoad(road, signal, greenDur, yellowDur, redDur) {
//     const msg = JSON.stringify({
//         signal,
//         greenTime:  greenDur  || 0,
//         yellowTime: yellowDur || yellowTime,
//         redTime:    redDur    || 0,
//         timestamp:  new Date().toISOString()
//     });
//     aedes.publish({
//         topic:   `traffic/control/${road}`,
//         payload: Buffer.from(msg),
//         qos: 1, retain: true
//     }, err => { if (err) console.error(`❌ Send failed ${road}:`, err); });
//     console.log(`📤 CMD ${road}: ${signal} (g=${greenDur}s y=${yellowDur}s r=${redDur}s)`);
// }

// // ════════════════════════════════════════════════════════════════════════════
// // PEDESTRIAN HELPERS
// // ════════════════════════════════════════════════════════════════════════════

// function _startPedCrossing(road, durationSec) {
//     if (pedStatus[road].crossing) return;
//     const dur = durationSec || 3;
//     pedStatus[road].crossing  = true;
//     pedStatus[road].requested = false;
//     pedStatus[road].duration  = dur;
//     console.log(`🚶 [${road}] CROSSING STARTED — ${dur}s`);
//     aedes.publish({
//         topic:   `traffic/pedestrian/cmd/${road}`,
//         payload: Buffer.from(JSON.stringify({ action: 'START_CROSSING', duration: dur })),
//         qos: 1
//     }, () => {});
//     io.emit('pedestrianUpdate', { road, ...pedStatus[road], action: 'CROSSING_STARTED', countdown: dur });
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
//     if (pedCrossingTimers[road]) { clearInterval(pedCrossingTimers[road]); pedCrossingTimers[road] = null; }
//     pedStatus[road].crossing  = false;
//     pedStatus[road].requested = false;
//     pedStatus[road].duration  = 0;
//     console.log(`🚶 [${road}] CROSSING ENDED`);
//     aedes.publish({
//         topic:   `traffic/pedestrian/cmd/${road}`,
//         payload: Buffer.from(JSON.stringify({ action: 'END_CROSSING' })),
//         qos: 1
//     }, () => {});
//     io.emit('pedestrianUpdate', { road, ...pedStatus[road], action: 'CROSSING_ENDED' });
// }

// // ════════════════════════════════════════════════════════════════════════════
// // MQTT BROKER
// // ════════════════════════════════════════════════════════════════════════════
// const mqttServer = net.createServer(aedes.handle);
// aedes.on('client',           c => console.log(`🔌  ESP32 Connected: ${c ? c.id : '?'}`));
// aedes.on('clientDisconnect', c => console.log(`📴  ESP32 Disconnected: ${c ? c.id : '?'}`));

// aedes.on('publish', async (packet, client) => {
//     if (!client) return;
//     const topic   = packet.topic;
//     const payload = packet.payload.toString();

//     // Update ESP32 last-seen
//     const parts = topic.split('/');
//     if (parts.length >= 3 && ROADS.includes(parts[2])) {
//         const road = parts[2];
//         const wasOffline = !espOnline[road];
//         espLastSeen[road] = Date.now();
//         espOnline[road]   = true;
//         if (wasOffline) {
//             console.log(`✅ ESP32 [${road}] CONNECTED`);
//             io.emit('espStatusUpdate', { road, online: true });
//             broadcastFullState();
//         }
//     }

//     // ── Dual ultrasonic: traffic/us/<road> ────────────────────────────────────
//     if (topic.startsWith('traffic/us/')) {
//         try {
//             const data = JSON.parse(payload);
//             const road = topic.split('/')[2];
//             if (!ROADS.includes(road)) return;

//             usData[road] = {
//                 us1Stable: data.us1Stable || false,
//                 us2Stable: data.us2Stable || false,
//                 us1Raw:    data.us1Raw !== undefined ? data.us1Raw : 999,
//                 us2Raw:    data.us2Raw !== undefined ? data.us2Raw : 999
//             };
//             usWorking[road] = true;

//             const ql = data.queueLevel || 'None';
//             console.log(`📡 US [${road}]: US1=${data.us1Stable ? 'STABLE' : 'clear'} US2=${data.us2Stable ? 'STABLE' : 'clear'} → ${ql}`);
//             io.emit('usUpdate', { road, ...usData[road], queueLevel: ql });
//         } catch (e) { console.error('⚠️ US parse error:', e.message); }
//     }

//     // ── Legacy: traffic/ultrasonic/<road> ─────────────────────────────────────
//     if (topic.startsWith('traffic/ultrasonic/')) {
//         try {
//             const data = JSON.parse(payload);
//             const road = topic.split('/')[2];
//             if (!ROADS.includes(road)) return;
//             const dist = data.distanceCm || 5000;
//             const legacyUS1 = (dist < 7);
//             if (!usData[road].us1Stable) {
//                 usData[road].us1Raw    = dist;
//                 usData[road].us1Stable = legacyUS1;
//             }
//             usWorking[road] = true;
//             io.emit('sensorUpdate', { road, distanceCm: dist });
//         } catch (e) { console.error('⚠️ Legacy ultrasonic parse error:', e.message); }
//     }

//     // ── Legacy: traffic/ir/<road> ─────────────────────────────────────────────
//     if (topic.startsWith('traffic/ir/')) {
//         try {
//             const data = JSON.parse(payload);
//             const road = topic.split('/')[2];
//             if (!ROADS.includes(road)) return;
//             const ir1 = data.ir1Blocked || false;
//             const ir2 = data.ir2Blocked || false;
//             const ql  = data.queueLevel || 'None';
//             usData[road] = {
//                 ...usData[road],
//                 us1Stable: ir1,
//                 us2Stable: ir1 && ir2,
//                 us1Raw:    ir1 ? 5 : 999,
//                 us2Raw:    ir2 ? 5 : 999
//             };
//             usWorking[road] = true;
//             io.emit('usUpdate', { road, ...usData[road], queueLevel: ql });
//         } catch (e) { console.error('⚠️ Legacy IR parse error:', e.message); }
//     }

//     // ── Piezo: traffic/piezo/<road> ───────────────────────────────────────────
//     if (topic.startsWith('traffic/piezo/')) {
//         try {
//             const data = JSON.parse(payload);
//             const road = topic.split('/')[2];
//             if (!ROADS.includes(road)) return;
//             // Piezo only confirmed when US1 is also stable
//             const us1Active = usData[road] && usData[road].us1Stable;
//             if (data.heavyVehicle && us1Active && !piezoData[road].locked) {
//                 piezoData[road] = { heavy: true, timestamp: Date.now(), locked: true };
//                 console.log(`🚛 HEAVY VEHICLE confirmed on ${road} (US1+Piezo)`);
//                 io.emit('piezoUpdate', { road, heavyVehicle: true, rawValue: data.piezoValue });
//                 broadcastFullState();
//             } else if (data.heavyVehicle && !us1Active) {
//                 console.log(`🚛 [${road}] Piezo tap ignored — US1 not stable`);
//             } else if (data.heavyVehicle && piezoData[road].locked) {
//                 console.log(`🚛 [${road}] Piezo tap ignored — already locked`);
//             }
//         } catch (e) { console.error('⚠️ Piezo parse error:', e.message); }
//     }

//     // ── Rain: traffic/rain/<road> or traffic/rain/all ─────────────────────────
//     if (topic.startsWith('traffic/rain/')) {
//         try {
//             const data = JSON.parse(payload);
//             const newRain = data.rainDetected || false;
//             if (newRain !== rainDetected) {
//                 rainDetected = newRain;
//                 yellowTime   = rainDetected ? 5 : 3;
//                 console.log(`🌧️ Rain: ${rainDetected ? 'RAINING (Yellow 5s)' : 'DRY (Yellow 3s)'}`);
//                 io.emit('rainUpdate', { rainDetected, yellowTime });
//             }
//         } catch (e) { console.error('⚠️ Rain parse error:', e.message); }
//     }

//     // ── Pedestrian: traffic/pedestrian/<road> (not cmd) ───────────────────────
//     if (topic.startsWith('traffic/pedestrian/') && !topic.includes('/cmd/')) {
//         try {
//             const data = JSON.parse(payload);
//             const road = topic.split('/')[2];
//             if (!ROADS.includes(road)) return;

//             if (data.requested && !pedStatus[road].requested && !pedStatus[road].crossing) {
//                 pedStatus[road].requested = true;
//                 console.log(`🚶 Ped button [${road}] during ${livePhase[road]}`);
//                 if (livePhase[road] === 'RED') {
//                     const rem = liveCountdown[road] || 0;
//                     if (rem > 3) _startPedCrossing(road, 3);
//                     else io.emit('pedestrianUpdate', { road, ...pedStatus[road], action: 'WAIT_TOO_SHORT_RED' });
//                 } else if (livePhase[road] === 'YELLOW') {
//                     const rem = liveCountdown[road] || 0;
//                     aedes.publish({
//                         topic:   `traffic/pedestrian/cmd/${road}`,
//                         payload: Buffer.from(JSON.stringify({ action: 'SHOW_YELLOW_COUNTDOWN', duration: rem })),
//                         qos: 1
//                     }, () => {});
//                     io.emit('pedestrianUpdate', { road, ...pedStatus[road], action: 'WAIT_YELLOW_THEN_CROSS' });
//                 } else {
//                     // GREEN phase — tell driver to wait for green+yellow to finish
//                     io.emit('pedestrianUpdate', { road, ...pedStatus[road], action: 'WAIT_FOR_GREEN_END' });
//                 }
//             }

//             if (data.crossing !== undefined) {
//                 if (data.crossing  && !pedStatus[road].crossing) _startPedCrossing(road, data.duration || 3);
//                 if (!data.crossing &&  pedStatus[road].crossing) _endPedCrossing(road);
//             }

//             io.emit('pedestrianUpdate', { road, ...pedStatus[road] });
//         } catch (e) { console.error('⚠️ Pedestrian parse error:', e.message); }
//     }

//     // ── LED state from ESP32: traffic/state/<road> ────────────────────────────
//     if (topic.startsWith('traffic/state/')) {
//         try {
//             const data = JSON.parse(payload);
//             const road = topic.split('/')[2];
//             if (!ROADS.includes(road)) return;
//             livePhase[road] = data.state;
//             io.emit('ledStateUpdate', { road, state: data.state });
//         } catch (e) { console.error('⚠️ State parse error:', e.message); }
//     }
// });

// // ════════════════════════════════════════════════════════════════════════════
// // MAIN CYCLE ENGINE — COLLISION-FREE
// // ════════════════════════════════════════════════════════════════════════════
// //
// // Phase sequence per cycle:
// //   STEP 1: ALL ROADS → RED (dynamicRedTime duration)
// //           → Show countdown on all roads
// //           → 1 second pause (safety gap)
// //   STEP 2: WINNER → pre-green YELLOW (2s)
// //           → Others remain RED
// //   STEP 3: WINNER → GREEN (greenDur seconds)
// //           → Others remain RED
// //   STEP 4: WINNER → post-green YELLOW (yellowDur seconds)
// //           → nextWinner is decided HERE and broadcast
// //           → Others remain RED
// //   STEP 5: WINNER → RED, pedestrian crossings served
// //           → Start next cycle
// //
// // CRITICAL: Decision is made ONCE at the start of STEP 1.
// // The same decision object is used throughout the entire cycle.
// // nextWinner (for preview) is decided at STEP 4.

// function runOneCycle() {
//     if (forceOverride && forceOverride.active) return;

//     // ── STEP 1: Make the ONE decision for this entire cycle ──────────────────
//     // Use peekFallbackRoad() — do NOT advance until we confirm mode is FALLBACK
//     const fallbackPeek = peekFallbackRoad();

//     const decision = makeSignalDecision(
//         usData,
//         usWorking,
//         piezoData,
//         rainDetected,
//         pedStatus,
//         espOnline,
//         lastWinnerRoad,   // cooldown target
//         fallbackPeek      // tie-breaking / fallback road
//     );

//     // If decision used FALLBACK mode, advance the fallback pointer NOW
//     if (decision.mode === 'FALLBACK') {
//         getNextFallbackRoad(); // advances pointer
//         console.log(`🔄 FALLBACK mode — advancing pointer. Next fallback: ${peekFallbackRoad()}`);
//     }

//     latestDecision = decision;
//     nextWinnerRoad = null; // clear preview from last cycle

//     const winner    = decision.winner;
//     const greenDur  = decision.greenDuration;
//     const yellowDur = decision.yellowDuration;
//     // Dynamic RED = how long non-winners stay RED = full cycle minus their own phases
//     // = pre-green yellow (2s) + green + post-green yellow
//     const dynamicRedTime = 2 + greenDur + yellowDur;

//     currentWinner = winner;
//     currentPhase  = 'ALL_RED';

//     console.log(`\n╔══════════════════════════════════════════════════════╗`);
//     console.log(`║  NEW CYCLE  Winner: ${winner.padEnd(5)} | Mode: ${decision.mode.padEnd(12)} ║`);
//     console.log(`║  Green: ${greenDur}s  Yellow: ${yellowDur}s  OtherRED: ${dynamicRedTime}s        ║`);
//     console.log(`║  LastWinner (cooldown): ${(lastWinnerRoad || 'none').padEnd(5)}                   ║`);
//     console.log(`╚══════════════════════════════════════════════════════╝`);

//     io.emit('newDecision', decision);

//     // ── ALL ROADS → RED (with countdown showing full cycle time) ─────────────
//     ROADS.forEach(road => {
//         sendCommandToRoad(road, 'RED', 0, yellowDur, dynamicRedTime);
//         livePhase[road] = 'RED';
//     });
//     // Start countdown for non-winner roads (they'll be RED for dynamicRedTime)
//     ROADS.filter(r => r !== winner).forEach(road => {
//         startCountdown(road, 'RED', dynamicRedTime);
//     });
//     // Winner road countdown: 1s all-red gap + 2s pre-yellow = 3s before green
//     startCountdown(winner, 'RED', 3);
//     broadcastFullState();

//     // ── STEP 2: After 1s — Winner → pre-green YELLOW (2s) ────────────────────
//     phaseTimer = setTimeout(() => {
//         currentPhase = 'PRE_GREEN_YELLOW';
//         sendCommandToRoad(winner, 'YELLOW', 0, 2, 0);
//         livePhase[winner] = 'YELLOW';
//         startCountdown(winner, 'YELLOW', 2);
//         broadcastFullState();

//         // ── STEP 3: After 2s — Winner → GREEN ────────────────────────────────
//         phaseTimer = setTimeout(() => {
//             currentPhase = 'GREEN';
//             sendCommandToRoad(winner, 'GREEN', greenDur, yellowDur, 0);
//             livePhase[winner] = 'GREEN';
//             startCountdown(winner, 'GREEN', greenDur);
//             console.log(`🟢 [CYCLE] ${winner} GREEN ${greenDur}s`);
//             broadcastFullState();

//             // ── STEP 4: After greenDur — Winner → post-green YELLOW ──────────
//             phaseTimer = setTimeout(() => {
//                 currentPhase = 'POST_GREEN_YELLOW';

//                 // Clear piezo for the winner road (served its purpose)
//                 if (piezoData[winner] && piezoData[winner].heavy) {
//                     clearPiezoForRoad(winner);
//                 }

//                 // Record who just finished GREEN — this is the cooldown target
//                 lastWinnerRoad = winner;

//                 // ── Decide NEXT winner NOW for dashboard preview ──────────────
//                 // This is preview only — the actual decision for next cycle will
//                 // be remade at the start of next runOneCycle() with fresh data.
//                 // But we broadcast it so dashboard can show the green border early.
//                 const nextFallbackPeek = peekFallbackRoad();
//                 const nextDec = makeSignalDecision(
//                     usData,
//                     usWorking,
//                     piezoData,
//                     rainDetected,
//                     pedStatus,
//                     espOnline,
//                     lastWinnerRoad,    // winner just set above
//                     nextFallbackPeek
//                 );
//                 nextWinnerRoad = nextDec.winner;
//                 nextDecision   = nextDec;

//                 console.log(`🟡 [CYCLE] ${winner} POST-GREEN YELLOW ${yellowDur}s | NEXT PREVIEW: ${nextWinnerRoad}`);
//                 sendCommandToRoad(winner, 'YELLOW', 0, yellowDur, 0);
//                 livePhase[winner] = 'YELLOW';
//                 startCountdown(winner, 'YELLOW', yellowDur);
//                 io.emit('nextWinnerPreview', { nextWinner: nextWinnerRoad, nextDecision: nextDec });
//                 broadcastFullState();

//                 // ── STEP 5: After yellowDur — Winner → RED ────────────────────
//                 phaseTimer = setTimeout(() => {
//                     currentPhase = 'CYCLE_END';
//                     sendCommandToRoad(winner, 'RED', 0, 0, 0);
//                     livePhase[winner]   = 'RED';
//                     liveCountdown[winner] = 0;

//                     console.log(`🔴 [CYCLE END] ${winner} → RED`);

//                     // Serve any pending pedestrian crossings
//                     ROADS.forEach(road => {
//                         if (pedStatus[road].requested && !pedStatus[road].crossing) {
//                             _startPedCrossing(road, 3);
//                         }
//                     });

//                     broadcastFullState();

//                     // ── Save analytics then start next cycle ──────────────────
//                     phaseTimer = setTimeout(async () => {
//                         for (const road of ROADS) {
//                             const ql = usData[road].us1Stable && usData[road].us2Stable
//                                 ? 'Heavy' : usData[road].us1Stable ? 'Light' : 'None';
//                             await saveAnalyticsRecord(road, {
//                                 distanceCm:    usData[road].us1Raw || 999,
//                                 queueLevel:    ql,
//                                 googleTraffic: googleTraffic[road] || 'Unknown',
//                                 rainDetected:  rainDetected,
//                                 greenTime:     decision.greenDuration || 3,
//                                 waitTime:      dynamicRedTime,
//                                 isWinner:      currentWinner === road,
//                                 systemMode:    decision.mode || 'FALLBACK'
//                             });
//                         }
//                         runOneCycle(); // ← next cycle starts here
//                     }, 1000);

//                 }, yellowDur * 1000);

//             }, greenDur * 1000);

//         }, 2000); // 2s pre-green yellow

//     }, 1000); // 1s all-red gap
// }

// // ════════════════════════════════════════════════════════════════════════════
// // FORCE OVERRIDE (admin only)
// // ════════════════════════════════════════════════════════════════════════════
// function applyForceOverride(road, command, duration) {
//     console.log(`🚨 FORCE OVERRIDE: ${road} → ${command} ${duration}s`);
//     if (phaseTimer) clearTimeout(phaseTimer);
//     stopAllCountdowns();

//     const overrideRed = command === 'GREEN' ? (duration + yellowTime) : duration;
//     ROADS.forEach(r => {
//         if (r !== road) {
//             sendCommandToRoad(r, 'RED', 0, 0, overrideRed);
//             livePhase[r] = 'RED';
//             startCountdown(r, 'RED', overrideRed);
//         }
//     });

//     forceOverride = { road, command, duration, active: true };

//     setTimeout(() => {
//         sendCommandToRoad(road, command, duration, yellowTime, 0);
//         livePhase[road] = command;
//         startCountdown(road, command, duration);
//         broadcastFullState();

//         setTimeout(() => {
//             console.log('✅ Force override ended — resuming normal cycle');
//             forceOverride = null;
//             ROADS.forEach(r => {
//                 sendCommandToRoad(r, 'RED', 0, 0, 0);
//                 livePhase[r]    = 'RED';
//                 liveCountdown[r] = 0;
//             });
//             broadcastFullState();
//             setTimeout(() => runOneCycle(), 2000);
//         }, duration * 1000);

//     }, 500);
// }

// // ════════════════════════════════════════════════════════════════════════════
// // GOOGLE TRAFFIC REFRESH (display only — not used in signal scoring)
// // ════════════════════════════════════════════════════════════════════════════
// async function refreshGoogleTraffic() {
//     try {
//         const result = await getAllTrafficConditions();
//         googleWorking = Object.values(result).some(v => v !== 'Unknown');
//         googleTraffic = result;
//         console.log(`🗺️ Google (display only): N=${result.North} S=${result.South} E=${result.East} W=${result.West}`);
//         io.emit('googleTrafficUpdate', { googleTraffic, googleWorking });
//     } catch (err) {
//         googleWorking = false;
//         console.log('⚠️ Google Traffic unavailable (display only — no impact on signals)');
//     }
// }

// // ════════════════════════════════════════════════════════════════════════════
// // API ROUTES
// // ════════════════════════════════════════════════════════════════════════════
// app.get('/api/traffic', (req, res) => {
//     res.json({
//         usData, googleTraffic, livePhase, liveCountdown,
//         usWorking, googleWorking, currentDecision: latestDecision,
//         piezoData, rainDetected, yellowTime, pedStatus, espOnline,
//         currentWinner, nextWinnerRoad, lastWinnerRoad, currentPhase
//     });
// });
// app.get('/api/decision',    (req, res) => res.json(latestDecision || { message: 'No decision yet' }));
// app.get('/api/us-data',     (req, res) => res.json(usData));
// app.get('/api/rain-status', (req, res) => res.json({ rainDetected, yellowTime }));
// app.get('/api/esp-status',  (req, res) => res.json({ espOnline, espLastSeen }));

// app.post('/api/traffic/control', (req, res) => {
//     const { location, command, duration } = req.body;
//     if (!ROADS.includes(location))                   return res.status(400).json({ error: 'Invalid road' });
//     if (!['RED','YELLOW','GREEN'].includes(command)) return res.status(400).json({ error: 'Invalid command' });
//     const dur = parseInt(duration) || 30;
//     applyForceOverride(location, command, dur);
//     res.json({ message: `Force ${command} on ${location} for ${dur}s`, location, command, duration: dur });
// });

// app.post('/api/system/resume', (req, res) => {
//     forceOverride = null;
//     if (phaseTimer) clearTimeout(phaseTimer);
//     ROADS.forEach(r => {
//         sendCommandToRoad(r, 'RED', 0, 0, 0);
//         livePhase[r]    = 'RED';
//         liveCountdown[r] = 0;
//     });
//     setTimeout(() => runOneCycle(), 2000);
//     res.json({ message: 'Normal cycle resumed' });
// });

// app.get('/api/analytics/peak-hours',        async (req, res) => { try { res.json(await getPeakHourAnalysis());    } catch (e) { res.status(500).json({ error: e.message }); } });
// app.get('/api/analytics/road-performance',  async (req, res) => { try { res.json(await getRoadPerformance());     } catch (e) { res.status(500).json({ error: e.message }); } });
// app.get('/api/analytics/live-trend',        async (req, res) => { try { res.json(await getLiveCongestionTrend()); } catch (e) { res.status(500).json({ error: e.message }); } });
// app.get('/api/analytics/system-efficiency', async (req, res) => { try { res.json(await getSystemEfficiency());   } catch (e) { res.status(500).json({ error: e.message }); } });

// app.get('/api/health', (req, res) => {
//     res.json({
//         status: 'online', googleWorking, usWorking,
//         currentWinner, nextWinnerRoad, lastWinnerRoad,
//         currentPhase, uptime: process.uptime(),
//         rainDetected, yellowTime, espOnline, espLastSeen,
//         fallbackPointer: _fallbackPointer
//     });
// });

// app.get('*', (req, res) => {
//     res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
// });

// // ════════════════════════════════════════════════════════════════════════════
// // SOCKET.IO
// // ════════════════════════════════════════════════════════════════════════════
// io.on('connection', socket => {
//     console.log('🖥️  Dashboard connected:', socket.id);
//     socket.emit('fullState', {
//         livePhase, liveCountdown, latestDecision, nextWinnerRoad,
//         usData, googleTraffic, usWorking, googleWorking,
//         piezoData, rainDetected, yellowTime, pedStatus, espOnline, currentPhase
//     });
//     socket.on('disconnect', () => console.log('🖥️  Dashboard disconnected:', socket.id));
// });

// // ════════════════════════════════════════════════════════════════════════════
// // STARTUP
// // ════════════════════════════════════════════════════════════════════════════
// mqttServer.listen(MQTT_PORT, () => console.log(`📡 MQTT Broker on port ${MQTT_PORT}`));
// httpServer.listen(PORT,      () => console.log(`✅  Server on port ${PORT}`));

// setTimeout(async () => {
//     console.log('\n🚦 Starting HYDRA v9.0 COLLISION-FREE...');
//     await refreshGoogleTraffic();
//     setInterval(refreshGoogleTraffic, 15 * 60 * 1000); // refresh every 15 min (display only)
//     runOneCycle();
// }, 3000);

// // Broadcast full state every 2 seconds to keep dashboards in sync
// setInterval(broadcastFullState, 2000);

// // ESP32 health check every 15 seconds
// setInterval(() => {
//     const now = Date.now();
//     ROADS.forEach(road => {
//         const age = now - espLastSeen[road];
//         const wasOnline = espOnline[road];
//         if (espLastSeen[road] === 0 || age > ESP32_TIMEOUT_MS) {
//             espOnline[road]  = false;
//             usWorking[road]  = false;
//             if (wasOnline) {
//                 console.log(`❌ ESP32 [${road}] OFFLINE — age=${Math.round(age / 1000)}s`);
//                 io.emit('espStatusUpdate', { road, online: false });
//                 io.emit('usUpdate', {
//                     road, us1Stable: false, us2Stable: false,
//                     us1Raw: 999, us2Raw: 999, queueLevel: 'None'
//                 });
//                 broadcastFullState();
//             }
//         }
//     });
// }, 15000);

// // Piezo safety release (10 min stuck protection)
// setInterval(() => {
//     const now = Date.now();
//     ROADS.forEach(road => {
//         if (piezoData[road].locked && (now - piezoData[road].timestamp) > PIEZO_SAFETY_WINDOW_MS) {
//             console.log(`⚠️  [${road}] Piezo safety-release (10-min timeout)`);
//             clearPiezoForRoad(road);
//         }
//     });
// }, 60000);

// // Analytics broadcast every 30 seconds
// setInterval(async () => {
//     try {
//         const [peakHours, roadPerf, efficiency] = await Promise.all([
//             getPeakHourAnalysis(), getRoadPerformance(), getSystemEfficiency()
//         ]);
//         io.emit('analyticsUpdate', { peakHours, roadPerf, efficiency });
//     } catch (err) { console.error('Analytics broadcast error:', err.message); }
// }, 30000);



// server/index.js — HYDRA v9.1 FIXED
//
// FIXES from v9.0:
//   1. ESP32 offline detection: timeout 10s + health check every 5s (was 60s/15s)
//   2. usData cleared immediately when ESP32 goes offline (was only on health check)
//   3. FALLBACK rotation: works correctly for all-offline scenario
//   4. MQTT clientDisconnect event now marks road offline immediately
//   5. Stale usData bug: last winner kept high score after disconnect — fixed

'use strict';

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
const { makeSignalDecision, ROADS } = require('./logic/signalDecision');
const {
    saveAnalyticsRecord, getPeakHourAnalysis, getRoadPerformance,
    getLiveCongestionTrend, getSystemEfficiency
} = require('./services/analyticsService');

const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer, {
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
// IN-MEMORY STATE
// ════════════════════════════════════════════════════════════════════════════

let usData = {
    North: { us1Stable: false, us2Stable: false, us1Raw: 999, us2Raw: 999 },
    South: { us1Stable: false, us2Stable: false, us1Raw: 999, us2Raw: 999 },
    East:  { us1Stable: false, us2Stable: false, us1Raw: 999, us2Raw: 999 },
    West:  { us1Stable: false, us2Stable: false, us1Raw: 999, us2Raw: 999 }
};
let usWorking = { North: false, South: false, East: false, West: false };

let googleTraffic = { North: 'Unknown', South: 'Unknown', East: 'Unknown', West: 'Unknown' };
let googleWorking = false;

let livePhase       = { North: 'RED', South: 'RED', East: 'RED', West: 'RED' };
let liveCountdown   = { North: 0,     South: 0,     East: 0,     West: 0 };
let latestDecision  = null;
let nextDecision    = null;
let forceOverride   = null;
let currentWinner   = null;
let nextWinnerRoad  = null;
let lastWinnerRoad  = null;
let phaseTimer      = null;
let currentPhase    = 'IDLE';

let piezoData = {
    North: { heavy: false, timestamp: 0, locked: false },
    South: { heavy: false, timestamp: 0, locked: false },
    East:  { heavy: false, timestamp: 0, locked: false },
    West:  { heavy: false, timestamp: 0, locked: false }
};
const PIEZO_SAFETY_WINDOW_MS = 10 * 60 * 1000;

let rainDetected = false;
let yellowTime   = 3;

let pedStatus = {
    North: { requested: false, crossing: false, duration: 0 },
    South: { requested: false, crossing: false, duration: 0 },
    East:  { requested: false, crossing: false, duration: 0 },
    West:  { requested: false, crossing: false, duration: 0 }
};
let pedCrossingTimers = {};

// FIX: Reduced timeout to 10 seconds (was 60s)
const ESP32_TIMEOUT_MS = 10 * 1000;
let espLastSeen = { North: 0, South: 0, East: 0, West: 0 };
let espOnline   = { North: false, South: false, East: false, West: false };

// Map from MQTT client ID to road — for immediate disconnect detection
let clientRoadMap = {};

let _fallbackPointer = 0;
let countdownIntervals = {};

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

function getNextFallbackRoad() {
    const onlineRoads = ROADS.filter(r => espOnline[r]);
    if (onlineRoads.length === 0) {
        const road = ROADS[_fallbackPointer % ROADS.length];
        _fallbackPointer = (_fallbackPointer + 1) % ROADS.length;
        return road;
    }
    const road = onlineRoads[_fallbackPointer % onlineRoads.length];
    _fallbackPointer = (_fallbackPointer + 1) % onlineRoads.length;
    return road;
}

function peekFallbackRoad() {
    const onlineRoads = ROADS.filter(r => espOnline[r]);
    if (onlineRoads.length === 0) {
        return ROADS[_fallbackPointer % ROADS.length];
    }
    return onlineRoads[_fallbackPointer % onlineRoads.length];
}

// FIX: Mark a road offline immediately and clear its sensor data
function markRoadOffline(road) {
    if (!ROADS.includes(road)) return;
    if (!espOnline[road]) return; // already offline

    espOnline[road]  = false;
    usWorking[road]  = false;

    // FIX: Clear stale sensor data so it doesn't win next cycle
    usData[road] = { us1Stable: false, us2Stable: false, us1Raw: 999, us2Raw: 999 };
    piezoData[road] = { heavy: false, timestamp: 0, locked: false };

    console.log(`❌ ESP32 [${road}] OFFLINE — sensor data cleared`);
    io.emit('espStatusUpdate', { road, online: false });
    io.emit('usUpdate', {
        road, us1Stable: false, us2Stable: false,
        us1Raw: 999, us2Raw: 999, queueLevel: 'None'
    });
    broadcastFullState();
}

function clearPiezoForRoad(road) {
    if (!ROADS.includes(road)) return;
    piezoData[road] = { heavy: false, timestamp: 0, locked: false };
    console.log(`🚛 [${road}] Piezo cleared after green cycle`);
    io.emit('piezoUpdate', { road, heavyVehicle: false, rawValue: 0 });
    broadcastFullState();
}

function startCountdown(road, phase, seconds) {
    if (countdownIntervals[road]) clearInterval(countdownIntervals[road]);
    let rem = Math.max(0, seconds);
    liveCountdown[road] = rem;
    if (rem === 0) return;
    countdownIntervals[road] = setInterval(() => {
        rem--;
        liveCountdown[road] = Math.max(0, rem);
        io.emit('countdown', { road, phase, remaining: liveCountdown[road] });
        if (rem <= 0) clearInterval(countdownIntervals[road]);
    }, 1000);
}

function stopAllCountdowns() {
    Object.values(countdownIntervals).forEach(i => clearInterval(i));
    countdownIntervals = {};
}

function broadcastFullState() {
    io.emit('fullState', {
        livePhase,
        liveCountdown,
        latestDecision,
        nextWinnerRoad,
        usData,
        googleTraffic,
        usWorking,
        googleWorking,
        piezoData,
        rainDetected,
        yellowTime,
        pedStatus,
        espOnline,
        currentPhase
    });
}

function sendCommandToRoad(road, signal, greenDur, yellowDur, redDur) {
    const msg = JSON.stringify({
        signal,
        greenTime:  greenDur  || 0,
        yellowTime: yellowDur || yellowTime,
        redTime:    redDur    || 0,
        timestamp:  new Date().toISOString()
    });
    aedes.publish({
        topic:   `traffic/control/${road}`,
        payload: Buffer.from(msg),
        qos: 1, retain: true
    }, err => { if (err) console.error(`❌ Send failed ${road}:`, err); });
    console.log(`📤 CMD ${road}: ${signal} (g=${greenDur}s y=${yellowDur}s r=${redDur}s)`);
}

// ════════════════════════════════════════════════════════════════════════════
// PEDESTRIAN HELPERS
// ════════════════════════════════════════════════════════════════════════════

function _startPedCrossing(road, durationSec) {
    if (pedStatus[road].crossing) return;
    const dur = durationSec || 3;
    pedStatus[road].crossing  = true;
    pedStatus[road].requested = false;
    pedStatus[road].duration  = dur;
    console.log(`🚶 [${road}] CROSSING STARTED — ${dur}s`);
    aedes.publish({
        topic:   `traffic/pedestrian/cmd/${road}`,
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
    if (pedCrossingTimers[road]) { clearInterval(pedCrossingTimers[road]); pedCrossingTimers[road] = null; }
    pedStatus[road].crossing  = false;
    pedStatus[road].requested = false;
    pedStatus[road].duration  = 0;
    console.log(`🚶 [${road}] CROSSING ENDED`);
    aedes.publish({
        topic:   `traffic/pedestrian/cmd/${road}`,
        payload: Buffer.from(JSON.stringify({ action: 'END_CROSSING' })),
        qos: 1
    }, () => {});
    io.emit('pedestrianUpdate', { road, ...pedStatus[road], action: 'CROSSING_ENDED' });
}

// ════════════════════════════════════════════════════════════════════════════
// MQTT BROKER
// ════════════════════════════════════════════════════════════════════════════
const mqttServer = net.createServer(aedes.handle);

aedes.on('client', c => {
    console.log(`🔌  ESP32 Connected: ${c ? c.id : '?'}`);
});

// FIX: Immediate offline detection on MQTT disconnect
aedes.on('clientDisconnect', c => {
    if (!c) return;
    const clientId = c.id;
    console.log(`📴  ESP32 Disconnected: ${clientId}`);

    // Look up which road this client was for
    const road = clientRoadMap[clientId];
    if (road) {
        delete clientRoadMap[clientId];
        markRoadOffline(road);
    } else {
        // Try to infer road from client ID (format: HYDRA-North-xxxx)
        for (const r of ROADS) {
            if (clientId.includes(r)) {
                markRoadOffline(r);
                break;
            }
        }
    }
});

aedes.on('publish', async (packet, client) => {
    if (!client) return;
    const topic   = packet.topic;
    const payload = packet.payload.toString();

    // Update ESP32 last-seen and map client to road
    const parts = topic.split('/');
    if (parts.length >= 3 && ROADS.includes(parts[2])) {
        const road = parts[2];
        const wasOffline = !espOnline[road];
        espLastSeen[road] = Date.now();
        espOnline[road]   = true;

        // Register this client → road mapping for disconnect handling
        if (client.id) clientRoadMap[client.id] = road;

        if (wasOffline) {
            console.log(`✅ ESP32 [${road}] CONNECTED`);
            io.emit('espStatusUpdate', { road, online: true });
            broadcastFullState();
        }
    }

    // Dual ultrasonic: traffic/us/<road>
    if (topic.startsWith('traffic/us/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;

            usData[road] = {
                us1Stable: data.us1Stable || false,
                us2Stable: data.us2Stable || false,
                us1Raw:    data.us1Raw !== undefined ? data.us1Raw : 999,
                us2Raw:    data.us2Raw !== undefined ? data.us2Raw : 999
            };
            usWorking[road] = true;

            const ql = data.queueLevel || 'None';
            console.log(`📡 US [${road}]: US1=${data.us1Stable ? 'STABLE' : 'clear'} US2=${data.us2Stable ? 'STABLE' : 'clear'} → ${ql}`);
            io.emit('usUpdate', { road, ...usData[road], queueLevel: ql });
        } catch (e) { console.error('⚠️ US parse error:', e.message); }
    }

    // Legacy: traffic/ultrasonic/<road>
    if (topic.startsWith('traffic/ultrasonic/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            const dist = data.distanceCm || 5000;
            const legacyUS1 = (dist < 7);
            if (!usData[road].us1Stable) {
                usData[road].us1Raw    = dist;
                usData[road].us1Stable = legacyUS1;
            }
            usWorking[road] = true;
            io.emit('sensorUpdate', { road, distanceCm: dist });
        } catch (e) { console.error('⚠️ Legacy ultrasonic parse error:', e.message); }
    }

    // Legacy: traffic/ir/<road>
    if (topic.startsWith('traffic/ir/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            const ir1 = data.ir1Blocked || false;
            const ir2 = data.ir2Blocked || false;
            const ql  = data.queueLevel || 'None';
            usData[road] = {
                ...usData[road],
                us1Stable: ir1,
                us2Stable: ir1 && ir2,
                us1Raw:    ir1 ? 5 : 999,
                us2Raw:    ir2 ? 5 : 999
            };
            usWorking[road] = true;
            io.emit('usUpdate', { road, ...usData[road], queueLevel: ql });
        } catch (e) { console.error('⚠️ Legacy IR parse error:', e.message); }
    }

    // Piezo: traffic/piezo/<road>
    if (topic.startsWith('traffic/piezo/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            const us1Active = usData[road] && usData[road].us1Stable;
            if (data.heavyVehicle && us1Active && !piezoData[road].locked) {
                piezoData[road] = { heavy: true, timestamp: Date.now(), locked: true };
                console.log(`🚛 HEAVY VEHICLE confirmed on ${road} (US1+Piezo)`);
                io.emit('piezoUpdate', { road, heavyVehicle: true, rawValue: data.piezoValue });
                broadcastFullState();
            } else if (data.heavyVehicle && !us1Active) {
                console.log(`🚛 [${road}] Piezo tap ignored — US1 not stable`);
            } else if (data.heavyVehicle && piezoData[road].locked) {
                console.log(`🚛 [${road}] Piezo tap ignored — already locked`);
            }
        } catch (e) { console.error('⚠️ Piezo parse error:', e.message); }
    }

    // Rain: traffic/rain/<road> or traffic/rain/all
    if (topic.startsWith('traffic/rain/')) {
        try {
            const data = JSON.parse(payload);
            const newRain = data.rainDetected || false;
            if (newRain !== rainDetected) {
                rainDetected = newRain;
                yellowTime   = rainDetected ? 5 : 3;
                console.log(`🌧️ Rain: ${rainDetected ? 'RAINING (Yellow 5s)' : 'DRY (Yellow 3s)'}`);
                io.emit('rainUpdate', { rainDetected, yellowTime });
            }
        } catch (e) { console.error('⚠️ Rain parse error:', e.message); }
    }

    // Pedestrian: traffic/pedestrian/<road> (not cmd)
    if (topic.startsWith('traffic/pedestrian/') && !topic.includes('/cmd/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;

            if (data.requested && !pedStatus[road].requested && !pedStatus[road].crossing) {
                pedStatus[road].requested = true;
                console.log(`🚶 Ped button [${road}] during ${livePhase[road]}`);
                if (livePhase[road] === 'RED') {
                    const rem = liveCountdown[road] || 0;
                    if (rem > 3) _startPedCrossing(road, 3);
                    else io.emit('pedestrianUpdate', { road, ...pedStatus[road], action: 'WAIT_TOO_SHORT_RED' });
                } else if (livePhase[road] === 'YELLOW') {
                    const rem = liveCountdown[road] || 0;
                    aedes.publish({
                        topic:   `traffic/pedestrian/cmd/${road}`,
                        payload: Buffer.from(JSON.stringify({ action: 'SHOW_YELLOW_COUNTDOWN', duration: rem })),
                        qos: 1
                    }, () => {});
                    io.emit('pedestrianUpdate', { road, ...pedStatus[road], action: 'WAIT_YELLOW_THEN_CROSS' });
                } else {
                    io.emit('pedestrianUpdate', { road, ...pedStatus[road], action: 'WAIT_FOR_GREEN_END' });
                }
            }

            if (data.crossing !== undefined) {
                if (data.crossing  && !pedStatus[road].crossing) _startPedCrossing(road, data.duration || 3);
                if (!data.crossing &&  pedStatus[road].crossing) _endPedCrossing(road);
            }

            io.emit('pedestrianUpdate', { road, ...pedStatus[road] });
        } catch (e) { console.error('⚠️ Pedestrian parse error:', e.message); }
    }

    // LED state from ESP32: traffic/state/<road>
    if (topic.startsWith('traffic/state/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            livePhase[road] = data.state;
            io.emit('ledStateUpdate', { road, state: data.state });
        } catch (e) { console.error('⚠️ State parse error:', e.message); }
    }
});

// ════════════════════════════════════════════════════════════════════════════
// MAIN CYCLE ENGINE
// ════════════════════════════════════════════════════════════════════════════

function runOneCycle() {
    if (forceOverride && forceOverride.active) return;

    const fallbackPeek = peekFallbackRoad();

    const decision = makeSignalDecision(
        usData,
        usWorking,
        piezoData,
        rainDetected,
        pedStatus,
        espOnline,
        lastWinnerRoad,
        fallbackPeek
    );

    if (decision.mode === 'FALLBACK') {
        getNextFallbackRoad();
        console.log(`🔄 FALLBACK mode — pointer advanced. Next fallback: ${peekFallbackRoad()}`);
    }

    latestDecision = decision;
    nextWinnerRoad = null;

    const winner    = decision.winner;
    const greenDur  = decision.greenDuration;
    const yellowDur = decision.yellowDuration;
    const dynamicRedTime = 2 + greenDur + yellowDur;

    currentWinner = winner;
    currentPhase  = 'ALL_RED';

    console.log(`\n╔══════════════════════════════════════════════════════╗`);
    console.log(`║  NEW CYCLE  Winner: ${winner.padEnd(5)} | Mode: ${decision.mode.padEnd(12)} ║`);
    console.log(`║  Green: ${greenDur}s  Yellow: ${yellowDur}s  OtherRED: ${dynamicRedTime}s              ║`);
    console.log(`║  AllESP32Online: ${JSON.stringify(espOnline)}  ║`);
    console.log(`╚══════════════════════════════════════════════════════╝`);

    io.emit('newDecision', decision);

    ROADS.forEach(road => {
        sendCommandToRoad(road, 'RED', 0, yellowDur, dynamicRedTime);
        livePhase[road] = 'RED';
    });
    ROADS.filter(r => r !== winner).forEach(road => {
        startCountdown(road, 'RED', dynamicRedTime);
    });
    startCountdown(winner, 'RED', 3);
    broadcastFullState();

    // Pre-green yellow (2s)
    phaseTimer = setTimeout(() => {
        currentPhase = 'PRE_GREEN_YELLOW';
        sendCommandToRoad(winner, 'YELLOW', 0, 2, 0);
        livePhase[winner] = 'YELLOW';
        startCountdown(winner, 'YELLOW', 2);
        broadcastFullState();

        // GREEN phase
        phaseTimer = setTimeout(() => {
            currentPhase = 'GREEN';
            sendCommandToRoad(winner, 'GREEN', greenDur, yellowDur, 0);
            livePhase[winner] = 'GREEN';
            startCountdown(winner, 'GREEN', greenDur);
            console.log(`🟢 [CYCLE] ${winner} GREEN ${greenDur}s`);
            broadcastFullState();

            // Post-green yellow
            phaseTimer = setTimeout(() => {
                currentPhase = 'POST_GREEN_YELLOW';

                if (piezoData[winner] && piezoData[winner].heavy) {
                    clearPiezoForRoad(winner);
                }

                lastWinnerRoad = winner;

                // Preview next winner
                const nextFallbackPeek = peekFallbackRoad();
                const nextDec = makeSignalDecision(
                    usData, usWorking, piezoData, rainDetected,
                    pedStatus, espOnline, lastWinnerRoad, nextFallbackPeek
                );
                nextWinnerRoad = nextDec.winner;
                nextDecision   = nextDec;

                console.log(`🟡 [CYCLE] ${winner} POST-GREEN YELLOW ${yellowDur}s | NEXT PREVIEW: ${nextWinnerRoad}`);
                sendCommandToRoad(winner, 'YELLOW', 0, yellowDur, 0);
                livePhase[winner] = 'YELLOW';
                startCountdown(winner, 'YELLOW', yellowDur);
                io.emit('nextWinnerPreview', { nextWinner: nextWinnerRoad, nextDecision: nextDec });
                broadcastFullState();

                // Cycle end
                phaseTimer = setTimeout(() => {
                    currentPhase = 'CYCLE_END';
                    sendCommandToRoad(winner, 'RED', 0, 0, 0);
                    livePhase[winner]    = 'RED';
                    liveCountdown[winner] = 0;

                    console.log(`🔴 [CYCLE END] ${winner} → RED`);

                    ROADS.forEach(road => {
                        if (pedStatus[road].requested && !pedStatus[road].crossing) {
                            _startPedCrossing(road, 3);
                        }
                    });

                    broadcastFullState();

                    phaseTimer = setTimeout(async () => {
                        for (const road of ROADS) {
                            const ql = usData[road].us1Stable && usData[road].us2Stable
                                ? 'Heavy' : usData[road].us1Stable ? 'Light' : 'None';
                            await saveAnalyticsRecord(road, {
                                distanceCm:    usData[road].us1Raw || 999,
                                queueLevel:    ql,
                                googleTraffic: googleTraffic[road] || 'Unknown',
                                rainDetected:  rainDetected,
                                greenTime:     decision.greenDuration || 3,
                                waitTime:      dynamicRedTime,
                                isWinner:      currentWinner === road,
                                systemMode:    decision.mode || 'FALLBACK'
                            });
                        }
                        runOneCycle();
                    }, 1000);

                }, yellowDur * 1000);

            }, greenDur * 1000);

        }, 2000);

    }, 1000);
}

// ════════════════════════════════════════════════════════════════════════════
// FORCE OVERRIDE
// ════════════════════════════════════════════════════════════════════════════
function applyForceOverride(road, command, duration) {
    console.log(`🚨 FORCE OVERRIDE: ${road} → ${command} ${duration}s`);
    if (phaseTimer) clearTimeout(phaseTimer);
    stopAllCountdowns();

    const overrideRed = command === 'GREEN' ? (duration + yellowTime) : duration;
    ROADS.forEach(r => {
        if (r !== road) {
            sendCommandToRoad(r, 'RED', 0, 0, overrideRed);
            livePhase[r] = 'RED';
            startCountdown(r, 'RED', overrideRed);
        }
    });

    forceOverride = { road, command, duration, active: true };

    setTimeout(() => {
        sendCommandToRoad(road, command, duration, yellowTime, 0);
        livePhase[road] = command;
        startCountdown(road, command, duration);
        broadcastFullState();

        setTimeout(() => {
            console.log('✅ Force override ended — resuming normal cycle');
            forceOverride = null;
            ROADS.forEach(r => {
                sendCommandToRoad(r, 'RED', 0, 0, 0);
                livePhase[r]     = 'RED';
                liveCountdown[r] = 0;
            });
            broadcastFullState();
            setTimeout(() => runOneCycle(), 2000);
        }, duration * 1000);

    }, 500);
}

// ════════════════════════════════════════════════════════════════════════════
// GOOGLE TRAFFIC REFRESH (display only)
// ════════════════════════════════════════════════════════════════════════════
async function refreshGoogleTraffic() {
    try {
        const result = await getAllTrafficConditions();
        googleWorking = Object.values(result).some(v => v !== 'Unknown');
        googleTraffic = result;
        console.log(`🗺️ Google (display only): N=${result.North} S=${result.South} E=${result.East} W=${result.West}`);
        io.emit('googleTrafficUpdate', { googleTraffic, googleWorking });
    } catch (err) {
        googleWorking = false;
        console.log('⚠️ Google Traffic unavailable');
    }
}

// ════════════════════════════════════════════════════════════════════════════
// API ROUTES
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/traffic', (req, res) => {
    res.json({
        usData, googleTraffic, livePhase, liveCountdown,
        usWorking, googleWorking, currentDecision: latestDecision,
        piezoData, rainDetected, yellowTime, pedStatus, espOnline,
        currentWinner, nextWinnerRoad, lastWinnerRoad, currentPhase
    });
});
app.get('/api/decision',    (req, res) => res.json(latestDecision || { message: 'No decision yet' }));
app.get('/api/us-data',     (req, res) => res.json(usData));
app.get('/api/rain-status', (req, res) => res.json({ rainDetected, yellowTime }));
app.get('/api/esp-status',  (req, res) => res.json({ espOnline, espLastSeen }));

app.post('/api/traffic/control', (req, res) => {
    const { location, command, duration } = req.body;
    if (!ROADS.includes(location))                   return res.status(400).json({ error: 'Invalid road' });
    if (!['RED','YELLOW','GREEN'].includes(command)) return res.status(400).json({ error: 'Invalid command' });
    const dur = parseInt(duration) || 30;
    applyForceOverride(location, command, dur);
    res.json({ message: `Force ${command} on ${location} for ${dur}s`, location, command, duration: dur });
});

app.post('/api/system/resume', (req, res) => {
    forceOverride = null;
    if (phaseTimer) clearTimeout(phaseTimer);
    ROADS.forEach(r => {
        sendCommandToRoad(r, 'RED', 0, 0, 0);
        livePhase[r]     = 'RED';
        liveCountdown[r] = 0;
    });
    setTimeout(() => runOneCycle(), 2000);
    res.json({ message: 'Normal cycle resumed' });
});

app.get('/api/analytics/peak-hours',        async (req, res) => { try { res.json(await getPeakHourAnalysis());    } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/analytics/road-performance',  async (req, res) => { try { res.json(await getRoadPerformance());     } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/analytics/live-trend',        async (req, res) => { try { res.json(await getLiveCongestionTrend()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/analytics/system-efficiency', async (req, res) => { try { res.json(await getSystemEfficiency());   } catch (e) { res.status(500).json({ error: e.message }); } });

app.get('/api/health', (req, res) => {
    res.json({
        status: 'online', googleWorking, usWorking,
        currentWinner, nextWinnerRoad, lastWinnerRoad,
        currentPhase, uptime: process.uptime(),
        rainDetected, yellowTime, espOnline, espLastSeen,
        fallbackPointer: _fallbackPointer
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
});

// ════════════════════════════════════════════════════════════════════════════
// SOCKET.IO
// ════════════════════════════════════════════════════════════════════════════
io.on('connection', socket => {
    console.log('🖥️  Dashboard connected:', socket.id);
    socket.emit('fullState', {
        livePhase, liveCountdown, latestDecision, nextWinnerRoad,
        usData, googleTraffic, usWorking, googleWorking,
        piezoData, rainDetected, yellowTime, pedStatus, espOnline, currentPhase
    });
    socket.on('disconnect', () => console.log('🖥️  Dashboard disconnected:', socket.id));
});

// ════════════════════════════════════════════════════════════════════════════
// STARTUP
// ════════════════════════════════════════════════════════════════════════════
mqttServer.listen(MQTT_PORT, () => console.log(`📡 MQTT Broker on port ${MQTT_PORT}`));
httpServer.listen(PORT,      () => console.log(`✅  Server on port ${PORT}`));

setTimeout(async () => {
    console.log('\n🚦 Starting HYDRA v9.1 FIXED...');
    await refreshGoogleTraffic();
    setInterval(refreshGoogleTraffic, 15 * 60 * 1000);
    runOneCycle();
}, 3000);

setInterval(broadcastFullState, 2000);

// FIX: Health check every 5s with 10s timeout (was 15s/60s)
setInterval(() => {
    const now = Date.now();
    ROADS.forEach(road => {
        const age = now - espLastSeen[road];
        if (espOnline[road] && (espLastSeen[road] === 0 || age > ESP32_TIMEOUT_MS)) {
            // Double-check: only mark offline if health check confirms timeout
            // (disconnect event should have already fired, this is the safety net)
            markRoadOffline(road);
            console.log(`⚠️  [${road}] Health check timeout — age=${Math.round(age/1000)}s`);
        }
    });
}, 5000);

// Piezo safety release (10 min)
setInterval(() => {
    const now = Date.now();
    ROADS.forEach(road => {
        if (piezoData[road].locked && (now - piezoData[road].timestamp) > PIEZO_SAFETY_WINDOW_MS) {
            console.log(`⚠️  [${road}] Piezo safety-release (10-min timeout)`);
            clearPiezoForRoad(road);
        }
    });
}, 60000);

// Analytics broadcast every 30s
setInterval(async () => {
    try {
        const [peakHours, roadPerf, efficiency] = await Promise.all([
            getPeakHourAnalysis(), getRoadPerformance(), getSystemEfficiency()
        ]);
        io.emit('analyticsUpdate', { peakHours, roadPerf, efficiency });
    } catch (err) { console.error('Analytics broadcast error:', err.message); }
}, 30000);