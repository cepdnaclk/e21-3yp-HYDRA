// ═══════════════════════════════════════════════════════════════════════════
// server/index.js — HYDRA Smart Traffic Control System v8.0
//
// FIXES vs v7.0:
//
//   FIX 1 — Priorities array always reflects the real winner
//     fallbackWinner is now passed INTO makeSignalDecision() so the function
//     itself sorts priorities[] correctly. The override block in
//     decideNextWinner() is removed — signalDecision.js is the single source
//     of truth for both winner and priorities[].
//
//   FIX 2 — sensorWorking stale on ESP32 reconnection
//     espOnline flipping to true no longer waits for an ultrasonic packet.
//     On reconnection the road is immediately marked sensorWorking = false
//     (unknown) and the system gives it one cycle to send real data before
//     re-entering normal scoring. A reconnect event is logged clearly.
//
//   FIX 3 — Faster failure detection
//     ESP32_TIMEOUT_MS reduced from 20 minutes to 3 minutes.
//     Reconnection grace period: sensorWorking is cleared immediately on
//     offline detection and restored only when real sensor data arrives.
//
//   FIX 4 — No duplicate fallback rotation logic
//     FALLBACK_ROTATION_ORDER and fallbackRotationIndex are still here but
//     now serve only to compute the fallbackWinner string that gets passed to
//     makeSignalDecision(). All score/priority manipulation is removed from
//     decideNextWinner().
// ═══════════════════════════════════════════════════════════════════════════

require('dotenv').config();
const express        = require('express');
const cors           = require('cors');
const mongoose       = require('mongoose');
const aedes          = require('aedes')();
const net            = require('net');
const http           = require('http');
const path           = require('path');
const { Server }     = require('socket.io');

const TrafficData    = require('./models/TrafficData');
const UltrasonicData = require('./models/UltrasonicData');
const { getAllTrafficConditions }  = require('./services/googleTrafficService');
const { makeSignalDecision, classifyQueueByUltrasonic, getFallbackGreenTime }
                                   = require('./logic/signalDecision');
const {
    saveAnalyticsRecord,
    getPeakHourAnalysis,
    getRoadPerformance,
    getLiveCongestionTrend,
    getSystemEfficiency
} = require('./services/analyticsService');

const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT      = process.env.PORT      || 5000;
const MQTT_PORT = parseInt(process.env.MQTT_PORT) || 1883;

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/build')));

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅  MongoDB Connected'))
    .catch(err => console.error('❌  MongoDB Error:', err));

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2: IN-MEMORY STATE
// ════════════════════════════════════════════════════════════════════════════
const ROADS = ['North', 'South', 'East', 'West'];

let sensorData      = { North: 5000, South: 5000, East: 5000, West: 5000 };
let googleTraffic   = { North: 'Unknown', South: 'Unknown', East: 'Unknown', West: 'Unknown' };
let sensorWorking   = { North: false, South: false, East: false, West: false };
let googleWorking   = false;
let liveSignalState = { North: 'RED', South: 'RED', East: 'RED', West: 'RED' };
let liveCountdown   = { North: 0, South: 0, East: 0, West: 0 };
let livePhase       = { North: 'RED', South: 'RED', East: 'RED', West: 'RED' };
let latestDecision  = null;
let forceOverride   = null;

let currentWinner = null;
let phaseTimer    = null;
let currentPhase  = 'RED';

// Queue stability — require 10s of stable reading before upgrading queue level
let queueData = {
    North: { queueLevel: 'None' },
    South: { queueLevel: 'None' },
    East:  { queueLevel: 'None' },
    West:  { queueLevel: 'None' }
};
let queueStability = {
    North: { candidateLevel: 'None', stableSince: 0, queueLevel: 'None' },
    South: { candidateLevel: 'None', stableSince: 0, queueLevel: 'None' },
    East:  { candidateLevel: 'None', stableSince: 0, queueLevel: 'None' },
    West:  { candidateLevel: 'None', stableSince: 0, queueLevel: 'None' }
};

// ── Piezo state (persistent, locked per road) ─────────────────────────────
const PIEZO_SAFETY_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

let piezoData = {
    North: { heavy: false, timestamp: 0, locked: false },
    South: { heavy: false, timestamp: 0, locked: false },
    East:  { heavy: false, timestamp: 0, locked: false },
    West:  { heavy: false, timestamp: 0, locked: false }
};

