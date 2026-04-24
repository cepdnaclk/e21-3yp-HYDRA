// // ═══════════════════════════════════════════════════════════════════════════
// // server/logic/signalDecision.js — HYDRA Priority Engine (COMPLETE VERSION)
// // ═══════════════════════════════════════════════════════════════════════════
// //
// // FOUR OPERATING MODES (automatically selected based on what data is working):
// //
// //   MODE 1 — BOTH WORKING   : sensor + Google traffic → full priority
// //   MODE 2 — SENSOR ONLY    : ultrasonic distance only → closer = priority
// //   MODE 3 — GOOGLE ONLY    : next-intersection traffic only → avoid jams
// //   MODE 4 — FALLBACK       : neither working → fixed 5s rotation
// //
// // REAL-WORLD LOGIC EXAMPLE (Nawinna Junction):
// //   • North road vehicle 50cm away
// //   • South road vehicle 30cm away (CLOSER = normally wins)
// //   • BUT: Google shows HEAVY traffic at Clocktower (next for North direction)
// //   • AND: South road leads toward Clocktower
// //   • Result: RED for South (would create jam), GREEN for North (cars can EXIT)
// //
// // GREEN TIME: calculated from distance (closer vehicle = slightly longer green)
// // YELLOW TIME: always 5 seconds (constant, as requested)
// // RED TIME: same as green time of current winner for all other roads
// // ═══════════════════════════════════════════════════════════════════════════

// // ── Time Constants (seconds) ────────────────────────────────────────────────
// const YELLOW_TIME    = 5;    // Always 5 seconds — constant as required
// const MIN_GREEN_TIME = 10;   // Minimum green (low traffic, far vehicle)
// const MAX_GREEN_TIME = 60;   // Maximum green (heavy traffic)
// const DEFAULT_GREEN  = 5;    // Default when no data (fallback mode)
// const FALLBACK_GREEN = 5;    // Fixed cycle time in fallback mode

// // Sensor max range — beyond this = no vehicle detected
// const SENSOR_MAX_RANGE = 400; // cm

// // ── Priority Scoring Weights ────────────────────────────────────────────────
// // These numbers determine how much each factor matters
// const WEIGHT_DISTANCE_CLOSE  = 40;   // Very close vehicle (+40 bonus)
// const WEIGHT_DISTANCE_MED    = 20;   // Medium distance (+20 bonus)
// const WEIGHT_TRAFFIC_HEAVY   = -50;  // Heavy next intersection (-50 penalty)
// const WEIGHT_TRAFFIC_MEDIUM  = -15;  // Medium next intersection (-15 penalty)
// const WEIGHT_TRAFFIC_LIGHT   = +10;  // Clear next intersection (+10 bonus)

// // ════════════════════════════════════════════════════════════════════════════
// // calculateScore() — Score one road
// // ════════════════════════════════════════════════════════════════════════════
// function calculateScore(distanceCm, trafficAhead) {
//     let score = 0;

//     // ── Factor 1: Ultrasonic distance ──────────────────────────────────────
//     // A vehicle closer to the stop line needs to move first
//     if (distanceCm !== null && distanceCm <= SENSOR_MAX_RANGE) {
//         if (distanceCm <= 50) {
//             score += WEIGHT_DISTANCE_CLOSE;     // Very close: high priority
//         } else if (distanceCm <= 200) {
//             score += WEIGHT_DISTANCE_MED;       // Medium distance
//         } else {
//             score += (SENSOR_MAX_RANGE - distanceCm) / 20; // Far: small bonus
//         }
//     }
//     // No vehicle detected = 0 bonus (no urgency)

//     // ── Factor 2: Next intersection traffic ────────────────────────────────
//     // CRITICAL: Don't send cars where they'll just create more congestion
//     // This is the Nawinna-Clocktower scenario from the requirements
//     switch (trafficAhead) {
//         case 'Heavy':   score += WEIGHT_TRAFFIC_HEAVY;  break;
//         case 'Medium':  score += WEIGHT_TRAFFIC_MEDIUM; break;
//         case 'Light':   score += WEIGHT_TRAFFIC_LIGHT;  break;
//         default: break; // Unknown: neutral (0 adjustment)
//     }

