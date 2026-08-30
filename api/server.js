// Entrada serverless. Las funciones de Vercel reciben (req, res) con la misma
// forma que node:http, asi que el enrutamiento es el mismo que usa el servidor
// local: lo unico que cambia es que aca no se sirven estaticos (de eso se ocupa
// el hosting) y que no hay temporizadores de proceso (de eso se ocupa el cron).
//
// El store se construye una sola vez por instancia y se comparte entre
// invocaciones: abrir la base y revisar el esquema en cada request seria un
// viaje de red extra por peticion.

import { createAuthService } from "../services/auth-service.js";
import { createBackendStore, shouldSeedDemoData } from "../services/backend-store.js";
import { createLiveEventHub } from "../services/live-event-hub.js";
import { createRequestHandler } from "../services/preview-server.js";

let handlerPromise = null;

async function buildHandler() {
  const store = await createBackendStore({
    seedDemoData: shouldSeedDemoData(process.env, false)
  });

  return createRequestHandler({
    store,
    authService: createAuthService(),
    // El handler responde 501 en /api/live cuando el modo es serverless, asi
    // que el hub solo recibe publish() y no llega a tener conexiones.
    liveEventHub: createLiveEventHub({ log: console.error }),
    mode: "serverless",
    log: console.error
  });
}

export default async function handler(req, res) {
  if (!handlerPromise) {
    handlerPromise = buildHandler().catch((error) => {
      // Sin esto una falla de arranque quedaria cacheada para toda la vida de
      // la instancia y ninguna peticion posterior podria recuperarse.
      handlerPromise = null;
      throw error;
    });
  }

  const requestHandler = await handlerPromise;
  return requestHandler(req, res);
}
