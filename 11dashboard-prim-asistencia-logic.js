let __pdcCompletoMode = false; // ← ESTA LÍNEA ES LA CORRECCIÓN
// 1. Mover fuera del bloque para que sean globales
let datosCargaHoraria = [];
let datosObjetivos = [];
let datosPerfilesSalida = null;
let perfilSalidaSeleccionado = null; // string

// =========================
// CONFIG (Cloud Function Endpoint)
// - Nota: esto NO oculta la URL al 100% (se ve en Network), solo evita verla “de reojo” en el código.
// =========================
// const _ENDPOINT_PARTS = [
//   "aHR0cHM6Ly91cy1jZW50cmFsMS1zaW11bGFjcm9lc2ZtczIwMjYuY2xvdWRmdW5jdGlvbnMubmV0L2dlbmVyYXJPYmpldGl2bw==",
// ];
// const GEMINI_ENDPOINT = atob(_ENDPOINT_PARTS.join(""));

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

import { callAI, notifyAIError } from "./ai.js";

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

  const permisos = userData?.permisos || { primaria: [], secundaria: [] };
  const selEscol = document.getElementById("escolaridad");
  const selArea = document.getElementById("area");

  // PRIMARIA: filtra escolaridad permitida (área libre)
  if (
    Array.isArray(permisos.primaria) &&
    permisos.primaria.length &&
    selEscol
  ) {
    const permitidos = new Set(permisos.primaria.map(String));
    __restoreSelect("escolaridad");
    __filterSelect("escolaridad", permitidos);

    if (selArea) {
      __restoreSelect("area");
      selArea.disabled = false;
      Array.from(selArea.options).forEach((opt) => {
        if (opt.value) opt.disabled = false;
      });
    }
    return;
  }

  // SECUNDARIA: filtra áreas permitidas (escolaridad libre)
  if (
    Array.isArray(permisos.secundaria) &&
    permisos.secundaria.length &&
    selArea
  ) {
    const permitidos = new Set(permisos.secundaria.map(String));
    __restoreSelect("area");
    __filterSelect("area", permitidos);

    if (selEscol) {
      __restoreSelect("escolaridad");
      selEscol.disabled = false;
      Array.from(selEscol.options).forEach((opt) => {
        if (opt.value) opt.disabled = false;
      });
    }
    return;
  }

  // SIN RESTRICCIÓN: restaura ambos
  if (selEscol) {
    __restoreSelect("escolaridad");
    selEscol.disabled = false;
  }
  if (selArea) {
    __restoreSelect("area");
    selArea.disabled = false;
  }
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

function renderizarPerfilesSalida() {
  const cont = document.getElementById("perfil-salida-container");
  if (!cont) return;

  cont.innerHTML = "";

  const nivel = document.getElementById("nivel")?.value; // INI / PRI / SEC
  const area = document.getElementById("area")?.value; // LENG_02, SOC_03, ...
  const escolaridad = document.getElementById("escolaridad")?.value; // prim_1ro, sec_1ro, ...

  if (!datosPerfilesSalida || !nivel || !area || !escolaridad) {
    cont.innerHTML = "<i>Seleccione Nivel, Área y Año para ver perfiles.</i>";
    return;
  }

  const lista = datosPerfilesSalida?.[nivel]?.[area]?.[escolaridad] || [];

  if (!Array.isArray(lista) || lista.length === 0) {
    cont.innerHTML = "<i>No hay perfiles configurados para esta selección.</i>";
    perfilSalidaSeleccionado = null;
    window.__PDC_PERFIL_SALIDA__ = null;
    return;
  }

  // Si el seleccionado ya no existe, lo limpiamos
  if (perfilSalidaSeleccionado && !lista.includes(perfilSalidaSeleccionado)) {
    perfilSalidaSeleccionado = null;
    window.__PDC_PERFIL_SALIDA__ = null;
  }

  lista.forEach((texto, idx) => {
    const id = `perfil-salida-${nivel}-${area}-${escolaridad}-${idx}`;

    const div = document.createElement("div");
    div.className = "tema-item";
    div.innerHTML = `
      <label>
        <input type="checkbox" class="check-perfil-salida" id="${id}" data-texto="${encodeURIComponent(texto)}">
        <div class="tema-item-texto">
          <strong>Perfil de Salida ${idx + 1}</strong>
          <span class="tema-detalle">${texto}</span>
        </div>
      </label>
    `;

    const input = div.querySelector("input");

    // mantener selección previa
    if (perfilSalidaSeleccionado === texto) input.checked = true;

    // ✅ comportamiento "solo uno"
    input.addEventListener("change", (e) => {
      const checked = e.target.checked;

      // si se marcó este, desmarca todos los demás
      if (checked) {
        cont.querySelectorAll(".check-perfil-salida").forEach((other) => {
          if (other !== e.target) other.checked = false;
        });
        perfilSalidaSeleccionado = texto;
        window.__PDC_PERFIL_SALIDA__ = texto; // lo dejamos disponible para prompts/Word/etc
      } else {
        perfilSalidaSeleccionado = null;
        window.__PDC_PERFIL_SALIDA__ = null;
      }
    });

    cont.appendChild(div);
  });
}

