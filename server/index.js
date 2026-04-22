// // ═══════════════════════════════════════════════════════════════════════════
// // server/index.js — HYDRA Smart Traffic Control System (COMPLETE VERSION)
// // ═══════════════════════════════════════════════════════════════════════════

// require('dotenv').config();
// const express        = require('express');
// const cors           = require('cors');
// const mongoose       = require('mongoose');
// const aedes          = require('aedes')();
// const net            = require('net');
// const http           = require('http');
// const { Server }     = require('socket.io');

// // ── Import our modules ──────────────────────────────────────────────────────
// const TrafficData    = require('./models/TrafficData');
// const UltrasonicData = require('./models/UltrasonicData');
// const { getAllTrafficConditions } = require('./services/googleTrafficService');

// // ⚠️  IMPORTANT: Adjust this import based on how signalDecision.js exports
// // If signalDecision.js uses: module.exports = { makeSignalDecision }
// // then keep: const { makeSignalDecision } = require('./logic/signalDecision');
// // If it uses: module.exports = makeSignalDecision
// // then change to: const makeSignalDecision = require('./logic/signalDecision');
// const { makeSignalDecision } = require('./logic/signalDecision'); // <-- adjust if needed

// // ── App & Server Setup ──────────────────────────────────────────────────────
// const app        = express();
// const httpServer = http.createServer(app);

// const io = new Server(httpServer, {
//     cors: { origin: '*', methods: ['GET', 'POST'] }
// });

// const PORT      = process.env.PORT      || 5000;
// const MQTT_PORT = parseInt(process.env.MQTT_PORT) || 1883;

// app.use(cors({ origin: '*' }));
// app.use(express.json());

// // ════════════════════════════════════════════════════════════════════════════
// // SECTION 1: DATABASE CONNECTION
// // ════════════════════════════════════════════════════════════════════════════
// mongoose.connect(process.env.MONGODB_URI)
//     .then(() => console.log('✅  MongoDB Connected'))
//     .catch(err => console.error('❌  MongoDB Error:', err));

// // ════════════════════════════════════════════════════════════════════════════
// // SECTION 2: IN-MEMORY STATE
// // ════════════════════════════════════════════════════════════════════════════
// const ROADS = ['North', 'South', 'East', 'West'];

// let sensorData       = { North: 5000, South: 5000, East: 5000, West: 5000 };
// let googleTraffic    = { North: 'Unknown', South: 'Unknown', East: 'Unknown', West: 'Unknown' };
// let sensorWorking    = { North: false, South: false, East: false, West: false };
// let googleWorking    = false;
// let liveSignalState  = { North: 'RED', South: 'RED', East: 'RED', West: 'RED' };
// let liveCountdown    = { North: 0, South: 0, East: 0, West: 0 };
// let livePhase        = { North: 'RED', South: 'RED', East: 'RED', West: 'RED' };
// let latestDecision   = null;
// let forceOverride    = null;

// let currentWinner = null;
// let phaseTimer    = null;
// let currentPhase  = 'RED';

// // ════════════════════════════════════════════════════════════════════════════
// // SECTION 3: MQTT BROKER SETUP
// // ════════════════════════════════════════════════════════════════════════════
// const mqttServer = net.createServer(aedes.handle);

// aedes.on('client', (client) => {
//     console.log(`🔌  ESP32 Connected: ${client ? client.id : 'Unknown'}`);
// });

// aedes.on('clientDisconnect', (client) => {
//     console.log(`📴  ESP32 Disconnected: ${client ? client.id : 'Unknown'}`);
// });

// aedes.on('publish', async (packet, client) => {
//     if (!client) return;

//     const topic   = packet.topic;
//     const payload = packet.payload.toString();

//     // Ultrasonic data
//     if (topic.startsWith('traffic/ultrasonic/')) {
//         try {
//             const data = JSON.parse(payload);
//             const road = topic.split('/')[2];
//             if (!ROADS.includes(road)) return;

//             sensorData[road]   = data.distanceCm;
//             sensorWorking[road] = true;

