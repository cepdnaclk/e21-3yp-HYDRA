// ═══════════════════════════════════════════════════════════════════════════
// client/src/App.js — HYDRA Dashboard (COMPLETE VERSION)
// ═══════════════════════════════════════════════════════════════════════════
// FEATURES:
//   ✅ Live RED/YELLOW/GREEN indicators that match physical ESP32 LEDs
//   ✅ Countdown timers on each indicator (counts down in real-time)
//   ✅ Ultrasonic proximity bar for each road
//   ✅ Next intersection Google traffic status
//   ✅ Force RED / Force YELLOW / Force GREEN buttons with custom duration
//   ✅ Highlighted priority lane (which road is currently winning)
//   ✅ System mode indicator (BOTH / SENSOR_ONLY / GOOGLE_ONLY / FALLBACK)
//   ✅ Live distance chart for all roads
//   ✅ Priority score table with all 4 roads ranked
//   ✅ Socket.IO real-time updates (no polling delay)
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS, CategoryScale, LinearScale, PointElement,
    LineElement, Title, Tooltip, Legend
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

// ── Server address — your AWS EC2 public IP ──────────────────────────────────
const SERVER = 'http://56.228.30.50:5000';

// ════════════════════════════════════════════════════════════════════════════
// TrafficLightWidget — 3-bulb traffic light with live countdown
// ════════════════════════════════════════════════════════════════════════════
const TrafficLightWidget = ({ phase, countdown }) => {
    const bulbs = [
        { key: 'RED',    color: '#ff3333', dim: '#3a0000', glow: '0 0 20px #ff3333, 0 0 40px #ff3333' },
        { key: 'YELLOW', color: '#ffcc00', dim: '#3a2e00', glow: '0 0 20px #ffcc00, 0 0 40px #ffcc00' },
        { key: 'GREEN',  color: '#00ff44', dim: '#003310', glow: '0 0 20px #00ff44, 0 0 40px #00ff44' },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <div style={{
                background: '#111', padding: '12px 10px', borderRadius: '14px',
                border: '2px solid #2a2a2a', display: 'flex', flexDirection: 'column',
                gap: '10px', alignItems: 'center'
            }}>
                {bulbs.map(b => (
                    <div key={b.key} style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{
                            width: '32px', height: '32px', borderRadius: '50%',
                            background: phase === b.key ? b.color : b.dim,
                            boxShadow: phase === b.key ? b.glow : 'none',
                            transition: 'all 0.3s ease'
                        }} />
                    </div>
                ))}
            </div>
            {/* Countdown badge under light */}
            {countdown > 0 && (
                <div style={{
                    background: phase === 'GREEN' ? '#14532d' : phase === 'YELLOW' ? '#713f12' : '#7f1d1d',
                    color: phase === 'GREEN' ? '#4ade80' : phase === 'YELLOW' ? '#fde047' : '#f87171',
                    borderRadius: '8px', padding: '3px 8px',
                    fontSize: '13px', fontWeight: 'bold', minWidth: '32px', textAlign: 'center'
                }}>
                    {countdown}s
                </div>
            )}
        </div>
    );
};

// ════════════════════════════════════════════════════════════════════════════
// SignalIndicator — Circular LED indicator with countdown (for header)
// ════════════════════════════════════════════════════════════════════════════
const SignalIndicator = ({ color, active, countdown, label }) => {
    const colors = {
        RED:    { bg: '#ff3333', dim: '#3a0000', text: '#ff3333' },
        YELLOW: { bg: '#ffcc00', dim: '#3a2e00', text: '#ffcc00' },
        GREEN:  { bg: '#00ff44', dim: '#003310', text: '#00ff44' },
    };
    const c = colors[color];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <div style={{
                width: '44px', height: '44px', borderRadius: '50%',
                background: active ? c.bg : c.dim,
                boxShadow: active ? `0 0 18px ${c.bg}, 0 0 36px ${c.bg}` : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.3s ease',
                fontSize: '11px', fontWeight: 'bold', color: active ? '#000' : '#555'
            }}>
                {active && countdown > 0 ? countdown : ''}
            </div>
            <span style={{ fontSize: '10px', color: '#64748b' }}>{label}</span>
        </div>
    );
};

