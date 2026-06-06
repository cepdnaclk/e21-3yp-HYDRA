// // client/src/pages/UserDashboard.js - HYDRA v8.0 USER VERSION
// // No Force Override Panel - Read-only view for regular users

// import React, { useState, useEffect, useRef } from 'react';
// import io from 'socket.io-client';
// // axios removed - not used in UserDashboard

// const SERVER = 'http://56.228.30.50:5000';
// const ROADS = ['North', 'South', 'East', 'West'];

// // ── Traffic light bulb ────────────────────────────────────────────────────────
// const Bulb = ({ color, active, size = 36 }) => {
//     const C = {
//         RED:    { on: '#ef4444', off: '#3a0000', glow: '#ef4444' },
//         YELLOW: { on: '#f59e0b', off: '#3a2e00', glow: '#f59e0b' },
//         GREEN:  { on: '#22c55e', off: '#003310', glow: '#22c55e' },
//     };
//     const c = C[color];
//     return (
//         <div style={{
//             width: size, height: size, borderRadius: '50%',
//             background: active ? c.on : c.off,
//             boxShadow: active ? `0 0 14px ${c.glow}, 0 0 28px ${c.glow}` : 'none',
//             transition: 'all 0.3s ease'
//         }} />
//     );
// };

// // ── User Dashboard (No Force Override) ──────────────────────────────────────
// export default function UserDashboard({ user, onLogout }) {
//     const [livePhase,   setLivePhase]   = useState({ North:'RED', South:'RED', East:'RED', West:'RED' });
//     const [liveCD,      setLiveCD]      = useState({ North:0, South:0, East:0, West:0 });
//     const [decision,    setDecision]    = useState(null);
//     const [connected,   setConnected]   = useState(false);
//     const [rainDetected, setRainDetected] = useState(false);
//     const [yellowTime,  setYellowTime]  = useState(3);
//     const [googleWorking, setGoogleWorking] = useState(false);
//     const [activeSensors, setActiveSensors] = useState(0);

//     const socketRef = useRef(null);

//     useEffect(() => {
//         const socket = io(SERVER, { transports: ['websocket', 'polling'] });
//         socketRef.current = socket;
        
//         socket.on('connect', () => setConnected(true));
//         socket.on('disconnect', () => setConnected(false));

//         socket.on('fullState', data => {
//             if (data.livePhase) setLivePhase(data.livePhase);
//             if (data.liveCountdown) setLiveCD(data.liveCountdown);
//             if (data.latestDecision) setDecision(data.latestDecision);
//             if (data.rainDetected !== undefined) {
//                 setRainDetected(data.rainDetected);
//                 setYellowTime(data.rainDetected ? 5 : 3);
//             }
//             if (data.googleWorking !== undefined) setGoogleWorking(data.googleWorking);
            
//             // Count active sensors
//             if (data.usWorking) {
//                 const count = Object.values(data.usWorking).filter(Boolean).length;
//                 setActiveSensors(count);
//             }
//         });

//         socket.on('countdown', ({ road, phase, remaining }) => {
//             setLiveCD(prev => ({ ...prev, [road]: remaining }));
//             setLivePhase(prev => ({ ...prev, [road]: phase }));
//         });
        
//         socket.on('ledStateUpdate', ({ road, state }) => {
//             setLivePhase(prev => ({ ...prev, [road]: state }));
//         });
        
//         socket.on('newDecision', dec => setDecision(dec));
        
//         socket.on('rainUpdate', ({ rainDetected: r }) => {
//             setRainDetected(r);
//             setYellowTime(r ? 5 : 3);
//         });

//         return () => socket.disconnect();
//     }, []);

//     const winner = decision?.winner;
//     const redForOthers = decision?.redForOthers || 0;

//     return (
//         <div style={{ 
//             padding: 20, 
//             fontFamily: "'Segoe UI', sans-serif", 
//             background: '#0a0f1e', 
//             minHeight: '100vh', 
//             color: 'white' 
//         }}>
//             {/* User Header */}
//             <div style={{
//                 display: 'flex',
//                 justifyContent: 'space-between',
//                 alignItems: 'center',
//                 marginBottom: 16,
//                 padding: '10px 16px',
//                 background: '#0f172a',
//                 borderRadius: 12,
//                 border: '1px solid #1e293b'
//             }}>
//                 <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
//                     {user.photo && (
//                         <img 
//                             src={user.photo} 
//                             alt="avatar" 
//                             style={{ width: 32, height: 32, borderRadius: '50%' }} 
//                         />
//                     )}
//                     <div>
//                         <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 'bold' }}>
//                             {user.name}
//                         </div>
//                         <div style={{ color: '#475569', fontSize: 11 }}>{user.email}</div>
//                     </div>
//                 </div>
//                 <button 
//                     onClick={onLogout} 
//                     style={{
//                         background: '#1e293b',
//                         border: '1px solid #334155',
//                         borderRadius: 8,
//                         color: '#94a3b8',
//                         padding: '6px 14px',
//                         fontSize: 12,
//                         cursor: 'pointer'
//                     }}
//                 >
//                     Sign Out
//                 </button>
//             </div>

//             {/* Header Status */}
//             <div style={{ textAlign: 'center', marginBottom: 24 }}>
//                 <h1 style={{ fontSize: '2.2rem', margin: '0 0 4px', letterSpacing: 2 }}>
//                     🚦 H.Y.D.R.A User Dashboard
//                 </h1>
//                 <p style={{ color: '#475569', margin: 0, fontSize: 13 }}>
//                     Nawinna Junction, Kurunegala — Real-time Traffic Information
//                 </p>
//                 <div style={{ 
//                     marginTop: 10, 
//                     display: 'flex', 
//                     justifyContent: 'center', 
//                     gap: 10, 
//                     flexWrap: 'wrap', 
//                     alignItems: 'center' 
//                 }}>
//                     <span style={{
//                         background: connected ? '#14532d' : '#7f1d1d',
//                         color: connected ? '#4ade80' : '#f87171',
//                         padding: '3px 12px',
//                         borderRadius: 20,
//                         fontSize: 12,
//                         fontWeight: 'bold'
//                     }}>
//                         {connected ? '● LIVE' : '● OFFLINE'}
//                     </span>
//                     <span style={{
//                         background: '#1e293b',
//                         color: '#94a3b8',
//                         padding: '3px 12px',
//                         borderRadius: 20,
//                         fontSize: 12
//                     }}>
//                         Mode: {decision?.mode || 'Starting...'}
//                     </span>
//                     <span style={{
//                         background: rainDetected ? '#1e3a5f' : '#14532d',
//                         color: rainDetected ? '#60a5fa' : '#4ade80',
//                         border: `1px solid ${rainDetected ? '#3b82f6' : '#22c55e'}`,
//                         padding: '3px 12px',
//                         borderRadius: 20,
//                         fontSize: 12,
//                         fontWeight: 'bold'
//                     }}>
//                         {rainDetected ? `🌧️ RAIN — Yellow: ${yellowTime}s` : `☀️ DRY — Yellow: ${yellowTime}s`}
//                     </span>
//                     <span style={{
//                         background: '#1e293b',
//                         color: '#94a3b8',
//                         padding: '3px 12px',
//                         borderRadius: 20,
//                         fontSize: 12
//                     }}>
//                         📡 Sensors: {activeSensors}/4
//                     </span>
//                     <span style={{
//                         background: '#1e293b',
//                         color: '#94a3b8',
//                         padding: '3px 12px',
//                         borderRadius: 20,
//                         fontSize: 12
//                     }}>
//                         🗺️ Google: {googleWorking ? 'Active' : 'Disabled'}
//                     </span>
//                 </div>
//             </div>

