// Sube al almacen de objetos los avatares que todavia estan en disco y reescribe
// las urls guardadas en la base. Pensado para correr una sola vez, con la copia
// del disco del servidor anterior a mano.
//
// Uso:
//   BLOB_READ_WRITE_TOKEN=... TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... \
//     node scripts/migrate-avatars-to-blob.mjs --avatars <dir> [--apply]
//
// Sin --apply solo informa lo que haria.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { createAvatarStorage } from "../services/avatar-storage.js";
import { createDbClient } from "../services/db-client.js";

function readOption(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] || null;
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const avatarsDir = path.resolve(readOption(args, "--avatars") || "avatars");

if (!existsSync(avatarsDir)) {
  console.error(`No existe el directorio de avatares: ${avatarsDir}`);
  process.exit(1);
}

const databaseUrl = String(process.env.TURSO_DATABASE_URL || "").trim();
if (!databaseUrl) {
  console.error("Falta TURSO_DATABASE_URL: sin base destino no hay nada que reescribir.");
  process.exit(1);
}

if (!String(process.env.BLOB_READ_WRITE_TOKEN || "").trim()) {
  console.error("Falta BLOB_READ_WRITE_TOKEN: no hay almacen de objetos donde subir.");
  process.exit(1);
}

const db = await createDbClient({
  url: databaseUrl,
  authToken: String(process.env.TURSO_AUTH_TOKEN || "").trim() || undefined
});
const storage = createAvatarStorage();

try {
  const onDisk = new Set(readdirSync(avatarsDir));
  const rows = await db
    .prepare(
      `
    SELECT id, avatar_url, avatar_pending_url
    FROM users
    WHERE avatar_url LIKE '/avatars/%' OR avatar_pending_url LIKE '/avatars/%'
  `
    )
    .all();

  console.log(`archivos en disco: ${onDisk.size}`);
  console.log(`usuarios con avatar local: ${rows.length}`);

  // Un mismo archivo puede estar referenciado dos veces (actual y pendiente).
  const uploads = new Map();
  let missing = 0;

  async function urlFor(storedUrl) {
    const normalized = String(storedUrl || "").trim();
    if (!normalized.startsWith("/avatars/")) {
      return normalized || null;
    }

    if (uploads.has(normalized)) {
      return uploads.get(normalized);
    }

    const fileName = path.basename(normalized);
    if (!onDisk.has(fileName)) {
      missing += 1;
      console.warn(`  falta en disco, se deja en null: ${normalized}`);
      uploads.set(normalized, null);
      return null;
    }

    if (!apply) {
      uploads.set(normalized, normalized);
      return normalized;
    }

    const extension = path.extname(fileName).replace(".", "") || "png";
    const uploadedUrl = await storage.save(
      readFileSync(path.join(avatarsDir, fileName)),
      extension
    );
    uploads.set(normalized, uploadedUrl);
    return uploadedUrl;
  }

  let updated = 0;
  for (const row of rows) {
    const nextAvatar = await urlFor(row.avatar_url);
    const nextPending = await urlFor(row.avatar_pending_url);

    if (apply) {
      await db
        .prepare("UPDATE users SET avatar_url = ?, avatar_pending_url = ? WHERE id = ?")
        .run(nextAvatar, nextPending, row.id);
    }
    updated += 1;
  }

  console.log(`archivos subidos: ${[...uploads.values()].filter(Boolean).length}`);
  console.log(`referencias sin archivo: ${missing}`);
  console.log(`usuarios ${apply ? "actualizados" : "que se actualizarian"}: ${updated}`);
  if (!apply) {
    console.log("\n(sin --apply no se subio ni se escribio nada)");
  }
} finally {
  db.close();
}
