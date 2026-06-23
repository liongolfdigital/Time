import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import express from "express";
import multer from "multer";
import { del, put } from "@vercel/blob";
import {
  query,
  requireDatabaseUrl,
  transaction,
} from "./server/db/db.mjs";
import { createAuthMiddlewares } from "./server/middlewares/authMiddlewares.js";
import { createDiaryRepository } from "./server/repositories/diaryRepository.js";
import { createEmployeeRepository } from "./server/repositories/employeeRepository.js";
import { createAccountRepository } from "./server/repositories/accountRepository.js";
import { createDiaryService } from "./server/services/diaryService.js";
import { createEmployeeService } from "./server/services/employeeService.js";
import { createDiaryController } from "./server/controllers/diaryController.js";
import { createEmployeeController } from "./server/controllers/employeeController.js";
import { registerDiaryImportExportRoutes } from "./server/routes/diaryRoutes.js";
import { registerEmployeeRoutes } from "./server/routes/employeeRoutes.js";
import {
  DEFAULT_BRANCH_CODES,
  detectBranchFromText as detectConfiguredBranchFromText,
  normalizeBranch as normalizeConfiguredBranch,
} from "./src/branches/branchModel.js";
import {
  normalizeDiaryViolationTypes,
  sortDiaryEntries,
} from "./src/diary/diaryModel.js";

