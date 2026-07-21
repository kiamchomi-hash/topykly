const DEFAULT_HEARTBEAT_MS = 25_000;
const DEFAULT_MAX_CLIENTS = 1000;

export function createLiveEventHub({
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  maxClients = DEFAULT_MAX_CLIENTS,
  getHeaders = () => ({}),
  rejectCapacity,
  relay = null,
  log = console.error,
  instanceId = `node-${process.pid}-${Math.random().toString(36).slice(2)}`
} = {}) {
  const clients = new Set();
  let revision = 0;

  function writeEvent(res, eventName, payload) {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  function fanout(reason = "content") {
    revision += 1;
    for (const client of [...clients]) {
      if (client.res.destroyed || client.res.writableEnded) {
        clearInterval(client.heartbeatTimer);
        clients.delete(client);
        continue;
      }
      writeEvent(client.res, "update", { revision, reason });
    }
  }

  const unsubscribeRelay = relay?.subscribe?.((event) => {
    if (event?.sourceId === instanceId) {
      return;
    }
    fanout(event?.reason || event || "content");
  });

  function subscribe(req, res) {
    if (clients.size >= maxClients) {
      if (rejectCapacity) {
        rejectCapacity(res);
      } else {
        res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          error: {
            code: "LIVE_CAPACITY_REACHED",
            message: "La sincronización en vivo está temporalmente ocupada."
          }
        }));
      }
      return;
    }

    res.writeHead(200, {
      ...getHeaders(req),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write("retry: 5000\n\n");
    writeEvent(res, "ready", { revision });

    const client = { res, heartbeatTimer: null };
    clients.add(client);
    client.heartbeatTimer = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      }
    }, heartbeatMs);
    client.heartbeatTimer.unref?.();

    const cleanup = () => {
      clearInterval(client.heartbeatTimer);
      clients.delete(client);
    };
    req.once("close", cleanup);
    res.once("close", cleanup);
  }

  function publish(reason = "content") {
    fanout(reason);
    if (relay?.publish) {
      Promise.resolve(relay.publish({ reason, sourceId: instanceId })).catch((error) => {
        log("No se pudo publicar el evento en el relay compartido.", error);
      });
    }
  }

  function close() {
    unsubscribeRelay?.();
    for (const client of clients) {
      clearInterval(client.heartbeatTimer);
      client.res.end();
    }
    clients.clear();
  }

  return { subscribe, publish, close };
}
