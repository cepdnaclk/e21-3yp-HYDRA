// ═══════════════════════════════════════════════════════════════════════════
// server/services/googleTrafficService.js — Google Routes API Integration
// ═══════════════════════════════════════════════════════════════════════════
// 
// WHAT THIS DOES:
//   Checks traffic at the NEXT intersection for each road direction
//   This tells us: "If we let cars through here, will they get stuck next?"
//
// NAWINNA INTERSECTION SETUP:
//   North road → leads to Clocktower Intersection
//   South road → comes FROM Clocktower direction  
//   East road  → leads to Puwakgashandiya intersection
//   West road  → leads to Puwakgashandiya (other direction)
//
// RETURNS: 'Heavy' | 'Medium' | 'Light' | 'Unknown'
//   Unknown = API failed or key not set (system falls back to sensor-only)
// ═══════════════════════════════════════════════════════════════════════════

const axios = require('axios');

// ── Next intersection coordinates (adjust these to your real roads) ──────────
// Origin = Nawinna Intersection (the one we control)
// Destination = next intersection in that direction
const NAWINNA_CENTER = { latitude: 7.4853, longitude: 80.3647 };

const ROAD_SEGMENTS = {
    // North road → leads to Clocktower Junction, Kurunegala
    North: {
        label:       'Nawinna North → Clocktower Junction',
        origin:      NAWINNA_CENTER,
        destination: { latitude: 7.4912, longitude: 80.3651 } // Clocktower
    },
    // South road → southward direction
    South: {
        label:       'Nawinna South Direction',
        origin:      NAWINNA_CENTER,
        destination: { latitude: 7.4790, longitude: 80.3640 }
    },
    // East road → toward Puwakgashandiya
    East: {
        label:       'Nawinna East → Puwakgashandiya',
        origin:      NAWINNA_CENTER,
        destination: { latitude: 7.4855, longitude: 80.3720 } // Puwakgashandiya
    },
    // West road → westward direction
    West: {
        label:       'Nawinna West Direction',
        origin:      NAWINNA_CENTER,
        destination: { latitude: 7.4850, longitude: 80.3580 }
    }
};

// ── Convert Google API ratio to our traffic level ────────────────────────────
// ratio = (time with traffic) / (time without traffic)
// ratio 1.0 = free flowing
// ratio 2.0 = double the normal travel time = Heavy
function ratioToLevel(ratio) {
    if (ratio >= 2.0)       return 'Heavy';
    else if (ratio >= 1.3)  return 'Medium';
    else                    return 'Light';
}

// ── Fetch traffic for ONE road direction ─────────────────────────────────────
async function getTrafficCondition(road) {
    const segment = ROAD_SEGMENTS[road];
    if (!segment) return 'Unknown';

    // If no API key configured, return Unknown (fallback mode)
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
        return 'Unknown';
    }

    try {
        const response = await axios.post(
            'https://routes.googleapis.com/directions/v2:computeRoutes',
            {
                origin:            { location: { latLng: segment.origin } },
                destination:       { location: { latLng: segment.destination } },
                travelMode:        'DRIVE',
                routingPreference: 'TRAFFIC_AWARE'  // Real-time traffic data
            },
            {
                headers: {
                    'Content-Type':    'application/json',
                    'X-Goog-Api-Key':  apiKey,
                    // Only request what we need — saves API quota credits
                    'X-Goog-FieldMask': 'routes.duration,routes.staticDuration'
                },
                timeout: 5000 // 5 second timeout — don't block the system
            }
        );

        const route = response.data?.routes?.[0];
        if (!route) return 'Unknown';

        // duration = with live traffic (e.g., "245s")
        // staticDuration = without any traffic (e.g., "120s")
        const withTraffic    = parseInt(route.duration?.replace('s', '') || '0');
        const withoutTraffic = parseInt(route.staticDuration?.replace('s', '') || '1');

        if (withoutTraffic === 0) return 'Unknown';

        const ratio = withTraffic / withoutTraffic;
        const level = ratioToLevel(ratio);

        console.log(`🗺️   [${road}] ${segment.label}: ratio=${ratio.toFixed(2)} → ${level}`);
        return level;

    } catch (error) {
        // Common errors:
        // 403 = API key invalid or billing not enabled
        // 429 = Quota exceeded
        // ECONNREFUSED / ETIMEDOUT = Network issue
        if (error.response?.status === 403) {
            console.log(`⚠️   [${road}] Google API: Invalid key or billing disabled`);
        } else if (error.response?.status === 429) {
            console.log(`⚠️   [${road}] Google API: Quota exceeded`);
        } else {
            console.log(`⚠️   [${road}] Google API: ${error.message}`);
        }
        return 'Unknown'; // Safe fallback — system continues with sensor data
    }
}

// ── Fetch traffic for ALL 4 roads simultaneously ─────────────────────────────
// Uses Promise.all so all 4 requests run in parallel (faster)
async function getAllTrafficConditions() {
    const [north, south, east, west] = await Promise.all([
        getTrafficCondition('North'),
        getTrafficCondition('South'),
        getTrafficCondition('East'),
        getTrafficCondition('West')
    ]);

    return { North: north, South: south, East: east, West: west };
}

module.exports = { getAllTrafficConditions, getTrafficCondition };