// // server/logic/signalDecision.js — HYDRA v8.1 FIXED
// // KEY FIX: _fallbackIndex is now managed EXTERNALLY by the cycle engine
// // so it only advances ONCE per full cycle, not multiple times per cycle.
// // This file now ACCEPTS the current fallback road as a parameter.

// 'use strict';

// const BASE_GREEN          = 3;
// const LIGHT_BONUS         = 3;
// const HEAVY_BONUS         = 6;
// const PIEZO_BONUS         = 3;
// const BASE_YELLOW         = 3;
// const RAIN_YELLOW_EXTRA   = 2;
// const FALLBACK_GREEN      = 3;

// const SCORE_HEAVY         = 300;
// const SCORE_LIGHT         = 150;
// const SCORE_NONE          = 50;
// const SCORE_PIEZO_BONUS   = 80;
// const SCORE_GOOGLE_HEAVY  = -40;
// const SCORE_GOOGLE_MEDIUM = 20;
// const SCORE_GOOGLE_LIGHT  = 60;
// const SCORE_PED_CROSSING  = -9999;
// const SCORE_PED_WAITING   = 100;
// const SCORE_ESP_OFFLINE   = -99999;

// const ROADS = ['North', 'South', 'East', 'West'];

// function determineSystemMode(usWorking, googleWorking) {
//     const anyUS = Object.values(usWorking || {}).some(v => v === true);
//     const goog  = googleWorking === true;
//     if (anyUS && goog)   return 'BOTH';
//     if (anyUS && !goog)  return 'SENSOR_ONLY';
//     if (!anyUS && goog)  return 'GOOGLE_ONLY';
//     return 'FALLBACK';
// }

// function queueLevel(us1Stable, us2Stable) {
//     if (us1Stable && us2Stable) return 'Heavy';
//     if (us1Stable)              return 'Light';
//     return 'None';
// }

// function calcGreenTime(us1Stable, us2Stable, piezoHeavy) {
//     let g = BASE_GREEN;
//     if (us1Stable && us2Stable) g += HEAVY_BONUS;
//     else if (us1Stable)         g += LIGHT_BONUS;
//     if (piezoHeavy && us1Stable) g += PIEZO_BONUS;
//     return g;
// }

// function calcScore(us1Stable, us2Stable, piezoHeavy, googleTraffic, pedStatus) {
//     const level = queueLevel(us1Stable, us2Stable);
//     let score = 0;
//     if (level === 'Heavy')      score += SCORE_HEAVY;
//     else if (level === 'Light') score += SCORE_LIGHT;
//     else                        score += SCORE_NONE;

//     if (piezoHeavy && us1Stable) score += SCORE_PIEZO_BONUS;

//     if (googleTraffic === 'Heavy')       score += SCORE_GOOGLE_HEAVY;
//     else if (googleTraffic === 'Medium') score += SCORE_GOOGLE_MEDIUM;
//     else if (googleTraffic === 'Light')  score += SCORE_GOOGLE_LIGHT;

//     if (pedStatus && pedStatus.crossing)                           score += SCORE_PED_CROSSING;
//     if (pedStatus && pedStatus.requested && !pedStatus.crossing)   score += SCORE_PED_WAITING;

//     return score;
// }

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
// // NEW PARAMETER: fallbackWinnerRoad — the road that SHOULD win in fallback mode
// // This is passed in by index.js which manages the rotation externally.
// function makeSignalDecision(
//     usData,
//     trafficData,
//     usWorking,
//     googleWorking,
//     piezoData,
//     rainDetected,
//     pedStatus,
//     espStatus,
//     fallbackWinnerRoad   // ← NEW: which road wins in fallback (managed externally)
// ) {
//     const currentYellow = rainDetected
//         ? BASE_YELLOW + RAIN_YELLOW_EXTRA
//         : BASE_YELLOW;

//     const systemMode = determineSystemMode(usWorking, googleWorking);

//     const us    = usData    || {};
//     const piezo = piezoData || {};
//     const ped   = pedStatus || {};
//     const esp   = espStatus || {};
//     const goog  = trafficData || {};

//     let priorities = [];

//     // ── FALLBACK: no sensors, no google → round-robin ────────────────────────
//     if (systemMode === 'FALLBACK') {
//         // Use the externally-provided fallbackWinnerRoad
//         const winnerRoad = fallbackWinnerRoad || ROADS[0];

