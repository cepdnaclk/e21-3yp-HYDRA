// ═══════════════════════════════════════════════════════════════════════════
// server/logic/signalDecision.js — HYDRA Dual-Mode Decision Engine
// ═══════════════════════════════════════════════════════════════════════════
//
// TWO SENSOR SCENARIOS — selected per road at decision time:
//
//  SCENARIO A — ULTRASONIC MODE  (distance >= 20cm)
//    Used when: vehicle is far from stop line, no vehicle in IR range,
//               pedestrian zone is clear (>20cm means beyond crossing zone)
//    Green time: Distance + Google Traffic formula (original BOTH mode)
//    Sensors:    Ultrasonic + Google Traffic + Pedestrian
//    Typical:    Midnight, light traffic, open road conditions
//
//  SCENARIO B — IR MODE          (distance < 20cm)
//    Used when: vehicle detected within 20cm — could be a car in IR range
//               OR a pedestrian in the crossing zone (10–20cm).
//               We switch to IR because ultrasonic cannot distinguish
//               a pedestrian from a vehicle at this range.
//    Green time: IR density + Piezo heavy vehicle bonus
//    Sensors:    IR x2 + Piezo + Rain (yellow) + Pedestrian
//    Typical:    Daytime, queued traffic at stop line
//
// PHYSICAL LAYOUT (distance from stop line, measured backward into road):
//   0–5cm   → IR Sensor 1  (blocked alone = Light traffic)
//   5–10cm  → IR Sensor 2  (both blocked  = Heavy traffic)
//   10–20cm → Pedestrian crossing zone (excluded from IR vehicle counting)
//   >20cm   → Open road    → Ultrasonic + Google mode
//
// YELLOW TIME (both modes):
//   Dry:   3s base
//   Rain:  3s + 2s = 5s   (rain sensor always affects yellow regardless of mode)
//
// GREEN TIME:
//   Ultrasonic mode: calculateGreenTimeUltrasonic(distance, googleTraffic)
//   IR mode:         calculateGreenTimeIR(ir1, ir2, piezo)
//     - No IR blocked  → 3s  (base)
//     - IR1 only       → 6s  (3s base + 3s light bonus)
//     - Both IR        → 9s  (3s base + 6s heavy bonus)
//     - Both IR + Piezo→ 14s (9s + 5s heavy vehicle bonus)
//
// RED TIME: Fixed 3s always.
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

// Pedestrian crossing duration
const PED_CROSS_TIME         = 10;

// Yellow timing
const YELLOW_TIME_DRY        = BASE_YELLOW_TIME;                       // 3s
const YELLOW_TIME_RAIN       = BASE_YELLOW_TIME + RAIN_YELLOW_EXTRA;  // 5s

