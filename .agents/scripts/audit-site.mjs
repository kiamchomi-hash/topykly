import https from "node:https";
import tls from "node:tls";

const TARGET_HOST = "www.topykly.com";
const TARGET_ORIGIN = `https://${TARGET_HOST}`;

async function checkUrl(url) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = https.get(url, { timeout: 5000 }, (res) => {
      // Consume response data to free socket
      res.resume();
      resolve({
        status: res.statusCode,
        headers: res.headers,
        responseTimeMs: Date.now() - start
      });
    });
    req.on("error", (err) => {
      resolve({ status: null, headers: {}, responseTimeMs: Date.now() - start, error: err.message });
    });
  });
}

async function checkCert(host) {
  return new Promise((resolve) => {
    const socket = tls.connect(443, host, { servername: host }, () => {
      const cert = socket.getPeerCertificate();
      socket.destroy();
      if (cert && cert.valid_to) {
        const expiry = new Date(cert.valid_to);
        const daysRemaining = Math.ceil((expiry - new Date()) / (24 * 60 * 60_000));
        resolve({ valid: true, daysRemaining, expiry: cert.valid_to });
      } else {
        resolve({ valid: false, daysRemaining: 0, error: "No se encontro un certificado SSL." });
      }
    });
    socket.on("error", (err) => {
      resolve({ valid: false, daysRemaining: 0, error: err.message });
    });
  });
}

async function runAudit() {
  const results = {
    timestamp: new Date().toISOString(),
    health: { status: "unknown", latencyMs: 0 },
    exposure: [],
    headers: {},
    ssl: {}
  };

  // 1. Health check & Latency
  const healthRes = await checkUrl(`${TARGET_ORIGIN}/api/bootstrap`);
  results.health.latencyMs = healthRes.responseTimeMs;
  results.health.status = healthRes.status === 200 ? "OK" : "DOWN";

  // 2. Exposure check
  const filesToCheck = [
    { path: "/.env", label: "Archivo .env" },
    { path: "/.data/topykly.sqlite", label: "Base de datos SQLite" },
    { path: "/services/backend-store.js", label: "Código de backend-store.js" },
    { path: "/package.json", label: "package.json" }
  ];

  for (const file of filesToCheck) {
    const res = await checkUrl(`${TARGET_ORIGIN}${file.path}`);
    results.exposure.push({
      label: file.label,
      path: file.path,
      exposed: res.status === 200,
      status: res.status
    });
  }

  // 3. Security Headers check
  const mainRes = await checkUrl(TARGET_ORIGIN);
  if (mainRes.headers) {
    results.headers = {
      xFrameOptions: mainRes.headers["x-frame-options"] || null,
      xContentTypeOptions: mainRes.headers["x-content-type-options"] || null,
      contentSecurityPolicy: mainRes.headers["content-security-policy"] || null,
      strictTransportSecurity: mainRes.headers["strict-transport-security"] || null
    };
  }

  // 4. SSL Cert check
  results.ssl = await checkCert(TARGET_HOST);

  return results;
}

runAudit().then((results) => {
  console.log(JSON.stringify(results, null, 2));
}).catch((err) => {
  console.error(JSON.stringify({ error: err.message }, null, 2));
  process.exit(1);
});
