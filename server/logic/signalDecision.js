// // server/logic/signalDecision.js — HYDRA v7.0
// // PIEZO FIX:
// //   - Reads piezoData[road].heavy (structured object, not plain boolean)
// //   - IR1 only + Piezo  → 3s base + 3s IR light + 3s piezo  = 9s total
// //   - Both IR  + Piezo  → 3s base + 6s IR heavy + 3s piezo  = 12s total
// //   - Piezo alone (no IR) does NOT contribute — IR check required
// //   - Priority score also boosted when piezo active

// const BASE_GREEN_TIME        = 3;
// const BASE_YELLOW_TIME       = 3;
// const RAIN_YELLOW_EXTRA      = 2;
// const LIGHT_TRAFFIC_BONUS    = 3;    // IR1 blocked only
// const HEAVY_TRAFFIC_BONUS    = 6;    // Both IR blocked
// const PIEZO_BONUS            = 3;    // Stacked on top of IR green time (IR must be blocked)
// const SENSOR_MAX_RANGE       = 400;
// const IR_MODE_THRESHOLD      = 20;
// const DEFAULT_GREEN          = 5;
// const MIN_GREEN_ULTRASONIC   = 10;
// const MAX_GREEN_ULTRASONIC   = 60;
// const FALLBACK_GREEN         = 5;
// const YELLOW_TIME_DRY        = BASE_YELLOW_TIME;
// const YELLOW_TIME_RAIN       = BASE_YELLOW_TIME + RAIN_YELLOW_EXTRA;

// const IR_SCORE_BASE          = 1000;
// const ULTRASONIC_MAX_SCORE   = 500;

// // ── Sensor mode selector ──────────────────────────────────────────────────
// function selectSensorMode(distanceCm) {
//     if (distanceCm === null || distanceCm === undefined) return 'ULTRASONIC';
//     if (distanceCm >= SENSOR_MAX_RANGE) return 'ULTRASONIC';
//     if (distanceCm < IR_MODE_THRESHOLD) return 'IR';
//     return 'ULTRASONIC';
// }

// // ── Ultrasonic: shorter distance = higher score ───────────────────────────
// function calculateScoreUltrasonic(distanceCm, googleTraffic) {
//     let score = 0;
//     if (distanceCm !== null && distanceCm < SENSOR_MAX_RANGE) {
//         score += (SENSOR_MAX_RANGE - distanceCm);
//     }
//     return Math.min(score, ULTRASONIC_MAX_SCORE);
// }

// function calculateGreenTimeUltrasonic(distanceCm, googleTraffic) {
//     if (distanceCm === null || distanceCm >= SENSOR_MAX_RANGE) {
//         if (googleTraffic === 'Heavy')  return 40;
//         if (googleTraffic === 'Medium') return 25;
//         if (googleTraffic === 'Light')  return MIN_GREEN_ULTRASONIC;
//         return DEFAULT_GREEN;
//     }
//     const distanceFactor = (distanceCm / SENSOR_MAX_RANGE) * 20;
//     let greenTime = MIN_GREEN_ULTRASONIC + distanceFactor;
//     if (googleTraffic === 'Heavy') {
//         greenTime = Math.max(greenTime * 0.7, MIN_GREEN_ULTRASONIC);
//     } else if (googleTraffic === 'Light') {
//         greenTime = Math.min(greenTime * 1.2, MAX_GREEN_ULTRASONIC);
//     }
//     return Math.round(Math.min(Math.max(greenTime, MIN_GREEN_ULTRASONIC), MAX_GREEN_ULTRASONIC));
// }

// // ── IR mode: score starts at IR_SCORE_BASE — always beats ultrasonic ──────
// //
// // piezoHeavy: boolean derived from piezoData[road].heavy
// // IR must be blocked for piezo to count (enforced in makeSignalDecision
// // before calling this, and also redundantly checked here for safety)
// function calculateScoreIR(ir1Blocked, ir2Blocked, piezoHeavy, googleTraffic) {
//     let score = IR_SCORE_BASE;

//     if (ir1Blocked && ir2Blocked) {
//         score += 200;
//         if (piezoHeavy) score += 100; // confirmed heavy vehicle on heavy queue
//     } else if (ir1Blocked) {
//         score += 100;
//         if (piezoHeavy) score += 50;  // confirmed heavy vehicle on light queue
//     } else {
//         score += 10; // in IR range, no vehicle in IR zone
//     }