//             {/* Decision Banner */}
//             {decision?.winner && (
//                 <div style={{
//                     background: 'linear-gradient(135deg,#1e3a5f,#0d2137)',
//                     border: '1px solid #2E75B6',
//                     borderRadius: 14,
//                     padding: '16px 22px',
//                     marginBottom: 22
//                 }}>
//                     <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
//                         <span style={{ fontSize: '1.8rem' }}>🧠</span>
//                         <div style={{ flex: 1 }}>
//                             <div style={{ fontWeight: 'bold', fontSize: '1.05rem' }}>
//                                 Priority: <span style={{ color: '#4ade80' }}>
//                                     {decision.winner} Road → GREEN ({decision.greenDuration}s)
//                                 </span>
//                             </div>
//                             <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
//                                 🟡 Yellow: {decision.yellowDuration || yellowTime}s
//                                 &nbsp;→&nbsp;
//                                 🔴 Others RED: <strong style={{ color: '#f87171' }}>
//                                     {decision.redForOthers}s
//                                 </strong>
//                                 &nbsp;| Mode: {decision.mode}
//                             </div>
//                             {rainDetected && (
//                                 <div style={{ color: '#60a5fa', fontSize: 11, marginTop: 4 }}>
//                                     🌧️ Rain detected — Yellow extended to {yellowTime}s
//                                 </div>
//                             )}
//                         </div>
//                         <div style={{ display: 'flex', gap: 10 }}>
//                             {['RED', 'YELLOW', 'GREEN'].map(c => (
//                                 <div key={c} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
//                                     <Bulb color={c} active={livePhase[decision.winner] === c} size={38} />
//                                     {livePhase[decision.winner] === c && liveCD[decision.winner] > 0 && (
//                                         <span style={{ fontSize: 11, color: '#94a3b8' }}>
//                                             {liveCD[decision.winner]}s
//                                         </span>
//                                     )}
//                                 </div>
//                             ))}
//                         </div>
//                     </div>
//                 </div>
//             )}

//             {/* Road Status Cards - Simple View */}
//             <div style={{ 
//                 display: 'grid', 
//                 gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
//                 gap: 16, 
//                 marginBottom: 22 
//             }}>
//                 {ROADS.map(road => {
//                     const phase = livePhase[road] || 'RED';
//                     const count = liveCD[road] || 0;
//                     const isWinner = winner === road;
//                     const phaseColor = phase === 'GREEN' ? '#4ade80' : phase === 'YELLOW' ? '#fde047' : '#f87171';
                    
//                     return (
//                         <div key={road} style={{
//                             background: 'linear-gradient(160deg,#1a2540,#111827)',
//                             borderRadius: 16,
//                             padding: 18,
//                             border: isWinner ? '2px solid #22c55e' : '1px solid #1e3a5f',
//                             textAlign: 'center',
//                             boxShadow: isWinner ? '0 0 24px rgba(34,197,94,0.18)' : 'none'
//                         }}>
//                             <h3 style={{ margin: '0 0 10px', color: '#cbd5e1', fontSize: 18 }}>
//                                 {road} Road
//                                 {isWinner && (
//                                     <span style={{ 
//                                         color: '#4ade80', 
//                                         fontSize: 11, 
//                                         fontWeight: 'bold', 
//                                         marginLeft: 8 
//                                     }}>
//                                         ● PRIORITY
//                                     </span>
//                                 )}
//                             </h3>
                            
//                             <div style={{ display: 'flex', justifyContent: 'center', gap: 15, marginBottom: 10 }}>
//                                 {['RED', 'YELLOW', 'GREEN'].map(c => (
//                                     <Bulb key={c} color={c} active={phase === c} size={40} />
//                                 ))}
//                             </div>
                            
//                             <div style={{ fontSize: 20, fontWeight: 'bold', color: phaseColor }}>
//                                 {phase} {count > 0 ? `(${count}s)` : ''}
//                             </div>
                            
//                             {!isWinner && phase === 'RED' && redForOthers > 0 && (
//                                 <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
//                                     RED for {redForOthers}s this cycle
//                                 </div>
//                             )}
//                         </div>
//                     );
//                 })}
//             </div>

//             {/* System Information */}
//             <div style={{
//                 background: 'linear-gradient(160deg,#1a2540,#111827)',
//                 borderRadius: 16,
//                 padding: 20,
//                 border: '1px solid #1e3a5f'
//             }}>
//                 <h3 style={{ margin: '0 0 14px', color: '#94a3b8', fontSize: 14 }}>
//                     📊 System Information
//                 </h3>
//                 <div style={{ 
//                     display: 'grid', 
//                     gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
//                     gap: 12 
//                 }}>
//                     <div style={{ background: '#0f172a', borderRadius: 10, padding: 12 }}>
//                         <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>System Mode</div>
//                         <div style={{ fontSize: 13, fontWeight: 'bold', color: '#4ade80' }}>
//                             {decision?.mode || '—'}
//                         </div>
//                     </div>
//                     <div style={{ background: '#0f172a', borderRadius: 10, padding: 12 }}>
//                         <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>Current Priority</div>
//                         <div style={{ fontSize: 13, fontWeight: 'bold', color: '#4ade80' }}>
//                             {winner ? `${winner} → GREEN` : 'Starting'}
//                         </div>
//                     </div>
//                     <div style={{ background: '#0f172a', borderRadius: 10, padding: 12 }}>
//                         <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>Yellow Light Time</div>
//                         <div style={{ fontSize: 13, fontWeight: 'bold', color: rainDetected ? '#60a5fa' : '#4ade80' }}>
//                             {yellowTime}s {rainDetected ? '(rain extended)' : '(normal)'}
//                         </div>
//                     </div>
//                     <div style={{ background: '#0f172a', borderRadius: 10, padding: 12 }}>
//                         <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>Green Light Base</div>
//                         <div style={{ fontSize: 13, fontWeight: 'bold', color: '#4ade80' }}>
//                             3s + Light+3s + Heavy+6s + Piezo+3s
//                         </div>
//                     </div>
//                 </div>
//             </div>

