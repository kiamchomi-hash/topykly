// Copia una base SQLite local a la base remota, tabla por tabla, y compara los
// conteos al final. Pensado para el corte: se corre una vez con el archivo del
// servidor anterior a mano.
//
// Uso:
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... \
//     node scripts/migrate-db-to-turso.mjs --db .data/topykly.sqlite [--apply]
//
// Sin --apply solo informa lo que copiaria. Con --apply exige que la base
// destino este vacia: sobrescribir una base con datos no es una migracion.

import { existsSync } from "node:fs";
import path from "node:path";

import { createBackendStore } from "../services/backend-store.js";
import { createDbClient } from "../services/db-client.js";

const INSERT_CHUNK_SIZE = 200;
// La creacion del esquema escribe sus propios marcadores aca, asi que esta tabla
// no sirve para decidir si el destino esta vacio y se copia pisando.
const BOOKKEEPING_TABLE = "app_metadata";

function readOption(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] || null;
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const sourcePath = path.resolve(readOption(args, "--db") || ".data/topykly.sqlite");

if (!existsSync(sourcePath)) {
  console.error(`No existe la base de origen: ${sourcePath}`);
  process.exit(1);
}

const targetUrl = String(process.env.TURSO_DATABASE_URL || "").trim();
if (!targetUrl) {
  console.error("Falta TURSO_DATABASE_URL.");
  process.exit(1);
}

const source = await createDbClient({ url: `file:${sourcePath}` });
// El destino se abre por el store para que cree el esquema antes de copiar.
const targetStore = await createBackendStore({ seedDemoData: false });
const target = await createDbClient({
  url: targetUrl,
  authToken: String(process.env.TURSO_AUTH_TOKEN || "").trim() || undefined
});

try {
  const tables = (
    await source
      .prepare(
        `
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `
      )
      .all()
  ).map((row) => row.name);

  // Se copia en orden de dependencias. Desactivar las claves foraneas seria mas
  // corto, pero contra una base remota cada peticion puede ir por una conexion
  // distinta y el PRAGMA no sobreviviria a la siguiente.
  const dependencies = new Map();
  for (const table of tables) {
    const references = await source.prepare(`PRAGMA foreign_key_list(${table})`).all();
    dependencies.set(
      table,
      new Set(references.map((reference) => reference.table).filter((name) => name !== table))
    );
  }

  const ordered = [];
  const pending = new Set(tables);
  while (pending.size) {
    const ready = [...pending].filter((table) =>
      [...dependencies.get(table)].every((dependency) => !pending.has(dependency))
    );
    if (!ready.length) {
      // Un ciclo de referencias no se puede ordenar: se copia lo que queda tal
      // cual y el chequeo final dira si algo quedo colgando.
      ordered.push(...pending);
      break;
    }
    for (const table of ready) {
      ordered.push(table);
      pending.delete(table);
    }
  }

  console.log(`tablas en el origen: ${tables.length}`);

  if (apply) {
    for (const table of tables) {
      if (table === BOOKKEEPING_TABLE) {
        continue;
      }
      const existing = await target.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get();
      if (Number(existing?.total || 0) > 0) {
        console.error(
          `La tabla ${table} en el destino ya tiene ${existing.total} filas. ` +
            "Sobrescribir una base con datos no es una migracion; se aborta."
        );
        process.exit(1);
      }
    }
  }

  const summary = [];
  for (const table of ordered) {
    const rows = await source.prepare(`SELECT * FROM ${table}`).all();
    if (!rows.length) {
      summary.push({ table, copied: 0 });
      continue;
    }

    if (apply) {
      const columns = Object.keys(rows[0]);
      const placeholders = `(${columns.map(() => "?").join(", ")})`;
      const verb = table === BOOKKEEPING_TABLE ? "INSERT OR REPLACE INTO" : "INSERT INTO";
      const statement = target.prepare(
        `${verb} ${table} (${columns.join(", ")}) VALUES ${placeholders}`
      );

      // De a tandas y dentro de una transaccion: una fila por viaje de red
      // haria interminable una tabla de mensajes.
      for (let index = 0; index < rows.length; index += INSERT_CHUNK_SIZE) {
        const chunk = rows.slice(index, index + INSERT_CHUNK_SIZE);
        await target.transaction(async (tx) => {
          const txStatement = tx.prepare(statement.sql);
          for (const row of chunk) {
            await txStatement.run(...columns.map((column) => row[column]));
          }
        });
      }
    }

    summary.push({ table, copied: rows.length });
  }

  console.log("");
  for (const entry of summary) {
    if (!apply) {
      console.log(`  ${entry.table}: ${entry.copied} filas a copiar`);
      continue;
    }

    const target_count = await target.prepare(`SELECT COUNT(*) AS total FROM ${entry.table}`).get();
    const copied = Number(target_count?.total || 0);
    const match = copied === entry.copied ? "ok" : "DIFIERE";
    console.log(`  ${entry.table}: origen ${entry.copied} / destino ${copied} ${match}`);
  }

  if (!apply) {
    console.log("\n(sin --apply no se escribio nada)");
  } else {
    // Comprueba que la copia no dejo referencias colgando.
    const violations = await target.prepare("PRAGMA foreign_key_check").all();
    console.log("");
    console.log(
      violations.length
        ? `referencias rotas en el destino: ${violations.length}`
        : "sin referencias rotas en el destino"
    );
  }
} finally {
  source.close();
  target.close();
  await targetStore.close();
}
