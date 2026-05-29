// // server/logic/signalDecision.js — HYDRA v6.0 Fixed Offline Road Scenario Badges

// const BASE_GREEN_TIME        = 3;
// const BASE_YELLOW_TIME       = 3;
// const RAIN_YELLOW_EXTRA      = 2;
// const LIGHT_TRAFFIC_BONUS    = 3;
// const HEAVY_TRAFFIC_BONUS    = 6;
// const PIEZO_BONUS            = 3;
// const SENSOR_MAX_RANGE       = 400;
// const IR_MODE_THRESHOLD      = 20;
// const DEFAULT_GREEN          = 5;
// const MIN_GREEN_ULTRASONIC   = 10;
// const MAX_GREEN_ULTRASONIC   = 60;
// const FALLBACK_GREEN         = 5;
// const YELLOW_TIME_DRY        = BASE_YELLOW_TIME;
// const YELLOW_TIME_RAIN       = BASE_YELLOW_TIME + RAIN_YELLOW_EXTRA;

// // IR MODE SCORE BASE — always higher than any ultrasonic score
// const IR_SCORE_BASE          = 1000;
// const ULTRASONIC_MAX_SCORE   = 500;

// function selectSensorMode(distanceCm) {
//     if (distanceCm === null || distanceCm === undefined) return 'ULTRASONIC';
//     if (distanceCm >= SENSOR_MAX_RANGE) return 'ULTRASONIC';
//     if (distanceCm < IR_MODE_THRESHOLD) return 'IR';
//     return 'ULTRASONIC';
// }

// // ULTRASONIC: shorter distance = HIGHER score
// function calculateScoreUltrasonic(distanceCm, googleTraffic) {
//     let score = 0;
//     if (distanceCm !== null && distanceCm < SENSOR_MAX_RANGE) {
//         const proximityScore = SENSOR_MAX_RANGE - distanceCm;
//         score += proximityScore;
//     }
//     score = Math.min(score, ULTRASONIC_MAX_SCORE);
//     return score;
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

// // IR MODE: score starts at IR_SCORE_BASE so it always beats ultrasonic
// function calculateScoreIR(ir1Blocked, ir2Blocked, piezoHeavy, googleTraffic) {
//     let score = IR_SCORE_BASE;
//     if (ir1Blocked && ir2Blocked) {
//         score += 200;
//         if (piezoHeavy) score += 100;
//     } else if (ir1Blocked) {
//         score += 100;
//         if (piezoHeavy) score += 50;
//     } else {
//         score += 10;
//     }
//     return score;
// }

// function calculateGreenTimeIR(ir1Blocked, ir2Blocked, piezoHeavy) {
//     let greenTime = BASE_GREEN_TIME;
//     if (ir1Blocked && ir2Blocked) {
//         greenTime = BASE_GREEN_TIME + HEAVY_TRAFFIC_BONUS; // 3 + 6 = 9s
//     } else if (ir1Blocked) {
//         greenTime = BASE_GREEN_TIME + LIGHT_TRAFFIC_BONUS; // 3 + 3 = 6s
//     }
//     if (piezoHeavy && ir1Blocked) {
//         greenTime += PIEZO_BONUS; // +3s stacked
//     }
//     return greenTime;
// }

