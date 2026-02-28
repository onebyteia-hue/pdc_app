let __pdcCompletoMode = false; // ← ESTA LÍNEA ES LA CORRECCIÓN
// 1. Mover fuera del bloque para que sean globales
let datosCargaHoraria = [];
let datosObjetivos = [];
let datosPerfilesSalida = null;
let perfilSalidaSeleccionado = null; // string
let datosPerfilesIni = null;
let perfilIniSeleccionadoKey = null; // guardamos una "key" estable del perfil elegido

// 4 selecciones independientes (slot 1..4)
window.__PDC_PERFILES_SALIDA__ = window.__PDC_PERFILES_SALIDA__ || {
  1: null,
  2: null,
  3: null,
  4: null,
};

// key seleccionado por cada cuadro (para mantener check al rerender)
let perfilIniSeleccionadoKeyBySlot = {
  1: null,
  2: null,
  3: null,
  4: null,
};

// =========================
// CONFIG (Cloud Function Endpoint)
// - Nota: esto NO oculta la URL al 100% (se ve en Network), solo evita verla “de reojo” en el código.
// =========================
const _ENDPOINT_PARTS = [
  "aHR0cHM6Ly91cy1jZW50cmFsMS1zaW11bGFjcm9lc2ZtczIwMjYuY2xvdWRmdW5jdGlvbnMubmV0L2dlbmVyYXJPYmpldGl2bw==",
];
const GEMINI_ENDPOINT = atob(_ENDPOINT_PARTS.join(""));

// =========================
// Firebase (Auth v2 + Profile)
// =========================
import { auth, db } from "./firebase-init.js";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let currentUser = null;
let currentProfile = null;

// =========================
// Permisos UI (filtra selects según perfil)
// Fuente: Permisosdashboard-logic.js (lógica validada)
// =========================
const __origSelectHTML = { escolaridad: null, area: null };

function __ensureOrigSelectHTML() {
  const selEscol = document.getElementById("escolaridad");
  const selArea = document.getElementById("area");
  if (selEscol && __origSelectHTML.escolaridad === null)
    __origSelectHTML.escolaridad = selEscol.innerHTML;
  if (selArea && __origSelectHTML.area === null)
    __origSelectHTML.area = selArea.innerHTML;
}

function __restoreSelect(selectId) {
  const sel = document.getElementById(selectId);
  const html = __origSelectHTML[selectId];
  if (sel && html) sel.innerHTML = html;
}

function __filterSelect(selectId, permitidosSet) {
  const sel = document.getElementById(selectId);
  if (!sel) return;

  // Captura placeholder (value vacío). Si no existe, lo creamos.
  let placeholder = Array.from(sel.options).find((o) => !o.value) || null;
  if (!placeholder) {
    placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "— Seleccionar —";
  }

  const allowedOptions = Array.from(sel.options).filter(
    (opt) => opt.value && permitidosSet.has(String(opt.value)),
  );

  sel.innerHTML = "";
  sel.appendChild(placeholder);
  allowedOptions.forEach((opt) => sel.appendChild(opt));

  // Ajusta valor si el actual no es permitido
  if (!permitidosSet.has(String(sel.value))) {
    sel.value = allowedOptions[0]?.value || "";
  }

  // Si solo hay una opción válida, bloquea el select
  sel.disabled = allowedOptions.length <= 1;

  // Dispara change para que el resto de tu flujo siga igual
  sel.dispatchEvent(new Event("change"));
}
function aplicarRestriccionesUI(userData) {
  __ensureOrigSelectHTML();

  const permisos = userData?.permisos || {};
  const selEscol = document.getElementById("escolaridad");

  if (!selEscol) return;

  // =========================
  // INICIAL: filtra escolaridad permitida (ini_1ro / ini_2do)
  // =========================
  if (Array.isArray(permisos.inicial) && permisos.inicial.length) {
    const permitidos = new Set(permisos.inicial.map(String));

    __restoreSelect("escolaridad");
    __filterSelect("escolaridad", permitidos);

    return;
  }

  // =========================
  // SIN RESTRICCIÓN: restaura todo
  // =========================
  __restoreSelect("escolaridad");
  selEscol.disabled = false;
}

// Exponer para que el guard (Auth) pueda aplicarlo cuando cargue el perfil.
window.aplicarRestriccionesUI = aplicarRestriccionesUI;

async function loadProfile(uid) {
  // v2: perfil en users/{uid}
  const ref = doc(db, "users_pdc", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

//===================================================================================================
async function isAdminUser(uid) {
  try {
    const ref = doc(db, "admins", uid);
    const snap = await getDoc(ref);
    return snap.exists();
  } catch {
    return false;
  }
}

//===================================================================================================

function paintNombreDocente({ user, profile }) {
  const display =
    (profile?.displayName || "").trim() ||
    [profile?.nombre, profile?.apellido].filter(Boolean).join(" ").trim() ||
    (user?.displayName || "").trim() ||
    "Docente";

  const full = `Lic. ${display}`;

  const el1 = document.getElementById("maestro-display");
  if (el1) el1.innerText = full;

  const el2 = document.getElementById("p-maestro");
  if (el2) el2.innerText = full;
}

// ==========================================
// VERSIÓN OPTIMIZADA - auth-guard.js
// ==========================================

onAuthStateChanged(auth, async (user) => {
  // Guard: redirigir si no hay sesión
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  try {
    // 1. Cargar datos del usuario
    currentUser = user;
    currentProfile = await loadProfile(user.uid);

    // 2. Exponer globalmente (considerar usar un objeto namespace)
    window.__PDC_CURRENT_USER__ = currentUser;
    window.__PDC_CURRENT_PROFILE__ = currentProfile;

    // 3. Pintar nombre del docente
    paintNombreDocente({ user: currentUser, profile: currentProfile });

    // 4. Manejar UI de administración (UNA sola llamada a API)
    await setupAdminUI(user.uid);

    // 5. Aplicar restricciones de UI según perfil
    if (typeof window.aplicarRestriccionesUI === "function") {
      window.aplicarRestriccionesUI(currentProfile);
    }
  } catch (error) {
    console.error("Error inicializando sesión:", error);
    // Opcional: mostrar mensaje al usuario
    alert("Error al cargar tu perfil. Por favor, recarga la página.");
  }
});

// ==========================================
// Función separada para lógica de Admin UI
// ==========================================
async function setupAdminUI(uid) {
  const adminLink = document.getElementById("admin-link");
  const adminBtn = document.getElementById("admin-btn");

  // Early return: si no hay elementos admin, no llamar API
  if (!adminLink && !adminBtn) {
    return;
  }

  try {
    // ✅ UNA SOLA llamada a Firebase
    const isAdmin = await isAdminUser(uid);

    // Configurar link de navegación
    if (adminLink) {
      adminLink.style.display = isAdmin ? "inline-block" : "none";
    }

    // Configurar botón de admin
    if (adminBtn) {
      adminBtn.style.display = isAdmin ? "inline-flex" : "none";

      // Solo asignar evento si es admin
      if (isAdmin) {
        adminBtn.onclick = () => {
          window.location.href = "admin.html";
        };
      }
    }
  } catch (error) {
    console.error("Error verificando rol de admin:", error);

    // Por seguridad, ocultar elementos si hay error
    if (adminLink) adminLink.style.display = "none";
    if (adminBtn) adminBtn.style.display = "none";
  }
}

// Logout (si existe el botón)
document.getElementById("btn-logout")?.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

// ===== Helper: token + backend call =====

async function callAI({ prompt, feature, timeoutMs = 30000 }) {
  if (!currentUser)
    throw new Error("Sesión inválida. Vuelve a iniciar sesión.");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  const doFetch = async (token) => {
    return fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ prompt, feature }),
      signal: ctrl.signal,
    });
  };

  try {
    // 1) Token normal (SIN forzar refresh)
    let token = await currentUser.getIdToken();
    let r = await doFetch(token);

    // 2) Si el backend dice 401, refresca token y reintenta 1 vez
    if (r.status === 401) {
      token = await currentUser.getIdToken(true); // refresh SOLO aquí
      r = await doFetch(token);
    }

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(txt || `Error del servidor: ${r.status}`);
    }

    return await r.json();
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new Error("Tiempo de espera agotado. Intenta otra vez.");
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function renderizarPerfilesSalida() {
  renderizarPerfilesSalidaSlot("perfil-salida-container-1", 1);
  renderizarPerfilesSalidaSlot("perfil-salida-container-2", 2);
  renderizarPerfilesSalidaSlot("perfil-salida-container-3", 3);
  renderizarPerfilesSalidaSlot("perfil-salida-container-4", 4);
}

