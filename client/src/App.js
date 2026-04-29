// // client/src/App.js — HYDRA Dashboard v4.0 — Backend-Aligned + Analytics
// import React, { useState, useEffect, useRef } from 'react';
// import io from 'socket.io-client';
// import axios from 'axios';
// import { Line } from 'react-chartjs-2';
// import {
//     Chart as ChartJS, CategoryScale, LinearScale, PointElement,
//     LineElement, Title, Tooltip, Legend
// } from 'chart.js';

// ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

// const SERVER = 'http://56.228.30.50:5000';
// const ROADS  = ['North', 'South', 'East', 'West'];

// // ─────────────────────────────────────────────────────────────────────────────
// // Reusable components
// // ─────────────────────────────────────────────────────────────────────────────

// const Bulb = ({ color, active, size = 36 }) => {
//     const colors = {
//         RED:    { on: '#ef4444', off: '#3a0000', glow: '#ef4444' },
//         YELLOW: { on: '#f59e0b', off: '#3a2e00', glow: '#f59e0b' },
//         GREEN:  { on: '#22c55e', off: '#003310', glow: '#22c55e' },
//     };
//     const c = colors[color];
//     return (
//         <div style={{
//             width: size, height: size, borderRadius: '50%',
//             background: active ? c.on : c.off,
//             boxShadow: active ? `0 0 14px ${c.glow}, 0 0 28px ${c.glow}` : 'none',
//             transition: 'all 0.3s ease'
//         }} />
//     );
// };

// const TrafficBadge = ({ level }) => {
//     const map = {
//         Heavy:   { bg: '#7f1d1d', color: '#f87171', border: '#ef4444' },
//         Medium:  { bg: '#713f12', color: '#fde047', border: '#f59e0b' },
//         Light:   { bg: '#14532d', color: '#4ade80', border: '#22c55e' },
//         Unknown: { bg: '#1e293b', color: '#64748b', border: '#334155' },
//     };
//     const s = map[level] || map.Unknown;
//     return (
//         <span style={{
//             background: s.bg, color: s.color, border: `1px solid ${s.border}`,
//             padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 'bold'
//         }}>{level || 'Unknown'}</span>
//     );
// };

// // Sensor Scenario Badge — shows IR vs ULTRASONIC mode per road
// const ScenarioBadge = ({ scenario }) => {
//     const map = {
//         IR:          { bg: '#3b1f69', color: '#c084fc', border: '#a855f7', icon: '🔦', label: 'IR MODE' },
//         ULTRASONIC:  { bg: '#1e3a5f', color: '#60a5fa', border: '#3b82f6', icon: '📡', label: 'ULTRASONIC' },
//         GOOGLE_ONLY: { bg: '#1e293b', color: '#94a3b8', border: '#475569', icon: '🗺️', label: 'GOOGLE ONLY' },
//         FALLBACK:    { bg: '#3d2000', color: '#fb923c', border: '#f59e0b', icon: '⚠️', label: 'FALLBACK' },
//     };
//     const s = map[scenario] || map.FALLBACK;
//     return (
//         <span style={{
//             background: s.bg, color: s.color, border: `1px solid ${s.border}`,
//             padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 'bold',
//             display: 'inline-flex', alignItems: 'center', gap: 4
//         }}>{s.icon} {s.label}</span>
//     );
// };

// const ProximityBar = ({ distanceCm }) => {
//     const noVehicle = !distanceCm || distanceCm >= 5000;
//     const MAX = 400;
//     const pct = noVehicle ? 0 : Math.min(100, ((MAX - Math.min(distanceCm, MAX)) / MAX) * 100);
//     const color = pct > 70 ? '#ef4444' : pct > 40 ? '#f59e0b' : '#10b981';
//     return (
//         <div>
//             <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginBottom: 3 }}>
//                 <span>Proximity to Stop Line</span>
//                 <span style={{ fontWeight: 'bold', color: noVehicle ? '#475569' : color }}>
//                     {noVehicle ? 'No vehicle' : `${Math.round(distanceCm)}cm`}
//                 </span>
//             </div>
//             <div style={{ background: '#1e3a5f', borderRadius: 4, height: 6 }}>
//                 <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 4, transition: 'width 0.5s' }} />
//             </div>
//         </div>
//     );
// };

// const ForcePanel = ({ road, onForce }) => {
//     const [dur, setDur] = useState(30);
//     return (
//         <div style={{ marginTop: 12, padding: 12, background: '#0f172a', borderRadius: 10, border: '1px solid #334155' }}>
//             <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8, letterSpacing: 1 }}>🚨 TRAFFIC POLICE OVERRIDE</div>
//             <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
//                 <span style={{ fontSize: 11, color: '#94a3b8' }}>Duration (s):</span>
//                 <input type="number" value={dur} min={5} max={300}
//                     onChange={e => setDur(parseInt(e.target.value) || 30)}
//                     style={{ width: 55, background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: 'white', padding: '3px 6px', fontSize: 13 }}
//                 />
//             </div>
//             <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
//                 {[
//                     { cmd: 'RED',    bg: '#7f1d1d', col: '#f87171', border: '#ef4444', icon: '🔴' },
//                     { cmd: 'YELLOW', bg: '#713f12', col: '#fde047', border: '#f59e0b', icon: '🟡' },
//                     { cmd: 'GREEN',  bg: '#14532d', col: '#4ade80', border: '#22c55e', icon: '🟢' },
//                 ].map(b => (
//                     <button key={b.cmd} onClick={() => onForce(road, b.cmd, dur)}
//                         style={{ background: b.bg, color: b.col, border: `1px solid ${b.border}`, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 11 }}>
//                         {b.icon} FORCE {b.cmd}
//                     </button>
//                 ))}
//             </div>
//         </div>
//     );
// };

// // IR Traffic Density Badge
// const TrafficDensityBadge = ({ density }) => {
//     const map = {
//         'Heavy':   { bg: '#7f1d1d', color: '#f87171', icon: '🔴', label: 'HEAVY (+6s Green)' },
//         'Light':   { bg: '#713f12', color: '#fde047', icon: '🟡', label: 'LIGHT (+3s Green)' },
//         'None':    { bg: '#14532d', color: '#4ade80', icon: '🟢', label: 'NO TRAFFIC (3s base)' },
//         'Unknown': { bg: '#1e293b', color: '#64748b', icon: '❓', label: 'UNKNOWN' },
//     };
//     const s = map[density] || map.Unknown;
//     return (
//         <div style={{
//             background: s.bg, color: s.color, border: `1px solid ${s.color}44`,
//             padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 'bold',
//             display: 'inline-flex', alignItems: 'center', gap: 6
//         }}>
//             <span>{s.icon}</span> {s.label}
//         </div>
//     );
// };

// // ─────────────────────────────────────────────────────────────────────────────
// // Main App
// // ─────────────────────────────────────────────────────────────────────────────
// function App() {
//     const [livePhase,     setLivePhase]     = useState({ North:'RED', South:'RED', East:'RED', West:'RED' });
//     const [liveCountdown, setLiveCountdown] = useState({ North:0, South:0, East:0, West:0 });
//     const [sensorData,    setSensorData]    = useState({ North:5000, South:5000, East:5000, West:5000 });
//     const [googleTraffic, setGoogleTraffic] = useState({ North:'Unknown', South:'Unknown', East:'Unknown', West:'Unknown' });
//     const [sensorWorking, setSensorWorking] = useState({});
//     const [googleWorking, setGoogleWorking] = useState(false);
//     const [irData,        setIrData]        = useState({
//         North: { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' },
//         South: { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' },
//         East:  { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' },
//         West:  { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' }
//     });
//     const [rainDetected,  setRainDetected]  = useState(false);
//     const [yellowTime,    setYellowTime]    = useState(3);
//     const [redTime,       setRedTime]       = useState(0);
//     const [greenTime,     setGreenTime]     = useState({ North:3, South:3, East:3, West:3 });
//     const [pedStatus,     setPedStatus]     = useState({});
//     const [decision,      setDecision]      = useState(null);
//     const [connected,     setConnected]     = useState(false);
//     const [chartHistory,  setChartHistory]  = useState([]);
//     const [notification,  setNotification]  = useState(null);

//     // ── Analytics state (Step 9) ──────────────────────────────────────────────
//     const [analyticsData, setAnalyticsData] = useState({
//         peakHours: [],
//         roadPerf: [],
//         efficiency: { modeBreakdown: [], last1Hour: {}, totalCycles24h: 0 }
//     });
//     const [analyticsTab, setAnalyticsTab] = useState('congestion');

//     const socketRef = useRef(null);

//     const showNotif = (msg, type = 'info') => {
//         setNotification({ msg, type });
//         setTimeout(() => setNotification(null), 4000);
//     };

//     useEffect(() => {
//         const socket = io(SERVER, { transports: ['websocket', 'polling'] });
//         socketRef.current = socket;

//         socket.on('connect',    () => setConnected(true));
//         socket.on('disconnect', () => setConnected(false));

//         socket.on('fullState', data => {
//             if (data.livePhase)       setLivePhase(data.livePhase);
//             if (data.liveCountdown)   setLiveCountdown(data.liveCountdown);
//             if (data.sensorData)      setSensorData(data.sensorData);
//             if (data.googleTraffic)   setGoogleTraffic(data.googleTraffic);
//             if (data.latestDecision)  setDecision(data.latestDecision);
//             if (data.sensorWorking)   setSensorWorking(data.sensorWorking);
//             if (data.googleWorking !== undefined) setGoogleWorking(data.googleWorking);
//             if (data.irData)          setIrData(data.irData);
//             if (data.rainDetected !== undefined) {
//                 setRainDetected(data.rainDetected);
//                 setYellowTime(data.rainDetected ? 5 : 3);
//             }
//             if (data.redTime !== undefined) setRedTime(data.redTime);
//             if (data.greenTime)       setGreenTime(data.greenTime);
//             if (data.pedStatus)       setPedStatus(data.pedStatus);

//             setChartHistory(prev => {
//                 const e = {
//                     time:  new Date().toLocaleTimeString(),
//                     North: data.sensorData?.North >= 5000 ? null : data.sensorData?.North,
//                     South: data.sensorData?.South >= 5000 ? null : data.sensorData?.South,
//                     East:  data.sensorData?.East  >= 5000 ? null : data.sensorData?.East,
//                     West:  data.sensorData?.West  >= 5000 ? null : data.sensorData?.West,
//                 };
//                 return [...prev.slice(-29), e];
//             });
//         });

//         socket.on('countdown',         ({ road, phase, remaining }) => {
//             setLiveCountdown(p => ({ ...p, [road]: remaining }));
//             setLivePhase(p => ({ ...p, [road]: phase }));
//         });
//         socket.on('ledStateUpdate',    ({ road, state }) => setLivePhase(p => ({ ...p, [road]: state })));
//         socket.on('newDecision',       dec => setDecision(dec));
//         socket.on('sensorUpdate',      ({ road, distanceCm }) => setSensorData(p => ({ ...p, [road]: distanceCm })));
//         socket.on('irUpdate',          ({ road, ir1Blocked, ir2Blocked, queueLevel }) => {
//             setIrData(prev => ({ ...prev, [road]: { ir1Blocked, ir2Blocked, queueLevel: queueLevel || 'None' } }));
//         });
//         socket.on('rainUpdate',        ({ rainDetected: r, yellowTime: y }) => {
//             setRainDetected(r);
//             setYellowTime(r ? 5 : 3);
//         });
//         socket.on('pedestrianUpdate',  ({ road, ...rest }) => setPedStatus(p => ({ ...p, [road]: rest })));
//         socket.on('googleTrafficUpdate', ({ googleTraffic: gt, googleWorking: gw }) => {
//             setGoogleTraffic(gt);
//             setGoogleWorking(gw);
//         });

//         // ── Analytics socket listener (Step 9) ───────────────────────────────
//         socket.on('analyticsUpdate', (data) => {
//             setAnalyticsData({
//                 peakHours: data.peakHours || [],
//                 roadPerf: data.roadPerf || [],
//                 efficiency: data.efficiency || { modeBreakdown: [], last1Hour: {}, totalCycles24h: 0 }
//             });
//         });

//         // ── Load analytics on first connect (Step 9) ─────────────────────────
//         axios.get(`${SERVER}/api/analytics/road-performance`).then(r => {
//             setAnalyticsData(prev => ({ ...prev, roadPerf: r.data }));
//         }).catch(() => {});
//         axios.get(`${SERVER}/api/analytics/peak-hours`).then(r => {
//             setAnalyticsData(prev => ({ ...prev, peakHours: r.data }));
//         }).catch(() => {});
//         axios.get(`${SERVER}/api/analytics/system-efficiency`).then(r => {
//             setAnalyticsData(prev => ({ ...prev, efficiency: r.data }));
//         }).catch(() => {});

