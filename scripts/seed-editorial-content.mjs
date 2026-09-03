import { createBackendStore, resolveDbConfig } from "../services/backend-store.js";

function readArgument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || "";
}

const shouldApply = process.argv.includes("--apply");
const requestedLimit = Number.parseInt(readArgument("limit") || "5", 10);
const limit = Number.isInteger(requestedLimit) ? Math.min(20, Math.max(1, requestedLimit)) : 5;
const explicitDbPath = readArgument("db") || null;
const dataset = readArgument("dataset") || "base";
const dbConfig = resolveDbConfig(explicitDbPath);

if (!["base", "extended"].includes(dataset)) {
  console.error(`Conjunto desconocido: ${dataset}. Use --dataset=base o --dataset=extended.`);
  process.exit(1);
}

if (!shouldApply) {
  console.log(
    `Preparado para insertar hasta ${limit} temas del conjunto "${dataset}" en ${dbConfig.dbPath}.`
  );
  console.log("No se modificó la base. Repite el comando con --apply para confirmar.");
  console.log(
    "Cada tema nuevo puede archivar al tema activo más antiguo cuando ya existen 40 activos."
  );
  process.exit(0);
}

const store = await createBackendStore({
  dbPath: dbConfig.dbPath,
  seedDemoData: true,
  includeFakeFriendRequests: false
});

try {
  const result = await store.seedEditorialContent({ limit, dataset });
  console.log(`Temas editoriales insertados: ${result.insertedTopics}.`);
  console.log(`Cuentas editoriales insertadas: ${result.insertedUsers}.`);
  if (result.archivedTopicIds.length) {
    console.log(`Temas archivados por la rotación: ${result.archivedTopicIds.join(", ")}.`);
  } else {
    console.log("La rotación no archivó temas adicionales.");
  }
} finally {
  await store.close();
}
