import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const DEFAULT_DB_PATH = path.join(root, ".data", "topykly.sqlite");

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }

  return args[index + 1] || null;
}

function createBackupFileName(now = new Date()) {
  return `topykly-${now.toISOString().replace(/[:.]/g, "-")}.sqlite`;
}

function escapeSqliteString(value) {
  return String(value).replace(/'/g, "''");
}

export function resolveBackupConfig({ dbPath = null, backupDir = null, env = process.env } = {}) {
  const resolvedDbPath = path.resolve(
    dbPath || env.TOPYKLY_DB_PATH || env.CHETREND_DB_PATH || DEFAULT_DB_PATH
  );
  const resolvedBackupDir = path.resolve(
    backupDir ||
      env.TOPYKLY_BACKUP_DIR ||
      env.CHETREND_BACKUP_DIR ||
      path.join(path.dirname(resolvedDbPath), "backups")
  );

  return {
    dbPath: resolvedDbPath,
    backupDir: resolvedBackupDir
  };
}

export function backupSqliteDatabase({
  dbPath = null,
  backupDir = null,
  now = new Date(),
  env = process.env
} = {}) {
  const config = resolveBackupConfig({ dbPath, backupDir, env });
  if (!existsSync(config.dbPath)) {
    throw new Error(`SQLite database not found: ${config.dbPath}`);
  }

  mkdirSync(config.backupDir, { recursive: true });
  const backupPath = path.join(config.backupDir, createBackupFileName(now));
  const db = new DatabaseSync(config.dbPath);

  try {
    db.exec(`VACUUM INTO '${escapeSqliteString(backupPath)}'`);
  } finally {
    db.close();
  }

  return {
    dbPath: config.dbPath,
    backupDir: config.backupDir,
    backupPath
  };
}

function printHelp() {
  console.log(
    [
      "Usage: node scripts/backup-sqlite.mjs [--db path] [--out-dir path]",
      "",
      "Defaults:",
      "  DB: TOPYKLY_DB_PATH, CHETREND_DB_PATH, or .data/topykly.sqlite",
      "  Output: TOPYKLY_BACKUP_DIR, CHETREND_BACKUP_DIR, or <db-dir>/backups"
    ].join("\n")
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  try {
    const result = backupSqliteDatabase({
      dbPath: readOption(args, "--db"),
      backupDir: readOption(args, "--out-dir")
    });
    console.log(`SQLite backup created: ${result.backupPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
