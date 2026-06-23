/**
 * Quản lý rule gán ca ưu tiên trước bước chọn ca gần nhất.
 * Engine chuẩn hóa context, chọn rule enabled có priority cao nhất và trả định nghĩa ca;
 * việc tính phút chấm công vẫn do timekeepingCalculations thực hiện từ giờ trong Employees.
 */
import { normalizeLookup, normalizeText } from "../employees/employeeModel.js";

export const SHIFT_RULES_STORAGE_KEY = "timekeeping.shiftRules.v1";

// Rule mặc định buộc nhân viên 00004 vào ca chiều Thứ 7 trước khi tính giờ.
export const DEFAULT_SHIFT_RULES = [
  {
    id: "employee-00004-saturday-afternoon",
    name: "Nhân viên 00004 làm ca chiều Thứ Bảy",
    enabled: true,
    priority: 1000,
    conditions: {
      employeeCode: "00004",
      weekday: ["T7", "Thứ 7", "Thứ Bảy"],
    },
    assignedShift: "afternoon",
  },
];

// Map key rule sang field giờ đăng ký trên hồ sơ nhân viên.
const SHIFT_DEFINITIONS = {
  morning: {
    key: "morning",
    name: "Sáng",
    startField: "morningIn",
    endField: "morningOut",
  },
  afternoon: {
    key: "afternoon",
    name: "Chiều",
    startField: "afternoonIn",
    endField: "afternoonOut",
  },
  evening: {
    key: "evening",
    name: "Tối",
    startField: "eveningIn",
    endField: "eveningOut",
  },
};

// Chuẩn hóa mã nhân viên và bỏ số 0 đầu để so rule số.
function normalizeEmployeeCode(value) {
  const normalized = normalizeLookup(value).replace(/\s+/g, "");
  if (/^\d+$/.test(normalized)) return normalized.replace(/^0+(?=\d)/, "");
  return normalized;
}

// Quy đổi các alias Thứ/T2.../English về số ngày thống nhất.
function normalizeWeekday(value) {
  const normalized = normalizeLookup(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[.\s_-]+/g, "");
  const aliases = {
    cn: "1",
    chunhat: "1",
    sunday: "1",
    t2: "2",
    thu2: "2",
    thuhai: "2",
    monday: "2",
    t3: "3",
    thu3: "3",
    thuba: "3",
    tuesday: "3",
    t4: "4",
    thu4: "4",
    thutu: "4",
    wednesday: "4",
    t5: "5",
    thu5: "5",
    thunam: "5",
    thursday: "5",
    t6: "6",
    thu6: "6",
    thusau: "6",
    friday: "6",
    t7: "7",
    thu7: "7",
    thubay: "7",
    saturday: "7",
  };
  return aliases[normalized] ?? normalized;
}

// Chọn hàm normalize phù hợp cho từng field điều kiện rule.
function normalizeConditionValue(field, value) {
  if (field === "employeeCode") return normalizeEmployeeCode(value);
  if (field === "weekday") return normalizeWeekday(value);
  return normalizeLookup(value);
}

// Kiểm tra giá trị thực có khớp một hay nhiều giá trị kỳ vọng của rule.
function matchesExpectedValue(field, actualValue, expectedValue) {
  const expectedValues = Array.isArray(expectedValue) ? expectedValue : [expectedValue];
  const normalizedActual = normalizeConditionValue(field, actualValue);
  return expectedValues.some(
    (candidate) => normalizeConditionValue(field, candidate) === normalizedActual,
  );
}

/** Trả định nghĩa ca theo key morning/afternoon/evening. */
export function getShiftDefinition(shiftKey) {
  return SHIFT_DEFINITIONS[normalizeLookup(shiftKey)] ?? null;
}

/** Chọn rule khớp có priority cao nhất và trả shift assignment cho dòng chấm công. */
export function evaluateShiftRules(context, rules = DEFAULT_SHIFT_RULES) {
  const matchingRule = [...rules]
    .filter((rule) => rule.enabled !== false)
    .sort((first, second) => (second.priority ?? 0) - (first.priority ?? 0))
    .find((rule) =>
      Object.entries(rule.conditions ?? {}).every(([field, expectedValue]) =>
        matchesExpectedValue(field, context[field], expectedValue),
      ),
    );

  if (!matchingRule) return null;
  const shift = getShiftDefinition(matchingRule.assignedShift);
  if (!shift) return null;

  return {
    ruleId: matchingRule.id,
    ruleName: matchingRule.name || matchingRule.id,
    priority: matchingRule.priority ?? 0,
    shift,
  };
}

/** Đọc rule ca từ localStorage và merge với rule mặc định; fallback an toàn khi lỗi. */
export function loadStoredShiftRules() {
  try {
    const storedRules = localStorage.getItem(SHIFT_RULES_STORAGE_KEY);
    if (!storedRules) return DEFAULT_SHIFT_RULES;
    const parsedRules = JSON.parse(storedRules);
    if (!Array.isArray(parsedRules)) return DEFAULT_SHIFT_RULES;

    const rulesById = new Map(
      DEFAULT_SHIFT_RULES.map((rule) => [rule.id, rule]),
    );
    parsedRules.forEach((rule) => {
      if (rule?.id) rulesById.set(rule.id, rule);
    });
    return Array.from(rulesById.values());
  } catch {
    return DEFAULT_SHIFT_RULES;
  }
}

/** Ghi cấu hình rule ca xuống localStorage, trả false nếu trình duyệt chặn storage. */
export function saveStoredShiftRules(rules) {
  try {
    localStorage.setItem(SHIFT_RULES_STORAGE_KEY, JSON.stringify(rules));
    return true;
  } catch {
    return false;
  }
}

/** Tạo context đã chuẩn hóa từ dòng chấm công và hồ sơ nhân viên để evaluate rule. */
export function createRuleContext({ employeeCode, weekday, employee }) {
  return {
    employeeCode: normalizeText(employeeCode),
    weekday: normalizeText(weekday),
    branch: normalizeText(employee?.branch),
    position: normalizeText(employee?.position),
  };
}
