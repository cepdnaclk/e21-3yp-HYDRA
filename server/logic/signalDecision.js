// // server/logic/signalDecision.js — HYDRA v8.0 Dual Ultrasonic Queue Detection
// //
// // SENSOR LOGIC (prototype scale):
// //   US1 placed 5cm back from stop line, pointing across 7cm road width
// //   US2 placed 15cm back from stop line, pointing across 7cm road width
// //   Vehicle present = distance < 7cm held stable for 5s
// //
// //   US1 blocked only              → Light traffic  → +3s green (total 6s)
// //   US1 + US2 both blocked        → Heavy traffic  → +6s green (total 9s)
// //   US2 blocked but US1 not       → Ignored (not a valid queue)
// //   Neither blocked               → No traffic     → 3s base green
// //
// //   Piezo + US1 blocked           → +3s stacked on top of above
// //
// // FALLBACK (no ESP32 connected):
// //   Round-robin: North → South → East → West → North (3s each, equal)
// //
// // PRIORITY DECISION:
// //   Queue data (US1/US2) + Google traffic + Piezo
// //   No more distance-based scoring or IR/ULTRASONIC mode switching

// 'use strict';

// // ── Timing constants ──────────────────────────────────────────────────────────
// const BASE_GREEN          = 3;   // seconds
// const LIGHT_BONUS         = 3;   // US1 only blocked
// const HEAVY_BONUS         = 6;   // US1 + US2 both blocked
// const PIEZO_BONUS         = 3;   // US1 + piezo both active
// const BASE_YELLOW         = 3;
// const RAIN_YELLOW_EXTRA   = 2;
// const FALLBACK_GREEN      = 3;   // round-robin fallback

// // ── Score constants ───────────────────────────────────────────────────────────
// const SCORE_HEAVY         = 300;
// const SCORE_LIGHT         = 150;
// const SCORE_NONE          = 50;
// const SCORE_PIEZO_BONUS   = 80;
// const SCORE_GOOGLE_HEAVY  = -40; // penalise: downstream jammed, hold back
// const SCORE_GOOGLE_MEDIUM = 20;
// const SCORE_GOOGLE_LIGHT  = 60;
// const SCORE_PED_CROSSING  = -9999;
// const SCORE_PED_WAITING   = 100;
// const SCORE_ESP_OFFLINE   = -99999;

// const ROADS = ['North', 'South', 'East', 'West'];

// // ── Round-robin state for fallback ────────────────────────────────────────────
// let _fallbackIndex = 0;

// // ── Determine system mode ─────────────────────────────────────────────────────
// function determineSystemMode(usWorking, googleWorking) {
//     const anyUS = Object.values(usWorking || {}).some(v => v === true);
//     const goog  = googleWorking === true;
//     if (anyUS && goog)   return 'BOTH';
//     if (anyUS && !goog)  return 'SENSOR_ONLY';
//     if (!anyUS && goog)  return 'GOOGLE_ONLY';
//     return 'FALLBACK';
// }

// // ── Queue level helper ────────────────────────────────────────────────────────
// // us1Stable: boolean — US1 has been < 7cm for ≥ 5s (confirmed by ESP32)
// // us2Stable: boolean — US2 has been < 7cm for ≥ 5s (confirmed by ESP32)
// //
// // Returns: 'Heavy' | 'Light' | 'None'
// function queueLevel(us1Stable, us2Stable) {
//     if (us1Stable && us2Stable) return 'Heavy';
//     if (us1Stable)              return 'Light';
//     return 'None';                             // US2 alone = ignored
// }

// // ── Green time from queue level + piezo ──────────────────────────────────────
// function calcGreenTime(us1Stable, us2Stable, piezoHeavy) {
//     let g = BASE_GREEN;

//     if (us1Stable && us2Stable) {
//         g += HEAVY_BONUS;          // 3 + 6 = 9s
//     } else if (us1Stable) {
//         g += LIGHT_BONUS;          // 3 + 3 = 6s
//     }
//     // US2 alone → stays at 3s base

//     if (piezoHeavy && us1Stable) {
//         g += PIEZO_BONUS;          // +3s stacked (US1 must be active)
//     }

//     return g;
// }

// // ── Priority score for a road ─────────────────────────────────────────────────
// function calcScore(us1Stable, us2Stable, piezoHeavy, googleTraffic, pedStatus) {
//     const level = queueLevel(us1Stable, us2Stable);

//     let score = 0;
//     if (level === 'Heavy') score += SCORE_HEAVY;
//     else if (level === 'Light') score += SCORE_LIGHT;
//     else score += SCORE_NONE;