//             // FIXED: Mongoose deprecation warning (new → returnDocument)
//             await UltrasonicData.findOneAndUpdate(
//                 { road },
//                 {
//                     road,
//                     distanceCm:      data.distanceCm,
//                     vehicleDetected: data.distanceCm <= 400,
//                     timestamp:       new Date()
//                 },
//                 { upsert: true, returnDocument: 'after' } // <-- changed here
//             );

//             console.log(`📡  Ultrasonic [${road}]: ${data.distanceCm < 5000 ? data.distanceCm + 'cm' : 'No vehicle'}`);
//             io.emit('sensorUpdate', { road, distanceCm: data.distanceCm, vehicleDetected: data.distanceCm <= 400 });

//         } catch (e) {
//             console.error('⚠️   Ultrasonic parse error:', e.message);
//         }
//     }

//     // LED state
//     if (topic.startsWith('traffic/state/')) {
//         try {
//             const data = JSON.parse(payload);
//             const road = topic.split('/')[2];
//             if (!ROADS.includes(road)) return;

//             liveSignalState[road] = data.state;
//             console.log(`💡  LED State [${road}]: ${data.state}`);
//             io.emit('ledStateUpdate', { road, state: data.state });

//         } catch (e) {
//             console.error('⚠️   State parse error:', e.message);
//         }
//     }
// });

// // ════════════════════════════════════════════════════════════════════════════
// // SECTION 4: SIGNAL CYCLE ENGINE
// // ════════════════════════════════════════════════════════════════════════════

// function sendCommandToRoad(road, signal, greenTime, yellowTime) {
//     const msg = JSON.stringify({
//         signal,
//         greenTime:  greenTime  || 5,
//         yellowTime: yellowTime || 5,
//         timestamp:  new Date().toISOString()
//     });

//     aedes.publish({
//         topic:   `traffic/control/${road}`,
//         payload: Buffer.from(msg),
//         qos:     1,
//         retain:  true
//     }, (err) => {
//         if (err) console.error(`❌  Failed to send to ${road}:`, err);
//         else console.log(`📤  Sent to ${road}: ${signal} (green=${greenTime}s)`);
//     });
// }

// function setAllRoadsRed() {
//     ROADS.forEach(road => {
//         sendCommandToRoad(road, 'RED', 0, 0);
//         livePhase[road]     = 'RED';
//         liveCountdown[road] = 0;
//     });
// }

// function decideNextWinner() {
//     latestDecision = makeSignalDecision(sensorData, googleTraffic, sensorWorking, googleWorking);
//     io.emit('newDecision', latestDecision);
//     console.log(`🧠  Decision: ${latestDecision.winner} gets GREEN (${latestDecision.greenDuration}s) — Mode: ${latestDecision.mode}`);
//     return latestDecision;
// }

// function runOneCycle() {
//     if (forceOverride && forceOverride.active) return;

//     const decision = decideNextWinner();
//     const winner   = decision.winner;
//     const greenTime  = decision.greenDuration;
//     const yellowTime = decision.yellowDuration;

//     currentWinner = winner;
//     currentPhase  = 'GREEN';

//     setAllRoadsRed();
//     setTimeout(() => {
//         sendCommandToRoad(winner, 'GREEN', greenTime, yellowTime);
//         livePhase[winner]    = 'GREEN';
//         liveSignalState[winner] = 'GREEN';
//         startCountdown(winner, 'GREEN', greenTime);
//         console.log(`\n🟢  [CYCLE] ${winner} GREEN for ${greenTime}s`);
//         broadcastFullState();

//         phaseTimer = setTimeout(() => {
//             currentPhase = 'YELLOW';
//             const nextDecision = decideNextWinner();
//             console.log(`🟡  [CYCLE] ${winner} YELLOW for ${yellowTime}s — NEXT: ${nextDecision.winner}`);
//             sendCommandToRoad(winner, 'YELLOW', 0, yellowTime);
//             livePhase[winner]       = 'YELLOW';
//             liveSignalState[winner] = 'YELLOW';
//             startCountdown(winner, 'YELLOW', yellowTime);
//             broadcastFullState();

