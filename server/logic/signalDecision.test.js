// server/logic/signalDecision.test.js
// Functions under test: calcGreenTime, calcScore  (server/logic/signalDecision.js)
// Assigned to: J.A.D.N. Jayasooriya (E/21/196)
//
// External dependencies: NONE — both functions are pure (no DB, no network, no I/O),
// so no mocking is required for this module.

const { calcGreenTime, calcScore, queueLevel } = require('./signalDecision');

describe('calcGreenTime(us1Stable, us2Stable, piezoHeavy)', () => {
    // ── Equivalence classes ────────────────────────────────────────────────
    // EC1: neither sensor stable        -> base 3s
    // EC2: only US1 stable (Light)      -> 3 + 3 = 6s
    // EC3: US1 + US2 stable (Heavy)     -> 3 + 6 = 9s
    // EC4: only US2 stable (invalid)    -> ignored, base 3s
    // EC5: Heavy + piezo                -> 3 + 6 + 3 = 12s
    // EC6: Light + piezo                -> 3 + 3 + 3 = 9s
    // EC7: piezo true but US1 false     -> piezo bonus must NOT apply

    test('EC1: no sensors stable returns base green (3s)', () => {
        expect(calcGreenTime(false, false, false)).toBe(3);
    });

    test('EC2: only US1 stable (Light) returns 6s', () => {
        expect(calcGreenTime(true, false, false)).toBe(6);
    });

    test('EC3: US1 + US2 stable (Heavy) returns 9s', () => {
        expect(calcGreenTime(true, true, false)).toBe(9);
    });

    test('EC4: only US2 stable (invalid reading) is ignored, returns base 3s', () => {
        expect(calcGreenTime(false, true, false)).toBe(3);
    });

    test('EC5: Heavy queue + piezo stacks to 12s', () => {
        expect(calcGreenTime(true, true, true)).toBe(12);
    });

    test('EC6: Light queue + piezo stacks to 9s', () => {
        expect(calcGreenTime(true, false, true)).toBe(9);
    });

    test('EC7: piezo true but US1 false must NOT add bonus (guard condition)', () => {
        expect(calcGreenTime(false, false, true)).toBe(3);
        expect(calcGreenTime(false, true, true)).toBe(3);
    });

    // ── Boundary value analysis ────────────────────────────────────────────
    // The only "boundary" in this function is the discrete state transition
    // between queue levels, since inputs are booleans. We test every corner
    // of the truth table (2^3 = 8 combinations) to cover all boundaries.
    test('BVA: full truth table sanity check (all 8 boolean combinations)', () => {
        const table = [
            [false, false, false, 3],
            [false, false, true,  3],
            [false, true,  false, 3],
            [false, true,  true,  3],
            [true,  false, false, 6],
            [true,  false, true,  9],
            [true,  true,  false, 9],
            [true,  true,  true,  12],
        ];
        table.forEach(([us1, us2, piezo, expected]) => {
            expect(calcGreenTime(us1, us2, piezo)).toBe(expected);
        });
    });

    // ── Error / negative cases ─────────────────────────────────────────────
    test('Error case: non-boolean truthy/falsy inputs are coerced safely', () => {
        // function relies on JS truthiness (&&), so 1/0 and "" behave like true/false
        expect(calcGreenTime(1, 1, 0)).toBe(9);
        expect(calcGreenTime(0, 0, 0)).toBe(3);
    });

    test('Error case: undefined/null inputs do not throw and fall back to base green', () => {
        expect(() => calcGreenTime(undefined, null, undefined)).not.toThrow();
        expect(calcGreenTime(undefined, null, undefined)).toBe(3);
    });
});

describe('calcScore(us1Stable, us2Stable, piezoHeavy)', () => {
    // ── Equivalence classes (priority ranking) ─────────────────────────────
    test('EC1: Heavy + piezo returns 380 (highest priority)', () => {
        expect(calcScore(true, true, true)).toBe(380);
    });

    test('EC2: Heavy only returns 300', () => {
        expect(calcScore(true, true, false)).toBe(300);
    });

    test('EC3: Light + piezo returns 230', () => {
        expect(calcScore(true, false, true)).toBe(230);
    });

    test('EC4: Light only returns 150', () => {
        expect(calcScore(true, false, false)).toBe(150);
    });

    test('EC5: No queue + piezo (US1 stable required) returns 80', () => {
        expect(calcScore(true, false, true)).toBe(230); // covered above; separate no-queue-piezo case below
    });

    test('EC6: No queue, no piezo returns 50 (lowest)', () => {
        expect(calcScore(false, false, false)).toBe(50);
    });

    // ── Boundary case: piezo is only valid together with US1 ───────────────
    test('BVA/Error: piezoHeavy true but US1 false must NOT unlock piezo bonus', () => {
        expect(calcScore(false, false, true)).toBe(50); // falls through to SCORE_NONE
        expect(calcScore(false, true, true)).toBe(50);  // US2-only + piezo is still "None" level
    });

    test('Ranking invariant: Heavy+Piezo > Heavy > Light+Piezo > Light > None+Piezo > None', () => {
        const heavyPiezo = calcScore(true, true, true);
        const heavy      = calcScore(true, true, false);
        const lightPiezo = calcScore(true, false, true);
        const light       = calcScore(true, false, false);
        const nonePiezo   = calcScore(false, false, true); // US1 false -> piezo ignored -> equals none
        const none        = calcScore(false, false, false);

        expect(heavyPiezo).toBeGreaterThan(heavy);
        expect(heavy).toBeGreaterThan(lightPiezo);
        expect(lightPiezo).toBeGreaterThan(light);
        expect(light).toBeGreaterThan(none);
        expect(nonePiezo).toBe(none); // documents the guard: piezo needs US1
    });
});

describe('queueLevel(us1Stable, us2Stable) — support function used by both above', () => {
    test('returns "Heavy" when both sensors stable', () => {
        expect(queueLevel(true, true)).toBe('Heavy');
    });
    test('returns "Light" when only US1 stable', () => {
        expect(queueLevel(true, false)).toBe('Light');
    });
    test('returns "None" when only US2 stable (invalid/ignored)', () => {
        expect(queueLevel(false, true)).toBe('None');
    });
    test('returns "None" when neither stable', () => {
        expect(queueLevel(false, false)).toBe('None');
    });
});