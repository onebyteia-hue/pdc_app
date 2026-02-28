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
  signOut,
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

const FUNCTIONS_BASE =
  "https://us-central1-simulacroesfms2026.cloudfunctions.net";
const URL_GET_MY_PROFILE = `${FUNCTIONS_BASE}/getMyProfile`;

async function postFunction(url, payload) {
  const user = auth.currentUser;
  if (!user) throw new Error("No autenticado.");

  const token = await user.getIdToken(true);

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload || {}),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
  return data;
}

async function fetchMyProfile() {
  const data = await postFunction(URL_GET_MY_PROFILE, {});
  return data?.profile || null;
}

/* =========================
   Helpers DOM/UI
========================= */

function setAuthUI(isAuthed, user) {
  // 1) Ocultar / mostrar botones Registro/Login
  byId("btnShowRegister")?.classList.toggle("d-none", isAuthed);
  byId("btnShowLogin")?.classList.toggle("d-none", isAuthed);

  // 0) Ocultar/mostrar botones de logout
  byId("btnLogout")?.classList.toggle("d-none", !isAuthed);

  // 2) Marcar protegidos como bloqueados visualmente
  document.querySelectorAll('[data-auth="required"]').forEach((el) => {
    el.classList.toggle("locked", !isAuthed);

    // Si es botón, lo deshabilitamos de verdad
    // NO usar disabled, porque bloquea el click y no podremos abrir el login
    el.dataset.authLocked = String(!isAuthed); // "true" / "false"

    // Para accesibilidad
    el.setAttribute("aria-disabled", String(!isAuthed));
  });

  // 3) Mostrar user en sidebar
  if (isAuthed && user) {
    byId("userName") &&
      (byId("userName").textContent = user.displayName || "Usuario");
    byId("userEmail") && (byId("userEmail").textContent = user.email || "");

    byId("sidebarPlan") && (byId("sidebarPlan").textContent = "CARGANDO...");
  } else {
    byId("userName") && (byId("userName").textContent = "Usuario");

    byId("sidebarPlan") && (byId("sidebarPlan").textContent = "Gratis");
  }

  // 4) cerrar modales al entrar
  if (isAuthed) {
    cerrarModal("modal-login");
    cerrarModal("modal-registro");
  }
}

let isAuthed = false;

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

// ✅ AJUSTA esto a tu URL real de Cloud Function (la misma región us-central1)

function parsePermisos(planSel) {
  // Mantiene tu formato: "prim:prim_4to" o "sec:MAT_08"
  const [tipo, valor] = String(planSel || "").split(":");
  return {
    inicial: tipo === "ini" && valor ? [valor] : [],
    primaria: tipo === "prim" && valor ? [valor] : [],
    secundaria: tipo === "sec" && valor ? [valor] : [],
  };
}


function planLegible(planSel) {
  if (!planSel) return "";

  const [tipo, grado] = planSel.split(":");

  const niveles = {
    ini: "Inicial",
    prim: "Primaria",
    sec: "Secundaria"
  };

  const nivel = niveles[tipo] || tipo;
  const gradoBonito = grado
    ?.replace("ini_", "")
    .replace("prim_", "")
    .replace("sec_", "")
    .replace("_", " ");

  return `${nivel} - ${gradoBonito}`;
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
      nivelEscolaridad: planLegible(planSel),
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

// ====================================================
// ====================================================
// ====================================================

function byId(id) {
  return document.getElementById(id);
}

function setActiveView(viewKey) {
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));
  document
    .querySelectorAll(".side-link")
    .forEach((b) => b.classList.remove("active"));

  const view = byId(`view-${viewKey}`); // ✅ antes era $()
  if (view) view.classList.add("active");

  const btn = document.querySelector(`.side-link[data-view="${viewKey}"]`);
  if (btn) btn.classList.add("active");

  document
    .querySelector(".app-content")
    ?.scrollTo({ top: 0, behavior: "smooth" });
}

