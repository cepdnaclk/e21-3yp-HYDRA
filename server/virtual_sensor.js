const mqtt = require('mqtt');

// Connect to your own MQTT Broker
const client = mqtt.connect('mqtt://localhost:1883');

client.on('connect', () => {
    console.log('📡 Virtual Sensor is Online!');

    // Send data every 5 seconds
    setInterval(() => {
        const trafficReport = {
            location: "Galle Road",
            congestionLevel: Math.random() > 0.5 ? "High" : "Low",
            vehicleCount: Math.floor(Math.random() * 100),
            timestamp: new Date()
        };

        // Publish to the topic your backend is listening to
        client.publish('traffic/data', JSON.stringify(trafficReport));
        
        console.log(`📤 Data Sent: ${trafficReport.location} - ${trafficReport.congestionLevel}`);
    }, 5000);
});