//             {/* Footer */}
//             <div style={{ textAlign: 'center', marginTop: 28, color: '#1e3a5f', fontSize: 11 }}>
//                 HYDRA v8.0 — User Dashboard — Nawinna Junction, Kurunegala
//             </div>
//         </div>
//     );
// }


// client/src/pages/UserDashboard.js — HYDRA v8.0 USER VERSION
// Sections included (same as AdminDashboard):
//   ✅ Header + status badges
//   ✅ Decision banner
//   ✅ Road cards (traffic lights, dual ultrasonic, piezo, rain, pedestrian, Google traffic)
//   ✅ Priority table
//   ✅ Traffic Analytics (all 3 tabs)
// Sections removed (admin-only):
//   ❌ Traffic Police Override (Force RED / YELLOW / GREEN)
//   ❌ System Configuration panel
//   ❌ System Rules (v8.0)

import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';

const SERVER = 'http://56.228.30.50:5000';
const ROADS  = ['North', 'South', 'East', 'West'];

// ── Traffic Light Bulb ────────────────────────────────────────────────────────
const Bulb = ({ color, active, size = 36 }) => {
    const C = {
        RED:    { on: '#ef4444', off: '#3a0000', glow: '#ef4444' },
        YELLOW: { on: '#f59e0b', off: '#3a2e00', glow: '#f59e0b' },
        GREEN:  { on: '#22c55e', off: '#003310', glow: '#22c55e' },
    };
    const c = C[color];
    return (
        <div style={{
            width: size, height: size, borderRadius: '50%',
            background: active ? c.on : c.off,
            boxShadow: active ? `0 0 14px ${c.glow}, 0 0 28px ${c.glow}` : 'none',
            transition: 'all 0.3s ease', flexShrink: 0
        }} />
    );
};

// ── Pedestrian Bulb ───────────────────────────────────────────────────────────
const PedBulb = ({ color, active, size = 26 }) => {
    const C = {
        RED:   { on: '#ef4444', off: '#3a0000' },
        GREEN: { on: '#22c55e', off: '#003310' },
    };
    const c = C[color];
    return (
        <div style={{
            width: size, height: size, borderRadius: '50%',
            background: active ? c.on : c.off,
            boxShadow: active ? `0 0 10px ${c.on}` : 'none',
            transition: 'all 0.3s ease'
        }} />
    );
};

// ── Ultrasonic Sensor Panel ───────────────────────────────────────────────────
const USSensorPanel = ({ us1Stable, us2Stable, us1Raw, us2Raw, usOnline }) => {
    const ql = us1Stable && us2Stable ? 'Heavy' : us1Stable ? 'Light' : 'None';
    const qlColor = ql === 'Heavy' ? '#f87171' : ql === 'Light' ? '#fde047' : '#4ade80';
    const qlBg    = ql === 'Heavy' ? '#7f1d1d' : ql === 'Light' ? '#713f12' : '#14532d';

    return (
        <div style={{ background: '#0f172a', borderRadius: 10, padding: 12, marginBottom: 8, border: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 14 }}>📡</span>
                <span style={{ fontSize: 11, fontWeight: 'bold', color: '#94a3b8' }}>DUAL ULTRASONIC SENSORS</span>
                <span style={{
                    fontSize: 9, padding: '2px 8px', borderRadius: 10, fontWeight: 'bold',
                    background: usOnline ? '#14532d' : '#7f1d1d',
                    color: usOnline ? '#4ade80' : '#f87171'
                }}>
                    {usOnline ? '● ONLINE' : '● OFFLINE'}
                </span>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {/* US1 */}
                <div style={{
                    flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid',
                    background: us1Stable ? '#3a0000' : '#0f2010',
                    borderColor: us1Stable ? '#ef4444' : '#22c55e'
                }}>
                    <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>
                        US1 — 5cm from stop line
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{
                            width: 12, height: 12, borderRadius: '50%',
                            background: us1Stable ? '#ef4444' : '#22c55e',
                            boxShadow: us1Stable ? '0 0 8px #ef4444' : 'none'
                        }} />
                        <span style={{ fontSize: 11, fontWeight: 'bold', color: us1Stable ? '#f87171' : '#4ade80' }}>
                            {us1Stable ? '🔴 VEHICLE DETECTED' : '🟢 CLEAR'}
                        </span>
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                        Raw: {us1Raw < 900 ? `${us1Raw.toFixed ? us1Raw.toFixed(1) : us1Raw} cm` : 'No reading'}
                    </div>
                    {us1Stable && (
                        <div style={{ fontSize: 9, color: '#f87171', marginTop: 3 }}>
                            Stable for ≥ 5s → confirmed
                        </div>
                    )}
                </div>

                {/* US2 */}
                <div style={{
                    flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid',
                    background: us2Stable && us1Stable ? '#3a0000' : us2Stable && !us1Stable ? '#2a1500' : '#0f2010',
                    borderColor: us2Stable && us1Stable ? '#ef4444' : us2Stable && !us1Stable ? '#f59e0b' : '#22c55e'
                }}>
                    <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>
                        US2 — 15cm from stop line
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{
                            width: 12, height: 12, borderRadius: '50%',
                            background: us2Stable && us1Stable ? '#ef4444' : us2Stable ? '#f59e0b' : '#22c55e',
                            boxShadow: us2Stable && us1Stable ? '0 0 8px #ef4444' : 'none'
                        }} />
                        <span style={{
                            fontSize: 11, fontWeight: 'bold',
                            color: us2Stable && us1Stable ? '#f87171' : us2Stable ? '#fde047' : '#4ade80'
                        }}>
                            {us2Stable && us1Stable ? '🔴 QUEUE BACKED UP'
                                : us2Stable && !us1Stable ? '⚠️ IGNORED (US1 clear)'
                                : '🟢 CLEAR'}
                        </span>
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                        Raw: {us2Raw < 900 ? `${us2Raw.toFixed ? us2Raw.toFixed(1) : us2Raw} cm` : 'No reading'}
                    </div>
                    {us2Stable && !us1Stable && (
                        <div style={{ fontSize: 9, color: '#fde047', marginTop: 3 }}>
                            US2 alone = ignored by system
                        </div>
                    )}
                </div>
            </div>

            {/* Queue result */}
            <div style={{
                padding: '6px 12px', borderRadius: 8,
                background: qlBg, border: `1px solid ${qlColor}44`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
                <span style={{ color: qlColor, fontWeight: 'bold', fontSize: 12 }}>
                    {ql === 'Heavy' ? '🔴 HEAVY QUEUE' : ql === 'Light' ? '🟡 LIGHT QUEUE' : '🟢 NO QUEUE'}
                </span>
                <span style={{ color: '#64748b', fontSize: 10 }}>
                    {ql === 'Heavy' ? '+6s green' : ql === 'Light' ? '+3s green' : '3s base'}
                </span>
            </div>
        </div>
    );
};