//     return score;
// }

// // ── IR mode green time (v7.0 corrected stacking) ─────────────────────────
// //
// // Calculation table:
// //   No IR blocked           → 3s  (base only)
// //   IR1 only, no piezo      → 3 + 3 = 6s
// //   IR1 + piezo             → 3 + 3 + 3 = 9s   ← NEW
// //   Both IR, no piezo       → 3 + 6 = 9s
// //   Both IR + piezo         → 3 + 6 + 3 = 12s  ← NEW
// //
// // IMPORTANT: piezo bonus only applies when at least IR1 is blocked.
// // Piezo alone (no IR) returns base green time only.
// function calculateGreenTimeIR(ir1Blocked, ir2Blocked, piezoHeavy) {
//     let greenTime = BASE_GREEN_TIME; // 3s base always

//     if (ir1Blocked && ir2Blocked) {
//         greenTime += HEAVY_TRAFFIC_BONUS; // + 6s = 9s
//     } else if (ir1Blocked) {
//         greenTime += LIGHT_TRAFFIC_BONUS; // + 3s = 6s
//     }
//     // else: no IR blocked → stay at 3s base (piezo cannot help alone)

//     // Piezo stacks on top ONLY when at least IR1 is blocked
//     if (piezoHeavy && ir1Blocked) {
//         greenTime += PIEZO_BONUS; // + 3s
//     }

//     return greenTime;
// }

// // ── System mode determination ─────────────────────────────────────────────
// function determineSystemMode(sensorWorking, googleWorking) {
//     const anySensor = Object.values(sensorWorking || {}).some(v => v === true);
//     const google    = googleWorking === true;
//     if (anySensor && google)   return 'BOTH';
//     if (anySensor && !google)  return 'SENSOR_ONLY';
//     if (!anySensor && google)  return 'GOOGLE_ONLY';
//     return 'FALLBACK';
// }

// // ════════════════════════════════════════════════════════════════════════════
// // MAIN DECISION FUNCTION
// // ════════════════════════════════════════════════════════════════════════════
// //
// // piezoData: { North: { heavy, timestamp, locked }, South: ..., ... }
// //   — heavy=true means a confirmed (IR+vibration) heavy vehicle is waiting
// //   — locked=true means subsequent taps have been suppressed
// //   — The server sets heavy=false and locked=false after the extended green ends
// //
// function makeSignalDecision(
//     sensorData, trafficData, sensorWorking, googleWorking,
//     irData, piezoData, rainDetected, pedStatus, espStatus
// ) {
//     const ROADS      = ['North', 'South', 'East', 'West'];
//     const systemMode = determineSystemMode(sensorWorking || {}, googleWorking || false);
//     const currentYellowTime = rainDetected ? YELLOW_TIME_RAIN : YELLOW_TIME_DRY;

//     const ir    = irData    || {};
//     const piezo = piezoData || {};
//     const ped   = pedStatus || {};
//     const esp   = espStatus || {};

//     let priorities = [];

//     if (systemMode === 'FALLBACK') {
//         priorities = ROADS.map((road, i) => ({
//             road,
//             sensorScenario: 'NO_DATA',
//             distance: null,
//             ir1Blocked: false, ir2Blocked: false, piezoHeavy: false,
//             traffic: 'Unknown',
//             score: ROADS.length - i,
//             greenTime: FALLBACK_GREEN,
//             yellowTime: currentYellowTime,
//             mode: 'FALLBACK',
//             espOnline: esp[road] !== false
//         }));

//     } else if (systemMode === 'GOOGLE_ONLY') {
//         priorities = ROADS.map(road => {
//             const google = (trafficData || {})[road] || 'Unknown';
//             const score  = calculateScoreUltrasonic(null, google);
//             const green  = calculateGreenTimeUltrasonic(null, google);
//             return {
//                 road,
//                 sensorScenario: 'GOOGLE_ONLY',
//                 distance: null,
//                 ir1Blocked: false, ir2Blocked: false, piezoHeavy: false,
//                 traffic: google, score, greenTime: green,
//                 yellowTime: currentYellowTime,
//                 mode: 'GOOGLE_ONLY',
//                 espOnline: esp[road] !== false
//             };
//         });

