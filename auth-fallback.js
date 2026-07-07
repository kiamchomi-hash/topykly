let authStatusPromise = null;
let turnstileWidgetId = null;
let pendingTurnstileToken = null;

function clearLegacyClientSessionId() {
  try {
    localStorage.removeItem("topykly-session-id");
    localStorage.removeItem("chetrend-session-id");
  } catch {
    // Ignore storage failures; auth relies on HttpOnly cookies.
  }
}

function flash(message) {
  const feedback = document.getElementById("actionFeedback");
  if (!feedback) {
    return;
  }

  feedback.textContent = message;
  feedback.hidden = false;
}

function setAuthModalOpen(isOpen) {
  const backdrop = document.getElementById("authModalBackdrop");
  const modal = document.getElementById("authModal");
  if (backdrop) {
    backdrop.hidden = !isOpen;
  }
  if (modal) {
    modal.setAttribute("aria-hidden", String(!isOpen));
  }
}

async function getAuthStatus() {
  if (!authStatusPromise) {
    authStatusPromise = fetch("/api/auth/status", {
      credentials: "same-origin"
    }).then((response) => response.json());
  }

  return authStatusPromise;
}

function resetTurnstileToken() {
  const tokenInput = document.getElementById("authTurnstileToken");
  if (tokenInput) {
    tokenInput.value = "";
  }
}

function storeTurnstileToken(token) {
  const tokenInput = document.getElementById("authTurnstileToken");
  if (tokenInput) {
    tokenInput.value = token || "";
  }
  if (token && pendingTurnstileToken) {
    const pending = pendingTurnstileToken;
    pendingTurnstileToken = null;
    clearTimeout(pending.timer);
    pending.resolve(token);
  }
}

function loadTurnstileScript() {
  if (document.getElementById("turnstile-script")) {
    if (globalThis.turnstile?.render) return Promise.resolve();
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (globalThis.turnstile?.render) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });
  }
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.id = "turnstile-script";
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
}

async function syncTurnstile() {
  const container = document.getElementById("authTurnstile");
  const status = await getAuthStatus();
  const siteKey = status?.turnstile?.siteKey || "";
  const required = Boolean(status?.turnstile?.configured && siteKey);

  if (!container) {
    return required;
  }

  container.hidden = !required;
  container.dataset.turnstileMode = required ? "silent" : "off";
  if (!required) {
    resetTurnstileToken();
    return false;
  }

  if (!globalThis.turnstile?.render) {
    await loadTurnstileScript();
    if (!globalThis.turnstile?.render) {
      flash("Preparando verificacion anti-bots");
      return true;
    }
  }

  if (turnstileWidgetId !== null) {
    return true;
  }

  turnstileWidgetId = globalThis.turnstile.render(container, {
    sitekey: siteKey,
    appearance: "interaction-only",
    execution: "execute",
    callback(token) {
      storeTurnstileToken(token);
    },
    "expired-callback"() {
      resetTurnstileToken();
    },
    "error-callback"() {
      resetTurnstileToken();
    }
  });

  return true;
}

async function requestTurnstileToken() {
  const tokenInput = document.getElementById("authTurnstileToken");
  const required = await syncTurnstile();
  const existingToken = tokenInput?.value || "";
  if (!required || existingToken) {
    return existingToken;
  }

  if (turnstileWidgetId === null || typeof globalThis.turnstile?.execute !== "function") {
    throw new Error("La verificacion anti-bots todavia esta cargando.");
  }

  flash("Verificando acceso...");
  return new Promise((resolve, reject) => {
    pendingTurnstileToken = {
      resolve,
      reject,
      timer: setTimeout(() => {
        pendingTurnstileToken = null;
        reject(new Error("La verificacion esta tardando. Intentalo de nuevo."));
      }, 12000)
    };
    globalThis.turnstile.execute(turnstileWidgetId);
  });
}
async function openAuthModal(event) {
  if (document.documentElement.dataset.authState === "logged-in") {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  setAuthModalOpen(true);
  await syncTurnstile();
}

async function continueWithGoogle(event) {
  const backdrop = document.getElementById("authModalBackdrop");
  if (!backdrop || backdrop.hidden) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();

  let turnstileToken = "";
  try {
    turnstileToken = await requestTurnstileToken();
  } catch (error) {
    flash(error?.message || "No pudimos verificarte. Intentalo de nuevo.");
    return;
  }

  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      selectedTopicId: null,
      turnstileToken
    })
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    flash(payload?.error?.message || "No se pudo iniciar sesion");
    return;
  }

  if (payload.mode === "redirect" && payload.redirectUrl) {
    window.location.href = payload.redirectUrl;
    return;
  }

  window.location.reload();
}

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("#authButton")) {
    if (globalThis.__topyklyAuthControllerReady) {
      return;
    }
    void openAuthModal(event);
    return;
  }

  if (target?.closest("#authGoogleButton")) {
    if (globalThis.__topyklyAuthControllerReady) {
      return;
    }
    void continueWithGoogle(event);
  }
}, true);
