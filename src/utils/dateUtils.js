import { normalizeText } from "../employees/employeeModel.js";

/** Parse ngày chấm công từ Date, serial Excel, ISO hoặc dd/mm/yyyy; trả về null nếu không hợp lệ. */
export function parseAttendanceDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
  }
  const text = normalizeText(value);
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  return match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : null;
}

/** Kiểm tra giá trị ngày có rơi vào thứ `day` theo chuẩn Date.getDay hay không. */
export function isWeekday(value, day) {
  const date = parseAttendanceDate(value);
  return date ? date.getDay() === day : false;
}
