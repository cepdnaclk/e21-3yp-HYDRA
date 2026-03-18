// ═══════════════════════════════════════════════════════════════════════════
// server/index.js — HYDRA Smart Traffic Control System (COMPLETE VERSION)
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS FILE DOES:
//   • Runs the MQTT broker (receives data from ESP32)
//   • Runs the HTTP API (serves the dashboard)
//   • Runs the traffic signal cycle engine (decides GREEN/YELLOW/RED)
//   • Handles Google Traffic data (with graceful fallback)
//   • Handles Force Red/Yellow/Green overrides from dashboard
//   • Sends countdown timers to dashboard in real-time
// ═══════════════════════════════════════════════════════════════════════════

require('dotenv').config();
const express        = require('express');
const cors           = require('cors');
const mongoose       = require('mongoose');
const aedes          = require('aedes')();
const net            = require('net');
const http           = require('http');
const { Server }     = require('socket.io');

// ── Import our modules ──────────────────────────────────────────────────────
const TrafficData    = require('./models/TrafficData');
const UltrasonicData = require('./models/UltrasonicData');
const { getAllTrafficConditions } = require('./services/googleTrafficService');
const { makeSignalDecision }      = require('./logic/signalDecision');

// ── App & Server Setup ──────────────────────────────────────────────────────
const app        = express();
const httpServer = http.createServer(app);

// Socket.IO for real-time dashboard updates (countdowns, state changes)
const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT      = process.env.PORT      || 5000;
const MQTT_PORT = parseInt(process.env.MQTT_PORT) || 1883;

app.use(cors({ origin: '*' }));
app.use(express.json());

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1: DATABASE CONNECTION
// ════════════════════════════════════════════════════════════════════════════
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅  MongoDB Connected'))
    .catch(err => console.error('❌  MongoDB Error:', err));

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2: IN-MEMORY STATE
// These objects hold all current data in RAM for instant access
// ════════════════════════════════════════════════════════════════════════════

const ROADS = ['North', 'South', 'East', 'West'];

// Sensor readings (cm). 5000 = no vehicle detected
let sensorData = { North: 5000, South: 5000, East: 5000, West: 5000 };

// Google Traffic at NEXT intersection for each road
// This is what we read to prevent sending cars into a jam
let googleTraffic = { North: 'Unknown', South: 'Unknown', East: 'Unknown', West: 'Unknown' };

// Track if each data source is working
let sensorWorking  = { North: false, South: false, East: false, West: false };
let googleWorking  = false;

// Current physical LED state of each road (sent back from ESP32)
let liveSignalState = { North: 'RED', South: 'RED', East: 'RED', West: 'RED' };

// Current countdown remaining for each road (seconds)
let liveCountdown = { North: 0, South: 0, East: 0, West: 0 };

// Active phase for each road
let livePhase = { North: 'RED', South: 'RED', East: 'RED', West: 'RED' };

// Latest computed decision
let latestDecision = null;

// Force override state — set by dashboard buttons
// { road: 'North', command: 'RED'|'YELLOW'|'GREEN', duration: 30, active: true }
let forceOverride = null;

// ── Signal Cycle Engine State ────────────────────────────────────────────────
// This is the core: one road gets GREEN at a time, others RED
let cycleActive   = false;
let cycleInterval = null;
let currentWinner = null;
let phaseTimer    = null;
let phaseEndTime  = null;
let currentPhase  = 'RED'; // current phase of winning road: GREEN → YELLOW → RED

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3: MQTT BROKER SETUP
// ESP32 boards connect here via WiFi
// ════════════════════════════════════════════════════════════════════════════
const mqttServer = net.createServer(aedes.handle);

aedes.on('client', (client) => {
    console.log(`🔌  ESP32 Connected: ${client ? client.id : 'Unknown'}`);
});

aedes.on('clientDisconnect', (client) => {
    console.log(`📴  ESP32 Disconnected: ${client ? client.id : 'Unknown'}`);
});