function wireUI() {
  // Menú lateral
  document.querySelector(".side-nav")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button.side-link");
    if (!btn) return;

    const view = btn.getAttribute("data-view");
    const go = btn.getAttribute("data-go");

    if (go) window.location.href = go;
    if (view) setActiveView(view);
  });

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-go],[data-view]");
    if (!el) return;

    // ✅ Si requiere login y NO hay sesión, manda a login y NO navegues
    const requiresAuth = el.closest('[data-auth="required"]');
    if (requiresAuth && !auth.currentUser) {
      requireLogin(e);
      return;
    }

    const go = el.getAttribute("data-go");
    const view = el.getAttribute("data-view");

    if (go) window.location.href = go;
    if (view) setActiveView(view);
  });

  function requireLogin(e) {
    // Bloquea el click
    e.preventDefault();
    e.stopPropagation();

    // Lleva a la vista principal si estás en otra
    try {
      setActiveView("principal");
    } catch {}

    // Abre modal login (usa tu función existente)
    try {
      abrirModal("modal-login");
    } catch {}
  }

  function installAuthClickGuard() {
    document.addEventListener(
      "click",
      (e) => {
        // 1) Si hay sesión, no hacemos nada
        if (auth.currentUser) return;

        // 2) ¿El click fue sobre (o dentro de) algo que requiere auth?
        const target = e.target.closest('[data-auth="required"]');
        if (!target) return;

        // 3) No guardes clicks en inputs/botones dentro de modales de login/registro
        if (
          e.target.closest("#modal-login") ||
          e.target.closest("#modal-registro")
        )
          return;

        requireLogin(e);
      },
      true, // capture: se ejecuta ANTES que otros listeners
    );
  }

  installAuthClickGuard();
}

// Init
wireUI();
setActiveView("principal");

// ====================================================
// ====================================================
// ====================================================

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
    // Aquie quitamos el ir a Dashboard
    //window.location.href = "dashboard.html";
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
      setError(
        "reg-error",
        "Debes seleccionar un curso o especialidad antes de registrarte.",
      );
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

    // Aquie quitamos el ir a Dashboard
    //window.location.href = "dashboard.html";
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
    // Aquie quitamos el ir a Dashboard
    //window.location.href = "dashboard.html";
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
// function abrirModal(id) {
//   const m = byId(id);
//   if (m) m.style.display = "flex";

// }
// function cerrarModal(id) {
//   const m = byId(id);
//   if (m) m.style.display = "none";
// }
// window.abrirModal = abrirModal;
// window.cerrarModal = cerrarModal;

// window.addEventListener("click", (e) => {
//   const t = e.target;
//   if (t?.classList?.contains("modal-overlay")) t.style.display = "none";
// });

function abrirModal(id) {
  const m = byId(id);
  if (!m) return;

  m.style.display = "flex";
  m.removeAttribute("aria-hidden");
  m.inert = false;

  // mover foco al primer elemento interactivo del modal
  const focusable = m.querySelector("input,button,select,textarea,a[href]");
  focusable?.focus();
}

function cerrarModal(id) {
  const m = byId(id);
  if (!m) return;

  // sacar foco del modal antes de ocultarlo
  document.activeElement?.blur();

  m.inert = true;
  m.setAttribute("aria-hidden", "true");
  m.style.display = "none";
}

// Compatibilidad heredada
window.abrirModal = abrirModal;
window.cerrarModal = cerrarModal;

// Abrir por data-modal
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-modal]");
  if (!btn) return;
  const id = btn.getAttribute("data-modal");
  if (id) abrirModal(id);
});

// Cerrar por data-close-modal
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-close-modal]");
  if (!btn) return;
  const id = btn.getAttribute("data-close-modal");
  if (id) cerrarModal(id);
});

// Cerrar al hacer click fuera (overlay)
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t?.classList?.contains("modal-overlay")) {
    t.style.display = "none";
    t.setAttribute("aria-hidden", "true");
  }
});

