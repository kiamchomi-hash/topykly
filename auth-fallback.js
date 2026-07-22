let authStatusPromise = null;
let turnstileWidgetId = null;
let pendingTurnstileToken = null;
let authFallbackPending = false;

function clearLegacyClientSessionId() {
  try {
    localStorage.removeItem("topykly-session-id");
    localStorage.removeItem("chetrend-session-id");
  } catch {
    // Ignore storage failures; auth relies on HttpOnly cookies.
  }
}

function setAuthStatusMessage(message = "", kind = "info") {
  const status = document.getElementById("authStatus");
  if (!status) {
    return;
  }

  const normalized = String(message || "").trim();
  status.textContent = normalized;
  status.hidden = !normalized;
  status.dataset.statusKind = normalized ? kind : "off";
}

function setGoogleAuthPending(pending) {
  const button = document.getElementById("authGoogleButton");
  if (!button) {
    return;
  }

  button.disabled = pending;
  button.setAttribute("aria-busy", String(pending));
  button.classList.toggle("is-pending", pending);
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

  container.dataset.turnstileMode = required ? "silent" : "off";
  if (!required) {
    resetTurnstileToken();
    return false;
  }

  if (!globalThis.turnstile?.render) {
    await loadTurnstileScript();
    if (!globalThis.turnstile?.render) {
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
    "before-interactive-callback"() {
      container.dataset.turnstileMode = "interactive";
    },
    "after-interactive-callback"() {
      container.dataset.turnstileMode = "silent";
    },
    callback(token) {
      container.dataset.turnstileMode = "silent";
      storeTurnstileToken(token);
    },
    "expired-callback"() {
      container.dataset.turnstileMode = "silent";
      resetTurnstileToken();
    },
    "error-callback"() {
      container.dataset.turnstileMode = "silent";
      resetTurnstileToken();
    },
    "timeout-callback"() {
      container.dataset.turnstileMode = "silent";
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
  setAuthStatusMessage();
  try {
    await syncTurnstile();
  } catch (error) {
    setAuthStatusMessage(error?.message || "No pudimos preparar el acceso.", "error");
  }
}

async function continueWithGoogle(event) {
  const backdrop = document.getElementById("authModalBackdrop");
  if (!backdrop || backdrop.hidden) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  if (authFallbackPending) {
    return;
  }

  authFallbackPending = true;
  setGoogleAuthPending(true);
  setAuthStatusMessage();
  try {
    const turnstileToken = await requestTurnstileToken();

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
      throw new Error(payload?.error?.message || "No se pudo iniciar sesion");
    }

    if (payload.mode === "redirect" && payload.redirectUrl) {
      window.location.href = payload.redirectUrl;
      return;
    }

    window.location.reload();
  } catch (error) {
    setAuthStatusMessage(error?.message || "No pudimos verificarte. Intentalo de nuevo.", "error");
  } finally {
    authFallbackPending = false;
    setGoogleAuthPending(false);
  }
}

document.addEventListener(
  "click",
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("#authButton, #authBannerLoginButton, #authBannerRegisterButton")) {
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
  },
  true
);