//     return score;
// }

// // ════════════════════════════════════════════════════════════════════════════
// // calculateGreenTime() — How long should green stay on?
// // ════════════════════════════════════════════════════════════════════════════
// function calculateGreenTime(distanceCm, trafficAhead) {
//     // If vehicle very close or no sensor data, use base time
//     if (distanceCm === null || distanceCm > SENSOR_MAX_RANGE) {
//         // Check Google traffic for time estimate
//         if (trafficAhead === 'Heavy')  return 40; // Many vehicles coming
//         if (trafficAhead === 'Medium') return 25;
//         if (trafficAhead === 'Light')  return MIN_GREEN_TIME;
//         return DEFAULT_GREEN; // Unknown
//     }

//     // Vehicle detected: time based on distance
//     // Far vehicle = more time needed to reach stop line and clear
//     // Close vehicle = less time needed
//     const distanceFactor = (distanceCm / SENSOR_MAX_RANGE) * 20; // 0 to 20 extra seconds
//     let greenTime = MIN_GREEN_TIME + distanceFactor;

//     // Adjust for next intersection capacity
//     if (trafficAhead === 'Heavy') {
//         greenTime = Math.max(greenTime * 0.7, MIN_GREEN_TIME); // Reduce if jammed ahead
//     } else if (trafficAhead === 'Light') {
//         greenTime = Math.min(greenTime * 1.2, MAX_GREEN_TIME); // Increase if road clear
//     }

//     return Math.round(Math.min(Math.max(greenTime, MIN_GREEN_TIME), MAX_GREEN_TIME));
// }

// // ════════════════════════════════════════════════════════════════════════════
// // determineMode() — Figure out which operating mode to use
// // ════════════════════════════════════════════════════════════════════════════
// function determineMode(sensorWorking, googleWorking) {
//     const anySensorWorking = Object.values(sensorWorking).some(v => v === true);
//     const google = googleWorking === true;

//     if (anySensorWorking && google)  return 'BOTH';
//     if (anySensorWorking && !google) return 'SENSOR_ONLY';
//     if (!anySensorWorking && google) return 'GOOGLE_ONLY';
//     return 'FALLBACK';
// }

// // ════════════════════════════════════════════════════════════════════════════
// // makeSignalDecision() — MAIN FUNCTION
// // Called by server whenever new sensor data arrives or Google updates
// // ════════════════════════════════════════════════════════════════════════════
// function makeSignalDecision(sensorData, trafficData, sensorWorking, googleWorking) {
//     const ROADS = ['North', 'South', 'East', 'West'];
//     const mode  = determineMode(sensorWorking || {}, googleWorking || false);

//     let priorities = [];

//     // ──────────────────────────────────────────────────────────────────────
//     // MODE 4: FALLBACK — Neither sensor nor Google working
//     // Use fixed default timing, rotate through roads in order
//     // ──────────────────────────────────────────────────────────────────────
//     if (mode === 'FALLBACK') {
//         priorities = ROADS.map((road, i) => ({
//             road,
//             distance:  null,
//             traffic:   'Unknown',
//             score:     ROADS.length - i, // North first by default
//             greenTime: FALLBACK_GREEN,
//             mode:      'FALLBACK'
//         }));
//     }

//     // ──────────────────────────────────────────────────────────────────────
//     // MODE 2: SENSOR ONLY — Only ultrasonic data available
//     // Closer vehicle = higher priority. Google penalty ignored.
//     // ──────────────────────────────────────────────────────────────────────
//     else if (mode === 'SENSOR_ONLY') {
//         priorities = ROADS.map(road => {
//             const dist = sensorData[road] > SENSOR_MAX_RANGE ? null : sensorData[road];
//             let score  = 0;
//             if (dist !== null) {
//                 score = (SENSOR_MAX_RANGE - dist); // Closer = higher score
//             }
//             return {
//                 road,
//                 distance:  dist,
//                 traffic:   'Unknown',
//                 score,
//                 greenTime: calculateGreenTime(dist, 'Unknown'),
//                 mode:      'SENSOR_ONLY'
//             };
//         });
//     }