function renderizarPerfilesSalidaSlot(containerId, slot) {
  const cont = document.getElementById(containerId);
  if (!cont) return;

  cont.innerHTML = "";

  const escolaridad = document.getElementById("escolaridad")?.value;
  if (!datosPerfilesIni || !escolaridad) {
    cont.innerHTML =
      "<i>Seleccione el Año de Escolaridad para ver perfiles.</i>";
    return;
  }

  const perfiles = datosPerfilesIni?.[escolaridad] || [];
  if (!Array.isArray(perfiles) || perfiles.length === 0) {
    cont.innerHTML =
      "<i>No hay perfiles configurados para esta escolaridad.</i>";
    perfilIniSeleccionadoKeyBySlot[slot] = null;
    window.__PDC_PERFILES_SALIDA__[slot] = null;
    return;
  }

  // si el seleccionado ya no existe, limpiar
  const selKey = perfilIniSeleccionadoKeyBySlot[slot];
  if (selKey) {
    const existe = perfiles.some(
      (_, i) => __perfilKey({ escolaridad, idxPerfil: i }) === selKey,
    );
    if (!existe) {
      perfilIniSeleccionadoKeyBySlot[slot] = null;
      window.__PDC_PERFILES_SALIDA__[slot] = null;
    }
  }

  perfiles.forEach((p, idxPerfil) => {
    const titulo = String(p?.titulo || `Perfil ${idxPerfil + 1}`).trim();
    const items = Array.isArray(p?.items) ? p.items : [];
    const key = __perfilKey({ escolaridad, idxPerfil });

    const card = document.createElement("div");
    card.className = "tema-item";

    card.innerHTML = `
      <div class="tema-item-texto" style="width:100%;">
        <label style="display:flex; gap:10px; align-items:flex-start; cursor:pointer;">
          <input
            type="checkbox"
            class="check-perfil-titulo"
            data-key="${key}"
            data-titulo="${encodeURIComponent(titulo)}"
          />
          <div style="flex:1;">
            <strong>${titulo}</strong>
            <div class="tema-detalle" style="margin-top:8px;"></div>
          </div>
        </label>
      </div>
    `;

    const detalle = card.querySelector(".tema-detalle");
    if (!detalle) return;

    // --- RENDER ITEMS (checkbox por item) ---
    if (items.length === 0) {
      detalle.innerHTML = "<i>Sin items para este perfil.</i>";
    } else {
      const box = document.createElement("div");
      box.style.display = "grid";
      box.style.gap = "6px";

      items.forEach((it, idxIt) => {
        const txt = String(it || "").trim();
        if (!txt) return;

        const row = document.createElement("label");
        row.style.display = "flex";
        row.style.gap = "10px";
        row.style.alignItems = "flex-start";
        row.style.cursor = "pointer";

        row.innerHTML = `
          <input
            type="checkbox"
            class="check-perfil-item"
            data-key="${key}"
            data-item="${encodeURIComponent(txt)}"
          />
          <span>${txt}</span>
        `;

        box.appendChild(row);
      });

      detalle.appendChild(box);
    }

    const tituloCheck = card.querySelector(".check-perfil-titulo");

    // restaurar selección del título (apartado) por slot
    if (perfilIniSeleccionadoKeyBySlot[slot] === key) {
      tituloCheck.checked = true;

      const saved = window.__PDC_PERFILES_SALIDA__?.[slot];
      const savedItems = Array.isArray(saved?.itemsSeleccionados)
        ? saved.itemsSeleccionados
        : [];

      card.querySelectorAll(".check-perfil-item").forEach((el) => {
        const it = decodeURIComponent(el.dataset.item || "");
        el.checked = savedItems.includes(it);
      });
    }

    // ✅ al marcar el título: solo uno por slot
    tituloCheck.addEventListener("change", (e) => {
      const checked = e.target.checked;

      if (checked) {
        cont.querySelectorAll(".check-perfil-titulo").forEach((other) => {
          if (other !== e.target) other.checked = false;
        });

        cont.querySelectorAll(".check-perfil-item").forEach((otherItem) => {
          if (otherItem.dataset.key !== String(key)) otherItem.checked = false;
        });

        perfilIniSeleccionadoKeyBySlot[slot] = key;
        window.__PDC_PERFILES_SALIDA__[slot] = {
          escolaridad,
          titulo,
          itemsSeleccionados: [],
        };
      } else {
        perfilIniSeleccionadoKeyBySlot[slot] = null;
        window.__PDC_PERFILES_SALIDA__[slot] = null;
        card
          .querySelectorAll(".check-perfil-item")
          .forEach((el) => (el.checked = false));
      }

      // ✅ NUEVO: refrescar preview
      try {
        window.actualizarVistaPreviaPerfilesSalida?.();
      } catch {}
    });

    // ✅ al marcar/desmarcar un item: exige que el título esté marcado
    card.querySelectorAll(".check-perfil-item").forEach((chk) => {
      chk.addEventListener("change", (ev) => {
        if (!tituloCheck.checked) {
          tituloCheck.checked = true;
          tituloCheck.dispatchEvent(new Event("change"));
        }

        // ✅ limitar a máximo 2 items
        const checkedItems = Array.from(
          card.querySelectorAll(".check-perfil-item:checked"),
        );

        if (checkedItems.length > 2) {
          // si intentó marcar un tercero, lo desmarcamos
          ev.target.checked = false;
          alert(
            "Solo puedes seleccionar como máximo 2 perfiles (ítems) en este apartado.",
          );
          return;
        }

        const seleccionados = checkedItems
          .map((el) => decodeURIComponent(el.dataset.item || ""))
          .filter(Boolean);

        perfilIniSeleccionadoKeyBySlot[slot] = key;
        window.__PDC_PERFILES_SALIDA__[slot] = {
          escolaridad,
          titulo,
          itemsSeleccionados: seleccionados,
        };

        try {
          window.actualizarVistaPreviaPerfilesSalida?.();
        } catch {}
      });
    });

    // ✅ IMPORTANTE: recién aquí lo metes al DOM
    cont.appendChild(card);
  });
}

document.getElementById("escolaridad")?.addEventListener("change", () => {
  renderizarPerfilesSalida();
  window.actualizarVistaPreviaPerfilesSalida?.();
});

// =========================
// UI: Modal de límite de uso (plan gratis)
// =========================
function __normalizeErrMessage(err) {
  const raw = String(err?.message || err || "");
  // A veces viene como JSON string desde el servidor
  try {
    const obj = JSON.parse(raw);
    return String(obj?.message || obj?.error?.message || obj?.error || raw);
  } catch {
    return raw;
  }
}

function __isUsageLimitError(err) {
  const msg = __normalizeErrMessage(err).toLowerCase();
  // Ajusta aquí si tu backend devuelve un código específico
  return (
    msg.includes("una vez") ||
    msg.includes("solo una") ||
    msg.includes("límite") ||
    msg.includes("limite") ||
    msg.includes("gratis") ||
    msg.includes("free") ||
    (msg.includes("plan") && msg.includes("agot"))
  );
}

function showUsoGratisModal(customMsg) {
  const modal = document.getElementById("modal-uso-gratis");
  const msgEl = document.getElementById("modal-uso-gratis-msg");
  const closeBtn = document.getElementById("btn-modal-uso-gratis-close");
  if (!modal) return;

  if (msgEl) {
    msgEl.textContent =
      customMsg ||
      "Tu plan gratis permite usar la IA una sola vez. Para seguir generando, solicita habilitación de plan.";
  }

  // abrir
  modal.style.display = "flex";

  const close = () => (modal.style.display = "none");
  closeBtn?.addEventListener("click", close, { once: true });

  // cerrar al click fuera
  modal.addEventListener(
    "click",
    (e) => {
      if (e.target === modal) close();
    },
    { once: true },
  );
}

function notifyAIError(err, fallbackMsg) {
  if (__isUsageLimitError(err)) {
    showUsoGratisModal(__normalizeErrMessage(err));
    return;
  }
  alert(fallbackMsg || "Ocurrió un error al conectar con Gemini.");
}

function convertirULaVinetasWord(html) {
  // Reemplaza cada <ul>...</ul> por párrafos estilo Word (MsoListParagraph)
  return String(html).replace(/<ul[\s\S]*?>[\s\S]*?<\/ul>/gi, (ulBlock) => {
    // Extraer <li>...</li>
    const lis = ulBlock.match(/<li[\s\S]*?>[\s\S]*?<\/li>/gi) || [];
    if (!lis.length) return ulBlock;

    const items = lis.map((li) => {
      // Quitar etiqueta <li> y mantener contenido interno
      const inner = li
        .replace(/^<li[\s\S]*?>/i, "")
        .replace(/<\/li>$/i, "")
        .trim();

      // Párrafo tipo lista Word (bullet)
      return `
<p class="MsoListParagraph" style="margin:0 0 0 0; margin-left:18pt; text-indent:-18pt; mso-list:l0 level1 lfo1;">
  <span style="mso-list:Ignore;font-family:Symbol;">·<span style="font:7.0pt 'Times New Roman';">&nbsp;&nbsp;&nbsp;&nbsp;</span></span>
  ${inner}
</p>`.trim();
    });

    return items.join("\n");
  });
}

function initToggleAdaptaciones() {
  const chk = document.getElementById("chk-adaptaciones");
  const panel = document.getElementById("adaptaciones-panel");
  const preview = document.getElementById("p-hay-adaptaciones"); // opcional

  if (!chk || !panel) return;

  const apply = () => {
    const on = chk.checked;
    panel.style.display = on ? "block" : "none";

    // opcional: reflejar en documento
    if (preview) preview.textContent = on ? "Sí" : "No";

    // opcional PRO: limpiar outputs si se desmarca
    if (!on) {
      const gen = document.getElementById("p-adapt-gen-out");
      if (gen) gen.innerHTML = "";

      const rows = document.getElementById("p-adapt-esp-rows");
      if (rows) rows.innerHTML = "";
    }
  };

  chk.addEventListener("change", apply);
  apply(); // estado inicial
}

