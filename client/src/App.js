// client/src/App.js — HYDRA Dashboard v4.0 — Full Pedestrian & Piezo Integration
import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS, CategoryScale, LinearScale, PointElement,
    LineElement, Title, Tooltip, Legend
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const SERVER = 'http://56.228.30.50:5000';
const ROADS  = ['North', 'South', 'East', 'West'];

// ─────────────────────────────────────────────────────────────────────────────
// Reusable components
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

// Sensor Scenario Badge
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

const ProximityBar = ({ distanceCm }) => {
    const noVehicle = !distanceCm || distanceCm >= 5000;
    const MAX = 400;
    const pct = noVehicle ? 0 : Math.min(100, ((MAX - Math.min(distanceCm, MAX)) / MAX) * 100);
    const color = pct > 70 ? '#ef4444' : pct > 40 ? '#f59e0b' : '#10b981';
    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginBottom: 3 }}>
                <span>Proximity to Stop Line</span>
                <span style={{ fontWeight: 'bold', color: noVehicle ? '#475569' : color }}>
                    {noVehicle ? 'No vehicle' : `${Math.round(distanceCm)}cm`}
                </span>
            </div>
            <div style={{ background: '#1e3a5f', borderRadius: 4, height: 6 }}>
                <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 4, transition: 'width 0.5s' }} />
            </div>
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

// IR Traffic Density Badge
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

