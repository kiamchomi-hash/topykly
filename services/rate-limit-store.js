// Contador de peticiones por ventana para el limite de trafico HTTP.
//
// En un proceso unico alcanza con un Map: todas las peticiones pasan por el
// mismo contador. Con varias instancias no, porque cada una arranca su propio
// Map y el limite efectivo se multiplica por la cantidad de instancias, ademas
// de reiniciarse en cada arranque en frio. Ahi el contador tiene que ser
// compartido.
//
// Los limites de invitados y de autenticacion viven en la base (tabla
// guest_ip_rate_limits) y no dependen de esto.

const DEFAULT_MAX_BUCKETS = 10_000;

export function createMemoryRateLimiter({ maxBuckets = DEFAULT_MAX_BUCKETS } = {}) {
  const buckets = new Map();

  return {
    kind: "memory",
    async check(key, limit, windowMs, nowMs = Date.now()) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= nowMs) {
          buckets.delete(bucketKey);
        }
      }

      // Con el mapa lleno se rechaza en lugar de crecer sin techo: es la
      // defensa contra una avalancha de IPs distintas.
      if (!buckets.has(key) && buckets.size >= maxBuckets) {
        return { allowed: false, retryAfterSeconds: 1 };
      }

      const existing = buckets.get(key);
      const active = existing?.resetAt && existing.resetAt > nowMs;
      const resetAt = active ? existing.resetAt : nowMs + windowMs;
      const count = active ? existing.count + 1 : 1;
      buckets.set(key, { count, resetAt });

      if (count <= limit) {
        return { allowed: true, retryAfterSeconds: 0 };
      }

      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - nowMs) / 1000))
      };
    }
  };
}

// Ventana fija sobre Redis: INCR crea la clave en 1 y EXPIRE NX le pone
// vencimiento solo la primera vez, de modo que la ventana no se corre con cada
// peticion. Se habla por la API REST directamente para no sumar dependencias al
// bundle de la funcion.
export function createRedisRateLimiter({ url, token, fetchImpl = fetch, log = console.error }) {
  const endpoint = String(url).replace(/\/+$/, "");

  return {
    kind: "redis",
    async check(key, limit, windowMs) {
      const seconds = Math.max(1, Math.ceil(windowMs / 1000));

      let count = null;
      try {
        const response = await fetchImpl(`${endpoint}/pipeline`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify([
            ["INCR", key],
            ["EXPIRE", key, String(seconds), "NX"]
          ])
        });

        if (response.ok) {
          const payload = await response.json();
          const incremented = Array.isArray(payload) ? payload[0]?.result : null;
          count = Number(incremented);
        } else {
          log(`Rate limit compartido respondio ${response.status}`);
        }
      } catch (error) {
        log("No se pudo consultar el rate limit compartido.", error);
      }

      // Si el contador compartido no responde se deja pasar. Fallar cerrado
      // convertiria una intermitencia del contador en una caida del sitio, que
      // es peor que perder temporalmente el limite.
      if (!Number.isFinite(count) || count <= 0) {
        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (count <= limit) {
        return { allowed: true, retryAfterSeconds: 0 };
      }

      return { allowed: false, retryAfterSeconds: seconds };
    }
  };
}

// La integracion de Upstash en Vercel inyecta las credenciales con el prefijo
// KV_REST_API_*; el paquete de Upstash usa UPSTASH_REDIS_REST_*. Se aceptan los
// dos, con el nombre explicito primero.
//
// KV_REST_API_READ_ONLY_TOKEN queda deliberadamente afuera: contar peticiones
// necesita escribir, y con ese token cada INCR fallaria y el limite se caeria
// sin que se note.
export function createRateLimiter({ env = process.env, fetchImpl = fetch, log } = {}) {
  const url = String(env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || "").trim();
  const token = String(env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || "").trim();

  if (url && token) {
    return createRedisRateLimiter({ url, token, fetchImpl, log });
  }

  return createMemoryRateLimiter();
}