document
  .getElementById("nivel")
  ?.addEventListener("change", renderizarPerfilesSalida);
document
  .getElementById("area")
  ?.addEventListener("change", renderizarPerfilesSalida);
document
  .getElementById("escolaridad")
  ?.addEventListener("change", renderizarPerfilesSalida);

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
      const ids = [
        "p-adapt-gen-out",
        "p-adapt-esp-adaptacion",
        "p-adapt-esp-ser",
        "p-adapt-esp-saber",
        "p-adapt-esp-hacer",
      ];
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = "";
      });
    }
  };

  chk.addEventListener("change", apply);
  apply(); // estado inicial
}

document.addEventListener("DOMContentLoaded", () => {
  // ✅ V2: ya no usamos sessionStorage. La sesión se controla con Firebase Auth en el guard superior.
  // Si el guard aún no cargó el perfil, no hacemos nada aquí; el guard se encargará de pintar el nombre y aplicar restricciones.
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

  const mapearCurso = (escolaridad) => {
    const mapa = {
      prim_1ro: "primero",
      prim_2do: "segundo",
      prim_3ro: "tercero",
      prim_4to: "cuarto",
      prim_5to: "quinto",
      prim_6to: "sexto",
    };
    return mapa[escolaridad] || "primero";
  };

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
  nivelFijo.value = "PRI";
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

  // Función para cargar contenidos desde el JSON dinámico
  const cargarContenidosSugeridos = () => {
    const archivo =
      "file_nivel/" + document.getElementById("escolaridad").value + ".json";
    const areaId = document.getElementById("area").value;
    const trimestreFull = document.getElementById("trimestre").value;

    const triNum = trimestreFull.includes("Primer")
      ? 1
      : trimestreFull.includes("Segundo")
        ? 2
        : 3;

    fetch(archivo)
      .then((res) => res.json())
      .then((data) => {
        const areaData = data.areas_curriculares.find(
          (a) => a.area_id === areaId,
        );
        const triData = areaData?.planificacion_anual.find(
          (t) => t.trimestre === triNum,
        );

        renderizarTemas(triData?.unidades || []);
      })
      .catch((err) => {
        console.error("Error al cargar contenidos:", err);
        document.getElementById("lista-temas-json").innerHTML =
          "No se encontró el archivo de contenidos.";
      });
  };

  // Renderiza los checkboxes en el formulario
  const renderizarTemas = (unidades) => {
    const contenedor = document.getElementById("lista-temas-json");
    contenedor.innerHTML = "";

    unidades.forEach((uni) => {
      const div = document.createElement("div");
      div.className = "tema-item";
      const puntosStr = uni.puntos_clave ? uni.puntos_clave.join("|") : "";

      div.innerHTML = `
            <label>
                <input type="checkbox" class="check-tema" 
                    data-titulo="${uni.titulo_principal}" 
                    data-puntos="${puntosStr}">
                <div class="tema-item-texto">
                    <strong>${uni.titulo_principal}</strong>
                    <span class="tema-detalle">${puntosStr.replace(/\|/g, ", ")}</span>
                </div>
            </label>
        `;

      div
        .querySelector("input")
        .addEventListener("change", actualizarVistaPreviaTemas);
      contenedor.appendChild(div);
    });
  };

  
  // =========================
  // CHECKBOXES dinámicos según los contenidos seleccionados
  // - Se renderizan en #checks-contenidos-seleccionados
  // - Sirven para elegir a qué filas aplicar Momentos/Recursos
  // =========================
  const actualizarChecksContenidosSeleccionados = (seleccionados) => {
    const box = document.getElementById("checks-contenidos-seleccionados");
    if (!box) return;

    box.innerHTML = "";

    if (!Array.isArray(seleccionados) || seleccionados.length === 0) {
      box.innerHTML = "<i>Selecciona contenidos para ver opciones.</i>";
      return;
    }

    seleccionados.forEach((tema, index) => {
      const titulo =
        tema.getAttribute("data-titulo") || `Contenido ${index + 1}`;
      const div = document.createElement("div");
      div.className = "tema-item";
      div.innerHTML = `
        <label>
          <input type="checkbox" class="check-fila-momento" data-index="${index}" checked />
          <div class="tema-item-texto">
            <strong>${titulo}</strong>
            <span class="tema-detalle">Aplicar a esta fila</span>
          </div>
        </label>
      `;
      box.appendChild(div);
    });
  };

  const actualizarVistaPreviaTemas = () => {
    const seleccionados = Array.from(
      document.querySelectorAll(".check-tema:checked"),
    );
    const cuerpoTabla = document.getElementById("tabla-planificacion-dinamica");
    const areaSelector = document.getElementById("area");
    const escolaridadSelector = document.getElementById("escolaridad");

    if (!cuerpoTabla || !areaSelector || !escolaridadSelector) return;

    const diccionarioCarga = {
      LENG_02: "COM",
      SOC_03: "CSO",
      EFD_05: "EFD",
      MUS_06: "EMU",
      ART_04: "APV",
      MAT_08: "MAT",
      TEC_09: "TEC",
      CNA_07: "CNT",
      VAL_01: "VER",
    };

    const idParaCarga =
      diccionarioCarga[areaSelector.value] || areaSelector.value;
    const cursoKey = mapearCurso(escolaridadSelector.value);

    while (cuerpoTabla.rows.length > 2) {
      cuerpoTabla.deleteRow(2);
    }

    const totalTemasTikeados = seleccionados.length;
    // actualizar lista de filas para Momentos/Recursos
    actualizarChecksContenidosSeleccionados(seleccionados);
    if (totalTemasTikeados === 0) return;

    const areaEncontrada = datosCargaHoraria.find(
      (a) => a.id_area === idParaCarga,
    );
    const cargaMensual =
      areaEncontrada && areaEncontrada.carga_horaria
        ? areaEncontrada.carga_horaria[cursoKey]
        : 0;
    const periodosPorTema = Math.floor(cargaMensual / totalTemasTikeados);

    const fontStyle =
      "font-family: 'Times New Roman', Times, serif; font-size: 10pt;";

    seleccionados.forEach((tema, index) => {
      const titulo = tema.getAttribute("data-titulo");
      const puntosArray = tema.getAttribute("data-puntos")
        ? tema.getAttribute("data-puntos").split("|")
        : [];

      const styleIA =
        "font-family: 'Times New Roman', Times, serif; font-size: 9pt; font-weight: normal;";

      let viñetasHTML = `<ul style="${fontStyle} margin: 4pt 0 0 0; padding-left: 15pt; list-style-type: disc;">`;
      puntosArray.forEach((punto) => {
        if (punto.trim() !== "") {
          viñetasHTML += `<li style="font-weight: normal; margin-bottom: 2pt;">${punto.trim()}</li>`;
        }
      });
      viñetasHTML += "</ul>";

      const nuevaFila = document.createElement("tr");
      let contenidoFila = "";

      if (index === 0) {
        contenidoFila += `
                <td width="8%" rowspan="${totalTemasTikeados}" valign="top" style="border:solid black 1pt; border-top:none; padding:5pt; text-align:justify; ${fontStyle}">
                    <div id="p-objetivo" style="margin-bottom: 10pt; color: #555; font-style: italic; display: none;"></div>
                    
                    <div id="p-obj-aprender" style="${styleIA}">
                        <i>Presione "Elaborar PDC" para generar el objetivo...</i>
                    </div>
                </td>`;
      }

      contenidoFila += `
            <td width="22%" valign="top" style="border:solid black 1pt; border-top:none; border-left:none; padding:5pt; ${fontStyle}">
                <b style="text-transform: uppercase;">${titulo}</b>
                ${viñetasHTML}
            </td>
            <td width="28%" valign="top" style="border:solid black 1pt; border-top:none; border-left:none; padding:5pt; ${styleIA}">
                <div id="p-metodologia-${index}">Momento metodológico...</div>
            </td>
            <td width="8%" valign="top" style="border:solid black 1pt; border-top:none; border-left:none; padding:5pt; text-align:justify; ${styleIA}">
                <div id="p-recursos-${index}">Recursos analógicos, producción de conocimientos.</div>
            </td>
            <td width="6%" valign="top" style="border:solid black 1pt; border-top:none; border-left:none; padding:5pt; text-align:center; ${fontStyle}">
                ${periodosPorTema}
            </td>
        `;

      if (index === 0) {
        contenidoFila += `
            <td width="28%" rowspan="${totalTemasTikeados}" valign="top" style="border:solid black 1pt; border-top:none; border-left:none; padding:5pt; ${styleIA}">
                <div id="p-criterios">
                    <b>SER:</b> ...<br><br>
                    <b>SABER:</b> ...<br><br>
                    <b>HACER:</b> ...<br><br>
                    
                </div>
            </td>`;
      }

      nuevaFila.innerHTML = contenidoFila;
      cuerpoTabla.appendChild(nuevaFila);
    });

    actualizarObjetivoNivel(document.getElementById("nivel").value);
  };

  ["escolaridad", "area", "trimestre"].forEach((id) => {
    document
      .getElementById(id)
      .addEventListener("change", cargarContenidosSugeridos);
  });

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
      link.download = "PDC_Completo_Personalizado_2026.doc";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      console.log("Descarga completada");
    } catch (e) {
      console.error("Error en la descarga:", e);
    }
  };

  fetch("file_carg/perfiles_salida_ui.json") // <- coloca el archivo ahí
    .then((r) => r.json())
    .then((data) => {
      datosPerfilesSalida = data;
      renderizarPerfilesSalida(); // primer render si ya hay datos seleccionados
    })
    .catch((e) => {
      console.error("Error cargando perfiles_salida_ui.json:", e);
      const box = document.getElementById("perfil-salida-container");
      if (box) box.innerHTML = "<i>No se pudo cargar perfiles de salida.</i>";
    });

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
    bind("btn-momentos", generarMomentosConIA);
    bind("btn-crit", generarRecYCritConIA);
    bind("btn-adapt-gen", generarAdaptacionesGeneralesConIA);
    bind("btn-adapt-esp", generarAdaptacionesEspecificasConIA);
  };

  __wireButtons();
});

