// admin.js
// Panel de Administración (solo lectura de admins/{uid} y acciones vía Cloud Functions)
//
// Mantiene la misma lógica:
// - Verifica acceso leyendo admins/{uid} (solo el propio doc)
// - Lista usuarios vía Cloud Function adminListUsers()
// - Cambia plan vía Cloud Function setPlan()
//
// Fix adicional (sin cambiar la lógica):
// Algunos backends de setPlan validan "periodo" (trimestral/anual) con un esquema
// distinto. Para evitar el "inválido", aquí intentamos 2 esquemas:
//  1) esquema actual: { estado: 'trimestral'|'anual'|'gratis', fechaInicio, fechaVencimiento }
//  2) fallback:       { estado: 'premium', periodo: 'trimestral'|'anual', ... }
// Solo si el primer intento devuelve error que contiene "inval"/"period".

import { auth, db } from "./firebase-init.js";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// =========================
// CONFIG
// =========================
const YEAR = new Date().getFullYear();
const FUNCTIONS_BASE = "https://us-central1-simulacroesfms2026.cloudfunctions.net";
const URL_SET_PLAN = `${FUNCTIONS_BASE}/setPlan`;
const URL_ADMIN_LIST_USERS = `${FUNCTIONS_BASE}/adminListUsers`;

// Cache local (para búsqueda en UI)
let ALL_USERS = [];

// =========================
// DOM helpers
// =========================
const $ = (id) => document.getElementById(id);

function setStatus(msg) {
  const el = $("admin-status");
  if (el) el.textContent = msg || "";
}

function setError(msg) {
  const el = $("admin-error");
  if (!el) return;
  el.textContent = msg || "";
  el.style.display = msg ? "block" : "none";
}

function setCount(n) {
  const el = $("admin-count");
  if (el) el.textContent = `${n} usuario(s)`;
}

function fmtDate(value) {
  if (!value) return "-";

  // Puede venir como ISO string, Timestamp-like, o null
  try {
    if (typeof value === "string") {
      return new Date(value).toLocaleDateString("es-BO", { year: "numeric", month: "2-digit", day: "2-digit" });
    }
    // Firestore Timestamp serializado puede venir como { _seconds, _nanoseconds }
    if (typeof value === "object" && value._seconds) {
      return new Date(value._seconds * 1000).toLocaleDateString("es-BO", { year: "numeric", month: "2-digit", day: "2-digit" });
    }
    // Firestore Timestamp real (en algunos casos)
    if (typeof value?.toDate === "function") {
      return value.toDate().toLocaleDateString("es-BO", { year: "numeric", month: "2-digit", day: "2-digit" });
    }
  } catch {
    // nada
  }
  return String(value);
}

// =========================
// Seguridad: Admin check (solo lectura)
// =========================
async function isAdminUser(uid) {
  try {
    const ref = doc(db, "admins", uid);
    const snap = await getDoc(ref);
    return snap.exists();
  } catch {
    return false;
  }
}

// =========================
// Helper: POST a Cloud Function con ID token
// =========================
async function postFunction(url, payload) {
  const user = auth.currentUser;
  if (!user) throw new Error("No autenticado.");

  // true = refresca token (útil si cambiaste claims recientemente)
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
  if (!r.ok) {
    const msg = data?.message || data?.error || `HTTP ${r.status}`;
    const err = new Error(msg);
    err._status = r.status;
    err._data = data;
    throw err;
  }
  return data;
}

