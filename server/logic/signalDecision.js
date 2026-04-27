// ═══════════════════════════════════════════════════════════════════════════
// server/logic/signalDecision.js — HYDRA Dual-Mode Decision Engine
// UPDATED: Matches ESP32 pedestrian and piezo logic from working reference
// ═══════════════════════════════════════════════════════════════════════════

// ── Timing constants (must match ESP32 firmware exactly) ────────────────────
const BASE_RED_TIME          = 3;   // seconds — fixed always
const BASE_GREEN_TIME        = 3;   // seconds — minimum green
const BASE_YELLOW_TIME       = 3;   // seconds — dry conditions
const RAIN_YELLOW_EXTRA      = 2;   // seconds added when raining → 5s total

// IR mode green time bonuses
const LIGHT_TRAFFIC_BONUS    = 3;   // +3s when only IR1 blocked → 6s total
const HEAVY_TRAFFIC_BONUS    = 6;   // +6s when both IR blocked   → 9s total
const PIEZO_HEAVY_BONUS      = 5;   // +5s on top of heavy IR bonus → 14s total

// Ultrasonic mode limits
const SENSOR_MAX_RANGE       = 400; // cm — beyond this = no vehicle
const MIN_GREEN_ULTRASONIC   = 10;  // seconds minimum in ultrasonic mode
const MAX_GREEN_ULTRASONIC   = 60;  // seconds maximum in ultrasonic mode
const DEFAULT_GREEN          = 5;   // seconds when no data available

// Mode switch threshold
const IR_MODE_THRESHOLD      = 20;  // cm — below this → IR mode, above → ultrasonic mode

// Fallback (no data at all)
const FALLBACK_GREEN         = 5;

// Pedestrian crossing duration (matches ESP32: 10 seconds)
const PED_CROSS_TIME         = 10;

// Yellow timing
const YELLOW_TIME_DRY        = BASE_YELLOW_TIME;                       // 3s
const YELLOW_TIME_RAIN       = BASE_YELLOW_TIME + RAIN_YELLOW_EXTRA;  // 5s

// ── Score weights ───────────────────────────────────────────────────────────
const WEIGHT_DIST_VERY_CLOSE = 40;   // vehicle ≤50cm
const WEIGHT_DIST_MEDIUM     = 20;   // vehicle ≤200cm
const WEIGHT_GOOGLE_HEAVY    = -50;  // next intersection jammed → penalise
const WEIGHT_GOOGLE_MEDIUM   = -15;
const WEIGHT_GOOGLE_LIGHT    = +10;  // next intersection clear  → reward

