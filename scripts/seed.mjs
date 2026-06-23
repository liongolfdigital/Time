import bcrypt from "bcryptjs";
import { closePool, transaction } from "../server/db/db.mjs";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function normalizeUsername(value) {
  return String(value ?? "").trim().toLocaleLowerCase("vi-VN");
}

async function findUser(db, username) {
  const result = await db.query("SELECT id FROM users WHERE username = $1", [normalizeUsername(username)]);
  return result.rows[0] ?? null;
}

async function createUser(db, { username, password, role, fullName, branch = "" }) {
  await db.query(`
    INSERT INTO users (
      username, password_hash, role, full_name, branch, status, created_by
    ) VALUES ($1, $2, $3, $4, $5, 'Active', 'seed')
  `, [
    normalizeUsername(username),
    bcrypt.hashSync(String(password), 12),
    role,
    fullName,
    branch,
  ]);
}

async function run() {
  const adminPassword = requiredEnv("DEFAULT_ADMIN_PASSWORD");
  const managerPassword = requiredEnv("DEFAULT_MANAGER_PASSWORD");
  requiredEnv("JWT_SECRET");
  const managerBranch = process.env.DEFAULT_MANAGER_BRANCH || "Q7";

  await transaction(async (db) => {
    if (!await findUser(db, "admin")) {
      await createUser(db, {
        username: "admin",
        password: adminPassword,
        role: "Admin",
        fullName: "System Admin",
      });
      console.log("Created default admin user.");
    } else {
      console.log("Default admin user already exists.");
    }

    if (!await findUser(db, "manager")) {
      await createUser(db, {
        username: "manager",
        password: managerPassword,
        role: "Manager",
        fullName: "Default Manager",
        branch: managerBranch,
      });
      console.log("Created default manager user.");
    } else {
      console.log("Default manager user already exists.");
    }
  });
}

try {
  await run();
} catch (error) {
  console.error("Seed failed:", error.message);
  process.exitCode = 1;
} finally {
  await closePool().catch(() => {});
}
