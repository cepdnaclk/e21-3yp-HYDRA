const express = require('express');
const mongoose = require('mongoose');
const TrafficData = require('./models/TrafficData'); // Import the model we created

const app = express();
const PORT = 5000;

// Middleware: This allows the server to read JSON data sent in a POST request
app.use(express.json());

// 1. Connect to MongoDB
mongoose.connect('mongodb://127.0.0.1:27017/hydra_db')
    .then(() => console.log('✅ MongoDB Connected Successfully!'))
    .catch(err => console.error('❌ Database Connection Error:', err));

// 2. Simple Test Route (Browser Check)
app.get('/', (req, res) => {
    res.send('HYDRA Server is running and connected to DB!');
});

// 3. API Route: Get all traffic data (GET)
app.get('/api/traffic', async (req, res) => {
    try {
        const data = await TrafficData.find().sort({ timestamp: -1 }); // Get latest data first
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. API Route: Receive data from IoT Sensors (POST)
app.post('/api/traffic', async (req, res) => {
    try {
        const newData = new TrafficData(req.body);
        await newData.save();
        res.json({ message: "✅ Data received by HYDRA", data: newData });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// 5. Start the Server
app.listen(PORT, () => {
    console.log(`🚀 HYDRA Engine running on http://localhost:${PORT}`);
});