// =========================
// Ventanas/fechas de plan
// =========================
function endOfDayUTC(date) {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function addDaysUTC(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function getPlanRange(tipo) {
  // Trimestral: (Feb-May), (Jun-Ago), (Sep-Nov)
  // Anual: (Feb-Nov)
  const now = new Date();
  const m = now.getMonth() + 1; // 1..12

  if (tipo === "anual") {
    const start = new Date(Date.UTC(YEAR, 1, 1)); // Feb 1
    const end = new Date(Date.UTC(YEAR, 10, 30, 23, 59, 59)); // Nov 30
    return { start, end };
  }

  // Trimestral
  let startMonth = 2,
    endMonth = 5; // Feb-May
  if (m >= 2 && m <= 5) {
    startMonth = 2;
    endMonth = 5;
  } else if (m >= 6 && m <= 8) {
    startMonth = 6;
    endMonth = 8;
  } else if (m >= 9 && m <= 11) {
    startMonth = 9;
    endMonth = 11;
  } else {
    // dic-ene: cae al primer trimestre del año vigente (Feb-May)
    startMonth = 2;
    endMonth = 5;
  }

  const start = new Date(Date.UTC(YEAR, startMonth - 1, 1));
  const end = new Date(Date.UTC(YEAR, endMonth, 0, 23, 59, 59)); // último día del mes endMonth
  return { start, end };
}

function shouldTryFallbackSetPlan(err) {
  const msg = String(err?.message || "").toLowerCase();
  // Cubre "inválido", "invalido", "periodo" / "period" / "plan".
  return msg.includes("inval") || msg.includes("period") || msg.includes("plan");
}

async function setPlanCall({ uid, estado, inicio, venc }) {
  const basePayload = {
    targetUid: uid,
    estado,
    fechaInicio: inicio ? inicio.toISOString() : null,
    fechaVencimiento: venc ? venc.toISOString() : null,
  };

  // 1) Intento normal (como venías usando)
  try {
    await postFunction(URL_SET_PLAN, basePayload);
    return;
  } catch (err) {
    // Si no parece problema de validación de periodo/plan, no hacemos fallback
    if (!shouldTryFallbackSetPlan(err)) throw err;

    // 2) Fallback: algunos backends usan estado="premium" + periodo="trimestral"|"anual"
    // Mantiene misma lógica funcional (el admin sigue aplicando trimestral/anual/gratis),
    // solo cambia el formato si el backend lo requiere.
    const periodo =
      estado === "trimestral" || estado === "anual" ? estado : null;

    const fallbackPayload = {
      targetUid: uid,
      // mantenemos estado original por compatibilidad, pero agregamos alternativas
      estado: periodo ? "premium" : estado,
      periodo, // <-- clave extra
      plan: periodo, // <-- por si tu backend usa "plan"
      tipo: periodo, // <-- por si tu backend usa "tipo"
      fechaInicio: basePayload.fechaInicio,
      fechaVencimiento: basePayload.fechaVencimiento,
    };

    await postFunction(URL_SET_PLAN, fallbackPayload);
  }
}

// =========================
// Acciones de plan
// =========================
async function setUserPlan(uid, action, currentEstado = "gratis") {
  // actions: gratis | trimestral | anual | extender30
  const now = new Date();

  if (action === "gratis" || action === "vencer") {
    await setPlanCall({ uid, estado: "gratis", inicio: null, venc: null });
    return;
  }

  if (action === "extender30") {
    // Extiende 30 días desde hoy.
    // Si el usuario está en gratis, lo pasa a trimestral por defecto.
    const estado = currentEstado === "anual" ? "anual" : "trimestral";
    const inicio = now;
    const venc = endOfDayUTC(addDaysUTC(now, 30));
    await setPlanCall({ uid, estado, inicio, venc });
    return;
  }

  if (action === "trimestral" || action === "anual") {
    const { start, end } = getPlanRange(action);
    await setPlanCall({ uid, estado: action, inicio: start, venc: end });
    return;
  }

  throw new Error("Acción de plan no soportada.");
}

// =========================
// UI rendering
// =========================
function estadoPill(estado) {
  const s = (estado || "gratis").toLowerCase();
  if (s === "trimestral") {
    return '<span style="padding:6px 10px;border-radius:999px;background:#AEC809;border:1px solid #ffe2b3;">Trimestral</span>';
  }
  if (s === "anual") {
    return '<span style="padding:6px 10px;border-radius:999px;background:#09C816;border:1px solid #cfe6ff;">Anual</span>';
  }
  return '<span style="padding:6px 10px;border-radius:999px;background:#079C94;border:1px solid #e7eaee;">Gratis</span>';
}

function renderUsers(rows) {
  const tbody = $("users-tbody");
  if (!tbody) return;

  ALL_USERS = Array.isArray(rows) ? rows : [];
  setCount(ALL_USERS.length);

  if (!ALL_USERS.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="padding:12px;text-align:center;color:#666;">Sin usuarios.</td></tr>';
    return;
  }

  tbody.innerHTML = ALL_USERS
    .map((r) => {
      const estado = r.estado || "gratis";
      return `
        <tr style="border-top:1px solid rgba(0,0,0,0.06);">
          <td style="padding:10px;">${r.nombre || "(sin nombre)"}</td>
          <td style="padding:10px;">${r.correo || "-"}</td>
          <td style="padding:10px;text-align:center;">${estadoPill(estado)}</td>
          <td style="padding:10px;text-align:center;">${fmtDate(r.fechaInicio)}</td>
          <td style="padding:10px;text-align:center;">${fmtDate(
            r.fechaVencimiento
          )}</td>
          <td style="padding:10px;text-align:center;white-space:nowrap;">
            <button class="btn-secundario" data-action="trimestral" data-uid="${
              r.uid
            }" type="button" style="margin-right:6px;">Trimestral</button>
            <button class="btn-primario" data-action="anual" data-uid="${
              r.uid
            }" type="button" style="margin-right:6px;">Anual</button>
            <button class="btn-secundario" data-action="extender30" data-uid="${
              r.uid
            }" type="button" style="margin-right:6px;">+30 días</button>
            <button class="btn-secundario" data-action="gratis" data-uid="${
              r.uid
            }" type="button">Gratis</button>
          </td>
        </tr>
      `;
    })
    .join("");

  // Delegación de eventos
  tbody.onclick = async (e) => {
    const btn = e.target?.closest?.("button[data-action][data-uid]");
    if (!btn) return;

    const uid = btn.getAttribute("data-uid");
    const action = btn.getAttribute("data-action");
    const row = ALL_USERS.find((u) => u.uid === uid);
    const currentEstado = row?.estado || "gratis";

    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = "Aplicando…";
    setError("");

    try {
      await setUserPlan(uid, action, currentEstado);
      await loadUsers();
    } catch (err) {
      setError(err?.message || "No se pudo actualizar el plan.");
    } finally {
      btn.textContent = prev;
      btn.disabled = false;
    }
  };
}

function applySearchFilter() {
  const q = ($("admin-search")?.value || "").trim().toLowerCase();
  if (!q) {
    renderUsers(ALL_USERS);
    return;
  }

  const filtered = ALL_USERS.filter((u) => {
    const nombre = String(u.nombre || "").toLowerCase();
    const correo = String(u.correo || "").toLowerCase();
    const uid = String(u.uid || "").toLowerCase();
    return nombre.includes(q) || correo.includes(q) || uid.includes(q);
  });

  // Render sin perder el cache global
  const backup = ALL_USERS;
  renderUsers(filtered);
  ALL_USERS = backup;
}

function wireSearchAndRefresh() {
  $("admin-search")?.addEventListener("input", applySearchFilter);
  $("admin-refresh")?.addEventListener("click", (e) => {
    e.preventDefault();
    loadUsers();
  });
  $("btn-admin-logout")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await signOut(auth);
    window.location.href = "index.html";
  });
}

// =========================
// Data loading
// =========================
async function loadUsers() {
  const tbody = $("users-tbody");
  if (tbody) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="padding:12px;text-align:center;color:#666;">Cargando…</td></tr>';
  }

  setError("");
  try {
    const resp = await postFunction(URL_ADMIN_LIST_USERS, {});
    const users = Array.isArray(resp?.users) ? resp.users : [];
    renderUsers(users);
  } catch (err) {
    setError(err?.message || "No se pudo cargar usuarios.");
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="6" style="padding:12px;text-align:center;color:#b00020;">Error cargando usuarios.</td></tr>';
    }
  }
}

// =========================
// Bootstrap
// =========================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  const ok = await isAdminUser(user.uid);
  if (!ok) {
    setStatus("Acceso denegado: no eres administrador.");
    setError("Para habilitar este panel, crea un documento en Firestore: admins/{TU_UID}.");
    return;
  }

  setStatus(`Admin: ${user.email || user.uid}`);

  wireSearchAndRefresh();
  await loadUsers();
});
