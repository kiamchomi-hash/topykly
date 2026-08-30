// Las tres tareas periodicas que en un proceso de larga vida corren con
// setInterval. En serverless no hay proceso vivo entre peticiones, asi que las
// dispara el cron de la plataforma.
//
// Las tres son idempotentes y estan guardadas por la propia base (app_metadata),
// asi que una ejecucion de mas no hace daño. El archivado ademas ya corre con
// cualquier interaccion; esto cubre los periodos sin trafico.

import { createBackendStore, shouldSeedDemoData } from "../../services/backend-store.js";
import {
  runGuestCleanup,
  runMessageReactionReset,
  runTopicInactivityArchive
} from "../../services/preview-server.js";

function isAuthorized(req) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  // Sin secreto configurado el endpoint queda cerrado: es preferible que el
  // mantenimiento no corra a que lo pueda disparar cualquiera.
  if (!secret) {
    return false;
  }

  return String(req.headers.authorization || "") === `Bearer ${secret}`;
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) {
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { code: "UNAUTHORIZED" } }));
    return;
  }

  const store = await createBackendStore({
    seedDemoData: shouldSeedDemoData(process.env, false)
  });

  try {
    const log = (message) => console.log(message);
    await runGuestCleanup(store, log);
    await runMessageReactionReset(store, log);
    await runTopicInactivityArchive(store, log);

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    console.error("Mantenimiento programado fallido:", error);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { code: "MAINTENANCE_FAILED" } }));
  } finally {
    store.close();
  }
}