//     } else {
//         priorities = ROADS.map(road => {
//             const espOnline       = esp[road] !== false;
//             const sensorIsWorking = (sensorWorking || {})[road] === true;

//             const rawDist    = (sensorData || {})[road];
//             const distanceCm = (rawDist === undefined || rawDist === null || rawDist >= SENSOR_MAX_RANGE)
//                                 ? null : rawDist;

//             const google  = (trafficData || {})[road] || 'Unknown';
//             const irRoad  = ir[road] || { ir1Blocked: false, ir2Blocked: false };

//             // ── Extract piezoHeavy from structured piezoData object ────────
//             // piezoData[road] is { heavy: bool, timestamp: number, locked: bool }
//             // heavy=true only when IR is also blocked (enforced at MQTT handler)
//             // We trust the server's locked+IR enforcement, but double-check IR here
//             const piezoRoad  = piezo[road] || { heavy: false, timestamp: 0, locked: false };
//             const piezoHeavy = (piezoRoad.heavy === true) &&
//                                (irRoad.ir1Blocked || irRoad.ir2Blocked); // belt-and-braces

//             const pedRoad = ped[road] || { requested: false, crossing: false };

//             let sensorScenario, score, greenTime;

//             if (!espOnline || !sensorIsWorking) {
//                 if (googleWorking) {
//                     sensorScenario = 'GOOGLE_ONLY';
//                     score          = calculateScoreUltrasonic(null, google);
//                     greenTime      = calculateGreenTimeUltrasonic(null, google);
//                 } else {
//                     sensorScenario = 'NO_DATA';
//                     score          = ROADS.length - ROADS.indexOf(road);
//                     greenTime      = FALLBACK_GREEN;
//                 }
//             } else {
//                 sensorScenario = selectSensorMode(distanceCm);

//                 if (sensorScenario === 'IR') {
//                     score     = calculateScoreIR(
//                                     irRoad.ir1Blocked, irRoad.ir2Blocked,
//                                     piezoHeavy,
//                                     systemMode === 'BOTH' ? google : 'Unknown'
//                                 );
//                     greenTime = calculateGreenTimeIR(
//                                     irRoad.ir1Blocked, irRoad.ir2Blocked, piezoHeavy
//                                 );
//                 } else {
//                     score     = calculateScoreUltrasonic(distanceCm, google);
//                     greenTime = calculateGreenTimeUltrasonic(distanceCm, google);
//                 }
//             }

//             // Downed ESP32: exclude from winning
//             if (!espOnline) {
//                 score = -9999;
//             }

//             // Pedestrian override
//             if (pedRoad.crossing) {
//                 score    -= 1000;
//                 greenTime = 0;
//             } else if (pedRoad.requested) {
//                 score += 100;
//             }

//             return {
//                 road, sensorScenario,
//                 distance:   espOnline && sensorIsWorking ? distanceCm : null,
//                 ir1Blocked: espOnline ? (irRoad.ir1Blocked  || false) : false,
//                 ir2Blocked: espOnline ? (irRoad.ir2Blocked  || false) : false,
//                 piezoHeavy: espOnline ? piezoHeavy          : false,
//                 // Expose piezo timestamp so dashboard can show "tap X minutes ago" if desired
//                 piezoTimestamp: piezoRoad.timestamp || 0,
//                 traffic: google,
//                 score, greenTime,
//                 yellowTime: currentYellowTime,
//                 mode: systemMode,
//                 pedestrian: pedRoad,
//                 espOnline
//             };
//         });
//     }

//     priorities.sort((a, b) => b.score - a.score);
//     const winner = priorities[0];

//     const commands = {};
//     ROADS.forEach(road => {
//         commands[road] = road === winner.road
//             ? { signal: 'GREEN', greenTime: winner.greenTime, yellowTime: currentYellowTime }
//             : { signal: 'RED',   greenTime: 0, yellowTime: 0 };
//     });

//     return {
//         timestamp:      new Date().toISOString(),
//         mode:           systemMode,
//         winner:         winner.road,
//         winnerScenario: winner.sensorScenario,
//         greenDuration:  winner.greenTime,
//         yellowDuration: currentYellowTime,
//         redForOthers:   winner.greenTime + currentYellowTime,
//         priorities, commands,
//         dataStatus: { sensorWorking, googleWorking },
//         weather:    { rainDetected: rainDetected || false, yellowTime: currentYellowTime }
//     };
// }

