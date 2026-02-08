// auth.js (VENTANA 1 - optimizado sin cambiar lógica)
// - Firebase Auth (Google + Email/Password)
// - Perfil en Firestore: users_pdc/{uid}
// - Siempre estado: "gratis"
// - Evita race: no redirige antes de setDoc

import { auth, db } from "./firebase-init.js";

import {
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* =========================
   Estado anti-race
========================= */
let isAuthActionRunning = false;
let firstAuthState = true;

/* =========================
   Helpers DOM/UI
========================= */
const byId = (id) => document.getElementById(id);

function setError(id, msg) {
  const el = byId(id);
  if (!el) return;
  el.textContent = msg || "";
  el.style.display = msg ? "block" : "none";
}

function val(id) {
  return (byId(id)?.value ?? "").trim();
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function setBusy(btnId, busyText) {
  const btn = byId(btnId);
  if (!btn) return () => {};
  const original = btn.innerText;
  btn.disabled = true;
  btn.innerText = busyText || original;

  return () => {
    btn.disabled = false;
    btn.innerText = original;
  };
}

function firebaseErrorToText(e) {
  // Mensajes cortos y “bonitos” (sin perder info si no matchea)
  const code = String(e?.code || "");
  switch (code) {
    case "auth/email-already-in-use":
      return "Ese correo ya está registrado.";
    case "auth/invalid-email":
      return "Correo inválido.";
    case "auth/weak-password":
      return "La contraseña es muy débil (mínimo 6 caracteres).";
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Credenciales incorrectas.";
    case "auth/user-not-found":
      return "No existe una cuenta con ese correo.";
    case "auth/popup-closed-by-user":
      return "Cerraste la ventana de Google antes de finalizar.";
    default:
      return e?.message || "Ocurrió un error. Intenta nuevamente.";
  }
}

function parsePermisos(planSel) {
  // Mantiene tu formato: "prim:prim_4to" o "sec:MAT_08"
  const [tipo, valor] = String(planSel || "").split(":");
  return {
    primaria: tipo === "prim" && valor ? [valor] : [],
    secundaria: tipo === "sec" && valor ? [valor] : [],
  };
}

/* =========================
   Perfil Firestore: users_pdc/{uid}
========================= */
async function ensureUserProfile(
  user,
  { nombre = "", apellido = "", planSel = "" } = {},
) {
  const ref = doc(db, "users_pdc", user.uid);
  const snap = await getDoc(ref);

  const defaultUsage = {
    objetivo: 0,
    momentos: 0,
    criterios: 0,
    pdcCompleto: 0,
  };

  if (!snap.exists()) {
    const displayName =
      (user.displayName && String(user.displayName).trim()) ||
      [nombre, apellido].filter(Boolean).join(" ").trim() ||
      "";

    await setDoc(ref, {
      uid: user.uid,
      correo: user.email || "",
      nombre: nombre || displayName.split(" ")[0] || "",
      apellido: apellido || displayName.split(" ").slice(1).join(" "),
      displayName,
      photoURL: user.photoURL || "",
      estado: "gratis",
      fechaInicio: null,
      fechaVencimiento: null,
      permisos: parsePermisos(planSel),
      nivelEscolaridad: planSel || "",
      aiUsage: defaultUsage,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return;
  }

  // Si existe, refresca datos básicos sin tocar estado/fechas
  const data = snap.data() || {};
  const patch = {};

  if (!data.correo && user.email) patch.correo = user.email;
  if (!data.photoURL && user.photoURL) patch.photoURL = user.photoURL;
  if (!data.displayName && user.displayName)
    patch.displayName = user.displayName;

  if (Object.keys(patch).length) {
    patch.updatedAt = serverTimestamp();
    await updateDoc(ref, patch);
  }
}

/* =========================
   Acciones Auth
========================= */
async function signInGoogle(commonProfile = {}) {
  if (isAuthActionRunning) return;
  isAuthActionRunning = true;

  try {
    setError("login-error", "");
    setError("reg-error", "");

    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);

    await ensureUserProfile(result.user, commonProfile);
    window.location.href = "dashboard.html";
  } catch (e) {
    const msg = firebaseErrorToText(e);
    console.error("❌ Google SignIn error:", e);
    setError("login-error", msg);
    setError("reg-error", msg);
  } finally {
    isAuthActionRunning = false;
  }
}

async function registerEmail() {
  if (isAuthActionRunning) return;
  isAuthActionRunning = true;

  const done = setBusy("btn-enviar-registro", "Registrando...");
  try {
    setError("reg-error", "");

    const nombre = val("reg-nombre");
    const apellido = val("reg-apellido");
    const correo = val("reg-correo");
    const pass = val("reg-pass");
    const pass2 = val("reg-pass2");
    const planSel = val("reg-plan");
    if (!planSel) {
      setError("reg-error", "Debes seleccionar un plan antes de registrarte.");
      return;
    }

    if (!nombre || !apellido || !correo || !pass || !pass2) {
      setError("reg-error", "Completa nombre, apellido, correo y contraseña.");
      return;
    }
    if (!isEmail(correo)) {
      setError("reg-error", "Correo inválido.");
      return;
    }
    if (pass.length < 6) {
      setError("reg-error", "La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (pass !== pass2) {
      setError("reg-error", "Las contraseñas no coinciden.");
      return;
    }

    const cred = await createUserWithEmailAndPassword(auth, correo, pass);
    await ensureUserProfile(cred.user, { nombre, apellido, planSel });

    window.location.href = "dashboard.html";
  } catch (e) {
    console.error("❌ Register error:", e);
    setError("reg-error", firebaseErrorToText(e));
  } finally {
    done();
    isAuthActionRunning = false;
  }
}

async function loginEmail() {
  if (isAuthActionRunning) return;
  isAuthActionRunning = true;

  const done = setBusy("btn-validar-ingreso", "Verificando...");
  try {
    setError("login-error", "");

    const correo = val("login-email");
    const pass = val("login-pass");

    if (!correo || !pass) {
      setError("login-error", "Ingresa correo y contraseña.");
      return;
    }
    if (!isEmail(correo)) {
      setError("login-error", "Correo inválido.");
      return;
    }

    const cred = await signInWithEmailAndPassword(auth, correo, pass);
    await ensureUserProfile(cred.user, {});
    window.location.href = "dashboard.html";
  } catch (e) {
    console.error("❌ Login error:", e);
    setError("login-error", firebaseErrorToText(e));
  } finally {
    done();
    isAuthActionRunning = false;
  }
}

// async function resetPassword() {
//   try {
//     setError("login-error", "");
//     const correo = val("login-email");

//     if (!correo || !isEmail(correo)) {
//       setError(
//         "login-error",
//         "Escribe un correo válido para recuperar tu contraseña.",
//       );
//       return;
//     }

//     await sendPasswordResetEmail(auth, correo);
//     setError(
//       "login-error",
//       "Te enviamos un correo para restablecer tu contraseña.",
//     );
//   } catch (e) {
//     console.error("❌ Reset password error:", e);
//     setError("login-error", firebaseErrorToText(e));
//   }
// }
async function resetPassword() {
  const msg = byId("reset-msg");

  try {
    setError("login-error", "");
    msg.className = "mensaje";
    msg.innerText = "";

    const correo = val("login-email");

    if (!correo || !isEmail(correo)) {
      msg.classList.add("error");
      msg.innerText = "¡Escribe un correo válido!";
      return;
    }

    await sendPasswordResetEmail(auth, correo);

    msg.classList.add("ok");
    msg.innerText = "Correo de recuperación enviado ✔";
    setTimeout(() => {
      msg.className = "mensaje";
      msg.innerText = "";
    }, 2000);
  } catch (e) {
    console.error("❌ Reset password error:", e);
    msg.classList.add("error");
    msg.innerText = firebaseErrorToText(e);
  }
}

/* =========================
   Modales (compatibles con onclick del HTML)
========================= */
function abrirModal(id) {
  const m = byId(id);
  if (m) m.style.display = "flex";
}
function cerrarModal(id) {
  const m = byId(id);
  if (m) m.style.display = "none";
}
window.abrirModal = abrirModal;
window.cerrarModal = cerrarModal;

window.addEventListener("click", (e) => {
  const t = e.target;
  if (t?.classList?.contains("modal-overlay")) t.style.display = "none";
});

/* =========================
   Wire UI (IDs del HTML)
========================= */
byId("btn-enviar-registro")?.addEventListener("click", registerEmail);

// byId("btn-google-registro")?.addEventListener("click", () =>
//   signInGoogle({ planSel: val("reg-plan") }),
// );

byId("btn-google-registro")?.addEventListener("click", () => {
  setError("reg-error", "");
  const planSel = val("reg-plan");

  if (!planSel) {
    setError(
      "reg-error",
      "Debes seleccionar un plan antes de registrarte con Google.",
    );
    return;
  }

  signInGoogle({ planSel });
});

byId("btn-validar-ingreso")?.addEventListener("click", loginEmail);

byId("btn-google-login")?.addEventListener("click", () => signInGoogle({}));

byId("btn-reset-pass")?.addEventListener("click", resetPassword);

byId("btn-olvido")?.addEventListener("click", resetPassword);

/* =========================
   Auto-login si ya estaba logueado (y asegura perfil)
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!firstAuthState) return;
  firstAuthState = false;

  if (!user) return;
  if (isAuthActionRunning) return;

  try {
    await ensureUserProfile(user, {});
    window.location.href = "dashboard.html";
  } catch (e) {
    console.error("❌ No se pudo asegurar perfil:", e);
    setError("login-error", firebaseErrorToText(e));
  }
});
