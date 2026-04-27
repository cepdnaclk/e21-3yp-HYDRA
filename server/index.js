// ═══════════════════════════════════════════════════════════════════════════
// server/index.js — HYDRA Smart Traffic Control System
// UPDATED: Matches ESP32 pedestrian and piezo logic from working reference
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
const { getAllTrafficConditions } = require('./services/googleTrafficService');
const { makeSignalDecision, PED_CROSS_TIME } = require('./logic/signalDecision');

const app        = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
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

let irData = {
    North: { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' },
    South: { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' },
    East:  { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' },
    West:  { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' }
};

let piezoData = { North: false, South: false, East: false, West: false };

// Rain Sensor Data - affects YELLOW duration (3s dry, 5s wet)
let rainDetected = false;
let yellowTime = 3;

// Pedestrian Status - matches ESP32 states
// - requested: button pressed, waiting for crossing
// - crossing: actively crossing (PED_GREEN on)
// - duration: remaining crossing time
let pedStatus = {
    North: { requested: false, crossing: false, duration: 0 },
    South: { requested: false, crossing: false, duration: 0 },
    East:  { requested: false, crossing: false, duration: 0 },
    West:  { requested: false, crossing: false, duration: 0 }
};

let greenTime = { North: 3, South: 3, East: 3, West: 3 };
let redTime = 3; // Will be updated each cycle dynamically

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

    // ── IR Sensors Data ──────────────────────────────────────────────────────
    if (topic.startsWith('traffic/ir/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            
            irData[road] = {
                ir1Blocked: data.ir1Blocked || false,
                ir2Blocked: data.ir2Blocked || false,
                queueLevel: data.queueLevel || 'None'
            };
            
            let trafficDensity = 'None';
            if (data.ir1Blocked && data.ir2Blocked) {
                trafficDensity = 'Heavy';
                greenTime[road] = 9;
            } else if (data.ir1Blocked || data.ir2Blocked) {
                trafficDensity = 'Light';
                greenTime[road] = 6;
            } else {
                trafficDensity = 'None';
                greenTime[road] = 3;
            }
            
            console.log(`🔦 IR [${road}]: ${data.ir1Blocked ? 'BLOCKED' : 'CLEAR'} | ${data.ir2Blocked ? 'BLOCKED' : 'CLEAR'} → ${trafficDensity} Traffic`);
            io.emit('irUpdate', { road, ir1Blocked: data.ir1Blocked, ir2Blocked: data.ir2Blocked, queueLevel: trafficDensity });
            
        } catch (e) { 
            console.error('⚠️ IR parse error:', e.message); 
        }
    }

    // ── Piezo Sensor Data (matches ESP32: extendNextGreen) ────────────────────
    if (topic.startsWith('traffic/piezo/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            
            // Store piezo state - will affect next GREEN cycle
            piezoData[road] = data.heavyVehicle || false;
            if (data.heavyVehicle) {
                console.log(`🚛 Heavy vehicle detected on ${road}! Next GREEN extended by 5 seconds`);
            }
            io.emit('piezoUpdate', { road, heavyVehicle: data.heavyVehicle });
            
        } catch (e) { 
            console.error('⚠️ Piezo parse error:', e.message); 
        }
    }

    // ── Rain Sensor Data ─────────────────────────────────────────────────────
    if (topic.startsWith('traffic/rain/')) {
        try {
            const data = JSON.parse(payload);
            rainDetected = data.rainDetected || false;
            yellowTime = rainDetected ? 5 : 3;
            
            console.log(`🌧️ Rain Sensor: ${rainDetected ? 'RAINING (Yellow: 5s)' : 'DRY (Yellow: 3s)'}`);
            io.emit('rainUpdate', { rainDetected, yellowTime });
            
        } catch (e) { 
            console.error('⚠️ Rain parse error:', e.message); 
        }
    }

    // ── Pedestrian Data (matches ESP32 states) ───────────────────────────────
    if (topic.startsWith('traffic/pedestrian/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            
            // Update pedestrian state based on ESP32 messages
            if (data.requested !== undefined) {
                pedStatus[road].requested = data.requested;
                if (data.requested) {
                    console.log(`🚶 Pedestrian [${road}]: BUTTON PRESSED - WAITING`);
                }
            }
            if (data.crossing !== undefined) {
                pedStatus[road].crossing = data.crossing;
                pedStatus[road].duration = data.duration || PED_CROSS_TIME;
                if (data.crossing) {
                    console.log(`🚶 Pedestrian [${road}]: CROSSING (${pedStatus[road].duration}s)`);
                } else if (!data.crossing && pedStatus[road].requested === false) {
                    console.log(`✅ Pedestrian [${road}]: Crossing FINISHED`);
                }
            }
            
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

// Send command to a road via MQTT
function sendCommandToRoad(road, signal, greenDuration, yellowOverride, dynamicRedTime) {
    const yt = (yellowOverride !== undefined && yellowOverride > 0) ? yellowOverride : yellowTime;
    const rt = (dynamicRedTime !== undefined && dynamicRedTime > 0) ? dynamicRedTime : 0;

    const msg = JSON.stringify({
        signal,
        greenTime:  greenDuration || 5,
        yellowTime: yt,
        redTime:    rt,
        timestamp:  new Date().toISOString()
    });
    
    aedes.publish({
        topic:   `traffic/control/${road}`,
        payload: Buffer.from(msg),
        qos:     1,
        retain:  true
    }, (err) => {
        if (err) console.error(`❌ Failed to send to ${road}:`, err);
        else console.log(`📤 Sent to ${road}: ${signal} (green=${greenDuration}s, yellow=${yt}s, red=${rt}s)`);
    });
}

// Set all roads to RED with dynamic red time
function setAllRoadsRed(dynamicRedTime) {
    const rt = dynamicRedTime || 0;
    ROADS.forEach(road => {
        sendCommandToRoad(road, 'RED', 0, 0, rt);
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
    
    if (latestDecision && latestDecision.winner) {
        latestDecision.greenDuration  = latestDecision.greenDuration  || 5;
        latestDecision.yellowDuration = latestDecision.yellowDuration || yellowTime;
        // redForOthers = winner's green + yellow (dynamic RED for non-priority roads)
        latestDecision.redForOthers = latestDecision.greenDuration + latestDecision.yellowDuration;
    }
    
    io.emit('newDecision', latestDecision);
    console.log(`🧠 Decision: ${latestDecision.winner} gets GREEN (${latestDecision.greenDuration}s) ` +
                `YELLOW (${latestDecision.yellowDuration}s) — ` +
                `Others RED (${latestDecision.redForOthers}s) — Mode: ${latestDecision.mode}`);
    return latestDecision;
}

// Main cycle engine
function runOneCycle() {
    if (forceOverride && forceOverride.active) return;

    const decision       = decideNextWinner();
    const winner         = decision.winner;
    const greenDuration  = decision.greenDuration  || greenTime[winner] || 5;
    const yellowDuration = decision.yellowDuration || yellowTime;

    // Dynamic RED time = winner's GREEN + YELLOW
    const dynamicRedTime = greenDuration + yellowDuration;
    redTime = dynamicRedTime;

    currentWinner = winner;
    currentPhase  = 'GREEN';

    console.log(`\n🟢 [CYCLE START] ${winner} wins!`);
    console.log(`   GREEN: ${greenDuration}s | YELLOW: ${yellowDuration}s | Others RED: ${dynamicRedTime}s`);

    // Step 1: Send RED to all roads (including winner initially)
    ROADS.forEach(road => {
        sendCommandToRoad(road, 'RED', 0, 0, dynamicRedTime);
        livePhase[road] = 'RED';
        liveSignalState[road] = 'RED';
        startCountdown(road, 'RED', dynamicRedTime);
    });

    // Step 2: After 500ms, give GREEN to winner
    setTimeout(() => {
        // Check if pedestrian is crossing on winner road - if yes, don't give GREEN
        if (pedStatus[winner] && pedStatus[winner].crossing) {
            console.log(`🚶 ${winner} is in pedestrian crossing state - delaying GREEN`);
            // Reschedule after crossing completes
            setTimeout(() => {
                if (!forceOverride || !forceOverride.active) {
                    sendCommandToRoad(winner, 'GREEN', greenDuration, yellowDuration, 0);
                    livePhase[winner] = 'GREEN';
                    liveSignalState[winner] = 'GREEN';
                    startCountdown(winner, 'GREEN', greenDuration);
                    broadcastFullState();
                }
            }, 2000);
            return;
        }

        sendCommandToRoad(winner, 'GREEN', greenDuration, yellowDuration, 0);
        livePhase[winner] = 'GREEN';
        liveSignalState[winner] = 'GREEN';
        startCountdown(winner, 'GREEN', greenDuration);
        broadcastFullState();

        // Step 3: After green ends, switch winner to YELLOW
        phaseTimer = setTimeout(() => {
            currentPhase = 'YELLOW';

            sendCommandToRoad(winner, 'YELLOW', 0, yellowDuration, 0);
            livePhase[winner] = 'YELLOW';
            liveSignalState[winner] = 'YELLOW';
            startCountdown(winner, 'YELLOW', yellowDuration);
            broadcastFullState();

            console.log(`🟡 [CYCLE] ${winner} YELLOW for ${yellowDuration}s`);

            // Step 4: After yellow ends, check if pedestrian is waiting
            phaseTimer = setTimeout(() => {
                // Check if pedestrian requested crossing on winner road
                if (pedStatus[winner] && pedStatus[winner].requested) {
                    console.log(`🚶 ${winner} has pedestrian waiting - will cross after YELLOW`);
                    // ESP32 will handle the crossing automatically
                }

                currentPhase = 'RED';
                sendCommandToRoad(winner, 'RED', 0, 0, 0);
                livePhase[winner] = 'RED';
                liveSignalState[winner] = 'RED';
                liveCountdown[winner] = 0;
                broadcastFullState();

                console.log(`🔴 [CYCLE] ${winner} RED - 2s inter-cycle pause`);

                // Step 5: Inter-cycle 2s pause, then start next cycle
                phaseTimer = setTimeout(() => {
                    runOneCycle();
                }, 2000);

            }, yellowDuration * 1000);

        }, greenDuration * 1000);

    }, 500);
}

// Countdown helper
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

// Broadcast full state to all dashboard clients
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
        yellowTime,
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

    const overrideRedTime = command === 'GREEN' ? (duration + yellowTime) : duration;

    ROADS.forEach(r => {
        if (r !== road) {
            sendCommandToRoad(r, 'RED', 0, 0, overrideRedTime);
            livePhase[r] = 'RED';
            liveSignalState[r] = 'RED';
            startCountdown(r, 'RED', overrideRedTime);
        }
    });

    forceOverride = { road, command, duration, active: true };

    setTimeout(() => {
        sendCommandToRoad(road, command, duration, yellowTime, 0);
        livePhase[road] = command;
        liveSignalState[road] = command;
        startCountdown(road, command, duration);
        broadcastFullState();

        setTimeout(() => {
            console.log('✅ Force override ended — resuming normal cycle');
            forceOverride = null;

            ROADS.forEach(r => {
                sendCommandToRoad(r, 'RED', 0, 0, 0);
                livePhase[r] = 'RED';
                liveSignalState[r] = 'RED';
                liveCountdown[r] = 0;
            });

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
            redTime,
            note: 'redTime is dynamic: equals winner greenTime + yellowTime each cycle'
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
    if (!ROADS.includes(location))              return res.status(400).json({ error: 'Invalid road' });
    if (!['RED', 'YELLOW', 'GREEN'].includes(command)) return res.status(400).json({ error: 'Invalid command' });

    const dur = parseInt(duration) || 30;
    applyForceOverride(location, command, dur);
    res.json({
        message:  `Force ${command} applied to ${location} for ${dur}s`,
        location, command, duration: dur,
        othersRedFor: command === 'GREEN' ? dur + yellowTime : dur
    });
});

app.post('/api/system/resume', (req, res) => {
    forceOverride = null;
    if (phaseTimer) clearTimeout(phaseTimer);
    ROADS.forEach(r => {
        sendCommandToRoad(r, 'RED', 0, 0, 0);
        livePhase[r] = 'RED';
        liveSignalState[r] = 'RED';
        liveCountdown[r] = 0;
    });
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
        currentRedTime: redTime,
        redTimeNote: 'Dynamic: winner greenTime + yellowTime',
        pedestrianStatus: pedStatus,
        piezoStatus: piezoData,
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
        yellowTime,
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
    console.log(`   - RED Time: DYNAMIC (= winner's GREEN + YELLOW each cycle)`);
    console.log(`   - YELLOW Time: ${yellowTime}s (3s dry, 5s rain)`);
    console.log(`   - GREEN Time: 3s base + traffic bonus (Light: +3s → 6s, Heavy: +6s → 9s)`);
    console.log(`   - PIEZO: Heavy vehicle detection → next GREEN +5s`);
    console.log(`   - PEDESTRIAN: Button press → priority boost, crossing → RED forced`);
    console.log(`   - Example: winner GREEN=9s + YELLOW=5s → others RED=14s`);
    await refreshGoogleTraffic();
    setInterval(refreshGoogleTraffic, 30000);
    runOneCycle();
}, 3000);

setInterval(broadcastFullState, 2000);