// ═══════════════════════════════════════════════════════════════════════════
// server/index.js — HYDRA Smart Traffic Control System (CORRECTED YELLOW TIMING)
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

// ── Import our modules ──────────────────────────────────────────────────────
const TrafficData    = require('./models/TrafficData');
const UltrasonicData = require('./models/UltrasonicData');
const { getAllTrafficConditions } = require('./services/googleTrafficService');

const { makeSignalDecision } = require('./logic/signalDecision');

// ── App & Server Setup ──────────────────────────────────────────────────────
const app        = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT      = process.env.PORT      || 5000;
const MQTT_PORT = parseInt(process.env.MQTT_PORT) || 1883;

app.use(cors({ origin: '*' }));
app.use(express.json());

// ════════════════════════════════════════════════════════════════════════════
// STATIC FILE SERVING FOR REACT DASHBOARD
// ════════════════════════════════════════════════════════════════════════════
app.use(express.static(path.join(__dirname, '../client/build')));

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1: DATABASE CONNECTION
// ════════════════════════════════════════════════════════════════════════════
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅  MongoDB Connected'))
    .catch(err => console.error('❌  MongoDB Error:', err));

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2: IN-MEMORY STATE
// ════════════════════════════════════════════════════════════════════════════
const ROADS = ['North', 'South', 'East', 'West'];

let sensorData       = { North: 5000, South: 5000, East: 5000, West: 5000 };
let googleTraffic    = { North: 'Unknown', South: 'Unknown', East: 'Unknown', West: 'Unknown' };
let sensorWorking    = { North: false, South: false, East: false, West: false };
let googleWorking    = false;
let liveSignalState  = { North: 'RED', South: 'RED', East: 'RED', West: 'RED' };
let liveCountdown    = { North: 0, South: 0, East: 0, West: 0 };
let livePhase        = { North: 'RED', South: 'RED', East: 'RED', West: 'RED' };
let latestDecision   = null;
let forceOverride    = null;

let currentWinner = null;
let phaseTimer    = null;
let currentPhase  = 'RED';

