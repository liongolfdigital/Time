/**
 * Cộng các tổng theo nhân viên và ghi hộp tổng hợp cạnh bảng chấm công.
 * Chỉ các field valid* từ processor được cộng; riêng Đi trễ dùng toàn bộ phút thực tế.
 */
import {
  MONTHLY_LATE_WARNING_MINUTES,
  MONTHLY_LATE_WARNING_TEXT,
} from "../constants/attendanceConstants.js";
import { OUTPUT_COLUMNS } from "../constants/excelConstants.js";
import { isVpEmployee } from "../services/attendance/vpRuleService.js";
import { writeCalculatedCell } from "./excelWriter.js";

/** Cộng số phút/tiền theo nhân viên; Tổng đi trễ dùng toàn bộ phút trễ thực tế. */
export function buildEmployeeSummaries(rowResults) {
  const summaries = new Map();
  rowResults.forEach(({ row, calculation, employeeCode, employeeName }) => {
    if (!employeeCode) return;
    const current = summaries.get(employeeCode) ?? {
      firstRow: row, employeeCode, employeeName,
      lateMinutes: 0, earlyInMinutes: 0, penalty: 0, earlyMinutes: 0, overtimeMinutes: 0,
    };
    current.firstRow = Math.min(current.firstRow, row);
    // Đi trễ và Về sớm là tổng bắt buộc; Đi sớm luôn bằng 0, Tăng ca dùng giá trị qua rule Diary.
    current.lateMinutes += Number(calculation.totalLateMinutes) || 0;
    current.earlyInMinutes += Number(calculation.validEarlyInMinutes) || 0;
    current.penalty += Number(calculation.penalty) || 0;
    current.earlyMinutes += Number(calculation.validEarlyMinutes) || 0;
    if (!isVpEmployee(employeeName)) {
      current.overtimeMinutes += Number(calculation.validOvertimeMinutes) || 0;
    }
    summaries.set(employeeCode, current);
  });
  return Array.from(summaries.values());
}

/** Ghi hộp tổng hợp cạnh bảng và cảnh báo tháng cho VP khi vượt ba giờ đi trễ. */
export function writeEmployeeSummaryBox(
  XLSX,
  targetSheet,
  outputStartColumn,
  summary,
  startColumn = outputStartColumn + OUTPUT_COLUMNS.indexOf("Nhân viên"),
) {
  const row = summary.firstRow;
  const values = [
    ["Nhân viên", summary.employeeName], ["Đi sớm", summary.earlyInMinutes],
    ["Đi trễ", summary.lateMinutes], ["Phạt", summary.penalty],
    ["Về sớm", summary.earlyMinutes], ["Tăng ca", summary.overtimeMinutes],
  ];
  values.forEach((items, rowOffset) => items.forEach((value, columnOffset) => {
    const address = XLSX.utils.encode_cell({ r: row + rowOffset, c: startColumn + columnOffset });
    writeCalculatedCell(targetSheet, address, value, rowOffset === 3 && columnOffset === 1 ? "#,##0" : "0");
    if (columnOffset === 0) {
      targetSheet[address].s = {
        ...(targetSheet[address].s ?? {}),
        fill: { patternType: "solid", fgColor: { rgb: "D9EAD3" } },
        font: { ...(targetSheet[address].s?.font ?? {}), bold: true },
      };
    }
  }));

  const warningRow = row + values.length;
  const hasMonthlyLateWarning = isVpEmployee(summary.employeeName)
    && summary.lateMinutes > MONTHLY_LATE_WARNING_MINUTES;
  if (hasMonthlyLateWarning) {
    const address = XLSX.utils.encode_cell({ r: warningRow, c: startColumn });
    writeCalculatedCell(targetSheet, address, MONTHLY_LATE_WARNING_TEXT);
    targetSheet[address].s = {
      fill: { patternType: "solid", fgColor: { rgb: "FCE4D6" } },
      font: { bold: true, color: { rgb: "C00000" } },
      alignment: { horizontal: "left", vertical: "center", wrapText: true },
    };
    targetSheet[XLSX.utils.encode_cell({ r: warningRow, c: startColumn + 1 })] = {
      t: "s", v: "", s: structuredClone(targetSheet[address].s),
    };
    targetSheet["!merges"] = [...(targetSheet["!merges"] ?? []), {
      s: { r: warningRow, c: startColumn }, e: { r: warningRow, c: startColumn + 1 },
    }];
  }
  return hasMonthlyLateWarning ? warningRow : row + values.length - 1;
}
