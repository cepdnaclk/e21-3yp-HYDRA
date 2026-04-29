// // server/logic/signalDecision.js — HYDRA v5.0 Fixed Scoring

// const BASE_GREEN_TIME        = 3;
// const BASE_YELLOW_TIME       = 3;
// const RAIN_YELLOW_EXTRA      = 2;
// const LIGHT_TRAFFIC_BONUS    = 3;
// const HEAVY_TRAFFIC_BONUS    = 6;
// const PIEZO_BONUS            = 3;   // +3s stacked on IR green time
// const SENSOR_MAX_RANGE       = 400;
// const IR_MODE_THRESHOLD      = 20;
// const DEFAULT_GREEN          = 5;
// const MIN_GREEN_ULTRASONIC   = 10;
// const MAX_GREEN_ULTRASONIC   = 60;
// const FALLBACK_GREEN         = 5;
// const YELLOW_TIME_DRY        = BASE_YELLOW_TIME;
// const YELLOW_TIME_RAIN       = BASE_YELLOW_TIME + RAIN_YELLOW_EXTRA;

// // IR MODE SCORE BASE — always higher than any ultrasonic score
// // Ultrasonic max possible score ≈ 40 (distance) + 10 (google) = 50
// // IR minimum score = 1000, so IR ALWAYS beats ultrasonic
// const IR_SCORE_BASE          = 1000;
// const ULTRASONIC_MAX_SCORE   = 500; // safety cap well below IR base

// function selectSensorMode(distanceCm) {
//     if (distanceCm === null || distanceCm === undefined) return 'ULTRASONIC';
//     if (distanceCm >= SENSOR_MAX_RANGE) return 'ULTRASONIC';
//     if (distanceCm < IR_MODE_THRESHOLD) return 'IR';
//     return 'ULTRASONIC';
// }

// // ULTRASONIC: shorter distance = HIGHER score (directly proportional to urgency)
// function calculateScoreUltrasonic(distanceCm, googleTraffic) {
//     let score = 0;

//     if (distanceCm !== null && distanceCm < SENSOR_MAX_RANGE) {
//         // Closer = more urgent = higher score
//         // distanceCm=1  → score += 400 (max urgency)
//         // distanceCm=200 → score += 200
//         // distanceCm=399 → score += 1
//         const proximityScore = SENSOR_MAX_RANGE - distanceCm;
//         score += proximityScore;
//     }
//     // Cap ultrasonic score so it can never reach IR_SCORE_BASE
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
// // Piezo heavy vehicle: +3s GREEN stacked on top of IR green time
// function calculateScoreIR(ir1Blocked, ir2Blocked, piezoHeavy, googleTraffic) {
//     let score = IR_SCORE_BASE; // guaranteed to beat any ultrasonic score

//     if (ir1Blocked && ir2Blocked) {
//         score += 200; // Heavy queue
//         if (piezoHeavy) score += 100; // Heavy vehicle on top
//     } else if (ir1Blocked) {
//         score += 100; // Light queue
//         if (piezoHeavy) score += 50;
//     } else {
//         score += 10; // In IR range but no vehicle in IR (pedestrian zone)
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
//     // Piezo stacks ON TOP of IR green time (not replace)
//     if (piezoHeavy && (ir1Blocked)) {
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
//         priorities = ROADS.map((road, i) => ({
//             road,
//             sensorScenario: 'FALLBACK',
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
//             // Skip downed ESP32 lanes from winning — they get synthetic timing
//             const espOnline = esp[road] !== false;
//             const sensorIsWorking = sensorWorking[road] === true;

//             const rawDist   = sensorData[road];
//             const distanceCm = (rawDist === undefined || rawDist === null || rawDist >= SENSOR_MAX_RANGE)
//                                 ? null : rawDist;

//             const google     = (trafficData || {})[road] || 'Unknown';
//             const irRoad     = ir[road]    || { ir1Blocked: false, ir2Blocked: false };
//             const piezoHeavy = piezo[road] || false;
//             const pedRoad    = ped[road]   || { requested: false, crossing: false };

//             // Determine sensor scenario: if this road's sensor is not working, use FALLBACK
//             let sensorScenario;
//             if (!sensorIsWorking) {
//                 sensorScenario = googleWorking ? 'GOOGLE_ONLY' : 'FALLBACK';
//             } else {
//                 sensorScenario = selectSensorMode(distanceCm);
//             }

//             let score, greenTime;

