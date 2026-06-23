const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return UUID_PATTERN.test(String(value ?? ""));
}

function text(value) {
  return String(value ?? "").trim();
}

function stripLegacyReportText(payload = {}) {
  const { bienBan, report, ...safePayload } = payload;
  return safePayload;
}

function toDiaryValues(row) {
  const safePayload = stripLegacyReportText(row.payload);
  return [
    row.id,
    text(row.branch),
    text(safePayload.weekday),
    text(safePayload.date),
    text(row.employeeCode),
    text(row.employeeName),
    text(safePayload.reason),
    text(safePayload.permission),
    text(safePayload.creatorCode),
    text(safePayload.creatorName),
    JSON.stringify(row.violationTypes ?? []),
    JSON.stringify(safePayload ?? {}),
    row.createdAt,
    row.updatedAt,
  ];
}

export function createDiaryRepository(database) {
  return {
    async findById(id) {
      if (!isUuid(id)) return null;
      const result = await database.query("SELECT * FROM diary_entries WHERE id = $1", [id]);
      return result.rows[0] ?? null;
    },
    async listAll() {
      const result = await database.query("SELECT * FROM diary_entries ORDER BY date DESC, updated_at DESC");
      return result.rows;
    },
    async listByBranch(branch) {
      const result = await database.query(
        "SELECT * FROM diary_entries WHERE UPPER(branch) = UPPER($1) ORDER BY date DESC, updated_at DESC",
        [branch],
      );
      return result.rows;
    },
    async upsert({
      id,
      branch,
      employeeCode,
      employeeName,
      violationTypes,
      payload,
      createdAt,
      updatedAt,
    }) {
      await database.query(`
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
      `, toDiaryValues({
        id,
        branch,
        employeeCode,
        employeeName,
        violationTypes,
        payload,
        createdAt,
        updatedAt,
      }));
    },
    async insertMany(rows, batchSize = 300) {
      for (let start = 0; start < rows.length; start += batchSize) {
        const batch = rows.slice(start, start + batchSize);
        const values = batch.flatMap(toDiaryValues);
        const placeholders = batch.map((_, rowIndex) => {
          const offset = rowIndex * 14;
          return `(
            $${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6},
            $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10},
            $${offset + 11}::jsonb, $${offset + 12}::jsonb, $${offset + 13}, $${offset + 14}
          )`;
        }).join(",");

        await database.query(`
          INSERT INTO diary_entries (
            id, branch, weekday, date, employee_code, employee_name,
            reason, permission, creator_code, creator_name,
            violation_types, payload, created_at, updated_at
          ) VALUES ${placeholders}
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
        `, values);
      }
    },
    async deleteById(id) {
      if (!isUuid(id)) return;
      await database.query("DELETE FROM diary_entries WHERE id = $1", [id]);
    },
    async deleteAll() {
      await database.query("DELETE FROM diary_entries");
    },
    async deleteBranch(branch) {
      await database.query("DELETE FROM diary_entries WHERE UPPER(branch) = UPPER($1)", [branch]);
    },
    async findRowsByIds(ids) {
      const safeIds = [...new Set(ids.filter(isUuid))];
      if (!safeIds.length) return [];
      const result = await database.query(
        "SELECT id, branch FROM diary_entries WHERE id = ANY($1::uuid[])",
        [safeIds],
      );
      return result.rows;
    },
    transaction(callback) {
      return database.transaction((tx) => callback(createDiaryRepository(tx)));
    },
  };
}
