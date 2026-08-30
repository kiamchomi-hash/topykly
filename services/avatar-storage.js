import crypto from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

// Los avatares se guardaban en el disco del servidor. En serverless ese disco no
// existe: lo que se escribe muere con la instancia y ninguna otra lo ve. Detras
// de esta interfaz conviven el almacenamiento en disco, que sigue siendo el de
// desarrollo, y el de objetos, que es el de produccion.
//
// owns(url) es lo que impide borrar una url ajena: en la base tambien se guardan
// avatares de proveedores externos, que no son nuestros para eliminar.

export const AVATAR_PUBLIC_PATH = "/avatars";
const AVATAR_CONTENT_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["webp", "image/webp"],
  ["gif", "image/gif"]
]);

function contentTypeFor(extension) {
  return AVATAR_CONTENT_TYPES.get(extension) || "application/octet-stream";
}

export function createDiskAvatarStorage({ directory }) {
  mkdirSync(directory, { recursive: true });

  return {
    kind: "disk",
    directory,
    owns(value) {
      const normalized = String(value || "").trim();
      if (!normalized.startsWith(`${AVATAR_PUBLIC_PATH}/`)) {
        return false;
      }

      const fileName = normalized.slice(AVATAR_PUBLIC_PATH.length + 1);
      // Sin esto una url con separadores escaparia del directorio de avatares.
      return Boolean(fileName) && fileName === path.basename(fileName) && !fileName.startsWith(".");
    },
    async save(buffer, extension) {
      const fileName = `${crypto.randomUUID()}.${extension}`;
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, fileName), buffer, { flag: "wx" });
      return `${AVATAR_PUBLIC_PATH}/${fileName}`;
    },
    async read(url) {
      if (!this.owns(url)) {
        return null;
      }
      try {
        return readFileSync(path.join(directory, path.basename(String(url))));
      } catch {
        return null;
      }
    },
    async remove(url) {
      if (!this.owns(url)) {
        return;
      }
      try {
        unlinkSync(path.join(directory, path.basename(String(url))));
      } catch {
        // Un archivo ya ausente no debe romper el perfil ni la moderacion.
      }
    }
  };
}

export function createBlobAvatarStorage({ token, prefix = "avatars", client = null }) {
  const loadClient = client
    ? async () => client
    : async () => {
        const { del, put } = await import("@vercel/blob");
        return { del, put };
      };

  return {
    kind: "blob",
    directory: null,
    owns(value) {
      const normalized = String(value || "").trim();
      if (!/^https:\/\//i.test(normalized)) {
        return false;
      }
      try {
        // Solo las del almacen propio: el resto son de proveedores externos.
        return new URL(normalized).hostname.endsWith(".vercel-storage.com");
      } catch {
        return false;
      }
    },
    async save(buffer, extension) {
      const { put } = await loadClient();
      const result = await put(`${prefix}/${crypto.randomUUID()}.${extension}`, buffer, {
        access: "public",
        contentType: contentTypeFor(extension),
        addRandomSuffix: false,
        token
      });
      return result.url;
    },
    async read(url) {
      if (!this.owns(url)) {
        return null;
      }
      const response = await fetch(String(url));
      if (!response.ok) {
        return null;
      }
      return Buffer.from(await response.arrayBuffer());
    },
    async remove(url) {
      if (!this.owns(url)) {
        return;
      }
      const { del } = await loadClient();
      try {
        await del(String(url), { token });
      } catch {
        // Un objeto ya ausente no debe romper el perfil ni la moderacion.
      }
    }
  };
}

export function createAvatarStorage({ directory = null, env = process.env, client = null } = {}) {
  const token = String(env.BLOB_READ_WRITE_TOKEN || "").trim();
  if (token || client) {
    return createBlobAvatarStorage({ token, client });
  }

  if (!directory) {
    throw new Error("createAvatarStorage requiere un directorio cuando no hay almacen de objetos.");
  }

  return createDiskAvatarStorage({ directory });
}
