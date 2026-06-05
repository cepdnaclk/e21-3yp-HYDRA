# HYDRA TRAFFIC MANAGEMENT SYSTEM
## Complete Implementation & Deployment Guide

**Version:** 2.0 (Ultrasonic ±7cm, Strict Round-Robin + Pedestrian Override)

---

## PHASE 1: ✅ ESP32 FIRMWARE UPDATES (COMPLETED)

### Changes Made to All 4 ESP32 Files:
- **Enhanced Sensor Stability Detection**: ±7cm variation tolerance for 10 seconds
- **Improved Logging**: Better diagnostic output on Serial Monitor
- **Files Updated**:
  - `esp32_north.ino`
  - `esp32_south.ino`
  - `esp32_east.ino`
  - `esp32_west.ino`

### Sensor Stability Algorithm (Implemented):
```
When US is blocked:
  1. Record initial distance
  2. Monitor readings for 10 seconds
  3. If any reading deviates > ±7cm, reset timer
  4. After 10 seconds of stable readings, confirm queue level
  5. Update trafficLevel accordingly
```

### What You'll See in Serial Monitor:
```
[US1] 📡 BLOCKED - distance: 45.3 cm (stability timer started)
[US1] ⚠️  VARIATION RESET - distance: 52.1 cm (deviation: 6.8 cm > ±7 cm)
[US1] ✅ STABLE for 10 seconds - LIGHT TRAFFIC DETECTED
     Distance: 45.2 cm ± 2.3 cm (tolerance: ±7 cm)
🚦 NORTH TRAFFIC LEVEL: Light
```

---

## PHASE 2: ✅ BACKEND LOGIC UPDATES (COMPLETED)

### Changes Made to `server/index.js`:

**1. Strict Round-Robin Ordering:**
```javascript
const ROTATION_ORDER = ['North', 'South', 'East', 'West'];
let currentRotationIndex = 0;  // Increments each cycle
```

**2. Pedestrian Override Logic:**
- Check if any road has `pedStatus[road].requested === true`
- If requesting road is next in rotation → use it
- If different road requesting → prioritize that road
- Always advance rotation index, regardless of override

**3. Decision Flow:**
```
Cycle 1: North → South (base)
  → Check if any road has pedestrian waiting
  → If South has ped waiting: South gets priority (already next)
  → If East has ped waiting: East promoted (override)
  → Advance to index 2 for next cycle
```

**Expected Console Output:**
```
↪️  Strict Round-Robin: South (rotation index: 1)
🧠 Decision: South gets GREEN (3s) YELLOW (3s) — Others RED (6s) — Mode: ULTRASONIC
```

OR (with pedestrian):
```
🚶 [East] PEDESTRIAN OVERRIDE (had request, moved forward in priority)
🧠 Decision: East gets GREEN (3s) YELLOW (3s) — Others RED (6s) — Mode: ULTRASONIC
```

---

## PHASE 3: DASHBOARD ENHANCEMENTS (REQUIRED)

### Key Displays to Add to `UserDashboard.js`:

#### 1. **Sensor Diagnostics Panel** (Per Road):
Show for each road:
- **US1 Status**: Distance (cm), Blocked/Clear, Stability % (0-100%)
- **US2 Status**: Distance (cm), Blocked/Clear, Stability % (0-100%)
- **Traffic Level**: None / Light / Heavy
- **Sensor Working**: Yes/No with connection indicator

Example Display:
```
┌─ NORTH ROAD ───────────────────┐
│ 🟢 GREEN 5s remaining            │
│                                  │
│ US1 (Stop Line):     45.2 cm    │
│   Status: ✅ BLOCKED             │
│   Stability: ████████░░ 85%      │
│                                  │
│ US2 (Queue):       350.1 cm     │
│   Status: ⚪ CLEAR               │
│   Stability: ██████░░░░ 45%      │
│                                  │
│ Traffic: 🟡 LIGHT (extending)   │
│ Sensor: ✅ WORKING               │
│ Next Ped: 120s                  │
└────────────────────────────────┘
```

#### 2. **Real-Time Decision Info** (Center Panel):
```
CURRENT CYCLE
═══════════════════════════════════
🎯 Priority Road: SOUTH
🚦 State: GREEN
⏱️  Time Remaining: 2s
🔄 Mode: ULTRASONIC + SENSOR DATA

NEXT IN ROTATION
═══════════════════════════════════
→ EAST (waiting... 6s remaining)
  Has Pedestrian Request: YES ✅
```

#### 3. **Admin Panel** (Only AdminDashboard.js):
```
┌─ TRAFFIC POLICE OVERRIDE ──────┐
│                                │
│ 🟥 FORCE RED                   │
│    Duration (sec): [___3____]  │
│    ✅ APPLY                     │
│                                │
│ 🟨 FORCE YELLOW                │
│    Duration (sec): [___3____]  │
│    ✅ APPLY                     │
│                                │
│ 🟩 FORCE GREEN                 │
│    Duration (sec): [___3____]  │
│    ✅ APPLY                     │
│                                │
│ 🛑 CANCEL OVERRIDE              │
└────────────────────────────────┘
```

