// server/index.js  — FULLY UPDATED VERSION
require('dotenv').config();  // Must be FIRST line — loads .env file
const express     = require('express');
const cors        = require('cors');
const mongoose    = require('mongoose');
const aedes       = require('aedes')();
const net         = require('net');
const TrafficData     = require('./models/TrafficData');
const UltrasonicData  = require('./models/UltrasonicData');
const { getAllTrafficConditions } = require('./services/googleTrafficService');
const { makeSignalDecision }      = require('./logic/signalDecision');

const app         = express();
const PORT        = process.env.PORT  || 5000;
const MQTT_PORT   = parseInt(process.env.MQTT_PORT) || 1883;

app.use(cors());
app.use(express.json());

// ── 1. Connect to MongoDB ──────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅  MongoDB Connected'))
    .catch(err => console.error('❌  MongoDB Error:', err));

// ── 2. In-memory store for latest sensor readings ──────────────
// This is updated every time an ESP32 publishes data via MQTT
let latestSensorData  = { North: 5000, South: 5000, East: 5000, West: 5000 };
let latestTrafficData = { North: 'Unknown', South: 'Unknown', East: 'Unknown', West: 'Unknown' };
let latestDecision    = null;

// ── 3. MQTT Broker — receives data from ESP32 sensors ──────────
const mqttServer = net.createServer(aedes.handle);

aedes.on('client', (client) => {
    console.log(`🔌  ESP32 Connected: ${client ? client.id : 'Unknown'}`);
});

aedes.on('publish', async (packet, client) => {
    if (!client) return;  // Ignore broker's own messages

    const topic   = packet.topic;
    const payload = packet.payload.toString();

    // ── ULTRASONIC DATA from ESP32 ──
    // Topic format: traffic/ultrasonic/North  (or South, East, West)
    if (topic.startsWith('traffic/ultrasonic/')) {
        try {
            const data = JSON.parse(payload);
            const road = topic.split('/')[2];  // Extract "North" from topic

            // Update in-memory store
            latestSensorData[road] = data.distanceCm;

            // Save to MongoDB
            await UltrasonicData.findOneAndUpdate(
                { road: road },
                { road: road, distanceCm: data.distanceCm, vehicleDetected: data.distanceCm <= 400, timestamp: new Date() },
                { upsert: true, new: true }
            );
            console.log(`📡  Ultrasonic [${road}]: ${data.distanceCm}cm`);

            // Recalculate signal decision every time we get new sensor data
            latestDecision = makeSignalDecision(latestSensorData, latestTrafficData);

            // Publish the decision back to all ESP32 nodes
            publishDecision(latestDecision);

        } catch (e) {
            console.error('⚠️  Failed to parse ultrasonic data:', e.message);
        }
    }
});

// ── 4. Publish signal decision to all ESP32s ──────────────────
function publishDecision(decision) {
    const roads = ['North', 'South', 'East', 'West'];
    roads.forEach(road => {
        const cmd = decision.commands[road];
        const msg = JSON.stringify({
            signal: cmd.signal,
            greenTime: cmd.greenTime,
            yellowTime: decision.yellowDuration,
            timestamp: decision.timestamp
        });
        aedes.publish({
            topic: `traffic/control/${road}`,
            payload: Buffer.from(msg),
            qos: 1,
            retain: true  // ESP32 gets latest command when it reconnects
        }, () => {});
    });
}

// ── 5. Google Traffic Refresh — every 30 seconds ──────────────
async function refreshGoogleTraffic() {
    try {
        console.log('🗺️   Fetching Google traffic data...');
        latestTrafficData = await getAllTrafficConditions();
        console.log('✅  Traffic:', latestTrafficData);

        // Recalculate with fresh traffic data
        if (latestDecision) {
            latestDecision = makeSignalDecision(latestSensorData, latestTrafficData);
            publishDecision(latestDecision);
        }
    } catch (err) {
        console.error('❌  Google Traffic Error:', err.message);
    }
}

// Fetch immediately on startup, then every 30 seconds
refreshGoogleTraffic();
setInterval(refreshGoogleTraffic, 30000);

// ── 6. HTTP API Routes for the React Dashboard ─────────────────

// GET /api/sensor-data → latest ultrasonic readings
app.get('/api/sensor-data', async (req, res) => {
    try {
        const data = await UltrasonicData.find().sort({ road: 1 });
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/traffic → all traffic data (sensor + Google)
app.get('/api/traffic', async (req, res) => {
    try {
        const sensorHistory = await TrafficData.find().sort({ timestamp: -1 }).limit(20);
        res.json({
            sensorHistory,
            googleTraffic: latestTrafficData,
            ultrasonicReadings: latestSensorData,
            currentDecision: latestDecision
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/decision → current signal decision
app.get('/api/decision', (req, res) => {
    if (!latestDecision) {
        return res.json({ message: 'No decision made yet — waiting for sensor data' });
    }
    res.json(latestDecision);
});

// POST /api/traffic/control → manual override from dashboard
app.post('/api/traffic/control', (req, res) => {
    const { location, command } = req.body;
    const topic = `traffic/control/${location}`;
    const msg = JSON.stringify({ signal: command, greenTime: 30, yellowTime: 3, timestamp: new Date().toISOString(), override: true });
    aedes.publish({ topic, payload: Buffer.from(msg), qos: 1, retain: true }, (err) => {
        if (err) return res.status(500).json({ error: 'Failed to send command' });
        console.log(`🛑  Manual Override: ${location} → ${command}`);
        res.json({ message: 'Command sent successfully' });
    });
});

// ── 7. Start Servers ──────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅  API Server running on port ${PORT}`);
});

mqttServer.listen(MQTT_PORT, () => {
    console.log(`📡  MQTT Broker running on port ${MQTT_PORT}`);
});


