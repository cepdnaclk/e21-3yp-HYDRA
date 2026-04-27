// ═══════════════════════════════════════════════════════════════════════════
// server/logic/signalDecision.js — HYDRA Full Decision Engine
// COMPLETE VERSION with Pedestrian + Heavy Vehicle Integration
// ═══════════════════════════════════════════════════════════════════════════

// ── Time Constants (matches ESP32) ──────────────────────────────────────────
const YELLOW_TIME_NORMAL = 3;      // 3 seconds base (matches ESP32 BASE_YELLOW_TIME)
const YELLOW_TIME_RAIN   = 5;      // 5 seconds when raining (3s + 2s = 5s)

// ESP32 timing constants
const BASE_RED_TIME      = 3;      // Fixed 3 seconds
const BASE_GREEN_TIME    = 3;      // 3 seconds base
const LIGHT_TRAFFIC_BONUS = 3;     // +3 seconds for light traffic (1 IR blocked)
const HEAVY_TRAFFIC_BONUS = 6;     // +6 seconds for heavy traffic (2 IR blocked)
const HEAVY_VEHICLE_BONUS = 5;     // +5 seconds for heavy vehicle detection (piezo)

const MIN_GREEN_TIME  = 3;
const MAX_GREEN_TIME  = 60;
const DEFAULT_GREEN   = 5;
const FALLBACK_GREEN  = 5;
const SENSOR_MAX_RANGE = 400; // cm

// Ultrasonic threshold — if < 20cm, switch to IR mode
const ULTRASONIC_CLOSE_THRESHOLD = 20;

// ── Priority Scoring Weights ────────────────────────────────────────────────
const WEIGHT_DISTANCE_VERY_CLOSE = 40;    // Vehicle < 50cm
const WEIGHT_DISTANCE_CLOSE      = 20;    // Vehicle < 200cm
const WEIGHT_IR_HEAVY_QUEUE      = 50;    // Both IR sensors blocked
const WEIGHT_IR_LIGHT_QUEUE      = 25;    // One IR sensor blocked
const WEIGHT_IR_NO_QUEUE         = 5;     // No IR sensors blocked
const WEIGHT_HEAVY_VEHICLE       = 15;    // Piezo detected heavy vehicle
const WEIGHT_PEDESTRIAN_WAITING  = 40;    // Pedestrian waiting to cross
const WEIGHT_PEDESTRIAN_CROSSING = 60;    // Pedestrian actively crossing

// Google traffic penalties/bonuses
const WEIGHT_TRAFFIC_HEAVY   = -50;  // Heavy traffic ahead = avoid sending more cars
const WEIGHT_TRAFFIC_MEDIUM  = -15;  // Medium traffic ahead = mild penalty
const WEIGHT_TRAFFIC_LIGHT   = +10;  // Light traffic ahead = bonus

// ────────────────────────────────────────────────────────────────────────────
// calculateScore() — Score one road with all factors
// ────────────────────────────────────────────────────────────────────────────
function calculateScore(distanceCm, trafficAhead, irQueue, heavyVehicle, useIRMode, pedestrianWaiting, pedestrianCrossing) {
    let score = 0;

    // ── Factor 1: Ultrasonic distance (only when >20cm) ─────────────────────
    if (!useIRMode && distanceCm !== null && distanceCm <= SENSOR_MAX_RANGE) {
        if (distanceCm <= 50) {
            score += WEIGHT_DISTANCE_VERY_CLOSE;
        } else if (distanceCm <= 200) {
            score += WEIGHT_DISTANCE_CLOSE;
        } else {
            score += (SENSOR_MAX_RANGE - distanceCm) / 20;
        }
    }

    // ── Factor 2: IR Queue Mode (when distance < 20cm or no ultrasonic) ─────
    if (useIRMode) {
        if (irQueue === 'Heavy') {
            score += WEIGHT_IR_HEAVY_QUEUE;      // Both IR blocked
        } else if (irQueue === 'Light') {
            score += WEIGHT_IR_LIGHT_QUEUE;      // One IR blocked
        } else if (irQueue !== 'None') {
            score += WEIGHT_IR_NO_QUEUE;          // IR present but no queue
        }
    }

    // ── Factor 3: Heavy Vehicle Detection (Piezo) ───────────────────────────
    if (heavyVehicle) {
        score += WEIGHT_HEAVY_VEHICLE;
    }

    // ── Factor 4: Pedestrian Priority ───────────────────────────────────────
    if (pedestrianCrossing) {
        score += WEIGHT_PEDESTRIAN_CROSSING;     // Highest priority for active crossing
    } else if (pedestrianWaiting) {
        score += WEIGHT_PEDESTRIAN_WAITING;      // Waiting pedestrian needs attention
    }

    // ── Factor 5: Google Traffic at next intersection ──────────────────────
    switch (trafficAhead) {
        case 'Heavy':  score += WEIGHT_TRAFFIC_HEAVY;  break;
        case 'Medium': score += WEIGHT_TRAFFIC_MEDIUM; break;
        case 'Light':  score += WEIGHT_TRAFFIC_LIGHT;  break;
        default: break;  // Unknown = neutral
    }

    return score;
}

