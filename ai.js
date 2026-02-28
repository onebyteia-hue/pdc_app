// ai.js
// =========================
// AI Client (Gemini Cloud Function)
// =========================

// Endpoint (ofuscado igual que en dashboard-logic.js)
const _ENDPOINT_PARTS = [
  "aHR0cHM6Ly91cy1jZW50cmFsMS1zaW11bGFjcm9lc2ZtczIwMjYuY2xvdWRmdW5jdGlvbnMubmV0L2dlbmVyYXJPYmpldGl2bw==",
];
export const GEMINI_ENDPOINT = atob(_ENDPOINT_PARTS.join(""));

// ---- Helpers de error/UX (plan gratis) ----
export function normalizeErrMessage(err) {
  const raw = String(err?.message || err || "");
  try {
    const obj = JSON.parse(raw);
    return String(obj?.message || obj?.error?.message || obj?.error || raw);
  } catch {
    return raw;
  }
}

export function isUsageLimitError(err) {
  const msg = normalizeErrMessage(err).toLowerCase();
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

export function showUsoGratisModal(customMsg) {
  const modal = document.getElementById("modal-uso-gratis");
  const msgEl = document.getElementById("modal-uso-gratis-msg");
  const closeBtn = document.getElementById("btn-modal-uso-gratis-close");
  if (!modal) return;

  if (msgEl) {
    msgEl.textContent =
      customMsg ||
      "Tu plan gratis permite usar la IA una sola vez. Para seguir generando, solicita habilitación de plan.";
  }

  modal.style.display = "flex";

  const close = () => (modal.style.display = "none");
  closeBtn?.addEventListener("click", close, { once: true });

  modal.addEventListener(
    "click",
    (e) => {
      if (e.target === modal) close();
    },
    { once: true }
  );
}

export function notifyAIError(err, fallbackMsg) {
  if (isUsageLimitError(err)) {
    showUsoGratisModal(normalizeErrMessage(err));
    return;
  }
  alert(fallbackMsg || "Ocurrió un error al conectar con Gemini.");
}

// ---- Cliente IA (token lo entrega el caller) ----
export async function callAI({
  getToken, // async () => string
  prompt,
  feature,
  timeoutMs = 50000,
  endpoint = GEMINI_ENDPOINT,
}) {
  if (typeof getToken !== "function") {
    throw new Error("callAI: falta getToken()");
  }

  const token = await getToken();

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ prompt, feature }),
      signal: ctrl.signal,
    });

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
