/** Tính phút Tăng ca phát sinh; quyết định có cộng Tổng tăng ca nằm ở excelProcessor. */
import { normalizeLookup } from "../../employees/employeeModel.js";
import { parseRegisteredShiftMinutes } from "./q7RuleService.js";

/** Nhận diện nhóm FULL từ tiền tố tên hoặc giá trị Giờ ĐK. */
export function isFullEmployee(employee, employeeName = "") {
  const name = normalizeLookup(employeeName || employee?.employeeName);
  const registered = normalizeLookup(employee?.registeredShift);
  return name.startsWith("full-") || registered === "full" || registered.startsWith("full ");
}

/** Tính phút tăng ca: theo giờ ra chuẩn, riêng nhóm FULL so Tổng làm với số phút đăng ký. */
export function calculateOvertimeMinutes({
  actualOut,
  standardOut,
  totalWorkedMinutes,
  employee,
  employeeName,
  shiftStart,
} = {}) {
  const defaultOvertime = actualOut === null || standardOut === null
    ? null : Math.max(0, Math.round(actualOut - standardOut));
  if (!isFullEmployee(employee, employeeName)) return defaultOvertime;

  const registeredMinutes = parseRegisteredShiftMinutes(employee?.registeredShift)
    ?? (shiftStart !== null && standardOut !== null ? Math.max(0, standardOut - shiftStart) : null);
  return totalWorkedMinutes === null || registeredMinutes === null
    ? defaultOvertime
    : Math.max(0, Math.round(totalWorkedMinutes - registeredMinutes));
}