// function determineSystemMode(sensorWorking, googleWorking) {
//     const anySensor = Object.values(sensorWorking || {}).some(v => v === true);
//     const google    = googleWorking === true;
//     if (anySensor && google)   return 'BOTH';
//     if (anySensor && !google)  return 'SENSOR_ONLY';
//     if (!anySensor && google)  return 'GOOGLE_ONLY';
//     return 'FALLBACK';
// }

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
//         // No sensors, no Google — pure rotation fallback
//         priorities = ROADS.map((road, i) => ({
//             road,
//             sensorScenario: 'NO_DATA',       // ← NEW: show NO_DATA not FALLBACK
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
//         // No ESP32 sensors anywhere, but Google is working
//         priorities = ROADS.map(road => {
//             const google = (trafficData || {})[road] || 'Unknown';
//             const score  = calculateScoreUltrasonic(null, google);
//             const green  = calculateGreenTimeUltrasonic(null, google);
//             return {
//                 road,
//                 sensorScenario: 'GOOGLE_ONLY',   // ← Correct badge
//                 distance: null,
//                 ir1Blocked: false, ir2Blocked: false, piezoHeavy: false,
//                 traffic: google, score, greenTime: green,
//                 yellowTime: currentYellowTime,
//                 mode: 'GOOGLE_ONLY',
//                 espOnline: esp[road] !== false
//             };
//         });
//     } else {
//         // Mixed: some roads have sensors (North), others don't (South/East/West)
//         priorities = ROADS.map(road => {
//             const espOnline      = esp[road] !== false;
//             const sensorIsWorking = sensorWorking[road] === true;

//             const rawDist    = sensorData[road];
//             const distanceCm = (rawDist === undefined || rawDist === null || rawDist >= SENSOR_MAX_RANGE)
//                                 ? null : rawDist;

//             const google     = (trafficData || {})[road] || 'Unknown';
//             const irRoad     = ir[road]    || { ir1Blocked: false, ir2Blocked: false };
//             const piezoHeavy = piezo[road] || false;
//             const pedRoad    = ped[road]   || { requested: false, crossing: false };

//             // ── KEY FIX: Determine the correct scenario badge per road ──────────
//             // If ESP32 is offline for this road, it CANNOT be IR or ULTRASONIC.
//             // It can only be GOOGLE_ONLY (if Google works) or NO_DATA (if not).
//             let sensorScenario;
//             let score, greenTime;

//             if (!espOnline || !sensorIsWorking) {
//                 // ESP32 offline for this road
//                 if (googleWorking) {
//                     // Google Traffic is available — use it
//                     sensorScenario = 'GOOGLE_ONLY';
//                     score          = calculateScoreUltrasonic(null, google);
//                     greenTime      = calculateGreenTimeUltrasonic(null, google);
//                 } else {
//                     // Nothing works for this road
//                     sensorScenario = 'NO_DATA';
//                     score          = ROADS.indexOf(road) === 0 ? 4 : ROADS.length - ROADS.indexOf(road);
//                     greenTime      = FALLBACK_GREEN;
//                 }
//             } else {
//                 // ESP32 online for this road — use sensor data normally
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
//                     // ULTRASONIC — only shows for roads with a working ESP32
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
//                 distance: espOnline && sensorIsWorking ? distanceCm : null,
//                 ir1Blocked: espOnline ? (irRoad.ir1Blocked  || false) : false,
//                 ir2Blocked: espOnline ? (irRoad.ir2Blocked  || false) : false,
//                 piezoHeavy: espOnline ? piezoHeavy : false,
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
//     IR_MODE_THRESHOLD, BASE_GREEN_TIME,
//     LIGHT_TRAFFIC_BONUS, HEAVY_TRAFFIC_BONUS, PIEZO_BONUS,
//     YELLOW_TIME_DRY, YELLOW_TIME_RAIN,
//     MIN_GREEN_ULTRASONIC, MAX_GREEN_ULTRASONIC
// };


// server/logic/signalDecision.js — HYDRA v7.0
// PIEZO FIX:
//   - Reads piezoData[road].heavy (structured object, not plain boolean)
//   - IR1 only + Piezo  → 3s base + 3s IR light + 3s piezo  = 9s total
//   - Both IR  + Piezo  → 3s base + 6s IR heavy + 3s piezo  = 12s total
//   - Piezo alone (no IR) does NOT contribute — IR check required
//   - Priority score also boosted when piezo active

