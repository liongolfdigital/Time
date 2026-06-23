/**
 * Chuyển kết quả tính từng dòng thành metadata highlight dùng chung cho Excel và bảng preview.
 * Module chỉ nhận diện trạng thái; việc mutate style cell nằm trong excelHighlightService.
 */
import { normalizeLookup, normalizeText } from "../employees/employeeModel.js";
import { getAbnormalAttendance } from "../services/attendance/abnormalAttendanceService.js";
import { HIGHLIGHT_COLORS } from "../constants/colorConstants.js";

export { HIGHLIGHT_COLORS };

// Key semantic cho màu phát sinh, lỗi clock và trạng thái Diary trong Excel/preview CSS.
export const HIGHLIGHT_TYPES = {
  off: "off",
  earlyIn: "earlyIn",
  late: "late",
  early: "early",
  overtime: "overtime",
  multiplePunches: "multiplePunches",
  missingClock: "missingClock",
  permitted: "permitted",
  notPermitted: "notPermitted",
  missingDiary: "missingDiary",
  fullDay: "fullDay",
};

// Chuẩn hóa Date/serial/chuỗi dd/mm/yyyy thành ngày UTC cho phép nhóm theo tuần.
function toUtcDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
  }

  const match = normalizeText(value).match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
}

/** Trả khóa ngày Thứ 2 đầu tuần cho một ngày chấm công. */
export function getWeekKey(dateValue) {
  const date = toUtcDate(dateValue);
  if (!date || Number.isNaN(date.getTime())) return null;

  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

/** Tạo khóa nhân viên dùng gom dòng chấm công, ưu tiên mã trước tên. */
export function getAttendanceEmployeeKey(employeeCode, employeeName) {
  return normalizeLookup(employeeCode) || normalizeLookup(employeeName) || null;
}

/** Kiểm tra bộ clock có ít nhất một giá trị Vào/Ra hay không. */
export function hasAnyClockValue(clockValues) {
  return Object.values(clockValues).some(
    (value) => value !== null && value !== undefined && value !== "",
  );
}

/** Nhận diện ngày OFF từ việc thiếu clock, thiếu Tổng làm hoặc ghi chú OFF. */
export function isOffAttendanceDay(note, clockValues, totalWorkedMinutes = null) {
  const hasNoClock = !hasAnyClockValue(clockValues);
  const hasNoWorkedTime =
    totalWorkedMinutes === null ||
    totalWorkedMinutes === undefined ||
    Number(totalWorkedMinutes) <= 0;
  const hasOffNote = /(^|[\s;,])off($|[\s;,])/i.test(normalizeText(note));

  return hasNoClock && (hasNoWorkedTime || hasOffNote);
}

/** Chuyển kết quả từng dòng thành metadata highlight cho Excel và preview. */
export function buildAttendanceHighlights(rows) {
  return rows.map((row) => {
    const abnormalAttendance = getAbnormalAttendance(row.clockValues);

    return {
      row: row.row,
      longOff: Boolean(row.longOff),
      longOffStatus: row.longOffStatus ?? null,
      earlyIn: Number(row.calculation.earlyInMinutes) > 0,
      late: Number(row.calculation.lateMinutes) > 0,
      early: Number(row.calculation.earlyMinutes) > 0,
      overtime: Number(row.calculation.overtimeMinutes) > 0,
      violationStatuses: row.calculation.violationStatuses ?? {},
      multiplePunches: row.multiplePunches
        ?? (abnormalAttendance.abnormal ? { slots: abnormalAttendance.slots } : null),
      missingClock: abnormalAttendance.missingClock,
      offSequenceLength: row.offSequenceLength ?? 0,
      employeeKey: row.employeeKey,
      weekKey: row.weekKey,
    };
  });
}