//             phaseTimer = setTimeout(() => {
//                 currentPhase = 'RED';
//                 sendCommandToRoad(winner, 'RED', 0, 0);
//                 livePhase[winner]       = 'RED';
//                 liveSignalState[winner] = 'RED';
//                 liveCountdown[winner]   = 0;
//                 broadcastFullState();
//                 console.log(`🔴  [CYCLE] ${winner} RED — starting next cycle`);

//                 phaseTimer = setTimeout(() => {
//                     runOneCycle();
//                 }, 2000);

//             }, yellowTime * 1000);

//         }, greenTime * 1000);

//     }, 500);
// }

// // Countdown and broadcast functions (unchanged)
// let countdownIntervals = {};

// function startCountdown(road, phase, seconds) {
//     if (countdownIntervals[road]) clearInterval(countdownIntervals[road]);

//     let remaining = seconds;
//     liveCountdown[road] = remaining;

//     countdownIntervals[road] = setInterval(() => {
//         remaining--;
//         liveCountdown[road] = Math.max(0, remaining);
//         io.emit('countdown', { road, phase, remaining: liveCountdown[road] });
//         if (remaining <= 0) clearInterval(countdownIntervals[road]);
//     }, 1000);
// }

// function broadcastFullState() {
//     io.emit('fullState', {
//         liveSignalState,
//         liveCountdown,
//         livePhase,
//         latestDecision,
//         sensorData,
//         googleTraffic,
//         sensorWorking,
//         googleWorking,
//         forceOverride: forceOverride ? { active: forceOverride.active, road: forceOverride.road, command: forceOverride.command } : null
//     });
// }

// // ════════════════════════════════════════════════════════════════════════════
// // SECTION 5: FORCE OVERRIDE HANDLER
// // ════════════════════════════════════════════════════════════════════════════
// function applyForceOverride(road, command, duration) {
//     console.log(`🚨  FORCE OVERRIDE: ${road} → ${command} for ${duration}s`);

//     if (phaseTimer) clearTimeout(phaseTimer);
//     Object.values(countdownIntervals).forEach(i => clearInterval(i));

//     setAllRoadsRed();
//     forceOverride = { road, command, duration, active: true };

//     setTimeout(() => {
//         sendCommandToRoad(road, command, duration, 5);
//         livePhase[road]       = command;
//         liveSignalState[road] = command;
//         startCountdown(road, command, duration);
//         broadcastFullState();

//         setTimeout(() => {
//             console.log('✅  Force override ended — resuming normal cycle');
//             forceOverride = null;
//             setAllRoadsRed();
//             broadcastFullState();
//             setTimeout(() => runOneCycle(), 2000);
//         }, duration * 1000);

//     }, 500);
// }

// // ════════════════════════════════════════════════════════════════════════════
// // SECTION 6: GOOGLE TRAFFIC REFRESH
// // ════════════════════════════════════════════════════════════════════════════
// async function refreshGoogleTraffic() {
//     try {
//         const result = await getAllTrafficConditions();
//         const hasRealData = Object.values(result).some(v => v !== 'Unknown');
//         googleWorking  = hasRealData;
//         googleTraffic  = result;
//         console.log(`🗺️   Google Traffic: N=${result.North} S=${result.South} E=${result.East} W=${result.West} | Working: ${googleWorking}`);
//         io.emit('googleTrafficUpdate', { googleTraffic, googleWorking });
//     } catch (err) {
//         googleWorking = false;
//         console.log('⚠️   Google Traffic unavailable — using sensor-only mode');
//     }
// }

// // ════════════════════════════════════════════════════════════════════════════
// // SECTION 7: HTTP API ROUTES (unchanged)
// // ════════════════════════════════════════════════════════════════════════════
// app.get('/api/traffic', async (req, res) => {
//     try {
//         res.json({
//             ultrasonicReadings: sensorData,
//             googleTraffic,
//             liveSignalState,
//             liveCountdown,
//             livePhase,
//             sensorWorking,
//             googleWorking,
//             currentDecision: latestDecision
//         });
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });

// app.get('/api/decision', (req, res) => {
//     if (!latestDecision) return res.json({ message: 'No decision yet — system starting up' });
//     res.json(latestDecision);
// });

