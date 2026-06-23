import { timeValueToMinutes } from "../../utils/timeUtils.js";

export const ABNORMAL_ATTENDANCE_NOTE = "Mốc chấm công bất thường, cần kiểm tra";

/** Xác định một ô Vào/Ra có chứa mốc giờ dùng được hay không. */
export function hasValidClock(value) {
  if (value === null || value === undefined || value === "" || value === 0 || value === "00:00") return false;
  return timeValueToMinutes(value) !== null;
}

/** Phân loại bộ bốn mốc Vào/Ra, trả về các slot bất thường và cờ thiếu đầu vào/đầu ra. */
export function getAbnormalAttendance(clockValues = {}) {
  const slots = ["in1", "out1", "in2", "out2"].filter((slot) => hasValidClock(clockValues[slot]));
  const normal = hasValidClock(clockValues.in1)
    && hasValidClock(clockValues.out1)
    && !hasValidClock(clockValues.in2)
    && !hasValidClock(clockValues.out2);
  const hasClock = slots.length > 0;
  return {
    abnormal: hasClock && !normal,
    normal,
    slots: hasClock && !normal ? slots : [],
    missingClock: hasClock && !(slots.some((slot) => slot.startsWith("in")) && slots.some((slot) => slot.startsWith("out"))),
  };
}
