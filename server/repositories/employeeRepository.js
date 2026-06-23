const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return UUID_PATTERN.test(String(value ?? ""));
}

function text(value) {
  return String(value ?? "").trim();
}

export function createEmployeeRepository(database) {
  return {
    async findById(id) {
      if (!isUuid(id)) return null;
      const result = await database.query("SELECT * FROM employees WHERE id = $1", [id]);
      return result.rows[0] ?? null;
    },
    async listAll() {
      const result = await database.query("SELECT * FROM employees ORDER BY branch, employee_name, id");
      return result.rows;
    },
    async listByBranch(branch) {
      const result = await database.query(
        "SELECT * FROM employees WHERE UPPER(branch) = UPPER($1) ORDER BY branch, employee_name, id",
        [branch],
      );
      return result.rows;
    },
    async upsert({ id, branch, payload, createdAt, updatedAt }) {
      const values = [
        id,
        text(branch),
        text(payload.employeeCode),
        text(payload.employeeName),
        text(payload.registeredShift),
        text(payload.morningIn),
        text(payload.morningOut),
        text(payload.afternoonIn),
        text(payload.afternoonOut),
        text(payload.eveningIn),
        text(payload.eveningOut),
        text(payload.fullIn),
        text(payload.fullOut),
        text(payload.note),
        JSON.stringify(payload ?? {}),
        createdAt,
        updatedAt,
      ];
      await database.query(`
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
          morning_in = excluded.morning_in,
          morning_out = excluded.morning_out,
          afternoon_in = excluded.afternoon_in,
          afternoon_out = excluded.afternoon_out,
          evening_in = excluded.evening_in,
          evening_out = excluded.evening_out,
          full_in = excluded.full_in,
          full_out = excluded.full_out,
          note = excluded.note,
          payload = excluded.payload,
          updated_at = excluded.updated_at
      `, values);
    },
    async deleteById(id) {
      if (!isUuid(id)) return;
      await database.query("DELETE FROM employees WHERE id = $1", [id]);
    },
    async deleteAll() {
      await database.query("DELETE FROM employees");
    },
    transaction(callback) {
      return database.transaction((tx) => callback(createEmployeeRepository(tx)));
    },
  };
}
