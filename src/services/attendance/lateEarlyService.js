/** Tính Đi sớm/Đi trễ/Về sớm và tiền phạt từ clock đã normalize cùng ca đã chọn. */
import { isVpEmployee } from "./vpRuleService.js";

/** Tính tiền phạt từ số phút trễ; nhân viên VP dùng mức cố định từ mốc 15 phút. */
export function calculateLatePenalty(lateMinutes, employeeName) {
  if (lateMinutes === null || lateMinutes === undefined) return null;
  if (lateMinutes < 15) return 0;
  if (isVpEmployee(employeeName)) return 70000;
  return 70000 * 2 ** (Math.ceil(lateMinutes / 60) - 1);
}

/** Tính phút Đi sớm, Đi trễ và Về sớm từ giờ thực tế/giờ ca, gồm thiếu hụt Q7 Thứ 2. */
export function calculateLateEarlyMetrics({ actualIn, shiftStart, actualOut, shiftEnd, q7ShortageMinutes = 0 }) {
  const lateMinutes = actualIn === null || shiftStart === null
    ? null : Math.max(0, Math.round(actualIn - shiftStart));
  const earlyInMinutes = actualIn === null || shiftStart === null
    ? null : Math.max(0, Math.round(shiftStart - actualIn));
  const actualEarlyMinutes = actualOut === null || shiftEnd === null
    ? null : Math.max(0, Math.round(shiftEnd - actualOut));
  const earlyMinutes = actualEarlyMinutes === null
    ? (q7ShortageMinutes > 0 ? q7ShortageMinutes : null)
    : actualEarlyMinutes + q7ShortageMinutes;
  return { lateMinutes, earlyInMinutes, earlyMinutes };
}