document.addEventListener("DOMContentLoaded", () => {
  // ✅ V2: ya no usamos sessionStorage. La sesión se controla con Firebase Auth en el guard superior.
  // Si el guard aún no cargó el perfil, no hacemos nada aquí; el guard se encargará de pintar el nombre y aplicar restricciones.
  // Restricciones por plan (permisos)
  // Nota: se aplican desde el guard al cargar el perfil; aquí re-aplicamos si ya está disponible.
  try {
    if (
      window.__PDC_CURRENT_PROFILE__ &&
      typeof window.aplicarRestriccionesUI === "function"
    ) {
      window.aplicarRestriccionesUI(window.__PDC_CURRENT_PROFILE__);
    }
  } catch (e) {
    console.warn("Restricciones UI (init):", e);
  }

  // Cargar Carga Horaria
  fetch("file_carg/carga_horaria.json")
    .then((res) => res.json())
    .then((data) => {
      datosCargaHoraria = data;
      console.log(
        "Datos de carga horaria listos:",
        datosCargaHoraria.length,
        "áreas cargadas",
      );
      // Forzar actualización si ya hay temas tikeados
      actualizarVistaPreviaTemas();
    });

  // 1. CARGAR EL JSON DE OBJETIVOS
  fetch("file_obj/objetivo_nivel.json")
    .then((response) => {
      if (!response.ok) {
        throw new Error(`No se encontró el archivo (Error ${response.status})`);
      }
      return response.json();
    })
    .then((data) => {
      datosObjetivos = data;
      console.log("✅ Objetivos de nivel cargados con éxito");
      const nivelElement = document.getElementById("nivel");
      if (nivelElement) {
        actualizarObjetivoNivel(nivelElement.value);
      }
    })
    .catch((error) => {
      console.error("❌ Error crítico en objetivo_nivel.json:", error.message);
      const pObj = document.getElementById("p-objetivo");
      if (pObj)
        pObj.innerText =
          "Error: No se pudo cargar el archivo objetivo_nivel.json localmente.";
    });

  // Reemplaza esta función en tu dashboard-logic.js
  const actualizarObjetivoNivel = (idSeleccionado) => {
    if (!idSeleccionado || !datosObjetivos || datosObjetivos.length === 0) {
      const pObj = document.getElementById("p-objetivo");
      if (pObj) pObj.innerText = "Seleccione un nivel...";
      return;
    }

    const encontrado = datosObjetivos.find(
      (item) => String(item.id_nivel).trim() === String(idSeleccionado).trim(),
    );

    if (encontrado) {
      const pObj = document.getElementById("p-objetivo");
      if (pObj) {
        pObj.innerText = encontrado.objetivo_holistico;
        pObj.style.fontFamily = "'Times New Roman', Times, serif";
        pObj.style.fontSize = "9pt";
      }

      const pNivelTitle = document.getElementById("p-nivel-title");
      if (pNivelTitle) pNivelTitle.innerText = encontrado.nivel.toUpperCase();

      const pNivel = document.getElementById("p-nivel");
      const elNivelSelector = document.getElementById("nivel");
      if (pNivel && elNivelSelector) {
        pNivel.innerText =
          elNivelSelector.options[elNivelSelector.selectedIndex].text;
      }

      console.log(
        "✅ Objetivo de nivel cargado correctamente:",
        idSeleccionado,
      );
    } else {
      console.warn("⚠️ No se encontró el objetivo para:", idSeleccionado);
    }
  };

  // 3. ESCUCHAR EL CAMBIO EN EL SELECTOR
  const nivelFijo = document.getElementById("nivel");
  if (nivelFijo) {
    nivelFijo.value = "INI";
    nivelFijo.dispatchEvent(new Event("change"));
  }

  // 2. Navegación de Pestañas
  const btns = document.querySelectorAll(".tab-btn");
  const tabs = document.querySelectorAll(".tab-content");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("active"));
      tabs.forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      const id = btn.id === "btn-tab-1" ? "tab-datos" : "tab-contenido";
      document.getElementById(id).classList.add("active");
    });
  });
  // ✅ Toggle Adaptaciones (checkbox muestra/oculta el panel)
  initToggleAdaptaciones();

  // 3. Sincronización Realtime (Todos los campos)
  const inputs = [
    "num-pdc",
    "distrito",
    "ue",
    "nivel",
    "trimestre",
    "escolaridad",
    "area",
    "director",
    "obj-aprender",
    "cont-s1",
    "cont-s2",
    "cont-s3",
    "cont-s4",
    "cont-s5",
    "ser",
    "saber",
    "hacer",
    "adapt-gen-contenidos",
    "adapt-esp-contenido-1",
    "adapt-esp-condicion-1",
    "adapt-esp-contenido-2",
    "adapt-esp-condicion-2",
  ];

  inputs.forEach((id) => {
    const el = document.getElementById(id);
    const preview = document.getElementById("p-" + id);

    if (el && preview) {
      const evento = el.tagName === "SELECT" ? "change" : "input";

      el.addEventListener(evento, () => {
        if (id === "area" || id === "nivel" || id === "escolaridad") {
          const textoCompleto = el.options[el.selectedIndex].text;
          preview.innerText = textoCompleto;

          const pTitle = document.getElementById("p-area-title");
          if (pTitle) pTitle.innerText = textoCompleto.toUpperCase();
        } else {
          preview.innerText = el.value;
        }
      });
    }
  });

  // 4. Lógica de Calendario y Rango de Semanas
  const fechaInput = document.getElementById("fecha-inicio");
  const duracionInput = document.getElementById("duracion-semanas");

  const actualizarRango = () => {
    if (!fechaInput.value) return;

    let fIni = new Date(fechaInput.value + "T00:00:00");
    let dias = parseInt(duracionInput.value);

    let fFin = new Date(fIni);
    fFin.setDate(fIni.getDate() + dias);

    const opt = { day: "2-digit", month: "long", year: "numeric" };
    document.getElementById("p-fecha-ini").innerText = fIni.toLocaleDateString(
      "es-BO",
      opt,
    );
    document.getElementById("p-fecha-fin").innerText = fFin.toLocaleDateString(
      "es-BO",
      opt,
    );
  };

  fechaInput.addEventListener("change", actualizarRango);
  duracionInput.addEventListener("change", actualizarRango);

  // =========================
  // CONTENIDOS INICIAL (por escolaridad + trimestre)
  // ✅ Seleccionable: PUNTOS CLAVE (puntos[])
  // =========================

  // Mapeo: tu select usa prim_1ro/prim_2do pero tus JSON son ini_primera/ini_segunda
  const __INI_CONTENIDOS_FILE_BY_ESCOLARIDAD__ = {
    ini_1ro: "file_nivel/ini_primera.json",
    ini_2do: "file_nivel/ini_segunda.json",
  };

  // Cache simple
  const __iniJsonCache = new Map();

  function __getTriNum(trimestreFull) {
    if (!trimestreFull) return null;
    if (trimestreFull.includes("Primer")) return 1;
    if (trimestreFull.includes("Segundo")) return 2;
    if (trimestreFull.includes("Tercer")) return 3;
    return null;
  }

  async function __fetchJsonCached(url) {
    if (__iniJsonCache.has(url)) return __iniJsonCache.get(url);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`No se pudo cargar ${url} (${r.status})`);
    const data = await r.json();
    __iniJsonCache.set(url, data);
    return data;
  }

  function __clearCamposUI(msg) {
    ["lista-cosmos", "lista-comunidad", "lista-vida", "lista-ciencia"].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = msg ? `<i>${msg}</i>` : "";
      },
    );
  }

  function __campoToContainerId(campoName) {
    const c = String(campoName || "").toUpperCase();
    if (c.includes("COSMOS")) return "lista-cosmos";
    if (c.includes("COMUNIDAD")) return "lista-comunidad";
    if (c.includes("VIDA")) return "lista-vida";
    if (c.includes("CIENCIA")) return "lista-ciencia";
    return null;
  }

  // ✅ Renderiza un CAMPO -> TÍTULOS -> CHECK por PUNTO
  function __renderCampoConPuntos(
    container,
    campoObj,
    escolaridad,
    trimestreNum,
  ) {
    const campoLabel = campoObj?.campo || "Campo";
    const titulos = Array.isArray(campoObj?.titulos) ? campoObj.titulos : [];

    // Encabezado del campo
    const header = document.createElement("div");
    header.className = "tema-header"; // nuevo: solo texto
    header.innerHTML = `<strong>${campoLabel}</strong>`;
    container.appendChild(header);

    if (titulos.length === 0) {
      const empty = document.createElement("div");
      empty.innerHTML = `<i>No hay títulos configurados para este campo.</i>`;
      container.appendChild(empty);
      return;
    }

    titulos.forEach((t, idxTitulo) => {
      const titulo = t?.titulo || `Título ${idxTitulo + 1}`;
      const puntos = Array.isArray(t?.puntos) ? t.puntos : [];

      // Subtítulo del título
      const sub = document.createElement("div");
      sub.className = "tema-subtitulo"; // nuevo: solo texto
      sub.textContent = titulo;
      container.appendChild(sub);

      if (puntos.length === 0) {
        const emptyPts = document.createElement("div");
        emptyPts.innerHTML = `<i>Sin puntos clave en este título.</i>`;
        container.appendChild(emptyPts);
        return;
      }

      puntos.forEach((puntoOriginal, idxPunto) => {
        const punto = String(puntoOriginal || "").trim();
        if (!punto) return;

        const id = `chk-${escolaridad}-t${trimestreNum}-${campoObj?.id || "campo"}-${idxTitulo}-${idxPunto}`;

        const div = document.createElement("div");
        div.className = "tema-item";

        div.innerHTML = `
    <label>
      <input
        type="checkbox"
        class="check-punto"
        id="${id}"
        data-campo="${encodeURIComponent(campoLabel)}"
        data-titulo="${encodeURIComponent(titulo)}"
        data-punto="${encodeURIComponent(punto)}"
      />
      <div class="tema-item-texto">
        <span class="tema-detalle">${punto}</span>
      </div>
    </label>
  `;

        div.querySelector("input").addEventListener("change", () => {
          const seleccion = Array.from(
            document.querySelectorAll(".check-punto:checked"),
          ).map((el) => ({
            campo: decodeURIComponent(el.dataset.campo || ""),
            titulo: decodeURIComponent(el.dataset.titulo || ""),
            punto: decodeURIComponent(el.dataset.punto || ""),
          }));

          window.__PDC_PUNTOS_SELECCIONADOS__ = seleccion;

          if (typeof window.actualizarVistaPreviaTemas === "function") {
            window.actualizarVistaPreviaTemas();
          }
        });

        container.appendChild(div);
      });
    });
  }

  async function cargarContenidosSugeridos() {
    const escolaridad = document.getElementById("escolaridad")?.value || "";
    const trimestreFull = document.getElementById("trimestre")?.value || "";
    const trimestreNum = __getTriNum(trimestreFull);

    if (!escolaridad || !trimestreNum) {
      __clearCamposUI(
        "Selecciona Año de escolaridad y Trimestre para ver contenidos.",
      );
      return;
    }

    const url = __INI_CONTENIDOS_FILE_BY_ESCOLARIDAD__[escolaridad];
    if (!url) {
      __clearCamposUI("No hay archivo JSON asociado a esta escolaridad.");
      return;
    }

    try {
      __clearCamposUI("Cargando contenidos...");
      const data = await __fetchJsonCached(url);

      const tri = (data?.trimestres || []).find(
        (t) => Number(t.trimestre) === Number(trimestreNum),
      );
      const campos = Array.isArray(tri?.campos) ? tri.campos : [];

      __clearCamposUI("");

      if (campos.length === 0) {
        __clearCamposUI("No hay campos configurados para este trimestre.");
        return;
      }

      campos.forEach((campoObj) => {
        const containerId = __campoToContainerId(campoObj?.campo);
        if (!containerId) return;
        const container = document.getElementById(containerId);
        if (!container) return;

        __renderCampoConPuntos(container, campoObj, escolaridad, trimestreNum);
      });
    } catch (err) {
      console.error("Error al cargar contenidos INI:", err);
      __clearCamposUI("Error: no se pudo cargar el JSON de contenidos.");
    }
  }

  // Listeners: SOLO escolaridad + trimestre
  document
    .getElementById("escolaridad")
    ?.addEventListener("change", cargarContenidosSugeridos);
  document
    .getElementById("trimestre")
    ?.addEventListener("change", cargarContenidosSugeridos);

  // Estado inicial
  cargarContenidosSugeridos();
  // =========================
  // VISTA PREVIA: CAMPOS -> TÍTULOS (siempre) + PUNTOS (solo seleccionados)
  // - Se alimenta de window.__PDC_PUNTOS_SELECCIONADOS__
  // - Pinta en la columna "CAMPOS Y SUS ÁREAS DE SABERES Y CONOCIMIENTOS"
  // =========================

  function __normalizarCampoKey(campo) {
    const c = String(campo || "").toUpperCase();
    if (c.includes("COSMOS")) return "COSMOS";
    if (c.includes("COMUNIDAD")) return "COMUNIDAD";
    if (c.includes("VIDA")) return "VIDA";
    if (c.includes("CIENCIA")) return "CIENCIA";
    return "OTRO";
  }

  function __getPreviewCellCampos() {
    // 1) Si existe un contenedor explícito, úsalo
    const explicit =
      document.getElementById("p-campos-areas") ||
      document.getElementById("p-campos-saberes") ||
      document.getElementById("p-campos") ||
      document.getElementById("p-camposyareas");
    if (explicit) return explicit;

    // 2) Fallback: ubicar la celda debajo del encabezado "CAMPOS Y SUS ÁREAS..."
    const spans = Array.from(document.querySelectorAll("span"));
    const headerSpan = spans.find((s) =>
      (s.textContent || "").includes(
        "CAMPOS Y SUS ÁREAS DE SABERES Y CONOCIMIENTOS",
      ),
    );
    const table = headerSpan?.closest("table");
    if (!table) return null;

    const rows = Array.from(table.querySelectorAll("tr"));
    const headerRowIndex = rows.findIndex((r) => r.contains(headerSpan));
    if (headerRowIndex < 0) return null;

    // Normalmente el contenido está en la fila siguiente
    const nextRow = rows[headerRowIndex + 1];
    if (!nextRow) return null;

    const td =
      nextRow.querySelector('td[rowspan="2"]') || nextRow.querySelector("td");
    if (!td) return null;

    // Creamos un contenedor interno para no romper estilos Word
    let inner = td.querySelector("#p-campos-areas");
    if (!inner) {
      inner = document.createElement("div");
      inner.id = "p-campos-areas";
      inner.style.fontSize = "10pt";
      inner.style.lineHeight = "1.25";
      td.innerHTML = "";
      td.appendChild(inner);
    }
    return inner;
  }

  function actualizarVistaPreviaTemas() {
    const destino = __getPreviewCellCampos();
    if (!destino) return;

    const seleccion = Array.isArray(window.__PDC_PUNTOS_SELECCIONADOS__)
      ? window.__PDC_PUNTOS_SELECCIONADOS__
      : [];

    // Agrupar: campo -> titulo -> puntos[]
    const grupos = {
      COSMOS: new Map(),
      COMUNIDAD: new Map(),
      VIDA: new Map(),
      CIENCIA: new Map(),
    };

    seleccion.forEach((it) => {
      const campoKey = __normalizarCampoKey(it?.campo);
      if (!grupos[campoKey]) return;

      const titulo = String(it?.titulo || "").trim() || "(Sin título)";
      const punto = String(it?.punto || "").trim();

      if (!grupos[campoKey].has(titulo))
        grupos[campoKey].set(titulo, new Set());
      if (punto) grupos[campoKey].get(titulo).add(punto);
    });

    const orden = [
      ["COSMOS", "COSMOS Y PENSAMIENTO"],
      ["COMUNIDAD", "COMUNIDAD Y SOCIEDAD"],
      ["VIDA", "VIDA TIERRA Y TERRITORIO"],
      ["CIENCIA", "CIENCIA, TECNOLOGÍA Y PRODUCCIÓN"],
    ];

    const html = orden
      .map(([key, label]) => {
        const titulosMap = grupos[key];

        // Siempre mostrar el campo (aunque no tenga selección)
        if (!titulosMap || titulosMap.size === 0) {
          return `
            <div style="margin-bottom:6px;">
              <div><b>${label}</b></div>
              <div style="font-style:italic;">(Sin puntos seleccionados)</div>
            </div>
          `;
        }

        const bloquesTitulos = Array.from(titulosMap.entries())
          .map(([titulo, setPuntos]) => {
            const puntos = Array.from(setPuntos.values());

            // ✅ REQUISITO: el TÍTULO se ve siempre si hay selección en ese campo
            // ✅ Los PUNTOS: solo los seleccionados (checkbox)
            const puntosHtml =
              puntos.length > 0
                ? puntos
                    .map((p) => {
                      const txt = escapeHtml(p);
                      return `<p class="MsoListParagraph" style="margin:0cm 0cm 2pt 18pt; text-align:justify;">
  <span style="font-size:10pt;color:black">•&nbsp;</span><span style="font-size:10pt;color:black">${txt}</span>
</p>`;
                    })
                    .join("")
                : `<p class="MsoNormal" style="margin:2pt 0 0 0; font-style:italic;">
  <span style="font-size:10pt;color:black">(Sin puntos seleccionados)</span>
</p>`;

            return `
              <p class="MsoNormal" style="margin:4pt 0 0 0;">
                <b><span style="font-size:10pt;color:black">${escapeHtml(
                  titulo,
                )}</span></b>
              </p>
              ${puntosHtml}
            `;
          })
          .join("");

        return `
          <p class="MsoNormal" style="margin:6pt 0 0 0;">
            <b><span style="font-size:10pt;color:black">${escapeHtml(
              label,
            )}</span></b>
          </p>
          ${bloquesTitulos}
        `;
      })
      .join("");

    destino.innerHTML = html;
  }

  // Exponer para uso desde los checks
  window.actualizarVistaPreviaTemas = actualizarVistaPreviaTemas;

  function __getPreviewCellPerfilesSalida() {
    // 1) Si existe un contenedor explícito, úsalo
    const explicit =
      document.getElementById("p-perfiles-salida") ||
      document.getElementById("p-perfil-salida") ||
      document.getElementById("p-perfiles");
    if (explicit) return explicit;

    // 2) Fallback: ubicar la celda debajo del encabezado "PERFILES DE SALIDA..."
    const spans = Array.from(document.querySelectorAll("span"));
    const headerSpan = spans.find((s) =>
      (s.textContent || "").includes(
        "PERFILES DE SALIDA EN RELACIÓN CON LOS CAMPOS Y LAS ÁREAS DE SABERES Y CONOCIMIENTOS",
      ),
    );

    const table = headerSpan?.closest("table");
    if (!table) return null;

    const rows = Array.from(table.querySelectorAll("tr"));
    const headerRowIndex = rows.findIndex((r) => r.contains(headerSpan));
    if (headerRowIndex < 0) return null;

    // Normalmente el contenido está en la fila siguiente
    const nextRow = rows[headerRowIndex + 1];
    if (!nextRow) return null;

    // En esa fila, la col 2 (Perfiles) es un td rowspan="2"
    const tds = Array.from(nextRow.querySelectorAll("td"));
    const tdPerfiles = tds.find((td) => td.getAttribute("rowspan") === "2")
      ? tds[1]
      : tds[1];
    if (!tdPerfiles) return null;

    // Creamos un contenedor interno para no romper estilos Word
    let inner = tdPerfiles.querySelector("#p-perfiles-salida");
    if (!inner) {
      inner = document.createElement("div");
      inner.id = "p-perfiles-salida";
      inner.style.fontSize = "10pt";
      inner.style.lineHeight = "1.25";
      tdPerfiles.innerHTML = "";
      tdPerfiles.appendChild(inner);
    }
    return inner;
  }

  function actualizarVistaPreviaPerfilesSalida() {
    const destino = __getPreviewCellPerfilesSalida();
    if (!destino) return;

    const sel = window.__PDC_PERFILES_SALIDA__ || {};

    // ✅ SOLO tomar slots que realmente tengan un perfil elegido (titulo)
    const elegidos = [1, 2, 3, 4]
      .map((slot) => ({ slot, data: sel[slot] }))
      .filter(({ data }) => data && String(data.titulo || "").trim());

    // ✅ Si no hay nada elegido, NO escribas “COSMOS/COMUNIDAD/VIDA/CIENCIA”
    if (elegidos.length === 0) {
      destino.innerHTML = ""; // o "&nbsp;" si quieres conservar altura
      return;
    }

    // Render: solo el título + ítems seleccionados (sin “COSMOS/COMUNIDAD/...”)
    const html = elegidos
      .map(({ data }) => {
        const titulo = escapeHtml(String(data.titulo || "").trim());

        const items = Array.isArray(data.itemsSeleccionados)
          ? data.itemsSeleccionados
          : [];

        const itemsHtml = items
          .map((it) => {
            const txt = escapeHtml(String(it || "").trim());
            if (!txt) return "";
            return `<p class="MsoListParagraph" style="margin:0cm 0cm 2pt 18pt; text-align:justify;">
  <span style="font-size:10pt;color:black">•&nbsp;</span><span style="font-size:10pt;color:black">${txt}</span>
</p>`;
          })
          .join("");

        // ✅ Si no marcó ítems, al menos que se vea el título (como pediste)
        return `
        <div style="margin-bottom:8px;">
          <div style="margin:2pt 0 4pt 0;"><b>${titulo}</b></div>
          ${itemsHtml || `<div style="font-style:italic;">(Sin puntos seleccionados)</div>`}
        </div>
      `;
      })
      .join("");

    destino.innerHTML = html;
  }

  // ✅ opcional (recomendado): exponerla para llamarla seguro desde listeners
  window.actualizarVistaPreviaPerfilesSalida =
    actualizarVistaPreviaPerfilesSalida;

  // =========================
  // CHECKBOXES dinámicos según los contenidos seleccionados
  // - Se renderizan en #checks-contenidos-seleccionados
  // - Sirven para elegir a qué filas aplicar Momentos/Recursos
  // =========================

  const nombresCursos = {
    prim_1ro: "Primero de Primaria",
    prim_2do: "Segundo de Primaria",
    prim_3ro: "Tercero de Primaria",
    prim_4to: "Cuarto de Primaria",
    prim_5to: "Quinto de Primaria",
    prim_6to: "Sexto de Primaria",
    sec_1ro: "Primero de Secundaria",
    sec_2do: "Segundo de Secundaria",
    sec_3ro: "Tercero de Secundaria",
    sec_4to: "Cuarto de Secundaria",
    sec_5to: "Quinto de Secundaria",
    sec_6to: "Sexto de Secundaria",
  };

  document.getElementById("escolaridad").addEventListener("change", (e) => {
    const valorSeleccionado = e.target.value;
    const nombreLegible = nombresCursos[valorSeleccionado] || valorSeleccionado;

    document.getElementById("p-escolaridad").innerText = nombreLegible;

    cargarContenidosSugeridos();
  });

  function limpiarFormulario() {
    if (confirm("¿Estás seguro de limpiar todos los datos del PDC?")) {
      document.getElementById("pdc-form").reset();
      location.reload();
    }
  }

  // Necesario porque el HTML usa onclick="limpiarFormulario()"
  window.limpiarFormulario = limpiarFormulario;

  window.descargarWord = function () {
    console.log("Iniciando descarga...");

    const hoja = document.getElementById("hoja-carta");
    if (!hoja) {
      alert("Error: No se encontró la hoja de contenido.");
      return;
    }
    let contenidoHTML = hoja.innerHTML;

    // 🔥 Convertir UL/LI a viñetas Word para que SIEMPRE se vean en el .doc
    contenidoHTML = convertirULaVinetasWord(contenidoHTML);

    const estilos = `
<style>
@page Section1 {
    size: 792pt 612pt;
    mso-page-orientation: landscape;
    margin: 1.0in 1.0in 1.0in 1.0in;
}

div.Section1 { page: Section1; }

table {
    border-collapse: collapse;
    width: 100%;
    table-layout: fixed;
}

td, th {
    border: 1px solid black;
    padding: 5px;
    font-family: Times New Roman;
    font-size: 10pt;
    word-wrap: break-word;
}

.section-title {
    background-color: #eeeeee;
    text-align: center;
    font-weight: bold;
}

/* 🔥 DEFINICIÓN DE LISTAS WORD (CLAVE) */
@list l0 { mso-list-id:1; mso-list-type:hybrid; }

@list l0:level1 {
  mso-level-number-format:bullet;
  mso-level-text:"·";
  mso-level-tab-stop:18pt;
  mso-level-number-position:left;
  margin-left:18pt;
  text-indent:-18pt;
  font-family:Symbol;
}

.MsoListParagraph { mso-style-priority:34; }

/* respaldo CSS normal */
ul { margin: 0; padding-left: 18pt; list-style-type: disc; }
li { margin-bottom: 2pt; }

</style>
`;

    const contenidoCompleto = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office'
              xmlns:w='urn:schemas-microsoft-com:office:word'
              xmlns='http://www.w3.org/TR/REC-html40'>
        <head><meta charset='utf-8'>${estilos}</head>
        <body><div class="Section1">${contenidoHTML}</div></body>
        </html>
    `;

    try {
      const blob = new Blob(["\ufeff" + contenidoCompleto], {
        type: "application/msword",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "PDC_Generado_2026.doc";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      console.log("Descarga completada");
    } catch (e) {
      console.error("Error en la descarga:", e);
    }
  };

  fetch("file_carg/perfiles_ini.json")
    .then((r) => r.json())
    .then((data) => {
      // ✅ ADAPTADOR: tu JSON nuevo -> formato viejo esperado
      datosPerfilesIni = normalizarPerfilesSalida(data);
      renderizarPerfilesSalida();
      window.actualizarVistaPreviaPerfilesSalida?.();
    })
    .catch((e) => {
      console.error("Error cargando perfiles_ini.json:", e);
      const box = document.getElementById("perfil-salida-container");
      if (box) box.innerHTML = "<i>No se pudo cargar perfiles de salida.</i>";
    });

  function normalizarPerfilesSalida(data) {
    // Caso A: ya está en el formato antiguo
    if (
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      !data.perfil_salida
    ) {
      return data;
    }

    // Caso B: viene con { perfil_salida: [...] }
    const arr = Array.isArray(data?.perfil_salida) ? data.perfil_salida : [];

    // Mapear tu “nivel_escolaridad” a los values reales del select HTML
    const mapNivelToKey = {
      "Inicial Primero": "ini_1ro",
      "Inicial Segundo": "ini_2do",
    };

    const out = {};

    for (const bloque of arr) {
      const key = mapNivelToKey[String(bloque?.nivel_escolaridad || "").trim()];
      if (!key) continue;

      const apartados = Array.isArray(bloque?.apartados)
        ? bloque.apartados
        : [];
      // cada apartado se convierte en un "perfil"
      out[key] = apartados.map((a) => ({
        titulo: String(a?.titulo || "").trim(),
        items: Array.isArray(a?.items) ? a.items : [],
      }));
    }

    return out;
  }

  // =========================
  // BOTONES (modo pro): sin onclick en HTML
  // =========================
  const __wireButtons = () => {
    const bind = (id, fn) => {
      const el = document.getElementById(id);
      if (!el || typeof fn !== "function") return;
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // evita doble click mientras está disabled
        if (el.disabled) return;
        fn();
      });
    };

    bind("btn-elaborar", elaborarPDCConAI);
    bind("btn-pdc-completo", elaborarPDCCompletoConAI);
    // Momentos + Recursos por campo
    bind("btn-momrec-cosmos", generarMomRecCosmos);
    bind("btn-momrec-comunidad", generarMomRecComunidad);
    bind("btn-momrec-vida", generarMomRecVida);
    bind("btn-momrec-ciencia", generarMomRecCiencia);
    bind("btn-crit", generarRecYCritConIA);
    bind("btn-adapt-gen", generarAdaptacionesGeneralesConIA);
    bind("btn-adapt-esp", generarAdaptacionesEspecificasConIA);
  };

  function addAdaptStudentBlock() {
    const list = document.getElementById("adapt-esp-list");
    if (!list) return;

    const next = (getAdaptStudentIndices().slice(-1)[0] || 0) + 1;

    const wrap = document.createElement("div");
    wrap.className = "input-group";
    wrap.innerHTML = `
    <label>ESTUDIANTE ${next}</label>
    <label>Contenido a desarrollar (Adaptaciones Específicas)</label>
    <textarea id="adapt-esp-contenido-${next}" placeholder="Ingrese el contenido a desarrollar" style="min-height:30px"></textarea>

    <label style="margin-top:8px;">Talento extraordinario / discapacidad / dificultades</label>
    <textarea id="adapt-esp-condicion-${next}" placeholder="Ej: TEA, dislexia, talento extraordinario.." style="min-height:30px"></textarea>
  `;
    list.appendChild(wrap);
  }

  document
    .getElementById("btn-add-adapt-estudiante")
    ?.addEventListener("click", addAdaptStudentBlock);

  __wireButtons();
});

// =========================
// 1. FUNCIÓN PRINCIPAL (onclick)
// =========================
async function elaborarPDCConAI() {
  const btn = document.getElementById("btn-elaborar");
  if (!btn) return;

  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando...';
  btn.disabled = true;

  try {
    await generarObjetivoConIA();
    //alert("¡Objetivo generado correctamente!");
  } catch (error) {
    console.error("Error en el proceso:", error);
    notifyAIError(error, "Hubo un fallo al conectar con Gemini.");
  } finally {
    btn.innerHTML = "✨ Volver a Elaborar Objetivo";
    btn.disabled = false;
  }
}

// =========================
// 1.1 ELABORAR PDC COMPLETO (Objetivo + Momentos/Recursos + Criterios)
// - Usa los mismos datos de entrada del primer botón (Idea + selección de contenidos)
// =========================
async function elaborarPDCCompletoConAI() {
  const btn = document.getElementById("btn-pdc-completo");
  if (!btn) return;

  const seleccionados = Array.isArray(window.__PDC_PUNTOS_SELECCIONADOS__)
    ? window.__PDC_PUNTOS_SELECCIONADOS__
    : [];

  if (!seleccionados.length) {
    alert("Selecciona al menos un contenido.");
    return;
  }

  const original = btn.innerHTML;
  btn.innerHTML =
    '<i class="fas fa-spinner fa-spin"></i> Generando PDC completo...';
  btn.disabled = true;

  // Guardar ideas actuales (por si el usuario ya escribió algo)
  const ideaObjEl = document.getElementById("idea-objetivo");
  const ideaMomEl = document.getElementById("idea-momentos");
  const ideaCritEl = document.getElementById("idea-criterios");

  const ideaBase = ideaObjEl?.value?.trim() || "";

  const prevMom = ideaMomEl?.value ?? "";
  const prevCrit = ideaCritEl?.value ?? "";

  try {
    // 1) Objetivo (usa idea-objetivo)
    await generarObjetivoConIA();

    // 2) Momentos + Recursos (reusa la idea del objetivo para mantener coherencia)
    if (ideaMomEl) ideaMomEl.value = ideaBase;
    await generarMomentosConIA();

    // 3) Criterios (reusa la idea del objetivo para mantener coherencia)
    if (ideaCritEl) ideaCritEl.value = ideaBase;
    const indices = indicesSeleccionadosMomentos();
    await generarRecYCritConIA(indices);

    // Listo
    // alert("✅ PDC completo generado.");
  } catch (err) {
    console.error("Error en PDC completo:", err);
    notifyAIError(
      err,
      "No se pudo elaborar el PDC completo. Revisa la consola.",
    );
  } finally {
    // Restaurar textos previos
    if (ideaMomEl) ideaMomEl.value = prevMom;
    if (ideaCritEl) ideaCritEl.value = prevCrit;

    btn.innerHTML = original;
    btn.disabled = false;
  }
}

// =========================
// 2. GENERAR OBJETIVO (Gemini vía Cloud Function + Firestore gate)
// =========================
const generarObjetivoConIA = async () => {
  const nivelText =
    document.getElementById("nivel")?.options[
      document.getElementById("nivel").selectedIndex
    ]?.text || "";

  const escolaridadText =
    document.getElementById("escolaridad")?.options[
      document.getElementById("escolaridad").selectedIndex
    ]?.text || "";

  const areaText =
    document.getElementById("area")?.options[
      document.getElementById("area").selectedIndex
    ]?.text || "";

  const objNivelRef = document.getElementById("p-objetivo")?.innerText || "";

  const ideaUsuario =
    document.getElementById("idea-objetivo")?.value?.trim() || "";

  const campoDestino = document.getElementById("p-obj-aprender");
  const seleccionados = Array.isArray(window.__PDC_PUNTOS_SELECCIONADOS__)
    ? window.__PDC_PUNTOS_SELECCIONADOS__
    : [];

  if (!seleccionados.length) return;

  if (!campoDestino || seleccionados.length === 0) return;

  const listaContenidos = __formatContenidosPorCampo(seleccionados);

  const perfilSel = window.__PDC_PERFILES_SALIDA__ || "";

  const promptTexto = `Eres docente experto en Planificación de Desarrollo Curricular del Subsistema de Educación Regular de Bolivia.
Redacta UN Objetivo de Aprendizaje coherente con el Objetivo Holístico del Nivel y los contenidos del mes.
Debe:
• Estar en modo indicativo, ser claro, evaluable y sin mencionar productos finales ni perfil de salida.
• Integrar: ¿qué hace?, ¿qué aprende?, ¿cómo aprende? y ¿para qué aprende?
• Ajustarse al nivel y enfoque intracultural, intercultural y plurilingüe.
• Tener máximo 2–3 líneas en un solo párrafo.
• Integrar implícitamente SER, SABER y HACER.
Datos:
Nivel: ${nivelText}
Año: ${escolaridadText}
Área: ${areaText}
Contenidos: ${listaContenidos}
Objetivo Holístico: ${objNivelRef}
Perfil de salida (nose mensiona): ${perfilSel || "(no seleccionado)"}
Idea docente: ${ideaUsuario || "(sin idea adicional)"}
Entrega solo el objetivo final, sin títulos ni explicaciones.`;

  setTyping(campoDestino, "✨ Generando");

  try {
    const feature = __pdcCompletoMode ? "pdcCompleto" : "objetivo";
    const data = await callAI({ prompt: promptTexto, feature });
    console.log("Respuesta IA:", data);

    const out = String(data?.text ?? data?.texto ?? "").trim();
    campoDestino.innerText = out || "(sin texto devuelto)";

    campoDestino.style.fontFamily = "'Times New Roman', Times, serif";
    campoDestino.style.fontSize = "9pt";
    campoDestino.style.fontWeight = "normal";
  } catch (error) {
    console.error("Error en la petición:", error);
    campoDestino.innerText = "Error al generar el objetivo.";
    throw error;
  }
};

async function generarAdaptacionesGeneralesConIA() {
  const btn = document.getElementById("btn-adapt-gen");
  if (!btn) return;

  const contenidos =
    document.getElementById("adapt-gen-contenidos")?.value?.trim() || "";
  const destino = document.getElementById("p-adapt-gen-out");
  if (!destino) return;

  if (!contenidos) {
    alert("Ingresa Contenidos para generar Adaptaciones Generales.");
    return;
  }

  const original = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando...';
  btn.disabled = true;

  try {
    setTyping(destino, "✨ Generando adaptaciones generales");

    const prompt = `Actúa como docente experto en inclusión educativa y PDC de Bolivia.

Genera ADAPTACIONES CURRICULARES GENERALES basadas en estos contenidos/idea del Maestro:
${contenidos}

Requisitos estrictos:
1) Devuelve SOLO un JSON válido (sin texto adicional) con esta estructura:
{ "adaptaciones_generales": ["...","..."] }
2) "adaptaciones_generales" debe tener ENTRE 1 y 2 viñetas.
3) Cada viñeta debe ser concreta y breve (máx 10 palabras).`;

    const texto = await llamarGeminiTexto(prompt);

    let parsed = null;
    try {
      parsed = JSON.parse(texto);
    } catch {
      const m = String(texto).match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          parsed = null;
        }
      }
    }

    const arr = Array.isArray(parsed?.adaptaciones_generales)
      ? parsed.adaptaciones_generales
      : [];
    destino.innerHTML = renderListaBullets(arr.slice(0, 4));
  } catch (err) {
    console.error("Error generando adaptaciones generales:", err);
    destino.innerText = "Error al generar adaptaciones generales.";
    notifyAIError(err, "No se pudo generar Adaptaciones Generales.");
  } finally {
    btn.innerHTML = original;
    btn.disabled = false;
  }
}

function getAdaptStudentIndices() {
  // Detecta todos los adapt-esp-contenido-N existentes
  const nodes = Array.from(
    document.querySelectorAll('[id^="adapt-esp-contenido-"]'),
  );
  const idx = nodes
    .map((el) => Number(String(el.id).split("-").pop()))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  return idx;
}

function renderSignificantAdaptRows(results) {
  const tbody = document.getElementById("p-adapt-esp-rows");
  if (!tbody) return;

  if (!Array.isArray(results) || results.length === 0) {
    tbody.innerHTML = "";
    return;
  }

  tbody.innerHTML = results
    .map((r) => {
      const contenidoTxt = escapeHtml(r?.contenido || "");
      const condicionTxt = escapeHtml(r?.condicion || "");

      return `
