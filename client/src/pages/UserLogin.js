// client/src/pages/UserLogin.js
import React, { useState } from 'react';
import { auth, googleProvider, signInWithPopup } from '../firebase';

export default function UserLogin({ onLogin }) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      onLogin({ name: result.user.displayName, email: result.user.email, photo: result.user.photoURL, role: 'user' });
    } catch (err) {
      setError('Google sign-in failed. Please try again.');
    }
    setLoading(false);
  };

  return (
    <div style={{minHeight:'100vh',background:'#0a0f1e',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Segoe UI', sans-serif"}}>
      <div style={{background:'linear-gradient(160deg,#1a2540,#111827)',border:'1px solid #1e3a5f',borderRadius:20,padding:'48px 40px',width:380,textAlign:'center'}}>
        <div style={{fontSize:48,marginBottom:12}}>🚦</div>
        <h1 style={{color:'#e2e8f0',fontSize:'1.6rem',margin:'0 0 6px'}}>H.Y.D.R.A</h1>
        <p style={{color:'#475569',fontSize:13,margin:'0 0 32px'}}>Nawinna Junction Traffic System</p>
        <div style={{background:'#0f172a',borderRadius:12,padding:20,marginBottom:24,border:'1px solid #1e3a5f'}}>
          <div style={{color:'#94a3b8',fontSize:12,marginBottom:12,letterSpacing:1}}>PUBLIC ACCESS</div>
          <p style={{color:'#64748b',fontSize:12,margin:'0 0 16px'}}>View live traffic conditions, wait times, and road status at Nawinna Junction.</p>
          <button onClick={handleGoogleLogin} disabled={loading} style={{width:'100%',padding:'12px 20px',background:loading?'#1e293b':'#1a3a6b',border:'1px solid #2E75B6',borderRadius:10,color:'#60a5fa',fontSize:14,fontWeight:'bold',cursor:loading?'not-allowed':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:10}}>
            <span style={{fontSize:18}}>G</span>
            {loading ? 'Signing in...' : 'Continue with Google'}
          </button>
        </div>
        {error && <div style={{background:'#7f1d1d',color:'#f87171',border:'1px solid #ef4444',borderRadius:8,padding:'10px 16px',fontSize:12,marginBottom:16}}>{error}</div>}
        <a href="/admin" style={{display:'block',color:'#3b82f6',fontSize:12,marginBottom:16,textDecoration:'underline'}}>Administrator Login →</a>
        <p style={{color:'#1e3a5f',fontSize:11,margin:0}}>By signing in you agree to use this service for informational purposes only.</p>
      </div>
    </div>
  );
}