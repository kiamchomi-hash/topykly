const COLORIS_VERSION = "v0.25.0";
const COLORIS_BASE_URL = `https://cdn.jsdelivr.net/gh/mdbassit/Coloris@${COLORIS_VERSION}/dist`;
const COLORIS_STYLE_URL = `${COLORIS_BASE_URL}/coloris.min.css`;
const COLORIS_SCRIPT_URL = `${COLORIS_BASE_URL}/coloris.min.js`;
const COLORIS_STYLE_INTEGRITY =
  "sha384-DY3umZptOgjUNshBFbvu1+3RVFPoD1/CgGcc1yyJ77/aFOJ7jtN4BORnz/D/xF0n";
const COLORIS_SCRIPT_INTEGRITY =
  "sha384-olpkBKjEFqOOAAUzqL1y4xnKDCVmmXNaoRDWmHnRTutomMnUySX9hqDgVQVcvMdc";

let colorisLoadPromise = null;

function ensureStylesheet(documentRef) {
  if (documentRef.querySelector(`link[href="${COLORIS_STYLE_URL}"]`)) {
    return;
  }

  const link = documentRef.createElement("link");
  link.rel = "stylesheet";
  link.href = COLORIS_STYLE_URL;
  link.integrity = COLORIS_STYLE_INTEGRITY;
  link.crossOrigin = "anonymous";
  documentRef.head.append(link);
}

export function ensureColorisLoaded({
  documentRef = typeof document !== "undefined" ? document : null,
  globalRef = globalThis
} = {}) {
  if (typeof globalRef.Coloris === "function") {
    return Promise.resolve(globalRef.Coloris);
  }
  if (!documentRef) {
    return Promise.resolve(null);
  }
  if (colorisLoadPromise) {
    return colorisLoadPromise;
  }

  ensureStylesheet(documentRef);
  colorisLoadPromise = new Promise((resolve, reject) => {
    const existing = documentRef.querySelector(`script[src="${COLORIS_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(globalRef.Coloris ?? null), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("No se pudo cargar el selector de color.")),
        { once: true }
      );
      return;
    }

    const script = documentRef.createElement("script");
    script.src = COLORIS_SCRIPT_URL;
    script.integrity = COLORIS_SCRIPT_INTEGRITY;
    script.crossOrigin = "anonymous";
    script.addEventListener("load", () => resolve(globalRef.Coloris ?? null), { once: true });
    script.addEventListener(
      "error",
      () => {
        colorisLoadPromise = null;
        reject(new Error("No se pudo cargar el selector de color."));
      },
      { once: true }
    );
    documentRef.body.append(script);
  });

  return colorisLoadPromise;
}
