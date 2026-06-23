const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveRecordId(value, createId) {
  const id = String(value ?? "").trim();
  return UUID_PATTERN.test(id) ? id : createId();
}

export function createEmployeeService({
  repository,
  createId,
  nowIso,
  normalizeText,
  detectRecordBranch,
  normalizeBranch,
  canAccessBranch,
  branchForbiddenError,
  serializeEmployeeRow,
}) {
  function resolveBranch(input, user, existingRow = null) {
    if (existingRow && !canAccessBranch(user, existingRow.branch)) {
      throw branchForbiddenError();
    }
    const requestedBranch = detectRecordBranch(input);
    if (user.role === "Manager") {
      if (requestedBranch && requestedBranch !== normalizeBranch(user.branch)) {
        throw branchForbiddenError();
      }
      return normalizeBranch(user.branch);
    }
    return requestedBranch;
  }

  async function saveWithRepository(activeRepository, input, user, existingRow = null) {
    const now = nowIso();
    const id = existingRow?.id || resolveRecordId(input.id, createId);
    const branch = resolveBranch(input, user, existingRow);
    const createdAt = existingRow?.created_at || normalizeText(input.createdAt) || now;
    const payload = { ...input, id, branch, createdAt, updatedAt: now };
    await activeRepository.upsert({ id, branch, payload, createdAt, updatedAt: now });
    return serializeEmployeeRow(await activeRepository.findById(id));
  }

  async function save(input, user, existingRow = null) {
    return saveWithRepository(repository, input, user, existingRow);
  }

  async function rowsForUser(activeRepository, user) {
    return user.role === "Manager"
      ? activeRepository.listByBranch(user.branch)
      : activeRepository.listAll();
  }

  async function listForUser(user) {
    const rows = await rowsForUser(repository, user);
    return rows.map(serializeEmployeeRow);
  }

  async function replaceAll(employees, user) {
    return repository.transaction(async (txRepository) => {
      await txRepository.deleteAll();
      for (const employee of employees) {
        await saveWithRepository(txRepository, employee, user);
      }
      const rows = await rowsForUser(txRepository, user);
      return rows.map(serializeEmployeeRow);
    });
  }

  return {
    findRow: repository.findById,
    listAll: async () => (await repository.listAll()).map(serializeEmployeeRow),
    listForUser,
    save,
    deleteById: repository.deleteById,
    replaceAll,
    serializeRow: serializeEmployeeRow,
  };
}