// module.exports = {
//     makeSignalDecision, selectSensorMode,
//     calculateGreenTimeUltrasonic, calculateGreenTimeIR,
//     calculateScoreUltrasonic, calculateScoreIR,
//     determineSystemMode,
//     // Constants — exported for tests and dashboard display
//     IR_MODE_THRESHOLD, BASE_GREEN_TIME,
//     LIGHT_TRAFFIC_BONUS, HEAVY_TRAFFIC_BONUS, PIEZO_BONUS,
//     YELLOW_TIME_DRY, YELLOW_TIME_RAIN,
//     MIN_GREEN_ULTRASONIC, MAX_GREEN_ULTRASONIC,
//     IR_SCORE_BASE, SENSOR_MAX_RANGE
// };


// server/logic/signalDecision.js — HYDRA v8.0 Dual Ultrasonic Queue Detection
//
// SENSOR LOGIC (prototype scale):
//   US1 placed 5cm back from stop line, pointing across 7cm road width
//   US2 placed 15cm back from stop line, pointing across 7cm road width
//   Vehicle present = distance < 7cm held stable for 5s
//
//   US1 blocked only              → Light traffic  → +3s green (total 6s)
//   US1 + US2 both blocked        → Heavy traffic  → +6s green (total 9s)
//   US2 blocked but US1 not       → Ignored (not a valid queue)
//   Neither blocked               → No traffic     → 3s base green
//
//   Piezo + US1 blocked           → +3s stacked on top of above
//
// FALLBACK (no ESP32 connected):
//   Round-robin: North → South → East → West → North (3s each, equal)
//
// PRIORITY DECISION:
//   Queue data (US1/US2) + Google traffic + Piezo
//   No more distance-based scoring or IR/ULTRASONIC mode switching

'use strict';

// ── Timing constants ──────────────────────────────────────────────────────────
const BASE_GREEN          = 3;   // seconds
const LIGHT_BONUS         = 3;   // US1 only blocked
const HEAVY_BONUS         = 6;   // US1 + US2 both blocked
const PIEZO_BONUS         = 3;   // US1 + piezo both active
const BASE_YELLOW         = 3;
const RAIN_YELLOW_EXTRA   = 2;
const FALLBACK_GREEN      = 3;   // round-robin fallback

// ── Score constants ───────────────────────────────────────────────────────────
const SCORE_HEAVY         = 300;
const SCORE_LIGHT         = 150;
const SCORE_NONE          = 50;
const SCORE_PIEZO_BONUS   = 80;
const SCORE_GOOGLE_HEAVY  = -40; // penalise: downstream jammed, hold back
const SCORE_GOOGLE_MEDIUM = 20;
const SCORE_GOOGLE_LIGHT  = 60;
const SCORE_PED_CROSSING  = -9999;
const SCORE_PED_WAITING   = 100;
const SCORE_ESP_OFFLINE   = -99999;

const ROADS = ['North', 'South', 'East', 'West'];

// ── Round-robin state for fallback ────────────────────────────────────────────
let _fallbackIndex = 0;

// ── Determine system mode ─────────────────────────────────────────────────────
function determineSystemMode(usWorking, googleWorking) {
    const anyUS = Object.values(usWorking || {}).some(v => v === true);
    const goog  = googleWorking === true;
    if (anyUS && goog)   return 'BOTH';
    if (anyUS && !goog)  return 'SENSOR_ONLY';
    if (!anyUS && goog)  return 'GOOGLE_ONLY';
    return 'FALLBACK';
}

// ── Queue level helper ────────────────────────────────────────────────────────
// us1Stable: boolean — US1 has been < 7cm for ≥ 5s (confirmed by ESP32)
// us2Stable: boolean — US2 has been < 7cm for ≥ 5s (confirmed by ESP32)
//
// Returns: 'Heavy' | 'Light' | 'None'
function queueLevel(us1Stable, us2Stable) {
    if (us1Stable && us2Stable) return 'Heavy';
    if (us1Stable)              return 'Light';
    return 'None';                             // US2 alone = ignored
}

