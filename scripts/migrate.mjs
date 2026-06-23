import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, transaction } from "../server/db/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.join(__dirname, "..", "migrations");

async function listMigrationFiles() {
  const entries = await fs.readdir(migrationsDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
}

async function run() {
  const files = await listMigrationFiles();
  if (!files.length) {
    console.log("No migration files found.");
    return;
  }

  await transaction(async (db) => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const appliedResult = await db.query("SELECT filename FROM schema_migrations");
    const applied = new Set(appliedResult.rows.map((row) => row.filename));

    for (const filename of files) {
      if (applied.has(filename)) {
        console.log(`Skipping already applied migration: ${filename}`);
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDirectory, filename), "utf8");
      console.log(`Applying migration: ${filename}`);
      await db.query(sql);
      await db.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [filename],
      );
      console.log(`Applied migration: ${filename}`);
    }
  });
}

try {
  await run();
} catch (error) {
  console.error("Migration failed:", error.message);
  if (error.payload) console.error(JSON.stringify(error.payload));
  process.exitCode = 1;
} finally {
  await closePool().catch(() => {});
}