// ─────────────────────────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────────────────────────
function App() {
    const [livePhase,     setLivePhase]     = useState({ North:'RED', South:'RED', East:'RED', West:'RED' });
    const [liveCountdown, setLiveCountdown] = useState({ North:0, South:0, East:0, West:0 });
    const [sensorData,    setSensorData]    = useState({ North:5000, South:5000, East:5000, West:5000 });
    const [googleTraffic, setGoogleTraffic] = useState({ North:'Unknown', South:'Unknown', East:'Unknown', West:'Unknown' });
    const [sensorWorking, setSensorWorking] = useState({});
    const [googleWorking, setGoogleWorking] = useState(false);
    const [irData,        setIrData]        = useState({
        North: { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' },
        South: { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' },
        East:  { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' },
        West:  { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' }
    });
    const [rainDetected,  setRainDetected]  = useState(false);
    const [yellowTime,    setYellowTime]    = useState(3);
    const [redTime,       setRedTime]       = useState(0);
    const [greenTime,     setGreenTime]     = useState({ North:3, South:3, East:3, West:3 });
    const [pedStatus,     setPedStatus]     = useState({});
    const [piezoData,     setPiezoData]     = useState({ North:false, South:false, East:false, West:false });
    const [decision,      setDecision]      = useState(null);
    const [connected,     setConnected]     = useState(false);
    const [chartHistory,  setChartHistory]  = useState([]);
    const [notification,  setNotification]  = useState(null);

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
            if (data.rainDetected !== undefined) {
                setRainDetected(data.rainDetected);
                setYellowTime(data.rainDetected ? 5 : 3);
            }
            if (data.piezoData)       setPiezoData(data.piezoData);
            if (data.redTime !== undefined) setRedTime(data.redTime);
            if (data.greenTime)       setGreenTime(data.greenTime);
            if (data.pedStatus)       setPedStatus(data.pedStatus);

            setChartHistory(prev => {
                const e = {
                    time:  new Date().toLocaleTimeString(),
                    North: data.sensorData?.North >= 5000 ? null : data.sensorData?.North,
                    South: data.sensorData?.South >= 5000 ? null : data.sensorData?.South,
                    East:  data.sensorData?.East  >= 5000 ? null : data.sensorData?.East,
                    West:  data.sensorData?.West  >= 5000 ? null : data.sensorData?.West,
                };
                return [...prev.slice(-29), e];
            });
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
        socket.on('rainUpdate',        ({ rainDetected: r, yellowTime: y }) => {
            setRainDetected(r);
            setYellowTime(r ? 5 : 3);
        });
        socket.on('piezoUpdate',       ({ road, heavyVehicle }) => setPiezoData(p => ({ ...p, [road]: heavyVehicle })));
        socket.on('pedestrianUpdate',  ({ road, ...rest }) => setPedStatus(p => ({ ...p, [road]: rest })));
        socket.on('googleTrafficUpdate', ({ googleTraffic: gt, googleWorking: gw }) => {
            setGoogleTraffic(gt);
            setGoogleWorking(gw);
        });

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

    const chartData = {
        labels: chartHistory.map(h => h.time),
        datasets: ROADS.map((road, i) => ({
            label: `${road} (cm)`,
            data:  chartHistory.map(h => h[road]),
            borderColor: ['#60a5fa','#f87171','#a78bfa','#34d399'][i],
            tension: 0.3, spanGaps: false
        }))
    };

    const winner    = decision?.winner;
    const redForOthers = decision?.redForOthers || redTime || 0;
    const heavyPiezoCount = Object.values(piezoData).filter(Boolean).length;
    const activePedRequests = Object.values(pedStatus).filter(p => p?.requested && !p?.crossing).length;
    const activePedCrossings = Object.values(pedStatus).filter(p => p?.crossing).length;

    // Per-road sensor scenario from decision priorities
    const scenarioMap = {};
    if (decision?.priorities) {
        decision.priorities.forEach(p => { scenarioMap[p.road] = p.sensorScenario; });
    }

    // Green time per road from decision priorities
    const decisionGreenMap = {};
    if (decision?.priorities) {
        decision.priorities.forEach(p => { decisionGreenMap[p.road] = p.greenTime; });
    }

    // Updated pedestrian message matching ESP32 logic
    const getPedMessage = (ped, phase) => {
        if (!ped) return 'No pedestrian request';
        if (ped.crossing) return `🚶 CROSSING NOW — ${ped.duration || 10}s remaining`;
        if (ped.requested) {
            if (phase === 'RED') return '⏳ Pressed during RED → Immediate crossing';
            if (phase === 'YELLOW') return '⏳ Pressed during YELLOW → Crossing after YELLOW';
            if (phase === 'GREEN') return '⏳ Pressed during GREEN → Waiting, then YELLOW countdown, then crossing';
            return '⏳ Pedestrian waiting';
        }
        return 'Idle';
    };

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

            {/* Header */}
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
                        🚶 Ped: {activePedRequests} wait / {activePedCrossings} cross
                    </span>
                    <span style={{ background: '#1e293b', color: '#94a3b8', padding: '3px 12px', borderRadius: 20, fontSize: 12 }}>
                        📡 Sensors: {activeSensors}/4
                    </span>
                </div>
            </div>

            {/* Decision Banner */}
            {decision?.winner && (
                <div style={{ background: 'linear-gradient(135deg,#1e3a5f,#0d2137)', border: '1px solid #2E75B6', borderRadius: 14, padding: '16px 22px', marginBottom: 22 }}>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '1.8rem' }}>🧠</span>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 'bold', fontSize: '1.05rem' }}>
                                Priority: <span style={{ color: '#4ade80' }}>{decision.winner} Road → GREEN ({decision.greenDuration}s)</span>
                                {decision.winnerScenario && (
                                    <span style={{ marginLeft: 10 }}>
                                        <ScenarioBadge scenario={decision.winnerScenario} />
                                    </span>
                                )}
                            </div>
                            <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
                                🟡 Yellow: {decision.yellowDuration || yellowTime}s
                                &nbsp;→&nbsp;
                                🔴 Others RED: <strong style={{ color: '#f87171' }}>{decision.redForOthers}s</strong>
                                &nbsp;(= {decision.greenDuration}s green + {decision.yellowDuration || yellowTime}s yellow)
                                &nbsp;| Mode: {decision.mode}
                            </div>
                            {rainDetected && (
                                <div style={{ color: '#60a5fa', fontSize: 11, marginTop: 4 }}>
                                    🌧️ Rain detected — Yellow extended to {yellowTime}s (3s base + 2s rain bonus)
                                </div>
                            )}
                            {pedStatus[decision.winner]?.requested && !pedStatus[decision.winner]?.crossing && (
                                <div style={{ color: '#fde047', fontSize: 11, marginTop: 4 }}>
                                    🚶 Pedestrian waiting on {decision.winner} — will cross after this cycle
                                </div>
                            )}
                            {piezoData[decision.winner] && (
                                <div style={{ color: '#f87171', fontSize: 11, marginTop: 4 }}>
                                    🚛 Heavy vehicle detected on {decision.winner} — Next GREEN extended by 5s
                                </div>
                            )}
                        </div>
                        {/* Winner bulbs */}
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

            {/* Road Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(380px,1fr))', gap: 16, marginBottom: 22 }}>
                {ROADS.map(road => {
                    const phase     = livePhase[road] || 'RED';
                    const count     = liveCountdown[road] || 0;
                    const dist      = sensorData[road] || 5000;
                    const google    = googleTraffic[road] || 'Unknown';
                    const isWin     = winner === road;
                    const ir        = irData[road] || { ir1Blocked: false, ir2Blocked: false, queueLevel: 'None' };
                    const piezo     = piezoData[road] || false;
                    const ped       = pedStatus[road] || { requested: false, crossing: false, duration: 0 };
                    const scenario  = scenarioMap[road] || null;
                    const roadGreenTime = decisionGreenMap[road] || greenTime[road] || 3;
                    const isNonWinnerOnRed = !isWin && phase === 'RED';

                    return (
                        <div key={road} style={{
                            background: 'linear-gradient(160deg,#1a2540,#111827)', borderRadius: 16, padding: 18,
                            border: isWin ? '2px solid #22c55e' : (ped.crossing ? '2px solid #3b82f6' : '1px solid #1e3a5f'),
                            boxShadow: isWin ? '0 0 24px rgba(34,197,94,0.18)' : (ped.crossing ? '0 0 24px rgba(59,130,246,0.18)' : 'none'),
                            transition: 'all 0.3s'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div style={{ flex: 1 }}>
                                    {/* Card header */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                                        <h3 style={{ margin: 0, color: '#cbd5e1', fontSize: 14, letterSpacing: 2, textTransform: 'uppercase' }}>
                                            {road} ROAD
                                        </h3>
                                        {isWin && <span style={{ color: '#4ade80', fontSize: 11, fontWeight: 'bold' }}>● PRIORITY</span>}
                                        {ped.crossing && <span style={{ color: '#60a5fa', fontSize: 11, fontWeight: 'bold' }}>● PEDESTRIAN CROSSING</span>}
                                        {scenario && <ScenarioBadge scenario={scenario} />}
                                    </div>

                                    {/* Traffic light indicators */}
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
                                            {isNonWinnerOnRed && redForOthers > 0 && (
                                                <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                                                    RED for {redForOthers}s (winner's cycle)
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Ultrasonic */}
                                    <div style={{ background: '#0f172a', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                                            <span>📡</span>
                                            <span style={{ fontSize: 11, color: '#64748b' }}>Ultrasonic</span>
                                            <span style={{
                                                fontSize: 10, padding: '1px 6px', borderRadius: 6,
                                                background: sensorWorking[road] ? '#14532d' : '#1e293b',
                                                color: sensorWorking[road] ? '#4ade80' : '#475569'
                                            }}>
                                                {sensorWorking[road] ? '● ACTIVE' : '● OFFLINE'}
                                            </span>
                                        </div>
                                        <ProximityBar distanceCm={dist} />
                                    </div>

                                    {/* IR Sensors */}
                                    <div style={{ background: '#0f172a', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                                            <span>🔦</span>
                                            <span style={{ fontSize: 11, color: '#64748b' }}>IR Sensors (0-5cm, 5-10cm)</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                                            <div style={{
                                                background: ir.ir1Blocked ? '#7f1d1d' : '#1e293b',
                                                color: ir.ir1Blocked ? '#f87171' : '#475569',
                                                border: `1px solid ${ir.ir1Blocked ? '#ef4444' : '#334155'}`,
                                                borderRadius: 8, padding: '3px 8px', fontSize: 10, fontWeight: 'bold'
                                            }}>
                                                {ir.ir1Blocked ? '🔴' : '🟢'} IR-1: {ir.ir1Blocked ? 'BLOCKED' : 'CLEAR'}
                                            </div>
                                            <div style={{
                                                background: ir.ir2Blocked ? '#7f1d1d' : '#1e293b',
                                                color: ir.ir2Blocked ? '#f87171' : '#475569',
                                                border: `1px solid ${ir.ir2Blocked ? '#ef4444' : '#334155'}`,
                                                borderRadius: 8, padding: '3px 8px', fontSize: 10, fontWeight: 'bold'
                                            }}>
                                                {ir.ir2Blocked ? '🔴' : '🟢'} IR-2: {ir.ir2Blocked ? 'BLOCKED' : 'CLEAR'}
                                            </div>
                                        </div>
                                        <TrafficDensityBadge density={ir.queueLevel || 'None'} />
                                        <div style={{ fontSize: 10, color: '#64748b', marginTop: 5 }}>
                                            {ir.queueLevel === 'Heavy' && `Both blocked → Green: ${roadGreenTime}s (3s + 6s heavy)`}
                                            {ir.queueLevel === 'Light' && `One blocked → Green: ${roadGreenTime}s (3s + 3s light)`}
                                            {(!ir.queueLevel || ir.queueLevel === 'None') && `No IR → Green: ${roadGreenTime}s (base)`}
                                        </div>
                                    </div>

                                    {/* Piezo / Heavy Vehicle */}
                                    <div style={{ background: '#0f172a', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                            <span>🚛</span>
                                            <span style={{ fontSize: 11, color: '#64748b' }}>Piezo (Heavy Vehicle)</span>
                                            <span style={{ fontSize: 11, color: piezo ? '#f87171' : '#4ade80', fontWeight: 'bold' }}>
                                                {piezo ? 'DETECTED — Next GREEN +5s' : 'No heavy vehicle'}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Weather */}
                                    <div style={{ background: '#0f172a', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                            <span>{rainDetected ? '🌧️' : '☀️'}</span>
                                            <span style={{ fontSize: 11, color: '#64748b' }}>Weather:</span>
                                            <span style={{ fontSize: 11, color: rainDetected ? '#60a5fa' : '#4ade80', fontWeight: 'bold' }}>
                                                {rainDetected ? `Raining — Yellow ${yellowTime}s (3s+2s)` : `Dry — Yellow ${yellowTime}s (normal)`}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Next intersection */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                        <span style={{ fontSize: 13 }}>🗺️</span>
                                        <span style={{ fontSize: 11, color: '#64748b' }}>Next Intersection:</span>
                                        <TrafficBadge level={google} />
                                    </div>

                                    {/* Pedestrian - Enhanced display */}
                                    <div style={{
                                        background: ped.crossing ? '#1e3a5f' : ped.requested ? '#3d2000' : '#0f172a',
                                        border: `1px solid ${ped.crossing ? '#3b82f6' : ped.requested ? '#f59e0b' : '#1e293b'}`,
                                        borderRadius: 8, padding: 8, marginBottom: 8
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                            <span>🚶</span>
                                            <span style={{ fontSize: 11, color: '#64748b' }}>Pedestrian</span>
                                            {ped.crossing && <span style={{ fontSize: 10, color: '#60a5fa', fontWeight: 'bold' }}>● CROSSING ({ped.duration || 10}s remaining)</span>}
                                            {ped.requested && !ped.crossing && <span style={{ fontSize: 10, color: '#fde047', fontWeight: 'bold' }}>● WAITING</span>}
                                            {!ped.requested && !ped.crossing && <span style={{ fontSize: 10, color: '#475569' }}>Idle</span>}
                                        </div>
                                        <div style={{ marginTop: 4, fontSize: 11, color: ped.crossing ? '#60a5fa' : ped.requested ? '#fde047' : '#94a3b8' }}>
                                            {getPedMessage(ped, phase)}
                                        </div>
                                        {ped.crossing && (
                                            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <div style={{ background: '#0f172a', borderRadius: 4, padding: '2px 6px', fontSize: 10, color: '#60a5fa' }}>
                                                    🚦 Cars must wait RED until crossing completes
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <ForcePanel road={road} onForce={handleForce} />
                                </div>

                                {/* Physical traffic light widget */}
                                <div style={{ marginLeft: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                                    <div style={{ background: '#111', padding: '10px 8px', borderRadius: 12, border: '2px solid #2a2a2a', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {['RED','YELLOW','GREEN'].map(c => <Bulb key={c} color={c} active={phase === c} size={28} />)}
                                    </div>
                                    {count > 0 && (
                                        <div style={{ background: phase === 'GREEN' ? '#14532d' : phase === 'YELLOW' ? '#713f12' : '#7f1d1d', color: phase === 'GREEN' ? '#4ade80' : phase === 'YELLOW' ? '#fde047' : '#f87171', borderRadius: 6, padding: '2px 8px', fontSize: 13, fontWeight: 'bold' }}>
                                            {count}s
                                        </div>
                                    )}
                                    {/* Show pedestrian LEDs indicator */}
                                    <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                                        <div style={{ width: 12, height: 12, borderRadius: '50%', background: ped.crossing ? '#22c55e' : '#ef4444' }} />
                                        <span style={{ fontSize: 9, color: '#64748b' }}>Ped</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* System Config Panel */}
            <div style={{ background: 'linear-gradient(160deg,#1a2540,#111827)', borderRadius: 16, padding: 20, marginBottom: 22, border: '1px solid #1e3a5f' }}>
                <h3 style={{ margin: '0 0 14px', color: '#94a3b8', fontSize: 14 }}>📊 System Configuration</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
                    {[
                        { label: 'System Mode',     value: decision?.mode || '—',           ok: decision?.mode === 'BOTH' },
                        { label: 'Current Winner',  value: winner ? `${winner} → GREEN` : 'Starting', ok: !!winner },
                        { label: 'Yellow Time',     value: `${yellowTime}s ${rainDetected ? '(3s+2s rain)' : '(normal)'}`,  ok: true },
                        { label: 'RED for Others',  value: redForOthers > 0 ? `${redForOthers}s (dynamic)` : '—', ok: redForOthers > 0,
                          note: 'Equals winner Green + Yellow' },
                        { label: 'Heavy Vehicles',  value: heavyPiezoCount > 0 ? `${heavyPiezoCount} road(s)` : 'None', ok: true },
                        { label: 'Pedestrian',      value: `${activePedRequests} waiting, ${activePedCrossings} crossing`, ok: true },
                        { label: 'Sensor Accuracy', value: `${activeSensors}/4 active`,     ok: activeSensors > 0 },
                        { label: 'Google Traffic',  value: googleWorking ? 'Active' : 'Disabled', ok: googleWorking },
                        { label: 'Rain Sensor',     value: rainDetected ? 'Rain' : 'Clear', ok: true },
                        { label: 'Winner Scenario', value: decision?.winnerScenario || '—', ok: !!decision?.winnerScenario },
                    ].map(m => (
                        <div key={m.label} style={{ background: '#0f172a', borderRadius: 10, padding: 12, border: `1px solid ${m.ok ? '#22c55e33' : '#ef444433'}` }}>
                            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4, letterSpacing: 1 }}>{m.label}</div>
                            <div style={{ fontSize: 13, fontWeight: 'bold', color: m.ok ? '#4ade80' : '#f87171' }}>{m.value}</div>
                            {m.note && <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>{m.note}</div>}
                        </div>
                    ))}
                </div>
            </div>

            {/* Live Distance Chart */}
            <div style={{ background: 'linear-gradient(160deg,#1a2540,#111827)', borderRadius: 16, padding: 20, marginBottom: 22, border: '1px solid #1e3a5f' }}>
                <h3 style={{ margin: '0 0 14px', color: '#94a3b8', fontSize: 14 }}>📈 Live Ultrasonic Distance — All Roads</h3>
                <Line data={chartData} options={{
                    responsive: true,
                    plugins: { legend: { labels: { color: '#94a3b8', boxWidth: 12 } } },
                    scales: {
                        y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e3a5f' }, title: { display: true, text: 'Distance (cm)', color: '#64748b' } },
                        x: { ticks: { color: '#64748b' }, grid: { color: '#1e3a5f' } }
                    }
                }} />
            </div>

            {/* Priority Table */}
            {decision?.priorities && (
                <div style={{ background: 'linear-gradient(160deg,#1a2540,#111827)', borderRadius: 16, padding: 20, border: '1px solid #1e3a5f' }}>
                    <h3 style={{ margin: '0 0 14px', color: '#94a3b8', fontSize: 14 }}>📋 Signal Priority Analysis</h3>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #1e3a5f' }}>
                                    {['Rank','Road','Scenario','Distance','IR','Piezo','Rain','Google','Ped','Score','Green','LED'].map(h => (
                                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#475569', fontSize: 10, letterSpacing: 1, whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {decision.priorities.map((p, i) => {
                                    const irForRoad = irData[p.road] || { queueLevel: 'None' };
                                    const pedForRoad = pedStatus[p.road] || {};
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
                                            <td style={{ padding: '8px 10px', color: piezoForRoad ? '#f87171' : '#4ade80' }}>
                                                {piezoForRoad ? '🚛 YES (+5s)' : '—'}
                                            </td>
                                            <td style={{ padding: '8px 10px', color: rainDetected ? '#60a5fa' : '#4ade80' }}>
                                                {rainDetected ? `🌧️ ${yellowTime}s` : `☀️ ${yellowTime}s`}
                                            </td>
                                            <td style={{ padding: '8px 10px' }}><TrafficBadge level={p.traffic} /></td>
                                            <td style={{ padding: '8px 10px', color: pedForRoad.crossing ? '#60a5fa' : pedForRoad.requested ? '#fde047' : '#94a3b8', fontWeight: 'bold' }}>
                                                {pedForRoad.crossing ? '🚶 CROSS' : pedForRoad.requested ? '⏳ WAIT' : 'Idle'}
                                             </td>
                                            <td style={{ padding: '8px 10px', color: p.score > 0 ? '#4ade80' : p.score < 0 ? '#f87171' : '#94a3b8', fontWeight: 'bold' }}>
                                                {typeof p.score === 'number' ? p.score.toFixed(1) : '—'}
                                             </td>
                                            <td style={{ padding: '8px 10px', color: i === 0 ? '#4ade80' : '#94a3b8', fontWeight: i === 0 ? 'bold' : 'normal' }}>
                                                {p.greenTime ? `${Math.round(p.greenTime)}s` : '—'}
                                             </td>
                                            <td style={{ padding: '8px 10px' }}>
                                                <span style={{ background: livePhase[p.road] === 'GREEN' ? '#14532d' : livePhase[p.road] === 'YELLOW' ? '#713f12' : '#7f1d1d', color: livePhase[p.road] === 'GREEN' ? '#4ade80' : livePhase[p.road] === 'YELLOW' ? '#fde047' : '#f87171', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                                                    {livePhase[p.road] || 'RED'}{liveCountdown[p.road] > 0 ? ` (${liveCountdown[p.road]}s)` : ''}
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

            {/* Rules Footer - Updated with correct pedestrian logic */}
            <div style={{ background: 'linear-gradient(160deg,#1a2540,#111827)', borderRadius: 16, padding: 16, marginTop: 8, border: '1px solid #1e3a5f' }}>
                <h3 style={{ margin: '0 0 12px', color: '#94a3b8', fontSize: 13 }}>📋 System Rules (ESP32 Configuration)</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 10, fontSize: 11, color: '#64748b' }}>
                    <div>📡 <strong style={{ color: '#60a5fa' }}>ULTRASONIC mode:</strong> dist ≥ 20cm — distance + Google traffic</div>
                    <div>🔦 <strong style={{ color: '#c084fc' }}>IR mode:</strong> dist &lt; 20cm — IR sensors only</div>
                    <div>🟢 <strong>GREEN:</strong> 3s base + Light(+3s)=6s, Heavy(+6s)=9s, Piezo+5s=14s</div>
                    <div>🟡 <strong>YELLOW:</strong> 3s dry, +2s rain = 5s total</div>
                    <div>🔴 <strong>RED (others):</strong> Dynamic = winner GREEN + YELLOW</div>
                    <div>🚶 <strong>Pedestrian:</strong> RED→immediate | YELLOW→after yellow | GREEN→after green</div>
                    <div>🚛 <strong>Piezo:</strong> Heavy vehicle detection → Next GREEN +5s</div>
                    <div>🚦 <strong>After crossing:</strong> Returns YELLOW → GREEN (skips RED)</div>
                </div>
            </div>

            <div style={{ textAlign: 'center', marginTop: 28, color: '#1e3a5f', fontSize: 11 }}>
                HYDRA v4.0 — Full Pedestrian & Piezo Integration — Nawinna Junction, Kurunegala
            </div>
        </div>
    );
}

export default App;