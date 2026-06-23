/**
 * Model thuần cho Diary: schema field, normalize ngày/quyền/tag, sort, merge và lookup đối chiếu.
 * Không gọi API; localStorage chỉ được dùng trong hai helper cache tương thích cũ.
 */
import { normalizeLookup, normalizeText } from "../employees/employeeModel.js";

export const DIARY_STORAGE_KEY = "timekeeping.employeeDiary.v1";
export const DIARY_SHEET_NAME = "Xin đi trễ về sớm";
export const DIARY_EXPORT_FILE_NAME = "Dairy.xlsx";
// Các loại ghi chú được dùng để đối chiếu đúng vi phạm trong pipeline chấm công.
export const DIARY_VIOLATION_OPTIONS = Object.freeze([
  "Đi sớm",
  "Đi trễ",
  "Về sớm",
  "Tăng ca",
  "OFF",
]);

const DIARY_CORE_FIELDS = [
  { key: "weekday", label: "Thứ" },
  { key: "date", label: "Ngày", type: "date" },
  { key: "employeeCode", label: "Mã N.Viên" },
  { key: "employeeName", label: "Tên N.Viên" },
  { key: "reason", label: "Lý do" },
  { key: "permission", label: "Có / Không phép" },
  // { key: "bienBan", label: "Biên bản", optional: true },
];

export const DIARY_DATA_FIELDS = [
  ...DIARY_CORE_FIELDS,
  { key: "violationTypes", label: "Loại ghi chú", type: "violationTypes", optional: true },
  { key: "bienBan", label: "Biên bản", optional: true },
  { key: "branch", label: "Chi nhánh", optional: true },
  { key: "creatorCode", label: "Mã người lập", optional: true },
  { key: "creatorName", label: "Người lập biên bản", optional: true },
  { key: "createdAt", label: "Ngày tạo", type: "datetime", optional: true },
  { key: "updatedAt", label: "Ngày cập nhật", type: "datetime", optional: true },
];

export const DIARY_EXPORT_FIELDS = [
  ...DIARY_DATA_FIELDS,
  { key: "hasAttachments", label: "Có hồ sơ", type: "attachmentStatus", optional: true },
];

export const DIARY_FIELDS = [
  ...DIARY_CORE_FIELDS,
  { key: "violationTypes", label: "Loại ghi chú", type: "violationTypes" },
  { key: "creatorName", label: "Người lập biên bản" },
  { key: "attachments", label: "File đính kèm", type: "attachments" },
  { key: "hasAttachments", label: "Có hồ sơ", type: "attachmentStatus" },
];

export const EMPTY_DIARY_ENTRY = Object.freeze({
  ...Object.fromEntries(DIARY_DATA_FIELDS.map(({ key }) => [key, ""])),
  violationTypes: [],
});

