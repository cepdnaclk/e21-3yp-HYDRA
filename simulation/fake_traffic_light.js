// simulation/fake_traffic_light.js
const mqtt = require('mqtt');

// Connect to your laptop's MQTT Broker
const client = mqtt.connect('mqtt://localhost:1883');

const roads = ["North", "South", "East", "West"];

client.on('connect', () => {
    console.log("✅ Simulator Connected to HYDRA Brain!");

    // Send fake data every 3 seconds
    setInterval(() => {
        // Pick a random road
        const road = roads[Math.floor(Math.random() * roads.length)];
        
        // Generate random traffic stats
        const vehicles = Math.floor(Math.random() * 20);
        let congestion = "Low";
        if (vehicles > 15) congestion = "High";
        else if (vehicles > 5) congestion = "Medium";

        const data = {
            location: road,
            congestionLevel: congestion,
            vehicleCount: vehicles
        };

        // Publish to the topic "traffic/data"
        client.publish('traffic/data', JSON.stringify(data));
        console.log(`📤 Sent Update: ${road} Road has ${vehicles} cars.`);

    }, 3000);
});