// app.get('/api/sensor-data', async (req, res) => {
//     try {
//         const data = await UltrasonicData.find().sort({ timestamp: -1 }).limit(100);
//         res.json(data);
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });

// app.post('/api/traffic/control', (req, res) => {
//     const { location, command, duration } = req.body;
//     if (!ROADS.includes(location)) return res.status(400).json({ error: 'Invalid road' });
//     if (!['RED', 'YELLOW', 'GREEN'].includes(command)) return res.status(400).json({ error: 'Invalid command' });

//     const dur = parseInt(duration) || 30;
//     applyForceOverride(location, command, dur);
//     res.json({ message: `Force ${command} applied to ${location} for ${dur}s`, location, command, duration: dur });
// });

// app.post('/api/system/resume', (req, res) => {
//     forceOverride = null;
//     if (phaseTimer) clearTimeout(phaseTimer);
//     setAllRoadsRed();
//     setTimeout(() => runOneCycle(), 2000);
//     res.json({ message: 'Normal cycle resumed' });
// });

// app.get('/api/health', (req, res) => {
//     res.json({ status: 'online', googleWorking, sensorWorking, currentWinner, currentPhase, uptime: process.uptime() });
// });

// // ════════════════════════════════════════════════════════════════════════════
// // SECTION 8: SOCKET.IO (unchanged)
// // ════════════════════════════════════════════════════════════════════════════
// io.on('connection', (socket) => {
//     console.log('🖥️   Dashboard connected:', socket.id);
//     socket.emit('fullState', {
//         liveSignalState,
//         liveCountdown,
//         livePhase,
//         latestDecision,
//         sensorData,
//         googleTraffic,
//         sensorWorking,
//         googleWorking
//     });
//     socket.on('disconnect', () => console.log('🖥️   Dashboard disconnected:', socket.id));
// });

// // ════════════════════════════════════════════════════════════════════════════
// // SECTION 9: START EVERYTHING
// // ════════════════════════════════════════════════════════════════════════════
// mqttServer.listen(MQTT_PORT, () => console.log(`📡  MQTT Broker running on port ${MQTT_PORT}`));
// httpServer.listen(PORT, () => console.log(`✅  API + Dashboard Server running on port ${PORT}`));

// setTimeout(async () => {
//     console.log('\n🚦  Starting HYDRA Signal Cycle Engine...');
//     await refreshGoogleTraffic();
//     setInterval(refreshGoogleTraffic, 30000);
//     runOneCycle();
// }, 3000);

// setInterval(broadcastFullState, 2000);


// ═══════════════════════════════════════════════════════════════════════════
// server/index.js — HYDRA Smart Traffic Control System (COMPLETE VERSION)
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

// ── In-memory state additions ──────────────────────────────────────────────
let irData       = { North: { ir1: false, ir2: false, queueLevel: 'None' },
                     South: { ir1: false, ir2: false, queueLevel: 'None' },
                     East:  { ir1: false, ir2: false, queueLevel: 'None' },
                     West:  { ir1: false, ir2: false, queueLevel: 'None' } };