try {
  requireDatabaseUrl();
} catch (error) {
  console.error(JSON.stringify(error.payload ?? { error: error.message }));
  throw error;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = process.argv.includes("--dev");
const port = Number(process.env.PORT) || 5173;
const maxFileSizeMb = Number(process.env.ATTACHMENT_MAX_MB) || 20;
const dataDirectory = path.resolve(
  process.env.TIMEKEEPING_DATA_DIR || path.join(__dirname, "data"),
);
const uploadDirectory = path.join(dataDirectory, "uploads");
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const passwordIterations = 120000;
const database = { query, transaction };
const diaryRepository = createDiaryRepository(database);
const employeeRepository = createEmployeeRepository(database);
const accountRepository = createAccountRepository(database);

const allowedExtensions = new Set([
  ".jpg", ".jpeg", ".png", ".webp",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
]);

function isUuid(value) {
  return UUID_PATTERN.test(String(value ?? ""));
}

function nowIso() {
  return new Date().toISOString();
}

function toIso(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function toDateText(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return text.includes("T") ? text.slice(0, 10) : text;
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
}

function normalizeUsername(value) {
  return normalizeText(value).toLocaleLowerCase("vi-VN");
}

function normalizeBranch(value) {
  return normalizeConfiguredBranch(value);
}

function normalizeLookup(value) {
  return normalizeText(value).toLocaleLowerCase("vi-VN");
}

function normalizeEmployeeCode(value) {
  const normalized = normalizeLookup(value).replace(/\s+/g, "");
  return /^\d+$/.test(normalized) ? normalized.replace(/^0+(?=\d)/, "") : normalized;
}

function detectBranchFromText(value) {
  return detectConfiguredBranchFromText(value);
}

function detectRecordBranch(record) {
  const directBranch = [
    record?.branch,
    record?.chiNhanh,
    record?.chi_nhanh,
    record?.store,
    record?.location,
    record?.["Chi nhánh"],
    record?.["CHI NHÁNH"],
    record?.["Chi Nhanh"],
    record?.["CHI NHANH"],
  ].map(detectBranchFromText).find(Boolean);
  if (directBranch) return directBranch;

  return [
    record?.employeeCode,
    record?.code,
    record?.maNhanVien,
    record?.ma_nhan_vien,
    record?.["Mã N.viên"],
    record?.["MÃ N.VIÊN"],
    record?.["Ma N.vien"],
    record?.["MA N.VIEN"],
    record?.employeeName,
    record?.name,
    record?.fullName,
    record?.["Tên N.viên"],
    record?.["TÊN N.VIÊN"],
    record?.["Ten N.vien"],
    record?.["TEN N.VIEN"],
  ].map(detectBranchFromText).find(Boolean) || "";
}

function branchForbiddenError() {
  const error = new Error("Ban khong co quyen truy cap du lieu chi nhanh nay");
  error.status = 403;
  return error;
}

function handleApiError(response, error) {
  return response.status(error.status || 400).json({
    error: error.payload?.error || error.message || "Khong the xu ly yeu cau.",
  });
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashPassword(password) {
  return bcrypt.hashSync(String(password), 12);
}

function verifyLegacyPbkdf2(password, storedHash) {
  const [algorithm, iterationsText, salt, expectedHash] = String(storedHash).split("$");
  if (algorithm !== "pbkdf2" || !salt || !expectedHash) return false;
  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const actualHash = crypto.pbkdf2Sync(
    String(password),
    salt,
    iterations,
    Buffer.from(expectedHash, "hex").length,
    "sha256",
  );
  const expected = Buffer.from(expectedHash, "hex");
  return expected.length === actualHash.length && crypto.timingSafeEqual(expected, actualHash);
}

function verifyPassword(password, storedHash) {
  if (String(storedHash).startsWith("$2")) {
    return bcrypt.compareSync(String(password), storedHash);
  }
  return verifyLegacyPbkdf2(password, storedHash);
}

function canonicalRole(value) {
  const role = normalizeUsername(value);
  if (role === "admin") return "Admin";
  if (role === "manager") return "Manager";
  return normalizeText(value);
}

function serializeAccount(row) {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: canonicalRole(row.role),
    branch: row.branch,
    status: row.status,
    createdAt: toIso(row.created_at),
    createdBy: row.created_by,
  };
}

async function getAccountById(id) {
  return accountRepository.findById(id);
}

async function getAccountByUsername(username) {
  return accountRepository.findByUsername(normalizeUsername(username));
}

async function activeAdminCountExcluding(accountId = "") {
  return accountRepository.activeAdminCountExcluding(accountId);
}

function validateRole(value) {
  const role = canonicalRole(value);
  if (!["Admin", "Manager"].includes(role)) {
    throw new Error("Vai tro chi duoc la Admin hoac Manager.");
  }
  return role;
}

function validateStatus(value) {
  const status = normalizeText(value);
  if (!["Active", "Inactive"].includes(status)) {
    throw new Error("Trang thai chi duoc la Active hoac Inactive.");
  }
  return status;
}

async function insertAccount({
  username,
  password,
  fullName,
  role,
  branch = "",
  status = "Active",
  createdBy = "system",
}) {
  const normalizedUsername = normalizeUsername(username);
  const normalizedRole = validateRole(role);
  const normalizedStatus = validateStatus(status);
  const normalizedBranch = normalizedRole === "Manager" ? normalizeBranch(branch) : normalizeText(branch);

  if (!normalizedUsername) throw new Error("Vui long nhap Username.");
  if (!normalizeText(fullName)) throw new Error("Vui long nhap Ho ten.");
  if (String(password ?? "").length < 6) throw new Error("Mat khau phai co it nhat 6 ky tu.");
  if (normalizedRole === "Manager" && !normalizedBranch) {
    throw new Error("Manager phai duoc gan chi nhanh.");
  }

  const account = {
    id: crypto.randomUUID(),
    username: normalizedUsername,
    passwordHash: hashPassword(password),
    fullName: normalizeText(fullName),
    role: normalizedRole,
    branch: normalizedRole === "Manager" ? normalizedBranch : normalizeText(branch),
    status: normalizedStatus,
    createdAt: nowIso(),
    createdBy: normalizeText(createdBy) || "system",
  };

  await accountRepository.insert(account);
  return serializeAccount({
    id: account.id,
    username: account.username,
    full_name: account.fullName,
    role: account.role,
    branch: account.branch,
    status: account.status,
    created_at: account.createdAt,
    created_by: account.createdBy,
  });
}

async function logAudit({ user = null, action, targetType = "", targetId = "", detail = null }) {
  await accountRepository.insertAudit({
    id: crypto.randomUUID(),
    accountId: user?.id ?? null,
    username: user?.username ?? null,
    role: user?.role ?? null,
    branch: user?.branch ?? null,
    action,
    targetType,
    targetId,
    detail: detail === null || detail === undefined ? null : JSON.stringify(detail),
    createdAt: nowIso(),
  });
}

function readBearerToken(request) {
  const authorization = String(request.headers.authorization ?? "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]?.trim()) return match[1].trim();

  const cookie = String(request.headers.cookie ?? "");
  const cookieMatch = cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("timekeeping_session="));
  return cookieMatch ? decodeURIComponent(cookieMatch.slice("timekeeping_session=".length)) : "";
}

async function getSession(token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = await accountRepository.findActiveSession(tokenHash, nowIso());

  if (!row || row.status !== "Active") return null;
  return { tokenHash, user: serializeAccount(row) };
}

const {
  requireAuth,
  requireAdmin,
  requireDiaryImportExport,
} = createAuthMiddlewares({ getSession, readBearerToken });

function canAccessBranch(user, branch) {
  if (user?.role === "Admin") return true;
  const normalizedBranch = normalizeBranch(branch);
  return Boolean(user?.branch) && Boolean(normalizedBranch) && normalizedBranch === normalizeBranch(user.branch);
}

function parsePayload(row) {
  if (!row?.payload) return {};
  if (typeof row.payload === "object") return row.payload;
  try {
    return JSON.parse(row.payload || "{}");
  } catch {
    return {};
  }
}

function serializeEmployeeRow(row) {
  const payload = parsePayload(row);
  return {
    ...payload,
    id: row.id,
    branch: row.branch ?? payload.branch ?? "",
    employeeCode: payload.employeeCode ?? row.employee_code ?? "",
    employeeName: payload.employeeName ?? row.employee_name ?? "",
    registeredShift: payload.registeredShift ?? row.registered_shift ?? "",
    morningIn: payload.morningIn ?? row.morning_in ?? "",
    morningOut: payload.morningOut ?? row.morning_out ?? "",
    afternoonIn: payload.afternoonIn ?? row.afternoon_in ?? "",
    afternoonOut: payload.afternoonOut ?? row.afternoon_out ?? "",
    eveningIn: payload.eveningIn ?? row.evening_in ?? "",
    eveningOut: payload.eveningOut ?? row.evening_out ?? "",
    fullIn: payload.fullIn ?? row.full_in ?? "",
    fullOut: payload.fullOut ?? row.full_out ?? "",
    note: payload.note ?? row.note ?? "",
    createdAt: payload.createdAt || toIso(row.created_at),
    updatedAt: payload.updatedAt || toIso(row.updated_at),
  };
}

function serializeDiaryRow(row) {
  const payload = parsePayload(row);
  const violationTypes = normalizeDiaryViolationTypes(
    payload.violationTypes ?? payload.violation_types ?? row.violation_types,
  );
  return {
    ...payload,
    id: row.id,
    branch: row.branch ?? payload.branch ?? "",
    weekday: payload.weekday ?? row.weekday ?? "",
    date: payload.date || toDateText(row.date),
    employeeCode: payload.employeeCode ?? row.employee_code ?? "",
    employeeName: payload.employeeName ?? row.employee_name ?? "",
    reason: payload.reason ?? row.reason ?? "",
    permission: payload.permission ?? row.permission ?? "",
    violationTypes,
    creatorCode: payload.creatorCode ?? row.creator_code ?? "",
    creatorName: payload.creatorName ?? row.creator_name ?? "",
    createdAt: payload.createdAt || toIso(row.created_at),
    updatedAt: payload.updatedAt || toIso(row.updated_at),
  };
}

const employeeService = createEmployeeService({
  repository: employeeRepository,
  createId: () => crypto.randomUUID(),
  nowIso,
  normalizeText,
  detectRecordBranch,
  normalizeBranch,
  canAccessBranch,
  branchForbiddenError,
  serializeEmployeeRow,
});

async function findEmployeeForDiary(entry) {
  const employeeCode = normalizeEmployeeCode(entry.employeeCode);
  const employeeName = normalizeLookup(entry.employeeName);
  const employees = await employeeService.listAll();

  if (employeeCode) {
    const byCode = employees.find((employee) =>
      normalizeEmployeeCode(employee.employeeCode) === employeeCode,
    );
    if (byCode) return byCode;
  }

  return employeeName
    ? employees.find((employee) => normalizeLookup(employee.employeeName) === employeeName)
    : null;
}

const diaryService = createDiaryService({
  repository: diaryRepository,
  normalizeBranch,
  normalizeText,
  canAccessBranch,
  branchForbiddenError,
  createId: () => crypto.randomUUID(),
  nowIso,
  detectRecordBranch,
  findEmployeeForDiary,
  normalizeDiaryViolationTypes,
  sortDiaryEntries,
  serializeDiaryRow,
});
const diaryController = createDiaryController({
  diaryService,
  logAudit,
  normalizeBranch,
  handleApiError,
});
const employeeController = createEmployeeController({
  employeeService,
  logAudit,
  handleApiError,
});

function canAccessAttachment(user, attachment) {
  if (!attachment) return false;
  if (user?.role === "Admin") return true;
  return canAccessBranch(user, attachment.branch);
}

function canModifyAttachment(user, attachment) {
  if (!canAccessAttachment(user, attachment)) return false;
  if (user?.role === "Admin") return true;
  return attachment.uploaded_by_account_id === user.id ||
    normalizeUsername(attachment.uploaded_by_username) === normalizeUsername(user.username);
}

async function removeStoredFile(attachment) {
  const blobUrl = attachment?.blob_url || "";
  const pathname = attachment?.blob_pathname || "";
  if (/^https?:\/\//i.test(blobUrl)) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return;
    await del(blobUrl).catch(() => {});
    return;
  }
  if (!pathname) return;
  await fs.promises.unlink(pathname).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

function serializeAttachment(row) {
  return {
    id: row.id,
    diaryEntryId: row.diary_entry_id,
    fileName: row.file_name,
    fileType: row.file_type,
    fileSize: row.file_size,
    filePath: `/api/attachments/${row.id}/content`,
    blobUrl: row.blob_url,
    uploadedBy: row.uploaded_by,
    uploadedByAccountId: row.uploaded_by_account_id,
    uploadedByUsername: row.uploaded_by_username,
    uploadedDate: toIso(row.uploaded_date || row.created_at),
    branch: row.branch,
  };
}

async function getAttachment(id, activeDb = database) {
  if (!isUuid(id)) return null;
  const result = await activeDb.query("SELECT * FROM diary_attachments WHERE id = $1", [id]);
  return result.rows[0] ?? null;
}

async function listAttachments({ diaryEntryId, user }) {
  const clauses = [];
  const values = [];
  if (diaryEntryId) {
    if (!isUuid(diaryEntryId)) return [];
    values.push(diaryEntryId);
    clauses.push(`diary_entry_id = $${values.length}`);
  }
  if (user.role === "Manager") {
    values.push(user.branch);
    clauses.push(`UPPER(branch) = UPPER($${values.length})`);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await query(`
    SELECT * FROM diary_attachments
    ${whereSql}
    ORDER BY uploaded_date DESC, created_at DESC
  `, values);
  return result.rows;
}

function safeFilename(name) {
  return path.basename(String(name || "attachment")).replace(/[^\w.-]+/g, "_");
}

async function storeUploadedFile(file, id) {
  const extension = path.extname(file.originalname).toLocaleLowerCase();
  const storedName = `${Date.now()}-${safeFilename(file.originalname) || `${id}${extension}`}`;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`diary-attachments/${id}/${storedName}`, file.buffer, {
      access: "public",
      contentType: file.mimetype || "application/octet-stream",
      addRandomSuffix: false,
    });
    return { blobUrl: blob.url, blobPathname: blob.pathname };
  }

  await fs.promises.mkdir(uploadDirectory, { recursive: true });
  const localPath = path.join(uploadDirectory, `${id}-${storedName}`);
  await fs.promises.writeFile(localPath, file.buffer);
  return { blobUrl: `/api/attachments/${id}/content`, blobPathname: localPath };
}

async function insertAttachment(values, activeDb = database) {
  await activeDb.query(`
    INSERT INTO diary_attachments (
      id, diary_entry_id, file_name, file_type, file_size,
      blob_url, blob_pathname, uploaded_by, uploaded_by_account_id,
      uploaded_by_username, uploaded_date, branch
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9,
      $10, $11, $12
    )
  `, [
    values.id,
    values.diaryEntryId,
    values.fileName,
    values.fileType,
    values.fileSize,
    values.blobUrl,
    values.blobPathname,
    values.uploadedBy,
    values.uploadedByAccountId,
    values.uploadedByUsername,
    values.uploadedDate,
    values.branch,
  ]);
}

async function updateAttachment(values, activeDb = database) {
  await activeDb.query(`
    UPDATE diary_attachments
    SET file_name = $1, file_type = $2, file_size = $3,
        blob_url = $4, blob_pathname = $5, uploaded_by = $6,
        uploaded_by_account_id = $7, uploaded_by_username = $8,
        uploaded_date = $9, branch = $10
    WHERE id = $11
  `, [
    values.fileName,
    values.fileType,
    values.fileSize,
    values.blobUrl,
    values.blobPathname,
    values.uploadedBy,
    values.uploadedByAccountId,
    values.uploadedByUsername,
    values.uploadedDate,
    values.branch,
    values.id,
  ]);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFileSizeMb * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLocaleLowerCase();
    callback(
      allowedExtensions.has(extension)
        ? null
        : new Error("Dinh dang file khong duoc ho tro."),
      allowedExtensions.has(extension),
    );
  },
});

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.post("/api/auth/login", async (request, response) => {
  const username = normalizeUsername(request.body?.username);
  const password = String(request.body?.password ?? "");
  const account = username ? await getAccountByUsername(username) : null;

  if (!account || !verifyPassword(password, account.password_hash)) {
    await logAudit({
      user: account ? serializeAccount(account) : { username },
      action: "auth.login_failed",
      targetType: "account",
      targetId: account?.id ?? username,
    });
    return response.status(401).json({ error: "Ten dang nhap hoac mat khau khong dung." });
  }

  if (account.status !== "Active") {
    await logAudit({
      user: serializeAccount(account),
      action: "auth.login_blocked",
      targetType: "account",
      targetId: account.id,
    });
    return response.status(403).json({ error: "Tai khoan dang bi khoa." });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
  await accountRepository.createSession({ tokenHash, accountId: account.id, createdAt, expiresAt });

  const user = serializeAccount(account);
  await logAudit({ user, action: "auth.login", targetType: "account", targetId: account.id });
  response.cookie?.("timekeeping_session", token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: sessionTtlMs,
    path: "/",
  });
  return response.json({ token, user, expiresAt });
});