aedes.on('publish', async (packet, client) => {
    if (!client) return;

    const topic   = packet.topic;
    const payload = packet.payload.toString();

    // ── Handle ultrasonic sensor data from ESP32 ──
    // Topic: traffic/ultrasonic/North (or South, East, West)
    if (topic.startsWith('traffic/ultrasonic/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;

            sensorData[road]   = data.distanceCm;
            sensorWorking[road] = true;

            // Save to database
            await UltrasonicData.findOneAndUpdate(
                { road },
                {
                    road,
                    distanceCm:      data.distanceCm,
                    vehicleDetected: data.distanceCm <= 400,
                    timestamp:       new Date()
                },
                { upsert: true, new: true }
            );

            console.log(`📡  Ultrasonic [${road}]: ${data.distanceCm < 5000 ? data.distanceCm + 'cm' : 'No vehicle'}`);

            // Push sensor update to dashboard immediately
            io.emit('sensorUpdate', {
                road,
                distanceCm:      data.distanceCm,
                vehicleDetected: data.distanceCm <= 400
            });

        } catch (e) {
            console.error('⚠️   Ultrasonic parse error:', e.message);
        }
    }

    // ── Handle live light state from ESP32 ──
    // Topic: traffic/state/North
    // ESP32 tells us when it physically changed its LED
    if (topic.startsWith('traffic/state/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;

            liveSignalState[road] = data.state;
            console.log(`💡  LED State [${road}]: ${data.state}`);

            // Push to dashboard immediately
            io.emit('ledStateUpdate', { road, state: data.state });

        } catch (e) {
            console.error('⚠️   State parse error:', e.message);
        }
    }
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 4: SIGNAL CYCLE ENGINE
// This is the brain — decides who gets green and for how long
// Runs in a non-blocking loop using setTimeout
// ════════════════════════════════════════════════════════════════════════════

// ── Send a command to ONE road's ESP32 ──────────────────────────────────────
function sendCommandToRoad(road, signal, greenTime, yellowTime) {
    const msg = JSON.stringify({
        signal,
        greenTime:  greenTime  || 5,
        yellowTime: yellowTime || 5,
        timestamp:  new Date().toISOString()
    });

    aedes.publish({
        topic:   `traffic/control/${road}`,
        payload: Buffer.from(msg),
        qos:     1,
        retain:  true
    }, (err) => {
        if (err) console.error(`❌  Failed to send to ${road}:`, err);
        else console.log(`📤  Sent to ${road}: ${signal} (green=${greenTime}s)`);
    });
}

// ── Set all roads to RED ─────────────────────────────────────────────────────
function setAllRoadsRed() {
    ROADS.forEach(road => {
        sendCommandToRoad(road, 'RED', 0, 0);
        livePhase[road]     = 'RED';
        liveCountdown[road] = 0;
    });
}

// ── Decide which road gets green next ───────────────────────────────────────
// Checks sensor + google data and applies priority logic
function decideNextWinner() {
    latestDecision = makeSignalDecision(sensorData, googleTraffic, sensorWorking, googleWorking);

    // Push new decision to dashboard
    io.emit('newDecision', latestDecision);
    console.log(`🧠  Decision: ${latestDecision.winner} gets GREEN (${latestDecision.greenDuration}s) — Mode: ${latestDecision.mode}`);

    return latestDecision;
}

// ── Run one complete cycle: GREEN → YELLOW → RED for winner ─────────────────
// Then automatically decides and starts next cycle
function runOneCycle() {
    if (forceOverride && forceOverride.active) {
        // If a force override is active, don't start normal cycle
        return;
    }

    // Step 1: Make the decision BEFORE the green phase starts
    const decision = decideNextWinner();
    const winner   = decision.winner;
    const greenTime  = decision.greenDuration;   // seconds
    const yellowTime = decision.yellowDuration;  // seconds (constant 5s)

    currentWinner = winner;
    currentPhase  = 'GREEN';

    // Step 2: Set winner to GREEN, all others to RED immediately
    setAllRoadsRed();
    setTimeout(() => {
        sendCommandToRoad(winner, 'GREEN', greenTime, yellowTime);
        livePhase[winner]    = 'GREEN';
        liveSignalState[winner] = 'GREEN';

        // Start countdown for dashboard
        startCountdown(winner, 'GREEN', greenTime);

        console.log(`\n🟢  [CYCLE] ${winner} GREEN for ${greenTime}s`);
        broadcastFullState();

        // Step 3: After GREEN, switch to YELLOW (decided DURING green phase)
        phaseTimer = setTimeout(() => {
            currentPhase = 'YELLOW';

            // *** DECISION MAKING HAPPENS HERE — during yellow light ***
            // We recalculate NEXT winner while yellow is showing
            const nextDecision = decideNextWinner();
            console.log(`🟡  [CYCLE] ${winner} YELLOW for ${yellowTime}s — NEXT: ${nextDecision.winner}`);

            sendCommandToRoad(winner, 'YELLOW', 0, yellowTime);
            livePhase[winner]       = 'YELLOW';
            liveSignalState[winner] = 'YELLOW';
            startCountdown(winner, 'YELLOW', yellowTime);
            broadcastFullState();

            // Step 4: After YELLOW, set RED — then start next cycle
            phaseTimer = setTimeout(() => {
                currentPhase = 'RED';

                sendCommandToRoad(winner, 'RED', 0, 0);
                livePhase[winner]       = 'RED';
                liveSignalState[winner] = 'RED';
                liveCountdown[winner]   = 0;
                broadcastFullState();

                console.log(`🔴  [CYCLE] ${winner} RED — starting next cycle`);

                // Step 5: Brief all-red safety gap (2s), then next cycle
                phaseTimer = setTimeout(() => {
                    runOneCycle(); // ← recursion starts next cycle
                }, 2000);

            }, yellowTime * 1000);

        }, greenTime * 1000);

    }, 500); // tiny delay to ensure RED is set before GREEN
}

// ── Countdown broadcaster — updates dashboard every second ──────────────────
let countdownIntervals = {};

function startCountdown(road, phase, seconds) {
    // Clear any existing countdown for this road
    if (countdownIntervals[road]) clearInterval(countdownIntervals[road]);

    let remaining = seconds;
    liveCountdown[road] = remaining;

    countdownIntervals[road] = setInterval(() => {
        remaining--;
        liveCountdown[road] = Math.max(0, remaining);

        io.emit('countdown', {
            road,
            phase,
            remaining: liveCountdown[road]
        });

        if (remaining <= 0) {
            clearInterval(countdownIntervals[road]);
        }
    }, 1000);
}

// ── Broadcast full system state to all dashboard clients ────────────────────
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
        forceOverride: forceOverride ? { active: forceOverride.active, road: forceOverride.road, command: forceOverride.command } : null
    });
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 5: FORCE OVERRIDE HANDLER
// When traffic police click Force Red/Yellow/Green on dashboard
// ════════════════════════════════════════════════════════════════════════════

