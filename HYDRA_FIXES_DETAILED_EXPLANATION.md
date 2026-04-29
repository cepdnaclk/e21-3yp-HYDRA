# HYDRA System: Issues Analysis & Fixes
## Complete Technical Explanation for Evaluation

---

## SECTION 1: HOW GREEN TIME PRIORITY SCORE & GREEN TIME CALCULATION WORK

### Architecture Overview
The HYDRA system uses a **DUAL-MODE decision engine** that selects the appropriate sensor scenario per road:

```
DECISION FLOW:
┌─────────────────────────────────────────────┐
│  Read Sensor Data (distance, IR, piezo)     │
└────────────┬────────────────────────────────┘
             │
       ┌─────▼──────┐
       │ DISTANCE?  │
       └─────┬──────┘
             │
    ┌────────┴──────────┐
    │                   │
< 20cm                  ≥ 20cm
    │                   │
    ▼                   ▼
 IR MODE          ULTRASONIC MODE
 ─────────────────────────────
 - IR sensors    - Ultrasonic
 - Piezo         - Google Traffic
 - Fixed table   - Distance formula
```

### 1A: GREEN TIME CALCULATION (How long each road gets green)

#### SCENARIO A - ULTRASONIC MODE (distance ≥ 20cm)

**Formula:**
```javascript
distanceFactor = (distance / SENSOR_MAX_RANGE) * 20  // 0-20s range
greenTime = MIN_GREEN_ULTRASONIC + distanceFactor    // 10s + (0-20s)
// Result: 10-30 seconds

Google Traffic adjustment:
- Heavy:   greenTime * 0.7   (reduce to avoid gridlock)
- Light:   greenTime * 1.2   (extend when clear)
- Medium:  no change
```

**Examples:**
- Distance 400cm (far away): 10 + (400/400)*20 = 10 + 20 = **30s green**
- Distance 200cm (medium): 10 + (200/400)*20 = 10 + 10 = **20s green**
- Distance 1cm (very close): 10 + (1/400)*20 = 10 + 0.05 = **10s green**
- No vehicle: Use Google only → 40s (Heavy), 25s (Medium), 10s (Light)

**Google Traffic Adjustment:**
- If Heavy traffic detected AND greenTime was 20s → 20 * 0.7 = 14s (prevent gridlock)
- If Light traffic detected AND greenTime was 20s → 20 * 1.2 = 24s (maximize flow)

#### SCENARIO B - IR MODE (distance < 20cm)

**Fixed Table Based on IR Sensors:**
```javascript
const BASE_GREEN_TIME       = 3;     // Always minimum
const LIGHT_TRAFFIC_BONUS   = 3;     // IR1 only
const HEAVY_TRAFFIC_BONUS   = 6;     // Both IR
const PIEZO_BONUS           = 3;     // Stacked on IR bonus

Decision Table:
- No IR blocked           → 3s (base only)
- IR1 blocked, IR2 clear  → 3 + 3 = 6s (light traffic)
- Both IR blocked         → 3 + 6 = 9s (heavy traffic)
- Both IR + Piezo heavy   → 3 + 6 + 3 = 12s ✓ (heavy + truck/bus)
- IR1 + Piezo (no IR2)    → 3 + 3 + 3 = 9s ✓ (light + truck/bus)
```

**Physical Layout:**
```
Distance from stop line:
0-5cm    → IR Sensor 1 (blocks alone = 1 car)
5-10cm   → IR Sensor 2 (blocks only if heavy = 2+ cars)
10-20cm  → Pedestrian crossing zone (excluded from counts)
>20cm    → Ultrasonic range
```

### 1B: PRIORITY SCORE (Which road wins the green light)

Separate from green time duration. Used to determine **WHICH ROAD** gets green while others get red.

#### ULTRASONIC MODE SCORING:

```javascript
score = (SENSOR_MAX_RANGE - distance)  // Closer = higher score
        + Google Traffic Weight         // Heavy traffic = lower score

Examples:
- Distance 50cm:  score = 400 - 50 = 350
- Distance 200cm: score = 400 - 200 = 200  
- Distance 399cm: score = 400 - 399 = 1

Google component:
- Heavy:   -50 (penalise roads leading to jams)
- Medium:  -15 (minor penalisation)
- Light:   +10 (encourage flow)
- Unknown:  0  (neutral)

Final example:
- Road A: 200cm distance + Heavy traffic = 200 - 50 = 150 score
- Road B: 50cm distance + Light traffic = 350 + 10 = 360 score
→ Road B WINS (gets green)
```

#### IR MODE SCORING:

```javascript
Starts at IR_SCORE_BASE = 1000  // Always beats any Ultrasonic score
Then adds:
- No IR blocked:  +10
- IR1 only:       +100
- Both IR:        +200
- Both IR + Piezo: +300 (extra weight for heavy vehicle)

Google adjustment (still applied):
- Heavy:   -50
- Light:   +10

Example:
- IR mode: 1000 + 200 = 1200 (beats any ultrasonic ≤500)
- Ultrasonic: 350 (can never win against IR)
→ IR MODE ALWAYS WINS when vehicle very close
```

### Key Difference:
- **SCORE** = Priority (who gets green)
- **GREEN TIME** = Duration (how long they keep green)

---

## SECTION 2: THE THREE ISSUES & ROOT CAUSES

### ISSUE 1: Ultrasonic Mode Shows No Timing Changes

#### Problem Observed:
- Move vehicle from 50cm to 300cm away
- Expected: green time increases from 10s to 25s
- Actual: green time stays at 10s (or changes very slowly)

#### Why It Happens:

**Root Cause 1 - Calculation Issue:**
```javascript
// CURRENT BROKEN FORMULA:
const distanceFactor = (distanceCm / SENSOR_MAX_RANGE) * 20;
let greenTime = MIN_GREEN_ULTRASONIC + distanceFactor;
// MIN_GREEN_ULTRASONIC = 10 (minimum)
// distanceFactor for 50cm = (50/400)*20 = 2.5
// Result = 10 + 2.5 = 12.5s

// The problem: MIN_GREEN_ULTRASONIC is ALWAYS there
// So even with distance changes, variations are small:
// At 50cm:  10 + 2.5 = 12.5s
// At 200cm: 10 + 10 = 20s
// At 400cm: 10 + 20 = 30s
// This means close distances get too little time!
```

**Root Cause 2 - Dashboard Override (MORE CRITICAL):**
```javascript
// In the decision engine (signalDecision.js):
let greenTime = calculateGreenTimeUltrasonic(distanceCm, google);
// Returns: 10-30 seconds correctly calculated

// BUT in server/index.js (main loop):
const commands = {};
ROADS.forEach(road => {
    commands[road] = road === winner.road
        ? { signal: 'GREEN', greenTime: greenTime[road], yellowTime: ... }
        //                    ^^^^^^^^^^^^^^^^
        //                    USES OLD LOOKUP VALUE!
        : { signal: 'RED', ... };
});

// greenTime[road] is set only by IR handlers!
// Ultrasonic never updates it, so decision engine's calculated time is ignored
```

#### The Complete Chain of Failure:
1. Ultrasonic distance sensor reads 50cm
2. `calculateGreenTimeUltrasonic(50)` returns 12s ✓
3. Decision engine returns `{ greenDuration: 12 }`  ✓
4. BUT... actual signal command uses `greenTime[road]` (old value)
5. Dashboard broadcasts old timing → no visible change ✗

---

### ISSUE 2: Piezo Sensor Disappears Instantly

#### Problem Observed:
- Tap piezo sensor on North road
- Dashboard briefly shows "🔴 HEAVY VEHICLE DETECTED"
- 0.3 seconds later: disappears completely
- No green time extension happens
- Tapping again shows same instant-disappear behavior

#### Why It Happens:

**The Problem Code Flow:**
```javascript
// MQTT Handler (receives raw sensor data):
client.on('message', (topic, message) => {
    if (topic.includes('piezo/north')) {
        const value = parseInt(message.toString());
        // value = HIGH (1) when pressed
        // value = LOW (0) when released (0.1 sec later)
        
        piezoData.North = (value === 1);  // ← IMMEDIATE state!
        // Sets it true, then 100ms later MQTT sends LOW again
        
        io.emit('piezoUpdate', {
            road: 'North',
            heavy: piezoData.North
        });
    }
});

// Result:
// T=0ms:    Tap piezo → message HIGH received
// T=0ms:    piezoData.North = true
// T=50ms:   Dashboard shows "HEAVY VEHICLE"
// T=100ms:  Piezo releases → message LOW received
// T=100ms:  piezoData.North = false
// T=150ms:  Dashboard removes badge ✗
```

#### No Persistence/Debounce:
```javascript
// What we need:
const PIEZO_DEBOUNCE_MS = 5000; // Keep "active" for 5 seconds

// When piezo taps:
const now = Date.now();
piezoTimestamps.North = now; // Record tap time

// In decision engine:
const piezoHeavy = piezo[road] &&
    (Date.now() - piezoTimestamps[road] < PIEZO_DEBOUNCE_MS);
// This way: heavy vehicle stays "active" for 5s even if sensor released
```

---

### ISSUE 3: Piezo Doesn't Extend Green Time

#### Problem Observed:
- IR1 blocked + Piezo tapped:
  - Expected: 6s + 3s = **9 seconds green**
  - Actual: 6 seconds (no extension)
  
- Both IR blocked + Piezo tapped:
  - Expected: 9s + 3s = **12 seconds green**
  - Actual: 9 seconds (no extension)