// ── Pedestrian Panel ──────────────────────────────────────────────────────────
const PedestrianPanel = ({ ped, phase, countdown }) => {
    const isCrossing = ped?.crossing === true;
    const isWaiting  = ped?.requested === true && !isCrossing;
    let statusColor = '#475569', statusLabel = 'IDLE', statusBg = '#0f172a', borderColor = '#1e293b';

    if (isCrossing) {
        statusColor = '#60a5fa'; statusLabel = `CROSSING (${ped.duration || 0}s left)`;
        statusBg = '#1e3a5f'; borderColor = '#3b82f6';
    } else if (isWaiting) {
        statusColor = '#fde047'; statusLabel = `WAITING — pressed during ${phase}`;
        statusBg = '#3d2000'; borderColor = '#f59e0b';
    }

    return (
        <div style={{ background: statusBg, border: `1px solid ${borderColor}`, borderRadius: 10, padding: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    background: '#111', padding: '8px 7px', borderRadius: 10,
                    border: `2px solid ${isCrossing ? '#22c55e44' : '#2a2a2a'}` }}>
                    <PedBulb color="RED"   active={!isCrossing} size={22} />
                    <PedBulb color="GREEN" active={isCrossing}  size={22} />
                </div>
                <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 14 }}>🚶</span>
                        <span style={{ fontSize: 11, fontWeight: 'bold', color: '#94a3b8' }}>PEDESTRIAN SIGNAL</span>
                    </div>
                    <div style={{ fontSize: 11, color: statusColor, fontWeight: 'bold', marginTop: 4 }}>
                        {statusLabel}
                    </div>
                    {isCrossing && (
                        <div style={{ fontSize: 10, color: '#60a5fa', marginTop: 4 }}>
                            Car signal held RED — pedestrians crossing
                        </div>
                    )}
                    {isWaiting && phase === 'GREEN' && (
                        <div style={{ fontSize: 10, color: '#fde047', marginTop: 4 }}>
                            Will cross after GREEN + YELLOW finish
                        </div>
                    )}
                    {isWaiting && phase === 'RED' && (
                        <div style={{ fontSize: 10, color: '#fde047', marginTop: 4 }}>
                            Crossing when remaining time &gt; 3s
                        </div>
                    )}
                    {isWaiting && phase === 'YELLOW' && (
                        <div style={{ fontSize: 10, color: '#fde047', marginTop: 4 }}>
                            Countdown shown on 7-segment, crossing soon
                        </div>
                    )}
                    {!isCrossing && !isWaiting && (
                        <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>
                            Button not pressed — no pedestrian waiting
                        </div>
                    )}
                </div>
                {isCrossing && ped.duration > 0 && (
                    <div style={{
                        background: '#14532d', color: '#4ade80',
                        width: 44, height: 44, borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 16, fontWeight: 'bold', flexShrink: 0
                    }}>
                        {ped.duration}
                    </div>
                )}
            </div>
        </div>
    );
};

// ── Rain Panel ────────────────────────────────────────────────────────────────
const RainPanel = ({ rainDetected, yellowTime, isNorthRoad }) => (
    <div style={{
        background: rainDetected ? '#0d1f3d' : '#0f172a',
        border: `1px solid ${rainDetected ? '#3b82f6' : '#1e293b'}`,
        borderRadius: 10, padding: 12, marginBottom: 8
    }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>{rainDetected ? '🌧️' : '☀️'}</span>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 'bold', color: rainDetected ? '#60a5fa' : '#4ade80' }}>
                    {rainDetected ? 'RAIN DETECTED' : 'DRY — No Rain'}
                </div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                    Yellow light: <strong style={{ color: rainDetected ? '#fde047' : '#94a3b8' }}>
                        {yellowTime}s {rainDetected ? '(extended +2s for safety)' : '(normal)'}
                    </strong>
                </div>
            </div>
            {isNorthRoad && (
                <span style={{ fontSize: 9, background: '#1e3a5f', color: '#60a5fa', padding: '2px 6px', borderRadius: 6 }}>
                    📡 Sensor here
                </span>
            )}
            {!isNorthRoad && (
                <span style={{ fontSize: 9, background: '#1e293b', color: '#64748b', padding: '2px 6px', borderRadius: 6 }}>
                    from North
                </span>
            )}
        </div>
    </div>
);