function clearPiezoForRoad(road) {
    if (!ROADS.includes(road)) return;
    piezoData[road] = { heavy: false, timestamp: 0, locked: false };
    heavyVehicleActive[road] = false;
    console.log(`🚛 [${road}] Piezo cleared — green cycle complete`);
    io.emit('piezoUpdate',        { road, heavyVehicle: false, rawValue: 0 });
    io.emit('heavyVehicleUpdate', { road, active: false });
    broadcastFullState();
}

// Safety sweep: auto-release any piezo lock older than 10 minutes
setInterval(() => {
    const now = Date.now();
    ROADS.forEach(road => {
        if (piezoData[road].locked && (now - piezoData[road].timestamp) > PIEZO_SAFETY_WINDOW_MS) {
            console.log(`⚠️  [${road}] Piezo safety-release (10-min timeout)`);
            clearPiezoForRoad(road);
        }
    });
}, 60000);

let heavyVehicleActive = { North: false, South: false, East: false, West: false };

let rainDetected = false;
let yellowTime   = 3;

let pedStatus = {
    North: { requested: false, crossing: false, duration: 0 },
    South: { requested: false, crossing: false, duration: 0 },
    East:  { requested: false, crossing: false, duration: 0 },
    West:  { requested: false, crossing: false, duration: 0 }
};
let pedPressedDuringPhase = { North: null, South: null, East: null, West: null };
let pedCrossingTimers = {};

let greenTime = { North: 3, South: 3, East: 3, West: 3 };
let redTime   = 3;

// ── STRICT ROUND-ROBIN ORDER (N → S → E → W → repeat) ──────────────────
// This ensures fairness and prevents any road from being starved
const ROTATION_ORDER          = ['North', 'South', 'East', 'West'];
let currentRotationIndex      = 0;  // Tracks which road gets green next in rotation

// ── FIX 3: ESP32 health — 3-minute timeout (was 20 minutes) ──────────────
const ESP32_TIMEOUT_MS = 3 * 60 * 1000;
let espLastSeen = { North: Date.now(), South: Date.now(), East: Date.now(), West: Date.now() };
let espOnline   = { North: true, South: true, East: true, West: true };

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3: MQTT BROKER
// ════════════════════════════════════════════════════════════════════════════
const mqttServer = net.createServer(aedes.handle);

aedes.on('client',           c => console.log(`🔌  ESP32 Connected: ${c ? c.id : 'Unknown'}`));
aedes.on('clientDisconnect', c => console.log(`📴  ESP32 Disconnected: ${c ? c.id : 'Unknown'}`));

// ── Pedestrian helpers ────────────────────────────────────────────────────
function _startPedCrossing(road, durationSec) {
    if (pedStatus[road].crossing) return;
    const dur = durationSec || 3;
    pedStatus[road].crossing  = true;
    pedStatus[road].requested = false;
    pedStatus[road].duration  = dur;
    pedPressedDuringPhase[road] = null;
    console.log(`🚶 [${road}] CROSSING STARTED — ${dur}s`);
    aedes.publish({
        topic:   `traffic/pedestrian/cmd/${road}`,
        payload: Buffer.from(JSON.stringify({ action: 'START_CROSSING', duration: dur })),
        qos: 1
    }, () => {});
    io.emit('pedestrianUpdate', { road, ...pedStatus[road], action: 'CROSSING_STARTED', countdown: dur });

    let remaining = dur;
    if (pedCrossingTimers[road]) clearInterval(pedCrossingTimers[road]);
    pedCrossingTimers[road] = setInterval(() => {
        remaining--;
        pedStatus[road].duration = Math.max(0, remaining);
        io.emit('pedestrianUpdate', { road, ...pedStatus[road], countdown: remaining });
        if (remaining <= 0) {
            clearInterval(pedCrossingTimers[road]);
            pedCrossingTimers[road] = null;
            _endPedCrossing(road);
        }
    }, 1000);
}

