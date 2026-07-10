// server/services/googleTrafficService.test.js
// Functions under test: ratioToLevel, parseDurationSeconds  (server/services/googleTrafficService.js)
// Assigned to: Vedangi Nadeeshani (E/21/193)
//
// External dependency: this module calls the Google Routes API via axios inside
// getTrafficCondition()/getAllTrafficConditions(). Those two network-calling functions
// are OUT OF SCOPE for this lab (see Step 1 notes — they need a live/mocked HTTP call
// and are earmarked as a follow-up). ratioToLevel and parseDurationSeconds are pure
// helper functions with no I/O, so axios does not need to be mocked to test them.
// NOTE: we exported these two functions from the module (they were previously internal)
// specifically to make them unit-testable — a small testability improvement made in Step 1.

const { ratioToLevel, parseDurationSeconds } = require('./googleTrafficService');

describe('ratioToLevel(ratio)', () => {
    // ── Equivalence classes ─────────────────────────────────────────────────
    // EC1: ratio >= 2.0        -> 'Heavy'
    // EC2: 1.3 <= ratio < 2.0  -> 'Medium'
    // EC3: ratio < 1.3         -> 'Light'
    test('EC1: ratio well above 2.0 returns "Heavy"', () => {
        expect(ratioToLevel(3.5)).toBe('Heavy');
    });
    test('EC2: ratio in the middle band returns "Medium"', () => {
        expect(ratioToLevel(1.6)).toBe('Medium');
    });
    test('EC3: ratio near 1 (no delay) returns "Light"', () => {
        expect(ratioToLevel(1.05)).toBe('Light');
    });

    // ── Boundary value analysis ─────────────────────────────────────────────
    test.each([
        [1.99, 'Medium'],
        [2.0,  'Heavy'],   // exactly on boundary — inclusive per >= operator
        [2.01, 'Heavy'],
        [1.29, 'Light'],
        [1.3,  'Medium'],  // exactly on boundary — inclusive per >= operator
        [1.31, 'Medium'],
    ])('BVA: ratio=%f returns %s', (ratio, expected) => {
        expect(ratioToLevel(ratio)).toBe(expected);
    });

    // ── Error / negative cases ──────────────────────────────────────────────
    test('Error case: ratio of exactly 1 (no traffic at all) returns "Light"', () => {
        expect(ratioToLevel(1)).toBe('Light');
    });
    test('Error case: ratio of 0 (defensive/invalid input) still returns "Light" without throwing', () => {
        expect(() => ratioToLevel(0)).not.toThrow();
        expect(ratioToLevel(0)).toBe('Light');
    });
    test('Error case: negative ratio (should never occur, but function must not crash)', () => {
        expect(() => ratioToLevel(-1)).not.toThrow();
        expect(ratioToLevel(-1)).toBe('Light');
    });
});

describe('parseDurationSeconds(durationValue)', () => {
    // ── Equivalence classes ─────────────────────────────────────────────────
    // EC1: valid Google-style string "245s"
    // EC2: numeric type passed directly
    // EC3: falsy value (null/undefined/0/'')
    // EC4: non-numeric garbage string
    test('EC1: Google-style duration string "245s" parses to 245', () => {
        expect(parseDurationSeconds('245s')).toBe(245);
    });
    test('EC2: a plain number is returned unchanged', () => {
        expect(parseDurationSeconds(120)).toBe(120);
    });
    test('EC3a: null returns 0', () => {
        expect(parseDurationSeconds(null)).toBe(0);
    });
    test('EC3b: undefined returns 0', () => {
        expect(parseDurationSeconds(undefined)).toBe(0);
    });
    test('EC4: non-numeric garbage string returns 0 (NaN guarded)', () => {
        expect(parseDurationSeconds('abcs')).toBe(0);
    });

    // ── Boundary value analysis ─────────────────────────────────────────────
    test('BVA: "0s" (zero-length duration) returns 0', () => {
        expect(parseDurationSeconds('0s')).toBe(0);
    });
    test('BVA: single-digit duration "1s" returns 1', () => {
        expect(parseDurationSeconds('1s')).toBe(1);
    });
    test('BVA: large duration string well beyond typical trip length still parses correctly', () => {
        expect(parseDurationSeconds('86400s')).toBe(86400); // 24 hours, upper sanity bound
    });

    // ── Error / negative cases ──────────────────────────────────────────────
    test('Error case: string with no trailing "s" still parses the numeric part', () => {
        expect(parseDurationSeconds('300')).toBe(300);
    });
    test('Error case: empty string returns 0 without throwing', () => {
        expect(() => parseDurationSeconds('')).not.toThrow();
        expect(parseDurationSeconds('')).toBe(0);
    });
    test('Error case: an object/array (wrong type entirely) returns 0 without throwing', () => {
        expect(() => parseDurationSeconds({})).not.toThrow();
        expect(parseDurationSeconds({})).toBe(0);
        expect(parseDurationSeconds([])).toBe(0);
    });
});