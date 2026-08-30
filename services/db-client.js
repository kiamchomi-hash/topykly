import { DatabaseSync } from "node:sqlite";

// Adaptador de base con dos backends detras de una misma interfaz asincronica
// que conserva la forma de node:sqlite: prepare(sql) devuelve un statement con
// get/all/run, y exec(sql) acepta varias sentencias.
//
// - Local (file:): node:sqlite. Es el driver con el que la aplicacion corrio
//   siempre y no depende de un binario nativo de terceros. El binding nativo de
//   @libsql/client sobre archivo termina en SIGSEGV bajo la carga de la suite,
//   asi que no se usa para desarrollo ni pruebas.
// - Remoto (libsql:/https:): @libsql/client/web, que es HTTP puro. Sin codigo
//   nativo el paquete tampoco pesa en el bundle de la funcion serverless.
//
// Lo que cambia respecto del driver sincronico anterior es que todo devuelve
// promesas, porque contra una base remota cada consulta es un viaje de red.

const LOCAL_URL_PATTERN = /^file:/i;
// Turso administra el journal y el checkpointing por su cuenta; enviarle estos
// PRAGMA es, en el mejor caso, ruido.
const LOCAL_ONLY_PRAGMA_PATTERN =
  /^\s*PRAGMA\s+(journal_mode|synchronous|wal_autocheckpoint|temp_store|busy_timeout)\b/i;

export function stripLocalOnlyPragmas(script) {
  return script
    .split(";")
    .filter((statement) => !LOCAL_ONLY_PRAGMA_PATTERN.test(statement))
    .join(";");
}

export function resolveDbClientConfig(env = process.env) {
  const url = String(env.TURSO_DATABASE_URL || "").trim();
  if (!url) {
    return null;
  }

  return {
    url,
    authToken: String(env.TURSO_AUTH_TOKEN || "").trim() || undefined,
    isLocal: LOCAL_URL_PATTERN.test(url)
  };
}

// --- Backend local sobre node:sqlite ---

function toPlainRow(row) {
  return { ...row };
}

function createLocalBackend(url) {
  const filePath = url.replace(LOCAL_URL_PATTERN, "");
  const db = new DatabaseSync(filePath);
  // El codigo llamador reutiliza el mismo SQL en bucles; sin cache se volveria a
  // compilar en cada vuelta, que es trabajo que antes no se hacia.
  const statementCache = new Map();

  function compiled(sql) {
    let statement = statementCache.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      statementCache.set(sql, statement);
    }
    return statement;
  }

  const handle = {
    prepare(sql) {
      return {
        sql,
        async get(...args) {
          // node:sqlite devuelve filas sin prototipo y el backend remoto objetos
          // planos. Se normaliza aca para que una diferencia de forma no aparezca
          // recien en produccion.
          const row = compiled(sql).get(...args);
          return row === undefined ? undefined : toPlainRow(row);
        },
        async all(...args) {
          return compiled(sql)
            .all(...args)
            .map(toPlainRow);
        },
        async run(...args) {
          const result = compiled(sql).run(...args);
          return {
            changes: Number(result.changes ?? 0),
            lastInsertRowid: Number(result.lastInsertRowid ?? 0)
          };
        }
      };
    },
    async exec(script) {
      db.exec(script);
    }
  };

  return {
    ...handle,
    async transaction(task) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = await task(handle);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      statementCache.clear();
      db.close();
    }
  };
}

// --- Backend remoto sobre libSQL por HTTP ---

function normalizeRunResult(result) {
  return {
    changes: Number(result.rowsAffected ?? 0),
    // libSQL devuelve BigInt; el resto del codigo espera un numero.
    lastInsertRowid: result.lastInsertRowid == null ? 0 : Number(result.lastInsertRowid)
  };
}

function createRemoteHandle(target) {
  return {
    prepare(sql) {
      return {
        sql,
        async get(...args) {
          const result = await target.execute({ sql, args });
          return result.rows.length ? toPlainRow(result.rows[0]) : undefined;
        },
        async all(...args) {
          const result = await target.execute({ sql, args });
          return result.rows.map(toPlainRow);
        },
        async run(...args) {
          return normalizeRunResult(await target.execute({ sql, args }));
        }
      };
    },
    async exec(script) {
      const normalized = stripLocalOnlyPragmas(script);
      if (!normalized.trim()) {
        return;
      }
      await target.executeMultiple(normalized);
    }
  };
}

async function createRemoteBackend(url, authToken) {
  const { createClient } = await import("@libsql/client/web");
  const client = createClient(authToken ? { url, authToken } : { url });
  const handle = createRemoteHandle(client);

  return {
    ...handle,
    async transaction(task) {
      const tx = await client.transaction("write");
      try {
        const result = await task(createRemoteHandle(tx));
        await tx.commit();
        return result;
      } catch (error) {
        try {
          await tx.rollback();
        } catch {
          // La transaccion ya quedo cerrada por el error original.
        }
        throw error;
      }
    },
    close() {
      client.close();
    }
  };
}

// --- Turno para las transacciones locales ---

// Una base local es una sola conexion, y SQLite no admite dos transacciones a
// la vez sobre la misma: la segunda muere y su escritura se pierde. Con el
// driver sincronico anterior esto no podia ocurrir porque nada se intercalaba
// entre el BEGIN y el COMMIT. El turno restituye esa garantia.
//
// Alcanza solo a las transacciones, no a las consultas sueltas: una consulta
// por la conexion mientras hay una transaccion abierta es legitima (un metodo
// del store puede llamar a otro), y hacerla esperar la trabaria contra la
// transaccion que la contiene. La contrapartida en local es que esa consulta ve
// el estado sin confirmar de la transaccion en curso, porque comparte conexion.
// Contra Turso no pasa: cada transaccion abre su propio stream.
function createTurnstile(enabled) {
  if (!enabled) {
    return { run: (task) => task() };
  }

  const ignore = () => {};
  let tail = Promise.resolve();

  return {
    run(task) {
      const result = tail.then(task, task);
      tail = result.then(ignore, ignore);
      return result;
    }
  };
}

export async function createDbClient({ url, authToken = undefined }) {
  if (!url) {
    throw new Error("createDbClient requiere una url de base.");
  }

  const isLocal = LOCAL_URL_PATTERN.test(url);
  const backend = isLocal ? createLocalBackend(url) : await createRemoteBackend(url, authToken);
  const turnstile = createTurnstile(isLocal);

  return {
    isLocal,
    url,
    prepare: backend.prepare,
    exec: backend.exec,
    async transaction(task) {
      return await turnstile.run(() => backend.transaction(task));
    },
    close() {
      backend.close();
    }
  };
}
