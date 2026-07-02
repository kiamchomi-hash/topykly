let authStatusPromise = null;
let turnstileWidgetId = null;

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

async function syncTurnstile() {
  const container = document.getElementById("authTurnstile");
  const tokenInput = document.getElementById("authTurnstileToken");
  const status = await getAuthStatus();
  const siteKey = status?.turnstile?.siteKey || "";
  const required = Boolean(status?.turnstile?.configured && siteKey);

  if (!container) {
    return required;
  }

  container.hidden = !required;
  if (!required) {
    if (tokenInput) {
      tokenInput.value = "";
    }
    return false;
  }

  if (!globalThis.turnstile?.render) {
    flash("Verificacion anti-bots cargando");
    return true;
  }

  if (turnstileWidgetId !== null) {
    globalThis.turnstile.reset?.(turnstileWidgetId);
    if (tokenInput) {
      tokenInput.value = "";
    }
    return true;
  }

  turnstileWidgetId = globalThis.turnstile.render(container, {
    sitekey: siteKey,
    callback(token) {
      if (tokenInput) {
        tokenInput.value = token || "";
      }
    },
    "expired-callback"() {
      if (tokenInput) {
        tokenInput.value = "";
      }
    },
    "error-callback"() {
      if (tokenInput) {
        tokenInput.value = "";
      }
    }
  });

  return true;
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

  const tokenInput = document.getElementById("authTurnstileToken");
  const turnstileRequired = await syncTurnstile();
  const turnstileToken = tokenInput?.value || "";
  if (turnstileRequired && !turnstileToken) {
    flash("Completa la verificacion anti-bots");
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
    void openAuthModal(event);
    return;
  }

  if (target?.closest("#authGoogleButton")) {
    void continueWithGoogle(event);
  }
}, true);