app.get("/api/auth/me", requireAuth, (request, response) => {
  response.json({ user: request.user });
});

app.post("/api/auth/logout", requireAuth, async (request, response) => {
  await accountRepository.deleteSessionByToken(request.sessionTokenHash);
  await logAudit({ user: request.user, action: "auth.logout", targetType: "account", targetId: request.user.id });
  response.clearCookie?.("timekeeping_session", { path: "/" });
  response.status(204).end();
});

app.get("/api/accounts", requireAuth, requireAdmin, async (_request, response) => {
  response.json((await accountRepository.list()).map(serializeAccount));
});

app.post("/api/accounts", requireAuth, requireAdmin, async (request, response) => {
  try {
    const account = await insertAccount({
      ...request.body,
      createdBy: request.user.username,
    });
    await logAudit({
      user: request.user,
      action: "account.create",
      targetType: "account",
      targetId: account.id,
      detail: { username: account.username, role: account.role, branch: account.branch },
    });
    return response.status(201).json(account);
  } catch (error) {
    return response.status(400).json({
      error: error.code === "23505" ? "Username da ton tai." : error.message,
    });
  }
});

app.put("/api/accounts/:id", requireAuth, requireAdmin, async (request, response) => {
  const account = await getAccountById(request.params.id);
  if (!account) return response.status(404).json({ error: "Khong tim thay tai khoan." });

  try {
    const nextRole = validateRole(request.body?.role ?? account.role);
    const nextStatus = validateStatus(request.body?.status ?? account.status);
    const nextUsername = normalizeUsername(request.body?.username ?? account.username);
    const nextFullName = normalizeText(request.body?.fullName ?? account.full_name);
    const nextBranch = nextRole === "Manager"
      ? normalizeBranch(request.body?.branch ?? account.branch)
      : normalizeText(request.body?.branch ?? "");

    if (!nextUsername) throw new Error("Vui long nhap Username.");
    if (!nextFullName) throw new Error("Vui long nhap Ho ten.");
    if (nextRole === "Manager" && !nextBranch) throw new Error("Manager phai duoc gan chi nhanh.");
    if (
      canonicalRole(account.role) === "Admin" &&
      (nextRole !== "Admin" || nextStatus !== "Active") &&
      await activeAdminCountExcluding(account.id) === 0
    ) {
      throw new Error("Khong the khoa hoac doi vai tro Admin hoat dong cuoi cung.");
    }
    if (account.id === request.user.id && nextStatus !== "Active") {
      throw new Error("Khong the tu khoa tai khoan dang dang nhap.");
    }

    await accountRepository.update({
      id: account.id,
      username: nextUsername,
      fullName: nextFullName,
      role: nextRole,
      branch: nextBranch,
      status: nextStatus,
    });

    const updated = serializeAccount(await getAccountById(account.id));
    await logAudit({
      user: request.user,
      action: "account.update",
      targetType: "account",
      targetId: account.id,
      detail: { username: updated.username, role: updated.role, branch: updated.branch, status: updated.status },
    });
    return response.json(updated);
  } catch (error) {
    return response.status(400).json({
      error: error.code === "23505" ? "Username da ton tai." : error.message,
    });
  }
});

