export const EMPLOYEE_STORAGE_KEY = "timekeeping.registeredEmployees.v1";
export const EMPLOYEE_SHEET_NAME = "Gio lv";
export const EMPLOYEE_EXPORT_FILE_NAME = "RegisHours.xlsx";

// Cấu hình cột dùng chung cho form nhân viên và file RegisHours.xlsx.
export const EMPLOYEE_FIELDS = [
  { key: "branch", label: "Chi nhánh" },
  { key: "employeeCode", label: "Mã N.Viên" },
  { key: "employeeName", label: "Tên N.Viên" },
  { key: "registeredShift", label: "Giờ ĐK" },
  { key: "morningIn", label: "Vào sáng", type: "time" },
  { key: "morningOut", label: "Ra sáng", type: "time" },
  { key: "afternoonIn", label: "Vào chiều", type: "time" },
  { key: "afternoonOut", label: "Ra chiều", type: "time" },
  { key: "eveningIn", label: "Vào Tối", type: "time" },
  { key: "eveningOut", label: "Ra Tối", type: "time" },
  { key: "note", label: "Ghi chú" },
];

export const EMPTY_EMPLOYEE = Object.freeze(
  Object.fromEntries(EMPLOYEE_FIELDS.map(({ key }) => [key, ""])),
);

/** Sinh ID ổn định cho bản ghi nhân viên mới, ưu tiên Web Crypto. */
export function createEmployeeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `employee-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Chuẩn hóa văn bản NFC, loại khoảng trắng thừa; không có side effect. */
export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ");
}

/** Chuẩn hóa văn bản dùng cho tra cứu không phân biệt hoa/thường. */
export function normalizeLookup(value) {
  return normalizeText(value).toLocaleLowerCase("vi-VN");
}

/** Chuẩn hóa mã nhân viên để 403, 00403 và 000403 cùng trỏ về một mã 5 chữ số. */
export function normalizeEmployeeCode(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";

  if (/^\d+$/.test(text)) {
    return text.replace(/^0+(?=\d)/, "").padStart(5, "0");
  }

  return normalizeLookup(text);
}

/** Phân nhóm nhân viên VP/Bếp/Cafe/NORMAL từ tiền tố tên để áp dụng rule chấm công. */
export function getEmployeeGroup(employeeName = "") {
  const name = normalizeText(employeeName)
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");

  if (name.startsWith("vp-")) return "VP";
  if (name.startsWith("bep-")) return "BEP";
  if (
    name.startsWith("cafe-") ||
    name.startsWith("ca phe-") ||
    name.startsWith("caphe-")
  ) {
    return "CAFE";
  }

  return "NORMAL";
}

/** Chuẩn hóa toàn bộ bản ghi nhân viên, đặc biệt đưa giờ về HH:mm khi hợp lệ. */
export function sanitizeEmployee(employee) {
  const sanitized = {
    id: employee.id || createEmployeeId(),
    ...(employee.position ? { position: normalizeText(employee.position) } : {}),
  };

  EMPLOYEE_FIELDS.forEach(({ key, type }) => {
    const value = normalizeText(employee[key]);
    if (type === "time") {
      const match = value.match(/^(\d{1,2}):(\d{2})$/);
      sanitized[key] = match
        ? `${match[1].padStart(2, "0")}:${match[2]}`
        : value;
      return;
    }
    sanitized[key] = value;
  });

  return sanitized;
}

/** Tạo khóa ghép nhân viên theo mã, tên hoặc ID để import không sinh bản ghi trùng. */
export function getEmployeeIdentity(employee) {
  const employeeCode = normalizeLookup(employee.employeeCode);
  if (employeeCode) return `code:${employeeCode}`;

  const employeeName = normalizeLookup(employee.employeeName);
  return employeeName ? `name:${employeeName}` : `id:${employee.id}`;
}

/** Ghép danh sách import vào dữ liệu hiện tại, giữ ID của bản ghi đã tồn tại. */
export function mergeEmployeeLists(currentEmployees, importedEmployees) {
  const merged = new Map(
    currentEmployees.map((employee) => [getEmployeeIdentity(employee), employee]),
  );

  importedEmployees.forEach((employee) => {
    const identity = getEmployeeIdentity(employee);
    const existing = merged.get(identity);
    merged.set(identity, {
      ...existing,
      ...employee,
      id: existing?.id || employee.id || createEmployeeId(),
    });
  });

  return Array.from(merged.values());
}

/** Đọc và sanitize cache nhân viên từ localStorage; trả mảng rỗng nếu dữ liệu lỗi. */
export function loadStoredEmployees() {
  try {
    const storedValue = localStorage.getItem(EMPLOYEE_STORAGE_KEY);
    if (!storedValue) return [];

    const parsed = JSON.parse(storedValue);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeEmployee);
  } catch {
    return [];
  }
}

/** Ghi danh sách nhân viên vào localStorage và báo trạng thái thành công. */
export function saveStoredEmployees(employees) {
  try {
    localStorage.setItem(EMPLOYEE_STORAGE_KEY, JSON.stringify(employees));
    return true;
  } catch {
    return false;
  }
}