// =========================
// AI Guard: evita llamadas paralelas a IA
// =========================

let __aiPromise = null;
let __aiDepth = 0;

async function runAI(fn) {
  // Si ya estamos dentro de una ejecución IA (cadena interna), ejecuta directo.
  if (__aiDepth > 0) {
    return await fn();
  }

  // Si el usuario clickea mientras corre, reusa la promesa en curso.
  if (__aiPromise) return __aiPromise;

  __aiPromise = (async () => {
    __aiDepth++;
    try {
      return await fn();
    } finally {
      __aiDepth--;
      __aiPromise = null;
    }
  })();

  return __aiPromise;
}

// =========================
// 1. FUNCIÓN PRINCIPAL (onclick)
// =========================
async function elaborarPDCConAI() {
  const btn = document.getElementById("btn-elaborar");
  if (!btn) return;

  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando...';
  btn.disabled = true;

  try {
    await runAI(async () => {
      await generarObjetivoConIA();
    });
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

  const seleccionados = Array.from(
    document.querySelectorAll(".check-tema:checked"),
  );
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
    await runAI(async () => {
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
    });
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
  const seleccionados = Array.from(
    document.querySelectorAll(".check-tema:checked"),
  );

  if (!campoDestino || seleccionados.length === 0) return;

  const listaContenidos = seleccionados
    .map((t) => t.getAttribute("data-titulo"))
    .join(", ");

  const perfilSel = window.__PDC_PERFIL_SALIDA__ || "";

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
    // const data = await callAI({ prompt: promptTexto, feature });
    const data = await callAI({
      prompt: promptTexto,
      feature,
      timeoutMs: 50000,
      getToken: () => currentUser.getIdToken(true),
    });

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

    const promptTexto = `Actúa como docente experto en inclusión educativa y PDC de Bolivia.

Genera ADAPTACIONES CURRICULARES GENERALES basadas en estos contenidos/idea del Maestro:
${contenidos}

Requisitos estrictos:
1) Devuelve SOLO un JSON válido (sin texto adicional) con esta estructura:
{ "adaptaciones_generales": ["...","..."] }
2) "adaptaciones_generales" debe tener ENTRE 1 y 2 viñetas.
3) Cada viñeta debe ser concreta y breve (máx 10 palabras).`;

    const texto = await llamarGeminiTexto(promptTexto);

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

async function generarAdaptacionesEspecificasConIA() {
  const btn = document.getElementById("btn-adapt-esp");
  if (!btn) return;

  // 🔥 Estudiantes/fila a procesar (puedes ampliar a [1,2,3,...])
  const estudiantes = [1, 2];

  // Validación: al menos una fila debe estar completa (contenido + condición)
  const filasValidas = estudiantes.filter((n) => {
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
    // Procesa cada estudiante (fila) de forma secuencial
    for (const n of filasValidas) {
      const contenido =
        document.getElementById(`adapt-esp-contenido-${n}`)?.value?.trim() ||
        "";
      const condicion =
        document.getElementById(`adapt-esp-condicion-${n}`)?.value?.trim() ||
        "";

      const outAda = document.getElementById(`p-adapt-esp-adaptacion-${n}`);
      const outSer = document.getElementById(`p-adapt-esp-ser-${n}`);
      const outSaber = document.getElementById(`p-adapt-esp-saber-${n}`);
      const outHacer = document.getElementById(`p-adapt-esp-hacer-${n}`);

      // Si no existe algún output de esa fila, la saltamos para evitar romper todo
      if (!outAda || !outSer || !outSaber || !outHacer) continue;

      setTyping(outAda, `✨ Generando adaptación (Est... ${n})`);
      setTyping(outSer, `✨ Generando SER (Est... ${n})`);
      setTyping(outSaber, `✨ Generando SABER (Est... ${n})`);
      setTyping(outHacer, `✨ Generando HACER (Est... ${n})`);

      const promptTexto = `Actúa como docente experto en inclusión educativa y adecuaciones curriculares (PDC Bolivia).
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

      const texto = await llamarGeminiTexto(promptTexto);

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

      outAda.innerHTML = renderListaBullets(ada.slice(0, 4));
      outSer.innerHTML = renderListaBullets(ser.slice(0, 4));
      outSaber.innerHTML = renderListaBullets(saber.slice(0, 4));
      outHacer.innerHTML = renderListaBullets(hacer.slice(0, 4));
    }
  } catch (err) {
    console.error("Error generando adaptaciones específicas:", err);

    // Si falla, al menos intenta mostrar algo en la fila 1 si existe
    const outAda1 = document.getElementById("p-adapt-esp-adaptacion-1");
    if (outAda1)
      outAda1.innerText = "Error al generar adaptaciones específicas.";

    notifyAIError(err, "No se pudo generar Adaptaciones Específicas.");
  } finally {
    btn.innerHTML = original;
    btn.disabled = false;
  }
}

// =========================
// 3. HELPERS IA (reutilizable)
// =========================
async function llamarGeminiTexto(promptTexto) {
  const feature = __pdcCompletoMode ? "pdcCompleto" : "generic";
  // const data = await callAI({ prompt, feature });
  const data = await callAI({
    prompt: promptTexto,
    feature,
    timeoutMs: 50000,
    getToken: () => currentUser.getIdToken(true), // token fresco
  });

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

///HOLA/////////////////////////////////////////////////////////

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
// 4. GENERAR MOMENTOS + RECURSOS (por fila)
// =========================
async function generarMomentosConIA() {
  const btn = document.getElementById("btn-momentos");
  if (!btn) return;

  const seleccionados = Array.from(
    document.querySelectorAll(".check-tema:checked"),
  );
  if (!seleccionados.length) {
    alert("Selecciona al menos un contenido.");
    return;
  }

  const idea = document.getElementById("idea-momentos")?.value?.trim() || "";
  const indices = indicesSeleccionadosMomentos();

  const original = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando... ';
  btn.disabled = true;

  try {
    await runAI(async () => {
      for (const index of indices) {
        const tema = seleccionados[index];
        if (!tema) continue;

        const titulo =
          tema.getAttribute("data-titulo") || `Contenido ${index + 1}`;
        const puntos = (tema.getAttribute("data-puntos") || "")
          .split("|")
          .map((x) => x.trim())
          .filter(Boolean);

        const destinoMom = document.getElementById(`p-metodologia-${index}`);
        const destinoRec = document.getElementById(`p-recursos-${index}`);
        setTyping(destinoMom, "✨ Generando momentos");
        setTyping(destinoRec, "✨ Generando recursos");

        const promptTexto = `Actúa como docente experto en Planificación de Desarrollo Curricular en Bolivia.
Necesito elaborar los Momentos del Proceso Formativo (Práctica, Teoría, Producción, Valoración) PARA UN SOLO CONTENIDO.
Contenido (título): ${titulo}
Puntos clave del contenido: ${puntos.join(", ") || "(sin puntos clave)"}
Idea/Contexto del docente (si existe): ${idea || "(sin idea adicional)"}
Requisitos estrictos:
1) Devuelve SOLO un JSON válido (sin texto adicional), con esta estructura:
{
  "momentos": {
    "practica": "...",
    "teoria": "...",
    "produccion": "...",
    "valoracion": "..."
  },
  "recursos": ["recurso 1", "recurso 2", "..."]
}
2) En recursos, usa viñetas (arreglo) de recursos concretos (máx 10), 2-6 viñetas .
3) Ajusta a nivel escolar (lenguaje sencillo y viable en aula).
4) Parrafos de max. 15 palabras.`;

        const texto = await llamarGeminiTexto(promptTexto);

        const parsed = extraerJSONSeguro(texto);

        if (!parsed?.momentos) {
          if (destinoMom) destinoMom.innerText = texto || "(sin respuesta)";
          if (destinoRec)
            destinoRec.innerText = "(no se pudo estructurar recursos)";
          continue;
        }

        const mom = parsed.momentos;

        const htmlMomentos = renderMomentosPorSeccion(mom);
        if (destinoMom) destinoMom.innerHTML = htmlMomentos;

        // const itemsMomentos = [
        //   { label: "Práctica", text: mom.practica || "" },
        //   { label: "Teoría", text: mom.teoria || "" },
        //   { label: "Producción", text: mom.produccion || "" },
        //   { label: "Valoración", text: mom.valoracion || "" },
        // ].filter((x) => String(x.text || "").trim().length);

        // const htmlMomentos = itemsMomentos.length
        //   ? `<ul style="margin: 4pt 0 0 0; padding-left: 15pt; list-style-type: disc;">${itemsMomentos
        //       .map(
        //         (it) =>
        //           `<li style="margin-bottom: 2pt;">${escapeHtml(it.text)} <b>(${escapeHtml(it.label)})</b></li>`,
        //       )
        //       .join("")}</ul>`
        //   : "<i>(sin momentos)</i>";

        // if (destinoMom) destinoMom.innerHTML = htmlMomentos;
        if (destinoRec)
          destinoRec.innerHTML = renderListaBullets(parsed.recursos);
      }
    });
  } catch (err) {
    console.error("Error generando momentos:", err);
    notifyAIError(
      err,
      "No se pudo generar Momentos/Recursos. Revisa la consola.",
    );
  } finally {
    btn.innerHTML = original;
    btn.disabled = false;
  }
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

