// server/services/googleTrafficService.js
const axios = require('axios');

// ─────────────────────────────────────────────────────────────
// ROAD SEGMENTS WE MONITOR
// Each entry = one road leading from Nawinna to next intersection
// ─────────────────────────────────────────────────────────────
const ROAD_SEGMENTS = {
    // Nawinna North Road → leads to Clocktower Intersection
    North: {
        label: 'Nawinna North → Clocktower',
        origin: { latitude: 7.4853, longitude: 80.3647 },
        destination: { latitude: 7.4912, longitude: 80.3651 }
    },
    // Nawinna South Road → leads away from Clocktower
    South: {
        label: 'Nawinna South Direction',
        origin: { latitude: 7.4853, longitude: 80.3647 },
        destination: { latitude: 7.4790, longitude: 80.3640 }
    },
    // Nawinna East Road
    East: {
        label: 'Nawinna East Direction',
        origin: { latitude: 7.4853, longitude: 80.3647 },
        destination: { latitude: 7.4855, longitude: 80.3720 }
    },
    // Nawinna West Road → leads to Puwakgashandiya
    West: {
        label: 'Nawinna West → Puwakgashandiya',
        origin: { latitude: 7.4853, longitude: 80.3647 },
        destination: { latitude: 7.4850, longitude: 80.3580 }
    }
};

// ─────────────────────────────────────────────────────────────
// getTrafficCondition()
// Calls Google Routes API for ONE road direction
// Returns: 'Heavy', 'Medium', or 'Light'
// ─────────────────────────────────────────────────────────────
async function getTrafficCondition(road) {
    const segment = ROAD_SEGMENTS[road];
    if (!segment) return 'Unknown';

    try {
        const response = await axios.post(
            'https://routes.googleapis.com/directions/v2:computeRoutes',
            {
                origin: { location: { latLng: segment.origin } },
                destination: { location: { latLng: segment.destination } },
                travelMode: 'DRIVE',
                routingPreference: 'TRAFFIC_AWARE'  // This triggers real traffic data
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    // We only need duration fields — saves API quota
                    'X-Goog-FieldMask': 'routes.duration,routes.staticDuration'
                }
            }
        );

        const route = response.data.routes[0];
        if (!route) return 'Unknown';

        // duration = current travel time with traffic (in seconds, returned as "Xs" string)
        // staticDuration = travel time with NO traffic
        const withTraffic = parseInt(route.duration.replace('s', ''));
        const withoutTraffic = parseInt(route.staticDuration.replace('s', ''));

        // Calculate congestion ratio
        const ratio = withTraffic / withoutTraffic;

        if (ratio >= 2.0)       return 'Heavy';
        else if (ratio >= 1.2)  return 'Medium';
        else                    return 'Light';

    } catch (error) {
        console.error('Google API Error for', road, ':', error.message);
        return 'Unknown';  // Safe fallback
    }
}

// ─────────────────────────────────────────────────────────────
// getAllTrafficConditions()
// Fetches traffic for all 4 roads simultaneously
// Returns: { North: 'Heavy', South: 'Light', East: 'Medium', West: 'Light' }
// ─────────────────────────────────────────────────────────────
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