//             if (sensorScenario === 'IR') {
//                 // IR mode: score starts at 1000+ so ALWAYS beats ultrasonic
//                 score     = calculateScoreIR(
//                                 irRoad.ir1Blocked, irRoad.ir2Blocked,
//                                 piezoHeavy,
//                                 systemMode === 'BOTH' ? google : 'Unknown'
//                             );
//                 greenTime = calculateGreenTimeIR(
//                                 irRoad.ir1Blocked, irRoad.ir2Blocked, piezoHeavy
//                             );
//             } else if (sensorScenario === 'GOOGLE_ONLY' || sensorScenario === 'FALLBACK') {
//                 // No sensor data for this road - use Google Traffic or fallback timing
//                 score     = calculateScoreUltrasonic(null, google);
//                 greenTime = sensorScenario === 'FALLBACK' ? FALLBACK_GREEN : calculateGreenTimeUltrasonic(null, google);
//             } else {
//                 // Ultrasonic mode: shorter distance = higher score, max < 1000
//                 score     = calculateScoreUltrasonic(distanceCm, google);
//                 greenTime = calculateGreenTimeUltrasonic(distanceCm, google);
//             }

//             // Downed ESP32: exclude from winning but keep in list
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
//                 distance: distanceCm,
//                 ir1Blocked: irRoad.ir1Blocked  || false,
//                 ir2Blocked: irRoad.ir2Blocked  || false,
//                 piezoHeavy,
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
//     IR_MODE_THRESHOLD, BASE_GREEN_TIME,
//     LIGHT_TRAFFIC_BONUS, HEAVY_TRAFFIC_BONUS, PIEZO_BONUS,
//     YELLOW_TIME_DRY, YELLOW_TIME_RAIN,
//     MIN_GREEN_ULTRASONIC, MAX_GREEN_ULTRASONIC
// };


// server/logic/signalDecision.js — HYDRA v6.0 Fixed Offline Road Scenario Badges

const BASE_GREEN_TIME        = 3;
const BASE_YELLOW_TIME       = 3;
const RAIN_YELLOW_EXTRA      = 2;
const LIGHT_TRAFFIC_BONUS    = 3;
const HEAVY_TRAFFIC_BONUS    = 6;
const PIEZO_BONUS            = 3;
const SENSOR_MAX_RANGE       = 400;
const IR_MODE_THRESHOLD      = 20;
const DEFAULT_GREEN          = 5;
const MIN_GREEN_ULTRASONIC   = 10;
const MAX_GREEN_ULTRASONIC   = 60;
const FALLBACK_GREEN         = 5;
const YELLOW_TIME_DRY        = BASE_YELLOW_TIME;
const YELLOW_TIME_RAIN       = BASE_YELLOW_TIME + RAIN_YELLOW_EXTRA;

// IR MODE SCORE BASE — always higher than any ultrasonic score
const IR_SCORE_BASE          = 1000;
const ULTRASONIC_MAX_SCORE   = 500;

function selectSensorMode(distanceCm) {
    if (distanceCm === null || distanceCm === undefined) return 'ULTRASONIC';
    if (distanceCm >= SENSOR_MAX_RANGE) return 'ULTRASONIC';
    if (distanceCm < IR_MODE_THRESHOLD) return 'IR';
    return 'ULTRASONIC';
}

