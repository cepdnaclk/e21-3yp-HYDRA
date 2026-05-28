// Import the functions you need from the SDKs
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';

// Your web app's Firebase configuration (REAL values from Firebase)
const firebaseConfig = {
  apiKey: "AIzaSyDgO3F0qhBHNApiVJ4H3lOcS-Vdxw3fqvs",
  authDomain: "hydra-traffic-e86fc.firebaseapp.com",
  projectId: "hydra-traffic-e86fc",
  storageBucket: "hydra-traffic-e86fc.firebasestorage.app",
  messagingSenderId: "837105523702",
  appId: "1:837105523702:web:46a372a6f2479270f945d7",
  measurementId: "G-LWFNQNTYX3"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
const analytics = getAnalytics(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Export initialized services
export { 
  auth, 
  analytics, 
  googleProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
};