//     if (piezoHeavy && us1Stable) score += SCORE_PIEZO_BONUS;

//     if (googleTraffic === 'Heavy')  score += SCORE_GOOGLE_HEAVY;
//     else if (googleTraffic === 'Medium') score += SCORE_GOOGLE_MEDIUM;
//     else if (googleTraffic === 'Light')  score += SCORE_GOOGLE_LIGHT;

//     if (pedStatus && pedStatus.crossing)  score += SCORE_PED_CROSSING;
//     if (pedStatus && pedStatus.requested && !pedStatus.crossing) score += SCORE_PED_WAITING;

//     return score;
// }

// // ── Scenario badge (replaces old IR/ULTRASONIC badges) ───────────────────────
// function scenarioBadge(us1Stable, us2Stable, piezoHeavy, espOnline, usWorking, googleWorking) {
//     if (!espOnline || !usWorking) {
//         return googleWorking ? 'GOOGLE_ONLY' : 'NO_DATA';
//     }
//     const level = queueLevel(us1Stable, us2Stable);
//     if (level === 'Heavy') return piezoHeavy ? 'QUEUE_HEAVY_PIEZO' : 'QUEUE_HEAVY';
//     if (level === 'Light') return piezoHeavy ? 'QUEUE_LIGHT_PIEZO' : 'QUEUE_LIGHT';
//     return 'QUEUE_NONE';
// }

// // ════════════════════════════════════════════════════════════════════════════
// // MAIN DECISION FUNCTION
// // ════════════════════════════════════════════════════════════════════════════
// //
// // usData    : { North: { us1Stable, us2Stable }, ... }
// //             us1Stable/us2Stable = true when confirmed blocked for ≥ 5s
// // usWorking : { North: bool, ... }  — is the ESP32 sending data?
// // piezoData : { North: { heavy, timestamp, locked }, ... }
// // pedStatus : { North: { requested, crossing }, ... }
// // espStatus : { North: bool, ... }
// //
// function makeSignalDecision(
//     usData,
//     trafficData,
//     usWorking,
//     googleWorking,
//     piezoData,
//     rainDetected,
//     pedStatus,
//     espStatus
// ) {
//     const currentYellow = rainDetected
//         ? BASE_YELLOW + RAIN_YELLOW_EXTRA
//         : BASE_YELLOW;

//     const systemMode = determineSystemMode(usWorking, googleWorking);

//     const us   = usData    || {};
//     const piezo = piezoData || {};
//     const ped   = pedStatus || {};
//     const esp   = espStatus || {};
//     const goog  = trafficData || {};

//     let priorities = [];

//     // ── FALLBACK: no sensors, no google → round-robin ────────────────────────
//     if (systemMode === 'FALLBACK') {
//         const winnerRoad = ROADS[_fallbackIndex % ROADS.length];
//         priorities = ROADS.map((road, i) => ({
//             road,
//             sensorScenario: 'NO_DATA',
//             us1Stable: false,
//             us2Stable: false,
//             queueLevel: 'None',
//             piezoHeavy: false,
//             traffic: 'Unknown',
//             score: road === winnerRoad ? 4 : ROADS.length - i,
//             greenTime: FALLBACK_GREEN,
//             yellowTime: currentYellow,
//             mode: 'FALLBACK',
//             espOnline: esp[road] !== false
//         }));
//         _fallbackIndex = (_fallbackIndex + 1) % ROADS.length;

//     // ── GOOGLE ONLY: no ESP32 anywhere ───────────────────────────────────────
//     } else if (systemMode === 'GOOGLE_ONLY') {
//         const googleScoreMap = { Heavy: 10, Medium: 50, Light: 80, Unknown: 20 };
//         const googleGreenMap = { Heavy: 9, Medium: 6, Light: 3, Unknown: 3 };

//         priorities = ROADS.map(road => {
//             const g = goog[road] || 'Unknown';
//             return {
//                 road,
//                 sensorScenario: 'GOOGLE_ONLY',
//                 us1Stable: false,
//                 us2Stable: false,
//                 queueLevel: 'None',
//                 piezoHeavy: false,
//                 traffic: g,
//                 score: googleScoreMap[g] || 20,
//                 greenTime: googleGreenMap[g] || 3,
//                 yellowTime: currentYellow,
//                 mode: 'GOOGLE_ONLY',
//                 espOnline: esp[road] !== false
//             };
//         });

