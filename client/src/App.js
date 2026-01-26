// import React, { useState, useEffect } from 'react';
// import axios from 'axios';
// import { Line } from 'react-chartjs-2';
// import {
//   Chart as ChartJS,
//   CategoryScale,
//   LinearScale,
//   PointElement,
//   LineElement,
//   Title,
//   Tooltip,
//   Legend,
// } from 'chart.js';
// import './App.css';

// // Register Chart.js components
// ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

// function App() {
//   const [trafficData, setTrafficData] = useState([]);

//   const fetchTraffic = () => {
//     axios.get('http://localhost:5000/api/traffic')
//       .then(response => setTrafficData(response.data))
//       .catch(error => console.log("Error fetching data:", error));
//   };

//   const sendCommand = async (location, command) => {
//     try {
//       await axios.post('http://localhost:5000/api/traffic/control', { location, command });
//       alert(`Command ${command} sent to ${location}`);
//     } catch (error) {
//       console.error("Control error:", error);
//     }
//   };

//   useEffect(() => {
//     const interval = setInterval(fetchTraffic, 2000);
//     return () => clearInterval(interval);
//   }, []);

//   // Prepare Chart Data
//   const chartData = {
//     labels: trafficData.map(d => new Date(d.timestamp).toLocaleTimeString()).reverse(),
//     datasets: [
//       {
//         label: 'Vehicle Count Trend',
//         data: trafficData.map(d => d.vehicleCount).reverse(),
//         borderColor: 'rgb(75, 192, 192)',
//         backgroundColor: 'rgba(75, 192, 192, 0.2)',
//         tension: 0.3,
//       },
//     ],
//   };

//   return (
//     <div style={{ padding: '20px', fontFamily: 'Arial', backgroundColor: '#f4f7f6', minHeight: '100vh' }}>
//       <h1>🚦 H.Y.D.R.A Control Center</h1>
      
//       {/* Chart Section */}
//       <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '15px', marginBottom: '30px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
//         <Line data={chartData} options={{ responsive: true, plugins: { legend: { position: 'top' } } }} />
//       </div>

//       <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px' }}>
//         {trafficData.length === 0 ? <p>Waiting for sensor data...</p> : 
//           trafficData.map((road, index) => (
//             <div key={index} style={{ 
//               border: '1px solid #ddd', 
//               padding: '20px', 
//               borderRadius: '12px',
//               backgroundColor: road.congestionLevel === 'High' ? '#ffebee' : '#e8f5e9',
//               minWidth: '280px',
//               boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
//             }}>
//               <h2>{road.location}</h2>
//               <p>Congestion: <strong>{road.congestionLevel}</strong></p>
//               <p>Vehicles: {road.vehicleCount}</p>
//               <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
//                 <button onClick={() => sendCommand(road.location, 'RED')} style={{ backgroundColor: '#ef5350', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '5px', cursor: 'pointer' }}>Red</button>
//                 <button onClick={() => sendCommand(road.location, 'GREEN')} style={{ backgroundColor: '#66bb6a', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '5px', cursor: 'pointer' }}>Green</button>
//               </div>
//             </div>
//           ))
//         }
//       </div>
//     </div>
//   );
// }

// export default App;



import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Line } from 'react-chartjs-2';
import { FaCar, FaWalking } from 'react-icons/fa';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

// --- Sub-Component: Traffic Light Visual ---
const TrafficLight = ({ color }) => (
  <div style={{
    background: '#222', padding: '10px', borderRadius: '12px',
    border: '2px solid #444', display: 'flex', flexDirection: 'column', gap: '8px'
  }}>
    <div style={{
      width: '25px', height: '25px', borderRadius: '50%',
      background: color === 'RED' ? '#ff3333' : '#4a0000',
      boxShadow: color === 'RED' ? '0 0 15px #ff3333' : 'none',
      transition: 'all 0.3s'
    }}/>
    <div style={{
      width: '25px', height: '25px', borderRadius: '50%',
      background: color === 'YELLOW' ? '#ffcc00' : '#4a3300',
      boxShadow: color === 'YELLOW' ? '0 0 15px #ffcc00' : 'none',
      transition: 'all 0.3s'
    }}/>
    <div style={{
      width: '25px', height: '25px', borderRadius: '50%',
      background: color === 'GREEN' ? '#00ff44' : '#003300',
      boxShadow: color === 'GREEN' ? '0 0 15px #00ff44' : 'none',
      transition: 'all 0.3s'
    }}/>
  </div>
);

