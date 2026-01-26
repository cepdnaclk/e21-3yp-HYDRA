const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const aedes = require('aedes')();
const net = require('net');
const TrafficData = require('./models/TrafficData');

const app = express();
const PORT = 5000;
const MQTT_PORT = 1883; // Standard port for IoT devices

// Middleware
app.use(cors());
app.use(express.json());

// 1. Connect to MongoDB
mongoose.connect('mongodb://127.0.0.1:27017/hydra_db')
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ MongoDB Error:', err));

// 2. HTTP Routes (For Frontend Dashboard)
app.get('/api/traffic', async (req, res) => {
    try {
        const data = await TrafficData.find().sort({ timestamp: -1 });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. MQTT BROKER LOGIC (The "Nervous System")
const mqttServer = net.createServer(aedes.handle);

// Notify when a sensor/traffic light connects
aedes.on('client', (client) => {
    console.log(`🔌 New Device Connected: ${client ? client.id : 'Unknown'}`);
});

// Listen for incoming data from the IoT devices
aedes.on('publish', async (packet, client) => {
    if (client) {
        const topic = packet.topic;
        const payload = packet.payload.toString();
        console.log(`📩 Topic [${topic}]: ${payload}`);

        // Automatically save data from sensors to the Database
        if (topic.startsWith('traffic/data')) {
            try {
                const parsedData = JSON.parse(payload);
                
                // This updates the existing location or creates a new one
                await TrafficData.findOneAndUpdate(
                    { location: parsedData.location },
                    parsedData,
                    { upsert: true, new: true }
                );
                console.log("💾 Traffic Data Auto-Saved to DB");
            } catch (e) {
                console.log("⚠️ Received non-JSON message on traffic topic");
            }
        }
    }
});

// 4. Control Route: Frontend sends commands to Traffic Lights
app.post('/api/traffic/control', (req, res) => {
    const { location, command } = req.body; // e.g., { location: "Galle Road", command: "RED" }
    
    const topic = `traffic/control/${location}`;
    const message = JSON.stringify({ action: command, timestamp: new Date() });

    // Publish the command to the MQTT broker
    aedes.publish({
        topic: topic,
        payload: message,
        qos: 0,
        retain: false
    }, (err) => {
        if (err) return res.status(500).json({ error: "Failed to send command" });
        console.log(`📡 Command sent to ${topic}: ${command}`);
        res.json({ message: "Command sent successfully" });
    });
});

// 5. Start the Web Server
app.listen(PORT, () => {
    console.log(`✅ Dashboard API running on http://localhost:${PORT}`);
});

// 6. Start the MQTT Broker
mqttServer.listen(MQTT_PORT, () => {
    console.log(`📡 MQTT Broker (IoT Hub) running on port ${MQTT_PORT}`);
});