// server/services/analyticsService.js
// Calculates meaningful analytics from sensor + traffic data

const AnalyticsData = require('../models/AnalyticsData');

// ── Calculate congestion score 0-100 from sensor readings ──────────────────
// Higher score = more congested = higher priority needed
function calculateCongestionScore(distanceCm, queueLevel, googleTraffic, rainDetected) {
    let score = 0;

    // Distance component (0-40 points)
    // Closer vehicle = more urgent
    if (distanceCm < 20) {
        score += 40; // Vehicle at stop line — very congested
    } else if (distanceCm < 50) {
        score += 30;
    } else if (distanceCm < 100) {
        score += 20;
    } else if (distanceCm < 200) {
        score += 10;
    } else if (distanceCm >= 5000) {
        score += 0; // No vehicle detected
    } else {
        score += 5;
    }

    // IR Queue component (0-35 points)
    if (queueLevel === 'Heavy') score += 35;
    else if (queueLevel === 'Light') score += 15;

    // Google Traffic component (0-20 points)
    // Heavy downstream traffic = we should hold back = lower score
    // Light downstream = safe to release cars = higher priority
    if (googleTraffic === 'Heavy') score += 5;   // penalise — downstream jammed
    else if (googleTraffic === 'Medium') score += 12;
    else if (googleTraffic === 'Light') score += 20; // reward — cars can flow

    // Rain component (0-5 points)
    // Rain means slower clearing — slightly higher congestion risk
    if (rainDetected) score += 5;

    return Math.min(100, score);
}

// ── Save one analytics record per decision cycle ───────────────────────────
async function saveAnalyticsRecord(road, cycleData) {
    try {
        const now = new Date();
        const score = calculateCongestionScore(
            cycleData.distanceCm,
            cycleData.queueLevel,
            cycleData.googleTraffic,
            cycleData.rainDetected
        );

        await AnalyticsData.create({
            road,
            hour: now.getHours(),
            dayOfWeek: now.getDay(),
            waitTime: cycleData.waitTime || 0,
            greenTime: cycleData.greenTime || 3,
            priorityWins: cycleData.isWinner ? 1 : 0,
            distanceCm: cycleData.distanceCm || 5000,
            googleTrafficLevel: cycleData.googleTraffic || 'Unknown',
            rainDetected: cycleData.rainDetected || false,
            queueLevel: cycleData.queueLevel || 'None',
            congestionScore: score,
            systemMode: cycleData.systemMode || 'FALLBACK',
            timestamp: now
        });
    } catch (err) {
        console.error('Analytics save error:', err.message);
    }
}

// ── Get peak hour analysis (last 7 days) ──────────────────────────────────
// Shows which hours have highest congestion — real world value
async function getPeakHourAnalysis() {
    try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const result = await AnalyticsData.aggregate([
            { $match: { timestamp: { $gte: sevenDaysAgo } } },
            {
                $group: {
                    _id: { hour: '$hour', road: '$road' },
                    avgCongestion: { $avg: '$congestionScore' },
                    avgGreenTime: { $avg: '$greenTime' },
                    avgWaitTime: { $avg: '$waitTime' },
                    totalRecords: { $sum: 1 }
                }
            },
            { $sort: { '_id.hour': 1 } }
        ]);

        // Format into hours 0-23 with all roads
        const hours = {};
        for (let h = 0; h < 24; h++) {
            hours[h] = { hour: h, North: 0, South: 0, East: 0, West: 0 };
        }

        result.forEach(item => {
            const h = item._id.hour;
            const road = item._id.road;
            if (hours[h] && road) {
                hours[h][road] = Math.round(item.avgCongestion);
            }
        });

        return Object.values(hours);
    } catch (err) {
        console.error('Peak hour analysis error:', err.message);
        return [];
    }
}