// ── Score weights ───────────────────────────────────────────────────────────
// Used in ULTRASONIC mode only — IR mode uses a fixed table, not scoring
const WEIGHT_DIST_VERY_CLOSE = 40;   // vehicle ≤50cm
const WEIGHT_DIST_MEDIUM     = 20;   // vehicle ≤200cm
const WEIGHT_GOOGLE_HEAVY    = -50;  // next intersection jammed → penalise
const WEIGHT_GOOGLE_MEDIUM   = -15;
const WEIGHT_GOOGLE_LIGHT    = +10;  // next intersection clear  → reward

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1: MODE SELECTOR
// Called once per road per decision cycle.
// Returns 'IR' if distance < 20cm, 'ULTRASONIC' otherwise.
// Note: null distance (sensor offline) → treated as no vehicle → ULTRASONIC.
// ════════════════════════════════════════════════════════════════════════════
function selectSensorMode(distanceCm) {
    if (distanceCm === null || distanceCm === undefined) return 'ULTRASONIC';
    if (distanceCm >= SENSOR_MAX_RANGE) return 'ULTRASONIC'; // no vehicle detected
    if (distanceCm < IR_MODE_THRESHOLD) return 'IR';
    return 'ULTRASONIC';
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2A: ULTRASONIC MODE — Green time calculation
// Formula: distance factor + Google Traffic adjustment
// Same as original BOTH mode formula. Distance determines urgency,
// Google Traffic adjusts up or down based on downstream capacity.
// ════════════════════════════════════════════════════════════════════════════
function calculateGreenTimeUltrasonic(distanceCm, googleTraffic) {
    // No vehicle in range — use Google Traffic alone for timing estimate
    if (distanceCm === null || distanceCm >= SENSOR_MAX_RANGE) {
        if (googleTraffic === 'Heavy')  return 40;
        if (googleTraffic === 'Medium') return 25;
        if (googleTraffic === 'Light')  return MIN_GREEN_ULTRASONIC;
        return DEFAULT_GREEN; // Unknown Google → use default
    }

    // Vehicle detected at distance > 20cm:
    // Further away = more time needed to reach stop line and clear junction
    const distanceFactor = (distanceCm / SENSOR_MAX_RANGE) * 20; // 0–20s range
    let greenTime = MIN_GREEN_ULTRASONIC + distanceFactor;

    // Google Traffic adjustment on top of distance-based time
    if (googleTraffic === 'Heavy') {
        // Downstream jammed — reduce green to avoid pushing cars into gridlock
        greenTime = Math.max(greenTime * 0.7, MIN_GREEN_ULTRASONIC);
    } else if (googleTraffic === 'Light') {
        // Downstream clear — extend green, cars can flow through
        greenTime = Math.min(greenTime * 1.2, MAX_GREEN_ULTRASONIC);
    }
    // 'Medium' and 'Unknown' → no adjustment

    return Math.round(Math.min(Math.max(greenTime, MIN_GREEN_ULTRASONIC), MAX_GREEN_ULTRASONIC));
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2B: ULTRASONIC MODE — Priority score for road ranking
// Used to determine WHICH road wins GREEN, not how long.
// ════════════════════════════════════════════════════════════════════════════
function calculateScoreUltrasonic(distanceCm, googleTraffic) {
    let score = 0;

    // Distance component — closer vehicle = higher urgency
    if (distanceCm !== null && distanceCm < SENSOR_MAX_RANGE) {
        if (distanceCm <= 50)       score += WEIGHT_DIST_VERY_CLOSE;
        else if (distanceCm <= 200) score += WEIGHT_DIST_MEDIUM;
        else score += (SENSOR_MAX_RANGE - distanceCm) / 20; // small bonus for far cars
    }

    // Google Traffic component — penalise roads leading to jammed intersections
    switch (googleTraffic) {
        case 'Heavy':  score += WEIGHT_GOOGLE_HEAVY;  break;
        case 'Medium': score += WEIGHT_GOOGLE_MEDIUM; break;
        case 'Light':  score += WEIGHT_GOOGLE_LIGHT;  break;
        // 'Unknown' → neutral, no change
    }

    return score;
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3A: IR MODE — Green time calculation
// Fixed table based on IR sensor state + piezo heavy vehicle detection.
// Google Traffic is NOT used for green time in IR mode —
// the queue at the stop line is the direct signal, no inference needed.
//
// IR sensor placement (from stop line backward into road):
//   IR1 at 5cm  — light traffic marker
//   IR2 at 10cm — heavy traffic marker
//   Pedestrian crossing zone: 10–20cm (excluded from IR vehicle counting)
// ════════════════════════════════════════════════════════════════════════════
function calculateGreenTimeIR(ir1Blocked, ir2Blocked, piezoHeavy) {
    let greenTime = BASE_GREEN_TIME; // 3s minimum

    if (ir1Blocked && ir2Blocked) {
        // Both sensors blocked → Heavy traffic queue (cars backed up >10cm)
        greenTime = BASE_GREEN_TIME + HEAVY_TRAFFIC_BONUS; // 3 + 6 = 9s

        if (piezoHeavy) {
            // Heavy vehicle (truck/bus) detected on top of heavy queue
            // Needs extra time to clear the junction
            greenTime += PIEZO_HEAVY_BONUS; // 9 + 5 = 14s
        }

    } else if (ir1Blocked) {
        // Only IR1 blocked → Light traffic (1–2 cars near stop line)
        // IR2 clear means queue is short, no piezo bonus here
        greenTime = BASE_GREEN_TIME + LIGHT_TRAFFIC_BONUS; // 3 + 3 = 6s

    } else {
        // Neither IR blocked → no vehicle in IR range
        // (ultrasonic detected something <20cm — likely pedestrian in crossing zone)
        greenTime = BASE_GREEN_TIME; // 3s base, don't extend for pedestrians
    }

    return greenTime;
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3B: IR MODE — Priority score for road ranking
// Uses IR density as the primary score signal.
// Google Traffic is still used as a penalty/bonus for road ranking
// (we still don't want to push cars into a downstream jam).
// ════════════════════════════════════════════════════════════════════════════
function calculateScoreIR(ir1Blocked, ir2Blocked, piezoHeavy, googleTraffic) {
    let score = 0;

    // IR density component
    if (ir1Blocked && ir2Blocked) {
        score += 50; // Heavy queue — high priority
        if (piezoHeavy) score += 15; // Heavy vehicle on top → even higher priority
    } else if (ir1Blocked) {
        score += 25; // Light queue — moderate priority
    } else {
        score += 5;  // No vehicles in IR range (pedestrian zone detection only)
    }

    // Google Traffic still used for ranking (penalise roads into jams)
    switch (googleTraffic) {
        case 'Heavy':  score += WEIGHT_GOOGLE_HEAVY;  break;
        case 'Medium': score += WEIGHT_GOOGLE_MEDIUM; break;
        case 'Light':  score += WEIGHT_GOOGLE_LIGHT;  break;
    }

    return score;
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 4: SYSTEM MODE (determines data availability, not sensor scenario)
// This is separate from the per-road sensor scenario.
// BOTH / SENSOR_ONLY / GOOGLE_ONLY / FALLBACK
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
// SECTION 5: MAIN DECISION FUNCTION
// Called by server/index.js every cycle.
// For each road, reads the current ultrasonic distance AT DECISION TIME,
// selects the sensor scenario (IR or Ultrasonic), computes score + green time.
// ════════════════════════════════════════════════════════════════════════════
function makeSignalDecision(
    sensorData,    // { North: distanceCm, South: ..., East: ..., West: ... }
    trafficData,   // { North: 'Heavy'|'Medium'|'Light'|'Unknown', ... } from Google
    sensorWorking, // { North: bool, ... }
    googleWorking, // bool
    irData,        // { North: { ir1Blocked, ir2Blocked, queueLevel }, ... }
    piezoData,     // { North: bool, ... }  true = heavy vehicle detected
    rainDetected,  // bool
    pedStatus      // { North: { requested, crossing, duration }, ... }
) {
    const ROADS      = ['North', 'South', 'East', 'West'];
    const systemMode = determineSystemMode(sensorWorking || {}, googleWorking || false);

    // Yellow time — rain always affects this, regardless of sensor scenario
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
            score:           ROADS.length - i, // rotate North→South→East→West
            greenTime:       FALLBACK_GREEN,
            yellowTime:      currentYellowTime,
            mode:            'FALLBACK'
        }));

    // ── GOOGLE ONLY: sensors all offline ─────────────────────────────────────
    } else if (systemMode === 'GOOGLE_ONLY') {
        priorities = ROADS.map(road => {
            const google = (trafficData || {})[road] || 'Unknown';
            // No ultrasonic data → can't determine sensor scenario
            // Use Google-only scoring and timing
            const score     = calculateScoreUltrasonic(null, google);
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
                mode:            'GOOGLE_ONLY'
            };
        });

    // ── SENSOR_ONLY or BOTH: main dual-scenario logic ─────────────────────
    } else {
        priorities = ROADS.map(road => {
            // Read current distance AT THIS DECISION MOMENT
            const rawDist   = sensorData[road];
            const distanceCm = (rawDist === undefined || rawDist === null || rawDist >= SENSOR_MAX_RANGE)
                                ? null
                                : rawDist;

            const google    = (trafficData || {})[road] || 'Unknown';
            const irRoad    = ir[road]    || { ir1Blocked: false, ir2Blocked: false };
            const piezoHeavy = piezo[road] || false;
            const pedRoad   = ped[road]    || { requested: false, crossing: false };

            // ── SELECT SENSOR SCENARIO FOR THIS ROAD ──────────────────────
            const sensorScenario = selectSensorMode(distanceCm);

            let score, greenTime;

            if (sensorScenario === 'IR') {
                // ── SCENARIO B: IR MODE ──────────────────────────────────
                // Distance < 20cm — vehicle (or pedestrian) very close.
                // Use IR sensors to determine actual vehicle queue.
                // Pedestrian zone (10–20cm) is excluded from IR sensors physically,
                // so ir1Blocked/ir2Blocked only reflect actual vehicles.
                score     = calculateScoreIR(
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
                // ── SCENARIO A: ULTRASONIC MODE ──────────────────────────
                // Distance >= 20cm — vehicle is beyond IR range and pedestrian zone.
                // Use distance + Google Traffic for scoring and green time.
                score     = calculateScoreUltrasonic(distanceCm, google);
                greenTime = calculateGreenTimeUltrasonic(distanceCm, google);
            }

            // ── PEDESTRIAN OVERRIDE ───────────────────────────────────────
            // Applies in BOTH scenarios — pedestrian logic is scenario-independent.
            if (pedRoad.crossing) {
                // Road is actively being crossed — hold RED, do not give GREEN
                score    -= 1000;
                greenTime = 0;
            } else if (pedRoad.requested) {
                // Button pressed, waiting — boost priority so this road
                // wins the next cycle quickly, triggering the crossing phase
                score += 100;
            }

            return {
                road,
                sensorScenario,           // 'IR' or 'ULTRASONIC' — shown on dashboard
                distance:     distanceCm,
                ir1Blocked:   irRoad.ir1Blocked  || false,
                ir2Blocked:   irRoad.ir2Blocked  || false,
                piezoHeavy,
                traffic:      google,
                score,
                greenTime,
                yellowTime:   currentYellowTime,
                mode:         systemMode,
                pedestrian:   pedRoad
            };
        });
    }

    // ── Sort by score — highest wins GREEN ───────────────────────────────────
    priorities.sort((a, b) => b.score - a.score);
    const winner = priorities[0];

    // ── Build per-road commands ───────────────────────────────────────────────
    const commands = {};
    ROADS.forEach(road => {
        commands[road] = road === winner.road
            ? { signal: 'GREEN', greenTime: winner.greenTime, yellowTime: currentYellowTime }
            : { signal: 'RED',   greenTime: 0,                yellowTime: 0 };
    });

    return {
        timestamp:      new Date().toISOString(),
        mode:           systemMode,
        winner:         winner.road,
        winnerScenario: winner.sensorScenario,  // tells dashboard which mode won
        greenDuration:  winner.greenTime,
        yellowDuration: currentYellowTime,
        redDuration:    BASE_RED_TIME,
        redForOthers:   winner.greenTime + currentYellowTime + BASE_RED_TIME,
        priorities,
        commands,
        dataStatus:     { sensorWorking, googleWorking },
        weather:        { rainDetected: rainDetected || false, yellowTime: currentYellowTime }
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
    // Constants (used by server/index.js and tests)
    IR_MODE_THRESHOLD,
    BASE_RED_TIME,
    BASE_GREEN_TIME,
    LIGHT_TRAFFIC_BONUS,
    HEAVY_TRAFFIC_BONUS,
    PIEZO_HEAVY_BONUS,
    YELLOW_TIME_DRY,
    YELLOW_TIME_RAIN,
    MIN_GREEN_ULTRASONIC,
    MAX_GREEN_ULTRASONIC
};