// ────────────────────────────────────────────────────────────────────────────
// calculateGreenTime() — Calculate green duration based on all factors
// ────────────────────────────────────────────────────────────────────────────
function calculateGreenTime(distanceCm, trafficAhead, irQueue, heavyVehicle, useIRMode, pedestrianCrossing) {
    let baseTime = BASE_GREEN_TIME;

    // ── Pedestrian crossing takes fixed time ───────────────────────────────
    if (pedestrianCrossing) {
        return 10;  // Fixed 10 seconds for pedestrian crossing (matches ESP32 PED_CROSS_TIME)
    }

    // ── IR Mode (distance < 20cm) ──────────────────────────────────────────
    if (useIRMode) {
        if (irQueue === 'Heavy') {
            baseTime = BASE_GREEN_TIME + HEAVY_TRAFFIC_BONUS;  // 3s + 6s = 9s
        } else if (irQueue === 'Light') {
            baseTime = BASE_GREEN_TIME + LIGHT_TRAFFIC_BONUS;  // 3s + 3s = 6s
        } else {
            baseTime = BASE_GREEN_TIME;  // 3s
        }
    } 
    // ── Ultrasonic Mode (distance > 20cm) ──────────────────────────────────
    else {
        if (distanceCm === null || distanceCm > SENSOR_MAX_RANGE) {
            // No vehicle detected, use Google traffic data
            if (trafficAhead === 'Heavy')  return 40;
            if (trafficAhead === 'Medium') return 25;
            if (trafficAhead === 'Light')  return MIN_GREEN_TIME;
            return DEFAULT_GREEN;
        }
        
        // Calculate based on distance (closer vehicle = more green time needed)
        const factor = (distanceCm / SENSOR_MAX_RANGE) * 20;
        baseTime = MIN_GREEN_TIME + factor;
        baseTime = Math.min(baseTime, MAX_GREEN_TIME);
    }

    // ── Heavy Vehicle extends green time ───────────────────────────────────
    if (heavyVehicle) {
        baseTime += HEAVY_VEHICLE_BONUS;  // +5 seconds
    }

    // ── Google traffic adjustments ─────────────────────────────────────────
    if (trafficAhead === 'Heavy') {
        baseTime = Math.max(baseTime * 0.7, MIN_GREEN_TIME);  // Reduce if jammed ahead
    } else if (trafficAhead === 'Light') {
        baseTime = Math.min(baseTime * 1.2, MAX_GREEN_TIME);   // Increase if road clear
    }

    return Math.round(Math.min(Math.max(baseTime, MIN_GREEN_TIME), MAX_GREEN_TIME));
}

// ────────────────────────────────────────────────────────────────────────────
// determineMode() — Determine which operating mode to use
// ────────────────────────────────────────────────────────────────────────────
function determineMode(sensorWorking, googleWorking) {
    const anySensor = Object.values(sensorWorking || {}).some(v => v === true);
    const google    = googleWorking === true;
    
    if (anySensor && google)   return 'BOTH';
    if (anySensor && !google)  return 'SENSOR_ONLY';
    if (!anySensor && google)  return 'GOOGLE_ONLY';
    return 'FALLBACK';
}