app.post("/api/accounts/:id/password", requireAuth, requireAdmin, async (request, response) => {
  const account = await getAccountById(request.params.id);
  if (!account) return response.status(404).json({ error: "Khong tim thay tai khoan." });

  const password = String(request.body?.password ?? "");
  if (password.length < 6) {
    return response.status(400).json({ error: "Mat khau phai co it nhat 6 ky tu." });
  }

  await accountRepository.updatePassword(account.id, hashPassword(password));
  await accountRepository.deleteSessionsByAccount(account.id);
  await logAudit({
    user: request.user,
    action: "account.reset_password",
    targetType: "account",
    targetId: account.id,
    detail: { username: account.username },
  });
  response.json(serializeAccount(await getAccountById(account.id)));
});

app.delete("/api/accounts/:id", requireAuth, requireAdmin, async (request, response) => {
  const account = await getAccountById(request.params.id);
  if (!account) return response.status(404).json({ error: "Khong tim thay tai khoan." });
  if (account.id === request.user.id) {
    return response.status(400).json({ error: "Khong the xoa tai khoan dang dang nhap." });
  }
  if (canonicalRole(account.role) === "Admin" && await activeAdminCountExcluding(account.id) === 0) {
    return response.status(400).json({ error: "Khong the xoa Admin hoat dong cuoi cung." });
  }

  await accountRepository.deleteSessionsByAccount(account.id);
  await accountRepository.deleteById(account.id);
  await logAudit({
    user: request.user,
    action: "account.delete",
    targetType: "account",
    targetId: account.id,
    detail: { username: account.username, role: account.role, branch: account.branch },
  });
  response.status(204).end();
});