/** Sinh ID cho Diary mới, ưu tiên Web Crypto. */
export function createDiaryId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `diary-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Tạo ngày ISO và đồng thời loại các tổ hợp ngày/tháng không tồn tại.
function makeIsoDate(year, month, day) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    return "";
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Chuẩn hóa Date, serial Excel hoặc chuỗi ngày về YYYY-MM-DD. */
export function normalizeDiaryDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return makeIsoDate(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
    );
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return makeIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  const text = normalizeText(value);
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return makeIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));

  match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) return makeIsoDate(Number(match[3]), Number(match[2]), Number(match[1]));

  return "";
}

/** Định dạng ngày Diary thành dd/mm/yyyy để hiển thị. */
export function formatDiaryDate(value) {
  const normalized = normalizeDiaryDate(value);
  if (!normalized) return normalizeText(value);
  const [year, month, day] = normalized.split("-");
  return `${day}/${month}/${year}`;
}

/** Parse ngày Diary thành timestamp phục vụ sort; trả 0 nếu không hợp lệ. */
export function parseDiaryDisplayDate(dateValue) {
  if (!dateValue) return 0;

  if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
    return dateValue.getTime();
  }

  const text = String(dateValue).trim();
  let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const normalized = makeIsoDate(Number(match[3]), Number(match[2]), Number(match[1]));
    return normalized ? Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : 0;
  }

  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const normalized = makeIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    return normalized ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : 0;
  }

  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? 0 : parsed;
}

// Lấy mốc updatedAt/createdAt dùng để phân xử các Diary cùng ngày.
function getDiaryTieBreakTimestamp(entry) {
  const updatedAt = normalizeDiaryTimestamp(entry?.updatedAt ?? entry?.updatedDate);
  const createdAt = normalizeDiaryTimestamp(entry?.createdAt ?? entry?.createdDate);
  return new Date(updatedAt || createdAt || 0).getTime() || 0;
}

/** Sort theo ngày phát sinh Diary mới nhất trước; timestamp tạo/sửa chỉ là tie-break cùng ngày. */
export function sortDiaryEntries(entries) {
  return entries
    .map((entry, originalIndex) => ({ entry, originalIndex }))
    .sort((first, second) => {
      const dateDifference = parseDiaryDisplayDate(second.entry?.date)
        - parseDiaryDisplayDate(first.entry?.date);
      if (dateDifference) return dateDifference;

      const timestampDifference = getDiaryTieBreakTimestamp(second.entry)
        - getDiaryTieBreakTimestamp(first.entry);
      return timestampDifference || first.originalIndex - second.originalIndex;
    })
    .map(({ entry }) => entry);
}

/** Chuẩn hóa timestamp về ISO hoặc chuỗi rỗng nếu không parse được. */
export function normalizeDiaryTimestamp(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/** Định dạng timestamp Diary theo locale Việt Nam. */
export function formatDiaryDateTime(value) {
  const normalized = normalizeDiaryTimestamp(value);
  if (!normalized) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(normalized));
}

/** Suy ra nhãn CN/T2...T7 từ ngày Diary đã chuẩn hóa. */
export function getDiaryWeekday(value) {
  const normalized = normalizeDiaryDate(value);
  if (!normalized) return "";
  const [year, month, day] = normalized.split("-").map(Number);
  return ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][
    new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  ];
}

// Bỏ dấu tiếng Việt để ánh xạ loại ghi chú và trạng thái từ nhiều cách nhập.
function stripVietnameseMarks(value) {
  return normalizeLookup(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

// Chuẩn hóa khóa loại ghi chú trước khi tra bảng alias.
function normalizeViolationKey(value) {
  return stripVietnameseMarks(value).replace(/[\s/_-]+/g, " ");
}

// Map canonical và alias giúp import nhận đúng tên vi phạm, gồm OFF > 2 ngày.
const DIARY_VIOLATION_LOOKUP = new Map(
  DIARY_VIOLATION_OPTIONS.map((option) => [normalizeViolationKey(option), option]),
);
const DIARY_VIOLATION_ALIASES = new Map([
  ["off > 2 ngay", "OFF"],
  ["off > 2", "OFF"],
]);

/** Chuẩn hóa một tên/alias loại ghi chú thành option canonical hoặc chuỗi rỗng. */
export function normalizeDiaryViolationType(value) {
  const key = normalizeViolationKey(value);
  return DIARY_VIOLATION_LOOKUP.get(key) ?? DIARY_VIOLATION_ALIASES.get(key) ?? "";
}

/** Chuẩn hóa một mảng/chuỗi/JSON loại ghi chú thành danh sách canonical không trùng. */
export function normalizeDiaryViolationTypes(value) {
  let rawItems = [];
  if (Array.isArray(value)) {
    rawItems = value;
  } else {
    const text = normalizeText(value);
    if (!text) return [];
    if (text.startsWith("[") && text.endsWith("]")) {
      try {
        const parsed = JSON.parse(text);
        rawItems = Array.isArray(parsed) ? parsed : [];
      } catch {
        rawItems = [];
      }
    } else {
      rawItems = text.split(/[;,|]+/);
    }
  }

  const normalized = rawItems
    .map((item) => normalizeDiaryViolationType(item))
    .filter(Boolean);
  return [...new Set(normalized)];
}

/** Ghép danh sách loại ghi chú thành chuỗi dùng cho bảng và Excel. */
export function formatDiaryViolationTypes(value, emptyText = "") {
  const types = normalizeDiaryViolationTypes(value);
  return types.length ? types.join(", ") : emptyText;
}

/** Chuẩn hóa các alias Có phép/Không phép, giữ nguyên giá trị chưa biết. */
export function normalizeDiaryPermission(value) {
  const text = normalizeText(value);
  const normalized = stripVietnameseMarks(text).replace(/[\s/_-]+/g, " ");
  if (["co phep", "co", "yes", "1"].includes(normalized)) return "Có phép";
  if (["khong phep", "khong", "no", "0"].includes(normalized)) return "Không phép";
  return text;
}

/** Chuẩn hóa mã nhân viên Diary và bỏ số 0 đầu để đối chiếu mã số. */
export function normalizeDiaryEmployeeCode(value) {
  const code = normalizeLookup(value).replace(/\s+/g, "");
  return /^\d+$/.test(code) ? code.replace(/^0+(?=\d)/, "") : code;
}

/** Làm sạch toàn bộ field Diary và bổ sung ID/thứ/timestamp chuẩn. */
export function sanitizeDiaryEntry(entry) {
  const date = normalizeDiaryDate(entry.date);
  const violationTypes = normalizeDiaryViolationTypes(
    entry.violationTypes ?? entry.violation_types ?? entry.tags,
  );
  const sanitized = {
    id: entry.id || createDiaryId(),
    weekday: normalizeText(entry.weekday) || getDiaryWeekday(date),
    date,
    employeeCode: normalizeText(entry.employeeCode),
    employeeName: normalizeText(entry.employeeName),
    reason: normalizeText(entry.reason),
    bienBan: normalizeText(entry.bienBan ?? entry.report),
    branch: normalizeText(entry.branch),
    permission: normalizeDiaryPermission(entry.permission),
    violationTypes,
    creatorCode: normalizeText(entry.creatorCode ?? entry.reporterCode),
    creatorName: normalizeText(entry.creatorName ?? entry.reporterName ?? entry.createdBy),
    createdAt: normalizeDiaryTimestamp(entry.createdAt ?? entry.createdDate),
    updatedAt: normalizeDiaryTimestamp(entry.updatedAt ?? entry.updatedDate),
  };
  return sanitized;
}

/** Tạo khóa ghép Diary theo ngày, người và lý do cho luồng import/merge. */
export function getDiaryIdentity(entry) {
  const code = normalizeDiaryEmployeeCode(entry.employeeCode);
  const name = normalizeLookup(entry.employeeName);
  const person = code ? `code:${code}` : `name:${name}`;
  return `${normalizeDiaryDate(entry.date)}|${person}|${normalizeLookup(entry.reason)}`;
}

/** Ghép Diary import vào dữ liệu hiện tại, giữ ID/createdAt và cập nhật metadata mới. */
export function mergeDiaryEntries(currentEntries, importedEntries) {
  const now = new Date().toISOString();
  const merged = new Map(
    currentEntries.map((entry) => {
      const sanitized = sanitizeDiaryEntry(entry);
      const createdAt = sanitized.createdAt || now;
      return [getDiaryIdentity(sanitized), {
        ...sanitized,
        createdAt,
        updatedAt: sanitized.updatedAt || createdAt,
      }];
    }),
  );

  importedEntries.forEach((entry) => {
    const sanitized = sanitizeDiaryEntry(entry);
    const identity = getDiaryIdentity(sanitized);
    const existing = merged.get(identity);
    const createdAt = existing?.createdAt || sanitized.createdAt || now;
    merged.set(identity, {
      ...existing,
      ...sanitized,
      id: existing?.id || sanitized.id,
      creatorCode: sanitized.creatorCode || existing?.creatorCode || "",
      creatorName: sanitized.creatorName || existing?.creatorName || "",
      createdAt,
      updatedAt: sanitized.updatedAt || now,
    });
  });

  return Array.from(merged.values());
}

/** Đọc, migrate và sanitize Diary trong localStorage; trả mảng rỗng nếu cache lỗi. */
export function loadStoredDiaryEntries() {
  try {
    const storedValue = localStorage.getItem(DIARY_STORAGE_KEY);
    if (!storedValue) return [];
    const parsed = JSON.parse(storedValue);
    if (!Array.isArray(parsed)) return [];
    const migratedAt = new Date().toISOString();
    return parsed.map((entry) => {
      const sanitized = sanitizeDiaryEntry(entry);
      const createdAt = sanitized.createdAt || migratedAt;
      return {
        ...sanitized,
        createdAt,
        updatedAt: sanitized.updatedAt || createdAt,
      };
    });
  } catch {
    return [];
  }
}

/** Ghi danh sách Diary xuống localStorage và trả trạng thái thành công. */
export function saveStoredDiaryEntries(entries) {
  try {
    localStorage.setItem(DIARY_STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

/** Lập chỉ mục Diary theo ngày+mã và ngày+tên để đối chiếu chấm công nhanh. */
export function createDiaryLookup(entries) {
  const byCodeAndDate = new Map();
  const byNameAndDate = new Map();

  entries.map((entry) => ({
    ...sanitizeDiaryEntry(entry),
    attachedFiles: entry.attachedFiles ?? entry.attachments ?? [],
  })).forEach((entry) => {
    if (!entry.date) return;
    const code = normalizeDiaryEmployeeCode(entry.employeeCode);
    const name = normalizeLookup(entry.employeeName);
    if (code) {
      const key = `${entry.date}|${code}`;
      byCodeAndDate.set(key, [...(byCodeAndDate.get(key) ?? []), entry]);
    }
    if (name) {
      const key = `${entry.date}|${name}`;
      byNameAndDate.set(key, [...(byNameAndDate.get(key) ?? []), entry]);
    }
  });

  return { byCodeAndDate, byNameAndDate };
}

/** Tìm Diary có lý do theo ngày và nhân viên, ưu tiên mã trước tên. */
export function findDiaryEntry(lookup, { date, employeeCode, employeeName }) {
  const normalizedDate = normalizeDiaryDate(date);
  if (!normalizedDate) return null;

  const code = normalizeDiaryEmployeeCode(employeeCode);
  const codeMatches = code ? lookup.byCodeAndDate.get(`${normalizedDate}|${code}`) : null;
  const codeEntry = codeMatches?.find(({ reason }) => Boolean(normalizeText(reason)));
  if (codeEntry) return { entry: codeEntry, matchType: "employeeCode" };

  const name = normalizeLookup(employeeName);
  const nameMatches = name ? lookup.byNameAndDate.get(`${normalizedDate}|${name}`) : null;
  const nameEntry = nameMatches?.find(({ reason }) => Boolean(normalizeText(reason)));
  return nameEntry ? { entry: nameEntry, matchType: "employeeName" } : null;
}

// Lấy timestamp sắp xếp để ưu tiên Diary được cập nhật gần nhất.
function diarySortTimestamp(entry) {
  const updated = normalizeDiaryTimestamp(entry?.updatedAt ?? entry?.updatedDate);
  const created = normalizeDiaryTimestamp(entry?.createdAt ?? entry?.createdDate);
  return new Date(updated || created || 0).getTime() || 0;
}

/** Tìm Diary khớp đồng thời ngày, nhân viên và loại vi phạm cho pipeline chấm công. */
export function findDiaryForViolation(lookup, {
  date,
  employeeCode,
  employeeName,
  violationType,
} = {}) {
  const normalizedDate = normalizeDiaryDate(date);
  const normalizedType = normalizeDiaryViolationType(violationType);
  if (!normalizedDate || !normalizedType) return null;

  const code = normalizeDiaryEmployeeCode(employeeCode);
  const name = normalizeLookup(employeeName);
  const candidates = code
    ? lookup.byCodeAndDate.get(`${normalizedDate}|${code}`)
    : name
      ? lookup.byNameAndDate.get(`${normalizedDate}|${name}`)
      : null;

  const matched = (candidates ?? [])
    .filter((entry) => normalizeDiaryViolationTypes(entry.violationTypes).includes(normalizedType))
    .sort((first, second) => diarySortTimestamp(second) - diarySortTimestamp(first));

  if (!matched.length) return null;
  return { entry: matched[0], matchType: code ? "employeeCode" : "employeeName" };
}

/** Kiểm tra entry đã được chuẩn hóa thành trạng thái Có phép hay chưa. */
export function isDiaryPermitted(entry) {
  return normalizeDiaryPermission(entry?.permission) === "Có phép";
}

/** Kiểm tra Diary có ít nhất một attachment đã gắn hay không. */
export function hasDiaryAttachments(entry) {
  const files = entry?.attachedFiles ?? entry?.attachments;
  return Array.isArray(files) && files.length > 0;
}

/** Dựng chuỗi mô tả Diary gồm lý do, phép, hồ sơ và người lập. */
export function buildDiaryNote(entry) {
  const parts = [normalizeText(entry.reason)];
  const permission = normalizeDiaryPermission(entry.permission);
  if (permission) parts.push(permission);
  if (entry.bienBan) parts.push(normalizeText(entry.bienBan));
  parts.push(
    hasDiaryAttachments(entry)
      ? "Có hồ sơ đính kèm"
      : "Chưa bổ sung hồ sơ",
  );
  if (entry.creatorName) parts.push(`Người lập: ${normalizeText(entry.creatorName)}`);
  return parts.join(" - ");
}