// IR mode score weights
const IR_SCORE_HEAVY         = 50;   // Both IR blocked
const IR_SCORE_LIGHT         = 25;   // Only IR1 blocked
const IR_SCORE_NONE          = 5;    // No IR blocked
const IR_SCORE_PIEZO_BONUS   = 15;   // Extra for heavy vehicle

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1: MODE SELECTOR
// ════════════════════════════════════════════════════════════════════════════
function selectSensorMode(distanceCm) {
    if (distanceCm === null || distanceCm === undefined) return 'ULTRASONIC';
    if (distanceCm >= SENSOR_MAX_RANGE) return 'ULTRASONIC';
    if (distanceCm < IR_MODE_THRESHOLD) return 'IR';
    return 'ULTRASONIC';
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2A: ULTRASONIC MODE — Green time calculation
// ════════════════════════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2B: ULTRASONIC MODE — Priority score
// ════════════════════════════════════════════════════════════════════════════
function calculateScoreUltrasonic(distanceCm, googleTraffic) {
    let score = 0;

    if (distanceCm !== null && distanceCm < SENSOR_MAX_RANGE) {
        if (distanceCm <= 50)       score += WEIGHT_DIST_VERY_CLOSE;
        else if (distanceCm <= 200) score += WEIGHT_DIST_MEDIUM;
        else score += (SENSOR_MAX_RANGE - distanceCm) / 20;
    }

    switch (googleTraffic) {
        case 'Heavy':  score += WEIGHT_GOOGLE_HEAVY;  break;
        case 'Medium': score += WEIGHT_GOOGLE_MEDIUM; break;
        case 'Light':  score += WEIGHT_GOOGLE_LIGHT;  break;
    }

    return score;
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3A: IR MODE — Green time calculation
// ════════════════════════════════════════════════════════════════════════════
function calculateGreenTimeIR(ir1Blocked, ir2Blocked, piezoHeavy) {
    let greenTime = BASE_GREEN_TIME;

    if (ir1Blocked && ir2Blocked) {
        greenTime = BASE_GREEN_TIME + HEAVY_TRAFFIC_BONUS;
        if (piezoHeavy) {
            greenTime += PIEZO_HEAVY_BONUS;
        }
    } else if (ir1Blocked) {
        greenTime = BASE_GREEN_TIME + LIGHT_TRAFFIC_BONUS;
    }

    return greenTime;
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3B: IR MODE — Priority score
// ════════════════════════════════════════════════════════════════════════════
function calculateScoreIR(ir1Blocked, ir2Blocked, piezoHeavy, googleTraffic) {
    let score = 0;

    if (ir1Blocked && ir2Blocked) {
        score = IR_SCORE_HEAVY;
        if (piezoHeavy) score += IR_SCORE_PIEZO_BONUS;
    } else if (ir1Blocked) {
        score = IR_SCORE_LIGHT;
    } else {
        score = IR_SCORE_NONE;
    }

    switch (googleTraffic) {
        case 'Heavy':  score += WEIGHT_GOOGLE_HEAVY;  break;
        case 'Medium': score += WEIGHT_GOOGLE_MEDIUM; break;
        case 'Light':  score += WEIGHT_GOOGLE_LIGHT;  break;
    }

    return score;
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 4: SYSTEM MODE
// ════════════════════════════════════════════════════════════════════════════
function determineSystemMode(sensorWorking, googleWorking) {
    const anySensor = Object.values(sensorWorking || {}).some(v => v === true);
    const google    = googleWorking === true;
    if (anySensor && google)   return 'BOTH';
    if (anySensor && !google)  return 'SENSOR_ONLY';
    if (!anySensor && google)  return 'GOOGLE_ONLY';
    return 'FALLBACK';
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 5: PEDESTRIAN STATE MANAGEMENT
// Matches ESP32 pedestrian logic:
// - Button during RED → Immediate crossing
// - Button during YELLOW → Countdown remaining, then crossing
// - Button during GREEN → Set flag, crossing after YELLOW
// - After crossing → Skip RED (skipRedAfterCrossing = true)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Determines if a road should be in pedestrian crossing state
 * Based on the pedestrian status from ESP32
 */
function isRoadCrossing(pedStatus, road) {
    const ped = pedStatus[road] || {};
    return ped.crossing === true;
}

/**
 * Determines if a road has a pending pedestrian request
 */
function hasPedestrianRequest(pedStatus, road) {
    const ped = pedStatus[road] || {};
    return ped.requested === true;
}

/**
 * Gets pedestrian crossing remaining time
 */
function getPedestrianRemainingTime(pedStatus, road) {
    const ped = pedStatus[road] || {};
    return ped.duration || 0;
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 6: PIEZO STATE MANAGEMENT
// Matches ESP32 piezo logic:
// - Vibration detected → extendNextGreen = true
// - Next GREEN gets +5 seconds
// - Flag cleared after applying
// ════════════════════════════════════════════════════════════════════════════

/**
 * Checks if a road has pending piezo extension for next GREEN
 */
function hasPiezoExtension(piezoData, road) {
    return piezoData[road] === true;
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 7: MAIN DECISION FUNCTION
// ════════════════════════════════════════════════════════════════════════════
function makeSignalDecision(
    sensorData,    // { North: distanceCm, South: ..., East: ..., West: ... }
    trafficData,   // { North: 'Heavy'|'Medium'|'Light'|'Unknown', ... }
    sensorWorking, // { North: bool, ... }
    googleWorking, // bool
    irData,        // { North: { ir1Blocked, ir2Blocked, queueLevel }, ... }
    piezoData,     // { North: bool, ... }  true = heavy vehicle detected (extends next GREEN)
    rainDetected,  // bool
    pedStatus      // { North: { requested, crossing, duration }, ... }
) {
    const ROADS      = ['North', 'South', 'East', 'West'];
    const systemMode = determineSystemMode(sensorWorking || {}, googleWorking || false);

    // Yellow time — rain always affects this
    const currentYellowTime = rainDetected ? YELLOW_TIME_RAIN : YELLOW_TIME_DRY;

    // Safe defaults
    const ir    = irData    || {};
    const piezo = piezoData || {};
    const ped   = pedStatus || {};

    let priorities = [];

    // ── FALLBACK: no sensors, no Google ──────────────────────────────────────
    if (systemMode === 'FALLBACK') {
        priorities = ROADS.map((road, i) => ({
            road,
            sensorScenario: 'FALLBACK',
            distance:        null,
            ir1Blocked:      false,
            ir2Blocked:      false,
            piezoHeavy:      false,
            traffic:         'Unknown',
            score:           ROADS.length - i,
            greenTime:       FALLBACK_GREEN,
            yellowTime:      currentYellowTime,
            mode:            'FALLBACK',
            pedestrian:      { requested: false, crossing: false, duration: 0 },
            piezoExtension:  false
        }));

    // ── GOOGLE ONLY: sensors all offline ─────────────────────────────────────
    } else if (systemMode === 'GOOGLE_ONLY') {
        priorities = ROADS.map(road => {
            const google = (trafficData || {})[road] || 'Unknown';
            const score = calculateScoreUltrasonic(null, google);
            const greenTime = calculateGreenTimeUltrasonic(null, google);
            
            return {
                road,
                sensorScenario: 'GOOGLE_ONLY',
                distance:        null,
                ir1Blocked:      false,
                ir2Blocked:      false,
                piezoHeavy:      false,
                traffic:         google,
                score,
                greenTime,
                yellowTime:      currentYellowTime,
                mode:            'GOOGLE_ONLY',
                pedestrian:      { requested: false, crossing: false, duration: 0 },
                piezoExtension:  false
            };
        });

    // ── SENSOR_ONLY or BOTH: main dual-scenario logic ─────────────────────
    } else {
        priorities = ROADS.map(road => {
            // Read current distance
            const rawDist = sensorData[road];
            const distanceCm = (rawDist === undefined || rawDist === null || rawDist >= SENSOR_MAX_RANGE)
                                ? null
                                : rawDist;

            const google = (trafficData || {})[road] || 'Unknown';
            const irRoad = ir[road] || { ir1Blocked: false, ir2Blocked: false };
            const piezoHeavy = piezo[road] === true;
            const pedRoad = ped[road] || { requested: false, crossing: false, duration: 0 };
            
            // Select sensor scenario
            const sensorScenario = selectSensorMode(distanceCm);

            let score, greenTime;

            if (sensorScenario === 'IR') {
                score = calculateScoreIR(
                    irRoad.ir1Blocked,
                    irRoad.ir2Blocked,
                    piezoHeavy,
                    systemMode === 'BOTH' ? google : 'Unknown'
                );
                greenTime = calculateGreenTimeIR(
                    irRoad.ir1Blocked,
                    irRoad.ir2Blocked,
                    piezoHeavy
                );
            } else {
                score = calculateScoreUltrasonic(distanceCm, google);
                greenTime = calculateGreenTimeUltrasonic(distanceCm, google);
            }

            // ── PEDESTRIAN OVERRIDE (Matches ESP32 logic) ───────────────────
            // If road is actively being crossed → must be RED, cannot win
            if (pedRoad.crossing) {
                score = -1000;
                greenTime = 0;
            }
            // If pedestrian requested, boost priority so this road wins quickly
            // This triggers the crossing phase after YELLOW
            else if (pedRoad.requested) {
                score += 200;  // High priority boost
            }

            // ── PIEZO EXTENSION (Matches ESP32 logic) ───────────────────────
            // piezoHeavy means extendNextGreen = true for next GREEN
            // The greenTime already includes the bonus via calculateGreenTimeIR
            // But we need to track it for dashboard display
            
            return {
                road,
                sensorScenario,
                distance: distanceCm,
                ir1Blocked: irRoad.ir1Blocked || false,
                ir2Blocked: irRoad.ir2Blocked || false,
                piezoHeavy: piezoHeavy,
                traffic: google,
                score,
                greenTime,
                yellowTime: currentYellowTime,
                mode: systemMode,
                pedestrian: {
                    requested: pedRoad.requested,
                    crossing: pedRoad.crossing,
                    duration: pedRoad.duration || 0
                },
                piezoExtension: piezoHeavy  // Will apply to next GREEN
            };
        });
    }

    // ── Sort by score — highest wins GREEN ───────────────────────────────────
    priorities.sort((a, b) => b.score - a.score);
    const winner = priorities[0];

    // ── Build per-road commands ───────────────────────────────────────────────
    // IMPORTANT: For roads that are crossing, force RED
    // For the winner, send GREEN if not crossing
    const commands = {};
    ROADS.forEach(road => {
        const roadPed = ped[road] || {};
        
        // If road is actively being crossed, force RED
        if (roadPed.crossing) {
            commands[road] = { 
                signal: 'RED', 
                greenTime: 0, 
                yellowTime: currentYellowTime,
                reason: 'pedestrian_crossing'
            };
        } 
        // Winner gets GREEN (if not crossing, which we already checked)
        else if (road === winner.road) {
            commands[road] = { 
                signal: 'GREEN', 
                greenTime: winner.greenTime, 
                yellowTime: currentYellowTime,
                reason: 'winner'
            };
        } 
        // Others get RED
        else {
            commands[road] = { 
                signal: 'RED', 
                greenTime: 0, 
                yellowTime: 0,
                reason: 'loser'
            };
        }
    });

    return {
        timestamp: new Date().toISOString(),
        mode: systemMode,
        winner: winner.road,
        winnerScenario: winner.sensorScenario,
        greenDuration: winner.greenTime,
        yellowDuration: currentYellowTime,
        redDuration: BASE_RED_TIME,
        redForOthers: winner.greenTime + currentYellowTime,
        priorities,
        commands,
        dataStatus: { sensorWorking, googleWorking },
        weather: { rainDetected: rainDetected || false, yellowTime: currentYellowTime },
        pedestrianStatus: ped,
        piezoStatus: piezoData
    };
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════
module.exports = {
    makeSignalDecision,
    selectSensorMode,
    calculateGreenTimeUltrasonic,
    calculateGreenTimeIR,
    calculateScoreUltrasonic,
    calculateScoreIR,
    // Helper functions for external use
    isRoadCrossing,
    hasPedestrianRequest,
    getPedestrianRemainingTime,
    hasPiezoExtension,
    // Constants
    IR_MODE_THRESHOLD,
    BASE_RED_TIME,
    BASE_GREEN_TIME,
    LIGHT_TRAFFIC_BONUS,
    HEAVY_TRAFFIC_BONUS,
    PIEZO_HEAVY_BONUS,
    YELLOW_TIME_DRY,
    YELLOW_TIME_RAIN,
    MIN_GREEN_ULTRASONIC,
    MAX_GREEN_ULTRASONIC,
    PED_CROSS_TIME
};