app.post("/api/audit-logs", requireAuth, async (request, response) => {
  const action = normalizeText(request.body?.action);
  if (!action) return response.status(400).json({ error: "Thieu ten thao tac can ghi log." });

  await logAudit({
    user: request.user,
    action,
    targetType: normalizeText(request.body?.targetType),
    targetId: normalizeText(request.body?.targetId),
    detail: request.body?.detail ?? null,
  });
  response.status(201).json({ ok: true });
});

app.get("/api/audit-logs", requireAuth, requireAdmin, async (request, response) => {
  const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 500);
  const rows = await accountRepository.listAudit(limit);
  response.json(rows.map((row) => ({
    id: row.id,
    accountId: row.user_id,
    username: row.username,
    role: row.role,
    branch: row.branch,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    detail: row.detail === null || row.detail === undefined
      ? null
      : typeof row.detail === "string" ? row.detail : JSON.stringify(row.detail),
    createdAt: toIso(row.created_at),
  })));
});

registerEmployeeRoutes(app, {
  requireAuth,
  requireAdmin,
  controller: employeeController,
});

app.delete("/api/diary/bulk", requireAuth, requireDiaryImportExport, async (request, response) => {
  const ids = Array.isArray(request.body?.ids)
    ? [...new Set(request.body.ids.map((id) => normalizeText(id)).filter(isUuid))]
    : [];
  if (!ids.length) {
    return response.status(400).json({ error: "Danh sach Diary can xoa khong duoc de trong." });
  }

  const diaryRows = (await Promise.all(ids.map((id) => diaryService.findRow(id)))).filter(Boolean);
  const forbiddenRow = diaryRows.find((row) => !canAccessBranch(request.user, row.branch));
  if (forbiddenRow) return handleApiError(response, branchForbiddenError());

  const deletedIds = diaryRows.map(({ id }) => id);
  let deletedAttachments = [];
  try {
    deletedAttachments = await transaction(async (tx) => {
      const attachments = [];
      for (const id of deletedIds) {
        const attachmentRows = await tx.query(
          "SELECT * FROM diary_attachments WHERE diary_entry_id = $1",
          [id],
        );
        attachments.push(...attachmentRows.rows);
        await tx.query("DELETE FROM diary_attachments WHERE diary_entry_id = $1", [id]);
        await tx.query("DELETE FROM diary_entries WHERE id = $1", [id]);
      }
      return attachments;
    });
  } catch (error) {
    return handleApiError(response, error);
  }

  await Promise.all(deletedAttachments.map(removeStoredFile));
  await logAudit({
    user: request.user,
    action: "diary.bulk_delete",
    targetType: "diary",
    detail: { ids: deletedIds, deletedCount: deletedIds.length },
  });
  return response.json({ deletedCount: deletedIds.length, deletedIds });
});

