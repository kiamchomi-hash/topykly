import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
const reportsDir = path.join(root, ".agents", "reports");
const runningFlagPath = path.join(root, ".agents", "running.flag");
const decisionsPath = path.join(root, ".agents", "decisions.json");

const DISABLE_MONETIZATION = true;

// Set the active running flag on start
fs.mkdirSync(path.dirname(runningFlagPath), { recursive: true });
fs.writeFileSync(runningFlagPath, "1", "utf8");

function runCmd(cmd, cwd = root) {
  try {
    return {
      success: true,
      stdout: execSync(cmd, { cwd, encoding: "utf8", stdio: "pipe" }).trim()
    };
  } catch (error) {
    return {
      success: false,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      error: error.message
    };
  }
}

function loadReport(filename, defaultVal) {
  const filePath = path.join(reportsDir, filename);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return defaultVal;
    }
  }
  return defaultVal;
}

// Pure JavaScript hash function to generate unique ID for suggestion texts
function getHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return "s" + Math.abs(hash).toString(36);
}

function renderHtml(timestamp) {
  const security = loadReport("security.json", {
    agentName: "Agente Auditor de Seguridad",
    status: "Seguro",
    findings: []
  });

  const qa = loadReport("qa.json", {
    agentName: "Agente de Control de Calidad (QA)",
    status: "Estable",
    checks: []
  });

  const architect = loadReport("architect.json", {
    agentName: "Agente Arquitecto / Refactorización",
    status: "Optimizado",
    suggestions: []
  });

  const coordinator = loadReport("coordinator.json", {
    agentName: "Agente Coordinador / Scrum Master",
    status: "Al día",
    summary: []
  });

  const frontend = loadReport("frontend.json", {
    agentName: "Agente Revisor de Frontend",
    status: "Optimizado",
    findings: []
  });

  const monetization = DISABLE_MONETIZATION ? null : loadReport("monetization.json", {
    agentName: "Agente de Monetización e Ideas de Tienda",
    status: "Estable",
    suggestions: []
  });

  const responsive = loadReport("responsive.json", {
    agentName: "Agente de Pruebas Responsive",
    status: "Estable",
    suggestions: []
  });

  const ux = loadReport("ux.json", {
    agentName: "Agente de Usabilidad y UX",
    status: "Estable",
    findings: []
  });

  const flows = loadReport("flows.json", {
    agentName: "Agente de Flujos de Usabilidad",
    status: "Estable",
    suggestions: []
  });

  const standards = loadReport("standards.json", {
    agentName: "Agente de Estándares y Mentoría",
    status: "Estable",
    suggestions: []
  });

  const seo = loadReport("seo.json", {
    agentName: "Agente de SEO y Rendimiento",
    status: "Estable",
    suggestions: []
  });

  const polish = loadReport("polish.json", {
    agentName: "Agente de Acabado y Detalles",
    status: "Estable",
    suggestions: []
  });

  const renderList = (items, hasActions) => {
    if (!items || items.length === 0) return "";
    
    const listItems = items.map((item) => {
      let bulletColor = "inherit";
      if (item.level === "error") bulletColor = "var(--danger)";
      else if (item.level === "warning") bulletColor = "var(--warning)";
      else if (item.level === "success") bulletColor = "var(--success)";
      
      let actionsHTML = "";
      if (hasActions && item.id && item.agent) {
        actionsHTML = `
          <div class="suggestion-actions">
            <button class="action-btn action-btn--accept" onclick="makeDecision('${item.id}', '${item.agent}', 'accept')">Aceptar</button>
            <button class="action-btn action-btn--reject" onclick="makeDecision('${item.id}', '${item.agent}', 'reject')">Rechazar</button>
          </div>
        `;
      }

      return `
        <li>
          <span class="bullet" style="color: ${bulletColor}">•</span> 
          <div class="suggestion-item">
            <span class="suggestion-text">${item.message}</span>
            ${actionsHTML}
          </div>
        </li>
      `;
    }).join("\n");

    return `<ul class="agent-card__list">${listItems}</ul>`;
  };

  let cardsHTML = "";
  
  if (coordinator.summary && coordinator.summary.length > 0) {
    cardsHTML += `
      <section class="agent-card agent-card--coordinator">
        <div class="agent-card__header">
          <h2 class="agent-card__title">👑 ${coordinator.agentName}</h2>
          <span class="agent-card__badge">${coordinator.status}</span>
        </div>
        <div class="agent-card__body">
          ${renderList(coordinator.summary, false)}
        </div>
      </section>
    `;
  }

  if (security.findings && security.findings.length > 0) {
    cardsHTML += `
      <section class="agent-card agent-card--security">
        <div class="agent-card__header">
          <h2 class="agent-card__title">🛡️ ${security.agentName}</h2>
          <span class="agent-card__badge">${security.status}</span>
        </div>
        <div class="agent-card__body">
          ${renderList(security.findings, true)}
        </div>
      </section>
    `;
  }

  if (qa.checks && qa.checks.length > 0) {
    cardsHTML += `
      <section class="agent-card agent-card--qa">
        <div class="agent-card__header">
          <h2 class="agent-card__title">🧪 ${qa.agentName}</h2>
          <span class="agent-card__badge">${qa.status}</span>
        </div>
        <div class="agent-card__body">
          ${renderList(qa.checks, false)}
        </div>
      </section>
    `;
  }

  if (architect.suggestions && architect.suggestions.length > 0) {
    cardsHTML += `
      <section class="agent-card agent-card--architect">
        <div class="agent-card__header">
          <h2 class="agent-card__title">📐 ${architect.agentName}</h2>
          <span class="agent-card__badge">${architect.status}</span>
        </div>
        <div class="agent-card__body">
          ${renderList(architect.suggestions, true)}
        </div>
      </section>
    `;
  }

  if (frontend.findings && frontend.findings.length > 0) {
    cardsHTML += `
      <section class="agent-card agent-card--frontend">
        <div class="agent-card__header">
          <h2 class="agent-card__title">🎨 ${frontend.agentName}</h2>
          <span class="agent-card__badge">${frontend.status}</span>
        </div>
        <div class="agent-card__body">
          ${renderList(frontend.findings, true)}
        </div>
      </section>
    `;
  }

  if (!DISABLE_MONETIZATION && monetization && monetization.suggestions && monetization.suggestions.length > 0) {
    cardsHTML += `
      <section class="agent-card agent-card--monetization">
        <div class="agent-card__header">
          <h2 class="agent-card__title">💰 ${monetization.agentName}</h2>
          <span class="agent-card__badge">${monetization.status}</span>
        </div>
        <div class="agent-card__body">
          ${renderList(monetization.suggestions, true)}
        </div>
      </section>
    `;
  }

  if (responsive.suggestions && responsive.suggestions.length > 0) {
    cardsHTML += `
      <section class="agent-card agent-card--responsive">
        <div class="agent-card__header">
          <h2 class="agent-card__title">📱 ${responsive.agentName}</h2>
          <span class="agent-card__badge">${responsive.status}</span>
        </div>
        <div class="agent-card__body">
          ${renderList(responsive.suggestions, true)}
        </div>
      </section>
    `;
  }

  if (ux.findings && ux.findings.length > 0) {
    cardsHTML += `
      <section class="agent-card agent-card--ux">
        <div class="agent-card__header">
          <h2 class="agent-card__title">👥 ${ux.agentName}</h2>
          <span class="agent-card__badge">${ux.status}</span>
        </div>
        <div class="agent-card__body">
          ${renderList(ux.findings, true)}
        </div>
      </section>
    `;
  }

  if (flows.suggestions && flows.suggestions.length > 0) {
    cardsHTML += `
      <section class="agent-card agent-card--flows">
        <div class="agent-card__header">
          <h2 class="agent-card__title">⚡ ${flows.agentName}</h2>
          <span class="agent-card__badge">${flows.status}</span>
        </div>
        <div class="agent-card__body">
          ${renderList(flows.suggestions, true)}
        </div>
      </section>
    `;
  }

  if (standards.suggestions && standards.suggestions.length > 0) {
    cardsHTML += `
      <section class="agent-card agent-card--standards">
        <div class="agent-card__header">
          <h2 class="agent-card__title">🎓 ${standards.agentName}</h2>
          <span class="agent-card__badge">${standards.status}</span>
        </div>
        <div class="agent-card__body">
          ${renderList(standards.suggestions, true)}
        </div>
      </section>
    `;
  }

  if (seo.suggestions && seo.suggestions.length > 0) {
    cardsHTML += `
      <section class="agent-card agent-card--seo">
        <div class="agent-card__header">
          <h2 class="agent-card__title">🚀 ${seo.agentName}</h2>
          <span class="agent-card__badge">${seo.status}</span>
        </div>
        <div class="agent-card__body">
          ${renderList(seo.suggestions, true)}
        </div>
      </section>
    `;
  }

  if (polish.suggestions && polish.suggestions.length > 0) {
    cardsHTML += `
      <section class="agent-card agent-card--polish">
        <div class="agent-card__header">
          <h2 class="agent-card__title">✨ ${polish.agentName}</h2>
          <span class="agent-card__badge">${polish.status}</span>
        </div>
        <div class="agent-card__body">
          ${renderList(polish.suggestions, true)}
        </div>
      </section>
    `;
  }

  if (cardsHTML === "") {
    cardsHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 2rem; background-color: var(--card-bg); border: 1px dashed var(--border); border-radius: 20px;">
        <span style="font-size: 3rem; display: block; margin-bottom: 1rem;">🟢</span>
        <h3 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--success);">Todo en Orden</h3>
        <p style="color: var(--text-muted);">No se detectaron problemas de usabilidad, seguridad, fallos de tests ni sugerencias de código en este ciclo.</p>
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>TOPYKLY - Oficina de Agentes</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0d10;
      --card-bg: #11141a;
      --border: #1d242e;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --font: 'Outfit', sans-serif;
      
      /* Agent Themes */
      --coordinator-color: #a78bfa;
      --security-color: #34d399;
      --qa-color: #60a5fa;
      --architect-color: #fbbf24;
      --frontend-color: #ec4899;
      --monetization-color: #10b981;
      --responsive-color: #06b6d4;
      --ux-color: #a855f7;
      --flows-color: #f97316;
      --standards-color: #38bdf8;
      --seo-color: #a3e635;
      --polish-color: #f472b6;
      
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --primary: #4f46e5;
      --primary-hover: #6366f1;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font);
      padding: 2.5rem;
      line-height: 1.6;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    header {
      margin-bottom: 2rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    h1 {
      font-size: 2rem;
      font-weight: 900;
      letter-spacing: -0.03em;
      background: linear-gradient(135deg, #c7d2fe, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .timestamp {
      font-size: 0.85rem;
      color: var(--text-muted);
      background-color: var(--card-bg);
      padding: 0.6rem 1.2rem;
      border-radius: 9999px;
      border: 1px solid var(--border);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
      gap: 2rem;
    }

    /* Agent Container */
    .agent-card {
      background-color: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 2rem;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      position: relative;
      overflow: hidden;
    }

    /* Accent color lines on the side of each card */
    .agent-card::before {
      content: "";
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 5px;
    }

    .agent-card--coordinator::before { background-color: var(--coordinator-color); }
    .agent-card--security::before { background-color: var(--security-color); }
    .agent-card--qa::before { background-color: var(--qa-color); }
    .agent-card--architect::before { background-color: var(--architect-color); }
    .agent-card--frontend::before { background-color: var(--frontend-color); }
    .agent-card--monetization::before { background-color: var(--monetization-color); }
    .agent-card--responsive::before { background-color: var(--responsive-color); }
    .agent-card--ux::before { background-color: var(--ux-color); }
    .agent-card--flows::before { background-color: var(--flows-color); }
    .agent-card--standards::before { background-color: var(--standards-color); }
    .agent-card--seo::before { background-color: var(--seo-color); }
    .agent-card--polish::before { background-color: var(--polish-color); }

    .agent-card__header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1rem;
    }

    .agent-card__title {
      font-size: 1.3rem;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    
    .agent-card--coordinator .agent-card__title { color: var(--coordinator-color); }
    .agent-card--security .agent-card__title { color: var(--security-color); }
    .agent-card--qa .agent-card__title { color: var(--qa-color); }
    .agent-card--architect .agent-card__title { color: var(--architect-color); }
    .agent-card--frontend .agent-card__title { color: var(--frontend-color); }
    .agent-card--monetization .agent-card__title { color: var(--monetization-color); }
    .agent-card--responsive .agent-card__title { color: var(--responsive-color); }
    .agent-card--ux .agent-card__title { color: var(--ux-color); }
    .agent-card--flows .agent-card__title { color: var(--flows-color); }
    .agent-card--standards .agent-card__title { color: var(--standards-color); }
    .agent-card--seo .agent-card__title { color: var(--seo-color); }
    .agent-card--polish .agent-card__title { color: var(--polish-color); }

    .agent-card__badge {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.3rem 0.75rem;
      border-radius: 8px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background-color: rgba(255, 255, 255, 0.02);
    }

    .agent-card__body {
      flex-grow: 1;
    }

    .agent-card__list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .agent-card__list li {
      font-size: 0.95rem;
      color: #e2e8f0;
      display: flex;
      align-items: flex-start;
      gap: 0.8rem;
    }

    .bullet {
      font-weight: bold;
      flex-shrink: 0;
      margin-top: 0.1rem;
      font-size: 1.2rem;
    }

    .suggestion-item {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      width: 100%;
    }

    .suggestion-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.25rem;
    }

    .action-btn {
      font-family: var(--font);
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.25rem 0.75rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      cursor: pointer;
      background-color: rgba(255, 255, 255, 0.02);
      color: var(--text);
      transition: background-color 0.15s ease, border-color 0.15s ease;
    }

    .action-btn--accept:hover {
      background-color: rgba(16, 185, 129, 0.1);
      border-color: var(--success);
      color: var(--success);
    }

    .action-btn--reject:hover {
      background-color: rgba(239, 68, 68, 0.1);
      border-color: var(--danger);
      color: var(--danger);
    }

    code {
      font-family: 'Courier New', Courier, monospace;
      background-color: rgba(0, 0, 0, 0.3);
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
      font-size: 0.85rem;
      color: #f8fafc;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }

    /* Actions Section */
    .actions-footer {
      margin-top: 3rem;
      border-top: 1px solid var(--border);
      padding-top: 2rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
    }

    .btn {
      font-family: var(--font);
      font-size: 1rem;
      font-weight: 600;
      padding: 0.75rem 2.5rem;
      border-radius: 12px;
      border: none;
      cursor: pointer;
      transition: background-color 0.2s ease, transform 0.1s ease;
    }

    .btn--primary {
      background-color: var(--primary);
      color: #ffffff;
    }

    .btn--primary:hover {
      background-color: var(--primary-hover);
    }

    .btn:disabled {
      background-color: var(--border);
      color: var(--text-muted);
      cursor: not-allowed;
    }

    .btn:active:not(:disabled) {
      transform: scale(0.98);
    }

    .status-text {
      font-size: 0.95rem;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div id="server-offline-banner" style="display: none; background-color: var(--danger); color: #fff; padding: 1rem; border-radius: 12px; margin-bottom: 2rem; font-weight: 600; text-align: center;">
      ⚠️ El servidor local está desactivado. Por favor, ejecuta el archivo <code>abrir-servidor-local.bat</code> en la carpeta de tu proyecto para poder interactuar con el Dashboard (Aceptar/Rechazar/Comprobar).
    </div>

    <header>
      <h1>💼 Oficina de Agentes de Desarrollo</h1>
      <span class="timestamp">Último Reporte: ${timestamp}</span>
    </header>

    <div class="grid">
      ${cardsHTML}
    </div>

    <div class="actions-footer">
      <button class="btn btn--primary" id="run-btn" onclick="runCheck()">Comprobar de Nuevo</button>
      <div id="status-msg" style="display: none;" class="status-text"></div>
    </div>
  </div>

  <script>
    const API_ORIGIN = window.location.origin.includes("localhost") || window.location.origin.includes("127.0.0.1")
      ? window.location.origin
      : "http://127.0.0.1:4173";

    async function checkServerStatus() {
      const banner = document.getElementById("server-offline-banner");
      const runBtn = document.getElementById("run-btn");
      try {
        const res = await fetch(API_ORIGIN + "/api/agents/status");
        if (res.ok) {
          banner.style.display = "none";
          runBtn.disabled = false;
        } else {
          throw new Error();
        }
      } catch (err) {
        banner.style.display = "block";
        runBtn.disabled = true;
        document.querySelectorAll(".action-btn").forEach(btn => btn.disabled = true);
      }
    }
    window.addEventListener("DOMContentLoaded", checkServerStatus);

    async function makeDecision(id, agent, action) {
      try {
        const url = API_ORIGIN + "/api/agents/decision?id=" + encodeURIComponent(id) + "&agent=" + encodeURIComponent(agent) + "&action=" + encodeURIComponent(action);
        const res = await fetch(url);
        if (res.ok) {
          window.location.reload();
        } else {
          throw new Error();
        }
      } catch (err) {
        alert("No se pudo registrar tu decisión localmente. Asegúrate de tener el servidor local activo.");
      }
    }

    async function runCheck() {
      const btn = document.getElementById("run-btn");
      const statusMsg = document.getElementById("status-msg");
      
      btn.disabled = true;
      btn.innerText = "Ejecutando...";
      statusMsg.style.display = "block";
      statusMsg.innerHTML = "🔄 Los agentes están ejecutando los tests locales y auditando producción. Por favor, espera...";

      try {
        await fetch(API_ORIGIN + "/api/agents/run");
        setTimeout(pollStatus, 1500);
      } catch (err) {
        statusMsg.style.color = "var(--danger)";
        statusMsg.innerHTML = "❌ No se pudo conectar al servidor local para iniciar la auditoría.";
        btn.disabled = false;
        btn.innerText = "Comprobar de Nuevo";
      }

      async function pollStatus() {
        try {
          const res = await fetch(API_ORIGIN + "/api/agents/status");
          const data = await res.json();
          if (data.running) {
            setTimeout(pollStatus, 2000);
          } else {
            window.location.reload();
          }
        } catch (err) {
          setTimeout(pollStatus, 3000);
        }
      }
    }
  </script>
</body>
</html>`;
}

async function orchestrate() {
  const timestamp = new Date().toISOString();
  fs.mkdirSync(reportsDir, { recursive: true });

  const renderOnly = process.argv.includes("--render-only");

  try {
    let auditData = null;
    let unitTests = { success: true };
    let smokeTests = { success: true };
    let gitStatus = { stdout: "" };

    if (!renderOnly) {
      console.log("🚀 Iniciando auditoría local completa...");

      // 1. Run Production Site Audit
      console.log("🔒 Auditando https://www.topykly.com/... ");
      const auditPath = path.join(root, ".agents", "scripts", "audit-site.mjs");
      const siteAudit = runCmd(`node "${auditPath}"`);
      if (siteAudit.success) {
        try {
          auditData = JSON.parse(siteAudit.stdout);
        } catch {}
      }

      // 2. Run Local Unit & Smoke Tests
      console.log("🧪 Ejecutando suite de pruebas local...");
      unitTests = runCmd("node tests/run.mjs");
      smokeTests = runCmd("node tests/smoke.mjs");

      // 3. Check Local Git Modifications
      console.log("📂 Verificando archivos modificados...");
      gitStatus = runCmd("git status --porcelain");
    } else {
      console.log("⚡ Modo renderizado rápido activo. Regenerando HTML sin ejecutar tests...");
    }

    const modifiedFiles = gitStatus.stdout
      ? gitStatus.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => {
            return !line.includes(".agents") && 
                   !line.includes("dashboard.html") && 
                   !line.includes("dashboard.md");
          })
      : [];

    // Load active decisions history from disk
    let decisions = { suggestions: {} };
    if (fs.existsSync(decisionsPath)) {
      try {
        decisions = JSON.parse(fs.readFileSync(decisionsPath, "utf8"));
      } catch {}
    }

    const filterDecisions = (items, agentKey) => {
      if (!items) return [];
      return items.map(item => {
        const id = getHash(item.message);
        return { ...item, id, agent: agentKey };
      }).filter(item => {
        // Exclude suggestions that the user has already Accepted or Rejected
        return !decisions.suggestions[item.id];
      });
    };

    // Load base reports
    const securityReport = loadReport("security.json", {
      agentName: "Agente Auditor de Seguridad",
      status: "Seguro",
      findings: []
    });

    const qaReport = loadReport("qa.json", {
      agentName: "Agente de Control de Calidad (QA)",
      status: "Estable",
      checks: []
    });

    const architectReport = loadReport("architect.json", {
      agentName: "Agente Arquitecto / Refactorización",
      status: "Optimizado",
      suggestions: []
    });

    const frontendReport = loadReport("frontend.json", {
      agentName: "Agente Revisor de Frontend",
      status: "Optimizado",
      findings: []
    });

    const monetizationReport = DISABLE_MONETIZATION ? {
      agentName: "Agente de Monetización e Ideas de Tienda",
      status: "Desactivado",
      suggestions: []
    } : loadReport("monetization.json", {
      agentName: "Agente de Monetización e Ideas de Tienda",
      status: "Estable",
      suggestions: []
    });

    const responsiveReport = loadReport("responsive.json", {
      agentName: "Agente de Pruebas Responsive",
      status: "Estable",
      suggestions: []
    });

    const uxReport = loadReport("ux.json", {
      agentName: "Agente de Usabilidad y UX",
      status: "Estable",
      findings: []
    });

    const flowsReport = loadReport("flows.json", {
      agentName: "Agente de Flujos de Usabilidad",
      status: "Estable",
      suggestions: []
    });

    const standardsReport = loadReport("standards.json", {
      agentName: "Agente de Estándares y Mentoría",
      status: "Estable",
      suggestions: []
    });

    const seoReport = loadReport("seo.json", {
      agentName: "Agente de SEO y Rendimiento",
      status: "Estable",
      suggestions: []
    });

    const polishReport = loadReport("polish.json", {
      agentName: "Agente de Acabado y Detalles",
      status: "Estable",
      suggestions: []
    });

    // If running full audit, update and overwrite the base JSON reports
    if (!renderOnly) {
      let findings = [];
      if (auditData) {
        for (const file of auditData.exposure) {
          if (file.exposed) {
            findings.push({
              level: "error",
              message: `EXPOSICIÓN CRÍTICA: El archivo <code>${file.path}</code> está accesible públicamente en producción (HTTP ${file.status}).`
            });
          }
        }
        const headers = auditData.headers;
        if (!headers.xFrameOptions) {
          findings.push({
            level: "warning",
            message: "Falta cabecera de seguridad <code>X-Frame-Options</code> (riesgo de Clickjacking)."
          });
        }
        if (headers.xContentTypeOptions !== "nosniff") {
          findings.push({
            level: "warning",
            message: "Falta cabecera de seguridad <code>X-Content-Type-Options: nosniff</code>."
          });
        }
        if (!headers.contentSecurityPolicy) {
          findings.push({
            level: "warning",
            message: "Falta configuración de <code>Content-Security-Policy</code> (riesgo de XSS)."
          });
        }
        if (auditData.ssl.valid) {
          if (auditData.ssl.daysRemaining <= 15) {
            findings.push({
              level: "warning",
              message: `El certificado SSL expira pronto: quedan solo ${auditData.ssl.daysRemaining} días.`
            });
          }
        } else {
          findings.push({
            level: "error",
            message: `Certificado SSL inválido o roto en producción: ${auditData.ssl.error}`
          });
        }
      } else {
        findings.push({
          level: "error",
          message: "No se pudo realizar la auditoría externa contra topykly.com (error de red)."
        });
      }
      
      securityReport.findings = findings;
      securityReport.status = findings.length > 0 ? "Alerta" : "Seguro";
      securityReport.lastChecked = timestamp;
      fs.writeFileSync(path.join(reportsDir, "security.json"), JSON.stringify(securityReport, null, 2), "utf8");

      const checks = [];
      if (!unitTests.success) {
        checks.push({
          level: "error",
          message: "Las pruebas unitarias locales (tests/run.mjs) están fallando."
        });
        const lines = (unitTests.stdout || unitTests.stderr || "").split("\n");
        const failures = lines.filter(l => l.includes("not ok") || l.includes("AssertionError"));
        for (const fail of failures) {
          checks.push({
            level: "error",
            message: `Detalle del fallo: <code>${fail.trim()}</code>`
          });
        }
      }
      if (!smokeTests.success) {
        checks.push({
          level: "error",
          message: "Las pruebas de humo (tests/smoke.mjs) están fallando."
        });
        const lines = (smokeTests.stdout || smokeTests.stderr || "").split("\n");
        const failures = lines.filter(l => l.includes("not ok") || l.includes("failed") || l.includes("Error:"));
        for (const fail of failures) {
          checks.push({
            level: "error",
            message: `Detalle del fallo de integración: <code>${fail.trim()}</code>`
          });
        }
      }
      qaReport.checks = checks;
      qaReport.status = (unitTests.success && smokeTests.success) ? "Estable" : "Falla";
      qaReport.lastChecked = timestamp;
      fs.writeFileSync(path.join(reportsDir, "qa.json"), JSON.stringify(qaReport, null, 2), "utf8");

      let suggestions = [
        {
          level: "suggestion",
          message: "Sugerencia de refactorización local: Centralizar todas las funciones de formateo de fechas y horas de la app en un solo módulo utilitario (ej. ui/date-utils.js) para evitar código repetido."
        }
      ];
      architectReport.suggestions = suggestions;
      architectReport.status = suggestions.length > 0 ? "Sugerencia" : "Optimizado";
      architectReport.lastChecked = timestamp;
      fs.writeFileSync(path.join(reportsDir, "architect.json"), JSON.stringify(architectReport, null, 2), "utf8");

      frontendReport.lastChecked = timestamp;
      fs.writeFileSync(path.join(reportsDir, "frontend.json"), JSON.stringify(frontendReport, null, 2), "utf8");

      if (!DISABLE_MONETIZATION) {
        monetizationReport.lastChecked = timestamp;
        fs.writeFileSync(path.join(reportsDir, "monetization.json"), JSON.stringify(monetizationReport, null, 2), "utf8");
      }

      responsiveReport.lastChecked = timestamp;
      fs.writeFileSync(path.join(reportsDir, "responsive.json"), JSON.stringify(responsiveReport, null, 2), "utf8");

      uxReport.lastChecked = timestamp;
      fs.writeFileSync(path.join(reportsDir, "ux.json"), JSON.stringify(uxReport, null, 2), "utf8");

      flowsReport.lastChecked = timestamp;
      fs.writeFileSync(path.join(reportsDir, "flows.json"), JSON.stringify(flowsReport, null, 2), "utf8");

      standardsReport.lastChecked = timestamp;
      fs.writeFileSync(path.join(reportsDir, "standards.json"), JSON.stringify(standardsReport, null, 2), "utf8");

      seoReport.lastChecked = timestamp;
      fs.writeFileSync(path.join(reportsDir, "seo.json"), JSON.stringify(seoReport, null, 2), "utf8");

      polishReport.lastChecked = timestamp;
      fs.writeFileSync(path.join(reportsDir, "polish.json"), JSON.stringify(polishReport, null, 2), "utf8");
    }

    // Apply active decisions filtering dynamically
    securityReport.findings = filterDecisions(securityReport.findings, "security");
    securityReport.status = securityReport.findings.length > 0 ? "Alerta" : "Seguro";

    architectReport.suggestions = filterDecisions(architectReport.suggestions, "architect");
    architectReport.status = architectReport.suggestions.length > 0 ? "Sugerencia" : "Optimizado";

    frontendReport.findings = filterDecisions(frontendReport.findings, "frontend");
    frontendReport.status = frontendReport.findings.length > 0 ? "Sugerencia" : "Optimizado";

    if (!DISABLE_MONETIZATION) {
      monetizationReport.suggestions = filterDecisions(monetizationReport.suggestions, "monetization");
      monetizationReport.status = monetizationReport.suggestions.length > 0 ? "Sugerencia" : "Estable";
    }

    responsiveReport.suggestions = filterDecisions(responsiveReport.suggestions, "responsive");
    responsiveReport.status = responsiveReport.suggestions.length > 0 ? "Sugerencia" : "Estable";

    uxReport.findings = filterDecisions(uxReport.findings, "ux");
    uxReport.status = uxReport.findings.length > 0 ? "Sugerencia" : "Estable";

    flowsReport.suggestions = filterDecisions(flowsReport.suggestions, "flows");
    flowsReport.status = flowsReport.suggestions.length > 0 ? "Sugerencia" : "Estable";

    standardsReport.suggestions = filterDecisions(standardsReport.suggestions, "standards");
    standardsReport.status = standardsReport.suggestions.length > 0 ? "Sugerencia" : "Estable";

    seoReport.suggestions = filterDecisions(seoReport.suggestions, "seo");
    seoReport.status = seoReport.suggestions.length > 0 ? "Sugerencia" : "Estable";

    polishReport.suggestions = filterDecisions(polishReport.suggestions, "polish");
    polishReport.status = polishReport.suggestions.length > 0 ? "Sugerencia" : "Estable";

    // Coordinator summary compilation
    const coordinatorReport = loadReport("coordinator.json", {
      agentName: "Agente Coordinador / Scrum Master",
      status: "Al día",
      summary: []
    });
    const summary = [];
    const hasSecurityAlerts = securityReport.findings.length > 0;
    const hasQaAlerts = qaReport.checks.length > 0;
    
    if (hasSecurityAlerts || hasQaAlerts) {
      summary.push({
        level: "warning",
        message: "Se detectaron alertas críticas de salud o seguridad que requieren revisión."
      });
    }
    if (modifiedFiles.length > 0) {
      summary.push({
        level: "info",
        message: `Tienes ${modifiedFiles.length} archivos locales modificados sin commitear:`
      });
      for (const file of modifiedFiles) {
        summary.push({
          level: "info",
          message: `<code>${file}</code>`
        });
      }
    }
    coordinatorReport.summary = summary;
    coordinatorReport.status = (hasSecurityAlerts || hasQaAlerts) ? "Alerta" : "Al día";
    coordinatorReport.lastChecked = timestamp;
    if (!renderOnly) {
      fs.writeFileSync(path.join(reportsDir, "coordinator.json"), JSON.stringify(coordinatorReport, null, 2), "utf8");
    }

    // 4. Generate Dashboard Markdown
    console.log("📝 Generando dashboard.md...");
    const dashboardLines = [
      "# 📊 Dashboard de Salud y Seguridad: TOPYKLY",
      "",
      `*Último chequeo:* \`${timestamp}\``,
      "",
      "## 👑 Agente Coordinador",
      ...summary.map(s => `*   ${s.message}`),
      "",
      "## 🛡️ Agente Auditor de Seguridad",
      ...securityReport.findings.map(f => `*   ${f.message}`),
      "",
      "## 🧪 Agente QA Tester",
      ...qaReport.checks.map(c => `*   ${c.message}`),
      "",
      "## 📐 Agente Arquitecto / Refactorización",
      ...architectReport.suggestions.map(s => `*   ${s.message}`),
      "",
      "## 🎨 Agente Revisor de Frontend",
      ...frontendReport.findings.map(f => `*   ${f.message}`),
      ""
    ];
    if (!DISABLE_MONETIZATION) {
      dashboardLines.push(
        "## 💰 Agente de Monetización e Ideas de Tienda",
        ...monetizationReport.suggestions.map(s => `*   ${s.message}`),
        ""
      );
    }
    dashboardLines.push(
      "## 📱 Agente de Pruebas Responsive",
      ...responsiveReport.suggestions.map(s => `*   ${s.message}`),
      "",
      "## 👥 Agente de Usabilidad y UX",
      ...uxReport.findings.map(f => `*   ${f.message}`),
      "",
      "## ⚡ Agente de Flujos de Usabilidad",
      ...flowsReport.suggestions.map(s => `*   ${s.message}`),
      "",
      "## 🎓 Agente de Estándares y Mentoría",
      ...standardsReport.suggestions.map(s => `*   ${s.message}`),
      "",
      "## 🚀 Agente de SEO y Rendimiento",
      ...seoReport.suggestions.map(s => `*   ${s.message}`),
      "",
      "## ✨ Agente de Acabado y Detalles",
      ...polishReport.suggestions.map(s => `*   ${s.message}`)
    );
    fs.writeFileSync(path.join(root, "dashboard.md"), dashboardLines.join("\n"), "utf8");

    // 5. Generate Dashboard HTML
    console.log("📝 Generando dashboard.html...");
    // Render HTML using loaded (and filtered) variables
    // In order to let renderHtml read the filtered state, we temporarily write the filtered JSON reports to reportsDir so renderHtml loads them correctly.
    // This is clean and robust.
    fs.writeFileSync(path.join(reportsDir, "security.json"), JSON.stringify(securityReport, null, 2), "utf8");
    fs.writeFileSync(path.join(reportsDir, "architect.json"), JSON.stringify(architectReport, null, 2), "utf8");
    fs.writeFileSync(path.join(reportsDir, "frontend.json"), JSON.stringify(frontendReport, null, 2), "utf8");
    if (!DISABLE_MONETIZATION) {
      fs.writeFileSync(path.join(reportsDir, "monetization.json"), JSON.stringify(monetizationReport, null, 2), "utf8");
    }
    fs.writeFileSync(path.join(reportsDir, "responsive.json"), JSON.stringify(responsiveReport, null, 2), "utf8");
    fs.writeFileSync(path.join(reportsDir, "ux.json"), JSON.stringify(uxReport, null, 2), "utf8");
    fs.writeFileSync(path.join(reportsDir, "flows.json"), JSON.stringify(flowsReport, null, 2), "utf8");
    fs.writeFileSync(path.join(reportsDir, "standards.json"), JSON.stringify(standardsReport, null, 2), "utf8");
    fs.writeFileSync(path.join(reportsDir, "seo.json"), JSON.stringify(seoReport, null, 2), "utf8");
    fs.writeFileSync(path.join(reportsDir, "polish.json"), JSON.stringify(polishReport, null, 2), "utf8");

    const htmlContent = renderHtml(timestamp);
    fs.writeFileSync(path.join(root, "dashboard.html"), htmlContent, "utf8");

    console.log("🏁 Auditoría finalizada. dashboard.html y dashboard.md actualizados con éxito.");
  } finally {
    // Always remove the active running flag on exit (even on errors!)
    if (fs.existsSync(runningFlagPath)) {
      fs.unlinkSync(runningFlagPath);
    }
  }
}

orchestrate().catch((err) => {
  console.error("Error en orquestación:", err);
  process.exit(1);
});