function _endPedCrossing(road) {
    if (pedCrossingTimers[road]) {
        clearInterval(pedCrossingTimers[road]);
        pedCrossingTimers[road] = null;
    }
    pedStatus[road].crossing  = false;
    pedStatus[road].requested = false;
    pedStatus[road].duration  = 0;
    pedPressedDuringPhase[road] = null;
    console.log(`🚶 [${road}] CROSSING ENDED`);
    aedes.publish({
        topic:   `traffic/pedestrian/cmd/${road}`,
        payload: Buffer.from(JSON.stringify({ action: 'END_CROSSING' })),
        qos: 1
    }, () => {});
    io.emit('pedestrianUpdate', { road, ...pedStatus[road], action: 'CROSSING_ENDED' });
}

// ── MQTT message handler ──────────────────────────────────────────────────
aedes.on('publish', async (packet, client) => {
    if (!client) return;
    const topic   = packet.topic;
    const payload = packet.payload.toString();

    // Update ESP32 last-seen on any message from any road topic
    const topicParts = topic.split('/');
    if (topicParts.length >= 3 && ROADS.includes(topicParts[2])) {
        const road = topicParts[2];
        espLastSeen[road] = Date.now();

        // FIX 2: On reconnect, mark espOnline but do NOT restore sensorWorking.
        // sensorWorking is only set true when real sensor data actually arrives.
        if (!espOnline[road]) {
            espOnline[road] = true;
            console.log(`✅ ESP32 [${road}] RECONNECTED — waiting for first sensor packet`);
            io.emit('espStatusUpdate', { road, online: true, reconnecting: true });
        }
    }

    // ── Ultrasonic ────────────────────────────────────────────────────────
    if (topic.startsWith('traffic/ultrasonic/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;

            sensorData[road]    = data.distanceCm;
            sensorWorking[road] = true;   // FIX 2: real data arrived — mark working

            await UltrasonicData.findOneAndUpdate(
                { road },
                { road, distanceCm: data.distanceCm, vehicleDetected: data.distanceCm <= 400, timestamp: new Date() },
                { upsert: true, returnDocument: 'after' }
            );

            // Queue stability: only upgrade level after 10s of consistent reading
            const now   = Date.now();
            const level = classifyQueueByUltrasonic(data.distanceCm);
            const stable = queueStability[road];

            if (level !== stable.candidateLevel) {
                stable.candidateLevel = level;
                stable.stableSince    = now;
            }

            // Downgrade to None immediately; upgrade only after 10s stable
            if (level === 'None') {
                stable.queueLevel = 'None';
            } else if (now - stable.stableSince >= 10000) {
                stable.queueLevel = level;
            }

            queueData[road] = { queueLevel: stable.queueLevel };

            console.log(`📡 Ultrasonic [${road}]: ${data.distanceCm < 5000 ? data.distanceCm + 'cm' : 'No vehicle'} → queue: ${stable.queueLevel}`);
            io.emit('sensorUpdate', { road, distanceCm: data.distanceCm });
            io.emit('queueUpdate',  { road, queueLevel: stable.queueLevel });

        } catch (e) { console.error('⚠️ Ultrasonic parse error:', e.message); }
    }

    // ── Piezo ─────────────────────────────────────────────────────────────
    if (topic.startsWith('traffic/piezo/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;

            const distanceCm         = sensorData[road];
            const vehicleAtStopLine  = distanceCm !== undefined && distanceCm !== null && distanceCm <= 400;

            if (data.heavyVehicle && vehicleAtStopLine && !piezoData[road].locked) {
                piezoData[road] = { heavy: true, timestamp: Date.now(), locked: true };
                heavyVehicleActive[road] = true;
                console.log(`🚛 HEAVY VEHICLE confirmed on ${road} (Ultrasonic+Piezo) — locked until green complete`);
                io.emit('piezoUpdate',        { road, heavyVehicle: true, rawValue: data.piezoValue });
                io.emit('heavyVehicleUpdate', { road, active: true });
                broadcastFullState();

            } else if (data.heavyVehicle && piezoData[road].locked) {
                console.log(`🚛 [${road}] Piezo tap ignored — already locked for this cycle`);
            } else if (data.heavyVehicle && !vehicleAtStopLine) {
                console.log(`🚛 [${road}] Piezo tap ignored — no ultrasonic vehicle at stop line`);
            }

        } catch (e) { console.error('⚠️ Piezo parse error:', e.message); }
    }

    // ── Rain sensor ───────────────────────────────────────────────────────
    if (topic.startsWith('traffic/rain/')) {
        try {
            const data = JSON.parse(payload);
            rainDetected = data.rainDetected || false;
            yellowTime   = rainDetected ? 5 : 3;
            console.log(`🌧️ Rain: ${rainDetected ? 'RAINING (Yellow: 5s)' : 'DRY (Yellow: 3s)'}`);
            io.emit('rainUpdate', { rainDetected, yellowTime });
        } catch (e) { console.error('⚠️ Rain parse error:', e.message); }
    }

    // ── Pedestrian button ─────────────────────────────────────────────────
    if (topic.startsWith('traffic/pedestrian/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;

            if (data.requested === true && !pedStatus[road].requested && !pedStatus[road].crossing) {
                pedStatus[road].requested = true;
                pedPressedDuringPhase[road] = livePhase[road];
                console.log(`🚶 Ped button [${road}] pressed during CAR_${livePhase[road]}`);

                if (livePhase[road] === 'RED') {
                    const remaining = liveCountdown[road] || 0;
                    if (remaining > 3) {
                        _startPedCrossing(road, 3);
                    } else {
                        io.emit('pedestrianUpdate', { road, ...pedStatus[road], case: 'A_WAIT', action: 'WAIT_TOO_SHORT_RED' });
                    }
                } else if (livePhase[road] === 'YELLOW' && currentPhase === 'PRE_GREEN_YELLOW') {
                    io.emit('pedestrianUpdate', { road, ...pedStatus[road], case: 'B', action: 'WAIT_YELLOW_UNSAFE' });
                } else if (livePhase[road] === 'GREEN') {
                    io.emit('pedestrianUpdate', { road, ...pedStatus[road], case: 'C', action: 'WAIT_FOR_GREEN_END', yellowRemaining: liveCountdown[road] });
                } else if (livePhase[road] === 'YELLOW') {
                    const remaining = liveCountdown[road] || 0;
                    aedes.publish({
                        topic:   `traffic/pedestrian/cmd/${road}`,
                        payload: Buffer.from(JSON.stringify({ action: 'SHOW_YELLOW_COUNTDOWN', duration: remaining })),
                        qos: 1
                    }, () => {});
                    io.emit('pedestrianUpdate', { road, ...pedStatus[road], case: 'D', action: 'WAIT_YELLOW_THEN_CROSS', yellowRemaining: remaining });
                }
            }

            if (data.crossing !== undefined) {
                if (data.crossing === true && !pedStatus[road].crossing) {
                    _startPedCrossing(road, data.duration || 3);
                } else if (data.crossing === false && pedStatus[road].crossing) {
                    _endPedCrossing(road);
                }
            }

            io.emit('pedestrianUpdate', { road, ...pedStatus[road] });
        } catch (e) { console.error('⚠️ Pedestrian parse error:', e.message); }
    }

    // ── LED state from ESP32 ──────────────────────────────────────────────
    if (topic.startsWith('traffic/state/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            liveSignalState[road] = data.state;
            livePhase[road]       = data.state;
            console.log(`💡 LED State [${road}]: ${data.state}`);
            io.emit('ledStateUpdate', { road, state: data.state });
        } catch (e) { console.error('⚠️ State parse error:', e.message); }
    }
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 4: SIGNAL CYCLE ENGINE
// ════════════════════════════════════════════════════════════════════════════

function sendCommandToRoad(road, signal, greenDuration, yellowOverride, dynamicRedTime) {
    const yt  = (yellowOverride !== undefined && yellowOverride > 0) ? yellowOverride : yellowTime;
    const rt  = (dynamicRedTime !== undefined && dynamicRedTime > 0) ? dynamicRedTime : 0;
    const msg = JSON.stringify({
        signal,
        greenTime:  greenDuration || 5,
        yellowTime: yt,
        redTime:    rt,
        timestamp:  new Date().toISOString()
    });
    aedes.publish(
        { topic: `traffic/control/${road}`, payload: Buffer.from(msg), qos: 1, retain: true },
        err => {
            if (err) console.error(`❌ Failed to send to ${road}:`, err);
            else     console.log(`📤 Sent to ${road}: ${signal} (green=${greenDuration}s, yellow=${yt}s, red=${rt}s)`);
        }
    );
}

// FIX 1 + FIX 4: compute fallbackWinner here and pass it into makeSignalDecision
// so the priorities array inside the decision is already correctly sorted.
// No post-hoc winner override needed anymore.
function decideNextWinner() {
    const allEspDown = Object.values(espOnline).every(online => online === false);

    // ───────────────────────────────────────────────────────────────────────
    // PRIORITY DECISION LOGIC
    // Priority Order: 1) Pedestrian  2) Heavy Traffic  3) Round-Robin
    // ───────────────────────────────────────────────────────────────────────
    
    // Base winner from round-robin rotation
    let baseWinner = ROTATION_ORDER[currentRotationIndex];
    let fallbackWinner = baseWinner;
    let priorityReason = '';
    
    // PRIORITY DECISION: Heavy traffic first, then strict rotation.
    // Pedestrian requests do not override green cycles; they may start
    // crossing only when the road is already RED.
    const roadsWithHeavyTraffic = ROTATION_ORDER.filter(road => {
        const queue = queueData[road] || {};
        return queue.queueLevel === 'Heavy';
    });
    
    if (roadsWithHeavyTraffic.length > 0) {
        // Heavy traffic detected - prioritize it
        if (roadsWithHeavyTraffic.includes(baseWinner)) {
            fallbackWinner = baseWinner;
            priorityReason = `🔴 HEAVY TRAFFIC PRIORITY (was already next in rotation)`;
        } else {
            fallbackWinner = roadsWithHeavyTraffic[0];
            priorityReason = `🔴 HEAVY TRAFFIC PRIORITY (queue detected, moved forward)`;
        }
    } else {
        priorityReason = `↪️ Strict Round-Robin: ${baseWinner}`;
    }
    
    console.log(`${priorityReason} (rotation index: ${currentRotationIndex})`);
    
    // Advance rotation index for NEXT cycle (regardless of override)
    currentRotationIndex = (currentRotationIndex + 1) % ROTATION_ORDER.length;

    // Call signal decision with the selected winner
    latestDecision = makeSignalDecision(
        sensorData,
        googleTraffic,
        sensorWorking,
        googleWorking,
        queueData,
        piezoData,
        rainDetected,
        pedStatus,
        espOnline,
        fallbackWinner   // The winner (from round-robin or pedestrian override)
    );

    // Ensure duration fields are set
    if (latestDecision && latestDecision.winner) {
        latestDecision.greenDuration  = latestDecision.greenDuration  || greenTime[latestDecision.winner] || 5;
        latestDecision.yellowDuration = latestDecision.yellowDuration || yellowTime;
        latestDecision.redForOthers   = latestDecision.greenDuration  + latestDecision.yellowDuration;
    }

    io.emit('newDecision', latestDecision);
    console.log(`🧠 Decision: ${latestDecision.winner} gets GREEN (${latestDecision.greenDuration}s) ` +
                `YELLOW (${latestDecision.yellowDuration}s) — Others RED (${latestDecision.redForOthers}s) ` +
                `— Mode: ${latestDecision.mode}`);
    return latestDecision;
}

// ── Main cycle ────────────────────────────────────────────────────────────
function runOneCycle() {
    if (forceOverride && forceOverride.active) return;

    const decision       = decideNextWinner();
    const winner         = decision.winner;
    const greenDuration  = decision.greenDuration  || greenTime[winner] || 5;
    const yellowDuration = decision.yellowDuration || yellowTime;
    const dynamicRedTime = greenDuration + yellowDuration;

    redTime       = dynamicRedTime;
    currentWinner = winner;
    currentPhase  = 'RED_TO_GREEN';

    if (piezoData[winner] && piezoData[winner].heavy) {
        console.log(`🚛 [${winner}] Heavy vehicle active — green extended (total: ${greenDuration}s)`);
    }

    // STEP 1: All roads RED
    ROADS.forEach(road => {
        if (!espOnline[road]) {
            sendCommandToRoad(road, 'RED', greenTime[road] || 3, yellowTime, dynamicRedTime);
            console.log(`⚠️  [${road}] ESP32 OFFLINE — synthetic RED sent`);
        } else {
            sendCommandToRoad(road, 'RED', 0, 0, dynamicRedTime);
        }
        livePhase[road]       = 'RED';
        liveSignalState[road] = 'RED';
        startCountdown(road, 'RED', dynamicRedTime);
    });
    broadcastFullState();

    // STEP 2: Winner pre-green YELLOW (1s after all-red)
    setTimeout(() => {
        currentPhase = 'PRE_GREEN_YELLOW';
        sendCommandToRoad(winner, 'YELLOW', 0, 2, 0);
        livePhase[winner]       = 'YELLOW';
        liveSignalState[winner] = 'YELLOW';
        startCountdown(winner, 'YELLOW', 2);
        broadcastFullState();

        // STEP 3: Winner GREEN (2s after pre-green yellow)
        phaseTimer = setTimeout(() => {
            currentPhase = 'GREEN';
            sendCommandToRoad(winner, 'GREEN', greenDuration, yellowDuration, 0);
            livePhase[winner]       = 'GREEN';
            liveSignalState[winner] = 'GREEN';
            startCountdown(winner, 'GREEN', greenDuration);
            console.log(`\n🟢 [CYCLE] ${winner} GREEN for ${greenDuration}s | Others RED for ${dynamicRedTime}s`);
            broadcastFullState();

            // STEP 4: GREEN ends → winner post-green YELLOW
            phaseTimer = setTimeout(() => {
                currentPhase = 'POST_GREEN_YELLOW';

                // Clear piezo after winner's full green has run
                if (piezoData[winner] && piezoData[winner].heavy) {
                    clearPiezoForRoad(winner);
                }

                const nextDecision = decideNextWinner();
                console.log(`🟡 [CYCLE] ${winner} YELLOW ${yellowDuration}s — NEXT: ${nextDecision.winner}`);

                sendCommandToRoad(winner, 'YELLOW', 0, yellowDuration, 0);
                livePhase[winner]       = 'YELLOW';
                liveSignalState[winner] = 'YELLOW';
                startCountdown(winner, 'YELLOW', yellowDuration);
                broadcastFullState();

                // STEP 5: YELLOW ends → winner RED
                phaseTimer = setTimeout(() => {
                    currentPhase = 'RED';
                    sendCommandToRoad(winner, 'RED', 0, 0, 0);
                    livePhase[winner]       = 'RED';
                    liveSignalState[winner] = 'RED';
                    liveCountdown[winner]   = 0;
                    broadcastFullState();
                    console.log(`🔴 [CYCLE] ${winner} RED — 1s pause`);

                    // Start any pending pedestrian crossings
                    ROADS.forEach(road => {
                        if (pedStatus[road].requested && !pedStatus[road].crossing) {
                            _startPedCrossing(road, 3);
                        }
                    });

                    // STEP 6: 1s pause → analytics → next cycle
                    phaseTimer = setTimeout(async () => {
                        for (const road of ROADS) {
                            await saveAnalyticsRecord(road, {
                                distanceCm:    sensorData[road]       || 5000,
                                queueLevel:    queueData[road]?.queueLevel || 'None',
                                googleTraffic: googleTraffic[road]    || 'Unknown',
                                rainDetected:  rainDetected,
                                greenTime:     greenTime[road]        || 3,
                                waitTime:      redTime,
                                isWinner:      currentWinner === road,
                                systemMode:    latestDecision?.mode   || 'FALLBACK'
                            });
                        }
                        runOneCycle();
                    }, 1000);

                }, yellowDuration * 1000);

            }, greenDuration * 1000);

        }, 2000); // 2s pre-green yellow

    }, 1000); // 1s all-red gap
}

// ── Countdown helper ──────────────────────────────────────────────────────
let countdownIntervals = {};

function startCountdown(road, phase, seconds) {
    if (countdownIntervals[road]) clearInterval(countdownIntervals[road]);
    let remaining       = seconds;
    liveCountdown[road] = remaining;
    countdownIntervals[road] = setInterval(() => {
        remaining--;
        liveCountdown[road] = Math.max(0, remaining);
        io.emit('countdown', { road, phase, remaining: liveCountdown[road] });
        if (remaining <= 0) clearInterval(countdownIntervals[road]);
    }, 1000);
}

// ── Broadcast full state ──────────────────────────────────────────────────
function broadcastFullState() {
    io.emit('fullState', {
        liveSignalState,
        liveCountdown,
        livePhase,
        latestDecision,
        sensorData,
        googleTraffic,
        sensorWorking,
        googleWorking,
        queueData,
        piezoData,
        rainDetected,
        yellowTime,
        pedStatus,
        greenTime,
        redTime,
        espOnline,
        heavyVehicleActive,
        forceOverride: forceOverride
            ? { active: forceOverride.active, road: forceOverride.road, command: forceOverride.command }
            : null
    });
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 5: FORCE OVERRIDE
// ════════════════════════════════════════════════════════════════════════════
function applyForceOverride(road, command, duration) {
    console.log(`🚨 FORCE OVERRIDE: ${road} → ${command} for ${duration}s`);
    if (phaseTimer) clearTimeout(phaseTimer);
    Object.values(countdownIntervals).forEach(i => clearInterval(i));

    const overrideRedTime = command === 'GREEN' ? (duration + yellowTime) : duration;

    ROADS.forEach(r => {
        if (r !== road) {
            sendCommandToRoad(r, 'RED', 0, 0, overrideRedTime);
            livePhase[r]       = 'RED';
            liveSignalState[r] = 'RED';
            startCountdown(r, 'RED', overrideRedTime);
        }
    });

    forceOverride = { road, command, duration, active: true };

    setTimeout(() => {
        sendCommandToRoad(road, command, duration, yellowTime, 0);
        livePhase[road]       = command;
        liveSignalState[road] = command;
        startCountdown(road, command, duration);
        broadcastFullState();

        setTimeout(() => {
            console.log('✅ Force override ended — resuming normal cycle');
            forceOverride = null;
            ROADS.forEach(r => {
                sendCommandToRoad(r, 'RED', 0, 0, 0);
                livePhase[r]       = 'RED';
                liveSignalState[r] = 'RED';
                liveCountdown[r]   = 0;
            });
            broadcastFullState();
            setTimeout(() => runOneCycle(), 2000);
        }, duration * 1000);

    }, 500);
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 6: GOOGLE TRAFFIC REFRESH (15-minute interval)
// ════════════════════════════════════════════════════════════════════════════
async function refreshGoogleTraffic() {
    try {
        const result     = await getAllTrafficConditions();
        const hasRealData = Object.values(result).some(v => v !== 'Unknown');
        googleWorking    = hasRealData;
        googleTraffic    = result;
        console.log(`🗺️ Google Traffic: N=${result.North} S=${result.South} E=${result.East} W=${result.West} | Working: ${googleWorking}`);
        io.emit('googleTrafficUpdate', { googleTraffic, googleWorking });
    } catch (err) {
        googleWorking = false;
        console.log('⚠️ Google Traffic unavailable — sensor-only mode');
    }
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 7: HTTP API ROUTES
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/traffic', async (req, res) => {
    try {
        res.json({
            ultrasonicReadings: sensorData,
            googleTraffic,
            liveSignalState,
            liveCountdown,
            livePhase,
            sensorWorking,
            googleWorking,
            currentDecision: latestDecision,
            queueData,
            piezoData,
            rainDetected,
            yellowTime,
            pedStatus,
            greenTime,
            redTime,
            espOnline,
            heavyVehicleActive,
            note: 'redTime is dynamic: equals winner greenTime + yellowTime each cycle'
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/decision', (req, res) => {
    if (!latestDecision) return res.json({ message: 'No decision yet — system starting up' });
    res.json(latestDecision);
});

app.get('/api/sensor-data', async (req, res) => {
    try {
        const data = await UltrasonicData.find().sort({ timestamp: -1 }).limit(100);
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/queue-data',   (req, res) => res.json(queueData));
app.get('/api/rain-status',  (req, res) => res.json({ rainDetected, yellowTime }));

app.post('/api/traffic/control', (req, res) => {
    const { location, command, duration } = req.body;
    if (!ROADS.includes(location))                     return res.status(400).json({ error: 'Invalid road' });
    if (!['RED', 'YELLOW', 'GREEN'].includes(command)) return res.status(400).json({ error: 'Invalid command' });
    const dur = parseInt(duration) || 30;
    applyForceOverride(location, command, dur);
    res.json({ message: `Force ${command} applied to ${location} for ${dur}s`, location, command, duration: dur });
});

app.post('/api/system/resume', (req, res) => {
    forceOverride = null;
    if (phaseTimer) clearTimeout(phaseTimer);
    ROADS.forEach(r => {
        sendCommandToRoad(r, 'RED', 0, 0, 0);
        livePhase[r]       = 'RED';
        liveSignalState[r] = 'RED';
        liveCountdown[r]   = 0;
    });
    setTimeout(() => runOneCycle(), 2000);
    res.json({ message: 'Normal cycle resumed' });
});

app.get('/api/analytics/peak-hours',        async (req, res) => { try { res.json(await getPeakHourAnalysis());    } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/analytics/road-performance',  async (req, res) => { try { res.json(await getRoadPerformance());     } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/analytics/live-trend',        async (req, res) => { try { res.json(await getLiveCongestionTrend()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/analytics/system-efficiency', async (req, res) => { try { res.json(await getSystemEfficiency());   } catch (e) { res.status(500).json({ error: e.message }); } });

app.get('/api/health', (req, res) => {
    res.json({
        status: 'online', googleWorking, sensorWorking, currentWinner, currentPhase,
        uptime: process.uptime(), rainDetected, yellowTime,
        currentRedTime: redTime,
        redTimeNote: 'Dynamic: winner greenTime + yellowTime',
        queueData, espOnline,
        fallbackGreenTime: getFallbackGreenTime(),
        espTimeoutMs: ESP32_TIMEOUT_MS
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 8: SOCKET.IO
// ════════════════════════════════════════════════════════════════════════════
io.on('connection', socket => {
    console.log('🖥️ Dashboard connected:', socket.id);
    socket.emit('fullState', {
        liveSignalState, liveCountdown, livePhase, latestDecision,
        sensorData, googleTraffic, sensorWorking, googleWorking,
        queueData, piezoData, rainDetected, yellowTime,
        pedStatus, greenTime, redTime, espOnline, heavyVehicleActive
    });
    socket.on('disconnect', () => console.log('🖥️ Dashboard disconnected:', socket.id));
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 9: START
// ════════════════════════════════════════════════════════════════════════════
mqttServer.listen(MQTT_PORT, () => console.log(`📡 MQTT Broker running on port ${MQTT_PORT}`));
httpServer.listen(PORT,      () => console.log(`✅ API + Dashboard Server running on port ${PORT}`));

setTimeout(async () => {
    console.log('\n🚦 Starting HYDRA Signal Cycle Engine v8.0...');
    console.log(`   RED time     : dynamic (= winner GREEN + YELLOW each cycle)`);
    console.log(`   YELLOW time  : 3s dry / 5s raining`);
    console.log(`   GREEN time   : 3–12s sensor-based; fallback time-of-day scheduled`);
    console.log(`   ESP32 timeout: ${ESP32_TIMEOUT_MS / 60000} minutes`);
    await refreshGoogleTraffic();
    setInterval(refreshGoogleTraffic, 15 * 60 * 1000);
    runOneCycle();
}, 3000);

// Broadcast full state every 2 seconds (keeps dashboard in sync)
setInterval(broadcastFullState, 2000);

// FIX 3: ESP32 health check — every 30s, 3-minute offline threshold
setInterval(() => {
    ROADS.forEach(road => {
        const age      = Date.now() - espLastSeen[road];
        const wasOnline = espOnline[road];
        espOnline[road] = age < ESP32_TIMEOUT_MS;

        if (wasOnline && !espOnline[road]) {
            // FIX 2: Clear sensorWorking immediately when ESP32 goes offline
            sensorWorking[road] = false;
            console.log(`❌ ESP32 [${road}] OFFLINE — no message for ${Math.round(age / 60000)} min`);
            io.emit('espStatusUpdate', { road, online: false });
            broadcastFullState();
        }
    });
}, 30000);

// Analytics broadcast every 30 seconds
setInterval(async () => {
    try {
        const [peakHours, roadPerf, efficiency] = await Promise.all([
            getPeakHourAnalysis(),
            getRoadPerformance(),
            getSystemEfficiency()
        ]);
        io.emit('analyticsUpdate', { peakHours, roadPerf, efficiency });
    } catch (err) { console.error('Analytics broadcast error:', err.message); }
}, 30000);
