// Arma el directorio de estaticos que publica el hosting.
//
// Sin este paso Vercel publicaria el arbol del repositorio entero, que incluye
// backend-store.js, los scripts y la base local. Las reglas de que se publica y
// que no son las mismas que aplica el servidor, importadas de ahi: si se protege
// un archivo nuevo, los dos caminos se enteran a la vez.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROTECTED_STATIC_DIRECTORIES,
  PROTECTED_STATIC_EXTENSIONS,
  PROTECTED_STATIC_ROOT_FILES,
  PUBLIC_SERVICE_MODULES,
  UNPUBLISHED_STATIC_ROOT_FILES
} from "../services/preview-server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "public");

// Nada de esto es entrada del sitio: son datos, herramientas o artefactos.
const EXTRA_EXCLUDED_DIRECTORIES = new Set([
  // services/ no esta entre los directorios protegidos porque el servidor lo
  // resuelve con una regla propia: publica solo los modulos declarados. Aca se
  // excluye del copiado general y se replica esa regla mas abajo.
  "services",
  "public",
  "avatars",
  "api",
  ".data",
  ".git",
  ".github",
  ".githooks",
  ".agents",
  ".vercel",
  ".playwright-cli",
  ".playwright-mcp"
]);

function isPublishableRootEntry(name) {
  if (name.startsWith(".")) {
    return false;
  }
  const lowered = name.toLowerCase();
  if (PROTECTED_STATIC_DIRECTORIES.has(lowered) || EXTRA_EXCLUDED_DIRECTORIES.has(lowered)) {
    return false;
  }
  if (PROTECTED_STATIC_ROOT_FILES.has(lowered) || UNPUBLISHED_STATIC_ROOT_FILES.has(lowered)) {
    return false;
  }
  return !PROTECTED_STATIC_EXTENSIONS.has(path.extname(lowered));
}

function copyEntry(name) {
  const source = path.join(root, name);
  const destination = path.join(outputDir, name);

  if (statSync(source).isDirectory()) {
    cpSync(source, destination, {
      recursive: true,
      filter: (candidate) => !path.basename(candidate).startsWith(".")
    });
    return;
  }

  cpSync(source, destination);
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const published = [];
for (const name of readdirSync(root)) {
  if (!isPublishableRootEntry(name)) {
    continue;
  }
  copyEntry(name);
  published.push(name);
}

// services/ no se publica entero: solo los modulos que el navegador importa.
mkdirSync(path.join(outputDir, "services"), { recursive: true });
for (const moduleName of PUBLIC_SERVICE_MODULES) {
  const source = path.join(root, "services", moduleName);
  if (!existsSync(source)) {
    throw new Error(`Falta un modulo declarado como publico: services/${moduleName}`);
  }
  cpSync(source, path.join(outputDir, "services", moduleName));
}

if (!existsSync(path.join(outputDir, "index.html"))) {
  throw new Error("El build no incluyo index.html.");
}

const leaked = ["services/backend-store.js", "services/preview-server.js", "package.json"].filter(
  (candidate) => existsSync(path.join(outputDir, candidate))
);
if (leaked.length) {
  throw new Error(`El build publicaria archivos del servidor: ${leaked.join(", ")}`);
}

console.log(`estaticos publicados en public/: ${published.length} entradas de raiz`);
console.log(`modulos de services publicados: ${PUBLIC_SERVICE_MODULES.size}`);