const BASE_GREEN_TIME        = 3;
const BASE_YELLOW_TIME       = 3;
const RAIN_YELLOW_EXTRA      = 2;
const LIGHT_TRAFFIC_BONUS    = 3;    // IR1 blocked only
const HEAVY_TRAFFIC_BONUS    = 6;    // Both IR blocked
const PIEZO_BONUS            = 3;    // Stacked on top of IR green time (IR must be blocked)
const SENSOR_MAX_RANGE       = 400;
const IR_MODE_THRESHOLD      = 20;
const DEFAULT_GREEN          = 5;
const MIN_GREEN_ULTRASONIC   = 10;
const MAX_GREEN_ULTRASONIC   = 60;
const FALLBACK_GREEN         = 5;
const YELLOW_TIME_DRY        = BASE_YELLOW_TIME;
const YELLOW_TIME_RAIN       = BASE_YELLOW_TIME + RAIN_YELLOW_EXTRA;

const IR_SCORE_BASE          = 1000;
const ULTRASONIC_MAX_SCORE   = 500;

// ── Sensor mode selector ──────────────────────────────────────────────────
function selectSensorMode(distanceCm) {
    if (distanceCm === null || distanceCm === undefined) return 'ULTRASONIC';
    if (distanceCm >= SENSOR_MAX_RANGE) return 'ULTRASONIC';
    if (distanceCm < IR_MODE_THRESHOLD) return 'IR';
    return 'ULTRASONIC';
}

// ── Ultrasonic: shorter distance = higher score ───────────────────────────
function calculateScoreUltrasonic(distanceCm, googleTraffic) {
    let score = 0;
    if (distanceCm !== null && distanceCm < SENSOR_MAX_RANGE) {
        score += (SENSOR_MAX_RANGE - distanceCm);
    }
    return Math.min(score, ULTRASONIC_MAX_SCORE);
}

function calculateGreenTimeUltrasonic(distanceCm, googleTraffic) {
    if (distanceCm === null || distanceCm >= SENSOR_MAX_RANGE) {
        if (googleTraffic === 'Heavy')  return 40;
        if (googleTraffic === 'Medium') return 25;
        if (googleTraffic === 'Light')  return MIN_GREEN_ULTRASONIC;
        return DEFAULT_GREEN;
    }
    const distanceFactor = (distanceCm / SENSOR_MAX_RANGE) * 20;
    let greenTime = MIN_GREEN_ULTRASONIC + distanceFactor;
    if (googleTraffic === 'Heavy') {
        greenTime = Math.max(greenTime * 0.7, MIN_GREEN_ULTRASONIC);
    } else if (googleTraffic === 'Light') {
        greenTime = Math.min(greenTime * 1.2, MAX_GREEN_ULTRASONIC);
    }
    return Math.round(Math.min(Math.max(greenTime, MIN_GREEN_ULTRASONIC), MAX_GREEN_ULTRASONIC));
}

function classifyQueueByUltrasonic(distanceCm) {
    if (distanceCm === null || distanceCm === undefined || distanceCm >= SENSOR_MAX_RANGE) return 'None';
    if (distanceCm <= 100) return 'Heavy';
    if (distanceCm <= 300) return 'Light';
    return 'None';
}

function calculateScoreUltrasonicWithQueue(distanceCm, queueLevel, piezoHeavy) {
    let score = calculateScoreUltrasonic(distanceCm);
    if (queueLevel === 'Light') score += 50;
    if (queueLevel === 'Heavy') score += 120;
    if (piezoHeavy) score += 150;
    return score;
}

function calculateGreenTimeUltrasonicWithQueue(distanceCm, queueLevel, piezoHeavy, googleTraffic) {
    let greenTime = calculateGreenTimeUltrasonic(distanceCm, googleTraffic);
    if (queueLevel === 'Heavy') {
        greenTime += HEAVY_TRAFFIC_BONUS;
    } else if (queueLevel === 'Light') {
        greenTime += LIGHT_TRAFFIC_BONUS;
    }
    if (piezoHeavy) {
        greenTime += PIEZO_BONUS;
    }
    return Math.round(Math.min(Math.max(greenTime, MIN_GREEN_ULTRASONIC), MAX_GREEN_ULTRASONIC));
}

