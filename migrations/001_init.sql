CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL,
  full_name text NOT NULL DEFAULT '',
  branch text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Active',
  created_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
CREATE INDEX IF NOT EXISTS idx_users_role_branch ON users (role, branch);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  username text,
  role text,
  branch text,
  action text NOT NULL,
  target_type text,
  target_id text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs (user_id);

CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch text,
  employee_code text,
  employee_name text,
  registered_shift text,
  morning_in text,
  morning_out text,
  afternoon_in text,
  afternoon_out text,
  evening_in text,
  evening_out text,
  full_in text,
  full_out text,
  note text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_employee_code
  ON employees (employee_code)
  WHERE employee_code IS NOT NULL AND employee_code <> '';
CREATE INDEX IF NOT EXISTS idx_employees_employee_name ON employees (employee_name);
CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees (branch);

CREATE TABLE IF NOT EXISTS diary_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch text,
  weekday text,
  date date NOT NULL,
  employee_code text,
  employee_name text,
  reason text,
  permission text,
  creator_code text,
  creator_name text,
  violation_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diary_entries_date ON diary_entries (date);
CREATE INDEX IF NOT EXISTS idx_diary_entries_employee_code ON diary_entries (employee_code);
CREATE INDEX IF NOT EXISTS idx_diary_entries_employee_name ON diary_entries (employee_name);
CREATE INDEX IF NOT EXISTS idx_diary_entries_branch ON diary_entries (branch);

CREATE TABLE IF NOT EXISTS diary_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diary_entry_id uuid NOT NULL REFERENCES diary_entries(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_type text,
  file_size integer,
  blob_url text NOT NULL,
  blob_pathname text,
  uploaded_by text,
  uploaded_by_account_id uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by_username text,
  branch text,
  uploaded_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diary_attachments_diary_entry_id
  ON diary_attachments (diary_entry_id);
CREATE INDEX IF NOT EXISTS idx_diary_attachments_branch
  ON diary_attachments (branch);

CREATE TABLE IF NOT EXISTS shift_rules (
  id text PRIMARY KEY,
  name text,
  enabled boolean DEFAULT true,
  priority integer DEFAULT 0,
  conditions jsonb,
  assigned_shift text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_employees_updated_at ON employees;
CREATE TRIGGER trg_employees_updated_at
BEFORE UPDATE ON employees
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_diary_entries_updated_at ON diary_entries;
CREATE TRIGGER trg_diary_entries_updated_at
BEFORE UPDATE ON diary_entries
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_shift_rules_updated_at ON shift_rules;
CREATE TRIGGER trg_shift_rules_updated_at
BEFORE UPDATE ON shift_rules
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
