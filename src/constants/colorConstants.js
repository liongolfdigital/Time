// Màu nền/chữ riêng cho từng loại phát sinh; border trạng thái được ghép ở bước sau.
export const ATTENDANCE_COLOR_MAP = Object.freeze({
  "Đi sớm": { fill: "DDEBFF", font: "1D4ED8" },
  "Đi trễ": { fill: "FFE8CC", font: "C2410C" },
  "Về sớm": { fill: "FFE0E0", font: "B91C1C" },
  "Tăng ca": { fill: "EDE9FE", font: "6D28D9" },
});

// Màu border phân biệt Có phép, Không phép, thiếu Diary, full ngày và tự tính tổng.
export const ATTENDANCE_STATUS_BORDER_COLORS = Object.freeze({
  permitted: "16A34A",
  notPermitted: "DC2626",
  missingDiary: "F97316",
  fullDay: "2563EB",
  autoTotal: "4C1D95",
});

// Style riêng cho OFF dài ngày và clock có nhiều mốc bất thường.
export const LONG_OFF_STYLE = Object.freeze({ fill: "FFE0E0", font: "B91C1C" });
export const LONG_OFF_STATUS_BORDER_COLORS = Object.freeze({
  permitted: "16A34A",
  notPermitted: "991B1B",
  missingDiary: "991B1B",
});
export const MULTIPLE_PUNCH_STYLE = Object.freeze({ fill: "FEF3C7", font: "92400E", border: "F59E0B" });

// Màu semantic dùng trong metadata highlight/preview.
export const HIGHLIGHT_COLORS = Object.freeze({
  off: "FFE0E0",
  earlyIn: "DDEBFF",
  late: "FFE8CC",
  early: "FFE0E0",
  overtime: "EDE9FE",
  multiplePunches: "FEF3C7",
  missingClock: "FFD8A8",
  permitted: "D9EAD3",
  notPermitted: "F4CCCC",
  missingDiary: "FCE4D6",
});