//         priorities = ROADS.map(road => ({
//             road,
//             sensorScenario: 'NO_DATA',
//             us1Stable: false,
//             us2Stable: false,
//             queueLevel: 'None',
//             piezoHeavy: false,
//             traffic: 'Unknown',
//             // Winner gets highest score, others get lower scores in order
//             score: road === winnerRoad ? 1000 : 0,
//             greenTime: FALLBACK_GREEN,
//             yellowTime: currentYellow,
//             mode: 'FALLBACK',
//             espOnline: esp[road] !== false
//         }));

//     // ── GOOGLE ONLY ───────────────────────────────────────────────────────────
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

//             const us1Stable  = espOnline && usOnline ? (roadUS.us1Stable || false) : false;
//             const us2Stable  = espOnline && usOnline ? (roadUS.us2Stable || false) : false;
//             const piezoHeavy = (piezoRoad.heavy === true) && us1Stable;

//             let score, greenTime, badge;

//             if (!espOnline) {
//                 score     = SCORE_ESP_OFFLINE;
//                 greenTime = FALLBACK_GREEN;
//                 badge     = 'NO_DATA';
//             } else if (!usOnline) {
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
//     FALLBACK_GREEN,
//     ROADS
// };



// server/logic/signalDecision.js — HYDRA v9.0 COLLISION-FREE
//
// PRIORITY RULES (no Google Traffic in scoring — only sensor data):
//
//   QUEUE LEVELS (from dual ultrasonic sensors):
//     US1 stable + US2 stable  → Heavy  → +6s green (total 9s)
//     US1 stable only          → Light  → +3s green (total 6s)
//     US2 stable but US1 not   → IGNORED (invalid reading)
//     Neither stable           → None   → 3s base green
//
//   PIEZO BONUS (only when US1 also stable):
//     US1 + Piezo              → +3s stacked on top of queue bonus
//
//   PRIORITY ORDER (descending):
//     1. Heavy queue + Piezo   → score 380 → green 12s
//     2. Heavy queue only      → score 300 → green 9s
//     3. Light queue + Piezo   → score 230 → green 9s
//     4. Light queue only      → score 150 → green 6s
//     5. No queue + Piezo      → score 80  → green 6s  (US1 required for piezo)
//     6. No queue              → score 50  → green 3s
//
//   TIE-BREAKING (equal scores):
//     → Use round-robin rotation (managed externally by index.js)
//
//   COOLDOWN:
//     → Road that just had GREEN is excluded for 1 cycle
//     → If ALL roads are on cooldown, cooldown is ignored
//
//   FALLBACK (no ESP32 connected at all):
//     → Strict round-robin: North → South → East → West → repeat
//     → Offline roads are SKIPPED in rotation
//
//   OFFLINE ROADS:
//     → Completely excluded from winning
//     → Do NOT get their "turn" held — skipped entirely

'use strict';

// ── Timing constants ──────────────────────────────────────────────────────────
const BASE_GREEN        = 3;   // seconds
const LIGHT_BONUS       = 3;   // US1 only blocked → +3s
const HEAVY_BONUS       = 6;   // US1 + US2 both blocked → +6s
const PIEZO_BONUS       = 3;   // US1 + piezo → +3s (stacked)
const BASE_YELLOW       = 3;
const RAIN_YELLOW_EXTRA = 2;
const FALLBACK_GREEN    = 3;

// ── Score constants (Google Traffic removed from scoring) ─────────────────────
const SCORE_HEAVY_PIEZO  = 380;  // Heavy + Piezo
const SCORE_HEAVY        = 300;  // Heavy only
const SCORE_LIGHT_PIEZO  = 230;  // Light + Piezo
const SCORE_LIGHT        = 150;  // Light only
const SCORE_NONE_PIEZO   = 80;   // No queue but Piezo (US1 must be stable for piezo)
const SCORE_NONE         = 50;   // No traffic
const SCORE_ESP_OFFLINE  = -99999;
const SCORE_ON_COOLDOWN  = -88888; // Excluded this cycle

const ROADS = ['North', 'South', 'East', 'West'];

// ── Queue level helper ────────────────────────────────────────────────────────
function queueLevel(us1Stable, us2Stable) {
    if (us1Stable && us2Stable) return 'Heavy';
    if (us1Stable)              return 'Light';
    return 'None';   // US2 alone is invalid — ignored
}

// ── Green time from queue level + piezo ──────────────────────────────────────
function calcGreenTime(us1Stable, us2Stable, piezoHeavy) {
    let g = BASE_GREEN;
    if (us1Stable && us2Stable) g += HEAVY_BONUS;   // 3 + 6 = 9s
    else if (us1Stable)         g += LIGHT_BONUS;    // 3 + 3 = 6s
    // US2 alone → stays at 3s
    if (piezoHeavy && us1Stable) g += PIEZO_BONUS;  // +3s stacked
    return g;
}

