// server/services/analyticsService.test.js
// Function under test: calculateCongestionScore(distanceCm, queueLevel, googleTraffic, rainDetected)
// Assigned to: Samadhini Perera (E/21/289)
//
// External dependency: this file also requires '../models/AnalyticsData' (a Mongoose model)
// at the top of analyticsService.js, so the DB connection must be mocked, otherwise Jest
// would try to hit a real MongoDB instance just by requiring the module.
jest.mock('../models/AnalyticsData', () => ({
    create: jest.fn().mockResolvedValue({}),
    aggregate: jest.fn().mockResolvedValue([]),
}));

const { calculateCongestionScore } = require('./analyticsService');

describe('calculateCongestionScore(distanceCm, queueLevel, googleTraffic, rainDetected)', () => {
    // ── Equivalence partitioning on distanceCm (5 classes from the source code) ──
    // <20      -> 40 pts (vehicle at stop line)
    // 20-49    -> 30 pts
    // 50-99    -> 20 pts
    // 100-199  -> 10 pts
    // >=5000   -> 0 pts (no vehicle)
    // other (200-4999) -> 5 pts (the "else" branch)
    test('EC1: distance < 20cm scores 40 distance points', () => {
        expect(calculateCongestionScore(10, 'None', 'Unknown', false)).toBe(40 + 0 + 0 + 0);
    });

    test('EC2: distance in [20,50) scores 30 distance points', () => {
        expect(calculateCongestionScore(35, 'None', 'Unknown', false)).toBe(30);
    });

    test('EC3: distance in [50,100) scores 20 distance points', () => {
        expect(calculateCongestionScore(75, 'None', 'Unknown', false)).toBe(20);
    });

    test('EC4: distance in [100,200) scores 10 distance points', () => {
        expect(calculateCongestionScore(150, 'None', 'Unknown', false)).toBe(10);
    });

    test('EC5: distance >= 5000 (no vehicle) scores 0 distance points', () => {
        expect(calculateCongestionScore(5000, 'None', 'Unknown', false)).toBe(0);
    });

    test('EC6: distance in the uncovered middle range (200-4999) falls into else=5', () => {
        expect(calculateCongestionScore(1000, 'None', 'Unknown', false)).toBe(5);
    });

    // ── Boundary Value Analysis on distanceCm ──────────────────────────────
    // Boundaries: 19/20/21, 49/50/51, 99/100/101, 199/200/201, 4999/5000/5001
    test.each([
        [19, 40], [20, 30], [21, 30],
        [49, 30], [50, 20], [51, 20],
        [99, 20], [100, 10], [101, 10],
        [199, 10], [200, 5],  [201, 5],
        [4999, 5], [5000, 0], [5001, 0],
    ])('BVA: distanceCm=%i yields distance component=%i', (distance, expectedDistancePts) => {
        expect(calculateCongestionScore(distance, 'None', 'Unknown', false)).toBe(expectedDistancePts);
    });

    // ── Equivalence partitioning on queueLevel ─────────────────────────────
    test('EC: queueLevel "Heavy" adds 35 points', () => {
        expect(calculateCongestionScore(5000, 'Heavy', 'Unknown', false)).toBe(0 + 35);
    });
    test('EC: queueLevel "Light" adds 15 points', () => {
        expect(calculateCongestionScore(5000, 'Light', 'Unknown', false)).toBe(0 + 15);
    });
    test('EC: queueLevel "None" adds 0 points', () => {
        expect(calculateCongestionScore(5000, 'None', 'Unknown', false)).toBe(0);
    });

    // ── Equivalence partitioning on googleTraffic ──────────────────────────
    test('EC: googleTraffic "Heavy" adds only 5 points (penalised — downstream jammed)', () => {
        expect(calculateCongestionScore(5000, 'None', 'Heavy', false)).toBe(5);
    });
    test('EC: googleTraffic "Medium" adds 12 points', () => {
        expect(calculateCongestionScore(5000, 'None', 'Medium', false)).toBe(12);
    });
    test('EC: googleTraffic "Light" adds 20 points (rewarded — free flow)', () => {
        expect(calculateCongestionScore(5000, 'None', 'Light', false)).toBe(20);
    });

    // ── Rain flag ───────────────────────────────────────────────────────────
    test('EC: rainDetected true adds 5 points', () => {
        expect(calculateCongestionScore(5000, 'None', 'Unknown', true)).toBe(5);
    });

    // ── Combined / worst-case scenario ─────────────────────────────────────
    test('Combined: worst-case congestion (vehicle at line, heavy queue, light downstream, rain) sums correctly', () => {
        // 40 (dist<20) + 35 (Heavy) + 20 (Light traffic) + 5 (rain) = 100
        expect(calculateCongestionScore(5, 'Heavy', 'Light', true)).toBe(100);
    });

    // ── Clamp / upper boundary ──────────────────────────────────────────────
    test('BVA: score is clamped to max 100 even if raw components exceed it', () => {
        // 40 + 35 + 20 + 5 = 100 exactly -> clamp should not reduce a legitimate 100
        expect(calculateCongestionScore(0, 'Heavy', 'Light', true)).toBe(100);
    });

    // ── Error / negative cases ─────────────────────────────────────────────
    test('Error case: unrecognised queueLevel string is silently ignored (adds 0)', () => {
        expect(calculateCongestionScore(5000, 'Medium', 'Unknown', false)).toBe(0);
    });

    test('Error case: unrecognised googleTraffic string is silently ignored (adds 0)', () => {
        expect(calculateCongestionScore(5000, 'None', 'Extreme', false)).toBe(0);
    });

    test('Error case: undefined distanceCm falls into the generic else branch (5 pts) without throwing', () => {
        expect(() => calculateCongestionScore(undefined, 'None', 'Unknown', false)).not.toThrow();
        expect(calculateCongestionScore(undefined, 'None', 'Unknown', false)).toBe(5);
    });

    test('Error case: null distanceCm is coerced to 0 by JS "<" comparison, so it (incorrectly) scores 40 pts — a real gap, see Step 3 review', () => {
        // NOTE: this documents ACTUAL behaviour, not desired behaviour. null < 20 evaluates to
        // true in JS because null coerces to 0, so a missing sensor reading is scored as "vehicle
        // at the stop line" instead of "no data". This is a genuine bug the team should fix.
        expect(() => calculateCongestionScore(null, 'None', 'Unknown', false)).not.toThrow();
        expect(calculateCongestionScore(null, 'None', 'Unknown', false)).toBe(40);
    });

    test('Error case: negative distanceCm is treated as < 20 (40 pts) — documents a real edge case for the team', () => {
        // NOTE: the source function has no validation for negative distances.
        // This test documents current (buggy) behaviour rather than asserting it is correct.
        expect(calculateCongestionScore(-10, 'None', 'Unknown', false)).toBe(40);
    });
});