// ── IR mode: score starts at IR_SCORE_BASE — always beats ultrasonic ──────
//
// piezoHeavy: boolean derived from piezoData[road].heavy
// IR must be blocked for piezo to count (enforced in makeSignalDecision
// before calling this, and also redundantly checked here for safety)
function calculateScoreIR(ir1Blocked, ir2Blocked, piezoHeavy, googleTraffic) {
    let score = IR_SCORE_BASE;

    if (ir1Blocked && ir2Blocked) {
        score += 200;
        if (piezoHeavy) score += 100; // confirmed heavy vehicle on heavy queue
    } else if (ir1Blocked) {
        score += 100;
        if (piezoHeavy) score += 50;  // confirmed heavy vehicle on light queue
    } else {
        score += 10; // in IR range, no vehicle in IR zone
    }

    return score;
}

// ── IR mode green time (v7.0 corrected stacking) ─────────────────────────
//
// Calculation table:
//   No IR blocked           → 3s  (base only)
//   IR1 only, no piezo      → 3 + 3 = 6s
//   IR1 + piezo             → 3 + 3 + 3 = 9s   ← NEW
//   Both IR, no piezo       → 3 + 6 = 9s
//   Both IR + piezo         → 3 + 6 + 3 = 12s  ← NEW
//
// IMPORTANT: piezo bonus only applies when at least IR1 is blocked.
// Piezo alone (no IR) returns base green time only.
function calculateGreenTimeIR(ir1Blocked, ir2Blocked, piezoHeavy) {
    let greenTime = BASE_GREEN_TIME; // 3s base always

    if (ir1Blocked && ir2Blocked) {
        greenTime += HEAVY_TRAFFIC_BONUS; // + 6s = 9s
    } else if (ir1Blocked) {
        greenTime += LIGHT_TRAFFIC_BONUS; // + 3s = 6s
    }
    // else: no IR blocked → stay at 3s base (piezo cannot help alone)

    // Piezo stacks on top ONLY when at least IR1 is blocked
    if (piezoHeavy && ir1Blocked) {
        greenTime += PIEZO_BONUS; // + 3s
    }

    return greenTime;
}

