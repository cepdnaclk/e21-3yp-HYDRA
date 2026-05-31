// ═══════════════════════════════════════════════════════════════════════════
// server/logic/signalDecision.js — HYDRA v8.0
//
// FIXES vs v7.0:
//   1. FALLBACK mode now accepts and uses the pre-selected fallbackWinner
//      from index.js, so priorities[] is re-sorted to match the actual winner.
//      Dashboard will always show the correct road at the top.
//
//   2. Each road's entry in priorities[] carries a correct sensorScenario
//      badge in every mode — FALLBACK_ROTATION, GOOGLE_ONLY, NO_DATA,
//      ULTRASONIC — nothing is mislabelled.
//
//   3. greenDuration in FALLBACK mode is resolved via getFallbackGreenTime()
//      which checks time-of-day (morning peak / evening peak / night / default)
//      instead of the old hardcoded FALLBACK_GREEN = 5s constant.
//
//   4. Piezo logic unchanged and correct:
//        IR1 only + piezo  →  3 + 3 + 3  =  9s
//        Both IR  + piezo  →  3 + 6 + 3  = 12s
//        Piezo alone (no IR) does NOT contribute.
//
//   5. All exported constants kept so existing tests and dashboard imports
//      continue to work without changes.
// ═══════════════════════════════════════════════════════════════════════════

// ── Timing constants ─────────────────────────────────────────────────────────
const BASE_GREEN_TIME       = 3;
const BASE_YELLOW_TIME      = 3;
const RAIN_YELLOW_EXTRA     = 2;
const LIGHT_TRAFFIC_BONUS   = 3;   // IR1 blocked only
const HEAVY_TRAFFIC_BONUS   = 6;   // Both IR blocked
const PIEZO_BONUS           = 3;   // Stacked on IR green time (IR must be blocked)
const SENSOR_MAX_RANGE      = 400;
const DEFAULT_GREEN         = 5;
const MIN_GREEN_ULTRASONIC  = 10;
const MAX_GREEN_ULTRASONIC  = 60;
const YELLOW_TIME_DRY       = BASE_YELLOW_TIME;
const YELLOW_TIME_RAIN      = BASE_YELLOW_TIME + RAIN_YELLOW_EXTRA;

// FIX 3: Time-of-day green times for fallback (replaces hardcoded FALLBACK_GREEN = 5)
// These are conservative values — the system has no sensor data so we
// use known peak/off-peak patterns to avoid starving any direction.
const FALLBACK_GREEN_SCHEDULE = {
    morningPeak:  9,   // 07:00 – 08:59
    eveningPeak:  9,   // 17:00 – 18:59
    daytime:      5,   // 09:00 – 16:59
    night:        3,   // 22:00 – 05:59 (next day)
    default:      5
};

function getFallbackGreenTime() {
    const hour = new Date().getHours();
    if (hour >= 7  && hour < 9)  return FALLBACK_GREEN_SCHEDULE.morningPeak;
    if (hour >= 17 && hour < 19) return FALLBACK_GREEN_SCHEDULE.eveningPeak;
    if (hour >= 22 || hour < 6)  return FALLBACK_GREEN_SCHEDULE.night;
    if (hour >= 9  && hour < 17) return FALLBACK_GREEN_SCHEDULE.daytime;
    return FALLBACK_GREEN_SCHEDULE.default;
}

// ── Score ceilings ────────────────────────────────────────────────────────────
const IR_SCORE_BASE       = 1000;
const ULTRASONIC_MAX_SCORE = 500;

// ── Sensor mode selector ──────────────────────────────────────────────────────
// Kept for backward-compatibility export; not used in the main path anymore
// (v8.0 uses ULTRASONIC-with-queue for all online roads).
function selectSensorMode(distanceCm) {
    if (distanceCm === null || distanceCm === undefined) return 'ULTRASONIC';
    if (distanceCm >= SENSOR_MAX_RANGE) return 'ULTRASONIC';
    return 'ULTRASONIC';
}

// ── Ultrasonic helpers ────────────────────────────────────────────────────────
function calculateScoreUltrasonic(distanceCm) {
    if (distanceCm === null || distanceCm >= SENSOR_MAX_RANGE) return 0;
    return Math.min(SENSOR_MAX_RANGE - distanceCm, ULTRASONIC_MAX_SCORE);
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

// Queue-level classifier (used in index.js for ultrasonic stability logic)
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
    if (piezoHeavy)             score += 150;
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

// ── IR mode helpers ───────────────────────────────────────────────────────────
//
// Green time table:
//   No IR blocked           →  3s  (base only)
//   IR1 only, no piezo      →  3 + 3 = 6s
//   IR1 + piezo             →  3 + 3 + 3 = 9s
//   Both IR, no piezo       →  3 + 6 = 9s
//   Both IR + piezo         →  3 + 6 + 3 = 12s
//   Piezo alone (no IR)     →  3s  (no contribution)
//
function calculateScoreIR(ir1Blocked, ir2Blocked, piezoHeavy) {
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
        greenTime += HEAVY_TRAFFIC_BONUS;
    } else if (ir1Blocked) {
        greenTime += LIGHT_TRAFFIC_BONUS;
    }
    if (piezoHeavy && ir1Blocked) {
        greenTime += PIEZO_BONUS;
    }
    return greenTime;
}