// ── Green time from queue level + piezo ──────────────────────────────────────
function calcGreenTime(us1Stable, us2Stable, piezoHeavy) {
    let g = BASE_GREEN;

    if (us1Stable && us2Stable) {
        g += HEAVY_BONUS;          // 3 + 6 = 9s
    } else if (us1Stable) {
        g += LIGHT_BONUS;          // 3 + 3 = 6s
    }
    // US2 alone → stays at 3s base

    if (piezoHeavy && us1Stable) {
        g += PIEZO_BONUS;          // +3s stacked (US1 must be active)
    }

    return g;
}

// ── Priority score for a road ─────────────────────────────────────────────────
function calcScore(us1Stable, us2Stable, piezoHeavy, googleTraffic, pedStatus) {
    const level = queueLevel(us1Stable, us2Stable);

    let score = 0;
    if (level === 'Heavy') score += SCORE_HEAVY;
    else if (level === 'Light') score += SCORE_LIGHT;
    else score += SCORE_NONE;

    if (piezoHeavy && us1Stable) score += SCORE_PIEZO_BONUS;

    if (googleTraffic === 'Heavy')  score += SCORE_GOOGLE_HEAVY;
    else if (googleTraffic === 'Medium') score += SCORE_GOOGLE_MEDIUM;
    else if (googleTraffic === 'Light')  score += SCORE_GOOGLE_LIGHT;

    if (pedStatus && pedStatus.crossing)  score += SCORE_PED_CROSSING;
    if (pedStatus && pedStatus.requested && !pedStatus.crossing) score += SCORE_PED_WAITING;

    return score;
}