registerDiaryImportExportRoutes(app, {
  requireAuth,
  requireAdmin,
  requireDiaryImportExport,
  diaryController,
});

app.get("/api/attachments/config", requireAuth, (_request, response) => {
  response.json({
    maxFileSizeMb,
    allowedExtensions: Array.from(allowedExtensions),
    storage: process.env.BLOB_READ_WRITE_TOKEN ? "vercel-blob" : "local",
  });
});

app.get("/api/attachments", requireAuth, async (request, response) => {
  const diaryEntryId = String(request.query.diaryEntryId ?? "").trim();
  const rows = await listAttachments({ diaryEntryId, user: request.user });
  response.json(rows.map(serializeAttachment));
});

app.post("/api/attachments/:diaryEntryId", requireAuth, (request, response, next) => {
  upload.single("file")(request, response, (error) => {
    if (error) return next(error);

    (async () => {
      const diaryEntryId = String(request.params.diaryEntryId ?? "").trim();
      const uploadedBy = normalizeText(request.body.uploadedBy) || request.user.fullName;
      const replaceAttachmentId = String(request.body.replaceAttachmentId ?? "").trim();
      const requestedBranch = normalizeBranch(request.body.branch);

      if (!request.file || !isUuid(diaryEntryId) || !uploadedBy) {
        return response.status(400).json({
          error: "Can co file, ma Diary va nguoi upload.",
        });
      }

      const diaryRow = await diaryService.findRow(diaryEntryId);
      if (!diaryRow) return response.status(404).json({ error: "Khong tim thay ghi chu." });
      if (!canAccessBranch(request.user, diaryRow.branch)) {
        return response.status(403).json({ error: "Ban khong co quyen truy cap du lieu chi nhanh nay" });
      }
      if (request.user.role === "Manager" && requestedBranch && requestedBranch !== normalizeBranch(request.user.branch)) {
        return response.status(403).json({ error: "Ban khong co quyen truy cap du lieu chi nhanh nay" });
      }

      const previousAttachment = replaceAttachmentId
        ? await getAttachment(replaceAttachmentId)
        : null;
      if (replaceAttachmentId && previousAttachment?.diary_entry_id !== diaryEntryId) {
        return response.status(404).json({ error: "Khong tim thay file can thay the." });
      }
      if (previousAttachment && !canModifyAttachment(request.user, previousAttachment)) {
        return response.status(403).json({ error: "Ban khong co quyen truy cap du lieu chi nhanh nay" });
      }

      const id = previousAttachment?.id || crypto.randomUUID();
      const uploadedDate = nowIso();
      const storedFile = await storeUploadedFile(request.file, id);
      const values = {
        id,
        diaryEntryId,
        fileName: request.file.originalname,
        fileType: request.file.mimetype || "application/octet-stream",
        fileSize: request.file.size,
        blobUrl: storedFile.blobUrl,
        blobPathname: storedFile.blobPathname,
        uploadedBy,
        uploadedByAccountId: request.user.id,
        uploadedByUsername: request.user.username,
        uploadedDate,
        branch: previousAttachment?.branch || diaryRow.branch || requestedBranch,
      };

      try {
        if (previousAttachment) await updateAttachment(values);
        else await insertAttachment(values);
      } catch (saveError) {
        await removeStoredFile({ blob_url: values.blobUrl, blob_pathname: values.blobPathname });
        throw saveError;
      }
      if (previousAttachment) await removeStoredFile(previousAttachment);

      const savedAttachment = serializeAttachment(await getAttachment(id));
      await logAudit({
        user: request.user,
        action: previousAttachment ? "attachment.replace" : "attachment.upload",
        targetType: "attachment",
        targetId: id,
        detail: {
          diaryEntryId,
          fileName: savedAttachment.fileName,
          branch: savedAttachment.branch,
        },
      });
      return response.status(previousAttachment ? 200 : 201).json(savedAttachment);
    })().catch(next);
  });
});