#### Why It Happens:

**Root Cause - Green Time Override Chain:**
```javascript
// Step 1: Decision Engine (CORRECT)
function calculateGreenTimeIR(ir1Blocked, ir2Blocked, piezoHeavy) {
    let greenTime = BASE_GREEN_TIME; // 3s
    
    if (ir1Blocked && ir2Blocked) {
        greenTime = BASE_GREEN_TIME + HEAVY_TRAFFIC_BONUS; // 3 + 6 = 9s
        if (piezoHeavy) {
            greenTime += PIEZO_BONUS; // 9 + 3 = 12s ✓ CORRECT!
        }
    } else if (ir1Blocked) {
        greenTime = BASE_GREEN_TIME + LIGHT_TRAFFIC_BONUS; // 3 + 3 = 6s
        if (piezoHeavy) {
            greenTime += PIEZO_BONUS; // 6 + 3 = 9s ✓ CORRECT!
        }
    }
    return greenTime; // Returns 12s or 9s correctly
}

// Step 2: Decision Output (CORRECT)
return {
    ...
    greenDuration: winner.greenTime, // Says 12s ✓
    ...
};

// Step 3: Server Command (BROKEN) ✗
const commands = {};
ROADS.forEach(road => {
    if (road === winner.road) {
        // WRONG! Uses old lookup table instead of decision engine value
        commands[road] = {
            signal: 'GREEN',
            greenTime: greenTime[road], // ← THIS IS THE PROBLEM!
            // greenTime[road] = simple IR lookup (9s max for both IR)
            // Never includes piezo bonus
        };
    }
});

// Result:
// Decision says: 12 seconds ✓
// Command says: 9 seconds ✗
// ESP32 receives: 9 seconds
// Dashboard shows: 9 seconds
// Piezo bonus LOST
```

#### The Two Tracking Systems Conflict:
```javascript
// System 1: greenTime[road] lookup table (updated only by IR handlers)
greenTime[road] = 9; // from IR2 blocked = 3 + 6

// System 2: Decision engine calculation (includes piezo)
decision.greenDuration = 12; // from IR2 + piezo = 3 + 6 + 3

// Code picks System 1 → Piezo bonus ignored ✗
```

---

## SECTION 3: SOLUTIONS (Complete Fixes)

### FIX 1: Use Decision Engine Output (Not Lookup Table)

```javascript
// BEFORE (BROKEN):
const commands = {};
ROADS.forEach(road => {
    commands[road] = road === winner.road
        ? { signal: 'GREEN', greenTime: greenTime[road], ... }
        : { signal: 'RED', ... };
});

// AFTER (FIXED):
const commands = {};
ROADS.forEach(road => {
    commands[road] = road === winner.road
        ? { 
            signal: 'GREEN',
            greenTime: decision.greenDuration, // ← Use decision output!
            yellowTime: decision.yellowDuration
          }
        : { signal: 'RED', greenTime: 0, yellowTime: 0 };
});

// Now all fixes apply:
// - Ultrasonic distance changes → greenTime changes
// - Piezo bonus → greenTime increases
// - All scenarios → correct timing
```

### FIX 2: Piezo Debounce/Persistence (5-Second Window)

```javascript
// Track when each piezo tap occurred:
const piezoTimestamps = {
    North: 0,
    South: 0,
    East: 0,
    West: 0
};

const PIEZO_DEBOUNCE_MS = 5000; // 5 seconds

// When MQTT piezo message arrives:
client.on('message', (topic, message) => {
    if (topic.includes('piezo')) {
        const road = extractRoad(topic); // 'North', 'South', etc.
        const value = parseInt(message.toString());
        
        if (value === HIGH) { // Piezo pressed
            piezoTimestamps[road] = Date.now(); // Record tap time
        }
        // If LOW (released), DON'T clear timestamp!
        // Let debounce timer handle it
    }
});

// In decision engine (makeSignalDecision):
function makeSignalDecision(..., piezoData, ...) {
    const ir    = irData    || {};
    const piezo = piezoData || {};
    const ped   = pedStatus || {};

    let priorities = [];
    // ... setup code ...

    priorities = ROADS.map(road => {
        // ... distance, IR, google setup ...

        // FIXED PIEZO LOGIC:
        const now = Date.now();
        const lastPiezoTap = piezoTimestamps[road] || 0;
        const piezoActive = (now - lastPiezoTap) < PIEZO_DEBOUNCE_MS;
        
        // Use piezoActive instead of raw piezo[road]
        let score, greenTime;

        if (sensorScenario === 'IR') {
            score     = calculateScoreIR(
                irRoad.ir1Blocked, irRoad.ir2Blocked,
                piezoActive,  // ← Use debounced value
                google
            );
            greenTime = calculateGreenTimeIR(
                irRoad.ir1Blocked, irRoad.ir2Blocked,
                piezoActive   // ← Use debounced value
            );
        } else {
            // ... ultrasonic logic ...
        }

        return {
            road, sensorScenario,
            distance: distanceCm,
            ir1Blocked: irRoad.ir1Blocked || false,
            ir2Blocked: irRoad.ir2Blocked || false,
            piezoHeavy: piezoActive, // ← Show persisted state
            traffic: google,
            score, greenTime,
            yellowTime: currentYellowTime,
            mode: systemMode
        };
    });

    // ... continue with sorting and winner selection ...
}
```