let piezoData    = { North: false, South: false, East: false, West: false };
let rainDetected = false;
let yellowTime   = 5;
let pedStatus    = { North: { requested: false, crossing: false, duration: 0 },
                     South: { requested: false, crossing: false, duration: 0 },
                     East:  { requested: false, crossing: false, duration: 0 },
                     West:  { requested: false, crossing: false, duration: 0 } };

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

    // ── Ultrasonic ──────────────────────────────────────────────────────────
    if (topic.startsWith('traffic/ultrasonic/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            sensorData[road]    = data.distanceCm;
            sensorWorking[road] = true;
            await UltrasonicData.findOneAndUpdate(
                { road },
                { road, distanceCm: data.distanceCm, vehicleDetected: data.distanceCm <= 400, timestamp: new Date() },
                { upsert: true, returnDocument: 'after' }
            );
            io.emit('sensorUpdate', { road, distanceCm: data.distanceCm });
        } catch (e) { console.error('Ultrasonic parse error:', e.message); }
    }

    // ── IR Sensors ──────────────────────────────────────────────────────────
    if (topic.startsWith('traffic/ir/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            irData[road] = { ir1: data.ir1Blocked, ir2: data.ir2Blocked, queueLevel: data.queueLevel };
            console.log(`🔦 IR [${road}]: ${data.queueLevel}`);
            io.emit('irUpdate', { road, ...irData[road] });
        } catch (e) { console.error('IR parse error:', e.message); }
    }

    // ── Piezo ───────────────────────────────────────────────────────────────
    if (topic.startsWith('traffic/piezo/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            piezoData[road] = data.heavyVehicle;
            if (data.heavyVehicle) console.log(`🚛 Heavy vehicle on ${road}!`);
            io.emit('piezoUpdate', { road, heavyVehicle: data.heavyVehicle });
        } catch (e) { console.error('Piezo parse error:', e.message); }
    }

    // ── Rain Sensor ─────────────────────────────────────────────────────────
    if (topic.startsWith('traffic/rain/')) {
        try {
            const data = JSON.parse(payload);
            rainDetected = data.rainDetected;
            yellowTime   = rainDetected ? 7 : 5;
            if (rainDetected) console.log('🌧️ RAIN — yellow extended to 7s');
            io.emit('rainUpdate', { rainDetected, yellowTime });
        } catch (e) { console.error('Rain parse error:', e.message); }
    }

    // ── Pedestrian ──────────────────────────────────────────────────────────
    if (topic.startsWith('traffic/pedestrian/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            if (data.requested !== undefined) pedStatus[road].requested = data.requested;
            if (data.crossing  !== undefined) {
                pedStatus[road].crossing = data.crossing;
                pedStatus[road].duration = data.duration || 10;
            }
            console.log(`🚶 Pedestrian [${road}]: requested=${pedStatus[road].requested} crossing=${pedStatus[road].crossing}`);
            io.emit('pedestrianUpdate', { road, ...pedStatus[road] });
        } catch (e) { console.error('Pedestrian parse error:', e.message); }
    }

    // ── LED State ───────────────────────────────────────────────────────────
    if (topic.startsWith('traffic/state/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            if (!ROADS.includes(road)) return;
            liveSignalState[road] = data.state;
            livePhase[road]       = data.state;
            io.emit('ledStateUpdate', { road, state: data.state });
        } catch (e) { console.error('State parse error:', e.message); }
    }
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 4: SIGNAL CYCLE ENGINE
// ════════════════════════════════════════════════════════════════════════════

function sendCommandToRoad(road, signal, greenTime, yellowTimeOverride) {
    const yt = yellowTimeOverride || yellowTime;
    const msg = JSON.stringify({
        signal,
        greenTime:  greenTime || 5,
        yellowTime: yt,
        timestamp:  new Date().toISOString()
    });
    aedes.publish({
        topic:   `traffic/control/${road}`,
        payload: Buffer.from(msg),
        qos: 1, retain: true
    }, (err) => {
        if (err) console.error(`❌ Failed to send to ${road}:`, err);
        else console.log(`📤 Sent ${road}: ${signal} green=${greenTime}s yellow=${yt}s`);
    });
}

function setAllRoadsRed() {
    ROADS.forEach(road => {
        sendCommandToRoad(road, 'RED', 0, 0);
        livePhase[road]     = 'RED';
        liveCountdown[road] = 0;
    });
}

function decideNextWinner() {
    latestDecision = makeSignalDecision(
        sensorData, googleTraffic, sensorWorking, googleWorking,
        irData, piezoData
    );
    io.emit('newDecision', latestDecision);
    console.log(`🧠 Decision: ${latestDecision.winner} → GREEN (${latestDecision.greenDuration}s) Mode: ${latestDecision.mode}`);
    return latestDecision;
}