//     // ── SENSOR_ONLY or BOTH ───────────────────────────────────────────────────
//     } else {
//         priorities = ROADS.map(road => {
//             const espOnline   = esp[road] !== false;
//             const usOnline    = (usWorking || {})[road] === true;
//             const roadUS      = us[road]  || { us1Stable: false, us2Stable: false };
//             const piezoRoad   = piezo[road] || { heavy: false, timestamp: 0, locked: false };
//             const pedRoad     = ped[road]   || { requested: false, crossing: false };
//             const google      = goog[road]  || 'Unknown';

//             // Piezo only counts when US1 is also stable
//             const us1Stable   = espOnline && usOnline ? (roadUS.us1Stable || false) : false;
//             const us2Stable   = espOnline && usOnline ? (roadUS.us2Stable || false) : false;
//             const piezoHeavy  = (piezoRoad.heavy === true) && us1Stable;

//             let score, greenTime, badge;

//             if (!espOnline) {
//                 // Offline ESP32: excluded from winning
//                 score     = SCORE_ESP_OFFLINE;
//                 greenTime = FALLBACK_GREEN;
//                 badge     = 'NO_DATA';
//             } else if (!usOnline) {
//                 // ESP32 online but no US data yet
//                 if (googleWorking) {
//                     const googleGreenMap = { Heavy: 9, Medium: 6, Light: 3, Unknown: 3 };
//                     score     = { Heavy: 10, Medium: 50, Light: 80, Unknown: 20 }[google] || 20;
//                     greenTime = googleGreenMap[google] || 3;
//                     badge     = 'GOOGLE_ONLY';
//                 } else {
//                     score     = SCORE_NONE;
//                     greenTime = FALLBACK_GREEN;
//                     badge     = 'NO_DATA';
//                 }
//             } else {
//                 score     = calcScore(us1Stable, us2Stable, piezoHeavy, google, pedRoad);
//                 greenTime = calcGreenTime(us1Stable, us2Stable, piezoHeavy);
//                 badge     = scenarioBadge(us1Stable, us2Stable, piezoHeavy, espOnline, usOnline, googleWorking);
//             }

//             // Ped crossing override (score already handles it, but zero green time too)
//             if (pedRoad.crossing) greenTime = 0;

//             return {
//                 road,
//                 sensorScenario: badge,
//                 us1Stable,
//                 us2Stable,
//                 queueLevel: queueLevel(us1Stable, us2Stable),
//                 piezoHeavy,
//                 piezoTimestamp: piezoRoad.timestamp || 0,
//                 traffic: google,
//                 score,
//                 greenTime,
//                 yellowTime: currentYellow,
//                 mode: systemMode,
//                 pedestrian: pedRoad,
//                 espOnline
//             };
//         });
//     }

//     // Sort by score descending
//     priorities.sort((a, b) => b.score - a.score);
//     const winner = priorities[0];

//     const commands = {};
//     ROADS.forEach(road => {
//         commands[road] = road === winner.road
//             ? { signal: 'GREEN', greenTime: winner.greenTime, yellowTime: currentYellow }
//             : { signal: 'RED',   greenTime: 0,                yellowTime: 0 };
//     });

//     return {
//         timestamp:      new Date().toISOString(),
//         mode:           systemMode,
//         winner:         winner.road,
//         winnerScenario: winner.sensorScenario,
//         greenDuration:  winner.greenTime,
//         yellowDuration: currentYellow,
//         redForOthers:   winner.greenTime + currentYellow,
//         priorities,
//         commands,
//         dataStatus: { usWorking, googleWorking },
//         weather:    { rainDetected: rainDetected || false, yellowTime: currentYellow }
//     };
// }

// module.exports = {
//     makeSignalDecision,
//     queueLevel,
//     calcGreenTime,
//     calcScore,
//     determineSystemMode,
//     BASE_GREEN,
//     LIGHT_BONUS,
//     HEAVY_BONUS,
//     PIEZO_BONUS,
//     BASE_YELLOW,
//     RAIN_YELLOW_EXTRA,
//     FALLBACK_GREEN
// };


// server/logic/signalDecision.js — HYDRA v8.1 FIXED
// KEY FIX: _fallbackIndex is now managed EXTERNALLY by the cycle engine
// so it only advances ONCE per full cycle, not multiple times per cycle.
// This file now ACCEPTS the current fallback road as a parameter.

'use strict';

const BASE_GREEN          = 3;
const LIGHT_BONUS         = 3;
const HEAVY_BONUS         = 6;
const PIEZO_BONUS         = 3;
const BASE_YELLOW         = 3;
const RAIN_YELLOW_EXTRA   = 2;
const FALLBACK_GREEN      = 3;

