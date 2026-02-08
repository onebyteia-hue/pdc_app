import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "AIzaSyDC9DDyJfTuohHH8cKA10TsOuNXAvOt_10",
  authDomain: "simulacroesfms2026.firebaseapp.com",
  projectId: "simulacroesfms2026",
  storageBucket: "simulacroesfms2026.firebasestorage.app",
  messagingSenderId: "1076674602133",
  appId: "1:1076674602133:web:19a784f9f1a8f4c4d7e79c",
  measurementId: "G-TSGV600NJN",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