<tr>
  <!-- 1) CONTENIDOS -->
  <td style="border-top:none; border-left: solid windowtext 1pt; border-bottom: solid windowtext 1pt; border-right: solid windowtext 1pt; padding: 0cm 5.4pt; vertical-align: top;">
    <p class="MsoNormal" style="margin:0;">
      <span style="font-size:9pt;">${contenidoTxt}</span>
    </p>
  </td>

  <!-- 2) CONDICIÓN -->
  <td style="border-top:none; border-left:none; border-bottom: solid windowtext 1pt; border-right: solid windowtext 1pt; padding: 0cm 5.4pt; vertical-align: top;">
    <p class="MsoNormal" style="margin:0;">
      <span style="font-size:9pt;">${condicionTxt}</span>
    </p>
  </td>

  <!-- 3) ADAPTACIÓN -->
  <td style="border-top:none; border-left:none; border-bottom: solid windowtext 1pt; border-right: solid windowtext 1pt; padding: 0cm 5.4pt; vertical-align: top;">
    ${r.adaptacionHTML || ""}
  </td>

  <!-- 4) CRITERIOS -->
  <td style="border-top:none; border-left:none; border-bottom: solid windowtext 1pt; border-right: solid windowtext 1pt; padding: 0cm 5.4pt; vertical-align: top;">
    <p class="MsoNormal" style="margin:0;"><b><span style="font-size:9pt;">SER</span></b></p>
    ${r.serHTML || ""}

    <p class="MsoNormal" style="margin:0;"><b><span style="font-size:9pt;">SABER</span></b></p>
    ${r.saberHTML || ""}

    <p class="MsoNormal" style="margin:0;"><b><span style="font-size:9pt;">HACER</span></b></p>
    ${r.hacerHTML || ""}
  </td>
