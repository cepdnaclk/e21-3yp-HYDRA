// ═══════════════════════════════════════════════════════════════════════════
// server/logic/signalDecision.js — HYDRA Priority Engine (COMPLETE VERSION)
// ═══════════════════════════════════════════════════════════════════════════
//
// FOUR OPERATING MODES (automatically selected based on what data is working):
//
//   MODE 1 — BOTH WORKING   : sensor + Google traffic → full priority
//   MODE 2 — SENSOR ONLY    : ultrasonic distance only → closer = priority
//   MODE 3 — GOOGLE ONLY    : next-intersection traffic only → avoid jams
//   MODE 4 — FALLBACK       : neither working → fixed 5s rotation
//
// REAL-WORLD LOGIC EXAMPLE (Nawinna Junction):
//   • North road vehicle 50cm away
//   • South road vehicle 30cm away (CLOSER = normally wins)
//   • BUT: Google shows HEAVY traffic at Clocktower (next for North direction)
//   • AND: South road leads toward Clocktower
//   • Result: RED for South (would create jam), GREEN for North (cars can EXIT)
//
// GREEN TIME: calculated from distance (closer vehicle = slightly longer green)
// YELLOW TIME: always 5 seconds (constant, as requested)
// RED TIME: same as green time of current winner for all other roads
// ═══════════════════════════════════════════════════════════════════════════

// ── Time Constants (seconds) ────────────────────────────────────────────────
const YELLOW_TIME    = 5;    // Always 5 seconds — constant as required
const MIN_GREEN_TIME = 10;   // Minimum green (low traffic, far vehicle)
const MAX_GREEN_TIME = 60;   // Maximum green (heavy traffic)
const DEFAULT_GREEN  = 5;    // Default when no data (fallback mode)
const FALLBACK_GREEN = 5;    // Fixed cycle time in fallback mode

// Sensor max range — beyond this = no vehicle detected
const SENSOR_MAX_RANGE = 400; // cm

// ── Priority Scoring Weights ────────────────────────────────────────────────
// These numbers determine how much each factor matters
const WEIGHT_DISTANCE_CLOSE  = 40;   // Very close vehicle (+40 bonus)
const WEIGHT_DISTANCE_MED    = 20;   // Medium distance (+20 bonus)
const WEIGHT_TRAFFIC_HEAVY   = -50;  // Heavy next intersection (-50 penalty)
const WEIGHT_TRAFFIC_MEDIUM  = -15;  // Medium next intersection (-15 penalty)
const WEIGHT_TRAFFIC_LIGHT   = +10;  // Clear next intersection (+10 bonus)

// ════════════════════════════════════════════════════════════════════════════
// calculateScore() — Score one road
// ════════════════════════════════════════════════════════════════════════════
function calculateScore(distanceCm, trafficAhead) {
    let score = 0;

    // ── Factor 1: Ultrasonic distance ──────────────────────────────────────
    // A vehicle closer to the stop line needs to move first
    if (distanceCm !== null && distanceCm <= SENSOR_MAX_RANGE) {
        if (distanceCm <= 50) {
            score += WEIGHT_DISTANCE_CLOSE;     // Very close: high priority
        } else if (distanceCm <= 200) {
            score += WEIGHT_DISTANCE_MED;       // Medium distance
        } else {
            score += (SENSOR_MAX_RANGE - distanceCm) / 20; // Far: small bonus
        }
    }
    // No vehicle detected = 0 bonus (no urgency)

    // ── Factor 2: Next intersection traffic ────────────────────────────────
    // CRITICAL: Don't send cars where they'll just create more congestion
    // This is the Nawinna-Clocktower scenario from the requirements
    switch (trafficAhead) {
        case 'Heavy':   score += WEIGHT_TRAFFIC_HEAVY;  break;
        case 'Medium':  score += WEIGHT_TRAFFIC_MEDIUM; break;
        case 'Light':   score += WEIGHT_TRAFFIC_LIGHT;  break;
        default: break; // Unknown: neutral (0 adjustment)
    }

    return score;
}

// ════════════════════════════════════════════════════════════════════════════
// calculateGreenTime() — How long should green stay on?
// ════════════════════════════════════════════════════════════════════════════
function calculateGreenTime(distanceCm, trafficAhead) {
    // If vehicle very close or no sensor data, use base time
    if (distanceCm === null || distanceCm > SENSOR_MAX_RANGE) {
        // Check Google traffic for time estimate
        if (trafficAhead === 'Heavy')  return 40; // Many vehicles coming
        if (trafficAhead === 'Medium') return 25;
        if (trafficAhead === 'Light')  return MIN_GREEN_TIME;
        return DEFAULT_GREEN; // Unknown
    }

    // Vehicle detected: time based on distance
    // Far vehicle = more time needed to reach stop line and clear
    // Close vehicle = less time needed
    const distanceFactor = (distanceCm / SENSOR_MAX_RANGE) * 20; // 0 to 20 extra seconds
    let greenTime = MIN_GREEN_TIME + distanceFactor;

    // Adjust for next intersection capacity
    if (trafficAhead === 'Heavy') {
        greenTime = Math.max(greenTime * 0.7, MIN_GREEN_TIME); // Reduce if jammed ahead
    } else if (trafficAhead === 'Light') {
        greenTime = Math.min(greenTime * 1.2, MAX_GREEN_TIME); // Increase if road clear
    }

    return Math.round(Math.min(Math.max(greenTime, MIN_GREEN_TIME), MAX_GREEN_TIME));
}