// =========================
// 5. GENERAR CRITERIOS (SER / SABER / HACER)
// =========================
async function generarRecYCritConIA(indicesOverride) {
  const btn = document.getElementById("btn-crit");
  if (!btn) return;

  const seleccionados = Array.from(
    document.querySelectorAll(".check-tema:checked"),
  );
  if (!seleccionados.length) {
    alert("Selecciona al menos un contenido.");
    return;
  }

  const objetivo =
    document.getElementById("p-obj-aprender")?.innerText?.trim() || "";
  if (!objetivo || objetivo.includes('Presione "Elaborar PDC"')) {
    alert('Primero genera el objetivo con "Elaborar PDC".');
    return;
  }

  // Dimensiones (checkboxes SER / SABER / HACER)
  const dims = [];
  if (document.getElementById("crit-ser")?.checked) dims.push("SER");
  if (document.getElementById("crit-saber")?.checked) dims.push("SABER");
  if (document.getElementById("crit-hacer")?.checked) dims.push("HACER");

  // ✅ CAMBIO: si no seleccionó ninguno, NO regeneramos todo.
  // Mejor UX: le pedimos que elija. (Esto evita el bug de “me rehace todo”.)
  if (!dims.length) {
    alert(
      "Selecciona al menos una dimensión (SER, SABER o HACER) para generar.",
    );
    return;
  }

  const dimsFinal = dims; // solo las seleccionadas

  const idea = document.getElementById("idea-criterios")?.value?.trim() || "";
  const indicesValidos = Array.isArray(indicesOverride)
    ? indicesOverride
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n >= 0 && n < seleccionados.length)
    : null;

  const contenidos = (
    indicesValidos?.length
      ? indicesValidos.map((i) => seleccionados[i])
      : seleccionados
  )
    .map((t) => t.getAttribute("data-titulo"))
    .filter(Boolean);

  const destino = document.getElementById("p-criterios");
  if (!destino) return;

  const original = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando...';
  btn.disabled = true;

  try {
    await runAI(async () => {
      setTyping(destino, "✨ Generando criterios");

      const keys = dimsFinal.map((d) => d.toLowerCase()); // ser | saber | hacer

      const promptTexto = `Actúa como docente experto en evaluación en el marco del PDC de Bolivia.

Debes generar CRITERIOS DE EVALUACIÓN SOLO para estas dimensiones: ${dimsFinal.join(", ")}.
Datos:
- Objetivo de aprendizaje (ya generado): ${objetivo}
- Contenidos seleccionados: ${contenidos.join(", ")}
- Idea/Contexto del docente (si existe): ${idea || "(sin idea adicional)"}
Base conceptual:
- SER: valores individuales y colectivos evidenciados en el comportamiento.
- SABER: conocimiento teórico y conceptual adquirido.
- HACER: habilidades y destrezas en la ejecución de tareas.
Requisitos estrictos:
1) Devuelve SOLO un JSON válido (sin texto adicional) con estas claves EXACTAS: ${keys.map((k) => `"${k}"`).join(", ")}.
2) Cada clave debe ser un arreglo de strings. Entre 1 y 3 criterios por dimensión.
3) Redacción clara, observable y evaluable (sin asteriscos, sin títulos).
4) No incluyas la dimensión DECIDIR.
5) Cada parrafo max. 8 palabras.`;

      const texto = await llamarGeminiTexto(promptTexto);

      const parsed = extraerJSONSeguro(texto);

      if (!parsed || typeof parsed !== "object") {
        destino.innerText = texto || "(sin respuesta)";
        return;
      }

      // ✅ CAMBIO: actualizar SOLO lo solicitado, sin borrar lo previo
      if (dimsFinal.includes("SER") && Array.isArray(parsed.ser))
        __critCache.ser = parsed.ser;
      if (dimsFinal.includes("SABER") && Array.isArray(parsed.saber))
        __critCache.saber = parsed.saber;
      if (dimsFinal.includes("HACER") && Array.isArray(parsed.hacer))
        __critCache.hacer = parsed.hacer;

      // ✅ Renderiza todo desde cache (lo viejo se mantiene)
      destino.innerHTML = renderCriteriosFromCache(__critCache);
    });
  } catch (err) {
    console.error("Error generando criterios:", err);
    destino.innerText = "Error al generar criterios.";
    notifyAIError(err, "No se pudo generar Criterios. Revisa la consola.");
  } finally {
    btn.innerHTML = original;
    btn.disabled = false;
  }
}

// Exponer para onclick del HTML
// =========================
// Exponer funciones para onclick del HTML (porque es módulo)
// =========================
window.elaborarPDCConAI = elaborarPDCConAI;
window.elaborarPDCCompletoConAI = elaborarPDCCompletoConAI;
window.generarMomentosConIA = generarMomentosConIA;
window.generarRecYCritConIA = generarRecYCritConIA;
//window.descargarWord = window.descargarWord || descargarWord; // si la tienes como función normal
//window.limpiarFormulario = limpiarFormulario;
