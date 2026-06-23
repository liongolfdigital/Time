const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveRecordId(value, createId) {
  const id = String(value ?? "").trim();
  return UUID_PATTERN.test(id) ? id : createId();
}

function removeLegacyReportText(payload = {}) {
  const { bienBan, report, ...safePayload } = payload;
  return safePayload;
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

  async function replaceDiaryRecords(entries, user) {
    const managerImport = user.role === "Manager";
    const managerBranch = normalizeBranch(user.branch);
    if (managerImport) {
      for (const entry of entries) {
        const existing = entry?.id ? await repository.findById(normalizeText(entry.id)) : null;
        if (existing && !canAccessBranch(user, existing.branch)) throw branchForbiddenError();
      }
    }
    return repository.transaction(async (txRepository) => {
      if (managerImport) await txRepository.deleteBranch(managerBranch);
      else await txRepository.deleteAll();
      for (const entry of entries) {
        await saveWithRepository(
          txRepository,
          managerImport ? { ...entry, branch: managerBranch } : entry,
          user,
          null,
          { forceManagerBranch: managerImport },
        );
      }
      const rows = await rowsForUser(txRepository, user);
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
