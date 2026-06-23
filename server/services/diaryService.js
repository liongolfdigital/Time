const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIARY_BULK_INSERT_BATCH_SIZE = 300;
const DEFAULT_DIARY_BULK_MAX_ROWS = 10000;

function resolveRecordId(value, createId) {
  const id = String(value ?? "").trim();
  return UUID_PATTERN.test(id) ? id : createId();
}

function removeLegacyReportText(payload = {}) {
  const { bienBan, report, ...safePayload } = payload;
  return safePayload;
}

function normalizeLookup(value, normalizeText) {
  return normalizeText(value).toLocaleLowerCase("vi-VN");
}

function normalizeEmployeeCode(value, normalizeText) {
  const normalized = normalizeLookup(value, normalizeText).replace(/\s+/g, "");
  return /^\d+$/.test(normalized) ? normalized.replace(/^0+(?=\d)/, "") : normalized;
}

function findEmployeeInList(entry, employees, normalizeText) {
  const employeeCode = normalizeEmployeeCode(entry.employeeCode, normalizeText);
  const employeeName = normalizeLookup(entry.employeeName, normalizeText);

  if (employeeCode) {
    const byCode = employees.find((employee) =>
      normalizeEmployeeCode(employee.employeeCode, normalizeText) === employeeCode,
    );
    if (byCode) return byCode;
  }

  return employeeName
    ? employees.find((employee) => normalizeLookup(employee.employeeName, normalizeText) === employeeName)
    : null;
}

function getDiaryBulkMaxRows() {
  const configured = Number(process.env.DIARY_BULK_MAX_ROWS);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_DIARY_BULK_MAX_ROWS;
}

function diaryBulkTooLargeError() {
  const error = new Error("File Diary quá lớn, vui lòng chia nhỏ file để import.");
  error.status = 413;
  return error;
}

function uniqueByLastId(rows) {
  const byId = new Map();
  rows.forEach((row) => byId.set(row.id, row));
  return Array.from(byId.values());
}

export function createDiaryService({
  repository,
  normalizeBranch,
  normalizeText,
  canAccessBranch,
  branchForbiddenError,
  createId,
  nowIso,
  detectRecordBranch,
  findEmployeeForDiary,
  listEmployeesForDiary = async () => [],
  normalizeDiaryViolationTypes,
  sortDiaryEntries,
  serializeDiaryRow,
}) {
  async function resolveBranch(input, user, existingRow = null, { forceManagerBranch = false } = {}) {
    if (existingRow && !canAccessBranch(user, existingRow.branch)) throw branchForbiddenError();
    if (user.role === "Manager" && forceManagerBranch) return normalizeBranch(user.branch);
    const requestedBranch = detectRecordBranch(input);
    const employeeBranch = detectRecordBranch(await findEmployeeForDiary(input));
    const resolvedBranch = employeeBranch || requestedBranch;
    if (user.role === "Manager") {
      if (resolvedBranch && resolvedBranch !== normalizeBranch(user.branch)) throw branchForbiddenError();
      return normalizeBranch(user.branch);
    }
    return resolvedBranch;
  }

  async function saveWithRepository(activeRepository, input, user, existingRow = null, options = {}) {
    const now = nowIso();
    const id = existingRow?.id || resolveRecordId(input.id, createId);
    const branch = await resolveBranch(input, user, existingRow, options);
    const createdAt = existingRow?.created_at || normalizeText(input.createdAt) || now;
    const updatedAt = normalizeText(input.updatedAt) || now;
    const violationTypes = normalizeDiaryViolationTypes(
      input.violationTypes ?? input.violation_types ?? input.tags,
    );
    const payload = removeLegacyReportText({ ...input, id, branch, violationTypes, createdAt, updatedAt });
    if (!normalizeText(payload.date)) {
      const error = new Error("Vui long nhap ngay Diary.");
      error.status = 400;
      throw error;
    }
    await activeRepository.upsert({
      id,
      branch,
      employeeCode: normalizeText(payload.employeeCode),
      employeeName: normalizeText(payload.employeeName),
      violationTypes,
      payload,
      createdAt,
      updatedAt,
    });
    return serializeDiaryRow(await activeRepository.findById(id));
  }

  async function save(input, user, existingRow = null, options = {}) {
    return saveWithRepository(repository, input, user, existingRow, options);
  }

  async function rowsForUser(activeRepository, user) {
    return user.role === "Manager"
      ? activeRepository.listByBranch(user.branch)
      : activeRepository.listAll();
  }

  async function listForUser(user) {
    const rows = await rowsForUser(repository, user);
    return sortDiaryEntries(rows.map(serializeDiaryRow));
  }

  function prepareDiaryRow(input, user, employees, { forceManagerBranch = false, now }) {
    const id = resolveRecordId(input.id, createId);
    const branch = forceManagerBranch
      ? normalizeBranch(user.branch)
      : detectRecordBranch(findEmployeeInList(input, employees, normalizeText)) || detectRecordBranch(input);
    const createdAt = normalizeText(input.createdAt) || now;
    const updatedAt = normalizeText(input.updatedAt) || now;
    const violationTypes = normalizeDiaryViolationTypes(
      input.violationTypes ?? input.violation_types ?? input.tags,
    );
    const payload = removeLegacyReportText({ ...input, id, branch, violationTypes, createdAt, updatedAt });
    if (!normalizeText(payload.date)) {
      const error = new Error("Vui long nhap ngay Diary.");
      error.status = 400;
      throw error;
    }
    return {
      id,
      branch,
      employeeCode: normalizeText(payload.employeeCode),
      employeeName: normalizeText(payload.employeeName),
      violationTypes,
      payload,
      createdAt,
      updatedAt,
    };
  }

  async function replaceDiaryRecords(entries, user) {
    const receivedCount = entries.length;
    if (receivedCount > getDiaryBulkMaxRows()) throw diaryBulkTooLargeError();

    const managerImport = user.role === "Manager";
    const managerBranch = normalizeBranch(user.branch);
    const employees = managerImport ? [] : await listEmployeesForDiary();
    const now = nowIso();
    const sanitizedRows = entries.map((entry) => prepareDiaryRow(entry, user, employees, {
      forceManagerBranch: managerImport,
      now,
    }));
    const rowsToWrite = uniqueByLastId(sanitizedRows);
    const importScope = managerImport ? managerBranch : "ALL";

    return repository.transaction(async (txRepository) => {
      if (managerImport) {
        const existingRows = await txRepository.findRowsByIds(
          rowsToWrite.map(({ id }) => id),
        );
        const forbiddenRow = existingRows.find((row) => !canAccessBranch(user, row.branch));
        if (forbiddenRow) throw branchForbiddenError();
      }

      const dbWriteStarted = Date.now();
      if (managerImport) await txRepository.deleteBranch(managerBranch);
      else await txRepository.deleteAll();
      await txRepository.insertMany(rowsToWrite, DIARY_BULK_INSERT_BATCH_SIZE);
      const dbWriteMs = Date.now() - dbWriteStarted;

      const rows = await rowsForUser(txRepository, user);
      console.info("[TimeKeeping API] diary.bulk_replace", {
        receivedCount,
        sanitizedCount: sanitizedRows.length,
        persistedCount: rowsToWrite.length,
        branch: importScope,
        dbWriteMs,
      });
      return sortDiaryEntries(rows.map(serializeDiaryRow));
    });
  }

  return {
    findRow: repository.findById,
    listForUser,
    listForExport: listForUser,
    save,
    deleteById: repository.deleteById,
    serializeRow: serializeDiaryRow,
    replaceDiaryRecords,
    rollback: async () => {},
  };
}
