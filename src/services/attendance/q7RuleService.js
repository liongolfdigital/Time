/**
 * Rule Q7 Thứ 2: giới hạn ca nhân viên thường vào khung hoạt động 09:00-21:00
 * và trả phần thiếu do cửa hàng đóng để cộng vào Về sớm.
 */
import {
  Q7_MONDAY_CLOSE_MINUTES,
  Q7_MONDAY_OPEN_MINUTES,
} from "../../constants/attendanceConstants.js";
import { getEmployeeGroup, normalizeLookup, normalizeText } from "../../employees/employeeModel.js";
import { isWeekday } from "../../utils/dateUtils.js";

// Chuẩn hóa tên ca/chi nhánh về dạng không dấu để so khớp rule ổn định.
function normalizeShiftKey(value) {
  return normalizeLookup(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Ä‘/g, "d");
}

/** Kiểm tra mã chi nhánh có đại diện cho Q7 hay không. */
export function isQ7Branch(value) {
  const branch = normalizeShiftKey(value).replace(/[\s_-]+/g, "");
  return branch === "q7" || branch === "quan7";
}

/** Parse Giờ ĐK dạng số giờ hoặc HH:mm thành phút. */
export function parseRegisteredShiftMinutes(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 60);
  const text = normalizeText(value).replace(",", ".");
  if (!text) return null;
  const timeMatch = text.match(/^(\d{1,2})\s*[:h]\s*([0-5]?\d)$/i);
  if (timeMatch) return Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
  const numberMatch = text.match(/(\d+(?:\.\d+)?)/);
  if (!numberMatch) return null;
  const hours = Number(numberMatch[1]);
  return Number.isFinite(hours) ? Math.round(hours * 60) : null;
}

/** Quyết định có áp dụng khung giờ hoạt động Q7 Thứ 2 cho nhân viên thường hay không. */
export function shouldApplyQ7MondayRule(employee, employeeName, attendanceDate) {
  return Boolean(employee) && isQ7Branch(employee.branch) && isWeekday(attendanceDate, 1)
    && getEmployeeGroup(employeeName || employee.employeeName) === "NORMAL";
}

/** Co khung ca Q7 Thứ 2 vào giờ mở/đóng cửa và trả thêm phần phút thiếu do cửa hàng đóng. */
export function applyQ7MondayWindow({ employee, employeeName, attendanceDate, start, end } = {}) {
  if (!shouldApplyQ7MondayRule(employee, employeeName, attendanceDate)) {
    return { start, end, q7MondayShopShortageMinutes: 0, q7MondayAdjusted: false };
  }
  const adjustedStart = Math.max(start, Q7_MONDAY_OPEN_MINUTES);
  const originalDuration = Math.max(0, end - start);
  const registeredMinutes = parseRegisteredShiftMinutes(
    employee.registeredShift ?? employee.regisHours ?? employee.regisHour,
  ) ?? originalDuration;
  const adjustedEnd = Math.max(
    adjustedStart,
    Math.min(adjustedStart + registeredMinutes, Q7_MONDAY_CLOSE_MINUTES),
  );
  return {
    start: adjustedStart,
    end: adjustedEnd,
    q7MondayShopShortageMinutes: Math.max(0, Math.round(registeredMinutes - (adjustedEnd - adjustedStart))),
    q7MondayAdjusted: true,
  };
}