//         return () => socket.disconnect();
//     }, []);

//     const handleForce = async (road, command, duration) => {
//         try {
//             await axios.post(`${SERVER}/api/traffic/control`, { location: road, command, duration });
//             showNotif(`✅ Force ${command} → ${road} for ${duration}s`, 'success');
//         } catch (err) {
//             showNotif(`❌ Failed: ${err.message}`, 'error');
//         }
//     };

//     const chartData = {
//         labels: chartHistory.map(h => h.time),
//         datasets: ROADS.map((road, i) => ({
//             label: `${road} (cm)`,
//             data:  chartHistory.map(h => h[road]),
//             borderColor: ['#60a5fa','#f87171','#a78bfa','#34d399'][i],
//             tension: 0.3, spanGaps: false
//         }))
//     };

//     const winner       = decision?.winner;
//     const redForOthers = decision?.redForOthers || redTime || 0;

//     const scenarioMap = {};
//     if (decision?.priorities) {
//         decision.priorities.forEach(p => { scenarioMap[p.road] = p.sensorScenario; });
//     }

//     const decisionGreenMap = {};
//     if (decision?.priorities) {
//         decision.priorities.forEach(p => { decisionGreenMap[p.road] = p.greenTime; });
//     }

//     const getPedMessage = (ped, phase) => {
//         if (!ped) return 'No pedestrian request';
//         if (ped.crossing) return `Crossing active (${ped.duration || 10}s)`;
//         if (ped.requested && phase === 'RED')    return 'Pressed during RED → immediate crossing';
//         if (ped.requested && phase === 'YELLOW') return 'Pressed during YELLOW → crossing after yellow';
//         if (ped.requested && phase === 'GREEN')  return 'Pressed during GREEN → waiting for green to end';
//         if (ped.requested) return 'Pedestrian waiting';
//         return 'Idle';
//     };

//     const activeSensors = Object.values(sensorWorking).filter(Boolean).length;

//     return (
//         <div style={{ padding: 20, fontFamily: "'Segoe UI', sans-serif", background: '#0a0f1e', minHeight: '100vh', color: 'white' }}>

//             {/* Toast */}
//             {notification && (
//                 <div style={{
//                     position: 'fixed', top: 20, right: 20, zIndex: 9999,
//                     background: notification.type === 'success' ? '#14532d' : '#7f1d1d',
//                     border: `1px solid ${notification.type === 'success' ? '#22c55e' : '#ef4444'}`,
//                     color: 'white', padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 'bold'
//                 }}>{notification.msg}</div>
//             )}

//             {/* Header */}
//             <div style={{ textAlign: 'center', marginBottom: 24 }}>
//                 <h1 style={{ fontSize: '2.2rem', margin: '0 0 4px', letterSpacing: 2 }}>🚦 H.Y.D.R.A Control Center</h1>
//                 <p style={{ color: '#475569', margin: 0, fontSize: 13 }}>Nawinna Junction, Kurunegala — Real-time Adaptive Signal Management</p>

//                 <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
//                     <span style={{ background: connected ? '#14532d' : '#7f1d1d', color: connected ? '#4ade80' : '#f87171', padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 'bold' }}>
//                         {connected ? '● LIVE' : '● OFFLINE'}
//                     </span>
//                     <span style={{ background: '#1e293b', color: '#94a3b8', padding: '3px 12px', borderRadius: 20, fontSize: 12 }}>
//                         Mode: {decision?.mode || 'Starting...'}
//                     </span>
//                     <span style={{
//                         background: rainDetected ? '#1e3a5f' : '#14532d',
//                         color: rainDetected ? '#60a5fa' : '#4ade80',
//                         border: `1px solid ${rainDetected ? '#3b82f6' : '#22c55e'}`,
//                         padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 'bold'
//                     }}>
//                         {rainDetected ? `🌧️ RAIN — Yellow: ${yellowTime}s (3s+2s)` : `☀️ DRY — Yellow: ${yellowTime}s`}
//                     </span>
//                     <span style={{ background: '#1e293b', color: '#94a3b8', padding: '3px 12px', borderRadius: 20, fontSize: 12 }}>
//                         📡 Sensors: {activeSensors}/4
//                     </span>
//                     <span style={{ background: '#1e293b', color: '#94a3b8', padding: '3px 12px', borderRadius: 20, fontSize: 12 }}>
//                         🗺️ Google: {googleWorking ? 'Active' : 'Disabled'}
//                     </span>
//                 </div>
//             </div>

//             {/* Decision Banner */}
//             {decision?.winner && (
//                 <div style={{ background: 'linear-gradient(135deg,#1e3a5f,#0d2137)', border: '1px solid #2E75B6', borderRadius: 14, padding: '16px 22px', marginBottom: 22 }}>
//                     <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
//                         <span style={{ fontSize: '1.8rem' }}>🧠</span>
//                         <div style={{ flex: 1 }}>
//                             <div style={{ fontWeight: 'bold', fontSize: '1.05rem' }}>
//                                 Priority: <span style={{ color: '#4ade80' }}>{decision.winner} Road → GREEN ({decision.greenDuration}s)</span>
//                                 {decision.winnerScenario && (
//                                     <span style={{ marginLeft: 10 }}>
//                                         <ScenarioBadge scenario={decision.winnerScenario} />
//                                     </span>
//                                 )}
//                             </div>
//                             <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
//                                 🟡 Yellow: {decision.yellowDuration || yellowTime}s
//                                 &nbsp;→&nbsp;
//                                 🔴 Others RED: <strong style={{ color: '#f87171' }}>{decision.redForOthers}s</strong>
//                                 &nbsp;(= {decision.greenDuration}s green + {decision.yellowDuration || yellowTime}s yellow)
//                                 &nbsp;| Mode: {decision.mode}
//                             </div>
//                             {rainDetected && (
//                                 <div style={{ color: '#60a5fa', fontSize: 11, marginTop: 4 }}>
//                                     🌧️ Rain detected — Yellow extended to {yellowTime}s (3s base + 2s rain bonus)
//                                 </div>
//                             )}
//                         </div>
//                         <div style={{ display: 'flex', gap: 10 }}>
//                             {['RED','YELLOW','GREEN'].map(c => (
//                                 <div key={c} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
//                                     <Bulb color={c} active={livePhase[winner] === c} size={38} />
//                                     {livePhase[winner] === c && liveCountdown[winner] > 0 && (
//                                         <span style={{ fontSize: 11, color: '#94a3b8' }}>{liveCountdown[winner]}s</span>
//                                     )}
//                                 </div>
//                             ))}
//                         </div>
//                     </div>
//                 </div>
//             )}

//             {/* Road Cards */}
//             <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(380px,1fr))', gap: 16, marginBottom: 22 }}>
//                 {ROADS.map(road => {
//                     const phase     = livePhase[road] || 'RED';
//                     const count     = liveCountdown[road] || 0;
//                     const dist      = sensorData[road] || 5000;
//                     const google    = googleTraffic[road] || 'Unknown';
//                     const isWin     = winner === road;
//                     const ir        = irData[road] || { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' };
//                     const ped       = pedStatus[road] || { requested: false, crossing: false, duration: 0 };
//                     const scenario  = scenarioMap[road] || null;
//                     const roadGreenTime = decisionGreenMap[road] || greenTime[road] || 3;
//                     const isNonWinnerOnRed = !isWin && phase === 'RED';

//                     return (
//                         <div key={road} style={{
//                             background: 'linear-gradient(160deg,#1a2540,#111827)', borderRadius: 16, padding: 18,
//                             border: isWin ? '2px solid #22c55e' : '1px solid #1e3a5f',
//                             boxShadow: isWin ? '0 0 24px rgba(34,197,94,0.18)' : 'none', transition: 'all 0.3s'
//                         }}>
//                             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
//                                 <div style={{ flex: 1 }}>
//                                     <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
//                                         <h3 style={{ margin: 0, color: '#cbd5e1', fontSize: 14, letterSpacing: 2, textTransform: 'uppercase' }}>
//                                             {road} ROAD
//                                         </h3>
//                                         {isWin && <span style={{ color: '#4ade80', fontSize: 11, fontWeight: 'bold' }}>● PRIORITY</span>}
//                                         {scenario && <ScenarioBadge scenario={scenario} />}
//                                     </div>

//                                     <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
//                                         {['RED','YELLOW','GREEN'].map(c => (
//                                             <div key={c} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
//                                                 <div style={{ position: 'relative' }}>
//                                                     <Bulb color={c} active={phase === c} size={36} />
//                                                     {phase === c && count > 0 && (
//                                                         <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 'bold', color: '#000' }}>
//                                                             {count}
//                                                         </div>
//                                                     )}
//                                                 </div>
//                                                 <span style={{ fontSize: 9, color: phase === c ? (c === 'RED' ? '#ef4444' : c === 'YELLOW' ? '#f59e0b' : '#22c55e') : '#334155', letterSpacing: 1 }}>{c}</span>
//                                             </div>
//                                         ))}
//                                         <div style={{ marginLeft: 6 }}>
//                                             <span style={{ fontSize: 12, fontWeight: 'bold', color: phase === 'GREEN' ? '#4ade80' : phase === 'YELLOW' ? '#fde047' : '#f87171' }}>
//                                                 {phase}{count > 0 ? ` (${count}s)` : ''}
//                                             </span>
//                                             {isNonWinnerOnRed && redForOthers > 0 && (
//                                                 <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
//                                                     RED for {redForOthers}s this cycle
//                                                 </div>
//                                             )}
//                                         </div>
//                                     </div>

//                                     {/* Ultrasonic */}
//                                     <div style={{ background: '#0f172a', borderRadius: 8, padding: 10, marginBottom: 8 }}>
//                                         <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
//                                             <span>📡</span>
//                                             <span style={{ fontSize: 11, color: '#64748b' }}>Ultrasonic</span>
//                                             <span style={{
//                                                 fontSize: 10, padding: '1px 6px', borderRadius: 6,
//                                                 background: sensorWorking[road] ? '#14532d' : '#1e293b',
//                                                 color: sensorWorking[road] ? '#4ade80' : '#475569'
//                                             }}>
//                                                 {sensorWorking[road] ? '● ACTIVE' : '● OFFLINE'}
//                                             </span>
//                                             {scenario && (
//                                                 <span style={{ fontSize: 10, color: '#64748b' }}>
//                                                     → {scenario === 'IR' ? 'Using IR (dist < 20cm)' : 'Using distance'}
//                                                 </span>
//                                             )}
//                                         </div>
//                                         <ProximityBar distanceCm={dist} />
//                                     </div>

//                                     {/* IR Sensors */}
//                                     <div style={{ background: '#0f172a', borderRadius: 8, padding: 10, marginBottom: 8 }}>
//                                         <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
//                                             <span>🔦</span>
//                                             <span style={{ fontSize: 11, color: '#64748b' }}>IR Sensors</span>
//                                         </div>
//                                         <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
//                                             {[
//                                                 { label: 'IR-1 (0–5cm)', blocked: ir.ir1Blocked },
//                                                 { label: 'IR-2 (5–10cm)', blocked: ir.ir2Blocked },
//                                             ].map(s => (
//                                                 <div key={s.label} style={{
//                                                     background: s.blocked ? '#7f1d1d' : '#1e293b',
//                                                     color: s.blocked ? '#f87171' : '#475569',
//                                                     border: `1px solid ${s.blocked ? '#ef4444' : '#334155'}`,
//                                                     borderRadius: 8, padding: '3px 8px', fontSize: 10, fontWeight: 'bold'
//                                                 }}>
//                                                     {s.blocked ? '🔴' : '🟢'} {s.label}: {s.blocked ? 'BLOCKED' : 'CLEAR'}
//                                                 </div>
//                                             ))}
//                                         </div>
//                                         <TrafficDensityBadge density={ir.queueLevel || 'None'} />
//                                         <div style={{ fontSize: 10, color: '#64748b', marginTop: 5 }}>
//                                             {ir.queueLevel === 'Heavy' && `Both blocked → Green: ${roadGreenTime}s (3s + 6s heavy)`}
//                                             {ir.queueLevel === 'Light' && `One blocked → Green: ${roadGreenTime}s (3s + 3s light)`}
//                                             {(!ir.queueLevel || ir.queueLevel === 'None') && `No IR → Green: ${roadGreenTime}s (base)`}
//                                         </div>
//                                     </div>

