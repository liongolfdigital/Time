export const MINUTES_PER_DAY = 24 * 60;
// Mốc/rule đặc biệt dùng khi chọn ca và tính thiếu giờ Q7/VP.
export const VP_SATURDAY_RULE_ID = "vp-saturday-shift";
export const Q7_MONDAY_OPEN_MINUTES = 9 * 60;
export const Q7_MONDAY_CLOSE_MINUTES = 21 * 60;
export const MONTHLY_LATE_WARNING_MINUTES = 180;
export const MONTHLY_LATE_WARNING_TEXT = "Tổng đi trễ trong tháng vượt quá 3 tiếng, cần xem xét trừ lương";

// Hai ca VP Thứ 7; engine chọn ca có mốc Vào/Ra gần thực tế nhất.
export const VP_SATURDAY_SHIFTS = Object.freeze([
  { start: "08:00", end: "12:00", shiftName: "VP Ca 1" },
  { start: "09:00", end: "13:00", shiftName: "VP Ca 2" },
]);

// Nhãn người dùng cho bốn slot clock nội bộ.
export const CLOCK_SLOT_LABELS = Object.freeze({
  in1: "Vào 1",
  out1: "Ra 1",
  in2: "Vào 2",
  out2: "Ra 2",
});