</tr>`.trim();
    })
    .join("\n");
}

function showTypingInAdaptEspTable(label = "✨ Generando") {
  const tbody = document.getElementById("p-adapt-esp-rows");
  if (!tbody) return null;

  // fila "loading" con 4 columnas
  tbody.innerHTML = `
    <tr>
      <td colspan="4" id="p-adapt-esp-loading"
          style="border: solid windowtext 1pt; padding: 6px 8px; vertical-align: top;">
      </td>
    </tr>
  `;

  const cell = document.getElementById("p-adapt-esp-loading");
  setTyping(cell, label);
  return cell;
}

async function generarAdaptacionesEspecificasConIA() {
  const btn = document.getElementById("btn-adapt-esp");
  if (!btn) return;

  const indices = getAdaptStudentIndices(); // dinámico: 1..N
  const filasValidas = indices.filter((n) => {
    const contenido =
      document.getElementById(`adapt-esp-contenido-${n}`)?.value?.trim() || "";
    const condicion =
      document.getElementById(`adapt-esp-condicion-${n}`)?.value?.trim() || "";
    return !!(contenido && condicion);
  });

  if (!filasValidas.length) {
    alert(
      "Completa el Contenido a desarrollar y la Condición (discapacidad/talento/dificultad) en al menos un estudiante.",
    );
    return;
  }

  const original = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando...';
  btn.disabled = true;

  try {
    // ✅ typing animado en la tabla (fila temporal con colspan=4)
    showTypingInAdaptEspTable("✨ Generando adaptaciones específicas");

    const results = [];

    for (const n of filasValidas) {
      const contenido =
        document.getElementById(`adapt-esp-contenido-${n}`)?.value?.trim() ||
        "";
      const condicion =
        document.getElementById(`adapt-esp-condicion-${n}`)?.value?.trim() ||
        "";

      const prompt = `Actúa como docente experto en inclusión educativa y adecuaciones curriculares (PDC Bolivia).
