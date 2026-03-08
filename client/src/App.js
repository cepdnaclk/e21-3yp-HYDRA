// client/src/App.js  — COMPLETE UPDATED VERSION
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Line } from 'react-chartjs-2';
import { FaCar, FaWalking, FaSatelliteDish, FaMapMarkedAlt } from 'react-icons/fa';
import {
    Chart as ChartJS, CategoryScale, LinearScale, PointElement,
    LineElement, Title, Tooltip, Legend
} from 'chart.js';
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

// Replace with your AWS EC2 Public IP
const API_BASE = 'http://16.171.197.109:5000';

// ── Traffic Light Visual Component ──
const TrafficLight = ({ color }) => (
    <div style={{ background:'#111', padding:'10px', borderRadius:'12px', border:'2px solid #333', display:'flex', flexDirection:'column', gap:'8px' }}>
        {['RED','YELLOW','GREEN'].map(c => (
            <div key={c} style={{
                width:'28px', height:'28px', borderRadius:'50%', transition:'all 0.4s',
                background: color===c ? (c==='RED'?'#ff3333':c==='YELLOW'?'#ffcc00':'#00ff44') : (c==='RED'?'#4a0000':c==='YELLOW'?'#4a3300':'#003300'),
                boxShadow: color===c ? (c==='RED'?'0 0 18px #ff3333':c==='YELLOW'?'0 0 18px #ffcc00':'0 0 18px #00ff44') : 'none'
            }}/>
        ))}
    </div>
);

// ── Traffic Badge Component ──
const TrafficBadge = ({ level }) => {
    const colors = { Heavy:'#ef4444', Medium:'#f59e0b', Light:'#10b981', Unknown:'#6b7280' };
    return <span style={{ background: colors[level]||'#6b7280', color:'white', padding:'2px 10px', borderRadius:'12px', fontSize:'12px', fontWeight:'bold' }}>{level||'---'}</span>;
};

// ── Distance Bar Component ──
const DistanceBar = ({ distance }) => {
    const MAX_DIST = 400;
    const pct = Math.min(100, Math.max(0, ((MAX_DIST - Math.min(distance, MAX_DIST)) / MAX_DIST) * 100));
    const color = pct > 70 ? '#ef4444' : pct > 40 ? '#f59e0b' : '#10b981';
    return (
        <div style={{ marginTop:'6px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px', fontSize:'12px', color:'#94a3b8' }}>
                <span>Proximity to Stop Line</span>
                <span>{distance >= 5000 ? 'No car detected' : `${Math.round(distance)}cm away`}</span>
            </div>
            <div style={{ background:'#334155', borderRadius:'4px', height:'8px' }}>
                <div style={{ width:`${pct}%`, background:color, height:'100%', borderRadius:'4px', transition:'width 0.5s' }}/>
            </div>
        </div>
    );
};

