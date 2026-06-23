const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return UUID_PATTERN.test(String(value ?? ""));
}

export function createAccountRepository(database) {
  return {
    async findById(id) {
      if (!isUuid(id)) return null;
      const result = await database.query("SELECT * FROM users WHERE id = $1", [id]);
      return result.rows[0] ?? null;
    },
    async findByUsername(username) {
      const result = await database.query("SELECT * FROM users WHERE username = $1", [username]);
      return result.rows[0] ?? null;
    },
    async activeAdminCountExcluding(accountId = "") {
      const result = await database.query(`
        SELECT COUNT(*)::int AS count FROM users
        WHERE role = 'Admin' AND status = 'Active' AND id != COALESCE($1::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
      `, [isUuid(accountId) ? accountId : null]);
      return result.rows[0]?.count ?? 0;
    },
    async insert(account) {
      await database.query(`
        INSERT INTO users (
          id, username, password_hash, full_name, role, branch, status, created_at, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        account.id,
        account.username,
        account.passwordHash,
        account.fullName,
        account.role,
        account.branch,
        account.status,
        account.createdAt,
        account.createdBy,
      ]);
    },
    async updateBranch(id, branch) {
      if (!isUuid(id)) return;
      await database.query("UPDATE users SET branch = $1 WHERE id = $2", [branch, id]);
    },
    async list() {
      const result = await database.query(`
        SELECT id, username, full_name, role, branch, status, created_at, created_by
        FROM users ORDER BY role, branch, username
      `);
      return result.rows;
    },
    async update({ id, username, fullName, role, branch, status }) {
      if (!isUuid(id)) return;
      await database.query(`
        UPDATE users SET username = $1, full_name = $2, role = $3, branch = $4, status = $5
        WHERE id = $6
      `, [username, fullName, role, branch, status, id]);
    },
    async updatePassword(id, passwordHash) {
      if (!isUuid(id)) return;
      await database.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, id]);
    },
    async deleteById(id) {
      if (!isUuid(id)) return;
      await database.query("DELETE FROM users WHERE id = $1", [id]);
    },
    async findActiveSession(tokenHash, now) {
      const result = await database.query(`
        SELECT users.id, users.username, users.full_name, users.role,
               users.branch, users.status, users.created_at, users.created_by
        FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = $1 AND sessions.expires_at > $2
      `, [tokenHash, now]);
      return result.rows[0] ?? null;
    },
    async createSession({ tokenHash, accountId, createdAt, expiresAt }) {
      await database.query("DELETE FROM sessions WHERE expires_at <= $1", [createdAt]);
      await database.query(`
        INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
        VALUES ($1, $2, $3, $4)
      `, [tokenHash, accountId, createdAt, expiresAt]);
    },
    async deleteSessionByToken(tokenHash) {
      await database.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
    },
    async deleteSessionsByAccount(accountId) {
      if (!isUuid(accountId)) return;
      await database.query("DELETE FROM sessions WHERE user_id = $1", [accountId]);
    },
    async insertAudit(record) {
      await database.query(`
        INSERT INTO audit_logs (
          id, user_id, username, role, branch, action, target_type, target_id, detail, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      `, [
        record.id,
        isUuid(record.accountId) ? record.accountId : null,
        record.username,
        record.role,
        record.branch,
        record.action,
        record.targetType,
        record.targetId,
        record.detail,
        record.createdAt,
      ]);
    },
    async listAudit(limit) {
      const result = await database.query(
        "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1",
        [limit],
      );
      return result.rows;
    },
  };
}
