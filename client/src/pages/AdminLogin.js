// // client/src/pages/AdminLogin.js
// import React, { useState } from 'react';
// import { auth, signInWithEmailAndPassword } from '../firebase';
// import { useNavigate } from 'react-router-dom';

// export default function AdminLogin() {
//   const [email, setEmail] = useState('');
//   const [password, setPassword] = useState('');
//   const [error, setError] = useState('');
//   const [loading, setLoading] = useState(false);
//   const navigate = useNavigate();

//   const handleAdminLogin = async (e) => {
//     e.preventDefault();
//     setLoading(true);
//     setError('');
    
//     try {
//       // Remove the 'result' variable or use void to ignore
//       await signInWithEmailAndPassword(auth, email, password);
      
//       // List of authorized admin emails (only these can access admin panel)
//       const authorizedAdmins = [
//         'admin@hydra.traffic',  
//         'admin@hydra.com',
//         'admin@hydra-traffic.com',
//         'your-email@gmail.com'
//       ];
      
//       // Check if the logged-in email is in the authorized admin list
//       if (authorizedAdmins.includes(email)) {
//         navigate('/admin-dashboard');
//       } else {
//         await auth.signOut();
//         setError('Access denied. You are not authorized as an administrator.');
//       }
//     } catch (err) {
//       setError('Invalid admin email or password. Access denied.');
//     }
//     setLoading(false);
//   };

//   return (
//     <div style={{
//       minHeight: '100vh', background: '#0a0f1e',
//       display: 'flex', alignItems: 'center', justifyContent: 'center',
//       fontFamily: "'Segoe UI', sans-serif"
//     }}>
//       <div style={{
//         background: 'linear-gradient(160deg,#1a2540,#111827)',
//         border: '1px solid #7f1d1d', borderRadius: 20,
//         padding: '48px 40px', width: 380
//       }}>
//         <div style={{ textAlign: 'center', marginBottom: 28 }}>
//           <div style={{ fontSize: 48, marginBottom: 12 }}>🚨</div>
//           <h1 style={{ color: '#e2e8f0', fontSize: '1.4rem', margin: '0 0 6px' }}>
//             Administrator Access
//           </h1>
//           <p style={{ color: '#475569', fontSize: 12, margin: 0 }}>
//             H.Y.D.R.A Traffic Control System
//           </p>
//         </div>

//         <form onSubmit={handleAdminLogin}>
//           <div style={{ marginBottom: 16 }}>
//             <label style={{ color: '#94a3b8', fontSize: 11, letterSpacing: 1, display: 'block', marginBottom: 6 }}>
//               ADMIN EMAIL
//             </label>
//             <input
//               type="email"
//               value={email}
//               onChange={e => setEmail(e.target.value)}
//               required
//               placeholder="admin@hydra.traffic"
//               style={{
//                 width: '100%', padding: '11px 14px',
//                 background: '#0f172a', border: '1px solid #334155',
//                 borderRadius: 8, color: 'white', fontSize: 13,
//                 outline: 'none', boxSizing: 'border-box'
//               }}
//             />
//           </div>

//           <div style={{ marginBottom: 24 }}>
//             <label style={{ color: '#94a3b8', fontSize: 11, letterSpacing: 1, display: 'block', marginBottom: 6 }}>
//               PASSWORD
//             </label>
//             <input
//               type="password"
//               value={password}
//               onChange={e => setPassword(e.target.value)}
//               required
//               placeholder="••••••••"
//               style={{
//                 width: '100%', padding: '11px 14px',
//                 background: '#0f172a', border: '1px solid #334155',
//                 borderRadius: 8, color: 'white', fontSize: 13,
//                 outline: 'none', boxSizing: 'border-box'
//               }}
//             />
//           </div>

//           {error && (
//             <div style={{
//               background: '#7f1d1d', color: '#f87171',
//               border: '1px solid #ef4444', borderRadius: 8,
//               padding: '10px 14px', fontSize: 12, marginBottom: 16
//             }}>
//               {error}
//             </div>
//           )}