//                                     {/* Weather */}
//                                     <div style={{ background: '#0f172a', borderRadius: 8, padding: 10, marginBottom: 8 }}>
//                                         <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
//                                             <span>{rainDetected ? '🌧️' : '☀️'}</span>
//                                             <span style={{ fontSize: 11, color: '#64748b' }}>Weather:</span>
//                                             <span style={{ fontSize: 11, color: rainDetected ? '#60a5fa' : '#4ade80', fontWeight: 'bold' }}>
//                                                 {rainDetected ? `Raining — Yellow ${yellowTime}s (3s+2s)` : `Dry — Yellow ${yellowTime}s (normal)`}
//                                             </span>
//                                         </div>
//                                     </div>

//                                     {/* Next intersection */}
//                                     <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
//                                         <span style={{ fontSize: 13 }}>🗺️</span>
//                                         <span style={{ fontSize: 11, color: '#64748b' }}>Next Intersection:</span>
//                                         <TrafficBadge level={google} />
//                                         {scenario === 'IR' && (
//                                             <span style={{ fontSize: 10, color: '#64748b' }}>(ranking only)</span>
//                                         )}
//                                         {scenario === 'ULTRASONIC' && (
//                                             <span style={{ fontSize: 10, color: '#64748b' }}>(timing + ranking)</span>
//                                         )}
//                                     </div>

//                                     {/* Pedestrian */}
//                                     <div style={{
//                                         background: ped.crossing ? '#1e3a5f' : ped.requested ? '#3d2000' : '#0f172a',
//                                         border: `1px solid ${ped.crossing ? '#3b82f6' : ped.requested ? '#f59e0b' : '#1e293b'}`,
//                                         borderRadius: 8, padding: 8, marginBottom: 8
//                                     }}>
//                                         <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
//                                             <span>🚶</span>
//                                             <span style={{ fontSize: 11, color: '#64748b' }}>Pedestrian</span>
//                                             {ped.crossing && <span style={{ fontSize: 10, color: '#60a5fa', fontWeight: 'bold' }}>● CROSSING</span>}
//                                             {ped.requested && !ped.crossing && <span style={{ fontSize: 10, color: '#fde047', fontWeight: 'bold' }}>● WAITING</span>}
//                                             {!ped.requested && !ped.crossing && <span style={{ fontSize: 10, color: '#475569' }}>Idle</span>}
//                                         </div>
//                                         <div style={{ marginTop: 5, fontSize: 11, color: ped.crossing ? '#60a5fa' : ped.requested ? '#fde047' : '#94a3b8' }}>
//                                             {getPedMessage(ped, phase)}
//                                         </div>
//                                     </div>

//                                     <ForcePanel road={road} onForce={handleForce} />
//                                 </div>

//                                 {/* Physical traffic light widget */}
//                                 <div style={{ marginLeft: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
//                                     <div style={{ background: '#111', padding: '10px 8px', borderRadius: 12, border: '2px solid #2a2a2a', display: 'flex', flexDirection: 'column', gap: 8 }}>
//                                         {['RED','YELLOW','GREEN'].map(c => <Bulb key={c} color={c} active={phase === c} size={28} />)}
//                                     </div>
//                                     {count > 0 && (
//                                         <div style={{ background: phase === 'GREEN' ? '#14532d' : phase === 'YELLOW' ? '#713f12' : '#7f1d1d', color: phase === 'GREEN' ? '#4ade80' : phase === 'YELLOW' ? '#fde047' : '#f87171', borderRadius: 6, padding: '2px 8px', fontSize: 13, fontWeight: 'bold' }}>
//                                             {count}s
//                                         </div>
//                                     )}
//                                 </div>
//                             </div>
//                         </div>
//                     );
//                 })}
//             </div>

//             {/* System Config Panel */}
//             <div style={{ background: 'linear-gradient(160deg,#1a2540,#111827)', borderRadius: 16, padding: 20, marginBottom: 22, border: '1px solid #1e3a5f' }}>
//                 <h3 style={{ margin: '0 0 14px', color: '#94a3b8', fontSize: 14 }}>📊 System Configuration</h3>
//                 <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
//                     {[
//                         { label: 'System Mode',     value: decision?.mode || '—',           ok: decision?.mode === 'BOTH' },
//                         { label: 'Current Winner',  value: winner ? `${winner} → GREEN` : 'Starting', ok: !!winner },
//                         { label: 'Yellow Time',     value: `${yellowTime}s ${rainDetected ? '(3s+2s rain)' : '(normal)'}`,  ok: true },
//                         { label: 'RED for Others',  value: redForOthers > 0 ? `${redForOthers}s (dynamic)` : '—', ok: redForOthers > 0,
//                           note: 'Equals winner Green + Yellow' },
//                         { label: 'Sensor Accuracy', value: `${activeSensors}/4 active`,     ok: activeSensors > 0 },
//                         { label: 'Google Traffic',  value: googleWorking ? 'Active' : 'Disabled', ok: googleWorking },
//                         { label: 'Rain Sensor',     value: rainDetected ? 'Rain' : 'Clear', ok: true },
//                         { label: 'Winner Scenario', value: decision?.winnerScenario || '—', ok: !!decision?.winnerScenario },
//                         { label: 'Green Base',      value: '3s + IR bonus (Light +3s, Heavy +6s)', ok: true },
//                     ].map(m => (
//                         <div key={m.label} style={{ background: '#0f172a', borderRadius: 10, padding: 12, border: `1px solid ${m.ok ? '#22c55e33' : '#ef444433'}` }}>
//                             <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4, letterSpacing: 1 }}>{m.label}</div>
//                             <div style={{ fontSize: 13, fontWeight: 'bold', color: m.ok ? '#4ade80' : '#f87171' }}>{m.value}</div>
//                             {m.note && <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>{m.note}</div>}
//                         </div>
//                     ))}
//                 </div>
//             </div>

//             {/* Live Distance Chart */}
//             <div style={{ background: 'linear-gradient(160deg,#1a2540,#111827)', borderRadius: 16, padding: 20, marginBottom: 22, border: '1px solid #1e3a5f' }}>
//                 <h3 style={{ margin: '0 0 14px', color: '#94a3b8', fontSize: 14 }}>📈 Live Ultrasonic Distance — All Roads</h3>
//                 <Line data={chartData} options={{
//                     responsive: true,
//                     plugins: { legend: { labels: { color: '#94a3b8', boxWidth: 12 } } },
//                     scales: {
//                         y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e3a5f' }, title: { display: true, text: 'Distance (cm)', color: '#64748b' } },
//                         x: { ticks: { color: '#64748b' }, grid: { color: '#1e3a5f' } }
//                     }
//                 }} />
//             </div>

//             {/* Priority Table */}
//             {decision?.priorities && (
//                 <div style={{ background: 'linear-gradient(160deg,#1a2540,#111827)', borderRadius: 16, padding: 20, marginBottom: 22, border: '1px solid #1e3a5f' }}>
//                     <h3 style={{ margin: '0 0 14px', color: '#94a3b8', fontSize: 14 }}>📋 Signal Priority Analysis</h3>
//                     <div style={{ overflowX: 'auto' }}>
//                         <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
//                             <thead>
//                                 <tr style={{ borderBottom: '1px solid #1e3a5f' }}>
//                                     {['Rank','Road','Scenario','Distance','IR Queue','Rain','Next Traffic','Ped','Score','Green Time','LED'].map(h => (
//                                         <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#475569', fontSize: 10, letterSpacing: 1, whiteSpace: 'nowrap' }}>{h}</th>
//                                     ))}
//                                 </tr>
//                             </thead>
//                             <tbody>
//                                 {decision.priorities.map((p, i) => {
//                                     const irForRoad = irData[p.road] || { queueLevel: 'None' };
//                                     return (
//                                         <tr key={p.road} style={{ borderBottom: '1px solid #0f172a', background: i === 0 ? 'rgba(34,197,94,0.05)' : 'transparent' }}>
//                                             <td style={{ padding: '8px 10px', color: i === 0 ? '#4ade80' : '#64748b', fontWeight: 'bold' }}>#{i+1}</td>
//                                             <td style={{ padding: '8px 10px', fontWeight: 'bold', color: i === 0 ? '#e2e8f0' : '#94a3b8' }}>{p.road}</td>
//                                             <td style={{ padding: '8px 10px' }}>
//                                                 {p.sensorScenario ? <ScenarioBadge scenario={p.sensorScenario} /> : '—'}
//                                             </td>
//                                             <td style={{ padding: '8px 10px', color: '#94a3b8' }}>{p.distance ? `${Math.round(p.distance)}cm` : 'None'}</td>
//                                             <td style={{ padding: '8px 10px', color: irForRoad.queueLevel === 'Heavy' ? '#f87171' : irForRoad.queueLevel === 'Light' ? '#fde047' : '#4ade80', fontWeight: 'bold' }}>
//                                                 {irForRoad.queueLevel === 'Heavy' ? '🔴 HEAVY' : irForRoad.queueLevel === 'Light' ? '🟡 LIGHT' : '🟢 NONE'}
//                                             </td>
//                                             <td style={{ padding: '8px 10px', color: rainDetected ? '#60a5fa' : '#4ade80', fontSize: 11 }}>
//                                                 {rainDetected ? `🌧️ ${yellowTime}s` : `☀️ ${yellowTime}s`}
//                                             </td>
//                                             <td style={{ padding: '8px 10px' }}><TrafficBadge level={p.traffic} /></td>
//                                             <td style={{ padding: '8px 10px', color: pedStatus[p.road]?.crossing ? '#60a5fa' : pedStatus[p.road]?.requested ? '#fde047' : '#94a3b8', fontWeight: 'bold', fontSize: 11 }}>
//                                                 {pedStatus[p.road]?.crossing ? '🚶 CROSS' : pedStatus[p.road]?.requested ? '⏳ WAIT' : 'Idle'}
//                                             </td>
//                                             <td style={{ padding: '8px 10px', color: p.score > 0 ? '#4ade80' : p.score < 0 ? '#f87171' : '#94a3b8', fontWeight: 'bold' }}>
//                                                 {typeof p.score === 'number' ? p.score.toFixed(1) : '—'}
//                                             </td>
//                                             <td style={{ padding: '8px 10px', color: i === 0 ? '#4ade80' : '#94a3b8', fontWeight: i === 0 ? 'bold' : 'normal' }}>
//                                                 {p.greenTime ? `${Math.round(p.greenTime)}s` : '—'}
//                                             </td>
//                                             <td style={{ padding: '8px 10px' }}>
//                                                 <span style={{ background: livePhase[p.road] === 'GREEN' ? '#14532d' : livePhase[p.road] === 'YELLOW' ? '#713f12' : '#7f1d1d', color: livePhase[p.road] === 'GREEN' ? '#4ade80' : livePhase[p.road] === 'YELLOW' ? '#fde047' : '#f87171', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
//                                                     {livePhase[p.road] || 'RED'}{liveCountdown[p.road] > 0 ? ` (${liveCountdown[p.road]}s)` : ''}
//                                                 </span>
//                                             </td>
//                                         </tr>
//                                     );
//                                 })}
//                             </tbody>
//                         </table>
//                     </div>
//                     <div style={{ marginTop: 12, padding: 10, background: '#0f172a', borderRadius: 8, fontSize: 11, color: '#64748b', border: '1px solid #1e3a5f' }}>
//                         🔴 <strong style={{ color: '#94a3b8' }}>Dynamic RED (non-priority roads):</strong>&nbsp;
//                         {winner && decision?.greenDuration
//                             ? `${decision.greenDuration}s (winner green) + ${decision.yellowDuration || yellowTime}s (yellow) = ${decision.redForOthers}s total RED this cycle`
//                             : 'Calculated each cycle as winner\'s green + yellow duration'}
//                     </div>
//                 </div>
//             )}

//             {/* Rules Footer */}
//             <div style={{ background: 'linear-gradient(160deg,#1a2540,#111827)', borderRadius: 16, padding: 16, marginTop: 8, border: '1px solid #1e3a5f' }}>
//                 <h3 style={{ margin: '0 0 12px', color: '#94a3b8', fontSize: 13 }}>📋 System Rules</h3>
//                 <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 10, fontSize: 11, color: '#64748b' }}>
//                     <div>📡 <strong style={{ color: '#60a5fa' }}>ULTRASONIC mode:</strong> dist ≥ 20cm — uses distance + Google traffic for timing</div>
//                     <div>🔦 <strong style={{ color: '#c084fc' }}>IR mode:</strong> dist &lt; 20cm — uses IR sensors for timing (vehicle at stop line)</div>
//                     <div>🟢 <strong>GREEN:</strong> 3s base + Light traffic +3s = 6s, Heavy +6s = 9s, Piezo +5s = 14s</div>
//                     <div>🟡 <strong>YELLOW:</strong> 3s dry, +2s rain = 5s total</div>
//                     <div>🔴 <strong>RED (others):</strong> Dynamic = winner GREEN + YELLOW (e.g. 9s+5s = 14s)</div>
//                     <div>🚶 <strong>Pedestrian:</strong> RED → immediate, YELLOW → after yellow, GREEN → after green</div>
//                 </div>
//             </div>

