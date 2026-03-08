// server/models/UltrasonicData.js
const mongoose = require('mongoose');

const UltrasonicSchema = new mongoose.Schema({
    // Which road this sensor is on
    road: {
        type: String,
        required: true,
        enum: ['North', 'South', 'East', 'West']
    },

    // Distance in cm from sensor to first approaching vehicle
    // If no vehicle detected, this will be null or > 400 (sensor max range)
    distanceCm: {
        type: Number,
        default: null
    },

    // Whether a vehicle is actually detected (within 400cm)
    vehicleDetected: {
        type: Boolean,
        default: false
    },

    // Timestamp of the reading
    timestamp: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('UltrasonicData', UltrasonicSchema);