function applyForceOverride(road, command, duration) {
    console.log(`🚨  FORCE OVERRIDE: ${road} → ${command} for ${duration}s`);

    // Stop normal cycle
    if (phaseTimer) clearTimeout(phaseTimer);
    Object.values(countdownIntervals).forEach(i => clearInterval(i));

    // Set all to RED first
    setAllRoadsRed();

    forceOverride = { road, command, duration, active: true };

    setTimeout(() => {
        // Apply the forced command to the specific road
        sendCommandToRoad(road, command, duration, 5);
        livePhase[road]       = command;
        liveSignalState[road] = command;
        startCountdown(road, command, duration);
        broadcastFullState();

        // After duration, return to normal cycle
        setTimeout(() => {
            console.log('✅  Force override ended — resuming normal cycle');
            forceOverride = null;
            setAllRoadsRed();
            broadcastFullState();

            // Resume cycle after 2s safety gap
            setTimeout(() => {
                runOneCycle();
            }, 2000);

        }, duration * 1000);

    }, 500);
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 6: GOOGLE TRAFFIC REFRESH (every 30 seconds)
// Graceful fallback: if Google fails, system uses sensor data only
// ════════════════════════════════════════════════════════════════════════════

async function refreshGoogleTraffic() {
    try {
        const result = await getAllTrafficConditions();

        // Check if we actually got real data
        const hasRealData = Object.values(result).some(v => v !== 'Unknown');
        googleWorking  = hasRealData;
        googleTraffic  = result;

        console.log(`🗺️   Google Traffic: N=${result.North} S=${result.South} E=${result.East} W=${result.West} | Working: ${googleWorking}`);

        io.emit('googleTrafficUpdate', { googleTraffic, googleWorking });

    } catch (err) {
        googleWorking = false;
        console.log('⚠️   Google Traffic unavailable — using sensor-only mode');
    }
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 7: HTTP API ROUTES
// ════════════════════════════════════════════════════════════════════════════

// GET /api/traffic — main data endpoint for dashboard polling fallback
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
            currentDecision: latestDecision
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/decision — latest signal decision
app.get('/api/decision', (req, res) => {
    if (!latestDecision) {
        return res.json({ message: 'No decision yet — system starting up' });
    }
    res.json(latestDecision);
});

// GET /api/sensor-data — historical sensor readings from DB
app.get('/api/sensor-data', async (req, res) => {
    try {
        const data = await UltrasonicData.find().sort({ timestamp: -1 }).limit(100);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/traffic/control — Force override from dashboard
// Body: { location: "North", command: "GREEN"|"RED"|"YELLOW", duration: 30 }
app.post('/api/traffic/control', (req, res) => {
    const { location, command, duration } = req.body;

    if (!ROADS.includes(location)) {
        return res.status(400).json({ error: 'Invalid road. Use: North, South, East, West' });
    }
    if (!['RED', 'YELLOW', 'GREEN'].includes(command)) {
        return res.status(400).json({ error: 'Invalid command. Use: RED, YELLOW, GREEN' });
    }

    const dur = parseInt(duration) || 30;
    applyForceOverride(location, command, dur);

    res.json({
        message:  `Force ${command} applied to ${location} for ${dur}s`,
        location, command, duration: dur
    });
});

// POST /api/system/resume — Resume normal cycle after override
app.post('/api/system/resume', (req, res) => {
    forceOverride = null;
    if (phaseTimer) clearTimeout(phaseTimer);
    setAllRoadsRed();
    setTimeout(() => runOneCycle(), 2000);
    res.json({ message: 'Normal cycle resumed' });
});

// GET /api/health — check server status
app.get('/api/health', (req, res) => {
    res.json({
        status:       'online',
        googleWorking,
        sensorWorking,
        currentWinner,
        currentPhase,
        uptime:       process.uptime()
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 8: SOCKET.IO (Real-time dashboard connection)
// ════════════════════════════════════════════════════════════════════════════
io.on('connection', (socket) => {
    console.log('🖥️   Dashboard connected:', socket.id);

    // Send current full state immediately when dashboard connects
    socket.emit('fullState', {
        liveSignalState,
        liveCountdown,
        livePhase,
        latestDecision,
        sensorData,
        googleTraffic,
        sensorWorking,
        googleWorking
    });

    socket.on('disconnect', () => {
        console.log('🖥️   Dashboard disconnected:', socket.id);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 9: START EVERYTHING
// ════════════════════════════════════════════════════════════════════════════

// Start MQTT broker
mqttServer.listen(MQTT_PORT, () => {
    console.log(`📡  MQTT Broker running on port ${MQTT_PORT}`);
});

// Start HTTP + Socket.IO server
httpServer.listen(PORT, () => {
    console.log(`✅  API + Dashboard Server running on port ${PORT}`);
});

// Wait 3 seconds for connections, then start the signal cycle
setTimeout(async () => {
    console.log('\n🚦  Starting HYDRA Signal Cycle Engine...');
    await refreshGoogleTraffic();
    setInterval(refreshGoogleTraffic, 30000); // Refresh Google traffic every 30s
    runOneCycle(); // Start the infinite signal cycle
}, 3000);

// Broadcast full state every 2 seconds as heartbeat (for new connections)
setInterval(broadcastFullState, 2000);