// ── Main User Dashboard ───────────────────────────────────────────────────────
export default function UserDashboard({ user, onLogout }) {
    const [livePhase,    setLivePhase]    = useState({ North:'RED', South:'RED', East:'RED', West:'RED' });
    const [liveCD,       setLiveCD]       = useState({ North:0, South:0, East:0, West:0 });
    const [usData,       setUsData]       = useState({
        North: { us1Stable:false, us2Stable:false, us1Raw:999, us2Raw:999 },
        South: { us1Stable:false, us2Stable:false, us1Raw:999, us2Raw:999 },
        East:  { us1Stable:false, us2Stable:false, us1Raw:999, us2Raw:999 },
        West:  { us1Stable:false, us2Stable:false, us1Raw:999, us2Raw:999 }
    });
    const [usWorking,    setUsWorking]    = useState({ North:false, South:false, East:false, West:false });
    const [googleTraffic,setGoogleTraffic]= useState({ North:'Unknown', South:'Unknown', East:'Unknown', West:'Unknown' });
    const [googleWorking,setGoogleWorking]= useState(false);
    const [piezoData,    setPiezoData]    = useState({
        North:{heavy:false}, South:{heavy:false}, East:{heavy:false}, West:{heavy:false}
    });
    const [rainDetected, setRainDetected] = useState(false);
    const [yellowTime,   setYellowTime]   = useState(3);
    const [pedStatus,    setPedStatus]    = useState({
        North:{requested:false,crossing:false,duration:0},
        South:{requested:false,crossing:false,duration:0},
        East: {requested:false,crossing:false,duration:0},
        West: {requested:false,crossing:false,duration:0}
    });
    const [decision,     setDecision]     = useState(null);
    const [connected,    setConnected]    = useState(false);
    const [espOnline,    setEspOnline]    = useState({ North:true, South:true, East:true, West:true });
    const [analyticsTab, setAnalyticsTab] = useState('livecongestion');
    const [analyticsData,setAnalyticsData]= useState({ peakHours:[], roadPerf:[], efficiency:{} });

    const socketRef = useRef(null);

    useEffect(() => {
        const socket = io(SERVER, { transports: ['websocket','polling'] });
        socketRef.current = socket;

        socket.on('connect',    () => setConnected(true));
        socket.on('disconnect', () => setConnected(false));

        socket.on('fullState', data => {
            if (data.livePhase)     setLivePhase(data.livePhase);
            if (data.liveCountdown) setLiveCD(data.liveCountdown);
            if (data.usData)        setUsData(data.usData);
            if (data.usWorking)     setUsWorking(data.usWorking);
            if (data.googleTraffic) setGoogleTraffic(data.googleTraffic);
            if (data.googleWorking !== undefined) setGoogleWorking(data.googleWorking);
            if (data.piezoData)     setPiezoData(data.piezoData);
            if (data.rainDetected !== undefined) {
                setRainDetected(data.rainDetected);
                setYellowTime(data.rainDetected ? 5 : 3);
            }
            if (data.pedStatus)     setPedStatus(data.pedStatus);
            if (data.espOnline)     setEspOnline(data.espOnline);
            if (data.latestDecision) setDecision(data.latestDecision);
        });

        socket.on('countdown',      ({ road, phase, remaining }) => {
            setLiveCD(p => ({ ...p, [road]: remaining }));
            setLivePhase(p => ({ ...p, [road]: phase }));
        });
        socket.on('ledStateUpdate', ({ road, state }) => setLivePhase(p => ({ ...p, [road]: state })));
        socket.on('newDecision',    dec => setDecision(dec));
        socket.on('usUpdate',       ({ road, us1Stable, us2Stable, us1Raw, us2Raw }) => {
            setUsData(prev => ({ ...prev, [road]: { us1Stable, us2Stable, us1Raw, us2Raw } }));
            setUsWorking(prev => ({ ...prev, [road]: true }));
        });
        socket.on('piezoUpdate',    ({ road, heavyVehicle }) => {
            setPiezoData(prev => ({ ...prev, [road]: { ...prev[road], heavy: heavyVehicle } }));
        });
        socket.on('rainUpdate',         ({ rainDetected: r }) => { setRainDetected(r); setYellowTime(r ? 5 : 3); });
        socket.on('pedestrianUpdate',   ({ road, ...rest })   => setPedStatus(p => ({ ...p, [road]: rest })));
        socket.on('googleTrafficUpdate',({ googleTraffic: gt, googleWorking: gw }) => { setGoogleTraffic(gt); setGoogleWorking(gw); });
        socket.on('espStatusUpdate',    ({ road, online })    => setEspOnline(prev => ({ ...prev, [road]: online })));
        socket.on('analyticsUpdate',    data => setAnalyticsData({ peakHours: data.peakHours||[], roadPerf: data.roadPerf||[], efficiency: data.efficiency||{} }));

        axios.get(`${SERVER}/api/analytics/road-performance`).then(r => setAnalyticsData(p => ({...p, roadPerf: r.data}))).catch(()=>{});
        axios.get(`${SERVER}/api/analytics/peak-hours`).then(r => setAnalyticsData(p => ({...p, peakHours: r.data}))).catch(()=>{});
        axios.get(`${SERVER}/api/analytics/system-efficiency`).then(r => setAnalyticsData(p => ({...p, efficiency: r.data}))).catch(()=>{});

        return () => socket.disconnect();
    }, []);

    const winner    = decision?.winner;
    const redOthers = decision?.redForOthers || 0;
    const activeSensors = Object.values(usWorking).filter(Boolean).length;

    return (
        <div style={{ padding: 20, fontFamily: "'Segoe UI', sans-serif", background: '#0a0f1e', minHeight: '100vh', color: 'white' }}>

            {/* User header */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                marginBottom: 16, padding: '10px 16px',
                background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b' }}>
                <div style={{ display:'flex', alignItems:'center', gap: 10 }}>
                    {user?.photo && (
                        <img src={user.photo} alt="avatar"
                            style={{ width: 32, height: 32, borderRadius: '50%' }} />
                    )}
                    <div>
                        <div style={{ color:'#e2e8f0', fontSize:13, fontWeight:'bold' }}>
                            {user?.name || user?.email}
                        </div>
                        <div style={{ color:'#475569', fontSize:11 }}>{user?.email}</div>
                    </div>
                </div>
                <button onClick={onLogout} style={{
                    background:'#1e293b', border:'1px solid #334155', borderRadius:8,
                    color:'#94a3b8', padding:'6px 14px', fontSize:12, cursor:'pointer'
                }}>Sign Out</button>
            </div>

            {/* Header */}
            <div style={{ textAlign:'center', marginBottom: 24 }}>
                <h1 style={{ fontSize:'2rem', margin:'0 0 4px', letterSpacing:2 }}>🚦 H.Y.D.R.A Dashboard</h1>
                <p style={{ color:'#475569', margin:0, fontSize:13 }}>Nawinna Junction — Real-time Traffic Information</p>
                <div style={{ marginTop:10, display:'flex', justifyContent:'center', gap:10, flexWrap:'wrap', alignItems:'center' }}>
                    <span style={{ background:connected?'#14532d':'#7f1d1d', color:connected?'#4ade80':'#f87171',
                        padding:'3px 12px', borderRadius:20, fontSize:12, fontWeight:'bold' }}>
                        {connected ? '● LIVE' : '● OFFLINE'}
                    </span>
                    <span style={{ background:'#1e293b', color:'#94a3b8', padding:'3px 12px', borderRadius:20, fontSize:12 }}>
                        Mode: {decision?.mode || 'Starting...'}
                    </span>
                    <span style={{
                        background: rainDetected ? '#1e3a5f' : '#14532d',
                        color: rainDetected ? '#60a5fa' : '#4ade80',
                        border: `1px solid ${rainDetected ? '#3b82f6' : '#22c55e'}`,
                        padding:'3px 12px', borderRadius:20, fontSize:12, fontWeight:'bold'
                    }}>
                        {rainDetected ? `🌧️ RAIN — Yellow: ${yellowTime}s` : `☀️ DRY — Yellow: ${yellowTime}s`}
                    </span>
                    <span style={{ background:'#1e293b', color:'#94a3b8', padding:'3px 12px', borderRadius:20, fontSize:12 }}>
                        📡 Sensors: {activeSensors}/4
                    </span>
                    <span style={{ background:'#1e293b', color:'#94a3b8', padding:'3px 12px', borderRadius:20, fontSize:12 }}>
                        🗺️ Google: {googleWorking ? 'Active' : 'Disabled'}
                    </span>
                </div>
            </div>

            {/* Decision banner */}
            {decision?.winner && (
                <div style={{ background:'linear-gradient(135deg,#1e3a5f,#0d2137)', border:'1px solid #2E75B6',
                    borderRadius:14, padding:'16px 22px', marginBottom:22 }}>
                    <div style={{ display:'flex', gap:16, alignItems:'center', flexWrap:'wrap' }}>
                        <span style={{ fontSize:'1.8rem' }}>🧠</span>
                        <div style={{ flex:1 }}>
                            <div style={{ fontWeight:'bold', fontSize:'1.1rem' }}>
                                Priority: <span style={{ color:'#4ade80' }}>{decision.winner} Road → GREEN ({decision.greenDuration}s)</span>
                            </div>
                            <div style={{ color:'#94a3b8', fontSize:12, marginTop:4 }}>
                                🟡 Yellow: {decision.yellowDuration || yellowTime}s &nbsp;→&nbsp;
                                🔴 Others RED: <strong style={{ color:'#f87171' }}>{decision.redForOthers}s</strong>
                                &nbsp;| Mode: {decision.mode}
                            </div>
                            {rainDetected && (
                                <div style={{ color:'#60a5fa', fontSize:11, marginTop:4 }}>
                                    🌧️ Rain detected — Yellow extended to {yellowTime}s
                                </div>
                            )}
                        </div>
                        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                            {['RED','YELLOW','GREEN'].map(c => (
                                <div key={c} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                                    <Bulb color={c} active={livePhase[winner] === c} size={38} />
                                    {livePhase[winner] === c && liveCD[winner] > 0 && (
                                        <span style={{ fontSize:11, color:'#94a3b8' }}>{liveCD[winner]}s</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Road cards */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(440px, 1fr))', gap:16, marginBottom:22 }}>
                {ROADS.map(road => {
                    const phase     = livePhase[road] || 'RED';
                    const count     = liveCD[road] || 0;
                    const isWin     = winner === road;
                    const ped       = pedStatus[road] || { requested:false, crossing:false, duration:0 };
                    const espUp     = espOnline[road] !== false;
                    const us        = usData[road] || { us1Stable:false, us2Stable:false, us1Raw:999, us2Raw:999 };
                    const piezo     = (piezoData[road] || {}).heavy === true;
                    const google    = googleTraffic[road] || 'Unknown';
                    const phaseColor= phase==='GREEN'?'#4ade80':phase==='YELLOW'?'#fde047':'#f87171';

                    let greenBreakdown = '3s base';
                    if (us.us1Stable && us.us2Stable && piezo) greenBreakdown = '3s + 6s heavy + 3s piezo = 12s';
                    else if (us.us1Stable && us.us2Stable) greenBreakdown = '3s + 6s heavy = 9s';
                    else if (us.us1Stable && piezo) greenBreakdown = '3s + 3s light + 3s piezo = 9s';
                    else if (us.us1Stable) greenBreakdown = '3s + 3s light = 6s';

                    return (
                        <div key={road} style={{
                            background:'linear-gradient(160deg,#1a2540,#111827)',
                            borderRadius:16, padding:18,
                            border: isWin ? '2px solid #22c55e' : !espUp ? '1px solid #7f1d1d' : '1px solid #1e3a5f',
                            boxShadow: isWin ? '0 0 24px rgba(34,197,94,0.18)' : 'none',
                            transition:'all 0.3s'
                        }}>
                            {/* Road header */}
                            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, flexWrap:'wrap' }}>
                                <h3 style={{ margin:0, color:'#cbd5e1', fontSize:15, letterSpacing:2, textTransform:'uppercase' }}>
                                    {road} Road
                                </h3>
                                {isWin && <span style={{ color:'#4ade80', fontSize:11, fontWeight:'bold' }}>● PRIORITY</span>}
                                {!espUp && <span style={{ background:'#7f1d1d', color:'#f87171', border:'1px solid #ef4444',
                                    padding:'2px 8px', borderRadius:8, fontSize:10, fontWeight:'bold' }}>⚡ ESP32 OFFLINE</span>}
                                {piezo && <span style={{ background:'#1a1000', color:'#fb923c', border:'1px solid #f59e0b',
                                    padding:'2px 8px', borderRadius:8, fontSize:10, fontWeight:'bold' }}>🚛 HEAVY VEHICLE</span>}
                            </div>

                            {/* Traffic lights */}
                            <div style={{ display:'flex', gap:12, marginBottom:14, alignItems:'center',
                                background:'#0f172a', padding:'10px 12px', borderRadius:10 }}>
                                {['RED','YELLOW','GREEN'].map(c => (
                                    <div key={c} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                                        <div style={{ position:'relative' }}>
                                            <Bulb color={c} active={phase===c} size={40} />
                                            {phase===c && count>0 && (
                                                <div style={{
                                                    position:'absolute', inset:0, display:'flex',
                                                    alignItems:'center', justifyContent:'center',
                                                    fontSize:11, fontWeight:'bold', color:'#000'
                                                }}>{count}</div>
                                            )}
                                        </div>
                                        <span style={{ fontSize:9, letterSpacing:1,
                                            color: phase===c ? (c==='RED'?'#ef4444':c==='YELLOW'?'#f59e0b':'#22c55e') : '#334155' }}>
                                            {c}
                                        </span>
                                    </div>
                                ))}
                                <div style={{ marginLeft:8 }}>
                                    <div style={{ fontSize:14, fontWeight:'bold', color:phaseColor }}>
                                        {phase} {count>0 ? `(${count}s)` : ''}
                                    </div>
                                    {!isWin && phase==='RED' && redOthers>0 && (
                                        <div style={{ fontSize:10, color:'#64748b', marginTop:2 }}>
                                            RED for {redOthers}s this cycle
                                        </div>
                                    )}
                                    <div style={{ fontSize:10, color:'#60a5fa', marginTop:4 }}>
                                        🟢 {greenBreakdown}
                                    </div>
                                </div>
                            </div>

                            {/* Ultrasonic sensor panel */}
                            <USSensorPanel
                                us1Stable={us.us1Stable}
                                us2Stable={us.us2Stable}
                                us1Raw={us.us1Raw}
                                us2Raw={us.us2Raw}
                                usOnline={usWorking[road] && espUp}
                            />

                            {/* Piezo sensor */}
                            <div style={{
                                background: piezo ? '#1a1000' : '#0f172a',
                                border: `1px solid ${piezo ? '#f59e0b' : '#1e293b'}`,
                                borderRadius:10, padding:10, marginBottom:8
                            }}>
                                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                                    <span style={{ fontSize:16 }}>🚛</span>
                                    <span style={{ fontSize:11, color:'#64748b', fontWeight:'bold' }}>PIEZO VIBRATION SENSOR</span>
                                    <span style={{
                                        fontSize:10, padding:'2px 8px', borderRadius:6, fontWeight:'bold',
                                        background: piezo ? '#3d2000' : '#1e293b',
                                        color: piezo ? '#fb923c' : '#475569',
                                        border: `1px solid ${piezo ? '#f59e0b' : '#334155'}`
                                    }}>
                                        {piezo ? '● HEAVY VEHICLE DETECTED' : '● IDLE'}
                                    </span>
                                </div>
                                <div style={{ fontSize:10, color:'#64748b', marginTop:6 }}>
                                    {piezo
                                        ? 'Heavy vehicle confirmed (US1 + vibration) → +3s green bonus applied'
                                        : 'Monitoring for heavy vehicle vibration. US1 must be stable to confirm.'}
                                </div>
                            </div>

                            {/* Rain panel */}
                            <RainPanel
                                rainDetected={rainDetected}
                                yellowTime={yellowTime}
                                isNorthRoad={road === 'North'}
                            />

                            {/* Google traffic */}
                            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8,
                                background:'#0f172a', padding:'8px 10px', borderRadius:8 }}>
                                <span style={{ fontSize:14 }}>🗺️</span>
                                <span style={{ fontSize:11, color:'#64748b' }}>Next Intersection:</span>
                                <span style={{
                                    padding:'2px 10px', borderRadius:10, fontSize:11, fontWeight:'bold',
                                    background: google==='Heavy'?'#7f1d1d':google==='Medium'?'#713f12':'#14532d',
                                    color: google==='Heavy'?'#f87171':google==='Medium'?'#fde047':'#4ade80'
                                }}>
                                    {google}
                                </span>
                                {google === 'Heavy' && (
                                    <span style={{ fontSize:10, color:'#64748b' }}>
                                        ← downstream jammed, penalising priority
                                    </span>
                                )}
                            </div>

                            {/* Pedestrian panel */}
                            <PedestrianPanel ped={ped} phase={phase} countdown={count} />

                            {/* NOTE: No Force Override panel for user view */}
                        </div>
                    );
                })}
            </div>

            {/* Priority table */}
            {decision?.priorities && (
                <div style={{ background:'linear-gradient(160deg,#1a2540,#111827)', borderRadius:16, padding:20, marginBottom:22, border:'1px solid #1e3a5f' }}>
                    <h3 style={{ margin:'0 0 14px', color:'#94a3b8', fontSize:14 }}>📋 Signal Priority Analysis</h3>
                    <div style={{ overflowX:'auto' }}>
                        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                            <thead>
                                <tr style={{ borderBottom:'1px solid #1e3a5f' }}>
                                    {['Rank','Road','US1','US2','Queue','Piezo','Google','Score','Green','LED'].map(h => (
                                        <th key={h} style={{ padding:'8px 10px', textAlign:'left', color:'#475569', fontSize:10, whiteSpace:'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {decision.priorities.map((p, i) => {
                                    const us = usData[p.road] || {};
                                    const pz = (piezoData[p.road]||{}).heavy === true;
                                    const ql = us.us1Stable && us.us2Stable ? 'Heavy' : us.us1Stable ? 'Light' : 'None';
                                    return (
                                        <tr key={p.road} style={{ borderBottom:'1px solid #0f172a', background: i===0?'rgba(34,197,94,0.05)':'transparent' }}>
                                            <td style={{ padding:'8px 10px', color:i===0?'#4ade80':'#64748b', fontWeight:'bold' }}>#{i+1}</td>
                                            <td style={{ padding:'8px 10px', fontWeight:'bold', color:i===0?'#e2e8f0':'#94a3b8' }}>{p.road}</td>
                                            <td style={{ padding:'8px 10px', color:us.us1Stable?'#f87171':'#4ade80', fontWeight:'bold' }}>
                                                {us.us1Stable ? '🔴 STABLE' : '🟢 clear'}
                                            </td>
                                            <td style={{ padding:'8px 10px', color:us.us2Stable&&us.us1Stable?'#f87171':us.us2Stable?'#fde047':'#4ade80', fontWeight:'bold' }}>
                                                {us.us2Stable ? (us.us1Stable ? '🔴 STABLE' : '⚠️ IGNORED') : '🟢 clear'}
                                            </td>
                                            <td style={{ padding:'8px 10px', color:ql==='Heavy'?'#f87171':ql==='Light'?'#fde047':'#4ade80', fontWeight:'bold' }}>
                                                {ql}
                                            </td>
                                            <td style={{ padding:'8px 10px', color:pz?'#fb923c':'#475569', fontWeight:'bold' }}>
                                                {pz ? '🚛 +3s' : '—'}
                                            </td>
                                            <td style={{ padding:'8px 10px' }}>
                                                <span style={{
                                                    padding:'2px 8px', borderRadius:8, fontSize:10, fontWeight:'bold',
                                                    background:p.traffic==='Heavy'?'#7f1d1d':p.traffic==='Medium'?'#713f12':'#14532d',
                                                    color:p.traffic==='Heavy'?'#f87171':p.traffic==='Medium'?'#fde047':'#4ade80'
                                                }}>{p.traffic||'Unknown'}</span>
                                            </td>
                                            <td style={{ padding:'8px 10px', color:p.score>0?'#4ade80':p.score<0?'#f87171':'#94a3b8', fontWeight:'bold' }}>
                                                {typeof p.score==='number' ? p.score.toFixed(0) : '—'}
                                            </td>
                                            <td style={{ padding:'8px 10px', color:i===0?'#4ade80':'#94a3b8', fontWeight:i===0?'bold':'normal' }}>
                                                {p.greenTime ? `${Math.round(p.greenTime)}s` : '—'}
                                            </td>
                                            <td style={{ padding:'8px 10px' }}>
                                                <span style={{
                                                    background:livePhase[p.road]==='GREEN'?'#14532d':livePhase[p.road]==='YELLOW'?'#713f12':'#7f1d1d',
                                                    color:livePhase[p.road]==='GREEN'?'#4ade80':livePhase[p.road]==='YELLOW'?'#fde047':'#f87171',
                                                    padding:'2px 8px', borderRadius:10, fontSize:10, fontWeight:'bold', whiteSpace:'nowrap'
                                                }}>
                                                    {livePhase[p.road]||'RED'}{liveCD[p.road]>0?` (${liveCD[p.road]}s)`:''}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Traffic Analytics */}
            <div style={{ background:'linear-gradient(160deg,#1a2540,#111827)', borderRadius:16, padding:20, border:'1px solid #1e3a5f' }}>
                <h3 style={{ margin:'0 0 6px', color:'#e2e8f0', fontSize:16 }}>🗺️ Traffic Analytics — Nawinna Junction</h3>
                <p style={{ color:'#475569', fontSize:12, margin:'0 0 16px' }}>
                    Live data to help you choose the best time and route to travel.
                </p>
                <div style={{ display:'flex', gap:8, marginBottom:18, flexWrap:'wrap' }}>
                    {[
                        { id:'livecongestion', label:'🚦 Live Road Status' },
                        { id:'besttimes',      label:'⏰ Best Times to Travel' },
                        { id:'roadhealth',     label:'🛣️ Road Performance' },
                    ].map(tab => (
                        <button key={tab.id} onClick={() => setAnalyticsTab(tab.id)} style={{
                            background: analyticsTab===tab.id ? '#1e3a5f' : '#0f172a',
                            color: analyticsTab===tab.id ? '#60a5fa' : '#475569',
                            border: `1px solid ${analyticsTab===tab.id ? '#3b82f6' : '#334155'}`,
                            padding:'7px 16px', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:'bold'
                        }}>{tab.label}</button>
                    ))}
                </div>

                {analyticsTab === 'livecongestion' && (
                    <div>
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px,1fr))', gap:12 }}>
                            {ROADS.map(road => {
                                const us    = usData[road] || {};
                                const google= googleTraffic[road] || 'Unknown';
                                const espUp = espOnline[road] !== false;
                                const ql    = us.us1Stable && us.us2Stable ? 'Heavy' : us.us1Stable ? 'Light' : 'None';
                                let cong='Low', waitEst='Under 1 min', tip='Good to travel', barColor='#22c55e';
                                if (!espUp) { cong='Unknown'; waitEst='Sensor offline'; tip='Proceed with caution'; barColor='#64748b'; }
                                else if (ql==='Heavy'||google==='Heavy') { cong='Heavy'; waitEst='Expect delays'; tip='Consider alternate route'; barColor='#ef4444'; }
                                else if (ql==='Light'||google==='Medium') { cong='Moderate'; waitEst='~6–9s wait'; tip='Some traffic — normal wait'; barColor='#f59e0b'; }
                                return (
                                    <div key={road} style={{ background:'#0f172a', borderRadius:12, padding:14, border:`2px solid ${barColor}44` }}>
                                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                                            <span style={{ fontWeight:'bold', color:'#e2e8f0', fontSize:14 }}>{road} Road</span>
                                            <span style={{ background:`${barColor}22`, color:barColor, border:`1px solid ${barColor}`,
                                                padding:'2px 8px', borderRadius:6, fontSize:10, fontWeight:'bold' }}>{cong}</span>
                                        </div>
                                        <div style={{ fontSize:12, color:'#94a3b8', marginBottom:4 }}>
                                            ⏳ <strong style={{ color:barColor }}>{waitEst}</strong>
                                        </div>
                                        <div style={{ fontSize:11, color:'#64748b' }}>{tip}</div>
                                        <div style={{ background:'#1e293b', borderRadius:4, height:6, marginTop:8 }}>
                                            <div style={{ width:cong==='Heavy'?'85%':cong==='Moderate'?'50%':cong==='Unknown'?'30%':'15%',
                                                background:barColor, height:'100%', borderRadius:4, transition:'width 1s' }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {rainDetected && (
                            <div style={{ marginTop:12, padding:12, background:'#0f1f3d', border:'1px solid #3b82f6', borderRadius:10 }}>
                                <div style={{ color:'#60a5fa', fontWeight:'bold', fontSize:13 }}>🌧️ Rain Advisory</div>
                                <div style={{ color:'#94a3b8', fontSize:12, marginTop:4 }}>
                                    Rain detected at Nawinna Junction. Yellow extended to {yellowTime}s for safety. Allow extra braking distance.
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {analyticsTab === 'besttimes' && (
                    <div>
                        <p style={{ fontSize:11, color:'#64748b', marginBottom:14 }}>
                            Historical data from the last 7 days. Shows least congested hours.
                        </p>
                        {analyticsData.peakHours && analyticsData.peakHours.filter(h => h.North>0||h.South>0||h.East>0||h.West>0).length > 0 ? (
                            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(110px,1fr))', gap:8 }}>
                                {analyticsData.peakHours.filter(h => h.North>0||h.South>0||h.East>0||h.West>0).map(h => {
                                    const avg = Math.round((h.North+h.South+h.East+h.West)/4);
                                    const color = avg>60?'#ef4444':avg>30?'#f59e0b':'#22c55e';
                                    const label = avg>60?'Peak — avoid':avg>30?'Moderate':'✅ Good time';
                                    return (
                                        <div key={h.hour} style={{ background:'#0f172a', borderRadius:8, padding:10,
                                            border:`1px solid ${color}33`, textAlign:'center' }}>
                                            <div style={{ fontSize:14, fontWeight:'bold', color:'#e2e8f0' }}>
                                                {h.hour.toString().padStart(2,'0')}:00
                                            </div>
                                            <div style={{ fontSize:11, color, fontWeight:'bold', marginTop:3 }}>{label}</div>
                                            <div style={{ background:'#1e293b', borderRadius:3, height:5, marginTop:5 }}>
                                                <div style={{ width:`${avg}%`, background:color, height:'100%', borderRadius:3 }} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div style={{ color:'#475569', fontSize:12, padding:20, textAlign:'center' }}>
                                📊 Collecting historical data... Check back after the system has run for a few hours.
                            </div>
                        )}
                    </div>
                )}

                {analyticsTab === 'roadhealth' && (
                    <div>
                        <p style={{ fontSize:11, color:'#64748b', marginBottom:14 }}>
                            Which road gets the most green light priority and how long you typically wait.
                        </p>
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:12 }}>
                            {analyticsData.roadPerf && analyticsData.roadPerf.length > 0 ? analyticsData.roadPerf.map(r => {
                                const wait=r.avgWaitTime, color=wait>30?'#ef4444':wait>15?'#f59e0b':'#22c55e';
                                return (
                                    <div key={r.road} style={{ background:'#0f172a', borderRadius:12, padding:14, border:`1px solid ${color}44` }}>
                                        <div style={{ fontWeight:'bold', color:'#e2e8f0', marginBottom:10, fontSize:14 }}>{r.road} Road</div>
                                        <div style={{ fontSize:12, color:'#64748b', lineHeight:2 }}>
                                            <div>⏳ Avg wait: <strong style={{ color }}>{wait}s</strong></div>
                                            <div>🟢 Avg green: <strong style={{ color:'#22c55e' }}>{r.avgGreenTime}s</strong></div>
                                            <div>🏆 Priority wins: <strong style={{ color:'#60a5fa' }}>{r.priorityWins}</strong></div>
                                            <div>🔴 Heavy events: {r.heavyTrafficCount}</div>
                                            <div>⚡ Efficiency: <strong style={{ color:'#a78bfa' }}>{r.efficiency}%</strong></div>
                                        </div>
                                        <div style={{ marginTop:8, fontSize:11, fontWeight:'bold',
                                            color:wait>30?'#ef4444':wait>15?'#f59e0b':'#4ade80' }}>
                                            {wait>30?'⚠️ Long waits':wait>15?'⚡ Moderate':'✅ Good flow'}
                                        </div>
                                    </div>
                                );
                            }) : (
                                <div style={{ color:'#475569', fontSize:12, padding:20 }}>
                                    Collecting road performance data...
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <div style={{ textAlign:'center', marginTop:28, color:'#1e3a5f', fontSize:11 }}>
                HYDRA v8.0 — User Dashboard — Nawinna Junction, Kurunegala
            </div>
        </div>
    );
}