Datos:
- Contenido a desarrollar: ${contenido}
- Condición o discapacidad: ${condicion}
Tareas:
A) Genera ADAPTACIONES ESPECÍFICAS para el contenido según la condición.
B) Genera CRITERIOS DE EVALUACIÓN SOLO en SER, SABER y HACER (NO incluir DECIDIR).
Requisitos estrictos:
1) Devuelve SOLO un JSON válido con esta estructura:
{
  "adaptacion": ["...","..."],
  "criterios": {
    "ser": ["...","..."],
    "saber": ["...","..."],
    "hacer": ["...","..."]
  }
}
2) "adaptacion" entre 1 y 2 viñetas.
3) Cada dimensión (ser/saber/hacer) entre 1 y 2 viñetas.
4) Viñetas breves, observables y evaluables (máx 10 palabras).`;

      const texto = await llamarGeminiTexto(prompt);

      let parsed = null;
      try {
        parsed = JSON.parse(texto);
      } catch {
        const m = String(texto).match(/\{[\s\S]*\}/);
        if (m) {
          try {
            parsed = JSON.parse(m[0]);
          } catch {
            parsed = null;
          }
        }
      }

      const ada = Array.isArray(parsed?.adaptacion) ? parsed.adaptacion : [];
      const ser = Array.isArray(parsed?.criterios?.ser)
        ? parsed.criterios.ser
        : [];
      const saber = Array.isArray(parsed?.criterios?.saber)
        ? parsed.criterios.saber
        : [];
      const hacer = Array.isArray(parsed?.criterios?.hacer)
        ? parsed.criterios.hacer
        : [];

      results.push({
        n,
        contenido,
        condicion,
        adaptacionHTML: renderListaBullets(ada.slice(0, 4)),
        serHTML: renderListaBullets(ser.slice(0, 4)),
        saberHTML: renderListaBullets(saber.slice(0, 4)),
        hacerHTML: renderListaBullets(hacer.slice(0, 4)),
      });
    }

    // ✅ reemplaza el "loading" por la tabla final
    renderSignificantAdaptRows(results);
  } catch (err) {
    console.error("Error generando adaptaciones específicas:", err);
    notifyAIError(err, "No se pudo generar Adaptaciones Específicas.");
    renderSignificantAdaptRows([]);
  } finally {
    btn.innerHTML = original;
    btn.disabled = false;
  }
}

// =========================
// 3. HELPERS IA (reutilizable)
// =========================
function __slug(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function __perfilKey({ escolaridad, idxPerfil }) {
  return `ini-${escolaridad}-p${idxPerfil}`;
}

async function llamarGeminiTexto(prompt) {
  const feature = __pdcCompletoMode ? "pdcCompleto" : "generic";
  const data = await callAI({ prompt, feature });
  return String(data?.text ?? data?.texto ?? "").trim();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setTyping(el, label = "Generando") {
  if (!el) return;
  el.innerHTML = `
    <span class="typing">
      ${label}
      <span class="dots" aria-hidden="true">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </span>
    </span>
  `;
}

function renderListaBullets(items) {
  const safe = (Array.isArray(items) ? items : [])
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!safe.length) return "<i>(sin recursos)</i>";
  return `<ul style="margin: 4pt 0 0 0; padding-left: 15pt; list-style-type: disc;">${safe
    .map((r) => `<li style=\"margin-bottom: 2pt;\">${escapeHtml(r)}</li>`)
    .join("")}</ul>`;
}

function extraerJSONSeguro(texto) {
  const t = String(texto ?? "").trim();
  if (!t) return null;

  // 1) quita fences ```json ... ``` o ``` ... ```
  const sinFences = t
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();

  // 2) intento directo
  try {
    return JSON.parse(sinFences);
  } catch {}

  // 3) intenta extraer el primer objeto JSON (no greedy)
  const mObj = sinFences.match(/\{[\s\S]*?\}/);
  if (mObj) {
    try {
      return JSON.parse(mObj[0]);
    } catch {}
  }

  // 4) intenta extraer el primer array JSON
  const mArr = sinFences.match(/\[[\s\S]*?\]/);
  if (mArr) {
    try {
      return JSON.parse(mArr[0]);
    } catch {}
  }

  return null;
}

// Convierte un texto en "items" por párrafo/salto de línea (punto aparte)
// (Si Gemini te devuelve un párrafo largo sin saltos, igual lo parte por ". ")
function dividirEnItemsPorPuntoAparte(texto) {
  const t = String(texto || "").trim();
  if (!t) return [];

  // primero por saltos de línea (punto aparte real)
  let parts = t
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);

  // si no hay saltos y es un párrafo largo, partimos por oraciones
  if (parts.length <= 1) {
    parts = t
      .split(/(?<=[.!?])\s+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  // limpia viñetas o numeraciones que pudieran venir del modelo
  return parts
    .map((p) => p.replace(/^[-•\d\)\.\s]+/, "").trim())
    .filter(Boolean);
}

// Render de Momentos:
// - subtítulo SIN viñeta
// - cada "punto aparte" como una viñeta
function renderMomentosPorSeccion(momentosObj) {
  const orden = [
    ["Práctica", momentosObj?.practica],
    ["Teoría", momentosObj?.teoria],
    ["Producción", momentosObj?.produccion],
    ["Valoración", momentosObj?.valoracion],
  ];

  let html = "";
  for (const [titulo, texto] of orden) {
    const items = dividirEnItemsPorPuntoAparte(texto);
    if (!items.length) continue;

    html += `<div style="margin-bottom:6pt;">
      <b>(${escapeHtml(titulo)})</b>
      <ul style="margin:4pt 0 0 0; padding-left:15pt; list-style-type:disc;">
        ${items.map((x) => `<li style="margin-bottom:2pt;">${escapeHtml(x)}</li>`).join("")}
      </ul>
    </div>`;
  }

  return html || "<i>(sin momentos)</i>";
}

// =========================
// Helpers: ubicar celdas del documento (Momentos / Recursos)
// =========================
function __getPreviewCellByHeaderText(headerText) {
  // Buscamos el span del encabezado dentro del documento Word (tabla)
  const spans = Array.from(document.querySelectorAll("span"));
  const headerSpan = spans.find((s) =>
    String(s.textContent || "").includes(headerText),
  );
  if (!headerSpan) return null;

  const headerTd = headerSpan.closest("td");
  const headerRow = headerTd?.closest("tr");
  const table = headerRow?.closest("table");
  if (!headerTd || !headerRow || !table) return null;

  const headerTds = Array.from(headerRow.querySelectorAll("td"));
  const idx = headerTds.indexOf(headerTd);
  if (idx < 0) return null;

  // La fila siguiente contiene las celdas de contenido
  const dataRow = headerRow.nextElementSibling;
  if (!dataRow) return null;
  const dataTds = Array.from(dataRow.querySelectorAll("td"));
  const td = dataTds[idx];
  if (!td) return null;

  // Contenedor interno para no romper estilos Word
  let inner = td.querySelector(".pdc-preview-inner");
  if (!inner) {
    inner = document.createElement("div");
    inner.className = "pdc-preview-inner";
    inner.style.fontSize = "10pt";
    inner.style.lineHeight = "1.25";
    td.innerHTML = "";
    td.appendChild(inner);
  }
  return inner;
}

function __ensureCampoBlock(parent, id, label) {
  if (!parent) return null;
  let block = parent.querySelector(`#${CSS.escape(id)}`);
  if (!block) {
    block = document.createElement("div");
    block.id = id;
    block.style.marginBottom = "10px";
    block.innerHTML = `<div style="margin:2pt 0 4pt 0;"><b>${escapeHtml(
      label,
    )}</b></div><div class="subtle" style="font-style:italic;">(sin generar)</div>`;
    parent.appendChild(block);
  }
  return block;
}

