/**
 * Áp style lên các cell kết quả sau khi pipeline đã normalize clock, tính toán và ghi cell.
 * Màu nền/chữ biểu thị loại phát sinh; border biểu thị trạng thái Diary hoặc rule đặc biệt.
 */
import {
  ATTENDANCE_COLOR_MAP,
  ATTENDANCE_STATUS_BORDER_COLORS,
  LONG_OFF_STATUS_BORDER_COLORS,
  LONG_OFF_STYLE,
  MULTIPLE_PUNCH_STYLE,
  HIGHLIGHT_COLORS,
} from "../constants/colorConstants.js";
import { OUTPUT_COLUMNS } from "../constants/excelConstants.js";
import { normalizeText } from "../employees/employeeModel.js";

// Chuẩn hóa trạng thái Diary về key màu border dùng chung.
function normalizeAttendancePermissionStatus(value) {
  const status = normalizeText(value);
  if (status === "permitted" || status === "Có phép") return "permitted";
  if (status === "notPermitted" || status === "Không phép") return "notPermitted";
  if (status === "missingDiary" || status === "NO_DIARY") return "missingDiary";
  if (status === "fullDay") return "fullDay";
  return status === "autoTotal" ? "autoTotal" : "";
}

// Tạo border mảnh bốn cạnh với một màu trạng thái.
function makeCellBorder(color) {
  return Object.fromEntries(["top", "right", "bottom", "left"].map((side) => [
    side, { style: "thin", color: { rgb: color } },
  ]));
}

/** Mutate style ô vi phạm, giữ màu riêng từng loại và thêm border theo trạng thái Diary. */
export function applyAttendanceCellStyle(cell, violationType, permissionStatus) {
  const typeStyle = ATTENDANCE_COLOR_MAP[violationType];
  if (!cell || !typeStyle) return;
  const borderColor = ATTENDANCE_STATUS_BORDER_COLORS[
    normalizeAttendancePermissionStatus(permissionStatus)
  ];
  cell.s = {
    ...(cell.s ?? {}),
    fill: { ...(cell.s?.fill ?? {}), patternType: "solid", fgColor: { rgb: typeStyle.fill } },
    font: { ...(cell.s?.font ?? {}), color: { rgb: typeStyle.font }, bold: Boolean(borderColor) || Boolean(cell.s?.font?.bold) },
    ...(borderColor ? { border: makeCellBorder(borderColor) } : {}),
  };
}

// Tô ô Ghi chú cho chuỗi OFF > 2 ngày theo trạng thái Diary.
function applyLongOffCellStyle(cell, permissionStatus) {
  if (!cell) return;
  const borderColor = LONG_OFF_STATUS_BORDER_COLORS[
    normalizeAttendancePermissionStatus(permissionStatus)
  ] ?? "991B1B";
  cell.s = {
    ...(cell.s ?? {}),
    fill: { ...(cell.s?.fill ?? {}), patternType: "solid", fgColor: { rgb: LONG_OFF_STYLE.fill } },
    font: { ...(cell.s?.font ?? {}), color: { rgb: LONG_OFF_STYLE.font }, bold: true },
    border: makeCellBorder(borderColor),
  };
}

// Tô các ô clock có nhiều mốc chấm bất thường.
function applyAbnormalCellStyle(cell) {
  if (!cell) return;
  cell.s = {
    ...(cell.s ?? {}),
    fill: { ...(cell.s?.fill ?? {}), patternType: "solid", fgColor: { rgb: MULTIPLE_PUNCH_STYLE.fill } },
    font: { ...(cell.s?.font ?? {}), color: { rgb: MULTIPLE_PUNCH_STYLE.font }, bold: true },
    border: makeCellBorder(MULTIPLE_PUNCH_STYLE.border),
  };
}

// Gắn màu nền đơn cho cell, dùng với cảnh báo thiếu clock.
function applyCellFill(cell, color) {
  if (!cell) return;
  cell.s = { ...(cell.s ?? {}), fill: { patternType: "solid", fgColor: { rgb: color } } };
}

/** Áp toàn bộ highlight lên worksheet sau khi các cell kết quả đã được ghi. */
export function applyRowHighlights(XLSX, targetSheet, highlights, outputStartColumn) {
  const noteColumn = outputStartColumn + OUTPUT_COLUMNS.indexOf("Ghi chú");
  highlights.forEach((highlight) => {
    if (highlight.missingClock) {
      applyCellFill(targetSheet[XLSX.utils.encode_cell({ r: highlight.row, c: noteColumn })], HIGHLIGHT_COLORS.missingClock);
    }
    if (highlight.longOff) {
      applyLongOffCellStyle(
        targetSheet[XLSX.utils.encode_cell({ r: highlight.row, c: noteColumn })],
        highlight.longOffStatus,
      );
    }
    if (highlight.multiplePunches?.slots?.length) {
      const headers = { in1: "Vào 1", out1: "Ra 1", in2: "Vào 2", out2: "Ra 2" };
      highlight.multiplePunches.slots.forEach((slot) => {
        const offset = OUTPUT_COLUMNS.indexOf(headers[slot]);
        if (offset >= 0) applyAbnormalCellStyle(
          targetSheet[XLSX.utils.encode_cell({ r: highlight.row, c: outputStartColumn + offset })],
        );
      });
    }
    [["earlyIn", "Đi sớm"], ["late", "Đi trễ"], ["early", "Về sớm"], ["overtime", "Tăng ca"]]
      .forEach(([key, header]) => {
        if (!highlight[key]) return;
        applyAttendanceCellStyle(
          targetSheet[XLSX.utils.encode_cell({ r: highlight.row, c: outputStartColumn + OUTPUT_COLUMNS.indexOf(header) })],
          header,
          highlight.violationStatuses?.[key],
        );
      });
  });
}

export { ATTENDANCE_COLOR_MAP };