// ── Priority score for a road ─────────────────────────────────────────────────
// NOTE: Google Traffic intentionally excluded from scoring.
// It is only used in the dashboard for driver information display.
function calcScore(us1Stable, us2Stable, piezoHeavy) {
    const level = queueLevel(us1Stable, us2Stable);
    const pz    = piezoHeavy && us1Stable; // piezo only valid with US1

    if (level === 'Heavy' && pz)  return SCORE_HEAVY_PIEZO;
    if (level === 'Heavy')         return SCORE_HEAVY;
    if (level === 'Light' && pz)  return SCORE_LIGHT_PIEZO;
    if (level === 'Light')         return SCORE_LIGHT;
    if (pz)                        return SCORE_NONE_PIEZO; // US1 stable (for piezo) but US2 not
    return SCORE_NONE;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN DECISION FUNCTION
// ════════════════════════════════════════════════════════════════════════════
//
// Parameters:
//   usData          : { North: { us1Stable, us2Stable, us1Raw, us2Raw }, ... }
//   usWorking       : { North: bool, ... }  — is ESP32 online and sending data?
//   piezoData       : { North: { heavy, timestamp, locked }, ... }
//   rainDetected    : bool
//   pedStatus       : { North: { requested, crossing }, ... }
//   espStatus       : { North: bool, ... }
//   lastWinner      : string | null — road that just had GREEN (cooldown target)
//   fallbackRoad    : string — which road wins if in full FALLBACK mode
//
// Returns a decision object with:
//   winner, greenDuration, yellowDuration, redForOthers, mode,
//   priorities[], nextWinner (preview for dashboard)
//
function makeSignalDecision(
    usData,
    usWorking,
    piezoData,
    rainDetected,
    pedStatus,
    espStatus,
    lastWinner,      // road that just had GREEN — apply cooldown
    fallbackRoad     // externally managed round-robin road for FALLBACK mode
) {
    const currentYellow = rainDetected
        ? BASE_YELLOW + RAIN_YELLOW_EXTRA  // 5s when raining
        : BASE_YELLOW;                      // 3s normal

    const us    = usData    || {};
    const piezo = piezoData || {};
    const ped   = pedStatus || {};
    const esp   = espStatus || {};
    const uswk  = usWorking || {};

    // ── Determine system mode ─────────────────────────────────────────────────
    const anyOnline = ROADS.some(r => esp[r] === true);
    const anyWorking = ROADS.some(r => uswk[r] === true);

    let systemMode;
    if (!anyOnline) {
        systemMode = 'FALLBACK';       // No ESP32s connected at all
    } else if (!anyWorking) {
        systemMode = 'FALLBACK';       // ESP32s connected but no sensor data yet
    } else {
        systemMode = 'SENSOR';         // Normal sensor-driven mode
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FALLBACK MODE: strict round-robin of ONLINE roads only
    // ══════════════════════════════════════════════════════════════════════════
    if (systemMode === 'FALLBACK') {
        // fallbackRoad is managed externally — it's already the correct online road
        const winnerRoad = fallbackRoad || ROADS[0];

        const priorities = ROADS
            .filter(r => esp[r] !== false)  // only include online roads (or all if none known)
            .map(road => ({
                road,
                sensorScenario: 'FALLBACK',
                us1Stable:  false,
                us2Stable:  false,
                queueLevel: 'None',
                piezoHeavy: false,
                score: road === winnerRoad ? 1000 : 0,
                greenTime:  FALLBACK_GREEN,
                yellowTime: currentYellow,
                mode: 'FALLBACK',
                espOnline: esp[road] !== false,
                onCooldown: false
            }));

        // Include offline roads at the bottom for display purposes
        ROADS.filter(r => esp[r] === false).forEach(road => {
            priorities.push({
                road,
                sensorScenario: 'NO_DATA',
                us1Stable: false, us2Stable: false,
                queueLevel: 'None', piezoHeavy: false,
                score: SCORE_ESP_OFFLINE,
                greenTime: 0, yellowTime: currentYellow,
                mode: 'FALLBACK', espOnline: false, onCooldown: false
            });
        });

        priorities.sort((a, b) => b.score - a.score);
        const winner = priorities[0];

        return {
            timestamp:      new Date().toISOString(),
            mode:           'FALLBACK',
            winner:         winner.road,
            greenDuration:  FALLBACK_GREEN,
            yellowDuration: currentYellow,
            redForOthers:   FALLBACK_GREEN + currentYellow,
            priorities,
            lastWinner,
            weather: { rainDetected: rainDetected || false, yellowTime: currentYellow }
        };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SENSOR MODE: score each road based on queue level + piezo
    // ══════════════════════════════════════════════════════════════════════════

    // First pass: compute raw scores for all online roads
    const roadData = ROADS.map(road => {
        const espOnline  = esp[road] === true;
        const usOnline   = uswk[road] === true;
        const roadUS     = us[road]  || { us1Stable: false, us2Stable: false };
        const piezoRoad  = piezo[road] || { heavy: false };
        const pedRoad    = ped[road]   || { requested: false, crossing: false };
        const onCooldown = (road === lastWinner);

        // Sensor values only valid if ESP32 is online AND sending data
        const us1Stable  = espOnline && usOnline ? (roadUS.us1Stable || false) : false;
        const us2Stable  = espOnline && usOnline ? (roadUS.us2Stable || false) : false;
        const piezoHeavy = (piezoRoad.heavy === true) && us1Stable;

        let rawScore, greenTime, badge;

        if (!espOnline) {
            rawScore  = SCORE_ESP_OFFLINE;
            greenTime = 0;
            badge     = 'NO_DATA';
        } else {
            rawScore  = calcScore(us1Stable, us2Stable, piezoHeavy);
            greenTime = calcGreenTime(us1Stable, us2Stable, piezoHeavy);
            badge     = queueLevel(us1Stable, us2Stable) === 'None'
                ? (piezoHeavy ? 'QUEUE_NONE_PIEZO' : 'QUEUE_NONE')
                : (queueLevel(us1Stable, us2Stable) === 'Heavy'
                    ? (piezoHeavy ? 'QUEUE_HEAVY_PIEZO' : 'QUEUE_HEAVY')
                    : (piezoHeavy ? 'QUEUE_LIGHT_PIEZO' : 'QUEUE_LIGHT'));

            // Pedestrian crossing on this road → it cannot be the winner
            if (pedRoad.crossing) {
                rawScore  = SCORE_ESP_OFFLINE - 1;
                greenTime = 0;
            }
        }

        return {
            road,
            sensorScenario: badge,
            us1Stable,
            us2Stable,
            queueLevel: queueLevel(us1Stable, us2Stable),
            piezoHeavy,
            pedestrian: pedRoad,
            rawScore,
            score: rawScore,  // will be adjusted below for cooldown
            greenTime,
            yellowTime: currentYellow,
            mode: systemMode,
            espOnline,
            usOnline,
            onCooldown
        };
    });

    // ── Apply cooldown ────────────────────────────────────────────────────────
    // Check if ALL eligible roads (online, not crossing) are on cooldown
    const eligibleRoads = roadData.filter(r => r.espOnline && !r.pedestrian?.crossing && r.rawScore > SCORE_ESP_OFFLINE);
    const allOnCooldown = eligibleRoads.length > 0 && eligibleRoads.every(r => r.onCooldown);

    roadData.forEach(r => {
        if (r.onCooldown && !allOnCooldown) {
            // Exclude from winning this cycle — set score to cooldown sentinel
            r.score = SCORE_ON_COOLDOWN;
        }
        // If allOnCooldown → ignore cooldown → keep rawScore
    });

    // ── Sort by score descending ──────────────────────────────────────────────
    roadData.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        // TIE-BREAKING: use round-robin order
        // fallbackRoad is passed in as the current "tie-break turn" road
        if (a.road === fallbackRoad) return -1;
        if (b.road === fallbackRoad) return 1;
        return ROADS.indexOf(a.road) - ROADS.indexOf(b.road);
    });

    const winner = roadData[0];

    // Clamp green time — minimum 3s for any winner
    const greenDur = Math.max(BASE_GREEN, winner.greenTime);

    return {
        timestamp:      new Date().toISOString(),
        mode:           systemMode,
        winner:         winner.road,
        greenDuration:  greenDur,
        yellowDuration: currentYellow,
        redForOthers:   greenDur + currentYellow,
        priorities:     roadData,
        lastWinner,
        weather: { rainDetected: rainDetected || false, yellowTime: currentYellow }
    };
}

module.exports = {
    makeSignalDecision,
    queueLevel,
    calcGreenTime,
    calcScore,
    BASE_GREEN,
    LIGHT_BONUS,
    HEAVY_BONUS,
    PIEZO_BONUS,
    BASE_YELLOW,
    RAIN_YELLOW_EXTRA,
    FALLBACK_GREEN,
    ROADS
};