// ULTRASONIC: shorter distance = HIGHER score
function calculateScoreUltrasonic(distanceCm, googleTraffic) {
    let score = 0;
    if (distanceCm !== null && distanceCm < SENSOR_MAX_RANGE) {
        const proximityScore = SENSOR_MAX_RANGE - distanceCm;
        score += proximityScore;
    }
    score = Math.min(score, ULTRASONIC_MAX_SCORE);
    return score;
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

// IR MODE: score starts at IR_SCORE_BASE so it always beats ultrasonic
function calculateScoreIR(ir1Blocked, ir2Blocked, piezoHeavy, googleTraffic) {
    let score = IR_SCORE_BASE;
    if (ir1Blocked && ir2Blocked) {
        score += 200;
        if (piezoHeavy) score += 100;
    } else if (ir1Blocked) {
        score += 100;
        if (piezoHeavy) score += 50;
    } else {
        score += 10;
    }
    return score;
}

function calculateGreenTimeIR(ir1Blocked, ir2Blocked, piezoHeavy) {
    let greenTime = BASE_GREEN_TIME;
    if (ir1Blocked && ir2Blocked) {
        greenTime = BASE_GREEN_TIME + HEAVY_TRAFFIC_BONUS; // 3 + 6 = 9s
    } else if (ir1Blocked) {
        greenTime = BASE_GREEN_TIME + LIGHT_TRAFFIC_BONUS; // 3 + 3 = 6s
    }
    if (piezoHeavy && ir1Blocked) {
        greenTime += PIEZO_BONUS; // +3s stacked
    }
    return greenTime;
}

function determineSystemMode(sensorWorking, googleWorking) {
    const anySensor = Object.values(sensorWorking || {}).some(v => v === true);
    const google    = googleWorking === true;
    if (anySensor && google)   return 'BOTH';
    if (anySensor && !google)  return 'SENSOR_ONLY';
    if (!anySensor && google)  return 'GOOGLE_ONLY';
    return 'FALLBACK';
}

function makeSignalDecision(
    sensorData, trafficData, sensorWorking, googleWorking,
    irData, piezoData, rainDetected, pedStatus, espStatus
) {
    const ROADS      = ['North', 'South', 'East', 'West'];
    const systemMode = determineSystemMode(sensorWorking || {}, googleWorking || false);
    const currentYellowTime = rainDetected ? YELLOW_TIME_RAIN : YELLOW_TIME_DRY;
    const ir    = irData    || {};
    const piezo = piezoData || {};
    const ped   = pedStatus || {};
    const esp   = espStatus || {};

    let priorities = [];

    if (systemMode === 'FALLBACK') {
        // No sensors, no Google — pure rotation fallback
        priorities = ROADS.map((road, i) => ({
            road,
            sensorScenario: 'NO_DATA',       // ← NEW: show NO_DATA not FALLBACK
            distance: null,
            ir1Blocked: false, ir2Blocked: false, piezoHeavy: false,
            traffic: 'Unknown',
            score: ROADS.length - i,
            greenTime: FALLBACK_GREEN,
            yellowTime: currentYellowTime,
            mode: 'FALLBACK',
            espOnline: esp[road] !== false
        }));
    } else if (systemMode === 'GOOGLE_ONLY') {
        // No ESP32 sensors anywhere, but Google is working
        priorities = ROADS.map(road => {
            const google = (trafficData || {})[road] || 'Unknown';
            const score  = calculateScoreUltrasonic(null, google);
            const green  = calculateGreenTimeUltrasonic(null, google);
            return {
                road,
                sensorScenario: 'GOOGLE_ONLY',   // ← Correct badge
                distance: null,
                ir1Blocked: false, ir2Blocked: false, piezoHeavy: false,
                traffic: google, score, greenTime: green,
                yellowTime: currentYellowTime,
                mode: 'GOOGLE_ONLY',
                espOnline: esp[road] !== false
            };
        });
    } else {
        // Mixed: some roads have sensors (North), others don't (South/East/West)
        priorities = ROADS.map(road => {
            const espOnline      = esp[road] !== false;
            const sensorIsWorking = sensorWorking[road] === true;

            const rawDist    = sensorData[road];
            const distanceCm = (rawDist === undefined || rawDist === null || rawDist >= SENSOR_MAX_RANGE)
                                ? null : rawDist;

            const google     = (trafficData || {})[road] || 'Unknown';
            const irRoad     = ir[road]    || { ir1Blocked: false, ir2Blocked: false };
            const piezoHeavy = piezo[road] || false;
            const pedRoad    = ped[road]   || { requested: false, crossing: false };

            // ── KEY FIX: Determine the correct scenario badge per road ──────────
            // If ESP32 is offline for this road, it CANNOT be IR or ULTRASONIC.
            // It can only be GOOGLE_ONLY (if Google works) or NO_DATA (if not).
            let sensorScenario;
            let score, greenTime;

            if (!espOnline || !sensorIsWorking) {
                // ESP32 offline for this road
                if (googleWorking) {
                    // Google Traffic is available — use it
                    sensorScenario = 'GOOGLE_ONLY';
                    score          = calculateScoreUltrasonic(null, google);
                    greenTime      = calculateGreenTimeUltrasonic(null, google);
                } else {
                    // Nothing works for this road
                    sensorScenario = 'NO_DATA';
                    score          = ROADS.indexOf(road) === 0 ? 4 : ROADS.length - ROADS.indexOf(road);
                    greenTime      = FALLBACK_GREEN;
                }
            } else {
                // ESP32 online for this road — use sensor data normally
                sensorScenario = selectSensorMode(distanceCm);

                if (sensorScenario === 'IR') {
                    score     = calculateScoreIR(
                                    irRoad.ir1Blocked, irRoad.ir2Blocked,
                                    piezoHeavy,
                                    systemMode === 'BOTH' ? google : 'Unknown'
                                );
                    greenTime = calculateGreenTimeIR(
                                    irRoad.ir1Blocked, irRoad.ir2Blocked, piezoHeavy
                                );
                } else {
                    // ULTRASONIC — only shows for roads with a working ESP32
                    score     = calculateScoreUltrasonic(distanceCm, google);
                    greenTime = calculateGreenTimeUltrasonic(distanceCm, google);
                }
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
                distance: espOnline && sensorIsWorking ? distanceCm : null,
                ir1Blocked: espOnline ? (irRoad.ir1Blocked  || false) : false,
                ir2Blocked: espOnline ? (irRoad.ir2Blocked  || false) : false,
                piezoHeavy: espOnline ? piezoHeavy : false,
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
    makeSignalDecision, selectSensorMode,
    calculateGreenTimeUltrasonic, calculateGreenTimeIR,
    calculateScoreUltrasonic, calculateScoreIR,
    determineSystemMode,
    IR_MODE_THRESHOLD, BASE_GREEN_TIME,
    LIGHT_TRAFFIC_BONUS, HEAVY_TRAFFIC_BONUS, PIEZO_BONUS,
    YELLOW_TIME_DRY, YELLOW_TIME_RAIN,
    MIN_GREEN_ULTRASONIC, MAX_GREEN_ULTRASONIC
};