// ── System mode determination ─────────────────────────────────────────────────
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
// Parameters (unchanged from v7.0 so index.js call site needs no edits):
//   sensorData    — { road: distanceCm }
//   trafficData   — { road: 'Heavy'|'Medium'|'Light'|'Unknown' }
//   sensorWorking — { road: boolean }
//   googleWorking — boolean
//   queueData     — { road: { queueLevel: 'None'|'Light'|'Heavy' } }
//   piezoData     — { road: { heavy: boolean, timestamp: number, locked: boolean } }
//   rainDetected  — boolean
//   pedStatus     — { road: { requested: boolean, crossing: boolean } }
//   espStatus     — { road: boolean }
//
// NEW in v8.0:
//   fallbackWinner — string|null  (passed by index.js when allEspDown is true)
//     When provided, this road is placed first in priorities[] so the
//     dashboard always reflects the real winner, not North by default.
//
function makeSignalDecision(
    sensorData, trafficData, sensorWorking, googleWorking,
    queueData, piezoData, rainDetected, pedStatus, espStatus,
    fallbackWinner   // FIX 1: new optional param — null when sensors are live
) {
    const ROADS      = ['North', 'South', 'East', 'West'];
    const systemMode = determineSystemMode(sensorWorking || {}, googleWorking || false);
    const currentYellowTime = rainDetected ? YELLOW_TIME_RAIN : YELLOW_TIME_DRY;

    const queue = queueData  || {};
    const piezo = piezoData  || {};
    const ped   = pedStatus  || {};
    const esp   = espStatus  || {};

    let priorities = [];

    // ── FALLBACK: no sensors, no Google ──────────────────────────────────────
    // FIX 1 + FIX 3: use fallbackWinner from index.js rotation, and
    // getFallbackGreenTime() for time-aware green duration.
    if (systemMode === 'FALLBACK') {
        const fallbackGreen = getFallbackGreenTime();

        priorities = ROADS.map(road => ({
            road,
            sensorScenario: 'FALLBACK_ROTATION',   // FIX 2: correct badge
            distance:    null,
            queueLevel:  'None',
            piezoHeavy:  false,
            traffic:     'Unknown',
            // FIX 1: winner gets highest score so sort puts it first
            score:       road === fallbackWinner ? 99 : (ROADS.length - ROADS.indexOf(road)),
            greenTime:   fallbackGreen,             // FIX 3: time-of-day value
            yellowTime:  currentYellowTime,
            mode:        'FALLBACK',
            espOnline:   esp[road] !== false
        }));

    // ── GOOGLE_ONLY: no ESP32 anywhere but Google is working ─────────────────
    } else if (systemMode === 'GOOGLE_ONLY') {
        priorities = ROADS.map(road => {
            const google = (trafficData || {})[road] || 'Unknown';
            const score  = calculateScoreUltrasonic(null);  // no distance
            const green  = calculateGreenTimeUltrasonic(null, google);
            return {
                road,
                sensorScenario: 'GOOGLE_ONLY',
                distance:   null,
                queueLevel: 'None',
                piezoHeavy: false,
                traffic:    google,
                score, greenTime: green,
                yellowTime: currentYellowTime,
                mode:       'GOOGLE_ONLY',
                espOnline:  esp[road] !== false
            };
        });

    // ── SENSOR_ONLY or BOTH: per-road logic ───────────────────────────────────
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
            // Piezo only counts when a vehicle is confirmed near the stop line
            const piezoHeavy = (piezoRoad.heavy === true) && (distanceCm !== null);

            const pedRoad    = ped[road] || { requested: false, crossing: false };

            let sensorScenario, score, greenTime;

            if (!espOnline || !sensorIsWorking) {
                // This road's ESP32 is offline — fall back per-road
                if (googleWorking) {
                    sensorScenario = 'GOOGLE_ONLY';
                    score          = calculateScoreUltrasonic(null);
                    greenTime      = calculateGreenTimeUltrasonic(null, google);
                } else {
                    sensorScenario = 'NO_DATA';
                    score          = ROADS.length - ROADS.indexOf(road);
                    greenTime      = getFallbackGreenTime(); // FIX 3: consistent
                }
            } else {
                sensorScenario = 'ULTRASONIC';
                score          = calculateScoreUltrasonicWithQueue(distanceCm, queueLevel, piezoHeavy);
                greenTime      = calculateGreenTimeUltrasonicWithQueue(distanceCm, queueLevel, piezoHeavy, google);
            }

            // Downed ESP32: exclude from winning entirely
            if (!espOnline) score = -9999;

            // Pedestrian override
            if (pedRoad.crossing) {
                score    -= 1000;
                greenTime = 0;
            } else if (pedRoad.requested) {
                score += 100;
            }

            return {
                road, sensorScenario,
                distance:       espOnline && sensorIsWorking ? distanceCm : null,
                queueLevel:     espOnline && sensorIsWorking ? queueLevel : 'None',
                piezoHeavy:     espOnline ? piezoHeavy : false,
                piezoTimestamp: piezoRoad.timestamp || 0,
                traffic:        google,
                score, greenTime,
                yellowTime:  currentYellowTime,
                mode:        systemMode,
                pedestrian:  pedRoad,
                espOnline
            };
        });
    }

    // Sort highest score first
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

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════
module.exports = {
    makeSignalDecision,
    // Helpers (used by index.js for queue classification)
    classifyQueueByUltrasonic,
    calculateGreenTimeUltrasonic,
    calculateScoreUltrasonic,
    determineSystemMode,
    getFallbackGreenTime,
    // Constants — dashboard and tests import these
    BASE_GREEN_TIME,
    LIGHT_TRAFFIC_BONUS, HEAVY_TRAFFIC_BONUS, PIEZO_BONUS,
    YELLOW_TIME_DRY, YELLOW_TIME_RAIN,
    MIN_GREEN_ULTRASONIC, MAX_GREEN_ULTRASONIC,
    SENSOR_MAX_RANGE,
    FALLBACK_GREEN_SCHEDULE
};