**Implementation Note**: When active, ESP32s ignore sensor data and only receive manual commands.

---

## PHASE 4: STEP-BY-STEP DEPLOYMENT GUIDE

### **LOCAL DEVELOPMENT (on Your Laptop)**

#### Step 1: Verify Code Changes
```bash
# Navigate to project folder
cd "d:\SEM6 SAMADHI\CO300-3YP\my-hydra-folder"

# Check that all 4 ESP32 files are updated
ls -la esp32/nawinna_node/esp32_*.ino
```

#### Step 2: Compile ESP32 Code (Arduino IDE)
```
For each ESP32 file (North, South, East, West):
1. Open in Arduino IDE
2. Select: Tools → Board → ESP32-WROOM-32
3. Select: Tools → Port → COM[X]
4. Click: ✔️ Verify (Compile)
5. If successful: Upload (→ button)

Expected Output:
  Sketch uses 1234567 bytes of program storage space
  Global variables use 65432 bytes of dynamic memory
  ...
  Writing at 0x00000000... (100 %)
  ✅ Uploaded successfully!
```

#### Step 3: Update Backend Code
```bash
# Terminal 1: Navigate to server folder
cd server

# Review the changes made
cat index.js | grep -A 5 "ROTATION_ORDER"

# Install any missing dependencies
npm install
```

#### Step 4: Push Changes to GitHub
```bash
# Terminal: From my-hydra-folder root
git add -A
git commit -m "feat: implement ±7cm sensor stability + strict round-robin + pedestrian override"
git push origin priority_updated

# Expected output:
# [priority_updated abc123d] feat: implement ±7cm sensor stability...
# 4 files changed, 150 insertions(+), 45 deletions(-)
```

---

### **CLOUD DEPLOYMENT (AWS - `56.228.30.50`)**

#### Step 5: Connect to AWS Server
```bash
# PowerShell / Terminal
ssh -i C:\Users\samad\Downloads\key.pem ubuntu@56.228.30.50

# If asked to confirm: type 'yes' and press Enter
```

#### Step 6: Update Server Files
```bash
# Once connected to AWS

# Navigate to HYDRA folder
cd ~/HYDRA

# Pull latest code from GitHub
git fetch origin
git checkout priority_updated
git pull origin priority_updated

# Expected output:
# From github.com:cepdnaclk/e21-3yp-HYDRA
#   * branch            priority_updated -> FETCH_HEAD
# Already up to date.
```

#### Step 7: Restart Backend Services
```bash
# Kill any running Node processes
pkill -f "node index.js" || true
pkill -f "npm start" || true

# Wait 2 seconds
sleep 2

# Check MongoDB is running
sudo systemctl status mongod
# If not running: sudo systemctl start mongod

# Install updated dependencies
cd ~/HYDRA/server
npm install

# Start backend server
npm start

# Expected output:
# ✅  MongoDB Connected
# 🔌  MQTT Broker listening on port 1883
# 🚀  Server running on port 5000
```

#### Step 8: Start Frontend
```bash
# Open new SSH window (keep first one running)
ssh -i C:\Users\samad\Downloads\key.pem ubuntu@56.228.30.50

cd ~/HYDRA/client

# Build if needed
npm run build

# Or run development server
npm start

# Expected output:
# Compiled successfully!
# On Your Network: http://56.228.30.50:3000
```

#### Step 9: Verify All Services
```bash
# Check backend is responding
curl http://localhost:5000/api/health

# Expected: { "status": "ok" }

# Check MQTT broker
mosquitto_sub -h localhost -t "traffic/state/North" &
# Wait 5 seconds - you should see messages

# Check frontend is accessible
# Open browser: http://56.228.30.50:3000
```

---

## TERMINAL REFERENCE FOR YOUR NEEDS

### **To View Serial Monitor (ESP32 Diagnostics):**
```
Arduino IDE → Tools → Serial Monitor (or Ctrl+Shift+M)
Baud Rate: 115200
Watch for messages like:
  [US1] 📡 BLOCKED - distance: 45.3 cm
  [US1] ✅ STABLE for 10 seconds
  🚦 NORTH TRAFFIC LEVEL: Light
```

### **To Monitor Backend Decisions (AWS):**
```bash
# SSH into AWS server
ssh -i C:\Users\samad\Downloads\key.pem ubuntu@56.228.30.50

# View live server logs
cd ~/HYDRA/server && npm start

# Watch for:
#  ↪️  Strict Round-Robin: South
#  🚶 [East] PEDESTRIAN OVERRIDE
#  🧠 Decision: [road] gets GREEN
```

### **To Monitor Dashboard:**
Open in browser: `http://56.228.30.50:3000`

Expected Real-Time Updates:
- Traffic light colors changing every 3-9 seconds
- Countdown timers (GREEN → YELLOW → RED)
- Sensor readings updating every 500ms
- Pedestrian indicators lighting up