function __getMomRecTargetsForCampo(campoKey) {
  const map = {
    COSMOS: "COSMOS Y PENSAMIENTO",
    COMUNIDAD: "COMUNIDAD Y SOCIEDAD",
    VIDA: "VIDA, TIERRA Y TERRITORIO",
    CIENCIA: "CIENCIA, TECNOLOGÍA Y PRODUCCIÓN",
  };
  const label = map[campoKey] || campoKey;

  const cellMom = __getPreviewCellByHeaderText(
    "MOMENTOS DEL PROCESO FORMATIVO",
  );
  const cellRec = __getPreviewCellByHeaderText("RECURSOS");

  const mom = __ensureCampoBlock(cellMom, `p-momentos-${campoKey}`, label);
  const rec = __ensureCampoBlock(cellRec, `p-recursos-${campoKey}`, label);

  return { label, mom, rec };
}

//HOLA -----------------------------------------------------------------

function indicesSeleccionadosMomentos() {
  const checks = Array.from(document.querySelectorAll(".check-fila-momento"));
  const marcados = checks
    .filter((c) => c.checked)
    .map((c) => Number(c.getAttribute("data-index")))
    .filter((n) => Number.isFinite(n));

  // si no hay (por ejemplo, el usuario desmarcó todo), aplicamos a todos
  if (!marcados.length) {
    return checks
      .map((c) => Number(c.getAttribute("data-index")))
      .filter((n) => Number.isFinite(n));
  }
  return marcados;
}

// =========================
// 4. GENERAR MOMENTOS + RECURSOS (por CAMPO)
// - usa window.__PDC_PUNTOS_SELECCIONADOS__ (check-punto)
// - usa window.__PDC_PERFILES_SALIDA__ (slot 1..4)
// =========================
function __normalizarCampoKeyFromLabel(campo) {
  const c = String(campo || "").toUpperCase();
  if (c.includes("COSMOS")) return "COSMOS";
  if (c.includes("COMUNIDAD")) return "COMUNIDAD";
  if (c.includes("VIDA")) return "VIDA";
  if (c.includes("CIENCIA")) return "CIENCIA";
  return "OTRO";
}

function __slotFromCampoKey(campoKey) {
  const map = { COSMOS: 1, COMUNIDAD: 2, VIDA: 3, CIENCIA: 4 };
  return map[campoKey] || null;
}

function __formatContenidosPorCampo(seleccionCampo) {
  // Agrupar por título y listar puntos
  const map = new Map();
  (Array.isArray(seleccionCampo) ? seleccionCampo : []).forEach((it) => {
    const titulo = String(it?.titulo || "").trim() || "(Sin título)";
    const punto = String(it?.punto || "").trim();
    if (!map.has(titulo)) map.set(titulo, new Set());
    if (punto) map.get(titulo).add(punto);
  });
  const partes = Array.from(map.entries()).map(([titulo, setPuntos]) => {
    const pts = Array.from(setPuntos.values());
    return `- ${titulo}: ${pts.length ? pts.join("; ") : "(sin puntos)"}`;
  });
  return partes.join("\n");
}

async function generarMomentosYRecursosPorCampo(
  campoKey,
  btnEl,
  ideaMomOverride = "",
) {
  const seleccion = Array.isArray(window.__PDC_PUNTOS_SELECCIONADOS__)
    ? window.__PDC_PUNTOS_SELECCIONADOS__
    : [];

  const seleccionCampo = seleccion.filter(
    (it) => __normalizarCampoKeyFromLabel(it?.campo) === campoKey,
  );

  if (!seleccionCampo.length) {
    alert(
      "No hay contenidos seleccionados para este campo. Marca puntos primero.",
    );
    return;
  }

  const ideaMom = String(ideaMomOverride || "").trim();
  const ideaRec = ""; // tu HTML no tiene input de idea-recursos, así que queda vacío

  const slot = __slotFromCampoKey(campoKey);
  const perfil = (window.__PDC_PERFILES_SALIDA__ || {})[slot] || null;
  const perfilTitulo = String(perfil?.titulo || "").trim();
  const perfilItems = Array.isArray(perfil?.itemsSeleccionados)
    ? perfil.itemsSeleccionados
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    : [];

  const {
    label,
    mom: destinoMom,
    rec: destinoRec,
  } = __getMomRecTargetsForCampo(campoKey);
  if (!destinoMom || !destinoRec) return;

  setTyping(destinoMom, `✨ Generando momentos (${label})`);
  setTyping(destinoRec, `✨ Generando recursos (${label})`);

  const contenidosTxt = __formatContenidosPorCampo(seleccionCampo);

  // Datos de referencia (opcional)
  const escolaridadText =
    document.getElementById("escolaridad")?.options[
      document.getElementById("escolaridad").selectedIndex
    ]?.text || "";
  const trimestreText =
    document.getElementById("trimestre")?.options[
      document.getElementById("trimestre").selectedIndex
    ]?.text ||
    document.getElementById("trimestre")?.value ||
    "";

  const prompt = `Actúa como docente experto en Planificación de Desarrollo Curricular (PDC) de Bolivia.

Necesito elaborar los Momentos del Proceso Formativo (Práctica, Teoría, Producción, Valoración) y luego proponer Recursos.

Campo: ${label}
Nivel/Año: Inicial - ${escolaridadText}
Trimestre: ${trimestreText}

Contenidos seleccionados (por título y puntos):
${contenidosTxt}

Perfiles de salida seleccionados (del campo):
- Título: ${perfilTitulo || "(no seleccionado)"}
- Ítems marcados: ${perfilItems.join("; ") || "(sin ítems)"}

Idea del docente para Momentos: ${ideaMom || "(sin idea)"}
Idea del docente para Recursos: ${ideaRec || "(sin idea)"}

Requisitos estrictos:
1) Devuelve SOLO un JSON válido (sin texto adicional) con esta estructura EXACTA:
{
  "momentos": {
    "practica": "...",
    "teoria": "...",
    "produccion": "...",
    "valoracion": "..."
  },
  "recursos": ["recurso 1", "recurso 2"]
}
2) En cada momento, escribe de 3 a 6 acciones concretas (separadas por punto y aparte).
3) Recursos: máximo 10, concretos y viables en aula.
4) Lenguaje sencillo, aplicable para Inicial.
5) Evita asteriscos, emojis y títulos extra.`;

  const original = btnEl ? btnEl.innerHTML : "";
  if (btnEl) {
    btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando...';
    btnEl.disabled = true;
  }

  try {
    const texto = await llamarGeminiTexto(prompt);
    const parsed = extraerJSONSeguro(texto);

    if (!parsed?.momentos) {
      destinoMom.innerText = texto || "(sin respuesta)";
      destinoRec.innerText = "(no se pudo estructurar recursos)";
      return;
    }

    destinoMom.innerHTML = renderMomentosPorSeccion(parsed.momentos);
    destinoRec.innerHTML = renderListaBullets(parsed.recursos);
  } catch (err) {
    console.error("Error generando momentos/recursos por campo:", err);
    destinoMom.innerText = "Error al generar momentos.";
    destinoRec.innerText = "Error al generar recursos.";
    notifyAIError(err, "No se pudo generar Momentos/Recursos. Revisa consola.");
  } finally {
    if (btnEl) {
      btnEl.innerHTML = original;
      btnEl.disabled = false;
    }
  }
}