### FIX 3: Fix Ultrasonic Formula (Inverse: Closer = More Time)

```javascript
// CURRENT (WRONG):
const distanceFactor = (distanceCm / SENSOR_MAX_RANGE) * 20;
let greenTime = MIN_GREEN_ULTRASONIC + distanceFactor;
// Problem: 10cm away = only 10.5s, far away = 30s (backwards!)

// FIXED (CORRECT):
function calculateGreenTimeUltrasonic(distanceCm, googleTraffic) {
    // No vehicle in range
    if (distanceCm === null || distanceCm >= SENSOR_MAX_RANGE) {
        if (googleTraffic === 'Heavy')  return 40;
        if (googleTraffic === 'Medium') return 25;
        if (googleTraffic === 'Light')  return MIN_GREEN_ULTRASONIC;
        return DEFAULT_GREEN;
    }

    // Vehicle detected: INVERSE formula
    // Closer vehicle (urgent) = MORE time needed
    // Farther vehicle (can wait) = LESS time
    
    // distanceFactor = 0 when VERY CLOSE (0cm)
    //               = 20 when FAR (400cm)
    const distanceFactor = ((SENSOR_MAX_RANGE - distanceCm) / SENSOR_MAX_RANGE) * 20;
    let greenTime = MIN_GREEN_ULTRASONIC + distanceFactor;
    
    // Now:
    // At 10cm (very close):  greenTime = 10 + 19.5 = 29.5s ✓
    // At 200cm (medium):     greenTime = 10 + 10 = 20s ✓
    // At 390cm (far):        greenTime = 10 + 1 = 11s ✓

    // Google Traffic adjustment
    if (googleTraffic === 'Heavy') {
        greenTime = Math.max(greenTime * 0.7, MIN_GREEN_ULTRASONIC);
    } else if (googleTraffic === 'Light') {
        greenTime = Math.min(greenTime * 1.2, MAX_GREEN_ULTRASONIC);
    }

    return Math.round(
        Math.min(Math.max(greenTime, MIN_GREEN_ULTRASONIC), MAX_GREEN_ULTRASONIC)
    );
}
```

---

## SECTION 4: ONE-ROAD IMPLEMENTATION (Evaluation Context)

### Hardware Constraints:
- **Ideal:** 4 roads (North, South, East, West) all with complete sensors
- **Reality:** Limited esp32 hardware available → North road fully instrumented
- **Solution:** Synthetic data for other roads

### How It's Explained:
```
"For evaluation purposes, the HYDRA system was fully implemented on the North road
(all 4 sensor types: ultrasonic, IR1, IR2, Piezo). The South, East, and West roads
show synthetic default timing to demonstrate system scalability.

The decision engine runs on ALL 4 roads every cycle, selecting the winner across all
roads. The North road sensor data drives real-time decisions. Other roads default to
10-second timing cycles with rotation-based priority to prevent starvation.

Full 4-road deployment would require: 4x ESP32s, 4x Ultrasonic, 4x IR pair,
4x Piezo, 4x MQTT connections. The architecture supports this without changes."
```

### In Dashboard:
```javascript
// Show which roads have real sensors vs synthetic
const sensorStatus = {
    North: { ultrasonic: true, ir: true, piezo: true, status: 'ACTIVE' },
    South: { ultrasonic: false, ir: false, piezo: false, status: 'SYNTHETIC' },
    East:  { ultrasonic: false, ir: false, piezo: false, status: 'SYNTHETIC' },
    West:  { ultrasonic: false, ir: false, piezo: false, status: 'SYNTHETIC' }
};
```

---

## SUMMARY TABLE

| Issue | Cause | Fix | Impact |
|-------|-------|-----|--------|
| **#1: Ultrasonic no changes** | greenTime[road] override + formula | Use decision.greenDuration + inverse formula | Distance changes now visible (10-30s range) |
| **#2: Piezo disappears** | No debounce/persistence | 5s debounce window on piezo state | Piezo shows for 5s after tap |
| **#3: Piezo no green extend** | greenTime lookup ignores piezo bonus | Use decision engine greenDuration | Piezo adds +3s to green time |
| **#4: One road setup** | Hardware constraints | Document as design choice | Explains evaluation scope clearly |