//             {/* ── ANALYTICS DASHBOARD ─────────────────────────────────── */}
//             <div style={{ background: 'linear-gradient(160deg,#1a2540,#111827)', borderRadius: 16, padding: 20, marginTop: 22, border: '1px solid #1e3a5f' }}>
//                 <h3 style={{ margin: '0 0 16px', color: '#94a3b8', fontSize: 15 }}>📊 Traffic Analytics — Real World Insights</h3>

//                 {/* Tab Buttons */}
//                 <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
//                     {[
//                         { id: 'congestion', label: '🔥 Congestion Score' },
//                         { id: 'peakhours', label: '⏰ Peak Hours' },
//                         { id: 'efficiency', label: '⚡ System Mode' },
//                         { id: 'waittimes', label: '⏳ Wait Times' }
//                     ].map(tab => (
//                         <button key={tab.id} onClick={() => setAnalyticsTab(tab.id)}
//                             style={{
//                                 background: analyticsTab === tab.id ? '#1e3a5f' : '#0f172a',
//                                 color: analyticsTab === tab.id ? '#60a5fa' : '#475569',
//                                 border: `1px solid ${analyticsTab === tab.id ? '#3b82f6' : '#334155'}`,
//                                 padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 'bold'
//                             }}>
//                             {tab.label}
//                         </button>
//                     ))}
//                 </div>

//                 {/* TAB 1: Congestion Score per Road */}
//                 {analyticsTab === 'congestion' && (
//                     <div>
//                         <p style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>
//                             Congestion Score (0–100) based on ultrasonic distance + IR sensors + Google traffic + rain. Higher = more urgent.
//                         </p>
//                         <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
//                             {analyticsData.roadPerf.length > 0 ? analyticsData.roadPerf.map(r => {
//                                 const score = r.avgCongestion;
//                                 const color = score > 70 ? '#ef4444' : score > 40 ? '#f59e0b' : '#22c55e';
//                                 return (
//                                     <div key={r.road} style={{ background: '#0f172a', borderRadius: 12, padding: 14, border: `1px solid ${color}44` }}>
//                                         <div style={{ fontWeight: 'bold', color: '#e2e8f0', marginBottom: 8 }}>{r.road} Road</div>
//                                         <div style={{ background: '#1e293b', borderRadius: 4, height: 10, marginBottom: 6 }}>
//                                             <div style={{ width: `${score}%`, background: color, height: '100%', borderRadius: 4, transition: 'width 1s' }} />
//                                         </div>
//                                         <div style={{ fontSize: 22, fontWeight: 'bold', color, marginBottom: 8 }}>{score}/100</div>
//                                         <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.6 }}>
//                                             <div>🟢 Avg Green: {r.avgGreenTime}s</div>
//                                             <div>⏳ Avg Wait: {r.avgWaitTime}s</div>
//                                             <div>🏆 Priority Wins: {r.priorityWins}</div>
//                                             <div>🔴 Heavy IR Events: {r.heavyTrafficCount}</div>
//                                             <div>⚡ Efficiency: {r.efficiency}%</div>
//                                         </div>
//                                     </div>
//                                 );
//                             }) : (
//                                 <div style={{ color: '#475569', fontSize: 12, padding: 20 }}>
//                                     Collecting data... Analytics appear after first traffic cycles complete.
//                                 </div>
//                             )}
//                         </div>

//                         {/* Live Congestion from current sensors */}
//                         <div style={{ marginTop: 16, padding: 12, background: '#0f172a', borderRadius: 10, border: '1px solid #1e3a5f' }}>
//                             <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>⚡ LIVE Congestion Right Now (from current sensor readings)</div>
//                             <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
//                                 {ROADS.map(road => {
//                                     const dist = sensorData[road] || 5000;
//                                     const ir = irData[road] || {};
//                                     const google = googleTraffic[road] || 'Unknown';
//                                     let liveScore = 0;
//                                     if (dist < 20) liveScore += 40;
//                                     else if (dist < 50) liveScore += 30;
//                                     else if (dist < 100) liveScore += 20;
//                                     else if (dist < 200) liveScore += 10;
//                                     if (ir.queueLevel === 'Heavy') liveScore += 35;
//                                     else if (ir.queueLevel === 'Light') liveScore += 15;
//                                     if (google === 'Light') liveScore += 20;
//                                     else if (google === 'Medium') liveScore += 12;
//                                     else if (google === 'Heavy') liveScore += 5;
//                                     if (rainDetected) liveScore += 5;
//                                     liveScore = Math.min(100, liveScore);
//                                     const c = liveScore > 70 ? '#ef4444' : liveScore > 40 ? '#f59e0b' : '#22c55e';
//                                     return (
//                                         <div key={road} style={{ flex: 1, minWidth: 100, background: '#1e293b', borderRadius: 8, padding: 10, border: `1px solid ${c}44`, textAlign: 'center' }}>
//                                             <div style={{ fontSize: 11, color: '#64748b' }}>{road}</div>
//                                             <div style={{ fontSize: 20, fontWeight: 'bold', color: c }}>{liveScore}</div>
//                                             <div style={{ fontSize: 9, color: '#475569' }}>/ 100</div>
//                                         </div>
//                                     );
//                                 })}
//                             </div>
//                         </div>
//                     </div>
//                 )}

//                 {/* TAB 2: Peak Hours */}
//                 {analyticsTab === 'peakhours' && (
//                     <div>
//                         <p style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>
//                             Average congestion by hour of day (last 7 days). Helps identify morning/evening rush hours at Nawinna Junction.
//                         </p>
//                         {analyticsData.peakHours.length > 0 ? (
//                             <div style={{ overflowX: 'auto' }}>
//                                 <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
//                                     <thead>
//                                         <tr style={{ borderBottom: '1px solid #1e3a5f' }}>
//                                             {['Hour', 'North', 'South', 'East', 'West', 'Peak?'].map(h => (
//                                                 <th key={h} style={{ padding: '8px 10px', color: '#475569', textAlign: 'left' }}>{h}</th>
//                                             ))}
//                                         </tr>
//                                     </thead>
//                                     <tbody>
//                                         {analyticsData.peakHours.filter(h => h.North > 0 || h.South > 0 || h.East > 0 || h.West > 0).map(h => {
//                                             const maxScore = Math.max(h.North, h.South, h.East, h.West);
//                                             const isPeak = maxScore > 60;
//                                             return (
//                                                 <tr key={h.hour} style={{ borderBottom: '1px solid #0f172a', background: isPeak ? 'rgba(239,68,68,0.05)' : 'transparent' }}>
//                                                     <td style={{ padding: '6px 10px', color: '#94a3b8', fontWeight: 'bold' }}>
//                                                         {h.hour.toString().padStart(2,'0')}:00
//                                                     </td>
//                                                     {['North','South','East','West'].map(road => {
//                                                         const s = h[road] || 0;
//                                                         const c = s > 60 ? '#ef4444' : s > 30 ? '#f59e0b' : '#22c55e';
//                                                         return (
//                                                             <td key={road} style={{ padding: '6px 10px' }}>
//                                                                 <span style={{ color: c, fontWeight: 'bold' }}>{s}</span>
//                                                                 <div style={{ background: '#1e293b', borderRadius: 2, height: 4, marginTop: 3, width: 60 }}>
//                                                                     <div style={{ width: `${s}%`, background: c, height: '100%', borderRadius: 2 }} />
//                                                                 </div>
//                                                             </td>
//                                                         );
//                                                     })}
//                                                     <td style={{ padding: '6px 10px', color: isPeak ? '#f87171' : '#4ade80', fontWeight: 'bold', fontSize: 10 }}>
//                                                         {isPeak ? '🔴 PEAK' : '✅ Normal'}
//                                                     </td>
//                                                 </tr>
//                                             );
//                                         })}
//                                     </tbody>
//                                 </table>
//                                 {analyticsData.peakHours.filter(h => h.North > 0 || h.South > 0 || h.East > 0 || h.West > 0).length === 0 && (
//                                     <div style={{ color: '#475569', fontSize: 12, padding: 20 }}>No peak hour data yet — system needs to run for a few cycles first.</div>
//                                 )}
//                             </div>
//                         ) : (
//                             <div style={{ color: '#475569', fontSize: 12, padding: 20 }}>Collecting peak hour data... Check back after the system runs for a while.</div>
//                         )}
//                     </div>
//                 )}

//                 {/* TAB 3: System Mode Efficiency */}
//                 {analyticsTab === 'efficiency' && (
//                     <div>
//                         <p style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>
//                             Shows how often the system uses each data source. BOTH mode (sensors + Google) is most accurate.
//                         </p>
//                         <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 16 }}>
//                             {[
//                                 { label: 'Total Cycles (24h)', value: analyticsData.efficiency.totalCycles24h, icon: '🔄', color: '#60a5fa' },
//                                 { label: 'Avg Congestion (1h)', value: `${Math.round(analyticsData.efficiency.last1Hour?.avgCongestion || 0)}/100`, icon: '📊', color: '#f59e0b' },
//                                 { label: 'Avg Green Time (1h)', value: `${Math.round((analyticsData.efficiency.last1Hour?.avgGreenTime || 3) * 10) / 10}s`, icon: '🟢', color: '#22c55e' },
//                                 { label: 'Recent Cycles (1h)', value: analyticsData.efficiency.last1Hour?.totalCycles || 0, icon: '⏱️', color: '#a78bfa' }
//                             ].map(stat => (
//                                 <div key={stat.label} style={{ background: '#0f172a', borderRadius: 10, padding: 14, border: `1px solid ${stat.color}33` }}>
//                                     <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6 }}>{stat.icon} {stat.label}</div>
//                                     <div style={{ fontSize: 20, fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
//                                 </div>
//                             ))}
//                         </div>

//                         {/* Mode breakdown */}
//                         <div style={{ background: '#0f172a', borderRadius: 10, padding: 14, border: '1px solid #1e3a5f' }}>
//                             <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12, fontWeight: 'bold' }}>Decision Mode Breakdown (Last 24h)</div>
//                             {analyticsData.efficiency.modeBreakdown.length > 0 ? analyticsData.efficiency.modeBreakdown.map(m => {
//                                 const modeColors = { BOTH: '#22c55e', SENSOR_ONLY: '#60a5fa', GOOGLE_ONLY: '#a78bfa', FALLBACK: '#f59e0b' };
//                                 const c = modeColors[m.mode] || '#64748b';
//                                 const modeDesc = {
//                                     BOTH: 'Using sensors + Google Maps (most accurate)',
//                                     SENSOR_ONLY: 'Sensors only — Google API unavailable',
//                                     GOOGLE_ONLY: 'Google only — sensors offline',
//                                     FALLBACK: 'Fixed timing — all data unavailable'
//                                 };
//                                 return (
//                                     <div key={m.mode} style={{ marginBottom: 12 }}>
//                                         <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
//                                             <span style={{ color: c, fontWeight: 'bold', fontSize: 12 }}>{m.mode}</span>
//                                             <span style={{ color: '#94a3b8', fontSize: 11 }}>{m.percentage}% ({m.count} cycles)</span>
//                                         </div>
//                                         <div style={{ background: '#1e293b', borderRadius: 4, height: 8 }}>
//                                             <div style={{ width: `${m.percentage}%`, background: c, height: '100%', borderRadius: 4, transition: 'width 1s' }} />
//                                         </div>
//                                         <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>{modeDesc[m.mode]}</div>
//                                     </div>
//                                 );
//                             }) : (
//                                 <div style={{ color: '#475569', fontSize: 12 }}>Collecting mode data... Appears after first few cycles.</div>
//                             )}
//                         </div>
//                     </div>
//                 )}

//                 {/* TAB 4: Wait Times */}
//                 {analyticsTab === 'waittimes' && (
//                     <div>
//                         <p style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>
//                             Average wait time per road (time other roads wait while one road has green). Lower is better.
//                         </p>
//                         <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
//                             {analyticsData.roadPerf.length > 0 ? analyticsData.roadPerf.map(r => {
//                                 const wait = r.avgWaitTime;
//                                 const color = wait > 30 ? '#ef4444' : wait > 15 ? '#f59e0b' : '#22c55e';
//                                 return (
//                                     <div key={r.road} style={{ background: '#0f172a', borderRadius: 12, padding: 14, border: `1px solid ${color}44` }}>
//                                         <div style={{ fontWeight: 'bold', color: '#e2e8f0', marginBottom: 8 }}>{r.road} Road</div>
//                                         <div style={{ fontSize: 28, fontWeight: 'bold', color, marginBottom: 4 }}>{wait}s</div>
//                                         <div style={{ fontSize: 10, color: '#64748b' }}>average wait per cycle</div>
//                                         <div style={{ marginTop: 10, fontSize: 11, color: '#475569', lineHeight: 1.8 }}>
//                                             <div>Total cycles: {r.totalCycles}</div>
//                                             <div>Rain cycles: {r.rainCycles}</div>
//                                             <div style={{ color: wait > 30 ? '#ef4444' : '#4ade80', fontWeight: 'bold' }}>
//                                                 {wait > 30 ? '⚠️ High wait — consider priority adjustment' : wait > 15 ? '⚡ Moderate — normal operation' : '✅ Low wait — good throughput'}
//                                             </div>
//                                         </div>
//                                     </div>
//                                 );
//                             }) : (
//                                 <div style={{ color: '#475569', fontSize: 12, padding: 20 }}>Collecting wait time data...</div>
//                             )}
//                         </div>
//                     </div>
//                 )}
//             </div>