// ════════════════════════════════════════════════════════════════════════════
// ProximityBar — shows how close a vehicle is to the stop line
// ════════════════════════════════════════════════════════════════════════════
const ProximityBar = ({ distanceCm }) => {
    const noVehicle = distanceCm >= 5000 || distanceCm === null;
    const MAX = 400;
    const pct  = noVehicle ? 0 : Math.min(100, ((MAX - Math.min(distanceCm, MAX)) / MAX) * 100);
    const color = pct > 70 ? '#ef4444' : pct > 40 ? '#f59e0b' : '#10b981';

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
                <span>Proximity to Stop Line</span>
                <span style={{ fontWeight: 'bold', color: noVehicle ? '#475569' : color }}>
                    {noVehicle ? 'No vehicle' : `${Math.round(distanceCm)}cm away`}
                </span>
            </div>
            <div style={{ background: '#1e3a5f', borderRadius: '4px', height: '6px' }}>
                <div style={{
                    width: `${pct}%`, background: color, height: '100%',
                    borderRadius: '4px', transition: 'width 0.5s ease'
                }} />
            </div>
        </div>
    );
};

// ════════════════════════════════════════════════════════════════════════════
// TrafficBadge — Heavy / Medium / Light / Unknown pill
// ════════════════════════════════════════════════════════════════════════════
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
            background: s.bg, color: s.color,
            border: `1px solid ${s.border}`,
            padding: '2px 10px', borderRadius: '12px',
            fontSize: '11px', fontWeight: 'bold'
        }}>
            {level || 'Unknown'}
        </span>
    );
};

// ════════════════════════════════════════════════════════════════════════════
// ModeBadge — shows BOTH / SENSOR_ONLY / GOOGLE_ONLY / FALLBACK
// ════════════════════════════════════════════════════════════════════════════
const ModeBadge = ({ mode }) => {
    const map = {
        BOTH:        { bg: '#14532d', color: '#4ade80', icon: '✅', label: 'FULL MODE' },
        SENSOR_ONLY: { bg: '#1e3a5f', color: '#60a5fa', icon: '📡', label: 'SENSOR ONLY' },
        GOOGLE_ONLY: { bg: '#3b1f69', color: '#c084fc', icon: '🗺️', label: 'MAPS ONLY' },
        FALLBACK:    { bg: '#3d2000', color: '#fb923c', icon: '⚠️', label: 'FALLBACK' },
    };
    const s = map[mode] || map.FALLBACK;
    return (
        <span style={{
            background: s.bg, color: s.color,
            padding: '4px 12px', borderRadius: '12px',
            fontSize: '12px', fontWeight: 'bold', letterSpacing: '0.5px'
        }}>
            {s.icon} {s.label}
        </span>
    );
};

// ════════════════════════════════════════════════════════════════════════════
// ForceControlPanel — Force RED / YELLOW / GREEN with custom duration
// ════════════════════════════════════════════════════════════════════════════
const ForceControlPanel = ({ road, onForce }) => {
    const [duration, setDuration] = useState(30);

    return (
        <div style={{ marginTop: '14px', padding: '12px', background: '#0f172a', borderRadius: '10px', border: '1px solid #334155' }}>
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px', fontWeight: 'bold', letterSpacing: '1px' }}>
                🚨 TRAFFIC POLICE OVERRIDE
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>Duration (seconds):</span>
                <input
                    type="number"
                    value={duration}
                    min={5} max={300}
                    onChange={e => setDuration(parseInt(e.target.value) || 30)}
                    style={{
                        width: '60px', background: '#1e293b', border: '1px solid #334155',
                        borderRadius: '6px', color: 'white', padding: '4px 8px',
                        fontSize: '13px', outline: 'none'
                    }}
                />
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button onClick={() => onForce(road, 'RED', duration)} style={{
                    background: '#7f1d1d', color: '#f87171', border: '1px solid #ef4444',
                    padding: '6px 12px', borderRadius: '6px', cursor: 'pointer',
                    fontWeight: 'bold', fontSize: '11px', letterSpacing: '0.5px'
                }}>🔴 FORCE RED</button>
                <button onClick={() => onForce(road, 'YELLOW', duration)} style={{
                    background: '#713f12', color: '#fde047', border: '1px solid #f59e0b',
                    padding: '6px 12px', borderRadius: '6px', cursor: 'pointer',
                    fontWeight: 'bold', fontSize: '11px', letterSpacing: '0.5px'
                }}>🟡 FORCE YELLOW</button>
                <button onClick={() => onForce(road, 'GREEN', duration)} style={{
                    background: '#14532d', color: '#4ade80', border: '1px solid #22c55e',
                    padding: '6px 12px', borderRadius: '6px', cursor: 'pointer',
                    fontWeight: 'bold', fontSize: '11px', letterSpacing: '0.5px'
                }}>🟢 FORCE GREEN</button>
            </div>
        </div>
    );
};