// Cerrar con ESC (opcional)
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const openModal = document.querySelector(
    '.modal-overlay[style*="display: flex"]',
  );
  if (openModal) {
    openModal.style.display = "none";
    openModal.setAttribute("aria-hidden", "true");
  }
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
      "Debes seleccionar un curso o especialidad antes de registrarte con Google.",
    );
    return;
  }

  signInGoogle({ planSel });
});

byId("btn-validar-ingreso")?.addEventListener("click", loginEmail);

// byId("btn-google-login")?.addEventListener("click", () => signInGoogle({}));
byId("btn-google-login")?.addEventListener("click", () => {
  setError("login-error", "");
  setError("google-nivel-error", "");
  abrirModal("modal-google-nivel");
});


byId("btn-reset-pass")?.addEventListener("click", resetPassword);

byId("btn-olvido")?.addEventListener("click", resetPassword);

byId("btnLogout")?.addEventListener("click", async () => {
  await signOut(auth);
});

byId("btnLogout2")?.addEventListener("click", async () => {
  await signOut(auth);
});



byId("btn-google-nivel-next")?.addEventListener("click", async () => {
  setError("google-nivel-error", "");

  const planSel = val("google-plan"); // select del modal intermedio

  if (!planSel) {
    setError("google-nivel-error", "Selecciona un nivel antes de continuar.");
    return;
  }

  cerrarModal("modal-google-nivel");
  await signInGoogle({ planSel }); // ✅ ahora sí con nivel
});

/* =========================
   Auto-login si ya estaba logueado (y asegura perfil)
========================= */

// helpers de plan (colócalos una sola vez en tu archivo)
function planLabel(estado) {
  if (estado === "anual") return "Anual";
  if (estado === "trimestral") return "Trimestral";
  return "Gratis";
}
function planNote(estado) {
  if (estado === "anual") return "Acceso anual";
  if (estado === "trimestral") return "Acceso por trimestres";
  return "Acceso básico";
}

function paintProfileUI(profile) {
  if (!profile) return;

  // Sidebar
  byId("userName") &&
    (byId("userName").textContent = profile.displayName || "Usuario");
  byId("userEmail") && (byId("userEmail").textContent = profile.correo || "");
  byId("sidebarPlan") &&
    (byId("sidebarPlan").textContent = planLabel(profile.estado));
  byId("sidebarPlanNote") &&
    (byId("sidebarPlanNote").textContent = planNote(profile.estado));

  // Vista Perfil
  byId("perfilNombre") &&
    (byId("perfilNombre").textContent = profile.displayName || "Usuario");
  byId("perfilEmail") &&
    (byId("perfilEmail").textContent = profile.correo || "");
  byId("perfilPlan") &&
    (byId("perfilPlan").textContent = planLabel(profile.estado));

  // Admin button
  const btnAdmin = byId("btnAdmin");
  if (btnAdmin) {
    btnAdmin.classList.toggle("d-none", !profile.isAdmin);
    if (profile.isAdmin)
      btnAdmin.onclick = () => (window.location.href = "admin.html");
  }
}

// auth.js
let __profileCache = { value: null, ts: 0 };
const PROFILE_TTL_MS = 60_000; // 1 min

async function fetchMyProfileCached() {
  const now = Date.now();
  if (__profileCache.value && now - __profileCache.ts < PROFILE_TTL_MS) {
    return __profileCache.value;
  }
  const profile = await fetchMyProfile();
  __profileCache = { value: profile, ts: now };
  return profile;
}


onAuthStateChanged(auth, async (user) => {
  isAuthed = !!user;
  setAuthUI(isAuthed, user);

  if (!user) return;

  // ✅ NO crear/asegurar perfil aquí (evita crear doc vacío o dejar nivel/permisos en blanco)

  // ✅ traer perfil REAL desde Cloud Function y pintar UI
  try {
    const profile = await fetchMyProfileCached();
    paintProfileUI(profile);
  } catch (err) {
    console.warn("⚠️ No se pudo cargar getMyProfile:", err);
  }
});


document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");

  if (!view) return;

  const btn = document.querySelector(`.side-link[data-view="${view}"]`);
  if (btn) {
    btn.click();
  }
});