//             <div style={{ textAlign: 'center', marginTop: 28, color: '#1e3a5f', fontSize: 11 }}>
//                 HYDRA v4.0 — Backend-Aligned — Nawinna Junction, Kurunegala
//             </div>
//         </div>
//     );
// }

// export default App;


// client/src/App.js — HYDRA Dashboard v5.0 — Fixed Pedestrian Indicator + Piezo + Clean UI
// FILE PATH: client/src/App.js
import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';

const SERVER = 'http://56.228.30.50:5000';
const ROADS  = ['North', 'South', 'East', 'West'];

// ─────────────────────────────────────────────────────────────────────────────
// TRAFFIC LIGHT BULB (for main 3-colour light)
// ─────────────────────────────────────────────────────────────────────────────
const Bulb = ({ color, active, size = 36 }) => {
    const colors = {
        RED:    { on: '#ef4444', off: '#3a0000', glow: '#ef4444' },
        YELLOW: { on: '#f59e0b', off: '#3a2e00', glow: '#f59e0b' },
        GREEN:  { on: '#22c55e', off: '#003310', glow: '#22c55e' },
    };
    const c = colors[color];
    return (
        <div style={{
            width: size, height: size, borderRadius: '50%',
            background: active ? c.on : c.off,
            boxShadow: active ? `0 0 14px ${c.glow}, 0 0 28px ${c.glow}` : 'none',
            transition: 'all 0.3s ease'
        }} />
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// PEDESTRIAN LIGHT BULB (RED=stop, GREEN=cross — no yellow for pedestrians)
// ─────────────────────────────────────────────────────────────────────────────
const PedBulb = ({ color, active, size = 28 }) => {
    const colors = {
        RED:   { on: '#ef4444', off: '#3a0000', glow: '#ef4444' },
        GREEN: { on: '#22c55e', off: '#003310', glow: '#22c55e' },
    };
    const c = colors[color];
    return (
        <div style={{
            width: size, height: size, borderRadius: '50%',
            background: active ? c.on : c.off,
            boxShadow: active ? `0 0 12px ${c.glow}, 0 0 24px ${c.glow}` : 'none',
            transition: 'all 0.3s ease'
        }} />
    );
};

const TrafficBadge = ({ level }) => {
    const map = {
        Heavy:   { bg: '#7f1d1d', color: '#f87171', border: '#ef4444' },
        Medium:  { bg: '#713f12', color: '#fde047', border: '#f59e0b' },
        Light:   { bg: '#14532d', color: '#4ade80', border: '#22c55e' },
        Unknown: { bg: '#1e293b', color: '#64748b', border: '#334155' },
    };
    const s = map[level] || map.Unknown;
    return (
        <span style={{
            background: s.bg, color: s.color, border: `1px solid ${s.border}`,
            padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 'bold'
        }}>{level || 'Unknown'}</span>
    );
};

const ScenarioBadge = ({ scenario }) => {
    const map = {
        IR:          { bg: '#3b1f69', color: '#c084fc', border: '#a855f7', icon: '🔦', label: 'IR MODE' },
        ULTRASONIC:  { bg: '#1e3a5f', color: '#60a5fa', border: '#3b82f6', icon: '📡', label: 'ULTRASONIC' },
        GOOGLE_ONLY: { bg: '#1e293b', color: '#94a3b8', border: '#475569', icon: '🗺️', label: 'GOOGLE ONLY' },
        FALLBACK:    { bg: '#3d2000', color: '#fb923c', border: '#f59e0b', icon: '⚠️', label: 'FALLBACK' },
    };
    const s = map[scenario] || map.FALLBACK;
    return (
        <span style={{
            background: s.bg, color: s.color, border: `1px solid ${s.border}`,
            padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 'bold',
            display: 'inline-flex', alignItems: 'center', gap: 4
        }}>{s.icon} {s.label}</span>
    );
};

const TrafficDensityBadge = ({ density }) => {
    const map = {
        'Heavy':   { bg: '#7f1d1d', color: '#f87171', icon: '🔴', label: 'HEAVY (+6s Green)' },
        'Light':   { bg: '#713f12', color: '#fde047', icon: '🟡', label: 'LIGHT (+3s Green)' },
        'None':    { bg: '#14532d', color: '#4ade80', icon: '🟢', label: 'NO TRAFFIC (3s base)' },
        'Unknown': { bg: '#1e293b', color: '#64748b', icon: '❓', label: 'UNKNOWN' },
    };
    const s = map[density] || map.Unknown;
    return (
        <div style={{
            background: s.bg, color: s.color, border: `1px solid ${s.color}44`,
            padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 'bold',
            display: 'inline-flex', alignItems: 'center', gap: 6
        }}>
            <span>{s.icon}</span> {s.label}
        </div>
    );
};

const ForcePanel = ({ road, onForce }) => {
    const [dur, setDur] = useState(30);
    return (
        <div style={{ marginTop: 12, padding: 12, background: '#0f172a', borderRadius: 10, border: '1px solid #334155' }}>
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8, letterSpacing: 1 }}>🚨 TRAFFIC POLICE OVERRIDE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>Duration (s):</span>
                <input type="number" value={dur} min={5} max={300}
                    onChange={e => setDur(parseInt(e.target.value) || 30)}
                    style={{ width: 55, background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: 'white', padding: '3px 6px', fontSize: 13 }}
                />
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                    { cmd: 'RED',    bg: '#7f1d1d', col: '#f87171', border: '#ef4444', icon: '🔴' },
                    { cmd: 'YELLOW', bg: '#713f12', col: '#fde047', border: '#f59e0b', icon: '🟡' },
                    { cmd: 'GREEN',  bg: '#14532d', col: '#4ade80', border: '#22c55e', icon: '🟢' },
                ].map(b => (
                    <button key={b.cmd} onClick={() => onForce(road, b.cmd, dur)}
                        style={{ background: b.bg, color: b.col, border: `1px solid ${b.border}`, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 11 }}>
                        {b.icon} FORCE {b.cmd}
                    </button>
                ))}
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// PEDESTRIAN SIGNAL WIDGET (top-right of road card)
// Shows RED/GREEN only. RED with countdown when pedestrian waiting/yellow showing.
// GREEN with countdown when pedestrian is crossing.
// ─────────────────────────────────────────────────────────────────────────────
const PedestrianSignalWidget = ({ ped, mainPhase, mainCountdown, yellowTime }) => {
    // Determine pedestrian signal state
    // GREEN = pedestrian may cross (ped.crossing = true)
    // RED = pedestrian must stop (all other cases)
    const isCrossing = ped?.crossing === true;
    const isWaiting  = ped?.requested === true && !isCrossing;

    // What to show on the countdown display under the ped signal
    let countdownDisplay = null;
    let statusLabel = '';
    let statusColor = '#64748b';

    if (isCrossing) {
        // Pedestrian is actively crossing — show remaining crossing time
        countdownDisplay = ped.duration > 0 ? ped.duration : null;
        statusLabel = 'CROSSING';
        statusColor = '#22c55e';
    } else if (isWaiting && mainPhase === 'RED') {
        // Button pressed during RED — show remaining red countdown
        countdownDisplay = mainCountdown > 0 ? mainCountdown : null;
        statusLabel = 'WAIT (RED)';
        statusColor = '#fde047';
    } else if (isWaiting && mainPhase === 'YELLOW') {
        // Button pressed during yellow — show yellow countdown
        countdownDisplay = mainCountdown > 0 ? mainCountdown : null;
        statusLabel = 'WAIT (YELLOW)';
        statusColor = '#fde047';
    } else if (isWaiting && mainPhase === 'GREEN') {
        // Button pressed during green — waiting for green to end
        countdownDisplay = mainCountdown > 0 ? mainCountdown : null;
        statusLabel = 'WAIT (GREEN)';
        statusColor = '#f87171';
    } else {
        statusLabel = 'IDLE';
        statusColor = '#475569';
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            {/* Label */}
            <div style={{ fontSize: 9, color: '#64748b', letterSpacing: 1, textAlign: 'center' }}>PED</div>
            
            {/* Pedestrian signal housing — only RED and GREEN */}
            <div style={{
                background: '#111', padding: '8px 7px', borderRadius: 12,
                border: `2px solid ${isCrossing ? '#22c55e44' : '#2a2a2a'}`,
                display: 'flex', flexDirection: 'column', gap: 8,
                boxShadow: isCrossing ? '0 0 12px rgba(34,197,94,0.2)' : 'none'
            }}>
                <PedBulb color="RED"   active={!isCrossing} size={26} />
                <PedBulb color="GREEN" active={isCrossing}  size={26} />
            </div>

            {/* Countdown display */}
            {countdownDisplay !== null && (
                <div style={{
                    background: isCrossing ? '#14532d' : '#3d2000',
                    color: isCrossing ? '#4ade80' : '#fde047',
                    borderRadius: 6, padding: '2px 8px',
                    fontSize: 13, fontWeight: 'bold', minWidth: 32, textAlign: 'center'
                }}>
                    {countdownDisplay}s
                </div>
            )}

            {/* Status label */}
            <div style={{
                fontSize: 9, color: statusColor, fontWeight: 'bold',
                letterSpacing: 0.5, textAlign: 'center', maxWidth: 52
            }}>
                {statusLabel}
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
function App() {
    const [livePhase,           setLivePhase]           = useState({ North:'RED', South:'RED', East:'RED', West:'RED' });
    const [liveCountdown,       setLiveCountdown]       = useState({ North:0, South:0, East:0, West:0 });
    const [sensorData,          setSensorData]          = useState({ North:5000, South:5000, East:5000, West:5000 });
    const [googleTraffic,       setGoogleTraffic]       = useState({ North:'Unknown', South:'Unknown', East:'Unknown', West:'Unknown' });
    const [sensorWorking,       setSensorWorking]       = useState({});
    const [googleWorking,       setGoogleWorking]       = useState(false);
    const [irData,              setIrData]              = useState({
        North: { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' },
        South: { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' },
        East:  { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' },
        West:  { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' }
    });
    // NEW: piezoData tracks per-road piezo state from backend
    const [piezoData,           setPiezoData]           = useState({ North: false, South: false, East: false, West: false });
    const [rainDetected,        setRainDetected]        = useState(false);
    const [yellowTime,          setYellowTime]          = useState(3);
    const [redTime,             setRedTime]             = useState(0);
    const [greenTime,           setGreenTime]           = useState({ North:3, South:3, East:3, West:3 });
    const [pedStatus,           setPedStatus]           = useState({});
    const [decision,            setDecision]            = useState(null);
    const [connected,           setConnected]           = useState(false);
    const [notification,        setNotification]        = useState(null);
    const [espOnline,           setEspOnline]           = useState({ North: true, South: true, East: true, West: true });
    const [heavyVehicleActive,  setHeavyVehicleActive]  = useState({ North: false, South: false, East: false, West: false });
    const [analyticsTab,        setAnalyticsTab]        = useState('livecongestion');
    const [analyticsData,       setAnalyticsData]       = useState({
        peakHours: [], roadPerf: [],
        efficiency: { modeBreakdown: [], last1Hour: {}, totalCycles24h: 0 }
    });

    const socketRef = useRef(null);

    const showNotif = (msg, type = 'info') => {
        setNotification({ msg, type });
        setTimeout(() => setNotification(null), 4000);
    };

    useEffect(() => {
        const socket = io(SERVER, { transports: ['websocket', 'polling'] });
        socketRef.current = socket;

        socket.on('connect',    () => setConnected(true));
        socket.on('disconnect', () => setConnected(false));

        socket.on('fullState', data => {
            if (data.livePhase)       setLivePhase(data.livePhase);
            if (data.liveCountdown)   setLiveCountdown(data.liveCountdown);
            if (data.sensorData)      setSensorData(data.sensorData);
            if (data.googleTraffic)   setGoogleTraffic(data.googleTraffic);
            if (data.latestDecision)  setDecision(data.latestDecision);
            if (data.sensorWorking)   setSensorWorking(data.sensorWorking);
            if (data.googleWorking !== undefined) setGoogleWorking(data.googleWorking);
            if (data.irData)          setIrData(data.irData);
            if (data.piezoData)       setPiezoData(data.piezoData);  // NEW
            if (data.rainDetected !== undefined) {
                setRainDetected(data.rainDetected);
                setYellowTime(data.rainDetected ? 5 : 3);
            }
            if (data.redTime !== undefined) setRedTime(data.redTime);
            if (data.greenTime)       setGreenTime(data.greenTime);
            if (data.pedStatus)       setPedStatus(data.pedStatus);
            if (data.espOnline)          setEspOnline(data.espOnline);
            if (data.heavyVehicleActive) setHeavyVehicleActive(data.heavyVehicleActive);
        });

        socket.on('countdown',         ({ road, phase, remaining }) => {
            setLiveCountdown(p => ({ ...p, [road]: remaining }));
            setLivePhase(p => ({ ...p, [road]: phase }));
        });
        socket.on('ledStateUpdate',    ({ road, state }) => setLivePhase(p => ({ ...p, [road]: state })));
        socket.on('newDecision',       dec => setDecision(dec));
        socket.on('sensorUpdate',      ({ road, distanceCm }) => setSensorData(p => ({ ...p, [road]: distanceCm })));
        socket.on('irUpdate',          ({ road, ir1Blocked, ir2Blocked, queueLevel }) => {
            setIrData(prev => ({ ...prev, [road]: { ir1Blocked, ir2Blocked, queueLevel: queueLevel || 'None' } }));
        });
        // NEW: piezo update listener
        socket.on('piezoUpdate',       ({ road, heavyVehicle, rawValue }) => {
            setPiezoData(prev => ({ ...prev, [road]: heavyVehicle }));
            if (heavyVehicle) setHeavyVehicleActive(prev => ({ ...prev, [road]: true }));
        });
        socket.on('rainUpdate',        ({ rainDetected: r }) => {
            setRainDetected(r);
            setYellowTime(r ? 5 : 3);
        });
        socket.on('pedestrianUpdate',  ({ road, ...rest }) => setPedStatus(p => ({ ...p, [road]: rest })));
        socket.on('googleTrafficUpdate', ({ googleTraffic: gt, googleWorking: gw }) => {
            setGoogleTraffic(gt);
            setGoogleWorking(gw);
        });
        socket.on('espStatusUpdate',   ({ road, online }) => setEspOnline(prev => ({ ...prev, [road]: online })));
        socket.on('heavyVehicleUpdate',({ road, active }) => setHeavyVehicleActive(prev => ({ ...prev, [road]: active })));
        socket.on('analyticsUpdate',   (data) => {
            setAnalyticsData({
                peakHours:  data.peakHours  || [],
                roadPerf:   data.roadPerf   || [],
                efficiency: data.efficiency || { modeBreakdown: [], last1Hour: {}, totalCycles24h: 0 }
            });
        });

        axios.get(`${SERVER}/api/analytics/road-performance`).then(r => setAnalyticsData(prev => ({ ...prev, roadPerf: r.data }))).catch(() => {});
        axios.get(`${SERVER}/api/analytics/peak-hours`).then(r => setAnalyticsData(prev => ({ ...prev, peakHours: r.data }))).catch(() => {});
        axios.get(`${SERVER}/api/analytics/system-efficiency`).then(r => setAnalyticsData(prev => ({ ...prev, efficiency: r.data }))).catch(() => {});

        return () => socket.disconnect();
    }, []);

    const handleForce = async (road, command, duration) => {
        try {
            await axios.post(`${SERVER}/api/traffic/control`, { location: road, command, duration });
            showNotif(`✅ Force ${command} → ${road} for ${duration}s`, 'success');
        } catch (err) {
            showNotif(`❌ Failed: ${err.message}`, 'error');
        }
    };

    const winner       = decision?.winner;
    const redForOthers = decision?.redForOthers || redTime || 0;

    const scenarioMap = {};
    if (decision?.priorities) decision.priorities.forEach(p => { scenarioMap[p.road] = p.sensorScenario; });

    const decisionGreenMap = {};
    if (decision?.priorities) decision.priorities.forEach(p => { decisionGreenMap[p.road] = p.greenTime; });

    const activeSensors = Object.values(sensorWorking).filter(Boolean).length;

    return (
        <div style={{ padding: 20, fontFamily: "'Segoe UI', sans-serif", background: '#0a0f1e', minHeight: '100vh', color: 'white' }}>

            {/* Toast */}
            {notification && (
                <div style={{
                    position: 'fixed', top: 20, right: 20, zIndex: 9999,
                    background: notification.type === 'success' ? '#14532d' : '#7f1d1d',
                    border: `1px solid ${notification.type === 'success' ? '#22c55e' : '#ef4444'}`,
                    color: 'white', padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 'bold'
                }}>{notification.msg}</div>
            )}

            {/* ── HEADER ── */}
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <h1 style={{ fontSize: '2.2rem', margin: '0 0 4px', letterSpacing: 2 }}>🚦 H.Y.D.R.A Control Center</h1>
                <p style={{ color: '#475569', margin: 0, fontSize: 13 }}>Nawinna Junction, Kurunegala — Real-time Adaptive Signal Management</p>
                <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ background: connected ? '#14532d' : '#7f1d1d', color: connected ? '#4ade80' : '#f87171', padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 'bold' }}>
                        {connected ? '● LIVE' : '● OFFLINE'}
                    </span>
                    <span style={{ background: '#1e293b', color: '#94a3b8', padding: '3px 12px', borderRadius: 20, fontSize: 12 }}>
                        Mode: {decision?.mode || 'Starting...'}
                    </span>
                    <span style={{
                        background: rainDetected ? '#1e3a5f' : '#14532d',
                        color: rainDetected ? '#60a5fa' : '#4ade80',
                        border: `1px solid ${rainDetected ? '#3b82f6' : '#22c55e'}`,
                        padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 'bold'
                    }}>
                        {rainDetected ? `🌧️ RAIN — Yellow: ${yellowTime}s (3s+2s)` : `☀️ DRY — Yellow: ${yellowTime}s`}
                    </span>
                    <span style={{ background: '#1e293b', color: '#94a3b8', padding: '3px 12px', borderRadius: 20, fontSize: 12 }}>
                        📡 Sensors: {activeSensors}/4
                    </span>
                    <span style={{ background: '#1e293b', color: '#94a3b8', padding: '3px 12px', borderRadius: 20, fontSize: 12 }}>
                        🗺️ Google: {googleWorking ? 'Active' : 'Disabled'}
                    </span>
                </div>
            </div>

            {/* ── DECISION BANNER ── */}
            {decision?.winner && (
                <div style={{ background: 'linear-gradient(135deg,#1e3a5f,#0d2137)', border: '1px solid #2E75B6', borderRadius: 14, padding: '16px 22px', marginBottom: 22 }}>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '1.8rem' }}>🧠</span>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 'bold', fontSize: '1.05rem' }}>
                                Priority: <span style={{ color: '#4ade80' }}>{decision.winner} Road → GREEN ({decision.greenDuration}s)</span>
                                {decision.winnerScenario && <span style={{ marginLeft: 10 }}><ScenarioBadge scenario={decision.winnerScenario} /></span>}
                            </div>
                            <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
                                🟡 Yellow: {decision.yellowDuration || yellowTime}s
                                &nbsp;→&nbsp;
                                🔴 Others RED: <strong style={{ color: '#f87171' }}>{decision.redForOthers}s</strong>
                                &nbsp;| Mode: {decision.mode}
                            </div>
                            {rainDetected && (
                                <div style={{ color: '#60a5fa', fontSize: 11, marginTop: 4 }}>
                                    🌧️ Rain detected — Yellow extended to {yellowTime}s
                                </div>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            {['RED','YELLOW','GREEN'].map(c => (
                                <div key={c} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                                    <Bulb color={c} active={livePhase[winner] === c} size={38} />
                                    {livePhase[winner] === c && liveCountdown[winner] > 0 && (
                                        <span style={{ fontSize: 11, color: '#94a3b8' }}>{liveCountdown[winner]}s</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ── ROAD CARDS ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(400px,1fr))', gap: 16, marginBottom: 22 }}>
                {ROADS.map(road => {
                    const phase         = livePhase[road] || 'RED';
                    const count         = liveCountdown[road] || 0;
                    const dist          = sensorData[road] || 5000;
                    const google        = googleTraffic[road] || 'Unknown';
                    const isWin         = winner === road;
                    const ir            = irData[road] || { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' };
                    const ped           = pedStatus[road] || { requested: false, crossing: false, duration: 0 };
                    const scenario      = scenarioMap[road] || null;
                    const roadGreenTime = decisionGreenMap[road] || greenTime[road] || 3;
                    const isNonWinner   = !isWin && phase === 'RED';
                    const espUp         = espOnline[road] !== false;
                    const heavyHere     = heavyVehicleActive[road] || false;
                    // NEW: piezo raw state
                    const piezoActive   = piezoData[road] || false;

                    return (
                        <div key={road} style={{
                            background: 'linear-gradient(160deg,#1a2540,#111827)', borderRadius: 16, padding: 18,
                            border: isWin ? '2px solid #22c55e' : '1px solid #1e3a5f',
                            boxShadow: isWin ? '0 0 24px rgba(34,197,94,0.18)' : 'none', transition: 'all 0.3s'
                        }}>
                            {/* Card header row: info + main light + pedestrian light */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                                
                                {/* Left: all info */}
                                <div style={{ flex: 1 }}>
                                    {/* Road name + badges */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                                        <h3 style={{ margin: 0, color: '#cbd5e1', fontSize: 14, letterSpacing: 2, textTransform: 'uppercase' }}>
                                            {road} ROAD
                                        </h3>
                                        {isWin && <span style={{ color: '#4ade80', fontSize: 11, fontWeight: 'bold' }}>● PRIORITY</span>}
                                        {scenario && <ScenarioBadge scenario={scenario} />}
                                        {!espUp && (
                                            <span style={{ background: '#7f1d1d', color: '#f87171', border: '1px solid #ef4444', padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 'bold' }}>
                                                ⚡ ESP32 OFFLINE
                                            </span>
                                        )}
                                        {heavyHere && (
                                            <span style={{ background: '#1a1000', color: '#fb923c', border: '1px solid #f59e0b', padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 'bold' }}>
                                                🚛 HEAVY VEHICLE
                                            </span>
                                        )}
                                    </div>

                                    {/* Main traffic lights + phase label */}
                                    <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
                                        {['RED','YELLOW','GREEN'].map(c => (
                                            <div key={c} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                                                <div style={{ position: 'relative' }}>
                                                    <Bulb color={c} active={phase === c} size={36} />
                                                    {phase === c && count > 0 && (
                                                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 'bold', color: '#000' }}>
                                                            {count}
                                                        </div>
                                                    )}
                                                </div>
                                                <span style={{ fontSize: 9, color: phase === c ? (c === 'RED' ? '#ef4444' : c === 'YELLOW' ? '#f59e0b' : '#22c55e') : '#334155', letterSpacing: 1 }}>{c}</span>
                                            </div>
                                        ))}
                                        <div style={{ marginLeft: 6 }}>
                                            <span style={{ fontSize: 12, fontWeight: 'bold', color: phase === 'GREEN' ? '#4ade80' : phase === 'YELLOW' ? '#fde047' : '#f87171' }}>
                                                {phase}{count > 0 ? ` (${count}s)` : ''}
                                            </span>
                                            {isNonWinner && redForOthers > 0 && (
                                                <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>RED for {redForOthers}s this cycle</div>
                                            )}
                                        </div>
                                    </div>

                                    {/* ── ULTRASONIC SECTION ── */}
                                    <div style={{ background: '#0f172a', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                                            <span>📡</span>
                                            <span style={{ fontSize: 11, color: '#64748b' }}>Ultrasonic</span>
                                            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: sensorWorking[road] ? '#14532d' : '#1e293b', color: sensorWorking[road] ? '#4ade80' : '#475569' }}>
                                                {sensorWorking[road] ? '● ACTIVE' : '● OFFLINE'}
                                            </span>
                                            {scenario && (
                                                <span style={{ fontSize: 10, color: '#64748b' }}>
                                                    → {scenario === 'IR' ? 'Using IR (dist < 20cm)' : 'Using distance'}
                                                </span>
                                            )}
                                        </div>
                                        {/* Distance reading — simple text, no bar */}
                                        <div style={{ fontSize: 11, color: '#64748b' }}>
                                            Distance: <strong style={{ color: dist >= 5000 ? '#475569' : dist < 20 ? '#ef4444' : dist < 100 ? '#f59e0b' : '#4ade80' }}>
                                                {dist >= 5000 ? 'No vehicle' : `${Math.round(dist)} cm`}
                                            </strong>
                                        </div>
                                    </div>

                                    {/* ── IR SENSORS SECTION ── */}
                                    <div style={{ background: '#0f172a', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                                            <span>🔦</span>
                                            <span style={{ fontSize: 11, color: '#64748b' }}>IR Sensors</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                                            {[
                                                { label: 'IR-1 (0–5cm)',   blocked: ir.ir1Blocked },
                                                { label: 'IR-2 (5–10cm)', blocked: ir.ir2Blocked },
                                            ].map(s => (
                                                <div key={s.label} style={{
                                                    background: s.blocked ? '#7f1d1d' : '#1e293b',
                                                    color: s.blocked ? '#f87171' : '#475569',
                                                    border: `1px solid ${s.blocked ? '#ef4444' : '#334155'}`,
                                                    borderRadius: 8, padding: '3px 8px', fontSize: 10, fontWeight: 'bold'
                                                }}>
                                                    {s.blocked ? '🔴' : '🟢'} {s.label}: {s.blocked ? 'BLOCKED' : 'CLEAR'}
                                                </div>
                                            ))}
                                        </div>
                                        <TrafficDensityBadge density={ir.queueLevel || 'None'} />
                                        <div style={{ fontSize: 10, color: '#64748b', marginTop: 5 }}>
                                            {ir.queueLevel === 'Heavy' && `Both blocked → Green: ${roadGreenTime}s (3s + 6s heavy)`}
                                            {ir.queueLevel === 'Light' && `One blocked → Green: ${roadGreenTime}s (3s + 3s light)`}
                                            {(!ir.queueLevel || ir.queueLevel === 'None') && `No IR → Green: ${roadGreenTime}s (base)`}
                                        </div>
                                    </div>

                                    {/* ── NEW: PIEZO SENSOR SECTION ── */}
                                    <div style={{
                                        background: piezoActive ? '#1a1000' : '#0f172a',
                                        border: `1px solid ${piezoActive ? '#f59e0b' : '#1e293b'}`,
                                        borderRadius: 8, padding: 10, marginBottom: 8
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: 13 }}>🚛</span>
                                            <span style={{ fontSize: 11, color: '#64748b' }}>Piezo Sensor</span>
                                            {/* Active/inactive badge */}
                                            <span style={{
                                                fontSize: 10, padding: '1px 8px', borderRadius: 6,
                                                background: piezoActive ? '#3d2000' : '#1e293b',
                                                color: piezoActive ? '#fb923c' : '#475569',
                                                border: `1px solid ${piezoActive ? '#f59e0b' : '#334155'}`,
                                                fontWeight: 'bold'
                                            }}>
                                                {piezoActive ? '● HEAVY VEHICLE' : '● NO HEAVY VEHICLE'}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: 10, color: '#64748b', marginTop: 5 }}>
                                            {piezoActive
                                                ? 'Heavy vehicle detected (IR + vibration confirmed) → +3s Green extension'
                                                : 'Monitoring for heavy vehicle vibration. Active only when IR also blocked.'}
                                        </div>
                                        {piezoActive && (
                                            <div style={{ marginTop: 5, fontSize: 10, color: '#fb923c', fontWeight: 'bold' }}>
                                                ⚡ Green time extended by +3s during next decision
                                            </div>
                                        )}
                                    </div>

                                    {/* ── WEATHER ── */}
                                    <div style={{ background: '#0f172a', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                            <span>{rainDetected ? '🌧️' : '☀️'}</span>
                                            <span style={{ fontSize: 11, color: '#64748b' }}>Weather:</span>
                                            <span style={{ fontSize: 11, color: rainDetected ? '#60a5fa' : '#4ade80', fontWeight: 'bold' }}>
                                                {rainDetected ? `Raining — Yellow ${yellowTime}s (3s+2s)` : `Dry — Yellow ${yellowTime}s (normal)`}
                                            </span>
                                        </div>
                                    </div>

                                    {/* ── NEXT INTERSECTION ── */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                        <span style={{ fontSize: 13 }}>🗺️</span>
                                        <span style={{ fontSize: 11, color: '#64748b' }}>Next Intersection:</span>
                                        <TrafficBadge level={google} />
                                        {scenario === 'IR' && <span style={{ fontSize: 10, color: '#64748b' }}>(ranking only)</span>}
                                        {scenario === 'ULTRASONIC' && <span style={{ fontSize: 10, color: '#64748b' }}>(timing + ranking)</span>}
                                    </div>

                                    {/* ── PEDESTRIAN STATUS (text info) ── */}
                                    <div style={{
                                        background: ped.crossing ? '#1e3a5f' : ped.requested ? '#3d2000' : '#0f172a',
                                        border: `1px solid ${ped.crossing ? '#3b82f6' : ped.requested ? '#f59e0b' : '#1e293b'}`,
                                        borderRadius: 8, padding: 8, marginBottom: 8
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span>🚶</span>
                                            <span style={{ fontSize: 11, color: '#64748b' }}>Pedestrian</span>
                                            {ped.crossing && <span style={{ fontSize: 10, color: '#60a5fa', fontWeight: 'bold' }}>● CROSSING ({ped.duration || 3}s)</span>}
                                            {ped.requested && !ped.crossing && <span style={{ fontSize: 10, color: '#fde047', fontWeight: 'bold' }}>● WAITING</span>}
                                            {!ped.requested && !ped.crossing && <span style={{ fontSize: 10, color: '#475569' }}>Idle</span>}
                                        </div>
                                        {ped.requested && !ped.crossing && (
                                            <div style={{ marginTop: 4, fontSize: 10, color: '#fde047' }}>
                                                {phase === 'RED' && 'Pressed during RED → crossing when remaining time > 3s'}
                                                {phase === 'YELLOW' && 'Pressed during YELLOW → crossing after yellow ends'}
                                                {phase === 'GREEN' && 'Pressed during GREEN → crossing after green + yellow finish'}
                                            </div>
                                        )}
                                        {ped.crossing && (
                                            <div style={{ marginTop: 4, fontSize: 10, color: '#60a5fa' }}>
                                                Pedestrian crossing active — car signal held RED
                                            </div>
                                        )}
                                    </div>

                                    <ForcePanel road={road} onForce={handleForce} />
                                </div>

                                {/* Right column: MAIN traffic light (vertical) + PEDESTRIAN signal (vertical) */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
                                    
                                    {/* MAIN TRAFFIC LIGHT (3 colours)
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                                        <div style={{ fontSize: 9, color: '#64748b', letterSpacing: 1 }}>MAIN</div>
                                        <div style={{ background: '#111', padding: '10px 8px', borderRadius: 12, border: '2px solid #2a2a2a', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                            {['RED','YELLOW','GREEN'].map(c => <Bulb key={c} color={c} active={phase === c} size={28} />)}
                                        </div>
                                        {count > 0 && (
                                            <div style={{
                                                background: phase === 'GREEN' ? '#14532d' : phase === 'YELLOW' ? '#713f12' : '#7f1d1d',
                                                color: phase === 'GREEN' ? '#4ade80' : phase === 'YELLOW' ? '#fde047' : '#f87171',
                                                borderRadius: 6, padding: '2px 8px', fontSize: 13, fontWeight: 'bold'
                                            }}>
                                                {count}s
                                            </div>
                                        )}
                                    </div> */}

                                    {/* PEDESTRIAN SIGNAL (RED/GREEN only) */}
                                    <PedestrianSignalWidget
                                        ped={ped}
                                        mainPhase={phase}
                                        mainCountdown={count}
                                        yellowTime={yellowTime}
                                    />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ── SYSTEM CONFIG PANEL ── */}
            <div style={{ background: 'linear-gradient(160deg,#1a2540,#111827)', borderRadius: 16, padding: 20, marginBottom: 22, border: '1px solid #1e3a5f' }}>
                <h3 style={{ margin: '0 0 14px', color: '#94a3b8', fontSize: 14 }}>📊 System Configuration</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
                    {[
                        { label: 'System Mode',     value: decision?.mode || '—',                          ok: decision?.mode === 'BOTH' },
                        { label: 'Current Winner',  value: winner ? `${winner} → GREEN` : 'Starting',     ok: !!winner },
                        { label: 'Yellow Time',     value: `${yellowTime}s ${rainDetected ? '(3s+2s rain)' : '(normal)'}`, ok: true },
                        { label: 'RED for Others',  value: redForOthers > 0 ? `${redForOthers}s (dynamic)` : '—',          ok: redForOthers > 0, note: 'Equals winner Green + Yellow' },
                        { label: 'Sensor Accuracy', value: `${activeSensors}/4 active`,                   ok: activeSensors > 0 },
                        { label: 'Google Traffic',  value: googleWorking ? 'Active' : 'Disabled',         ok: googleWorking },
                        { label: 'Rain Sensor',     value: rainDetected ? 'Rain' : 'Clear',               ok: true },
                        { label: 'Winner Scenario', value: decision?.winnerScenario || '—',               ok: !!decision?.winnerScenario },
                        { label: 'Green Base',      value: '3s base + IR bonus (Light +3s, Heavy +6s)',   ok: true },
                        { label: 'Piezo Bonus',     value: 'Heavy vehicle → +3s stacked on IR green',     ok: true },
                    ].map(m => (
                        <div key={m.label} style={{ background: '#0f172a', borderRadius: 10, padding: 12, border: `1px solid ${m.ok ? '#22c55e33' : '#ef444433'}` }}>
                            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4, letterSpacing: 1 }}>{m.label}</div>
                            <div style={{ fontSize: 13, fontWeight: 'bold', color: m.ok ? '#4ade80' : '#f87171' }}>{m.value}</div>
                            {m.note && <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>{m.note}</div>}
                        </div>
                    ))}
                </div>
            </div>

            {/* ── PRIORITY TABLE ── */}
            {decision?.priorities && (
                <div style={{ background: 'linear-gradient(160deg,#1a2540,#111827)', borderRadius: 16, padding: 20, marginBottom: 22, border: '1px solid #1e3a5f' }}>
                    <h3 style={{ margin: '0 0 14px', color: '#94a3b8', fontSize: 14 }}>📋 Signal Priority Analysis</h3>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #1e3a5f' }}>
                                    {['Rank','Road','Scenario','Distance','IR Queue','Piezo','Rain','Next Traffic','Score','Green Time','LED'].map(h => (
                                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#475569', fontSize: 10, letterSpacing: 1, whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {decision.priorities.map((p, i) => {
                                    const irForRoad    = irData[p.road] || { queueLevel: 'None' };
                                    const piezoForRoad = piezoData[p.road] || false;
                                    return (
                                        <tr key={p.road} style={{ borderBottom: '1px solid #0f172a', background: i === 0 ? 'rgba(34,197,94,0.05)' : 'transparent' }}>
                                            <td style={{ padding: '8px 10px', color: i === 0 ? '#4ade80' : '#64748b', fontWeight: 'bold' }}>#{i+1}</td>
                                            <td style={{ padding: '8px 10px', fontWeight: 'bold', color: i === 0 ? '#e2e8f0' : '#94a3b8' }}>{p.road}</td>
                                            <td style={{ padding: '8px 10px' }}>{p.sensorScenario ? <ScenarioBadge scenario={p.sensorScenario} /> : '—'}</td>
                                            <td style={{ padding: '8px 10px', color: '#94a3b8' }}>{p.distance ? `${Math.round(p.distance)}cm` : 'None'}</td>
                                            <td style={{ padding: '8px 10px', color: irForRoad.queueLevel === 'Heavy' ? '#f87171' : irForRoad.queueLevel === 'Light' ? '#fde047' : '#4ade80', fontWeight: 'bold' }}>
                                                {irForRoad.queueLevel === 'Heavy' ? '🔴 HEAVY' : irForRoad.queueLevel === 'Light' ? '🟡 LIGHT' : '🟢 NONE'}
                                            </td>
                                            {/* NEW: Piezo column */}
                                            <td style={{ padding: '8px 10px' }}>
                                                <span style={{ color: piezoForRoad ? '#fb923c' : '#475569', fontWeight: 'bold', fontSize: 11 }}>
                                                    {piezoForRoad ? '🚛 YES' : '—'}
                                                </span>
                                            </td>
                                            <td style={{ padding: '8px 10px', color: rainDetected ? '#60a5fa' : '#4ade80', fontSize: 11 }}>
                                                {rainDetected ? `🌧️ ${yellowTime}s` : `☀️ ${yellowTime}s`}
                                            </td>
                                            <td style={{ padding: '8px 10px' }}><TrafficBadge level={p.traffic} /></td>
                                            <td style={{ padding: '8px 10px', color: p.score > 0 ? '#4ade80' : p.score < 0 ? '#f87171' : '#94a3b8', fontWeight: 'bold' }}>
                                                {typeof p.score === 'number' ? p.score.toFixed(1) : '—'}
                                            </td>
                                            <td style={{ padding: '8px 10px', color: i === 0 ? '#4ade80' : '#94a3b8', fontWeight: i === 0 ? 'bold' : 'normal' }}>
                                                {p.greenTime ? `${Math.round(p.greenTime)}s` : '—'}
                                            </td>
                                            <td style={{ padding: '8px 10px' }}>
                                                <span style={{
                                                    background: livePhase[p.road] === 'GREEN' ? '#14532d' : livePhase[p.road] === 'YELLOW' ? '#713f12' : '#7f1d1d',
                                                    color: livePhase[p.road] === 'GREEN' ? '#4ade80' : livePhase[p.road] === 'YELLOW' ? '#fde047' : '#f87171',
                                                    padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 'bold', whiteSpace: 'nowrap'
                                                }}>
                                                    {livePhase[p.road] || 'RED'}{liveCountdown[p.road] > 0 ? ` (${liveCountdown[p.road]}s)` : ''}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div style={{ marginTop: 12, padding: 10, background: '#0f172a', borderRadius: 8, fontSize: 11, color: '#64748b', border: '1px solid #1e3a5f' }}>
                        🔴 <strong style={{ color: '#94a3b8' }}>Dynamic RED (non-priority roads):</strong>&nbsp;
                        {winner && decision?.greenDuration
                            ? `${decision.greenDuration}s green + ${decision.yellowDuration || yellowTime}s yellow = ${decision.redForOthers}s total RED`
                            : 'Calculated each cycle as winner\'s green + yellow duration'}
                    </div>
                </div>
            )}

            {/* ── SYSTEM RULES ── */}
            <div style={{ background: 'linear-gradient(160deg,#1a2540,#111827)', borderRadius: 16, padding: 16, marginTop: 8, border: '1px solid #1e3a5f' }}>
                <h3 style={{ margin: '0 0 12px', color: '#94a3b8', fontSize: 13 }}>📋 System Rules</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 10, fontSize: 11, color: '#64748b' }}>
                    <div>📡 <strong style={{ color: '#60a5fa' }}>ULTRASONIC mode:</strong> dist ≥ 20cm — uses distance + Google traffic for timing</div>
                    <div>🔦 <strong style={{ color: '#c084fc' }}>IR mode:</strong> dist &lt; 20cm — uses IR sensors for timing (vehicle at stop line)</div>
                    <div>🟢 <strong>GREEN:</strong> 3s base + Light +3s=6s, Heavy +6s=9s, Piezo (IR+vibration) +3s stacked</div>
                    <div>🟡 <strong>YELLOW:</strong> 3s dry, +2s rain = 5s total | Sequence: RED→YELLOW→GREEN→YELLOW→RED</div>
                    <div>🔴 <strong>RED (others):</strong> Dynamic = winner GREEN + YELLOW duration each cycle</div>
                    <div>🚶 <strong>Pedestrian:</strong> A=RED (immediate if &gt;3s remain), B=YELLOW post-green (hold), C=GREEN (wait), D=YELLOW (countdown then cross)</div>
                    <div>🚛 <strong>Piezo:</strong> Only counts when IR also blocked — confirmed heavy vehicle → +3s green bonus</div>
                    <div>⚡ <strong>ESP32 Offline:</strong> Downed lanes excluded from winning — synthetic RED timing applied</div>
                </div>
            </div>

            {/* ── TRAFFIC ANALYTICS ── */}
            <div style={{ background: 'linear-gradient(160deg,#1a2540,#111827)', borderRadius: 16, padding: 20, marginTop: 22, border: '1px solid #1e3a5f' }}>
                <h3 style={{ margin: '0 0 6px', color: '#e2e8f0', fontSize: 16 }}>🗺️ Traffic Analytics — Nawinna Junction</h3>
                <p style={{ color: '#475569', fontSize: 12, margin: '0 0 16px' }}>
                    Live data to help road users choose the best time and route to travel.
                </p>

                <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
                    {[
                        { id: 'livecongestion', label: '🚦 Live Road Status' },
                        { id: 'besttimes',      label: '⏰ Best Times to Travel' },
                        { id: 'roadhealth',     label: '🛣️ Road Performance' },
                    ].map(tab => (
                        <button key={tab.id} onClick={() => setAnalyticsTab(tab.id)}
                            style={{
                                background: analyticsTab === tab.id ? '#1e3a5f' : '#0f172a',
                                color: analyticsTab === tab.id ? '#60a5fa' : '#475569',
                                border: `1px solid ${analyticsTab === tab.id ? '#3b82f6' : '#334155'}`,
                                padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 'bold'
                            }}>
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* TAB 1: Live Road Status */}
                {analyticsTab === 'livecongestion' && (
                    <div>
                        <p style={{ fontSize: 11, color: '#64748b', marginBottom: 14 }}>
                            Current conditions at Nawinna Junction right now. Green = easy to pass, Red = heavy wait expected.
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
                            {ROADS.map(road => {
                                const dist   = sensorData[road] || 5000;
                                const ir     = irData[road] || {};
                                const google = googleTraffic[road] || 'Unknown';
                                const heavy  = heavyVehicleActive[road];
                                const espUp  = espOnline[road] !== false;

                                let congestion = 'Low';
                                let waitEst    = 'Under 1 min';
                                let tip        = 'Good time to travel this road';
                                let barColor   = '#22c55e';

                                if (!espUp) {
                                    congestion = 'Unknown'; waitEst = 'Sensor offline';
                                    tip = 'No live data — proceed with caution'; barColor = '#64748b';
                                } else if (ir.queueLevel === 'Heavy' || google === 'Heavy') {
                                    congestion = 'Heavy';
                                    waitEst = `${(greenTime[road] || 9) + yellowTime}–${(greenTime[road] || 9) * 2}s wait`;
                                    tip = 'Expect delays — consider alternate route'; barColor = '#ef4444';
                                } else if (ir.queueLevel === 'Light' || google === 'Medium') {
                                    congestion = 'Moderate';
                                    waitEst = `${(greenTime[road] || 6)}–${(greenTime[road] || 6) + yellowTime}s wait`;
                                    tip = 'Some traffic — normal wait time'; barColor = '#f59e0b';
                                } else if (dist < 100) {
                                    congestion = 'Moderate'; waitEst = 'Short queue detected';
                                    tip = 'Light traffic — good to go'; barColor = '#f59e0b';
                                }

                                return (
                                    <div key={road} style={{ background: '#0f172a', borderRadius: 12, padding: 14, border: `2px solid ${barColor}44` }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                            <span style={{ fontWeight: 'bold', color: '#e2e8f0', fontSize: 14 }}>{road} Road</span>
                                            <span style={{ background: `${barColor}22`, color: barColor, border: `1px solid ${barColor}`, padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 'bold' }}>{congestion}</span>
                                        </div>
                                        {heavy && (
                                            <div style={{ background: '#1a1000', color: '#fb923c', border: '1px solid #f59e0b', borderRadius: 6, padding: '3px 8px', fontSize: 10, marginBottom: 6, fontWeight: 'bold' }}>
                                                🚛 Heavy vehicle in queue
                                            </div>
                                        )}
                                        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>⏳ Est. wait: <strong style={{ color: barColor }}>{waitEst}</strong></div>
                                        <div style={{ fontSize: 11, color: '#64748b' }}>{tip}</div>
                                        <div style={{ background: '#1e293b', borderRadius: 4, height: 6, marginTop: 8 }}>
                                            <div style={{ width: congestion === 'Heavy' ? '85%' : congestion === 'Moderate' ? '50%' : congestion === 'Unknown' ? '30%' : '15%', background: barColor, height: '100%', borderRadius: 4, transition: 'width 1s' }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {rainDetected && (
                            <div style={{ marginTop: 12, padding: 12, background: '#0f1f3d', border: '1px solid #3b82f6', borderRadius: 10 }}>
                                <div style={{ color: '#60a5fa', fontWeight: 'bold', fontSize: 13 }}>🌧️ Rain Advisory</div>
                                <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
                                    Rain detected at junction. Yellow light extended to {yellowTime}s for safety. Allow extra braking distance.
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* TAB 2: Best Times */}
                {analyticsTab === 'besttimes' && (
                    <div>
                        <p style={{ fontSize: 11, color: '#64748b', marginBottom: 14 }}>
                            Based on traffic data history. Shows the least congested hours at this junction.
                        </p>
                        {analyticsData.peakHours.filter(h => h.North > 0 || h.South > 0 || h.East > 0 || h.West > 0).length > 0 ? (
                            <div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                                    {analyticsData.peakHours.filter(h => h.North > 0 || h.South > 0 || h.East > 0 || h.West > 0).map(h => {
                                        const avg = Math.round((h.North + h.South + h.East + h.West) / 4);
                                        const color = avg > 60 ? '#ef4444' : avg > 30 ? '#f59e0b' : '#22c55e';
                                        const label = avg > 60 ? 'Peak — avoid' : avg > 30 ? 'Moderate' : '✅ Good time';
                                        return (
                                            <div key={h.hour} style={{ background: '#0f172a', borderRadius: 8, padding: 10, border: `1px solid ${color}33`, textAlign: 'center' }}>
                                                <div style={{ fontSize: 14, fontWeight: 'bold', color: '#e2e8f0' }}>
                                                    {h.hour.toString().padStart(2,'0')}:00
                                                </div>
                                                <div style={{ fontSize: 11, color, fontWeight: 'bold', marginTop: 3 }}>{label}</div>
                                                <div style={{ background: '#1e293b', borderRadius: 3, height: 5, marginTop: 5 }}>
                                                    <div style={{ width: `${avg}%`, background: color, height: '100%', borderRadius: 3 }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div style={{ marginTop: 12, padding: 10, background: '#0f172a', borderRadius: 8, fontSize: 11, color: '#64748b' }}>
                                    💡 <strong style={{ color: '#94a3b8' }}>Tip:</strong> Green hours are the best times to use Nawinna Junction. Red hours expect heavy delays.
                                </div>
                            </div>
                        ) : (
                            <div style={{ color: '#475569', fontSize: 12, padding: 20, textAlign: 'center' }}>
                                📊 Collecting historical data... Check back after the system has run for a few hours.
                            </div>
                        )}
                    </div>
                )}

                {/* TAB 3: Road Performance */}
                {analyticsTab === 'roadhealth' && (
                    <div>
                        <p style={{ fontSize: 11, color: '#64748b', marginBottom: 14 }}>
                            Which road gets the most green light priority and how long you typically wait.
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
                            {analyticsData.roadPerf.length > 0 ? analyticsData.roadPerf.map(r => {
                                const wait  = r.avgWaitTime;
                                const color = wait > 30 ? '#ef4444' : wait > 15 ? '#f59e0b' : '#22c55e';
                                return (
                                    <div key={r.road} style={{ background: '#0f172a', borderRadius: 12, padding: 14, border: `1px solid ${color}44` }}>
                                        <div style={{ fontWeight: 'bold', color: '#e2e8f0', marginBottom: 10, fontSize: 14 }}>{r.road} Road</div>
                                        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 2 }}>
                                            <div>⏳ Avg wait time: <strong style={{ color }}>{wait}s</strong></div>
                                            <div>🟢 Avg green time: <strong style={{ color: '#22c55e' }}>{r.avgGreenTime}s</strong></div>
                                            <div>🏆 Priority wins: <strong style={{ color: '#60a5fa' }}>{r.priorityWins}</strong></div>
                                            <div>🔴 Heavy traffic events: {r.heavyTrafficCount}</div>
                                            <div>⚡ Gets green when needed: <strong style={{ color: '#a78bfa' }}>{r.efficiency}%</strong></div>
                                        </div>
                                        <div style={{ marginTop: 8, fontSize: 11, color: wait > 30 ? '#ef4444' : wait > 15 ? '#f59e0b' : '#4ade80', fontWeight: 'bold' }}>
                                            {wait > 30 ? '⚠️ Long waits on this road' : wait > 15 ? '⚡ Moderate — normal operation' : '✅ Short waits — good flow'}
                                        </div>
                                    </div>
                                );
                            }) : (
                                <div style={{ color: '#475569', fontSize: 12, padding: 20 }}>Collecting road performance data...</div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <div style={{ textAlign: 'center', marginTop: 28, color: '#1e3a5f', fontSize: 11 }}>
                HYDRA v5.0 — Fixed Pedestrian Signal + Piezo — Nawinna Junction, Kurunegala
            </div>
        </div>
    );
}

export default App;