// ── System mode determination ─────────────────────────────────────────────
function determineSystemMode(sensorWorking, googleWorking) {
    const anySensor = Object.values(sensorWorking || {}).some(v => v === true);
    const google    = googleWorking === true;
    if (anySensor && google)   return 'BOTH';
    if (anySensor && !google)  return 'SENSOR_ONLY';
    if (!anySensor && google)  return 'GOOGLE_ONLY';
    return 'FALLBACK';
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN DECISION FUNCTION
// ════════════════════════════════════════════════════════════════════════════
//
// piezoData: { North: { heavy, timestamp, locked }, South: ..., ... }
//   — heavy=true means a confirmed (IR+vibration) heavy vehicle is waiting
//   — locked=true means subsequent taps have been suppressed
//   — The server sets heavy=false and locked=false after the extended green ends
//
function makeSignalDecision(
    sensorData, trafficData, sensorWorking, googleWorking,
    queueData, piezoData, rainDetected, pedStatus, espStatus
) {
    const ROADS      = ['North', 'South', 'East', 'West'];
    const systemMode = determineSystemMode(sensorWorking || {}, googleWorking || false);
    const currentYellowTime = rainDetected ? YELLOW_TIME_RAIN : YELLOW_TIME_DRY;

    const queue = queueData || {};
    const piezo = piezoData || {};
    const ped   = pedStatus || {};
    const esp   = espStatus || {};

    let priorities = [];

    if (systemMode === 'FALLBACK') {
        priorities = ROADS.map((road, i) => ({
            road,
            sensorScenario: 'NO_DATA',
            distance: null,
            queueLevel: 'None',
            piezoHeavy: false,
            traffic: 'Unknown',
            score: ROADS.length - i,
            greenTime: FALLBACK_GREEN,
            yellowTime: currentYellowTime,
            mode: 'FALLBACK',
            espOnline: esp[road] !== false
        }));

    } else if (systemMode === 'GOOGLE_ONLY') {
        priorities = ROADS.map(road => {
            const google = (trafficData || {})[road] || 'Unknown';
            const score  = calculateScoreUltrasonic(null, google);
            const green  = calculateGreenTimeUltrasonic(null, google);
            return {
                road,
                sensorScenario: 'GOOGLE_ONLY',
                distance: null,
                queueLevel: 'None',
                piezoHeavy: false,
                traffic: google, score, greenTime: green,
                yellowTime: currentYellowTime,
                mode: 'GOOGLE_ONLY',
                espOnline: esp[road] !== false
            };
        });

    } else {
        priorities = ROADS.map(road => {
            const espOnline       = esp[road] !== false;
            const sensorIsWorking = (sensorWorking || {})[road] === true;

            const rawDist    = (sensorData || {})[road];
            const distanceCm = (rawDist === undefined || rawDist === null || rawDist >= SENSOR_MAX_RANGE)
                                ? null : rawDist;

            const google     = (trafficData || {})[road] || 'Unknown';
            const queueLevel = (queue[road] || {}).queueLevel || 'None';

            const piezoRoad  = piezo[road] || { heavy: false, timestamp: 0, locked: false };
            const piezoHeavy = (piezoRoad.heavy === true) && distanceCm !== null;

            const pedRoad = ped[road] || { requested: false, crossing: false };

            let sensorScenario, score, greenTime;

            if (!espOnline || !sensorIsWorking) {
                if (googleWorking) {
                    sensorScenario = 'GOOGLE_ONLY';
                    score          = calculateScoreUltrasonic(null, google);
                    greenTime      = calculateGreenTimeUltrasonic(null, google);
                } else {
                    sensorScenario = 'NO_DATA';
                    score          = ROADS.length - ROADS.indexOf(road);
                    greenTime      = FALLBACK_GREEN;
                }
            } else {
                sensorScenario = 'ULTRASONIC';
                score          = calculateScoreUltrasonicWithQueue(distanceCm, queueLevel, piezoHeavy);
                greenTime      = calculateGreenTimeUltrasonicWithQueue(distanceCm, queueLevel, piezoHeavy, google);
            }

            // Downed ESP32: exclude from winning
            if (!espOnline) {
                score = -9999;
            }

            // Pedestrian override
            if (pedRoad.crossing) {
                score    -= 1000;
                greenTime = 0;
            } else if (pedRoad.requested) {
                score += 100;
            }

            return {
                road, sensorScenario,
                distance:   espOnline && sensorIsWorking ? distanceCm : null,
                queueLevel: espOnline && sensorIsWorking ? queueLevel : 'None',
                piezoHeavy: espOnline ? piezoHeavy          : false,
                // Expose piezo timestamp so dashboard can show "tap X minutes ago" if desired
                piezoTimestamp: piezoRoad.timestamp || 0,
                traffic: google,
                score, greenTime,
                yellowTime: currentYellowTime,
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
            ? { signal: 'GREEN', greenTime: winner.greenTime, yellowTime: currentYellowTime }
            : { signal: 'RED',   greenTime: 0, yellowTime: 0 };
    });

    return {
        timestamp:      new Date().toISOString(),
        mode:           systemMode,
        winner:         winner.road,
        winnerScenario: winner.sensorScenario,
        greenDuration:  winner.greenTime,
        yellowDuration: currentYellowTime,
        redForOthers:   winner.greenTime + currentYellowTime,
        priorities, commands,
        dataStatus: { sensorWorking, googleWorking },
        weather:    { rainDetected: rainDetected || false, yellowTime: currentYellowTime }
    };
}

module.exports = {
    makeSignalDecision,
    calculateGreenTimeUltrasonic,
    calculateScoreUltrasonic,
    determineSystemMode,
    // Constants — exported for tests and dashboard display
    BASE_GREEN_TIME,
    LIGHT_TRAFFIC_BONUS, HEAVY_TRAFFIC_BONUS, PIEZO_BONUS,
    YELLOW_TIME_DRY, YELLOW_TIME_RAIN,
    MIN_GREEN_ULTRASONIC, MAX_GREEN_ULTRASONIC,
    SENSOR_MAX_RANGE
};