const SCORE_HEAVY         = 300;
const SCORE_LIGHT         = 150;
const SCORE_NONE          = 50;
const SCORE_PIEZO_BONUS   = 80;
const SCORE_GOOGLE_HEAVY  = -40;
const SCORE_GOOGLE_MEDIUM = 20;
const SCORE_GOOGLE_LIGHT  = 60;
const SCORE_PED_CROSSING  = -9999;
const SCORE_PED_WAITING   = 100;
const SCORE_ESP_OFFLINE   = -99999;

const ROADS = ['North', 'South', 'East', 'West'];

function determineSystemMode(usWorking, googleWorking) {
    const anyUS = Object.values(usWorking || {}).some(v => v === true);
    const goog  = googleWorking === true;
    if (anyUS && goog)   return 'BOTH';
    if (anyUS && !goog)  return 'SENSOR_ONLY';
    if (!anyUS && goog)  return 'GOOGLE_ONLY';
    return 'FALLBACK';
}

function queueLevel(us1Stable, us2Stable) {
    if (us1Stable && us2Stable) return 'Heavy';
    if (us1Stable)              return 'Light';
    return 'None';
}

function calcGreenTime(us1Stable, us2Stable, piezoHeavy) {
    let g = BASE_GREEN;
    if (us1Stable && us2Stable) g += HEAVY_BONUS;
    else if (us1Stable)         g += LIGHT_BONUS;
    if (piezoHeavy && us1Stable) g += PIEZO_BONUS;
    return g;
}

function calcScore(us1Stable, us2Stable, piezoHeavy, googleTraffic, pedStatus) {
    const level = queueLevel(us1Stable, us2Stable);
    let score = 0;
    if (level === 'Heavy')      score += SCORE_HEAVY;
    else if (level === 'Light') score += SCORE_LIGHT;
    else                        score += SCORE_NONE;

    if (piezoHeavy && us1Stable) score += SCORE_PIEZO_BONUS;

    if (googleTraffic === 'Heavy')       score += SCORE_GOOGLE_HEAVY;
    else if (googleTraffic === 'Medium') score += SCORE_GOOGLE_MEDIUM;
    else if (googleTraffic === 'Light')  score += SCORE_GOOGLE_LIGHT;

    if (pedStatus && pedStatus.crossing)                           score += SCORE_PED_CROSSING;
    if (pedStatus && pedStatus.requested && !pedStatus.crossing)   score += SCORE_PED_WAITING;

    return score;
}

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
// NEW PARAMETER: fallbackWinnerRoad — the road that SHOULD win in fallback mode
// This is passed in by index.js which manages the rotation externally.
function makeSignalDecision(
    usData,
    trafficData,
    usWorking,
    googleWorking,
    piezoData,
    rainDetected,
    pedStatus,
    espStatus,
    fallbackWinnerRoad   // ← NEW: which road wins in fallback (managed externally)
) {
    const currentYellow = rainDetected
        ? BASE_YELLOW + RAIN_YELLOW_EXTRA
        : BASE_YELLOW;

    const systemMode = determineSystemMode(usWorking, googleWorking);

    const us    = usData    || {};
    const piezo = piezoData || {};
    const ped   = pedStatus || {};
    const esp   = espStatus || {};
    const goog  = trafficData || {};

    let priorities = [];

    // ── FALLBACK: no sensors, no google → round-robin ────────────────────────
    if (systemMode === 'FALLBACK') {
        // Use the externally-provided fallbackWinnerRoad
        const winnerRoad = fallbackWinnerRoad || ROADS[0];

        priorities = ROADS.map(road => ({
            road,
            sensorScenario: 'NO_DATA',
            us1Stable: false,
            us2Stable: false,
            queueLevel: 'None',
            piezoHeavy: false,
            traffic: 'Unknown',
            // Winner gets highest score, others get lower scores in order
            score: road === winnerRoad ? 1000 : 0,
            greenTime: FALLBACK_GREEN,
            yellowTime: currentYellow,
            mode: 'FALLBACK',
            espOnline: esp[road] !== false
        }));

    // ── GOOGLE ONLY ───────────────────────────────────────────────────────────
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

            const us1Stable  = espOnline && usOnline ? (roadUS.us1Stable || false) : false;
            const us2Stable  = espOnline && usOnline ? (roadUS.us2Stable || false) : false;
            const piezoHeavy = (piezoRoad.heavy === true) && us1Stable;

            let score, greenTime, badge;

            if (!espOnline) {
                score     = SCORE_ESP_OFFLINE;
                greenTime = FALLBACK_GREEN;
                badge     = 'NO_DATA';
            } else if (!usOnline) {
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
    FALLBACK_GREEN,
    ROADS
};