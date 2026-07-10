// ═══════════════════════════════════════════════════════════════════════════
// server/services/googleTrafficService.js — FIXED v2.0
// FIX 1: API key now read correctly from env OR fallback hardcoded constant
// FIX 2: Duration parsing fixed (Google returns "245s" string)
// FIX 3: Added detailed debug logging so you can see exactly what fails
// FIX 4: Added axios import (was missing in some setups)
// ═══════════════════════════════════════════════════════════════════════════

const axios = require('axios');

// ── YOUR API KEY ─────────────────────────────────────────────────────────────
// OPTION A (recommended): Set GOOGLE_MAPS_API_KEY=your_key in your .env file
// OPTION B (fallback):    Paste key directly below as HARDCODED_KEY
const HARDCODED_KEY = 'AIzaSyCFC9cyA092-tcIcLsmwofz_g-RBZCt-00';

function getApiKey() {
    return process.env.GOOGLE_MAPS_API_KEY || HARDCODED_KEY;
}

// ── Nawinna junction center coordinates ──────────────────────────────────────
const NAWINNA_CENTER = { latitude: 7.4853, longitude: 80.3647 };

const ROAD_SEGMENTS = {
    North: {
        label:       'Nawinna North → Clocktower Junction',
        origin:      NAWINNA_CENTER,
        destination: { latitude: 7.4912, longitude: 80.3651 }
    },
    South: {
        label:       'Nawinna South Direction',
        origin:      NAWINNA_CENTER,
        destination: { latitude: 7.4790, longitude: 80.3640 }
    },
    East: {
        label:       'Nawinna East → Puwakgashandiya',
        origin:      NAWINNA_CENTER,
        destination: { latitude: 7.4855, longitude: 80.3720 }
    },
    West: {
        label:       'Nawinna West Direction',
        origin:      NAWINNA_CENTER,
        destination: { latitude: 7.4850, longitude: 80.3580 }
    }
};

// ── Convert delay ratio to traffic level ─────────────────────────────────────
function ratioToLevel(ratio) {
    if (ratio >= 2.0)      return 'Heavy';
    else if (ratio >= 1.3) return 'Medium';
    else                   return 'Light';
}

// ── Parse duration string safely ─────────────────────────────────────────────
// Google returns "245s" or sometimes just a number
function parseDurationSeconds(durationValue) {
    if (!durationValue) return 0;
    if (typeof durationValue === 'number') return durationValue;
    if (typeof durationValue === 'string') {
        // Remove trailing 's' and parse
        const cleaned = durationValue.replace(/s$/i, '').trim();
        const parsed = parseInt(cleaned, 10);
        return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
}

// ── Fetch traffic for ONE road direction ─────────────────────────────────────
async function getTrafficCondition(road) {
    const segment = ROAD_SEGMENTS[road];
    if (!segment) {
        console.log(`⚠️  [${road}] No road segment defined`);
        return 'Unknown';
    }

    const apiKey = getApiKey();
    if (!apiKey) {
        console.log(`⚠️  [${road}] No Google Maps API key configured`);
        return 'Unknown';
    }

    try {
        console.log(`🗺️  [${road}] Calling Google Routes API...`);

        const response = await axios.post(
            'https://routes.googleapis.com/directions/v2:computeRoutes',
            {
                origin:            { location: { latLng: segment.origin } },
                destination:       { location: { latLng: segment.destination } },
                travelMode:        'DRIVE',
                routingPreference: 'TRAFFIC_AWARE'
            },
            {
                headers: {
                    'Content-Type':     'application/json',
                    'X-Goog-Api-Key':   apiKey,
                    'X-Goog-FieldMask': 'routes.duration,routes.staticDuration'
                },
                timeout: 8000
            }
        );

        // ── Debug: log what Google actually returned ──────────────────────
        const rawRoutes = response.data?.routes;
        console.log(`🗺️  [${road}] Raw API response:`, JSON.stringify(response.data).substring(0, 300));

        if (!rawRoutes || rawRoutes.length === 0) {
            console.log(`⚠️  [${road}] No routes returned by Google API`);
            return 'Unknown';
        }

        const route = rawRoutes[0];

        // duration = with live traffic, staticDuration = without traffic
        const withTraffic    = parseDurationSeconds(route.duration);
        const withoutTraffic = parseDurationSeconds(route.staticDuration);

        console.log(`🗺️  [${road}] Parsed durations — withTraffic: ${withTraffic}s, withoutTraffic: ${withoutTraffic}s`);

        if (withoutTraffic === 0) {
            console.log(`⚠️  [${road}] staticDuration is 0 — cannot compute ratio`);
            return 'Unknown';
        }

        const ratio = withTraffic / withoutTraffic;
        const level = ratioToLevel(ratio);

        console.log(`✅  [${road}] ${segment.label}: ratio=${ratio.toFixed(2)} → ${level}`);
        return level;

    } catch (error) {
        if (error.response) {
            const status = error.response.status;
            const body   = JSON.stringify(error.response.data).substring(0, 400);
            console.log(`❌  [${road}] Google API HTTP ${status}: ${body}`);

            if (status === 400) console.log(`    → Check request body / coordinates`);
            if (status === 403) console.log(`    → API key invalid, billing not enabled, or Routes API not enabled in Google Cloud`);
            if (status === 429) console.log(`    → Quota exceeded`);
        } else if (error.code === 'ECONNABORTED') {
            console.log(`❌  [${road}] Google API timeout (8s)`);
        } else {
            console.log(`❌  [${road}] Google API error: ${error.message}`);
        }
        return 'Unknown';
    }
}

// ── Fetch traffic for ALL 4 roads in parallel ─────────────────────────────────
async function getAllTrafficConditions() {
    console.log('🗺️  Fetching Google Traffic for all roads...');
    const [north, south, east, west] = await Promise.all([
        getTrafficCondition('North'),
        getTrafficCondition('South'),
        getTrafficCondition('East'),
        getTrafficCondition('West')
    ]);

    const result = { North: north, South: south, East: east, West: west };
    const anyReal = Object.values(result).some(v => v !== 'Unknown');
    console.log(`🗺️  Google Traffic result: ${JSON.stringify(result)} | Working: ${anyReal}`);
    return result;
}

//module.exports = { getAllTrafficConditions, getTrafficCondition };
module.exports = { getAllTrafficConditions, getTrafficCondition, ratioToLevel, parseDurationSeconds };