import React, { useState } from 'react';
import { 
  auth, 
  googleProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword 
} from '../firebase';
import { useNavigate } from 'react-router-dom';

export default function UserLogin() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const navigate = useNavigate();

  // Google Login for Regular Users
  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      console.log('User logged in:', result.user.email);
      // Redirect to user dashboard after successful login
      navigate('/user-dashboard');
    } catch (err) {
      setError('Google sign-in failed. Please try again.');
      console.error(err);
    }
    setLoading(false);
  };

  // Admin Email/Password Login
  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await signInWithEmailAndPassword(auth, adminEmail, adminPassword);
      console.log('Admin logged in:', result.user.email);
      // Redirect to admin dashboard after successful login
      navigate('/admin-dashboard');
    } catch (err) {
      setError('Invalid admin credentials. Access denied.');
      console.error(err);
    }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0f1e',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Segoe UI', sans-serif"
    }}>
      <div style={{
        background: 'linear-gradient(160deg,#1a2540,#111827)',
        border: '1px solid #1e3a5f', borderRadius: 20,
        padding: '48px 40px', width: 380, textAlign: 'center'
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🚦</div>
        <h1 style={{ color: '#e2e8f0', fontSize: '1.6rem', margin: '0 0 6px' }}>
          H.Y.D.R.A
        </h1>
        <p style={{ color: '#475569', fontSize: 13, margin: '0 0 32px' }}>
          Nawinna Junction Traffic System
        </p>

        {/* Regular User Section */}
        {!showAdminLogin && (
          <div style={{
            background: '#0f172a', borderRadius: 12, padding: 20,
            marginBottom: 24, border: '1px solid #1e3a5f'
          }}>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 12, letterSpacing: 1 }}>
              PUBLIC ACCESS
            </div>
            <p style={{ color: '#64748b', fontSize: 12, margin: '0 0 16px' }}>
              View live traffic conditions, wait times, and road status at Nawinna Junction.
            </p>
            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              style={{
                width: '100%', padding: '12px 20px',
                background: loading ? '#1e293b' : '#1a3a6b',
                border: '1px solid #2E75B6', borderRadius: 10,
                color: '#60a5fa', fontSize: 14, fontWeight: 'bold',
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 10, transition: 'all 0.2s'
              }}
            >
              <span style={{ fontSize: 18 }}>G</span>
              {loading ? 'Signing in...' : 'Continue with Google'}
            </button>
          </div>
        )}

        {/* Admin Login Section */}
        {showAdminLogin && (
          <div style={{
            background: '#0f172a', borderRadius: 12, padding: 20,
            marginBottom: 24, border: '1px solid #1e3a5f'
          }}>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 12, letterSpacing: 1 }}>
              ADMINISTRATOR ACCESS
            </div>
            <form onSubmit={handleAdminLogin}>
              <input
                type="email"
                placeholder="Admin Email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                style={{
                  width: '100%', padding: '10px', marginBottom: 12,
                  background: '#1e293b', border: '1px solid #2E75B6',
                  borderRadius: 8, color: '#e2e8f0', fontSize: 14
                }}
                required
              />
              <input
                type="password"
                placeholder="Admin Password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                style={{
                  width: '100%', padding: '10px', marginBottom: 16,
                  background: '#1e293b', border: '1px solid #2E75B6',
                  borderRadius: 8, color: '#e2e8f0', fontSize: 14
                }}
                required
              />
              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%', padding: '12px 20px',
                  background: loading ? '#1e293b' : '#7c2d12',
                  border: '1px solid #ea580c', borderRadius: 10,
                  color: '#fdba74', fontSize: 14, fontWeight: 'bold',
                  cursor: loading ? 'not-allowed' : 'pointer'
                }}
              >
                {loading ? 'Logging in...' : 'Admin Login'}
              </button>
            </form>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div style={{
            background: '#7f1d1d', color: '#f87171',
            border: '1px solid #ef4444', borderRadius: 8,
            padding: '10px 16px', fontSize: 12, marginBottom: 16
          }}>
            {error}
          </div>
        )}

        {/* Switch between User and Admin Login */}
        <button
          onClick={() => {
            setShowAdminLogin(!showAdminLogin);
            setError('');
            setAdminEmail('');
            setAdminPassword('');
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#3b82f6',
            fontSize: 12,
            cursor: 'pointer',
            marginBottom: 16,
            textDecoration: 'underline'
          }}
        >
          {showAdminLogin ? '← Back to User Login' : 'Administrator Login →'}
        </button>

        <p style={{ color: '#1e3a5f', fontSize: 11, margin: 0 }}>
          By signing in you agree to use this service for informational purposes only.
        </p>
      </div>
    </div>
  );
}