function runOneCycle() {
    if (forceOverride && forceOverride.active) return;

    const decision = decideNextWinner();
    const winner   = decision.winner;
    const greenTime  = decision.greenDuration;
    const yellowTime = decision.yellowDuration;

    currentWinner = winner;
    currentPhase  = 'GREEN';

    setAllRoadsRed();
    setTimeout(() => {
        sendCommandToRoad(winner, 'GREEN', greenTime, yellowTime);
        livePhase[winner]    = 'GREEN';
        liveSignalState[winner] = 'GREEN';
        startCountdown(winner, 'GREEN', greenTime);
        console.log(`\n🟢  [CYCLE] ${winner} GREEN for ${greenTime}s`);
        broadcastFullState();

        phaseTimer = setTimeout(() => {
            currentPhase = 'YELLOW';
            const nextDecision = decideNextWinner();
            console.log(`🟡  [CYCLE] ${winner} YELLOW for ${yellowTime}s — NEXT: ${nextDecision.winner}`);
            sendCommandToRoad(winner, 'YELLOW', 0, yellowTime);
            livePhase[winner]       = 'YELLOW';
            liveSignalState[winner] = 'YELLOW';
            startCountdown(winner, 'YELLOW', yellowTime);
            broadcastFullState();

            phaseTimer = setTimeout(() => {
                currentPhase = 'RED';
                sendCommandToRoad(winner, 'RED', 0, 0);
                livePhase[winner]       = 'RED';
                liveSignalState[winner] = 'RED';
                liveCountdown[winner]   = 0;
                broadcastFullState();
                console.log(`🔴  [CYCLE] ${winner} RED — starting next cycle`);

                phaseTimer = setTimeout(() => {
                    runOneCycle();
                }, 2000);

            }, yellowTime * 1000);

        }, greenTime * 1000);

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
        liveSignalState, liveCountdown, livePhase,
        latestDecision,  sensorData,    googleTraffic,
        sensorWorking,   googleWorking,
        irData, piezoData, rainDetected, yellowTime, pedStatus,
        forceOverride: forceOverride
            ? { active: forceOverride.active, road: forceOverride.road, command: forceOverride.command }
            : null
    });
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 5: FORCE OVERRIDE HANDLER
// ════════════════════════════════════════════════════════════════════════════
function applyForceOverride(road, command, duration) {
    console.log(`🚨  FORCE OVERRIDE: ${road} → ${command} for ${duration}s`);

    if (phaseTimer) clearTimeout(phaseTimer);
    Object.values(countdownIntervals).forEach(i => clearInterval(i));

    setAllRoadsRed();
    forceOverride = { road, command, duration, active: true };

    setTimeout(() => {
        sendCommandToRoad(road, command, duration, 5);
        livePhase[road]       = command;
        liveSignalState[road] = command;
        startCountdown(road, command, duration);
        broadcastFullState();

        setTimeout(() => {
            console.log('✅  Force override ended — resuming normal cycle');
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
    res.json({ status: 'online', googleWorking, sensorWorking, currentWinner, currentPhase, uptime: process.uptime() });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 8: SOCKET.IO
// ════════════════════════════════════════════════════════════════════════════
io.on('connection', (socket) => {
    console.log('🖥️   Dashboard connected:', socket.id);
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
        pedStatus
    });
    socket.on('disconnect', () => console.log('🖥️   Dashboard disconnected:', socket.id));
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 9: REACT ROUTING (CATCH-ALL) - MUST BE LAST
// ════════════════════════════════════════════════════════════════════════════
// FIXED: Changed from '*' to '/*' to avoid path-to-regexp error
app.get('/*', (req, res) => {
    // Only serve index.html for non-API routes
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
    } else {
        res.status(404).json({ error: 'API endpoint not found' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 10: START EVERYTHING
// ════════════════════════════════════════════════════════════════════════════
mqttServer.listen(MQTT_PORT, () => console.log(`📡  MQTT Broker running on port ${MQTT_PORT}`));
httpServer.listen(PORT, () => console.log(`✅  API + Dashboard Server running on port ${PORT}`));

setTimeout(async () => {
    console.log('\n🚦  Starting HYDRA Signal Cycle Engine...');
    await refreshGoogleTraffic();
    setInterval(refreshGoogleTraffic, 30000);
    runOneCycle();
}, 3000);

setInterval(broadcastFullState, 2000);