// ────────────────────────────────────────────────────────────────────────────
// getCurrentYellowTime() — Get yellow time based on rain status
// ────────────────────────────────────────────────────────────────────────────
function getCurrentYellowTime(rainDetected) {
    return rainDetected ? YELLOW_TIME_RAIN : YELLOW_TIME_NORMAL;
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN DECISION FUNCTION — makeSignalDecision()
// ────────────────────────────────────────────────────────────────────────────
function makeSignalDecision(sensorData, trafficData, sensorWorking, googleWorking, irData, piezoData, rainDetected, pedStatus) {
    const ROADS = ['North', 'South', 'East', 'West'];
    const mode  = determineMode(sensorWorking || {}, googleWorking || false);
    
    // Get current yellow time based on rain
    const currentYellowTime = getCurrentYellowTime(rainDetected || false);

    // Safe defaults
    const ir    = irData    || {};
    const piezo = piezoData || {};
    const ped   = pedStatus || {};

    let priorities = [];

    // ── FALLBACK MODE ──────────────────────────────────────────────────────
    if (mode === 'FALLBACK') {
        priorities = ROADS.map((road, i) => ({
            road, 
            distance: null, 
            traffic: 'Unknown',
            score: ROADS.length - i, 
            greenTime: FALLBACK_GREEN, 
            yellowTime: currentYellowTime, 
            mode: 'FALLBACK',
            pedestrianWaiting: false,
            pedestrianCrossing: false,
            heavyVehicle: false,
            irQueue: 'None'
        }));
    } 
    // ── NORMAL MODES (BOTH, SENSOR_ONLY, GOOGLE_ONLY) ──────────────────────
    else {
        priorities = ROADS.map(road => {
            const dist = (sensorData[road] > SENSOR_MAX_RANGE) ? null : sensorData[road];
            const traffic = (trafficData || {})[road] || 'Unknown';
            const irRoad = ir[road] || { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' };
            const heavy = piezo[road] || false;
            const pedRoad = ped[road] || { requested: false, crossing: false, duration: 0 };

            // Determine if using IR mode (distance < 20cm or null but IR present)
            const useIRMode = (dist !== null && dist < ULTRASONIC_CLOSE_THRESHOLD)
                           || (dist === null && irRoad.queueLevel !== 'None');

            let score = 0;
            let greenTime = DEFAULT_GREEN;

            if (mode === 'BOTH' || mode === 'SENSOR_ONLY') {
                score = calculateScore(
                    dist, traffic, irRoad.queueLevel, heavy, useIRMode,
                    pedRoad.requested, pedRoad.crossing
                );
                greenTime = calculateGreenTime(
                    dist, traffic, irRoad.queueLevel, heavy, useIRMode,
                    pedRoad.crossing
                );
            } else if (mode === 'GOOGLE_ONLY') {
                score = calculateScore(
                    null, traffic, 'None', false, false,
                    pedRoad.requested, pedRoad.crossing
                );
                greenTime = calculateGreenTime(
                    null, traffic, 'None', false, false,
                    pedRoad.crossing
                );
            }

            return { 
                road, 
                distance: dist, 
                traffic, 
                score, 
                greenTime, 
                yellowTime: currentYellowTime,
                irQueue: irRoad.queueLevel, 
                ir1Blocked: irRoad.ir1Blocked || false,
                ir2Blocked: irRoad.ir2Blocked || false,
                heavyVehicle: heavy, 
                useIRMode, 
                mode,
                pedestrianWaiting: pedRoad.requested || false,
                pedestrianCrossing: pedRoad.crossing || false,
                pedestrianDuration: pedRoad.duration || 0
            };
        });
    }

    // ── Sort by score (highest first) ──────────────────────────────────────
    priorities.sort((a, b) => b.score - a.score);
    const winner = priorities[0];

    // ── Build commands for each road ───────────────────────────────────────
    const commands = {};
    ROADS.forEach(road => {
        if (road === winner.road) {
            commands[road] = { 
                signal: 'GREEN', 
                greenTime: winner.greenTime, 
                yellowTime: currentYellowTime,
                reason: buildReason(winner)
            };
        } else {
            commands[road] = { 
                signal: 'RED',   
                greenTime: 0, 
                yellowTime: 0,
                reason: 'Waiting for turn'
            };
        }
    });

    return {
        timestamp:      new Date().toISOString(),
        mode,
        winner:         winner.road,
        greenDuration:  winner.greenTime,
        yellowDuration: currentYellowTime,
        redDuration:    BASE_RED_TIME,
        redForOthers:   winner.greenTime + currentYellowTime,
        priorities,
        commands,
        dataStatus: { 
            sensorWorking, 
            googleWorking,
            pedActive: priorities.some(p => p.pedestrianWaiting || p.pedestrianCrossing),
            heavyVehiclePresent: priorities.some(p => p.heavyVehicle)
        },
        weather: { 
            rainDetected: rainDetected || false, 
            yellowTime: currentYellowTime 
        }
    };
}

// ── Helper: Build human-readable reason string for dashboard ────────────────
function buildReason(road) {
    const parts = [];
    
    if (road.distance !== null && road.distance <= SENSOR_MAX_RANGE) {
        parts.push(`Vehicle ${road.distance}cm away`);
    } else if (road.distance === null) {
        parts.push('No vehicle detected');
    }
    
    if (road.irQueue && road.irQueue !== 'None') {
        parts.push(`IR Queue: ${road.irQueue}`);
    }
    
    if (road.heavyVehicle) {
        parts.push(`🚛 Heavy vehicle detected (+${HEAVY_VEHICLE_BONUS}s)`);
    }
    
    if (road.pedestrianWaiting) {
        parts.push(`🚶 Pedestrian waiting (+${WEIGHT_PEDESTRIAN_WAITING} priority)`);
    }
    
    if (road.pedestrianCrossing) {
        parts.push(`🚶🚶 Pedestrian crossing (${road.pedestrianDuration}s)`);
    }
    
    if (road.traffic && road.traffic !== 'Unknown') {
        parts.push(`Next intersection: ${road.traffic}`);
    }
    
    parts.push(`Score: ${road.score.toFixed(1)}`);
    parts.push(`Green: ${road.greenTime}s`);
    
    return parts.join(' | ');
}

// ── Exports ──────────────────────────────────────────────────────────────────
module.exports = { 
    makeSignalDecision, 
    calculateScore,
    calculateGreenTime,
    YELLOW_TIME_NORMAL, 
    YELLOW_TIME_RAIN,
    BASE_RED_TIME,
    BASE_GREEN_TIME,
    LIGHT_TRAFFIC_BONUS,
    HEAVY_TRAFFIC_BONUS,
    HEAVY_VEHICLE_BONUS,
    MIN_GREEN_TIME, 
    MAX_GREEN_TIME,
    WEIGHT_PEDESTRIAN_WAITING,
    WEIGHT_PEDESTRIAN_CROSSING
};