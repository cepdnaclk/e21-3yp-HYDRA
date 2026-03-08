// server/logic/signalDecision.js

// ─────────────────────────────────────────────────────────────
// TIME CONSTANTS (in seconds)
// ─────────────────────────────────────────────────────────────
const BASE_GREEN_TIME = 20;     // Minimum green time (seconds)
const MAX_GREEN_TIME  = 60;     // Maximum green time (seconds)
const YELLOW_TIME     = 3;      // Always 3 seconds yellow before red
const ALL_RED_TIME    = 2;      // Safety gap: all lights red between phases
const VEHICLE_TIME_FACTOR = 0.5; // Extra 0.5 sec per 10cm of approaching distance

// ─────────────────────────────────────────────────────────────
// calculatePriority()
// Calculates a priority SCORE for each road
// Higher score = should get green light first
//
// Parameters:
//   road        - "North", "South", "East", or "West"
//   distanceCm  - distance from sensor to approaching car (cm)
//                 null = no car detected
//   trafficAhead - "Heavy", "Medium", "Light", or "Unknown"
//                  (traffic condition at NEXT intersection in that direction)
// ─────────────────────────────────────────────────────────────
function calculatePriority(road, distanceCm, trafficAhead) {
    let score = 0;

    // ── FACTOR 1: Car is approaching (ultrasonic detected a car) ──
    if (distanceCm !== null && distanceCm <= 400) {
        // Closer car = more urgent = higher score
        // If car is at 30cm → score += (400-30)/10 = 37
        // If car is at 200cm → score += (400-200)/10 = 20
        score += (400 - distanceCm) / 10;
    }

    // ── FACTOR 2: Traffic ahead — PENALISE if next intersection is jammed ──
    // Logic: No point sending cars toward a jam — it just creates MORE congestion
    if (trafficAhead === 'Heavy') {
        score -= 50;  // Strong penalty — likely won't get green unless emergency
    } else if (trafficAhead === 'Medium') {
        score -= 15;  // Moderate penalty
    } else if (trafficAhead === 'Light') {
        score += 10;  // Bonus — road ahead is clear, send cars!
    }
    // Unknown = no change (neutral)

    return score;
}

// ─────────────────────────────────────────────────────────────
// calculateGreenTime()
// How long (in seconds) should the green light stay on?
// ─────────────────────────────────────────────────────────────
function calculateGreenTime(distanceCm) {
    if (distanceCm === null) return BASE_GREEN_TIME;
    // Car is 30cm away  → time = 20 + (30/10 × 0.5) = 20 + 1.5 = ~22 seconds
    // Car is 200cm away → time = 20 + (200/10 × 0.5) = 20 + 10 = 30 seconds
    const extra = Math.floor(distanceCm / 10) * VEHICLE_TIME_FACTOR;
    return Math.min(BASE_GREEN_TIME + extra, MAX_GREEN_TIME);
}

// ─────────────────────────────────────────────────────────────
// makeSignalDecision()
// Main function: takes sensor data + traffic data, returns commands
//
// sensorData example:
//   { North: 5000, South: 30, East: 40, West: 200 }
//   (5000 = no car detected, beyond sensor range)
//
// trafficData example:
//   { North: 'Heavy', South: 'Light', East: 'Medium', West: 'Light' }
// ─────────────────────────────────────────────────────────────
function makeSignalDecision(sensorData, trafficData) {
    const roads = ['North', 'South', 'East', 'West'];

    // Step 1: Calculate priority score for each road
    const priorities = roads.map(road => {
        const distance  = sensorData[road] > 400 ? null : sensorData[road];
        const traffic   = trafficData[road] || 'Unknown';
        const score     = calculatePriority(road, distance, traffic);
        const greenTime = calculateGreenTime(distance);
        return { road, distance, traffic, score, greenTime };
    });

    // Step 2: Sort by score — highest first
    priorities.sort((a, b) => b.score - a.score);

    // Step 3: Winner gets GREEN, all others get RED
    const winner = priorities[0];

    // Step 4: Build the complete command for each road
    const commands = {};
    roads.forEach(road => {
        if (road === winner.road) {
            commands[road] = {
                signal: 'GREEN',
                greenTime: Math.round(winner.greenTime),
                reason: `Score: ${winner.score.toFixed(1)}, Distance: ${winner.distance}cm, TrafficAhead: ${winner.traffic}`
            };
        } else {
            commands[road] = {
                signal: 'RED',
                greenTime: 0,
                reason: 'Waiting'
            };
        }
    });

    // Step 5: Build detailed log for the dashboard
    const decisionLog = {
        timestamp: new Date().toISOString(),
        winner: winner.road,
        greenDuration: Math.round(winner.greenTime),
        yellowDuration: YELLOW_TIME,
        allRedDuration: ALL_RED_TIME,
        priorities: priorities,  // Full sorted list for dashboard display
        commands: commands
    };

    return decisionLog;
}

module.exports = { makeSignalDecision, calculatePriority, calculateGreenTime };


