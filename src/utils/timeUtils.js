/** Helper parse/format clock và thời lượng dùng chung; mọi hàm đều thuần, không mutate input. */
import { MINUTES_PER_DAY } from "../constants/attendanceConstants.js";
import { normalizeText } from "../employees/employeeModel.js";

/** Chuyển giờ chấm công từ Date, số serial Excel hoặc chuỗi HH:mm thành phút trong ngày; không có side effect. */
export function timeValueToMinutes(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getUTCHours() * 60 + value.getUTCMinutes() + value.getUTCSeconds() / 60;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const fraction = ((value % 1) + 1) % 1;
    return Math.round(fraction * MINUTES_PER_DAY * 100) / 100;
  }
  const match = normalizeText(value).match(
    /(?:^|\s)([01]?\d|2[0-3])\s*[:h]\s*([0-5]?\d)(?:\s*:\s*[0-5]?\d)?(?:\s|$)/i,
  );
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Chuyển giá trị Tổng giờ (có thể vượt 24 giờ) sang số phút không âm; không có side effect. */
export function totalHoursValueToMinutes(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Math.round(value.getUTCHours() * 60 + value.getUTCMinutes() + value.getUTCSeconds() / 60);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const minutes = Math.abs(value) <= 1 ? value * MINUTES_PER_DAY : value * 60;
    return Math.max(0, Math.round(minutes));
  }
  const text = normalizeText(value);
  const match = text.match(/^(\d{1,3})\s*[:h]\s*([0-5]?\d)(?:\s*:\s*[0-5]?\d)?$/i);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  const numericValue = Number(text.replace(",", "."));
  return Number.isFinite(numericValue) ? Math.max(0, Math.round(numericValue * 60)) : null;
}

/** Tính Tổng làm từ Tổng giờ nguồn và tùy chọn trừ 60 phút nghỉ trưa. */
export function calculateTotalWorkedMinutes(totalHoursValue, options = {}) {
  const totalMinutes = totalHoursValueToMinutes(totalHoursValue);
  const deductLunchBreak = typeof options === "boolean" ? options : options.deductLunchBreak !== false;
  return totalMinutes === null ? null : Math.max(0, totalMinutes - (deductLunchBreak ? 60 : 0));
}

/** Định dạng thời lượng phút thành HH:mm để hiển thị trong báo cáo. */
export function formatDurationMinutes(minutes) {
  if (minutes === null || minutes === undefined) return "";
  const normalized = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

/** Định dạng số phút theo đồng hồ 24 giờ, tự cuộn giá trị qua nửa đêm. */
export function formatMinutesAsClock(minutes) {
  if (minutes === null || minutes === undefined) return null;
  const rounded = Math.round(minutes) % MINUTES_PER_DAY;
  const normalized = rounded < 0 ? rounded + MINUTES_PER_DAY : rounded;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

/** Tính khoảng cách ngắn nhất giữa hai mốc phút trên đồng hồ 24 giờ. */
export function clockDistance(first, second) {
  const direct = Math.abs(first - second);
  return Math.min(direct, MINUTES_PER_DAY - direct);
}
