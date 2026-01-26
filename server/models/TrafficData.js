// server/models/TrafficData.js
const mongoose = require('mongoose');

const TrafficSchema = new mongoose.Schema({
    location: { type: String, required: true }, // e.g., "North", "South"
    congestionLevel: { type: String, default: "Low" }, // "Low", "Medium", "High"
    vehicleCount: { type: Number, default: 0 },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('TrafficData', TrafficSchema);