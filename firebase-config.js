import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDocs,
  collection,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/**
 * firebase-config.js (frontend-only)
 * Objetivo: Mantener tu flujo actual (usuarios en Firestore) pero con mejor estructura.
 *
 * ⚠️ Seguridad:
 * - Guardar contraseñas en Firestore en texto plano NO es seguro.
 * - Lo profesional es usar Firebase Auth (Email/Password) o un backend para hash.
 * - Aquí mantenemos tu modelo para NO romper tu sistema existente.
 */

const firebaseConfig = {
  apiKey: "AIzaSyDC9DDyJfTuohHH8cKA10TsOuNXAvOt_10",
  authDomain: "simulacroesfms2026.firebaseapp.com",
  projectId: "simulacroesfms2026",
  storageBucket: "simulacroesfms2026.firebasestorage.app",
  messagingSenderId: "1076674602133",
  appId: "1:1076674602133:web:19a784f9f1a8f4c4d7e79c",
  measurementId: "G-TSGV600NJN",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/* =========================
   Modales (compatibilidad con onclick)
   ========================= */
function abrirModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = "flex";
}
function cerrarModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = "none";
}
window.abrirModal = abrirModal;
window.cerrarModal = cerrarModal;

window.addEventListener("click", (event) => {
  const t = event.target;
  if (t?.classList?.contains("modal-overlay")) t.style.display = "none";
});

/* =========================
   Utilidades UI
   ========================= */
const $ = (sel, root = document) => root.querySelector(sel);

function setError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg || "";
  el.style.display = msg ? "block" : "none";
}
function val(id) {
  return (document.getElementById(id)?.value ?? "").trim();
}
function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/* =========================
   Firestore helpers
   ========================= */



/* =========================
   Acciones
   ========================= */



document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("btn-enviar-registro")
    ?.addEventListener("click", registrar);
  document
    .getElementById("btn-validar-ingreso")
    ?.addEventListener("click", login);
});
