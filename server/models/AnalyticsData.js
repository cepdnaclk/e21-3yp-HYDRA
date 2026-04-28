// server/models/AnalyticsData.js
const mongoose = require('mongoose');

const AnalyticsSchema = new mongoose.Schema({
    // Which road this data belongs to
    road: {
        type: String,
        enum: ['North', 'South', 'East', 'West'],
        required: true
    },

    // What hour of the day (0-23) — for peak hour analysis
    hour: { type: Number, required: true },

    // Day of week (0=Sunday, 6=Saturday)
    dayOfWeek: { type: Number, required: true },

    // Average wait time in seconds for this road in this decision cycle
    waitTime: { type: Number, default: 0 },

    // Green time given to this road
    greenTime: { type: Number, default: 3 },

    // How many times this road won GREEN priority in last 10 cycles
    priorityWins: { type: Number, default: 0 },

    // Vehicle distance detected (cm) — lower = more congested
    distanceCm: { type: Number, default: 5000 },

    // Google traffic level at next intersection
    googleTrafficLevel: {
        type: String,
        enum: ['Heavy', 'Medium', 'Light', 'Unknown'],
        default: 'Unknown'
    },

    // Was rain detected during this cycle
    rainDetected: { type: Boolean, default: false },

    // IR sensor queue level
    queueLevel: {
        type: String,
        enum: ['Heavy', 'Light', 'None'],
        default: 'None'
    },

    // Congestion score (0-100) — calculated from all sensors
    congestionScore: { type: Number, default: 0 },

    // System mode used for this decision
    systemMode: {
        type: String,
        enum: ['BOTH', 'SENSOR_ONLY', 'GOOGLE_ONLY', 'FALLBACK'],
        default: 'FALLBACK'
    },

    timestamp: { type: Date, default: Date.now }
});

// Index for fast time-based queries
AnalyticsSchema.index({ road: 1, timestamp: -1 });
AnalyticsSchema.index({ hour: 1, road: 1 });

module.exports = mongoose.model('AnalyticsData', AnalyticsSchema);