// ── Get road performance summary (last 24 hours) ──────────────────────────
// Shows which road is most congested and which gets most green priority
async function getRoadPerformance() {
    try {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const result = await AnalyticsData.aggregate([
            { $match: { timestamp: { $gte: oneDayAgo } } },
            {
                $group: {
                    _id: '$road',
                    avgCongestion: { $avg: '$congestionScore' },
                    avgGreenTime: { $avg: '$greenTime' },
                    avgWaitTime: { $avg: '$waitTime' },
                    totalPriorityWins: { $sum: '$priorityWins' },
                    heavyCount: {
                        $sum: { $cond: [{ $eq: ['$queueLevel', 'Heavy'] }, 1, 0] }
                    },
                    rainCount: {
                        $sum: { $cond: ['$rainDetected', 1, 0] }
                    },
                    totalCycles: { $sum: 1 }
                }
            }
        ]);

        return result.map(r => ({
            road: r._id,
            avgCongestion: Math.round(r.avgCongestion),
            avgGreenTime: Math.round(r.avgGreenTime * 10) / 10,
            avgWaitTime: Math.round(r.avgWaitTime),
            priorityWins: r.totalPriorityWins,
            heavyTrafficCount: r.heavyCount,
            rainCycles: r.rainCount,
            totalCycles: r.totalCycles,
            // Efficiency = how often this road got green when it needed it
            efficiency: r.totalCycles > 0
                ? Math.round((r.totalPriorityWins / r.totalCycles) * 100)
                : 0
        }));
    } catch (err) {
        console.error('Road performance error:', err.message);
        return [];
    }
}

// ── Get live congestion trend (last 30 minutes) ────────────────────────────
// Shows real-time congestion changes — useful for traffic police
async function getLiveCongestionTrend() {
    try {
        const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

        const result = await AnalyticsData.aggregate([
            { $match: { timestamp: { $gte: thirtyMinAgo } } },
            {
                $group: {
                    _id: {
                        // Group by 2-minute windows
                        minute: {
                            $subtract: [
                                { $minute: '$timestamp' },
                                { $mod: [{ $minute: '$timestamp' }, 2] }
                            ]
                        },
                        road: '$road'
                    },
                    avgCongestion: { $avg: '$congestionScore' },
                    timestamp: { $first: '$timestamp' }
                }
            },
            { $sort: { 'timestamp': 1 } }
        ]);

        return result;
    } catch (err) {
        console.error('Live trend error:', err.message);
        return [];
    }
}

// ── Get system efficiency stats ────────────────────────────────────────────
// Shows how well the AI is performing vs fixed timer
async function getSystemEfficiency() {
    try {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const result = await AnalyticsData.aggregate([
            { $match: { timestamp: { $gte: oneDayAgo } } },
            {
                $group: {
                    _id: '$systemMode',
                    count: { $sum: 1 },
                    avgGreenTime: { $avg: '$greenTime' },
                    avgCongestion: { $avg: '$congestionScore' }
                }
            }
        ]);

        // Calculate total cycles
        const total = result.reduce((sum, r) => sum + r.count, 0);

        // Average congestion across all roads last hour
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentAvg = await AnalyticsData.aggregate([
            { $match: { timestamp: { $gte: oneHourAgo } } },
            {
                $group: {
                    _id: null,
                    avgCongestion: { $avg: '$congestionScore' },
                    avgGreenTime: { $avg: '$greenTime' },
                    totalCycles: { $sum: 1 }
                }
            }
        ]);

        return {
            modeBreakdown: result.map(r => ({
                mode: r._id,
                count: r.count,
                percentage: total > 0 ? Math.round((r.count / total) * 100) : 0,
                avgGreenTime: Math.round(r.avgGreenTime * 10) / 10,
                avgCongestion: Math.round(r.avgCongestion)
            })),
            last1Hour: recentAvg[0] || { avgCongestion: 0, avgGreenTime: 3, totalCycles: 0 },
            totalCycles24h: total
        };
    } catch (err) {
        console.error('System efficiency error:', err.message);
        return { modeBreakdown: [], last1Hour: {}, totalCycles24h: 0 };
    }
}

module.exports = {
    saveAnalyticsRecord,
    getPeakHourAnalysis,
    getRoadPerformance,
    getLiveCongestionTrend,
    getSystemEfficiency,
    calculateCongestionScore
};