// ════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════════════════════════
function App() {
    const ROADS = ['North', 'South', 'East', 'West'];

    // ── State ────────────────────────────────────────────────────────────────
    const [livePhase,       setLivePhase]       = useState({ North: 'RED', South: 'RED', East: 'RED', West: 'RED' });
    const [liveCountdown,   setLiveCountdown]   = useState({ North: 0,   South: 0,   East: 0,   West: 0   });
    const [liveSignalState, setLiveSignalState] = useState({ North: 'RED', South: 'RED', East: 'RED', West: 'RED' });
    const [sensorData,      setSensorData]      = useState({ North: 5000, South: 5000, East: 5000, West: 5000 });
    const [googleTraffic,   setGoogleTraffic]   = useState({ North: 'Unknown', South: 'Unknown', East: 'Unknown', West: 'Unknown' });
    const [decision,        setDecision]        = useState(null);
    const [connected,       setConnected]       = useState(false);
    const [chartHistory,    setChartHistory]    = useState([]);
    const [notification,    setNotification]    = useState(null);
    const [sensorWorking,   setSensorWorking]   = useState({});
    const [googleWorking,   setGoogleWorking]   = useState(false);

    const socketRef = useRef(null);

    // ── Show notification toast ──────────────────────────────────────────────
    const showNotif = (msg, type = 'info') => {
        setNotification({ msg, type });
        setTimeout(() => setNotification(null), 4000);
    };

    // ── Socket.IO connection ─────────────────────────────────────────────────
    useEffect(() => {
        const socket = io(SERVER, { transports: ['websocket', 'polling'] });
        socketRef.current = socket;

        socket.on('connect', () => {
            setConnected(true);
            console.log('✅ Dashboard connected to server');
        });

        socket.on('disconnect', () => {
            setConnected(false);
            console.log('❌ Disconnected from server');
        });

        // ── Full state sync (on connect + every 2s heartbeat) ─────────────
        socket.on('fullState', (data) => {
            if (data.livePhase)       setLivePhase(data.livePhase);
            if (data.liveCountdown)   setLiveCountdown(data.liveCountdown);
            if (data.liveSignalState) setLiveSignalState(data.liveSignalState);
            if (data.sensorData)      setSensorData(data.sensorData);
            if (data.googleTraffic)   setGoogleTraffic(data.googleTraffic);
            if (data.latestDecision)  setDecision(data.latestDecision);
            if (data.sensorWorking)   setSensorWorking(data.sensorWorking);
            if (data.googleWorking !== undefined) setGoogleWorking(data.googleWorking);

            // Update chart history
            setChartHistory(prev => {
                const newEntry = {
                    time: new Date().toLocaleTimeString(),
                    North: data.sensorData?.North || 5000,
                    South: data.sensorData?.South || 5000,
                    East:  data.sensorData?.East  || 5000,
                    West:  data.sensorData?.West  || 5000,
                };
                return [...prev.slice(-29), newEntry];
            });
        });

        // ── Real-time countdown update ─────────────────────────────────────
        socket.on('countdown', ({ road, phase, remaining }) => {
            setLiveCountdown(prev => ({ ...prev, [road]: remaining }));
            setLivePhase(prev => ({ ...prev, [road]: phase }));
        });

        // ── LED state update from ESP32 ────────────────────────────────────
        socket.on('ledStateUpdate', ({ road, state }) => {
            setLiveSignalState(prev => ({ ...prev, [road]: state }));
            setLivePhase(prev => ({ ...prev, [road]: state }));
        });

        // ── New decision ───────────────────────────────────────────────────
        socket.on('newDecision', (dec) => {
            setDecision(dec);
        });

        // ── Sensor update ──────────────────────────────────────────────────
        socket.on('sensorUpdate', ({ road, distanceCm }) => {
            setSensorData(prev => ({ ...prev, [road]: distanceCm }));
        });

        // ── Google traffic update ──────────────────────────────────────────
        socket.on('googleTrafficUpdate', ({ googleTraffic: gt, googleWorking: gw }) => {
            setGoogleTraffic(gt);
            setGoogleWorking(gw);
        });

        return () => socket.disconnect();
    }, []);

    // ── Force override handler ───────────────────────────────────────────────
    const handleForce = async (road, command, duration) => {
        try {
            await axios.post(`${SERVER}/api/traffic/control`, { location: road, command, duration });
            showNotif(`✅ Force ${command} applied to ${road} for ${duration}s`, 'success');
        } catch (err) {
            showNotif(`❌ Failed to send command: ${err.message}`, 'error');
        }
    };

    // ── Chart data ───────────────────────────────────────────────────────────
    const chartData = {
        labels: chartHistory.map(h => h.time),
        datasets: [
            { label: 'North (cm)', data: chartHistory.map(h => h.North >= 5000 ? null : h.North), borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.1)', tension: 0.3, spanGaps: false },
            { label: 'South (cm)', data: chartHistory.map(h => h.South >= 5000 ? null : h.South), borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.1)', tension: 0.3, spanGaps: false },
            { label: 'East (cm)',  data: chartHistory.map(h => h.East  >= 5000 ? null : h.East),  borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.1)', tension: 0.3, spanGaps: false },
            { label: 'West (cm)',  data: chartHistory.map(h => h.West  >= 5000 ? null : h.West),  borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.1)',  tension: 0.3, spanGaps: false },
        ]
    };

    const winner = decision?.winner;

    // ════════════════════════════════════════════════════════════════════════
    // RENDER
    // ════════════════════════════════════════════════════════════════════════
    return (
        <div style={{ padding: '20px', fontFamily: "'Segoe UI', sans-serif", background: '#0a0f1e', minHeight: '100vh', color: 'white' }}>

            {/* ── Notification Toast ── */}
            {notification && (
                <div style={{
                    position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
                    background: notification.type === 'success' ? '#14532d' : notification.type === 'error' ? '#7f1d1d' : '#1e3a5f',
                    border: `1px solid ${notification.type === 'success' ? '#22c55e' : notification.type === 'error' ? '#ef4444' : '#3b82f6'}`,
                    color: 'white', padding: '12px 20px', borderRadius: '10px',
                    fontSize: '14px', fontWeight: 'bold', boxShadow: '0 4px 20px rgba(0,0,0,0.4)'
                }}>
                    {notification.msg}
                </div>
            )}

            {/* ── Header ── */}
            <div style={{ textAlign: 'center', marginBottom: '28px' }}>
                <h1 style={{ fontSize: '2.4rem', margin: '0 0 6px', letterSpacing: '2px' }}>
                    🚦 H.Y.D.R.A Control Center
                </h1>
                <p style={{ color: '#475569', margin: 0, fontSize: '14px' }}>
                    Nawinna Junction, Kurunegala — Real-time Adaptive Signal Management
                </p>
                <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                    <span style={{
                        background: connected ? '#14532d' : '#7f1d1d',
                        color: connected ? '#4ade80' : '#f87171',
                        padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold'
                    }}>
                        {connected ? '● LIVE' : '● OFFLINE'}
                    </span>
                    {decision?.mode && <ModeBadge mode={decision.mode} />}
                    <span style={{ fontSize: '12px', color: '#475569' }}>
                        📡 Sensor: {Object.values(sensorWorking).filter(Boolean).length}/4 roads
                        &nbsp;|&nbsp;
                        🗺️ Google: {googleWorking ? 'Active' : 'Disabled'}
                    </span>
                </div>
            </div>

            {/* ── Decision Banner ── */}
            {decision && decision.winner && (
                <div style={{
                    background: 'linear-gradient(135deg, #1e3a5f, #0d2137)',
                    border: '1px solid #2E75B6', borderRadius: '14px',
                    padding: '18px 24px', marginBottom: '24px',
                    display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap'
                }}>
                    <span style={{ fontSize: '2rem' }}>🧠</span>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 'bold', fontSize: '1.15rem' }}>
                            Current Decision:{' '}
                            <span style={{ color: '#4ade80' }}>{decision.winner} Road → GREEN</span>
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: '13px', marginTop: '4px' }}>
                            Green {decision.greenDuration}s
                            &nbsp;→&nbsp;
                            Yellow {decision.yellowDuration}s
                            &nbsp;→&nbsp;
                            Red for others {decision.redForOthers}s
                            &nbsp;|&nbsp;
                            <span style={{ color: '#60a5fa' }}>Mode: {decision.mode}</span>
                        </div>
                    </div>
                    {/* Mini signal indicators for current winner */}
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <SignalIndicator color="RED"    active={livePhase[winner] === 'RED'}    countdown={liveCountdown[winner]} label="RED" />
                        <SignalIndicator color="YELLOW" active={livePhase[winner] === 'YELLOW'} countdown={liveCountdown[winner]} label="YLW" />
                        <SignalIndicator color="GREEN"  active={livePhase[winner] === 'GREEN'}  countdown={liveCountdown[winner]} label="GRN" />
                    </div>
                </div>
            )}

            {/* ── Road Cards Grid ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                {ROADS.map(road => {
                    const phase     = livePhase[road]       || 'RED';
                    const countdown = liveCountdown[road]   || 0;
                    const dist      = sensorData[road]      || 5000;
                    const google    = googleTraffic[road]   || 'Unknown';
                    const isWinner  = winner === road;
                    const hasVehicle = dist < 5000;

                    return (
                        <div key={road} style={{
                            background: 'linear-gradient(160deg, #1a2540, #111827)',
                            borderRadius: '16px', padding: '20px',
                            border: isWinner
                                ? '2px solid #22c55e'
                                : '1px solid #1e3a5f',
                            boxShadow: isWinner ? '0 0 24px rgba(34,197,94,0.2)' : 'none',
                            transition: 'all 0.3s ease'
                        }}>
                            {/* Card header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>

                                <div style={{ flex: 1 }}>
                                    {/* Road name */}
                                    <h3 style={{
                                        margin: '0 0 12px', color: '#cbd5e1', fontSize: '15px',
                                        letterSpacing: '2px', textTransform: 'uppercase', fontWeight: 'bold'
                                    }}>
                                        {road} ROAD
                                        {isWinner && (
                                            <span style={{ color: '#4ade80', fontSize: '11px', marginLeft: '8px' }}>
                                                ● ACTIVE
                                            </span>
                                        )}
                                    </h3>

                                    {/* Live signal indicators — 3 circles (RED/YELLOW/GREEN) with countdown */}
                                    <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', alignItems: 'center' }}>
                                        {[
                                            { label: 'RED',    color: '#ef4444', dimColor: '#3a0000' },
                                            { label: 'YELLOW', color: '#f59e0b', dimColor: '#3a2e00' },
                                            { label: 'GREEN',  color: '#22c55e', dimColor: '#003310' },
                                        ].map(({ label, color, dimColor }) => {
                                            const active = phase === label;
                                            return (
                                                <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
                                                    <div style={{
                                                        width: '36px', height: '36px', borderRadius: '50%',
                                                        background: active ? color : dimColor,
                                                        boxShadow: active ? `0 0 16px ${color}` : 'none',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        fontSize: '11px', fontWeight: 'bold',
                                                        color: active && countdown > 0 ? '#000' : 'transparent',
                                                        transition: 'all 0.3s ease'
                                                    }}>
                                                        {active && countdown > 0 ? countdown : ''}
                                                    </div>
                                                    <span style={{ fontSize: '9px', color: active ? color : '#334155', letterSpacing: '1px' }}>
                                                        {label}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                        {/* Status text */}
                                        <span style={{
                                            marginLeft: '8px', fontSize: '12px',
                                            color: phase === 'GREEN' ? '#4ade80' : phase === 'YELLOW' ? '#fde047' : '#f87171',
                                            fontWeight: 'bold'
                                        }}>
                                            {phase}{countdown > 0 ? ` (${countdown}s)` : ''}
                                        </span>
                                    </div>

                                    {/* Ultrasonic sensor */}
                                    <div style={{ marginBottom: '10px', padding: '10px', background: '#0f172a', borderRadius: '8px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                            <span style={{ fontSize: '15px' }}>📡</span>
                                            <span style={{ fontSize: '12px', color: '#64748b' }}>
                                                Ultrasonic Sensor
                                            </span>
                                            <span style={{
                                                fontSize: '10px', padding: '2px 6px', borderRadius: '8px',
                                                background: sensorWorking[road] ? '#14532d' : '#1e293b',
                                                color: sensorWorking[road] ? '#4ade80' : '#475569'
                                            }}>
                                                {sensorWorking[road] ? '● ACTIVE' : '● OFFLINE'}
                                            </span>
                                        </div>
                                        <div style={{ fontWeight: 'bold', fontSize: '18px', color: hasVehicle ? (dist < 50 ? '#ef4444' : '#f59e0b') : '#475569', marginBottom: '6px' }}>
                                            {hasVehicle ? `${Math.round(dist)} cm` : 'No vehicle'}
                                        </div>
                                        <ProximityBar distanceCm={dist} />
                                    </div>

                                    {/* Google traffic */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                        <span style={{ fontSize: '15px' }}>🗺️</span>
                                        <span style={{ fontSize: '12px', color: '#64748b' }}>Next Intersection:</span>
                                        <TrafficBadge level={google} />
                                    </div>

                                    {/* Force override controls */}
                                    <ForceControlPanel road={road} onForce={handleForce} />
                                </div>

                                {/* Traffic light widget on the right */}
                                <div style={{ marginLeft: '16px' }}>
                                    <TrafficLightWidget phase={phase} countdown={countdown} />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ── Live Ultrasonic Chart ── */}
            <div style={{ background: 'linear-gradient(160deg, #1a2540, #111827)', borderRadius: '16px', padding: '20px', marginBottom: '24px', border: '1px solid #1e3a5f' }}>
                <h3 style={{ margin: '0 0 16px', color: '#94a3b8', fontSize: '15px' }}>
                    📊 Live Ultrasonic Distance — All Roads
                </h3>
                <Line
                    data={chartData}
                    options={{
                        responsive: true,
                        plugins: {
                            legend: { labels: { color: '#94a3b8', boxWidth: 12 } },
                            tooltip: { mode: 'index', intersect: false }
                        },
                        scales: {
                            y: {
                                ticks: { color: '#94a3b8' },
                                grid: { color: '#1e3a5f' },
                                title: { display: true, text: 'Distance (cm)', color: '#64748b' }
                            },
                            x: { ticks: { color: '#64748b' }, grid: { color: '#1e3a5f' } }
                        }
                    }}
                />
            </div>

            {/* ── Priority Table ── */}
            {decision?.priorities && (
                <div style={{ background: 'linear-gradient(160deg, #1a2540, #111827)', borderRadius: '16px', padding: '20px', border: '1px solid #1e3a5f' }}>
                    <h3 style={{ margin: '0 0 16px', color: '#94a3b8', fontSize: '15px' }}>
                        📋 Signal Priority Analysis
                    </h3>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #1e3a5f' }}>
                                    {['Rank', 'Road', 'Distance', 'Next Traffic', 'Score', 'Green Time', 'Current LED'].map(h => (
                                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#475569', fontWeight: '600', fontSize: '11px', letterSpacing: '1px' }}>
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {decision.priorities.map((p, i) => (
                                    <tr key={p.road} style={{
                                        borderBottom: '1px solid #0f172a',
                                        background: i === 0 ? 'rgba(34,197,94,0.06)' : 'transparent'
                                    }}>
                                        <td style={{ padding: '10px 12px', color: i === 0 ? '#4ade80' : '#64748b', fontWeight: 'bold' }}>
                                            #{i + 1}
                                        </td>
                                        <td style={{ padding: '10px 12px', fontWeight: 'bold', color: i === 0 ? '#e2e8f0' : '#94a3b8' }}>
                                            {p.road}
                                        </td>
                                        <td style={{ padding: '10px 12px', color: '#94a3b8' }}>
                                            {p.distance ? `${p.distance}cm` : 'No vehicle'}
                                        </td>
                                        <td style={{ padding: '10px 12px' }}>
                                            <TrafficBadge level={p.traffic} />
                                        </td>
                                        <td style={{ padding: '10px 12px', color: p.score > 0 ? '#4ade80' : p.score < 0 ? '#f87171' : '#94a3b8', fontWeight: 'bold' }}>
                                            {p.score.toFixed(1)}
                                        </td>
                                        <td style={{ padding: '10px 12px', color: '#94a3b8' }}>
                                            {p.greenTime ? `${Math.round(p.greenTime)}s` : '—'}
                                        </td>
                                        <td style={{ padding: '10px 12px' }}>
                                            <span style={{
                                                background: livePhase[p.road] === 'GREEN' ? '#14532d' : livePhase[p.road] === 'YELLOW' ? '#713f12' : '#7f1d1d',
                                                color: livePhase[p.road] === 'GREEN' ? '#4ade80' : livePhase[p.road] === 'YELLOW' ? '#fde047' : '#f87171',
                                                padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold'
                                            }}>
                                                {livePhase[p.road] === 'GREEN' ? '🟢' : livePhase[p.road] === 'YELLOW' ? '🟡' : '🔴'}{' '}
                                                {livePhase[p.road] || 'RED'}
                                                {liveCountdown[p.road] > 0 ? ` (${liveCountdown[p.road]}s)` : ''}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Footer ── */}
            <div style={{ textAlign: 'center', marginTop: '30px', color: '#1e3a5f', fontSize: '12px' }}>
                HYDRA v2.0 — Safety Critical System — Nawinna Junction, Kurunegala
            </div>
        </div>
    );
}

export default App;