//           <button
//             type="submit"
//             disabled={loading}
//             style={{
//               width: '100%', padding: '13px',
//               background: loading ? '#1e293b' : '#7f1d1d',
//               border: '1px solid #ef4444', borderRadius: 10,
//               color: '#f87171', fontSize: 14, fontWeight: 'bold',
//               cursor: loading ? 'not-allowed' : 'pointer'
//             }}
//           >
//             {loading ? 'Authenticating...' : '🔐 Administrator Login'}
//           </button>
//         </form>

//         <div style={{ textAlign: 'center', marginTop: 24, paddingTop: 20, borderTop: '1px solid #1e293b' }}>
//           <a href="/" style={{ color: '#334155', fontSize: 11, textDecoration: 'none' }}>
//             ← Back to Public Dashboard
//           </a>
//         </div>
//       </div>
//     </div>
//   );
// }



// client/src/pages/AdminLogin.js
import React, { useState } from 'react';
import { auth, signInWithEmailAndPassword } from '../firebase';

const AUTHORIZED_ADMINS = [
  'admin@hydra.traffic',
  'admin@hydra.com',
  'admin@hydra-traffic.com',
];

export default function AdminLogin({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await signInWithEmailAndPassword(auth, email, password);

      if (!AUTHORIZED_ADMINS.includes(result.user.email)) {
        await auth.signOut();
        setError('Access denied. You are not authorized as an administrator.');
        setLoading(false);
        return;
      }

      // This is what App.js is waiting for
      const adminData = {
        name: result.user.displayName || result.user.email,
        email: result.user.email,
        role: 'admin',
      };
      localStorage.setItem('adminToken', result.user.accessToken || 'admin');
      onLogin(adminData);  // ← triggers App.js to render AdminDashboard

    } catch (err) {
      setError('Invalid admin email or password. Access denied.');
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
        border: '1px solid #7f1d1d', borderRadius: 20,
        padding: '48px 40px', width: 380
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🚨</div>
          <h1 style={{ color: '#e2e8f0', fontSize: '1.4rem', margin: '0 0 6px' }}>
            Administrator Access
          </h1>
          <p style={{ color: '#475569', fontSize: 12, margin: 0 }}>
            H.Y.D.R.A Traffic Control System
          </p>
        </div>

        <form onSubmit={handleAdminLogin}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ color: '#94a3b8', fontSize: 11, letterSpacing: 1, display: 'block', marginBottom: 6 }}>
              ADMIN EMAIL
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="admin@hydra.traffic"
              style={{
                width: '100%', padding: '11px 14px',
                background: '#0f172a', border: '1px solid #334155',
                borderRadius: 8, color: 'white', fontSize: 13,
                outline: 'none', boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ color: '#94a3b8', fontSize: 11, letterSpacing: 1, display: 'block', marginBottom: 6 }}>
              PASSWORD
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              style={{
                width: '100%', padding: '11px 14px',
                background: '#0f172a', border: '1px solid #334155',
                borderRadius: 8, color: 'white', fontSize: 13,
                outline: 'none', boxSizing: 'border-box'
              }}
            />
          </div>

          {error && (
            <div style={{
              background: '#7f1d1d', color: '#f87171',
              border: '1px solid #ef4444', borderRadius: 8,
              padding: '10px 14px', fontSize: 12, marginBottom: 16
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '13px',
              background: loading ? '#1e293b' : '#7f1d1d',
              border: '1px solid #ef4444', borderRadius: 10,
              color: '#f87171', fontSize: 14, fontWeight: 'bold',
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'Authenticating...' : '🔐 Administrator Login'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 24, paddingTop: 20, borderTop: '1px solid #1e293b' }}>
          <a href="/" style={{ color: '#334155', fontSize: 11, textDecoration: 'none' }}>
            ← Back to Public Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}