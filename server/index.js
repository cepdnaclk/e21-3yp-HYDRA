// server/index.js — FULLY FIXED VERSION
// ─────────────────────────────────────────────────────────────
// Changes from original:
//   1. Added liveSignalState tracker
//   2. Listens to traffic/state/# topic from ESP32
//   3. liveSignalState included in /api/traffic response
//   4. Added lastPublishedWinner to stop spamming GREEN every 500ms
// ─────────────────────────────────────────────────────────────
require('dotenv').config();
const express         = require('express');
const cors            = require('cors');
const mongoose        = require('mongoose');
const aedes           = require('aedes')();
const net             = require('net');
const TrafficData     = require('./models/TrafficData');
const UltrasonicData  = require('./models/UltrasonicData');
const { getAllTrafficConditions } = require('./services/googleTrafficService');
const { makeSignalDecision }      = require('./logic/signalDecision');

const app       = express();
const PORT      = process.env.PORT      || 5000;
const MQTT_PORT = parseInt(process.env.MQTT_PORT) || 1883;

app.use(cors({ origin: '*' }));
app.use(express.json());

// ── 1. Connect to MongoDB ──────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅  MongoDB Connected'))
    .catch(err => console.error('❌  MongoDB Error:', err));

// ── 2. In-memory state stores ──────────────────────────────────
let latestSensorData  = { North: 5000, South: 5000, East: 5000, West: 5000 };
let latestTrafficData = { North: 'Unknown', South: 'Unknown', East: 'Unknown', West: 'Unknown' };
let latestDecision    = null;
let lastPublishedWinner = null;  // prevents spamming GREEN every 500ms

// NEW: tracks the REAL current light colour from each ESP32
// Updated when ESP32 sends traffic/state/North etc.
let liveSignalState   = { North: 'RED', South: 'RED', East: 'RED', West: 'RED' };

// ── 3. MQTT Broker ─────────────────────────────────────────────
const mqttServer = net.createServer(aedes.handle);

aedes.on('client', (client) => {
    console.log(`🔌  ESP32 Connected: ${client ? client.id : 'Unknown'}`);
});

aedes.on('publish', async (packet, client) => {
    if (!client) return;

    const topic   = packet.topic;
    const payload = packet.payload.toString();

    // ── ULTRASONIC SENSOR DATA from ESP32 ──────────────────────
    // Topic: traffic/ultrasonic/North
    if (topic.startsWith('traffic/ultrasonic/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];

            latestSensorData[road] = data.distanceCm;

            await UltrasonicData.findOneAndUpdate(
                { road },
                { road, distanceCm: data.distanceCm, vehicleDetected: data.distanceCm <= 400, timestamp: new Date() },
                { upsert: true, new: true }
            );
            console.log(`📡  Ultrasonic [${road}]: ${data.distanceCm}cm`);

            // Recalculate decision
            latestDecision = makeSignalDecision(latestSensorData, latestTrafficData);

            // Only publish if winner CHANGED — stops GREEN spam every 500ms
            if (lastPublishedWinner !== latestDecision.winner) {
                lastPublishedWinner = latestDecision.winner;
                publishDecision(latestDecision);
                console.log(`🚦  Decision changed → ${latestDecision.winner} gets GREEN`);
            }

        } catch (e) {
            console.error('⚠️  Failed to parse ultrasonic data:', e.message);
        }
    }

    // ── LIVE LIGHT STATE from ESP32 ────────────────────────────
    // Topic: traffic/state/North
    // ESP32 sends this when light changes GREEN / YELLOW / RED
    // Dashboard reads this to show correct real-time colour
    if (topic.startsWith('traffic/state/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];
            liveSignalState[road] = data.state;
            console.log(`💡  Live state [${road}]: ${data.state}`);
        } catch (e) {
            console.error('⚠️  Failed to parse state update:', e.message);
        }
    }
});

// ── 4. Publish signal decision to all ESP32s ───────────────────
function publishDecision(decision) {
    const roads = ['North', 'South', 'East', 'West'];
    roads.forEach(road => {
        const cmd = decision.commands[road];
        const msg = JSON.stringify({
            signal:     cmd.signal,
            greenTime:  cmd.greenTime,
            yellowTime: decision.yellowDuration,
            timestamp:  decision.timestamp
        });
        aedes.publish({
            topic:   `traffic/control/${road}`,
            payload: Buffer.from(msg),
            qos:     1,
            retain:  true
        }, () => {});
    });
}

// ── 5. Google Traffic Refresh every 30 seconds ────────────────
async function refreshGoogleTraffic() {
    try {
        console.log('🗺️   Fetching Google traffic data...');
        latestTrafficData = await getAllTrafficConditions();
        console.log('✅  Traffic:', latestTrafficData);

        if (latestDecision) {
            const newDecision = makeSignalDecision(latestSensorData, latestTrafficData);
            if (lastPublishedWinner !== newDecision.winner) {
                lastPublishedWinner = newDecision.winner;
                latestDecision = newDecision;
                publishDecision(latestDecision);
            } else {
                latestDecision = newDecision;
            }
        }
    } catch (err) {
        console.error('❌  Google Traffic Error:', err.message);
    }
}

refreshGoogleTraffic();
setInterval(refreshGoogleTraffic, 30000);

// ── 6. HTTP API Routes ─────────────────────────────────────────

// GET /api/sensor-data
app.get('/api/sensor-data', async (req, res) => {
    try {
        const data = await UltrasonicData.find().sort({ road: 1 });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/traffic
// NOW includes liveSignalState so dashboard shows correct colours
app.get('/api/traffic', async (req, res) => {
    try {
        const sensorHistory = await TrafficData.find().sort({ timestamp: -1 }).limit(20);
        res.json({
            sensorHistory,
            googleTraffic:      latestTrafficData,
            ultrasonicReadings: latestSensorData,
            currentDecision:    latestDecision,
            liveSignalState:    liveSignalState   // NEW — real light colours
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/decision
app.get('/api/decision', (req, res) => {
    if (!latestDecision) {
        return res.json({ message: 'No decision made yet — waiting for sensor data' });
    }
    res.json(latestDecision);
});

// GET /api/live-state — NEW endpoint to check live colours directly
app.get('/api/live-state', (req, res) => {
    res.json(liveSignalState);
});

// POST /api/traffic/control — manual override
app.post('/api/traffic/control', (req, res) => {
    const { location, command } = req.body;
    const topic = `traffic/control/${location}`;
    const msg = JSON.stringify({
        signal:    command,
        greenTime: 30,
        yellowTime: 3,
        timestamp: new Date().toISOString(),
        override:  true
    });
    aedes.publish({ topic, payload: Buffer.from(msg), qos: 1, retain: true }, (err) => {
        if (err) return res.status(500).json({ error: 'Failed to send command' });
        console.log(`🛑  Manual Override: ${location} → ${command}`);
        res.json({ message: 'Command sent successfully' });
    });
});

// ── 7. Start Servers ───────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅  API Server running on port ${PORT}`);
});

mqttServer.listen(MQTT_PORT, () => {
    console.log(`📡  MQTT Broker running on port ${MQTT_PORT}`);
});