---

## TROUBLESHOOTING CHECKLIST

### **ESP32 Not Showing Sensor Data:**
- [ ] Check WiFi SSID/Password in code: "Dialog 4G 940" / "Robbin123@hood"
- [ ] Verify MQTT Server IP: "56.228.30.50"
- [ ] Check Serial Monitor at 115200 baud
- [ ] Look for "wifi connected" and "MQTT connected" messages

### **Dashboard Shows "Sensor Not Working":**
- [ ] SSH to AWS and run: `mosquitto_sub -h localhost -t "traffic/ultrasonic/+" | head -5`
- [ ] Should see ultrasonic data within 5 seconds
- [ ] If not: Backend not receiving from ESP32
  - Check: `netstat -tuln | grep 1883`
  - Should show: LISTEN on port 1883

### **Lights Not Changing:**
- [ ] Check: `curl http://localhost:5000/api/health`
- [ ] Check console: `npm start` should show "Decision" messages
- [ ] Verify MongoDB: `mongo` → `show dbs`

### **Traffic Light Staying RED for >10 seconds:**
- [ ] Check if pedestrian is active: Look for 🚶 messages
- [ ] Check decision logs: Should show round-robin or override
- [ ] Verify yellow/green times in backend

---

## EXPECTED SYSTEM BEHAVIOR

### **Scenario 1: All Sensors Working, No Pedestrians**
```
Cycle 1:  NORTH   → GREEN (3s) → YELLOW (3s) → RED (6s)
          SOUTH   → RED (6s)
          EAST    → RED (6s)
          WEST    → RED (6s)

Cycle 2:  NORTH   → RED (6s)
          SOUTH   → GREEN (3s) → YELLOW (3s) → RED (6s)
          EAST    → RED (6s)
          WEST    → RED (6s)

[Continue rotating: NORTH → SOUTH → EAST → WEST → repeat]
```

### **Scenario 2: With Sensor Traffic Detection**
```
Cycle 3:  NORTH   → RED (6s)
          SOUTH   → RED (6s)
          EAST    → GREEN (3s+3s bonus = 6s) → YELLOW (3s) → RED (9s)
            [US1 stable = LIGHT traffic (+3s)]
          WEST    → RED (9s)
```

### **Scenario 3: With Pedestrian Override**
```
ROTATION: N → S → E → W (expected next is EAST)

BUT: WEST has pedestrian button pressed
→ PEDESTRIAN OVERRIDE activates
→ WEST gets priority despite not being next in rotation
→ WEST → GREEN → YELLOW → RED
→ Next rotation continues from where it left off
```

---

## TESTING CHECKLIST

- [ ] **ESP32 Serial Output**: See sensor readings at 115200 baud
- [ ] **Dashboard Traffic Lights**: Change colors every 3-9 seconds
- [ ] **Countdown Timers**: Decrement smoothly (3, 2, 1, 0)
- [ ] **Pedestrian Signal**: RED when main is GREEN/YELLOW, GREEN when crossing
- [ ] **Round-Robin**: Verify NORTH → SOUTH → EAST → WEST rotation
- [ ] **Sensor Stability**: Watch stability % build to 100% over 10 seconds
- [ ] **Traffic Extension**: +3s/+6s green when sensors detect queue
- [ ] **Rain Detection**: YELLOW extends from 3s to 5s
- [ ] **MongoDB**: Data saved to `traffic_data` and `ultrasonic_data` collections

---

## QUICK REFERENCE

| Component | File | Key Change |
|-----------|------|-----------|
| ESP32 North | `esp32_north.ino` | ±7cm stability tracking |
| ESP32 South | `esp32_south.ino` | ±7cm stability tracking |
| ESP32 East | `esp32_east.ino` | ±7cm stability tracking |
| ESP32 West | `esp32_west.ino` | ±7cm stability tracking |
| Backend | `server/index.js` | `ROTATION_ORDER` + pedestrian override |
| Dashboard | `client/src/pages/UserDashboard.js` | (Enhanced visualization in separate PR) |
| Admin | `client/src/pages/AdminDashboard.js` | Add FORCE buttons + timing controls |

---

## NEXT STEPS

1. **Upload ESP32 Code**: Compile and upload all 4 files to their respective boards
2. **Test Locally**: Run backend (`npm start`) and verify console output
3. **Push to GitHub**: Commit and push changes to `priority_updated` branch
4. **Deploy to AWS**: Pull, install, and restart services
5. **Monitor**: Check Serial Monitor, browser dashboard, and AWS logs
6. **Iterate**: Adjust timing if needed, commit changes, push, redeploy

---

## SUPPORT REFERENCE

**System is SAFETY CRITICAL**:
- Sensor stability prevents false vehicle detection
- Round-robin prevents road starvation
- Pedestrian override ensures accessibility
- Strict timing prevents collisions

If anything seems wrong, stop the system and review logs before proceeding.