function App() {
  const [trafficData, setTrafficData] = useState([]);

  const fetchTraffic = () => {
    axios.get('http://localhost:5000/api/traffic')
      .then(response => setTrafficData(response.data))
      .catch(error => console.log("Error fetching data:", error));
  };

  const sendCommand = async (location, command) => {
    try {
      await axios.post('http://localhost:5000/api/traffic/control', { location, command });
      // Note: In a real app, you might update local state here to show the light change instantly
    } catch (error) {
      console.error("Control error:", error);
    }
  };

  useEffect(() => {
    const interval = setInterval(fetchTraffic, 2000);
    return () => clearInterval(interval);
  }, []);

  const chartData = {
    labels: trafficData.map(d => new Date(d.timestamp).toLocaleTimeString()).reverse(),
    datasets: [
      {
        label: 'Vehicle Count Trend',
        data: trafficData.map(d => d.vehicleCount).reverse(),
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        tension: 0.3,
      },
    ],
  };

  return (
    <div style={{ padding: '30px', fontFamily: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif', backgroundColor: '#0f172a', minHeight: '100vh', color: 'white' }}>
      <header style={{ marginBottom: '40px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '2.5rem', margin: '0' }}>🚦 H.Y.D.R.A Control Center</h1>
        <p style={{ color: '#94a3b8' }}>Real-time Traffic Intelligence & Signal Management</p>
      </header>
      
      {/* Chart Section */}
      <div style={{ backgroundColor: '#1e293b', padding: '20px', borderRadius: '15px', marginBottom: '40px', boxShadow: '0 10px 25px rgba(0,0,0,0.3)' }}>
        <Line 
          data={chartData} 
          options={{ 
            responsive: true, 
            plugins: { legend: { labels: { color: 'white' } } },
            scales: {
                y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
                x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
            }
          }} 
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '20px' }}>
        {trafficData.length === 0 ? (
            <div style={{ textAlign: 'center', width: '100%' }}>
                <p>Connecting to H.Y.D.R.A sensor network...</p>
            </div>
        ) : (
          trafficData.map((road, index) => (
            <div key={index} style={{ 
              background: '#1a202c', 
              padding: '25px', 
              borderRadius: '15px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              boxShadow: '0 4px 6px rgba(0,0,0,0.2)',
              border: road.congestionLevel === 'High' ? '1px solid #ef4444' : '1px solid #334155'
            }}>
                <div style={{ flex: 1 }}>
                    <h3 style={{ margin: 0, color: '#a0aec0', textTransform: 'uppercase', letterSpacing: '1px', fontSize: '14px' }}>
                        {road.location}
                    </h3>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px' }}>
                        <FaCar size={24} color={road.congestionLevel === 'High' ? '#ef4444' : '#10b981'} />
                        <span style={{ fontSize: '28px', fontWeight: 'bold' }}>{road.vehicleCount}</span>
                        <span style={{ fontSize: '14px', color: '#718096' }}>Cars</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#63b3ed', marginTop: '10px', fontSize: '14px' }}>
                        <FaWalking /> 
                        <span>Pedestrian Sync: Active</span>
                    </div>

                    <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                        <button 
                            onClick={() => sendCommand(road.location, 'RED')} 
                            style={{ backgroundColor: '#ef5350', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                            FORCE RED
                        </button>
                        <button 
                            onClick={() => sendCommand(road.location, 'GREEN')} 
                            style={{ backgroundColor: '#66bb6a', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                            FORCE GREEN
                        </button>
                    </div>
                </div>
                
                {/* Dynamic Traffic Light Visual */}
                <TrafficLight color={road.currentStatus || (road.vehicleCount > 10 ? 'RED' : 'GREEN')} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default App;