// ── Main App ──
function App() {
    const [trafficInfo, setTrafficInfo]   = useState(null);
    const [decision, setDecision]         = useState(null);
    const [chartHistory, setChartHistory] = useState([]);

    const ROADS = ['North', 'South', 'East', 'West'];

    const fetchAll = async () => {
        try {
            const [trafficRes, decisionRes] = await Promise.all([
                axios.get(`${API_BASE}/api/traffic`),
                axios.get(`${API_BASE}/api/decision`)
            ]);
            setTrafficInfo(trafficRes.data);
            setDecision(decisionRes.data);

            // Append to chart history (keep last 20 points)
            setChartHistory(prev => [...prev.slice(-19), {
                time: new Date().toLocaleTimeString(),
                north: trafficRes.data.ultrasonicReadings?.North || 5000,
                south: trafficRes.data.ultrasonicReadings?.South || 5000,
            }]);
        } catch (e) {
            console.log('Fetch error:', e.message);
        }
    };

    useEffect(() => {
        fetchAll();
        const interval = setInterval(fetchAll, 2000);
        return () => clearInterval(interval);
    }, []);

    const sendCommand = async (road, command) => {
        try {
            await axios.post(`${API_BASE}/api/traffic/control`, { location: road, command });
        } catch (e) { console.error('Control error:', e); }
    };

    const getSignalForRoad = (road) => {
        if (!decision || !decision.commands) return 'RED';
        return decision.commands[road]?.signal || 'RED';
    };

    const chartData = {
        labels: chartHistory.map(h => h.time),
        datasets: [
            { label: 'North Road (cm)', data: chartHistory.map(h => h.north > 400 ? 0 : h.north), borderColor:'#60a5fa', backgroundColor:'rgba(96,165,250,0.1)', tension:0.3 },
            { label: 'South Road (cm)', data: chartHistory.map(h => h.south > 400 ? 0 : h.south), borderColor:'#f87171', backgroundColor:'rgba(248,113,113,0.1)', tension:0.3 },
        ]
    };

    return (
        <div style={{ padding:'20px', fontFamily:'Segoe UI,sans-serif', background:'#0f172a', minHeight:'100vh', color:'white' }}>

            {/* ── Header ── */}
            <div style={{ textAlign:'center', marginBottom:'30px' }}>
                <h1 style={{ fontSize:'2.2rem', margin:0, color:'#e2e8f0' }}>🚦 H.Y.D.R.A Control Center</h1>
                <p style={{ color:'#94a3b8', margin:'6px 0' }}>Nawinna Junction, Kurunegala — Real-time Signal Management</p>
            </div>

            {/* ── Decision Banner ── */}
            {decision && decision.winner && (
                <div style={{ background:'#1e3a5f', border:'1px solid #2E75B6', borderRadius:'12px', padding:'16px 24px', marginBottom:'24px', display:'flex', alignItems:'center', gap:'16px' }}>
                    <span style={{ fontSize:'1.8rem' }}>🧠</span>
                    <div>
                        <div style={{ fontWeight:'bold', fontSize:'1.1rem' }}>Current Decision: <span style={{ color:'#4ade80' }}>{decision.winner} Road → GREEN</span></div>
                        <div style={{ color:'#94a3b8', fontSize:'0.9rem' }}>Green for {decision.greenDuration}s → Yellow {decision.yellowDuration}s → All Red {decision.allRedDuration}s</div>
                    </div>
                </div>
            )}

            {/* ── Road Cards ── */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px,1fr))', gap:'16px', marginBottom:'24px' }}>
                {ROADS.map(road => {
                    const signal  = getSignalForRoad(road);
                    const dist    = trafficInfo?.ultrasonicReadings?.[road] || 5000;
                    const google  = trafficInfo?.googleTraffic?.[road] || 'Unknown';
                    const isWinner = decision?.winner === road;

                    return (
                        <div key={road} style={{ background:'#1e293b', borderRadius:'14px', padding:'20px', border: isWinner ? '2px solid #4ade80' : '1px solid #334155' }}>
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                                <div style={{ flex:1 }}>
                                    <h3 style={{ margin:'0 0 8px', color:'#cbd5e1', textTransform:'uppercase', letterSpacing:'1px', fontSize:'14px' }}>
                                        {road} ROAD {isWinner && <span style={{ color:'#4ade80', fontSize:'12px' }}>● ACTIVE</span>}
                                    </h3>

                                    {/* Ultrasonic Data */}
                                    <div style={{ display:'flex', alignItems:'center', gap:'8px', margin:'8px 0' }}>
                                        <FaSatelliteDish color='#60a5fa' />
                                        <span style={{ fontSize:'13px', color:'#94a3b8' }}>Ultrasonic:</span>
                                        <span style={{ fontWeight:'bold', color: dist < 100 ? '#f87171' : '#e2e8f0' }}>
                                            {dist >= 5000 ? 'No vehicle' : `${Math.round(dist)} cm`}
                                        </span>
                                    </div>
                                    <DistanceBar distance={dist} />

                                    {/* Google Traffic */}
                                    <div style={{ display:'flex', alignItems:'center', gap:'8px', margin:'10px 0' }}>
                                        <FaMapMarkedAlt color='#a78bfa' />
                                        <span style={{ fontSize:'13px', color:'#94a3b8' }}>Next Intersection:</span>
                                        <TrafficBadge level={google} />
                                    </div>

                                    {/* Manual Controls */}
                                    <div style={{ display:'flex', gap:'8px', marginTop:'14px' }}>
                                        <button onClick={()=>sendCommand(road,'RED')}  style={{ background:'#ef5350', color:'white', border:'none', padding:'7px 14px', borderRadius:'6px', cursor:'pointer', fontWeight:'bold', fontSize:'12px' }}>FORCE RED</button>
                                        <button onClick={()=>sendCommand(road,'GREEN')} style={{ background:'#66bb6a', color:'white', border:'none', padding:'7px 14px', borderRadius:'6px', cursor:'pointer', fontWeight:'bold', fontSize:'12px' }}>FORCE GREEN</button>
                                    </div>
                                </div>
                                <TrafficLight color={signal} />
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ── Chart ── */}
            <div style={{ background:'#1e293b', borderRadius:'14px', padding:'20px', marginBottom:'24px' }}>
                <h3 style={{ margin:'0 0 14px', color:'#94a3b8' }}>📊 Live Ultrasonic Distance Trends</h3>
                <Line data={chartData} options={{ responsive:true,
                    plugins:{ legend:{labels:{color:'#94a3b8'}} },
                    scales:{ y:{ticks:{color:'#94a3b8'},grid:{color:'#334155'},title:{display:true,text:'Distance (cm)',color:'#94a3b8'}},
                             x:{ticks:{color:'#94a3b8'},grid:{color:'#334155'}} } }} />
            </div>

            {/* ── Priority Table ── */}
            {decision && decision.priorities && (
                <div style={{ background:'#1e293b', borderRadius:'14px', padding:'20px' }}>
                    <h3 style={{ margin:'0 0 14px', color:'#94a3b8' }}>📋 Signal Priority Analysis</h3>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'14px' }}>
                        <thead>
                            <tr style={{ borderBottom:'1px solid #334155' }}>
                                {['Rank','Road','Distance','Traffic Ahead','Priority Score','Green Time'].map(h => (
                                    <th key={h} style={{ padding:'8px 12px', textAlign:'left', color:'#64748b' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {decision.priorities.map((p, i) => (
                                <tr key={p.road} style={{ borderBottom:'1px solid #1e293b', background: i===0 ? 'rgba(74,222,128,0.08)' : 'transparent' }}>
                                    <td style={{ padding:'8px 12px', color: i===0 ? '#4ade80' : '#94a3b8' }}>#{i+1}</td>
                                    <td style={{ padding:'8px 12px', fontWeight:'bold' }}>{p.road}</td>
                                    <td style={{ padding:'8px 12px', color:'#94a3b8' }}>{p.distance ? `${p.distance}cm` : 'No car'}</td>
                                    <td style={{ padding:'8px 12px' }}><TrafficBadge level={p.traffic} /></td>
                                    <td style={{ padding:'8px 12px', color: p.score>0 ? '#4ade80' : '#f87171' }}>{p.score.toFixed(1)}</td>
                                    <td style={{ padding:'8px 12px', color:'#94a3b8' }}>{p.greenTime ? `${Math.round(p.greenTime)}s` : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export default App;