//     // ──────────────────────────────────────────────────────────────────────
//     // MODE 3: GOOGLE ONLY — Only Google traffic data available
//     // Penalise roads that lead to jammed intersections.
//     // ──────────────────────────────────────────────────────────────────────
//     else if (mode === 'GOOGLE_ONLY') {
//         priorities = ROADS.map(road => {
//             const traffic = trafficData[road] || 'Unknown';
//             const score   = calculateScore(null, traffic);
//             return {
//                 road,
//                 distance:  null,
//                 traffic,
//                 score,
//                 greenTime: calculateGreenTime(null, traffic),
//                 mode:      'GOOGLE_ONLY'
//             };
//         });
//     }

//     // ──────────────────────────────────────────────────────────────────────
//     // MODE 1: BOTH — Full priority using both sensor + Google
//     // This is the main intended mode for real deployment
//     // ──────────────────────────────────────────────────────────────────────
//     else { // BOTH
//         priorities = ROADS.map(road => {
//             const dist    = sensorData[road] > SENSOR_MAX_RANGE ? null : sensorData[road];
//             const traffic = trafficData[road] || 'Unknown';
//             const score   = calculateScore(dist, traffic);
//             return {
//                 road,
//                 distance:  dist,
//                 traffic,
//                 score,
//                 greenTime: calculateGreenTime(dist, traffic),
//                 mode:      'BOTH'
//             };
//         });
//     }

//     // ── Sort by score, highest first ───────────────────────────────────────
//     priorities.sort((a, b) => b.score - a.score);

//     // ── Winner = road with highest score ───────────────────────────────────
//     const winner = priorities[0];

//     // ── Build commands for each road ───────────────────────────────────────
//     const commands = {};
//     ROADS.forEach(road => {
//         if (road === winner.road) {
//             commands[road] = {
//                 signal:    'GREEN',
//                 greenTime: winner.greenTime,
//                 reason:    buildReason(winner)
//             };
//         } else {
//             commands[road] = {
//                 signal:    'RED',
//                 greenTime: 0,
//                 reason:    'Waiting for turn'
//             };
//         }
//     });

//     // ── Red time for others = green time of winner + yellow time ───────────
//     const redTimeForOthers = winner.greenTime + YELLOW_TIME;

//     return {
//         timestamp:      new Date().toISOString(),
//         mode,                              // Which operating mode
//         winner:         winner.road,       // Which road gets GREEN
//         greenDuration:  winner.greenTime,  // Green time in seconds
//         yellowDuration: YELLOW_TIME,       // Always 5s
//         redForOthers:   redTimeForOthers,  // Red time for other 3 roads
//         priorities,                        // Full sorted list for dashboard
//         commands,                          // Command per road
//         dataStatus: {
//             sensorWorking,
//             googleWorking
//         }
//     };
// }

// // ── Helper: Build human-readable reason string ──────────────────────────────
// function buildReason(road) {
//     const parts = [];
//     if (road.distance !== null) {
//         parts.push(`Vehicle ${road.distance}cm away`);
//     } else {
//         parts.push('No vehicle detected');
//     }
//     if (road.traffic !== 'Unknown') {
//         parts.push(`Next intersection: ${road.traffic}`);
//     }
//     parts.push(`Score: ${road.score.toFixed(1)}`);
//     return parts.join(' | ');
// }

// module.exports = {
//     makeSignalDecision,
//     calculateScore,
//     calculateGreenTime,
//     YELLOW_TIME,
//     MIN_GREEN_TIME,
//     MAX_GREEN_TIME,
//     FALLBACK_GREEN
// };

// ═══════════════════════════════════════════════════════════════════════════
// server/logic/signalDecision.js — HYDRA Full Decision Engine
// ═══════════════════════════════════════════════════════════════════════════

// logic/signalDecision.js - CORRECTED for ESP32 timing (3s yellow base, 5s when raining)