// ════════════════════════════════════════════════════════════════════════════
// determineMode() — Figure out which operating mode to use
// ════════════════════════════════════════════════════════════════════════════
function determineMode(sensorWorking, googleWorking) {
    const anySensorWorking = Object.values(sensorWorking).some(v => v === true);
    const google = googleWorking === true;

    if (anySensorWorking && google)  return 'BOTH';
    if (anySensorWorking && !google) return 'SENSOR_ONLY';
    if (!anySensorWorking && google) return 'GOOGLE_ONLY';
    return 'FALLBACK';
}

// ════════════════════════════════════════════════════════════════════════════
// makeSignalDecision() — MAIN FUNCTION
// Called by server whenever new sensor data arrives or Google updates
// ════════════════════════════════════════════════════════════════════════════
function makeSignalDecision(sensorData, trafficData, sensorWorking, googleWorking) {
    const ROADS = ['North', 'South', 'East', 'West'];
    const mode  = determineMode(sensorWorking || {}, googleWorking || false);

    let priorities = [];

    // ──────────────────────────────────────────────────────────────────────
    // MODE 4: FALLBACK — Neither sensor nor Google working
    // Use fixed default timing, rotate through roads in order
    // ──────────────────────────────────────────────────────────────────────
    if (mode === 'FALLBACK') {
        priorities = ROADS.map((road, i) => ({
            road,
            distance:  null,
            traffic:   'Unknown',
            score:     ROADS.length - i, // North first by default
            greenTime: FALLBACK_GREEN,
            mode:      'FALLBACK'
        }));
    }

    // ──────────────────────────────────────────────────────────────────────
    // MODE 2: SENSOR ONLY — Only ultrasonic data available
    // Closer vehicle = higher priority. Google penalty ignored.
    // ──────────────────────────────────────────────────────────────────────
    else if (mode === 'SENSOR_ONLY') {
        priorities = ROADS.map(road => {
            const dist = sensorData[road] > SENSOR_MAX_RANGE ? null : sensorData[road];
            let score  = 0;
            if (dist !== null) {
                score = (SENSOR_MAX_RANGE - dist); // Closer = higher score
            }
            return {
                road,
                distance:  dist,
                traffic:   'Unknown',
                score,
                greenTime: calculateGreenTime(dist, 'Unknown'),
                mode:      'SENSOR_ONLY'
            };
        });
    }

    // ──────────────────────────────────────────────────────────────────────
    // MODE 3: GOOGLE ONLY — Only Google traffic data available
    // Penalise roads that lead to jammed intersections.
    // ──────────────────────────────────────────────────────────────────────
    else if (mode === 'GOOGLE_ONLY') {
        priorities = ROADS.map(road => {
            const traffic = trafficData[road] || 'Unknown';
            const score   = calculateScore(null, traffic);
            return {
                road,
                distance:  null,
                traffic,
                score,
                greenTime: calculateGreenTime(null, traffic),
                mode:      'GOOGLE_ONLY'
            };
        });
    }

    // ──────────────────────────────────────────────────────────────────────
    // MODE 1: BOTH — Full priority using both sensor + Google
    // This is the main intended mode for real deployment
    // ──────────────────────────────────────────────────────────────────────
    else { // BOTH
        priorities = ROADS.map(road => {
            const dist    = sensorData[road] > SENSOR_MAX_RANGE ? null : sensorData[road];
            const traffic = trafficData[road] || 'Unknown';
            const score   = calculateScore(dist, traffic);
            return {
                road,
                distance:  dist,
                traffic,
                score,
                greenTime: calculateGreenTime(dist, traffic),
                mode:      'BOTH'
            };
        });
    }

    // ── Sort by score, highest first ───────────────────────────────────────
    priorities.sort((a, b) => b.score - a.score);

    // ── Winner = road with highest score ───────────────────────────────────
    const winner = priorities[0];

    // ── Build commands for each road ───────────────────────────────────────
    const commands = {};
    ROADS.forEach(road => {
        if (road === winner.road) {
            commands[road] = {
                signal:    'GREEN',
                greenTime: winner.greenTime,
                reason:    buildReason(winner)
            };
        } else {
            commands[road] = {
                signal:    'RED',
                greenTime: 0,
                reason:    'Waiting for turn'
            };
        }
    });

    // ── Red time for others = green time of winner + yellow time ───────────
    const redTimeForOthers = winner.greenTime + YELLOW_TIME;

    return {
        timestamp:      new Date().toISOString(),
        mode,                              // Which operating mode
        winner:         winner.road,       // Which road gets GREEN
        greenDuration:  winner.greenTime,  // Green time in seconds
        yellowDuration: YELLOW_TIME,       // Always 5s
        redForOthers:   redTimeForOthers,  // Red time for other 3 roads
        priorities,                        // Full sorted list for dashboard
        commands,                          // Command per road
        dataStatus: {
            sensorWorking,
            googleWorking
        }
    };
}

// ── Helper: Build human-readable reason string ──────────────────────────────
function buildReason(road) {
    const parts = [];
    if (road.distance !== null) {
        parts.push(`Vehicle ${road.distance}cm away`);
    } else {
        parts.push('No vehicle detected');
    }
    if (road.traffic !== 'Unknown') {
        parts.push(`Next intersection: ${road.traffic}`);
    }
    parts.push(`Score: ${road.score.toFixed(1)}`);
    return parts.join(' | ');
}

module.exports = {
    makeSignalDecision,
    calculateScore,
    calculateGreenTime,
    YELLOW_TIME,
    MIN_GREEN_TIME,
    MAX_GREEN_TIME,
    FALLBACK_GREEN
};