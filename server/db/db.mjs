import dotenv from "dotenv";
import { Pool } from "@neondatabase/serverless";

dotenv.config();

let pool = null;

export function missingDatabaseUrlError() {
  const error = new Error("Missing DATABASE_URL");
  error.status = 500;
  error.payload = { error: "Missing DATABASE_URL" };
  return error;
}

export function requireDatabaseUrl() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw missingDatabaseUrlError();
  return connectionString;
}

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: requireDatabaseUrl(),
      max: Number(process.env.DATABASE_POOL_MAX || 1),
    });
  }
  return pool;
}

export async function query(text, params = []) {
  return getPool().query(text, params);
}

export async function transaction(callback) {
  const client = await getPool().connect();
  const tx = {
    query: (text, params = []) => client.query(text, params),
  };

  try {
    await client.query("BEGIN");
    const result = await callback(tx);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (!pool) return;
  const activePool = pool;
  pool = null;
  await activePool.end();
}