const YELLOW_TIME_NORMAL = 3;      // 3 seconds base (matches ESP32 BASE_YELLOW_TIME)
const YELLOW_TIME_RAIN   = 5;      // 5 seconds when raining (3s + 2s = 5s)

// ESP32 timing constants
const BASE_RED_TIME      = 3;      // Fixed 3 seconds
const BASE_GREEN_TIME    = 3;      // 3 seconds base
const LIGHT_TRAFFIC_BONUS = 3;     // +3 seconds for light traffic (1 IR blocked)
const HEAVY_TRAFFIC_BONUS = 6;     // +6 seconds for heavy traffic (2 IR blocked)

const MIN_GREEN_TIME  = 3;
const MAX_GREEN_TIME  = 60;
const DEFAULT_GREEN   = 5;
const FALLBACK_GREEN  = 5;
const SENSOR_MAX_RANGE = 400; // cm
const PED_CROSS_TIME  = 10; // seconds for pedestrian crossing

// Ultrasonic threshold — if < 20cm, switch to IR+Piezo mode
const ULTRASONIC_CLOSE_THRESHOLD = 20;

// ── Score one road ───────────────────────────────────────────────────────────
function calculateScore(distanceCm, trafficAhead, irQueue, heavyVehicle, useIRMode) {
    let score = 0;

    // ── Ultrasonic (distance > 20cm mode) ───────────────────────────────────
    if (!useIRMode) {
        if (distanceCm !== null && distanceCm <= SENSOR_MAX_RANGE) {
            if (distanceCm <= 50)       score += 40;
            else if (distanceCm <= 200) score += 20;
            else score += (SENSOR_MAX_RANGE - distanceCm) / 20;
        }
    }

    // ── IR Queue mode (distance < 20cm) ─────────────────────────────────────
    if (useIRMode) {
        // Matches ESP32: Both IR blocked = Heavy Traffic, One IR blocked = Light Traffic
        if (irQueue === 'Heavy')      score += 50; // Both IR blocked
        else if (irQueue === 'Light') score += 25; // One IR blocked
        else                          score += 5;  // No IR blocked
    }

    // ── Piezo heavy vehicle bonus ─────────────────────────────────────────
    if (heavyVehicle) score += 15; // Heavy vehicle needs more time

    // ── Google traffic at next intersection ──────────────────────────────
    switch (trafficAhead) {
        case 'Heavy':  score -= 50; break;
        case 'Medium': score -= 15; break;
        case 'Light':  score += 10; break;
    }

    return score;
}

// ── Calculate green time (matches ESP32 logic) ───────────────────────────────
function calculateGreenTime(distanceCm, trafficAhead, irQueue, heavyVehicle, useIRMode) {
    // Start with ESP32 base green time (3 seconds)
    let baseTime = BASE_GREEN_TIME;

    if (useIRMode) {
        // IR mode — matches ESP32 IR sensor logic
        // ESP32: Light Traffic (1 sensor) = +3s, Heavy Traffic (2 sensors) = +6s
        if (irQueue === 'Heavy') {
            baseTime = BASE_GREEN_TIME + HEAVY_TRAFFIC_BONUS;  // 3s + 6s = 9s
        } else if (irQueue === 'Light') {
            baseTime = BASE_GREEN_TIME + LIGHT_TRAFFIC_BONUS;  // 3s + 3s = 6s
        } else {
            baseTime = BASE_GREEN_TIME;  // 3s
        }
    } else {
        // Ultrasonic mode — based on distance
        if (distanceCm === null || distanceCm > SENSOR_MAX_RANGE) {
            // No vehicle detected, use Google traffic data
            if (trafficAhead === 'Heavy')  return 40;
            if (trafficAhead === 'Medium') return 25;
            if (trafficAhead === 'Light')  return MIN_GREEN_TIME;
            return DEFAULT_GREEN;
        }
        
        // Calculate based on distance (closer vehicle = more green time)
        const factor = (distanceCm / SENSOR_MAX_RANGE) * 20;
        baseTime = MIN_GREEN_TIME + factor;
        baseTime = Math.min(baseTime, MAX_GREEN_TIME);
    }

    // Piezo heavy vehicle extends green (ESP32 doesn't have this, but keeping for flexibility)
    if (heavyVehicle) baseTime += 10;

    // Google traffic adjustment
    if (trafficAhead === 'Heavy')  baseTime = Math.max(baseTime * 0.7, MIN_GREEN_TIME);
    if (trafficAhead === 'Light')  baseTime = Math.min(baseTime * 1.2, MAX_GREEN_TIME);

    return Math.round(Math.min(Math.max(baseTime, MIN_GREEN_TIME), MAX_GREEN_TIME));
}