// ── Scenario badge (replaces old IR/ULTRASONIC badges) ───────────────────────
function scenarioBadge(us1Stable, us2Stable, piezoHeavy, espOnline, usWorking, googleWorking) {
    if (!espOnline || !usWorking) {
        return googleWorking ? 'GOOGLE_ONLY' : 'NO_DATA';
    }
    const level = queueLevel(us1Stable, us2Stable);
    if (level === 'Heavy') return piezoHeavy ? 'QUEUE_HEAVY_PIEZO' : 'QUEUE_HEAVY';
    if (level === 'Light') return piezoHeavy ? 'QUEUE_LIGHT_PIEZO' : 'QUEUE_LIGHT';
    return 'QUEUE_NONE';
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN DECISION FUNCTION
// ════════════════════════════════════════════════════════════════════════════
//
// usData    : { North: { us1Stable, us2Stable }, ... }
//             us1Stable/us2Stable = true when confirmed blocked for ≥ 5s
// usWorking : { North: bool, ... }  — is the ESP32 sending data?
// piezoData : { North: { heavy, timestamp, locked }, ... }
// pedStatus : { North: { requested, crossing }, ... }
// espStatus : { North: bool, ... }
//
function makeSignalDecision(
    usData,
    trafficData,
    usWorking,
    googleWorking,
    piezoData,
    rainDetected,
    pedStatus,
    espStatus
) {
    const currentYellow = rainDetected
        ? BASE_YELLOW + RAIN_YELLOW_EXTRA
        : BASE_YELLOW;

    const systemMode = determineSystemMode(usWorking, googleWorking);

    const us   = usData    || {};
    const piezo = piezoData || {};
    const ped   = pedStatus || {};
    const esp   = espStatus || {};
    const goog  = trafficData || {};

    let priorities = [];

    // ── FALLBACK: no sensors, no google → round-robin ────────────────────────
    if (systemMode === 'FALLBACK') {
        const winnerRoad = ROADS[_fallbackIndex % ROADS.length];
        priorities = ROADS.map((road, i) => ({
            road,
            sensorScenario: 'NO_DATA',
            us1Stable: false,
            us2Stable: false,
            queueLevel: 'None',
            piezoHeavy: false,
            traffic: 'Unknown',
            score: road === winnerRoad ? 4 : ROADS.length - i,
            greenTime: FALLBACK_GREEN,
            yellowTime: currentYellow,
            mode: 'FALLBACK',
            espOnline: esp[road] !== false
        }));
        _fallbackIndex = (_fallbackIndex + 1) % ROADS.length;

    // ── GOOGLE ONLY: no ESP32 anywhere ───────────────────────────────────────
    } else if (systemMode === 'GOOGLE_ONLY') {
        const googleScoreMap = { Heavy: 10, Medium: 50, Light: 80, Unknown: 20 };
        const googleGreenMap = { Heavy: 9, Medium: 6, Light: 3, Unknown: 3 };

        priorities = ROADS.map(road => {
            const g = goog[road] || 'Unknown';
            return {
                road,
                sensorScenario: 'GOOGLE_ONLY',
                us1Stable: false,
                us2Stable: false,
                queueLevel: 'None',
                piezoHeavy: false,
                traffic: g,
                score: googleScoreMap[g] || 20,
                greenTime: googleGreenMap[g] || 3,
                yellowTime: currentYellow,
                mode: 'GOOGLE_ONLY',
                espOnline: esp[road] !== false
            };
        });

    // ── SENSOR_ONLY or BOTH ───────────────────────────────────────────────────
    } else {
        priorities = ROADS.map(road => {
            const espOnline   = esp[road] !== false;
            const usOnline    = (usWorking || {})[road] === true;
            const roadUS      = us[road]  || { us1Stable: false, us2Stable: false };
            const piezoRoad   = piezo[road] || { heavy: false, timestamp: 0, locked: false };
            const pedRoad     = ped[road]   || { requested: false, crossing: false };
            const google      = goog[road]  || 'Unknown';

            // Piezo only counts when US1 is also stable
            const us1Stable   = espOnline && usOnline ? (roadUS.us1Stable || false) : false;
            const us2Stable   = espOnline && usOnline ? (roadUS.us2Stable || false) : false;
            const piezoHeavy  = (piezoRoad.heavy === true) && us1Stable;

            let score, greenTime, badge;

            if (!espOnline) {
                // Offline ESP32: excluded from winning
                score     = SCORE_ESP_OFFLINE;
                greenTime = FALLBACK_GREEN;
                badge     = 'NO_DATA';
            } else if (!usOnline) {
                // ESP32 online but no US data yet
                if (googleWorking) {
                    const googleGreenMap = { Heavy: 9, Medium: 6, Light: 3, Unknown: 3 };
                    score     = { Heavy: 10, Medium: 50, Light: 80, Unknown: 20 }[google] || 20;
                    greenTime = googleGreenMap[google] || 3;
                    badge     = 'GOOGLE_ONLY';
                } else {
                    score     = SCORE_NONE;
                    greenTime = FALLBACK_GREEN;
                    badge     = 'NO_DATA';
                }
            } else {
                score     = calcScore(us1Stable, us2Stable, piezoHeavy, google, pedRoad);
                greenTime = calcGreenTime(us1Stable, us2Stable, piezoHeavy);
                badge     = scenarioBadge(us1Stable, us2Stable, piezoHeavy, espOnline, usOnline, googleWorking);
            }

            // Ped crossing override (score already handles it, but zero green time too)
            if (pedRoad.crossing) greenTime = 0;

            return {
                road,
                sensorScenario: badge,
                us1Stable,
                us2Stable,
                queueLevel: queueLevel(us1Stable, us2Stable),
                piezoHeavy,
                piezoTimestamp: piezoRoad.timestamp || 0,
                traffic: google,
                score,
                greenTime,
                yellowTime: currentYellow,
                mode: systemMode,
                pedestrian: pedRoad,
                espOnline
            };
        });
    }

    // Sort by score descending
    priorities.sort((a, b) => b.score - a.score);
    const winner = priorities[0];

    const commands = {};
    ROADS.forEach(road => {
        commands[road] = road === winner.road
            ? { signal: 'GREEN', greenTime: winner.greenTime, yellowTime: currentYellow }
            : { signal: 'RED',   greenTime: 0,                yellowTime: 0 };
    });

    return {
        timestamp:      new Date().toISOString(),
        mode:           systemMode,
        winner:         winner.road,
        winnerScenario: winner.sensorScenario,
        greenDuration:  winner.greenTime,
        yellowDuration: currentYellow,
        redForOthers:   winner.greenTime + currentYellow,
        priorities,
        commands,
        dataStatus: { usWorking, googleWorking },
        weather:    { rainDetected: rainDetected || false, yellowTime: currentYellow }
    };
}

module.exports = {
    makeSignalDecision,
    queueLevel,
    calcGreenTime,
    calcScore,
    determineSystemMode,
    BASE_GREEN,
    LIGHT_BONUS,
    HEAVY_BONUS,
    PIEZO_BONUS,
    BASE_YELLOW,
    RAIN_YELLOW_EXTRA,
    FALLBACK_GREEN
};