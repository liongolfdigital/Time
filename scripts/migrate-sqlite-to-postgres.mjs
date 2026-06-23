import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { closePool, transaction } from "../server/db/db.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.join(__dirname, "..");
const sqlitePath = process.env.TIMEKEEPING_SQLITE_PATH ||
  process.env.SQLITE_PATH ||
  path.join(rootDirectory, "data", "timekeeping.sqlite");

function stableUuid(namespace, value) {
  const bytes = crypto.createHash("sha256").update(`${namespace}:${value}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function mapId(cache, namespace, value) {
  const id = String(value ?? "").trim();
  if (UUID_PATTERN.test(id)) return id.toLocaleLowerCase();
  if (!cache.has(id)) cache.set(id, stableUuid(namespace, id || crypto.randomUUID()));
  return cache.get(id);
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function tableExists(sqlite, tableName) {
  return Boolean(sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(tableName));
}

function readRows(sqlite, tableName) {
  return tableExists(sqlite, tableName)
    ? sqlite.prepare(`SELECT * FROM ${tableName}`).all()
    : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function stripLegacyReportText(payload = {}) {
  const { bienBan, report, ...safePayload } = payload;
  return safePayload;
}

async function run() {
  if (!fs.existsSync(sqlitePath)) {
    console.log(`No SQLite database found at ${sqlitePath}. Nothing to migrate.`);
    return;
  }

  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  const userIds = new Map();
  const employeeIds = new Map();
  const diaryIds = new Map();
  const attachmentIds = new Map();
  const counts = { users: 0, employees: 0, diary: 0, attachments: 0, skippedDiary: 0, skippedAttachments: 0 };

  try {
    await transaction(async (db) => {
      for (const row of readRows(sqlite, "accounts")) {
        const id = mapId(userIds, "user", row.id);
        await db.query(`
          INSERT INTO users (
            id, username, password_hash, full_name, role, branch, status, created_at, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT(id) DO UPDATE SET
            username = excluded.username,
            password_hash = excluded.password_hash,
            full_name = excluded.full_name,
            role = excluded.role,
            branch = excluded.branch,
            status = excluded.status,
            created_by = excluded.created_by
        `, [
          id,
          row.username,
          row.password_hash,
          row.full_name || row.username,
          row.role,
          row.branch || "",
          row.status || "Active",
          row.created_at || new Date().toISOString(),
          row.created_by || "sqlite-migration",
        ]);
        counts.users += 1;
      }

      for (const row of readRows(sqlite, "employees")) {
        const payload = parseJson(row.payload);
        const id = mapId(employeeIds, "employee", row.id || payload.id);
        payload.id = id;
        await db.query(`
          INSERT INTO employees (
            id, branch, employee_code, employee_name, registered_shift,
            morning_in, morning_out, afternoon_in, afternoon_out,
            evening_in, evening_out, full_in, full_out, note,
            payload, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9,
            $10, $11, $12, $13, $14,
            $15::jsonb, $16, $17
          )
          ON CONFLICT(id) DO UPDATE SET
            branch = excluded.branch,
            employee_code = excluded.employee_code,
            employee_name = excluded.employee_name,
            registered_shift = excluded.registered_shift,
            payload = excluded.payload,
            updated_at = excluded.updated_at
        `, [
          id,
          row.branch || payload.branch || "",
          payload.employeeCode || "",
          payload.employeeName || "",
          payload.registeredShift || "",
          payload.morningIn || "",
          payload.morningOut || "",
          payload.afternoonIn || "",
          payload.afternoonOut || "",
          payload.eveningIn || "",
          payload.eveningOut || "",
          payload.fullIn || "",
          payload.fullOut || "",
          payload.note || "",
          JSON.stringify(payload),
          row.created_at || payload.createdAt || new Date().toISOString(),
          row.updated_at || payload.updatedAt || new Date().toISOString(),
        ]);
        counts.employees += 1;
      }

      for (const row of readRows(sqlite, "diary_entries")) {
        const payload = stripLegacyReportText(parseJson(row.payload));
        const date = payload.date || row.date;
        if (!date) {
          counts.skippedDiary += 1;
          continue;
        }
        const id = mapId(diaryIds, "diary", row.id || payload.id);
        payload.id = id;
        const violationTypes = parseJson(row.violation_types, payload.violationTypes || []);
        await db.query(`
          INSERT INTO diary_entries (
            id, branch, weekday, date, employee_code, employee_name,
            reason, permission, creator_code, creator_name,
            violation_types, payload, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10,
            $11::jsonb, $12::jsonb, $13, $14
          )
          ON CONFLICT(id) DO UPDATE SET
            branch = excluded.branch,
            weekday = excluded.weekday,
            date = excluded.date,
            employee_code = excluded.employee_code,
            employee_name = excluded.employee_name,
            reason = excluded.reason,
            permission = excluded.permission,
            creator_code = excluded.creator_code,
            creator_name = excluded.creator_name,
            violation_types = excluded.violation_types,
            payload = excluded.payload,
            updated_at = excluded.updated_at
        `, [
          id,
          row.branch || payload.branch || "",
          payload.weekday || "",
          date,
          row.employee_code || payload.employeeCode || "",
          row.employee_name || payload.employeeName || "",
          payload.reason || "",
          payload.permission || "",
          payload.creatorCode || "",
          payload.creatorName || "",
          JSON.stringify(violationTypes),
          JSON.stringify({ ...payload, violationTypes }),
          row.created_at || payload.createdAt || new Date().toISOString(),
          row.updated_at || payload.updatedAt || new Date().toISOString(),
        ]);
        counts.diary += 1;
      }

      for (const row of readRows(sqlite, "attachments")) {
        const legacyDiaryId = String(row.diary_entry_id ?? "").trim();
        if (!diaryIds.has(legacyDiaryId) && !UUID_PATTERN.test(legacyDiaryId)) {
          counts.skippedAttachments += 1;
          continue;
        }
        const id = mapId(attachmentIds, "attachment", row.id);
        const diaryEntryId = UUID_PATTERN.test(legacyDiaryId)
          ? legacyDiaryId
          : diaryIds.get(legacyDiaryId);
        await db.query(`
          INSERT INTO diary_attachments (
            id, diary_entry_id, file_name, file_type, file_size,
            blob_url, blob_pathname, uploaded_by, uploaded_by_account_id,
            uploaded_by_username, uploaded_date, branch
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9,
            $10, $11, $12
          )
          ON CONFLICT(id) DO UPDATE SET
            diary_entry_id = excluded.diary_entry_id,
            file_name = excluded.file_name,
            file_type = excluded.file_type,
            file_size = excluded.file_size,
            blob_url = excluded.blob_url,
            blob_pathname = excluded.blob_pathname,
            uploaded_by = excluded.uploaded_by,
            uploaded_by_account_id = excluded.uploaded_by_account_id,
            uploaded_by_username = excluded.uploaded_by_username,
            uploaded_date = excluded.uploaded_date,
            branch = excluded.branch
        `, [
          id,
          diaryEntryId,
          row.file_name,
          row.file_type || "application/octet-stream",
          row.file_size || 0,
          `/api/attachments/${id}/content`,
          row.file_path || "",
          row.uploaded_by || "",
          UUID_PATTERN.test(row.uploaded_by_account_id) ? row.uploaded_by_account_id : null,
          row.uploaded_by_username || "",
          row.uploaded_date || new Date().toISOString(),
          row.branch || "",
        ]);
        counts.attachments += 1;
      }
    });
  } finally {
    sqlite.close();
  }

  console.log(`Migrated users: ${counts.users}`);
  console.log(`Migrated employees: ${counts.employees}`);
  console.log(`Migrated diary entries: ${counts.diary}`);
  console.log(`Migrated attachments: ${counts.attachments}`);
  if (counts.skippedDiary) console.log(`Skipped diary entries without date: ${counts.skippedDiary}`);
  if (counts.skippedAttachments) console.log(`Skipped attachments without migrated diary entry: ${counts.skippedAttachments}`);
  console.log("SQLite source was left unchanged.");
}

try {
  await run();
} catch (error) {
  console.error("SQLite to Postgres migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await closePool().catch(() => {});
}