function determineMode(sensorWorking, googleWorking) {
    const anySensor = Object.values(sensorWorking || {}).some(v => v === true);
    const google    = googleWorking === true;
    if (anySensor && google)   return 'BOTH';
    if (anySensor && !google)  return 'SENSOR_ONLY';
    if (!anySensor && google)  return 'GOOGLE_ONLY';
    return 'FALLBACK';
}

// ── Get current yellow time based on rain status ────────────────────────────
function getCurrentYellowTime(rainDetected) {
    return rainDetected ? YELLOW_TIME_RAIN : YELLOW_TIME_NORMAL;
}

// ── MAIN DECISION FUNCTION ───────────────────────────────────────────────────
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

    if (mode === 'FALLBACK') {
        priorities = ROADS.map((road, i) => ({
            road, distance: null, traffic: 'Unknown',
            score: ROADS.length - i, greenTime: FALLBACK_GREEN, 
            yellowTime: currentYellowTime, mode: 'FALLBACK'
        }));
    } else {
        priorities = ROADS.map(road => {
            const dist    = (sensorData[road] > SENSOR_MAX_RANGE) ? null : sensorData[road];
            const traffic = (trafficData || {})[road] || 'Unknown';
            const irRoad  = ir[road]    || { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' };
            const heavy   = piezo[road] || false;
            const pedRoad = ped[road]    || { requested: false, crossing: false };

            // Decide which sub-mode for this road
            // If distance < 20cm (or null but IR is blocked), use IR mode
            const useIRMode = (dist !== null && dist < ULTRASONIC_CLOSE_THRESHOLD)
                           || (dist === null && irRoad.queueLevel !== 'None');

            let score     = 0;
            let greenTime = DEFAULT_GREEN;

            if (mode === 'BOTH' || mode === 'SENSOR_ONLY') {
                score     = calculateScore(dist, traffic, irRoad.queueLevel, heavy, useIRMode);
                greenTime = calculateGreenTime(dist, traffic, irRoad.queueLevel, heavy, useIRMode);
            } else if (mode === 'GOOGLE_ONLY') {
                score     = calculateScore(null, traffic, 'None', false, false);
                greenTime = calculateGreenTime(null, traffic, 'None', false, false);
            }

            // Pedestrian request increases priority
            if (pedRoad.crossing) {
                // Keep car signal RED while pedestrian crossing is active
                score -= 1000;
                greenTime = 0;
            } else if (pedRoad.requested) {
                score += 100;
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
                pedestrian: pedRoad
            };
        });
    }

    // Sort by score (highest first)
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
        mode,
        winner:         winner.road,
        greenDuration:  winner.greenTime,
        yellowDuration: currentYellowTime,
        redDuration:    BASE_RED_TIME,
        redForOthers:   winner.greenTime + currentYellowTime,
        priorities,
        commands,
        dataStatus: { sensorWorking, googleWorking },
        weather: { rainDetected: rainDetected || false, yellowTime: currentYellowTime }
    };
}

module.exports = { 
    makeSignalDecision, 
    YELLOW_TIME_NORMAL, 
    YELLOW_TIME_RAIN,
    BASE_RED_TIME,
    BASE_GREEN_TIME,
    LIGHT_TRAFFIC_BONUS,
    HEAVY_TRAFFIC_BONUS,
    MIN_GREEN_TIME, 
    MAX_GREEN_TIME 
};