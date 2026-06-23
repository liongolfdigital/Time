/**
 * Rule nhân viên VP: nhận diện tiền tố VP- và gán một trong hai ca 4 tiếng Thứ 7
 * theo mốc Vào/Ra gần nhất, trước khi pipeline tính chấm công.
 */
import {
  VP_SATURDAY_RULE_ID,
  VP_SATURDAY_SHIFTS,
} from "../../constants/attendanceConstants.js";
import { normalizeText } from "../../employees/employeeModel.js";
import { isWeekday } from "../../utils/dateUtils.js";
import { clockDistance, timeValueToMinutes } from "../../utils/timeUtils.js";

// Lấy mốc vào sớm nhất từ hai cột Vào để chọn ca VP Thứ 7.
function selectActualIn(clockValues) {
  const values = [clockValues?.in1, clockValues?.in2]
    .map(timeValueToMinutes)
    .filter((value) => value !== null);
  return values.length ? Math.min(...values) : null;
}

// Ưu tiên Ra 2, sau đó Ra 1 khi dòng chỉ có giờ ra.
function selectActualOut(clockValues) {
  return timeValueToMinutes(clockValues?.out2) ?? timeValueToMinutes(clockValues?.out1);
}

/** Nhận diện nhân viên văn phòng theo tiền tố `VP-`. */
export function isVPEmployee(employeeName) {
  return normalizeText(employeeName).toLocaleUpperCase("vi-VN").startsWith("VP-");
}

export const isVpEmployee = isVPEmployee;

/** Kiểm tra ngày chấm công có phải Thứ 7 hay không. */
export function isSaturday(date) {
  return isWeekday(date, 6);
}

/** Chọn ca VP Thứ 7 gần mốc vào/ra thực tế nhất; không ghi thay đổi dữ liệu. */
export function getVPSaturdayShift(clockValues) {
  const isClockObject = clockValues && typeof clockValues === "object" && !(clockValues instanceof Date);
  const actualIn = isClockObject ? selectActualIn(clockValues) : timeValueToMinutes(clockValues);
  const actualOut = isClockObject ? selectActualOut(clockValues) : null;
  const actual = actualIn ?? actualOut;
  if (actual !== null) {
    const endpoint = actualIn !== null ? "start" : "end";
    return VP_SATURDAY_SHIFTS.reduce((nearest, candidate) =>
      clockDistance(actual, timeValueToMinutes(candidate[endpoint]))
        < clockDistance(actual, timeValueToMinutes(nearest[endpoint]))
        ? candidate : nearest,
    );
  }
  return isClockObject ? VP_SATURDAY_SHIFTS[0] : null;
}

/** Tạo shift assignment ưu tiên cao cho nhân viên VP vào Thứ 7. */
export function getVPSaturdayShiftAssignment({ employeeName, attendanceDate, clockValues } = {}) {
  if (!isVPEmployee(employeeName) || !isSaturday(attendanceDate)) return null;
  const shift = getVPSaturdayShift(clockValues);
  if (!shift) return null;
  return {
    ruleId: VP_SATURDAY_RULE_ID,
    ruleName: shift.shiftName,
    priority: 2000,
    shift: {
      key: VP_SATURDAY_RULE_ID,
      name: shift.shiftName,
      startValue: shift.start,
      endValue: shift.end,
    },
  };
}