app.get("/api/attachments/:id/content", requireAuth, async (request, response) => {
  const attachment = await getAttachment(request.params.id);
  if (!attachment) {
    return response.status(404).json({ error: "Khong tim thay file dinh kem." });
  }
  if (!canAccessAttachment(request.user, attachment)) {
    return response.status(403).json({ error: "Ban khong co quyen truy cap du lieu chi nhanh nay" });
  }
  if (/^https?:\/\//i.test(attachment.blob_url)) {
    return response.redirect(302, attachment.blob_url);
  }
  if (!attachment.blob_pathname || !fs.existsSync(attachment.blob_pathname)) {
    return response.status(404).json({ error: "Khong tim thay file dinh kem." });
  }

  const inline =
    request.query.download !== "1" &&
    (attachment.file_type.startsWith("image/") || attachment.file_type === "application/pdf");
  const disposition = inline ? "inline" : "attachment";
  const encodedName = encodeURIComponent(attachment.file_name);
  response.setHeader("Content-Type", attachment.file_type);
  response.setHeader("Content-Length", attachment.file_size);
  response.setHeader(
    "Content-Disposition",
    `${disposition}; filename*=UTF-8''${encodedName}`,
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  return response.sendFile(attachment.blob_pathname);
});

app.delete("/api/attachments/:id", requireAuth, async (request, response) => {
  const attachment = await getAttachment(request.params.id);
  if (!attachment) return response.status(404).json({ error: "Khong tim thay file." });
  if (!canModifyAttachment(request.user, attachment)) {
    return response.status(403).json({ error: "Ban khong co quyen truy cap du lieu chi nhanh nay" });
  }

  await query("DELETE FROM diary_attachments WHERE id = $1", [attachment.id]);
  await removeStoredFile(attachment);
  await logAudit({
    user: request.user,
    action: "attachment.delete",
    targetType: "attachment",
    targetId: attachment.id,
    detail: {
      diaryEntryId: attachment.diary_entry_id,
      fileName: attachment.file_name,
      branch: attachment.branch,
    },
  });
  return response.status(204).end();
});

app.delete("/api/diary/:diaryEntryId/attachments", requireAuth, requireAdmin, async (request, response) => {
  const diaryEntryId = String(request.params.diaryEntryId ?? "").trim();
  if (!isUuid(diaryEntryId)) return response.status(404).json({ error: "Khong tim thay ghi chu." });
  const result = await query(
    "SELECT * FROM diary_attachments WHERE diary_entry_id = $1",
    [diaryEntryId],
  );
  await query("DELETE FROM diary_attachments WHERE diary_entry_id = $1", [diaryEntryId]);
  await Promise.all(result.rows.map(removeStoredFile));
  await logAudit({
    user: request.user,
    action: "diary.attachments.delete_all",
    targetType: "diary",
    targetId: diaryEntryId,
    detail: { attachmentCount: result.rows.length },
  });
  return response.status(204).end();
});

app.use("/api", (_request, response) => {
  response.status(404).json({ error: "Khong tim thay API." });
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return response.status(413).json({
      error: `File vuot qua gioi han ${maxFileSizeMb}MB.`,
    });
  }
  return response.status(error.status || 400).json({
    error: error.payload?.error || error.message || "Khong the xu ly file.",
  });
});

if (isDevelopment) {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  const distDirectory = path.join(__dirname, "dist");
  app.use(express.static(distDirectory));
  app.use((request, response, next) => {
    if (request.method !== "GET" || !request.accepts("html")) return next();
    return response.sendFile(path.join(distDirectory, "index.html"));
  });
}

if (process.env.VERCEL !== "1" && process.env.TIMEKEEPING_LISTEN !== "0") {
  app.listen(port, () => {
    console.log(`Timekeeping server running at http://localhost:${port}`);
  });
}

export default app;
