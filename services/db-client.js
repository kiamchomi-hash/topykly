import { createClient } from "@libsql/client";

// Adaptador sobre libSQL que conserva la forma de node:sqlite (DatabaseSync):
// prepare(sql) devuelve un statement con get/all/run, y exec(sql) acepta varias
// sentencias. La unica diferencia es que todo devuelve promesas, porque contra
// Turso cada consulta es un viaje de red.
//
// La otra diferencia importante es transaction(): sobre HTTP un "BEGIN" suelto
// no agrupa nada, asi que la transaccion entrega su propio handle y todo lo que
// ocurre dentro tiene que pasar por ese handle, no por el de la conexion.

const LOCAL_URL_PATTERN = /^file:/i;
// Turso administra el journal y el checkpointing por su cuenta; enviarle estos
// PRAGMA es, en el mejor caso, ruido.
const LOCAL_ONLY_PRAGMA_PATTERN =
  /^\s*PRAGMA\s+(journal_mode|synchronous|wal_autocheckpoint|temp_store|busy_timeout)\b/i;

function toPlainRow(row) {
  return { ...row };
}

function normalizeRunResult(result) {
  return {
    changes: Number(result.rowsAffected ?? 0),
    // libSQL devuelve BigInt; el resto del codigo espera un numero.
    lastInsertRowid: result.lastInsertRowid == null ? 0 : Number(result.lastInsertRowid)
  };
}

function createStatement(execute, sql) {
  return {
    sql,
    async get(...args) {
      const result = await execute({ sql, args });
      return result.rows.length ? toPlainRow(result.rows[0]) : undefined;
    },
    async all(...args) {
      const result = await execute({ sql, args });
      return result.rows.map(toPlainRow);
    },
    async run(...args) {
      return normalizeRunResult(await execute({ sql, args }));
    }
  };
}

export function stripLocalOnlyPragmas(script) {
  return script
    .split(";")
    .filter((statement) => !LOCAL_ONLY_PRAGMA_PATTERN.test(statement))
    .join(";");
}

function createHandle(target, { isLocal }) {
  return {
    prepare(sql) {
      return createStatement((statement) => target.execute(statement), sql);
    },
    async exec(script) {
      const normalized = isLocal ? script : stripLocalOnlyPragmas(script);
      if (!normalized.trim()) {
        return;
      }
      await target.executeMultiple(normalized);
    }
  };
}

export function resolveDbClientConfig(env = process.env) {
  const url = String(env.TURSO_DATABASE_URL || "").trim();
  if (url) {
    return {
      url,
      authToken: String(env.TURSO_AUTH_TOKEN || "").trim() || undefined,
      isLocal: LOCAL_URL_PATTERN.test(url)
    };
  }

  return null;
}

export function createDbClient({ url, authToken = undefined }) {
  if (!url) {
    throw new Error("createDbClient requiere una url de libSQL.");
  }

  const isLocal = LOCAL_URL_PATTERN.test(url);
  const client = createClient(authToken ? { url, authToken } : { url });
  const handle = createHandle(client, { isLocal });

  return {
    ...handle,
    isLocal,
    url,
    // El handle que recibe la tarea es el unico valido dentro de la transaccion:
    // usar el de la conexion desde adentro escribiria fuera de ella.
    async transaction(task) {
      const tx = await client.transaction("write");
      try {
        const result = await task(createHandle(tx, { isLocal }));
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