// Wrappers para cada botón
function generarMomRecCosmos() {
  const idea =
    document.getElementById("idea-momentos-cosmos")?.value?.trim() || "";
  return generarMomentosYRecursosPorCampo(
    "COSMOS",
    document.getElementById("btn-momrec-cosmos"),
    idea,
  );
}

function generarMomRecComunidad() {
  const idea =
    document.getElementById("idea-momentos-comunidad")?.value?.trim() || "";
  return generarMomentosYRecursosPorCampo(
    "COMUNIDAD",
    document.getElementById("btn-momrec-comunidad"),
    idea,
  );
}

function generarMomRecVida() {
  const idea =
    document.getElementById("idea-momentos-vida")?.value?.trim() || "";
  return generarMomentosYRecursosPorCampo(
    "VIDA",
    document.getElementById("btn-momrec-vida"),
    idea,
  );
}

function generarMomRecCiencia() {
  const idea =
    document.getElementById("idea-momentos-ciencia")?.value?.trim() || "";
  return generarMomentosYRecursosPorCampo(
    "CIENCIA",
    document.getElementById("btn-momrec-ciencia"),
    idea,
  );
}

// Backward-compat (si algún flujo antiguo llama esto)
async function generarMomentosConIA() {
  // Por defecto genera COSMOS (puedes cambiar a generar todos si quieres)
  return generarMomRecCosmos();
}

// Cache en memoria (se mantiene mientras no recargues la página)
let __critCache = { ser: null, saber: null, hacer: null };

function renderCriteriosFromCache(cache) {
  const parts = [];
  if (Array.isArray(cache.ser) && cache.ser.length)
    parts.push(`<b>SER:</b>${renderListaBullets(cache.ser)}`);
  if (Array.isArray(cache.saber) && cache.saber.length)
    parts.push(`<b>SABER:</b>${renderListaBullets(cache.saber)}`);
  if (Array.isArray(cache.hacer) && cache.hacer.length)
    parts.push(`<b>HACER:</b>${renderListaBullets(cache.hacer)}`);
  return parts.length ? parts.join("<br>") : `<i>(sin criterios)</i>`;
}

// =========================
// 5. GENERAR CRITERIOS (SER / SABER / HACER)
// =========================
function __extraerBulletsDeMomentoBlock(blockEl) {
  if (!blockEl) return [];
  const lis = Array.from(blockEl.querySelectorAll("li"));
  if (lis.length) {
    return lis.map((li) => String(li.textContent || "").trim()).filter(Boolean);
  }
  return String(blockEl.innerText || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function __compactarMomentosParaPrompt({
  maxBulletsPorCampo = 10,
  maxChars = 1800,
} = {}) {
  const campos = [
    ["COSMOS", "COSMOS Y PENSAMIENTO"],
    ["COMUNIDAD", "COMUNIDAD Y SOCIEDAD"],
    ["VIDA", "VIDA, TIERRA Y TERRITORIO"],
    ["CIENCIA", "CIENCIA, TECNOLOGÍA Y PRODUCCIÓN"],
  ];

  const partes = [];

  for (const [key, label] of campos) {
    const block = document.getElementById(`p-momentos-${key}`);
    if (!block) continue;

    const bullets = __extraerBulletsDeMomentoBlock(block).filter((x) => {
      const t = x.toLowerCase();
      return t && !t.includes("(sin generar)");
    });

    if (!bullets.length) continue;

    const top = bullets.slice(0, maxBulletsPorCampo);
    partes.push(`CAMPO: ${label}\n- ${top.join("\n- ")}`);
  }

  let texto = partes.join("\n\n").trim();
  if (texto.length > maxChars) {
    texto =
      texto.slice(0, maxChars).trim() + "\n...(resumido por límite de tamaño)";
  }
  return texto;
}

async function generarRecYCritConIA() {
  const btn = document.getElementById("btn-crit");
  const textoOriginal = btn.innerText;
  if (!btn) return;

  // ✅ 1) Validar selección (flujo nuevo)
  const seleccion = Array.isArray(window.__PDC_PUNTOS_SELECCIONADOS__)
    ? window.__PDC_PUNTOS_SELECCIONADOS__
    : [];

  if (!seleccion.length) {
    alert("Selecciona contenidos (checkboxes) antes de generar criterios.");
    return;
  }

  // ✅ 3) Dimensiones
  const dims = [];
  if (document.getElementById("crit-ser")?.checked) dims.push("SER");
  if (document.getElementById("crit-saber")?.checked) dims.push("SABER");
  if (document.getElementById("crit-hacer")?.checked) dims.push("HACER");
  if (!dims.length) {
    alert("Selecciona al menos una dimensión (SER, SABER o HACER).");
    return;
  }

  // ✅ 4) Idea (nuevo input)
  const idea = document.getElementById("idea-criterios")?.value?.trim() || "";

  // ✅ 5) Momentos (TODOS) + compactación
  const momentosCompactos = __compactarMomentosParaPrompt({
    maxBulletsPorCampo: 10,
    maxChars: 1800,
  });

  if (!momentosCompactos) {
    alert("Primero genera los Momentos (usa los botones por campo).");
    return;
  }

  // ✅ 6) Contenidos compactados por título/puntos (ya tienes esta función)
  const contenidosCompactos = __formatContenidosPorCampo(seleccion);

  const destino = document.getElementById("p-criterios");
  if (!destino) return;

  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando...';
  btn.disabled = true;

  try {
    const prev = { ...__critCache };

    // Solo marca como "cargando" lo seleccionado
    if (dims.includes("SER")) __critCache.ser = ["(generando...)"];
    if (dims.includes("SABER")) __critCache.saber = ["(generando...)"];
    if (dims.includes("HACER")) __critCache.hacer = ["(generando...)"];

    destino.innerHTML = renderCriteriosFromCache(__critCache);
    //setTyping(destino, "✨ Generando criterios");

    const keys = dims.map((d) => d.toLowerCase()); // ser | saber | hacer

    const prompt = `Actúa como docente experto en evaluación en el marco del PDC de Bolivia.

Genera CRITERIOS DE EVALUACIÓN SOLO para estas dimensiones: ${dims.join(", ")}.

Datos base:
- Contenidos seleccionados (compactado por título y puntos):
${contenidosCompactos}

Momentos del Proceso Formativo (resumen por campo):
${momentosCompactos}

Idea/Contexto del docente (opcional):
${idea || "(sin idea adicional)"}

Base conceptual:
- SER: valores individuales y colectivos evidenciados en el comportamiento.
- SABER: conocimiento teórico y conceptual adquirido.
- HACER: habilidades y destrezas en la ejecución de tareas.

Requisitos estrictos:
1) Devuelve SOLO un JSON válido (sin texto adicional) con estas claves EXACTAS: ${keys.map((k) => `"${k}"`).join(", ")}.
2) Cada clave debe ser un arreglo de strings. Entre 2 y 4 criterios por dimensión.
3) Criterios observables y evaluables, sin asteriscos, sin títulos.
4) No incluyas DECIDIR.
5) Máximo 10 palabras por criterio.`;

    const texto = await llamarGeminiTexto(prompt);
    const parsed = extraerJSONSeguro(texto);

    if (!parsed || typeof parsed !== "object") {
      destino.innerText = texto || "(sin respuesta)";
      return;
    }

    // ✅ Mantener cache y solo actualizar lo solicitado (tu patrón actual)
    if (dims.includes("SER") && Array.isArray(parsed.ser))
      __critCache.ser = parsed.ser;
    if (dims.includes("SABER") && Array.isArray(parsed.saber))
      __critCache.saber = parsed.saber;
    if (dims.includes("HACER") && Array.isArray(parsed.hacer))
      __critCache.hacer = parsed.hacer;

    destino.innerHTML = renderCriteriosFromCache(__critCache);
  } catch (err) {
    console.error("Error generando criterios:", err);
    destino.innerText = "Error al generar criterios.";
    notifyAIError(err, "No se pudo generar Criterios. Revisa la consola.");
  } finally {
    btn.innerHTML = textoOriginal;
    btn.disabled = false;
  }
}

// ✅ re-exponer (porque es módulo)

// ✅ bind del botón (si tu proyecto lo hace en DOMContentLoaded, esto ayuda)
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-crit")?.addEventListener("click", () => {
    window.generarRecYCritConIA();
  });
});

// Exponer para onclick del HTML
// =========================
// Exponer funciones para onclick del HTML (porque es módulo)
// =========================
window.elaborarPDCConAI = elaborarPDCConAI;
window.elaborarPDCCompletoConAI = elaborarPDCCompletoConAI;
window.generarMomentosConIA = generarMomentosConIA;
window.generarRecYCritConIA = generarRecYCritConIA;