// ── IR Sensor Data (2 sensors per road) ──────────────────────────────────────
let irData = {
    North: { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' },
    South: { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' },
    East:  { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' },
    West:  { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' }
};

// ── Piezo Sensor Data (heavy vehicle detection) ──────────────────────────────
let piezoData = { North: false, South: false, East: false, West: false };

// ── Rain Sensor Data - CORRECTED: 3s normal, 5s when raining ─────────────────
let rainDetected = false;
let yellowTime = 3;  // 3 seconds normal (matches ESP32 BASE_YELLOW_TIME)

// ── Pedestrian Data ──────────────────────────────────────────────────────────
let pedStatus = {
    North: { requested: false, crossing: false, duration: 0 },
    South: { requested: false, crossing: false, duration: 0 },
    East:  { requested: false, crossing: false, duration: 0 },
    West:  { requested: false, crossing: false, duration: 0 }
};

// ── Traffic Timings ──────────────────────────────────────────────────────────
let greenTime = { North: 3, South: 3, East: 3, West: 3 };
let redTime = 3;  // Fixed at 3 seconds (matches ESP32 BASE_RED_TIME)

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3: MQTT BROKER SETUP
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

    // ── Ultrasonic Data ──────────────────────────────────────────────────────
    if (topic.startsWith('traffic/ultrasonic/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            
            sensorData[road] = data.distanceCm;
            sensorWorking[road] = true;
            
            await UltrasonicData.findOneAndUpdate(
                { road },
                { 
                    road, 
                    distanceCm: data.distanceCm, 
                    vehicleDetected: data.distanceCm <= 400, 
                    timestamp: new Date() 
                },
                { upsert: true, returnDocument: 'after' }
            );
            
            console.log(`📡 Ultrasonic [${road}]: ${data.distanceCm < 5000 ? data.distanceCm + 'cm' : 'No vehicle'}`);
            io.emit('sensorUpdate', { road, distanceCm: data.distanceCm });
            
        } catch (e) { 
            console.error('⚠️ Ultrasonic parse error:', e.message); 
        }
    }

    // ── IR Sensors Data (traffic density detection) ──────────────────────────
    if (topic.startsWith('traffic/ir/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            
            // Update IR data
            irData[road] = {
                ir1Blocked: data.ir1Blocked || false,
                ir2Blocked: data.ir2Blocked || false,
                queueLevel: data.queueLevel || 'None'
            };
            
            // Calculate traffic density based on IR sensors
            let trafficDensity = 'None';
            if (data.ir1Blocked && data.ir2Blocked) {
                trafficDensity = 'Heavy';
                greenTime[road] = 9;  // 3s base + 6s = 9s total (matches ESP32)
            } else if (data.ir1Blocked || data.ir2Blocked) {
                trafficDensity = 'Light';
                greenTime[road] = 6;  // 3s base + 3s = 6s total (matches ESP32)
            } else {
                trafficDensity = 'None';
                greenTime[road] = 3;  // 3s base (matches ESP32)
            }
            
            console.log(`🔦 IR [${road}]: ${data.ir1Blocked ? 'BLOCKED' : 'CLEAR'} | ${data.ir2Blocked ? 'BLOCKED' : 'CLEAR'} → ${trafficDensity} Traffic (Green: ${greenTime[road]}s)`);
            io.emit('irUpdate', { road, ir1Blocked: data.ir1Blocked, ir2Blocked: data.ir2Blocked, queueLevel: trafficDensity });
            
        } catch (e) { 
            console.error('⚠️ IR parse error:', e.message); 
        }
    }

    // ── Piezo Sensor Data (heavy vehicle detection) ──────────────────────────
    if (topic.startsWith('traffic/piezo/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            
            piezoData[road] = data.heavyVehicle || false;
            if (data.heavyVehicle) {
                console.log(`🚛 Heavy vehicle detected on ${road}! Priority increased`);
            }
            io.emit('piezoUpdate', { road, heavyVehicle: data.heavyVehicle });
            
        } catch (e) { 
            console.error('⚠️ Piezo parse error:', e.message); 
        }
    }

    // ── Rain Sensor Data - CORRECTED: 3s normal, 5s when raining ──────────────
    if (topic.startsWith('traffic/rain/')) {
        try {
            const data = JSON.parse(payload);
            rainDetected = data.rainDetected || false;
            // CORRECTED: Yellow time matches ESP32
            // BASE_YELLOW_TIME = 3000 (3s)
            // RAIN_YELLOW_EXTRA = 2000 (+2s when raining)
            yellowTime = rainDetected ? 5 : 3;  // 5s when raining, 3s normal
            
            console.log(`🌧️ Rain Sensor: ${rainDetected ? 'RAINING (Yellow: 5s = 3s + 2s)' : 'DRY (Yellow: 3s)'}`);
            io.emit('rainUpdate', { rainDetected, yellowTime });
            
        } catch (e) { 
            console.error('⚠️ Rain parse error:', e.message); 
        }
    }

    // ── Pedestrian Button Data ───────────────────────────────────────────────
    if (topic.startsWith('traffic/pedestrian/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            
            if (data.requested !== undefined) {
                pedStatus[road].requested = data.requested;
            }
            if (data.crossing !== undefined) {
                pedStatus[road].crossing = data.crossing;
                pedStatus[road].duration = data.duration || 10;
            }
            
            console.log(`🚶 Pedestrian [${road}]: ${pedStatus[road].requested ? 'WAITING' : 'IDLE'} | ${pedStatus[road].crossing ? 'CROSSING' : ''}`);
            io.emit('pedestrianUpdate', { road, ...pedStatus[road] });
            
        } catch (e) { 
            console.error('⚠️ Pedestrian parse error:', e.message); 
        }
    }

    // ── LED State from ESP32 ─────────────────────────────────────────────────
    if (topic.startsWith('traffic/state/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            
            liveSignalState[road] = data.state;
            livePhase[road] = data.state;
            
            console.log(`💡 LED State [${road}]: ${data.state}`);
            io.emit('ledStateUpdate', { road, state: data.state });
            
        } catch (e) { 
            console.error('⚠️ State parse error:', e.message); 
        }
    }
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 4: SIGNAL CYCLE ENGINE
// ════════════════════════════════════════════════════════════════════════════

function sendCommandToRoad(road, signal, greenDuration, yellowOverride) {
    // Use the current yellowTime (3 or 5) if no override provided
    const yt = (yellowOverride !== undefined && yellowOverride > 0) ? yellowOverride : yellowTime;
    const msg = JSON.stringify({
        signal,
        greenTime: greenDuration || 5,
        yellowTime: yt,
        timestamp: new Date().toISOString()
    });
    
    aedes.publish({
        topic: `traffic/control/${road}`,
        payload: Buffer.from(msg),
        qos: 1,
        retain: true
    }, (err) => {
        if (err) console.error(`❌ Failed to send to ${road}:`, err);
        else console.log(`📤 Sent to ${road}: ${signal} (green=${greenDuration}s, yellow=${yt}s)`);
    });
}

function setAllRoadsRed() {
    ROADS.forEach(road => {
        sendCommandToRoad(road, 'RED', 0, 0);
        livePhase[road] = 'RED';
        liveCountdown[road] = 0;
    });
}

function decideNextWinner() {
    latestDecision = makeSignalDecision(
        sensorData, 
        googleTraffic, 
        sensorWorking, 
        googleWorking,
        irData, 
        piezoData,
        rainDetected,
        pedStatus
    );
    
    // Add green time to decision based on IR sensors
    if (latestDecision && latestDecision.winner) {
        const winnerRoad = latestDecision.winner;
        latestDecision.greenDuration = greenTime[winnerRoad] || 5;
        latestDecision.yellowDuration = yellowTime;  // Use current yellow time (3 or 5)
    }
    
    io.emit('newDecision', latestDecision);
    console.log(`🧠 Decision: ${latestDecision.winner} gets GREEN (${latestDecision.greenDuration}s) YELLOW (${yellowTime}s) — Mode: ${latestDecision.mode}`);
    return latestDecision;
}

function runOneCycle() {
    if (forceOverride && forceOverride.active) return;

    const decision = decideNextWinner();
    const winner = decision.winner;
    const greenDuration = decision.greenDuration || greenTime[winner] || 5;
    const yellowDuration = decision.yellowDuration || yellowTime;  // Use current yellow time

    currentWinner = winner;
    currentPhase = 'GREEN';

    setAllRoadsRed();
    
    setTimeout(() => {
        sendCommandToRoad(winner, 'GREEN', greenDuration, yellowDuration);
        livePhase[winner] = 'GREEN';
        liveSignalState[winner] = 'GREEN';
        startCountdown(winner, 'GREEN', greenDuration);
        console.log(`\n🟢 [CYCLE] ${winner} GREEN for ${greenDuration}s`);
        broadcastFullState();

        phaseTimer = setTimeout(() => {
            currentPhase = 'YELLOW';
            const nextDecision = decideNextWinner();
            console.log(`🟡 [CYCLE] ${winner} YELLOW for ${yellowDuration}s — NEXT: ${nextDecision.winner}`);
            
            sendCommandToRoad(winner, 'YELLOW', 0, yellowDuration);
            livePhase[winner] = 'YELLOW';
            liveSignalState[winner] = 'YELLOW';
            startCountdown(winner, 'YELLOW', yellowDuration);
            broadcastFullState();

            phaseTimer = setTimeout(() => {
                currentPhase = 'RED';
                sendCommandToRoad(winner, 'RED', 0, 0);
                livePhase[winner] = 'RED';
                liveSignalState[winner] = 'RED';
                liveCountdown[winner] = 0;
                broadcastFullState();
                console.log(`🔴 [CYCLE] ${winner} RED — starting next cycle`);

                phaseTimer = setTimeout(() => {
                    runOneCycle();
                }, 2000);

            }, yellowDuration * 1000);

        }, greenDuration * 1000);

    }, 500);
}

let countdownIntervals = {};

function startCountdown(road, phase, seconds) {
    if (countdownIntervals[road]) clearInterval(countdownIntervals[road]);

    let remaining = seconds;
    liveCountdown[road] = remaining;

    countdownIntervals[road] = setInterval(() => {
        remaining--;
        liveCountdown[road] = Math.max(0, remaining);
        io.emit('countdown', { road, phase, remaining: liveCountdown[road] });
        if (remaining <= 0) clearInterval(countdownIntervals[road]);
    }, 1000);
}

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
        irData,
        piezoData,
        rainDetected,
        yellowTime,      // This will be 3 or 5
        pedStatus,
        greenTime,
        redTime,
        forceOverride: forceOverride 
            ? { active: forceOverride.active, road: forceOverride.road, command: forceOverride.command }
            : null
    });
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 5: FORCE OVERRIDE HANDLER
// ════════════════════════════════════════════════════════════════════════════
function applyForceOverride(road, command, duration) {
    console.log(`🚨 FORCE OVERRIDE: ${road} → ${command} for ${duration}s`);

    if (phaseTimer) clearTimeout(phaseTimer);
    Object.values(countdownIntervals).forEach(i => clearInterval(i));

    setAllRoadsRed();
    forceOverride = { road, command, duration, active: true };

    setTimeout(() => {
        sendCommandToRoad(road, command, duration, 5);
        livePhase[road] = command;
        liveSignalState[road] = command;
        startCountdown(road, command, duration);
        broadcastFullState();

        setTimeout(() => {
            console.log('✅ Force override ended — resuming normal cycle');
            forceOverride = null;
            setAllRoadsRed();
            broadcastFullState();
            setTimeout(() => runOneCycle(), 2000);
        }, duration * 1000);

    }, 500);
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 6: GOOGLE TRAFFIC REFRESH
// ════════════════════════════════════════════════════════════════════════════
async function refreshGoogleTraffic() {
    try {
        const result = await getAllTrafficConditions();
        const hasRealData = Object.values(result).some(v => v !== 'Unknown');
        googleWorking = hasRealData;
        googleTraffic = result;
        console.log(`🗺️ Google Traffic: N=${result.North} S=${result.South} E=${result.East} W=${result.West} | Working: ${googleWorking}`);
        io.emit('googleTrafficUpdate', { googleTraffic, googleWorking });
    } catch (err) {
        googleWorking = false;
        console.log('⚠️ Google Traffic unavailable — using sensor-only mode');
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
            irData,
            piezoData,
            rainDetected,
            yellowTime,
            pedStatus,
            greenTime,
            redTime
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/decision', (req, res) => {
    if (!latestDecision) return res.json({ message: 'No decision yet — system starting up' });
    res.json(latestDecision);
});

app.get('/api/sensor-data', async (req, res) => {
    try {
        const data = await UltrasonicData.find().sort({ timestamp: -1 }).limit(100);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ir-data', (req, res) => {
    res.json(irData);
});

app.get('/api/rain-status', (req, res) => {
    res.json({ rainDetected, yellowTime });
});

app.post('/api/traffic/control', (req, res) => {
    const { location, command, duration } = req.body;
    if (!ROADS.includes(location)) return res.status(400).json({ error: 'Invalid road' });
    if (!['RED', 'YELLOW', 'GREEN'].includes(command)) return res.status(400).json({ error: 'Invalid command' });

    const dur = parseInt(duration) || 30;
    applyForceOverride(location, command, dur);
    res.json({ message: `Force ${command} applied to ${location} for ${dur}s`, location, command, duration: dur });
});

app.post('/api/system/resume', (req, res) => {
    forceOverride = null;
    if (phaseTimer) clearTimeout(phaseTimer);
    setAllRoadsRed();
    setTimeout(() => runOneCycle(), 2000);
    res.json({ message: 'Normal cycle resumed' });
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'online', 
        googleWorking, 
        sensorWorking, 
        currentWinner, 
        currentPhase, 
        uptime: process.uptime(),
        rainDetected,
        yellowTime,
        irData
    });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 8: SOCKET.IO CONNECTION
// ════════════════════════════════════════════════════════════════════════════
io.on('connection', (socket) => {
    console.log('🖥️ Dashboard connected:', socket.id);
    
    socket.emit('fullState', {
        liveSignalState,
        liveCountdown,
        livePhase,
        latestDecision,
        sensorData,
        googleTraffic,
        sensorWorking,
        googleWorking,
        irData,
        piezoData,
        rainDetected,
        yellowTime,      // This will be 3 or 5
        pedStatus,
        greenTime,
        redTime
    });
    
    socket.on('disconnect', () => console.log('🖥️ Dashboard disconnected:', socket.id));
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 9: START EVERYTHING
// ════════════════════════════════════════════════════════════════════════════
mqttServer.listen(MQTT_PORT, () => console.log(`📡 MQTT Broker running on port ${MQTT_PORT}`));
httpServer.listen(PORT, () => console.log(`✅ API + Dashboard Server running on port ${PORT}`));

setTimeout(async () => {
    console.log('\n🚦 Starting HYDRA Signal Cycle Engine...');
    console.log(`📋 Configuration:`);
    console.log(`   - RED Time: ${redTime}s (Fixed)`);
    console.log(`   - YELLOW Time: ${yellowTime}s (3s normal, 5s when raining)`);
    console.log(`   - GREEN Time: 3s base + traffic bonus (Light: +3s, Heavy: +6s)`);
    await refreshGoogleTraffic();
    setInterval(refreshGoogleTraffic, 30000);
    runOneCycle();
}, 3000);

setInterval(broadcastFullState, 2000);