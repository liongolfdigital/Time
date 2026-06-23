import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import XLSX_STYLE from "xlsx-js-style";
import { importEmployeesFromExcel } from "./src/employees/employeeExcel.js";
import { getEmployeeGroup, normalizeEmployeeCode } from "./src/employees/employeeModel.js";
import { detectBranchFromText } from "./src/branches/branchModel.js";
import { importDiaryFromExcel } from "./src/diary/diaryExcel.js";
import {
  confirmAndDeleteSelectedDiaries,
  getDiaryBulkDeleteLabel,
  getVisibleDiarySelectionState,
  toggleAllVisibleDiarySelection,
  toggleDiarySelection,
} from "./src/diary/diarySelection.js";
import {
  normalizeDiaryViolationTypes,
  parseDiaryDisplayDate,
  sortDiaryEntries,
} from "./src/diary/diaryModel.js";
import {
  ensureClipboardImageFile,
  validateAttachmentFile,
} from "./src/diary/attachmentStorage.js";
import {
  applyAttendanceCellStyle,
  ATTENDANCE_COLOR_MAP,
  ENABLE_AUTO_COUNT_EARLY_OVER_60,
  ENABLE_AUTO_COUNT_OVERTIME_OVER_60,
  makeMergedOutputFileName,
  matchesProcessFilters,
  MERGED_BRANCH_COLUMN,
  MERGED_SHEET_NAME,
  MERGED_SOURCE_COLUMN,
  MISSING_EMPLOYEE_SHEET_NAME,
  mergeProcessedExcelResults,
  MONTHLY_LATE_WARNING_TEXT,
  processExcelFile,
} from "./src/excel/excelProcessor.js";
import {
  adjustClockColumns,
  calculateLatePenalty,
  calculateTotalWorkedMinutes,
  calculateTimekeeping,
  determineNearestShift,
  formatDurationMinutes,
  selectActualOut,
} from "./src/excel/timekeepingCalculations.js";
import {
  createRuleContext,
  DEFAULT_SHIFT_RULES,
  evaluateShiftRules,
} from "./src/rules/shiftRuleEngine.js";
import { isThuDucEmployee } from "./src/services/attendance/thuDucRuleService.js";

const time = (hours, minutes = 0) => (hours * 60 + minutes) / (24 * 60);

let selectedDiaryIds = toggleDiarySelection([], "diary-1");
assert.deepEqual(selectedDiaryIds, ["diary-1"]);
assert.equal(getDiaryBulkDeleteLabel(selectedDiaryIds.length), "Xóa đã chọn (1)");

selectedDiaryIds = toggleDiarySelection(selectedDiaryIds, "diary-2");
assert.deepEqual(selectedDiaryIds, ["diary-1", "diary-2"]);
assert.equal(getDiaryBulkDeleteLabel(selectedDiaryIds.length), "Xóa đã chọn (2)");

const tenVisibleDiaryIds = Array.from({ length: 10 }, (_, index) => `visible-${index + 1}`);
const hiddenDiaryIds = ["hidden-1", "hidden-2"];
const selectedTenVisible = toggleAllVisibleDiarySelection(hiddenDiaryIds, tenVisibleDiaryIds);
assert.ok(tenVisibleDiaryIds.every((id) => selectedTenVisible.includes(id)));
assert.ok(hiddenDiaryIds.every((id) => selectedTenVisible.includes(id)));
assert.equal(selectedTenVisible.length, 12);

const fiveFilteredDiaryIds = tenVisibleDiaryIds.slice(0, 5);
const selectedFiveFiltered = toggleAllVisibleDiarySelection([], fiveFilteredDiaryIds);
assert.deepEqual(selectedFiveFiltered, fiveFilteredDiaryIds);

const partialVisibleState = getVisibleDiarySelectionState(
  [fiveFilteredDiaryIds[0], fiveFilteredDiaryIds[1]],
  fiveFilteredDiaryIds,
);
assert.equal(partialVisibleState.allSelected, false);
assert.equal(partialVisibleState.someSelected, true);
assert.equal(partialVisibleState.selectedVisibleCount, 2);

let deletedDiaryIds = [];
const confirmedDeleteResult = await confirmAndDeleteSelectedDiaries(
  ["delete-1", "delete-2", "delete-3"],
  {
    confirmDelete: () => true,
    deleteMany: async (ids) => {
      deletedDiaryIds = ids;
      return { deletedCount: ids.length, deletedIds: ids };
    },
  },
);
assert.equal(confirmedDeleteResult.confirmed, true);
assert.equal(confirmedDeleteResult.deletedCount, 3);
assert.deepEqual(deletedDiaryIds, ["delete-1", "delete-2", "delete-3"]);

deletedDiaryIds = [];
const cancelledDeleteResult = await confirmAndDeleteSelectedDiaries(
  ["keep-1", "keep-2"],
  {
    confirmDelete: () => false,
    deleteMany: async (ids) => {
      deletedDiaryIds = ids;
      return { deletedCount: ids.length, deletedIds: ids };
    },
  },
);
assert.equal(cancelledDeleteResult.confirmed, false);
assert.deepEqual(deletedDiaryIds, []);

const diaryDates = [
  "22/05/2026",
  "17/05/2026",
  "22/05/2026",
  "15/05/2026",
  "15/05/2026",
  "14/05/2026",
  "16/05/2026",
];
assert.deepEqual(
  sortDiaryEntries(diaryDates.map((date) => ({ date }))).map(({ date }) => date),
  [
    "22/05/2026",
    "22/05/2026",
    "17/05/2026",
    "16/05/2026",
    "15/05/2026",
    "15/05/2026",
    "14/05/2026",
  ],
);
assert.equal(parseDiaryDisplayDate("22/05/2026"), parseDiaryDisplayDate("2026-05-22"));
assert.equal(parseDiaryDisplayDate("31/02/2026"), 0);
assert.deepEqual(
  sortDiaryEntries([
    { id: "older", date: "22/05/2026", updatedAt: "2026-05-22T08:00:00.000Z" },
    { id: "newer", date: "22/05/2026", updatedAt: "2026-05-22T09:00:00.000Z" },
    { id: "stable-first", date: "21/05/2026" },
    { id: "stable-second", date: "21/05/2026" },
  ]).map(({ id }) => id),
  ["newer", "older", "stable-first", "stable-second"],
);

assert.equal(
  validateAttachmentFile(new File(["image"], "clipboard", { type: "image/png" })),
  "",
);
assert.equal(
  validateAttachmentFile(new File(["pdf"], "bien-ban.pdf", { type: "" })),
  "",
);
assert.equal(
  validateAttachmentFile(new File(["text"], "ghi-chu.txt", { type: "text/plain" })),
  "Định dạng file không được hỗ trợ",
);
assert.equal(
  validateAttachmentFile({
    name: "qua-lon.pdf",
    type: "application/pdf",
    size: 20 * 1024 * 1024 + 1,
  }),
  "File vượt quá dung lượng tối đa 20MB",
);
const pastedImage = ensureClipboardImageFile(
  new File(["image"], "", { type: "image/png" }),
  new Date(2026, 0, 2, 3, 4, 5),
);
assert.equal(pastedImage.name, "bien-ban-paste-20260102-030405.png");
assert.equal(pastedImage.type, "image/png");
assert.equal(
  ensureClipboardImageFile(new File(["text"], "", { type: "text/plain" })),
  null,
);

assert.equal(getEmployeeGroup("VP-Hoa"), "VP");
assert.equal(getEmployeeGroup("Bep-Thu"), "BEP");
assert.equal(getEmployeeGroup("Bếp-Thu"), "BEP");
assert.equal(getEmployeeGroup("Cafe-Nga"), "CAFE");
assert.equal(getEmployeeGroup("Cà phê-Nga"), "CAFE");
assert.equal(getEmployeeGroup("Ca phe-Nga"), "CAFE");
assert.equal(getEmployeeGroup("Caphe-Nga"), "CAFE");
assert.equal(getEmployeeGroup("Q7-Nam"), "NORMAL");

assert.equal(detectBranchFromText("Q7-Nam"), "Q7");
assert.equal(detectBranchFromText("Quận 7-Nam"), "Q7");
assert.equal(detectBranchFromText("Outlet-Khoa"), "OL");
assert.equal(detectBranchFromText("Online-Khoa"), "OL");
assert.equal(detectBranchFromText("Thủ Đức-An"), "TD");
assert.equal(detectBranchFromText("Thu Duc-An"), "TD");
assert.equal(detectBranchFromText("Rạch Chiếc-Huy"), "RC");
assert.equal(detectBranchFromText("Rach Chiec-Huy"), "RC");
assert.equal(detectBranchFromText("NHC-Lan"), "NHC");

const attendanceHeaders = [
  "STT", "Mã N.Viên", "Tên N.Viên", "Ngày", "Thứ",
  "Vào 1", "Ra 1", "Vào 2", "Ra 2", "Tổng giờ",
  "Ngày Công", "TC1", "TC2", "TC3", "Tổng cộng",
  "Ghi chú",
];

function makeAttendanceFile(rows, fileName = "cham_cong.xlsx") {
  const worksheet = XLSX.utils.aoa_to_sheet([attendanceHeaders, ...rows]);
  for (let row = 2; row <= rows.length + 1; row += 1) {
    worksheet[`D${row}`].z = "dd/mm/yyyy";
    ["F", "G", "H", "I"].forEach((column) => {
      if (worksheet[`${column}${row}`]) worksheet[`${column}${row}`].z = "hh:mm";
    });
    worksheet[`J${row}`].z = "[hh]:mm";
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Chi tiết");
  return new File(
    [XLSX.write(workbook, { type: "array", bookType: "xlsx" })],
    fileName,
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  );
}

function makeAttendanceFileWithHeaders(headers, rows, fileName = "cham_cong_custom.xlsx") {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  for (let row = 2; row <= rows.length + 1; row += 1) {
    const dateColumn = headers.indexOf("Ngày");
    if (dateColumn >= 0) {
      const address = XLSX.utils.encode_cell({ r: row - 1, c: dateColumn });
      if (worksheet[address]) worksheet[address].z = "dd/mm/yyyy";
    }
    ["Vào 1", "Ra 1", "Vào 2", "Ra 2"].forEach((header) => {
      const column = headers.indexOf(header);
      if (column < 0) return;
      const address = XLSX.utils.encode_cell({ r: row - 1, c: column });
      if (worksheet[address]) worksheet[address].z = "hh:mm";
    });
    const totalColumn = headers.indexOf("Tổng giờ");
    if (totalColumn >= 0) {
      const address = XLSX.utils.encode_cell({ r: row - 1, c: totalColumn });
      if (worksheet[address]) worksheet[address].z = "[hh]:mm";
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Chi tiết");
  return new File(
    [XLSX.write(workbook, { type: "array", bookType: "xlsx" })],
    fileName,
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  );
}

assert.equal(new Set(Object.values(ATTENDANCE_COLOR_MAP).map(({ fill }) => fill)).size, 4);
assert.equal(ATTENDANCE_COLOR_MAP["Đi sớm"].fill, "DDEBFF");
assert.equal(ATTENDANCE_COLOR_MAP["Đi trễ"].fill, "FFE8CC");
assert.equal(ATTENDANCE_COLOR_MAP["Về sớm"].fill, "FFE0E0");
assert.equal(ATTENDANCE_COLOR_MAP["Tăng ca"].fill, "EDE9FE");
assert.equal(ENABLE_AUTO_COUNT_OVERTIME_OVER_60, false);
assert.equal(ENABLE_AUTO_COUNT_EARLY_OVER_60, false);

const permittedLateStyleCell = {};
applyAttendanceCellStyle(permittedLateStyleCell, "Đi trễ", "Có phép");
assert.equal(permittedLateStyleCell.s.fill.fgColor.rgb, "FFE8CC");
assert.equal(permittedLateStyleCell.s.font.color.rgb, "C2410C");
assert.equal(permittedLateStyleCell.s.border.left.color.rgb, "16A34A");

const deniedLateStyleCell = {};
applyAttendanceCellStyle(deniedLateStyleCell, "Đi trễ", "Không phép");
assert.equal(deniedLateStyleCell.s.fill.fgColor.rgb, "FFE8CC");
assert.equal(deniedLateStyleCell.s.font.color.rgb, "C2410C");
assert.equal(deniedLateStyleCell.s.border.left.color.rgb, "DC2626");

const missingDiaryLateStyleCell = {};
applyAttendanceCellStyle(missingDiaryLateStyleCell, "Đi trễ", "NO_DIARY");
assert.equal(missingDiaryLateStyleCell.s.fill.fgColor.rgb, "FFE8CC");
assert.equal(missingDiaryLateStyleCell.s.font.color.rgb, "C2410C");
assert.equal(missingDiaryLateStyleCell.s.border.left.color.rgb, "F97316");

const deniedOvertimeStyleCell = {};
applyAttendanceCellStyle(deniedOvertimeStyleCell, "Tăng ca", "Không phép");
assert.equal(deniedOvertimeStyleCell.s.fill.fgColor.rgb, "EDE9FE");
assert.equal(deniedOvertimeStyleCell.s.font.color.rgb, "6D28D9");
assert.equal(deniedOvertimeStyleCell.s.border.left.color.rgb, "DC2626");

const missingDiaryEarlyStyleCell = {};
applyAttendanceCellStyle(missingDiaryEarlyStyleCell, "Đi sớm", "NO_DIARY");
assert.equal(missingDiaryEarlyStyleCell.s.fill.fgColor.rgb, "DDEBFF");
assert.equal(missingDiaryEarlyStyleCell.s.font.color.rgb, "1D4ED8");
assert.equal(missingDiaryEarlyStyleCell.s.border.left.color.rgb, "F97316");

const autoTotalOvertimeStyleCell = {};
applyAttendanceCellStyle(autoTotalOvertimeStyleCell, "Tăng ca", "autoTotal");
assert.equal(autoTotalOvertimeStyleCell.s.fill.fgColor.rgb, "EDE9FE");
assert.equal(autoTotalOvertimeStyleCell.s.font.color.rgb, "6D28D9");
assert.equal(autoTotalOvertimeStyleCell.s.border.left.color.rgb, "4C1D95");

const fullDayOvertimeStyleCell = {};
applyAttendanceCellStyle(fullDayOvertimeStyleCell, "Tăng ca", "fullDay");
assert.equal(fullDayOvertimeStyleCell.s.fill.fgColor.rgb, "EDE9FE");
assert.equal(fullDayOvertimeStyleCell.s.font.color.rgb, "6D28D9");
assert.equal(fullDayOvertimeStyleCell.s.border.left.color.rgb, "2563EB");

const baseEmployee = {
  morningIn: "07:30",
  morningOut: "16:30",
  afternoonIn: "12:00",
  afternoonOut: "21:00",
  eveningIn: "",
  eveningOut: "",
  note: "",
};

const employees = [
  {
    ...baseEmployee,
    id: "q7-normal",
    branch: "Q7",
    employeeCode: "Q7N",
    employeeName: "Q7-Nam",
    registeredShift: "Sáng",
  },
  {
    ...baseEmployee,
    id: "q7-bep",
    branch: "Q7",
    employeeCode: "Q7B",
    employeeName: "Bep-An",
    registeredShift: "Sáng",
  },
  {
    id: "td-evening",
    branch: "TD",
    employeeCode: "TD1",
    employeeName: "TD-An",
    registeredShift: "",
    morningIn: "05:30",
    morningOut: "14:30",
    afternoonIn: "07:00",
    afternoonOut: "16:00",
    eveningIn: "09:00",
    eveningOut: "18:00",
    note: "",
  },
  {
    id: "ol-afternoon",
    branch: "OL",
    employeeCode: "OL1",
    employeeName: "Outlet-Khoa",
    registeredShift: "",
    morningIn: "08:00",
    morningOut: "17:00",
    afternoonIn: "11:00",
    afternoonOut: "20:00",
    eveningIn: "",
    eveningOut: "",
    note: "",
  },
  {
    ...baseEmployee,
    id: "vp-saturday",
    branch: "Q7",
    employeeCode: "VP1",
    employeeName: "VP-Hoa",
    registeredShift: "Sáng",
    note: "Ghi chú nền",
  },
];

const branchRuleFile = makeAttendanceFile([
  [1, "Q7N", "Q7-Nam", new Date(2026, 5, 15), "Hai", time(9, 5), time(18, 0), "", "", time(8, 55), 1, 0, 0, 0, 1, ""],
  [2, "Q7B", "Bep-An", new Date(2026, 5, 15), "Hai", time(7, 35), time(16, 30), "", "", time(8, 55), 1, 0, 0, 0, 1, ""],
  [3, "TD1", "TD-An", new Date(2026, 5, 16), "Ba", time(9, 5), time(18, 0), "", "", time(8, 55), 1, 0, 0, 0, 1, ""],
  [4, "OL1", "Outlet-Khoa", new Date(2026, 5, 16), "Ba", time(11, 0), time(20, 25), "", "", time(9, 25), 1, 0, 0, 0, 1, ""],
  [5, "VP1", "VP-Hoa", new Date(2026, 5, 20), "T7", time(8, 5), time(12, 0), "", "", time(4, 0), 0.5, 0, 0, 0, 0.5, ""],
]);

const result = await processExcelFile(branchRuleFile, employees);
assert.equal(result.totalRows, 5);
assert.equal(result.matchedRows, 5);
assert.equal(result.unmatchedRows, 0);

const filteredBatchResult = await processExcelFile(branchRuleFile, employees, {
  processFilters: {
    branches: ["TD", "OL"],
    dateFrom: "2026-06-16",
    dateTo: "2026-06-16",
    onlyMatchingRows: true,
  },
});
assert.equal(filteredBatchResult.totalRows, 2);
assert.equal(filteredBatchResult.filteredOutRows, 3);
assert.deepEqual(
  filteredBatchResult.previewRows.map((row) => row[filteredBatchResult.headers.indexOf("Mã N.Viên")]),
  ["TD1", "OL1"],
);

const filteredEmployeeResult = await processExcelFile(branchRuleFile, employees, {
  processFilters: { employeeIds: ["q7-bep"], onlyMatchingRows: true },
});
assert.equal(filteredEmployeeResult.totalRows, 1);
assert.equal(filteredEmployeeResult.previewRows[0][filteredEmployeeResult.headers.indexOf("Mã N.Viên")], "Q7B");

const filterDisabledResult = await processExcelFile(branchRuleFile, employees, {
  processFilters: { branches: ["TD"], onlyMatchingRows: false },
});
assert.equal(filterDisabledResult.totalRows, 5);

const mergedTestEmployees = [
  ["00024", "OL-NguyenNho", "OL"],
  ["00679", "Q7-NguyenNho", "Q7"],
  ["00403", "RC-Nguyen", "RC"],
  ["00888", "TD-Khoa", "TD"],
].map(([employeeCode, employeeName, branch]) => ({
  ...baseEmployee,
  id: `merged-${employeeCode}`,
  employeeCode,
  employeeName,
  branch,
  registeredShift: "Sáng",
}));
const mergedSourceFiles = mergedTestEmployees.map((employee, index) => makeAttendanceFile([[
  index + 1,
  employee.employeeCode === "00403" ? 403 : employee.employeeCode,
  employee.employeeName,
  new Date(2026, 5, 18),
  "Năm",
  time(7, 45),
  time(16, 45),
  "",
  "",
  time(9, 0),
  1,
  0,
  0,
  0,
  1,
  "",
]], `${employee.branch}_cham_cong.xlsx`));

assert.equal(normalizeEmployeeCode("0000679"), "00679");
assert.equal(normalizeEmployeeCode(403), "00403");
const selectedMergedFilters = {
  employeeIds: ["00024", "0000679", "00403"],
  branches: ["OL"],
  dateFrom: "",
  dateTo: "",
  onlyMatchingRows: true,
};
const selectedMergedParts = [];
for (const file of mergedSourceFiles) {
  selectedMergedParts.push(await processExcelFile(file, mergedTestEmployees, {
    processFilters: selectedMergedFilters,
    includeProcessedSheet: true,
  }));
}
const selectedMergedResult = await mergeProcessedExcelResults(selectedMergedParts, {
  processFilters: selectedMergedFilters,
  fileName: "merged-employees.xlsx",
  selectedEmployees: mergedTestEmployees.slice(0, 3),
});
assert.equal(selectedMergedResult.fileName, "merged-employees.xlsx");
assert.equal(selectedMergedResult.totalRows, 3);
assert.equal(selectedMergedResult.sourceFileCount, 3);
assert.equal(selectedMergedResult.selectedEmployeeCount, 3);
assert.equal(selectedMergedResult.exportedEmployeeCount, 3);
assert.equal(selectedMergedResult.missingEmployeeCount, 0);
const selectedMergedWorkbook = XLSX_STYLE.read(await selectedMergedResult.blob.arrayBuffer(), {
  type: "array",
  cellStyles: true,
});
assert.deepEqual(selectedMergedWorkbook.SheetNames, [MERGED_SHEET_NAME]);
const selectedMergedRows = XLSX.utils.sheet_to_json(
  selectedMergedWorkbook.Sheets[MERGED_SHEET_NAME],
  { defval: "" },
);
const selectedMergedDataRows = selectedMergedRows.filter((row) => row["Mã N.Viên"]);
assert.deepEqual(selectedMergedDataRows.map((row) => normalizeEmployeeCode(row["Mã N.Viên"])), ["00024", "00679", "00403"]);
assert.deepEqual(selectedMergedDataRows.map((row) => row[MERGED_BRANCH_COLUMN]), ["OL", "Q7", "RC"]);
assert.deepEqual(selectedMergedDataRows.map((row) => row[MERGED_SOURCE_COLUMN]), [
  "OL_cham_cong.xlsx",
  "Q7_cham_cong.xlsx",
  "RC_cham_cong.xlsx",
]);
assert.ok(selectedMergedDataRows.every((row) => row["Tổng làm"] !== ""));
const mergedLateColumn = selectedMergedResult.headers.indexOf("Đi trễ");
const mergedLateCell = selectedMergedWorkbook.Sheets[MERGED_SHEET_NAME][
  XLSX.utils.encode_cell({ r: 1, c: mergedLateColumn })
];
assert.equal(mergedLateCell.s.fgColor.rgb, "FFE8CC");
assert.equal(matchesProcessFilters({
  registeredEmployee: { employeeCode: "00403", employeeName: "Q7-Hoa", branch: "" },
  employeeCode: "00403",
  employeeName: "Q7-Hoa",
  dateValue: "18/06/2026",
}, { branches: ["Q7"] }), true);
assert.equal(matchesProcessFilters({
  registeredEmployee: { employeeCode: "00403", employeeName: "RC-Nguyen", branch: "RC" },
  employeeCode: 403,
  employeeName: "RC-Nguyen",
  dateValue: "18/06/2026",
}, { employeeIds: ["00403"], branches: ["OL"], onlyMatchingRows: true }), true);

const q7MergedFilters = { branches: ["Q7"], employeeIds: [], onlyMatchingRows: true };
const q7MergedParts = [];
for (const file of mergedSourceFiles) {
  q7MergedParts.push(await processExcelFile(file, mergedTestEmployees, {
    processFilters: q7MergedFilters,
    includeProcessedSheet: true,
  }));
}
const q7MergedResult = await mergeProcessedExcelResults(q7MergedParts, {
  processFilters: q7MergedFilters,
});
assert.equal(q7MergedResult.totalRows, 1);
const q7MergedWorkbook = XLSX.read(await q7MergedResult.blob.arrayBuffer(), { type: "array" });
const q7MergedRows = XLSX.utils.sheet_to_json(q7MergedWorkbook.Sheets[MERGED_SHEET_NAME], { defval: "" });
assert.deepEqual(q7MergedRows.filter((row) => row["Mã N.Viên"]).map((row) => normalizeEmployeeCode(row["Mã N.Viên"])), ["00679"]);

const missingSelectedEmployeeParts = [];
for (const file of mergedSourceFiles.filter((file) => !file.name.startsWith("RC_"))) {
  missingSelectedEmployeeParts.push(await processExcelFile(file, mergedTestEmployees, {
    processFilters: selectedMergedFilters,
    includeProcessedSheet: true,
  }));
}
const missingSelectedEmployeeResult = await mergeProcessedExcelResults(missingSelectedEmployeeParts, {
  processFilters: selectedMergedFilters,
  selectedEmployees: mergedTestEmployees.slice(0, 3),
});
assert.equal(missingSelectedEmployeeResult.totalRows, 2);
assert.equal(missingSelectedEmployeeResult.sourceFileCount, 2);
assert.equal(missingSelectedEmployeeResult.exportedEmployeeCount, 2);
assert.equal(missingSelectedEmployeeResult.missingEmployeeCount, 1);
assert.deepEqual(missingSelectedEmployeeResult.missingEmployees.map((employee) => employee.employeeCode), ["00403"]);
const missingSelectedWorkbook = XLSX.read(await missingSelectedEmployeeResult.blob.arrayBuffer(), { type: "array" });
assert.deepEqual(missingSelectedWorkbook.SheetNames, [MERGED_SHEET_NAME, MISSING_EMPLOYEE_SHEET_NAME]);
const missingSelectedRows = XLSX.utils.sheet_to_json(
  missingSelectedWorkbook.Sheets[MISSING_EMPLOYEE_SHEET_NAME],
  { defval: "" },
);
assert.deepEqual(missingSelectedRows, [{
  "Mã N.Viên": "00403",
  "Tên N.Viên": "RC-Nguyen",
  "Chi nhánh": "RC",
  "Ghi chú": "Không có dữ liệu trong các file đã tải lên",
}]);

const missingEmployeeParts = [];
for (const file of mergedSourceFiles) {
  missingEmployeeParts.push(await processExcelFile(file, mergedTestEmployees, {
    processFilters: { employeeIds: ["KHONG-TON-TAI"], onlyMatchingRows: true },
    includeProcessedSheet: true,
  }));
}
await assert.rejects(
  () => mergeProcessedExcelResults(missingEmployeeParts),
  /Không có dữ liệu nào khớp bộ lọc đã chọn/,
);
assert.equal(
  makeMergedOutputFileName({ employeeIds: ["00024"] }, new Date(2026, 5, 22, 9, 5)),
  "XuLy_TongHop_NhanVien_20260622_0905.xlsx",
);
assert.equal(
  makeMergedOutputFileName({ branches: ["Q7"] }, new Date(2026, 5, 22, 9, 5)),
  "XuLy_TongHop_ChiNhanh_20260622_0905.xlsx",
);

assert.equal(result.determinedShifts[0].shift, "Sáng");
assert.equal(result.determinedShifts[0].source, "nearest");
assert.equal(result.determinedShifts[0].standardOutTime, "18:00");
assert.equal(result.determinedShifts[0].branch, "Q7");

assert.equal(result.determinedShifts[1].shift, "Sáng");
assert.equal(result.determinedShifts[1].source, "nearest");
assert.equal(result.determinedShifts[1].standardOutTime, "16:30");
assert.equal(result.determinedShifts[1].employeeGroup, "BEP");

assert.equal(result.determinedShifts[2].shift, "Tối");
assert.equal(result.determinedShifts[2].source, "nearest");
assert.equal(result.determinedShifts[2].standardOutTime, "18:00");

assert.equal(result.determinedShifts[3].shift, "Chiều");
assert.equal(result.determinedShifts[3].standardOutTime, "20:00");

assert.equal(result.determinedShifts[4].shift, "VP Ca 1");
assert.equal(result.determinedShifts[4].source, "rule");
assert.equal(result.determinedShifts[4].totalWorkedMinutes, 240);

const outputWorkbook = XLSX.read(await result.blob.arrayBuffer(), { cellDates: false, cellNF: true });
const outputSheet = outputWorkbook.Sheets["Chi tiết"];
const outputHeaders = XLSX.utils.sheet_to_json(outputSheet, { header: 1 })[0];

assert.deepEqual(outputHeaders, [
  "STT", "Mã N.Viên", "Tên N.Viên", "Ngày", "Thứ",
  "Vào 1", "Ra 1", "Vào 2", "Ra 2", "Tổng giờ",
  "Giờ ĐK", "Đi sớm", "Đi trễ", "Phạt", "Về sớm", "Tăng ca", "Ghi chú", "Tổng làm",
  "Nhân viên", "Tổng",
]);
assert.equal(outputSheet.L2.v, 0);
assert.equal(outputSheet.M2.v, 5);
assert.equal(outputSheet.N2.v, 0);
assert.equal(outputSheet.P2.v, 0);
assert.match(outputSheet.Q2.v, /Đi trễ chưa có Diary/);
assert.doesNotMatch(outputSheet.Q2.v, /Tăng ca/);
assert.equal(outputSheet.L3.v, 0);
assert.equal(outputSheet.M3.v, 5);
assert.equal(outputSheet.N3.v, 0);
assert.equal(outputSheet.L4.v, 0);
assert.equal(outputSheet.M4.v, 5);
assert.equal(outputSheet.P5.v, 25);
assert.equal(outputSheet.M6.v, 5);
assert.equal(XLSX.utils.format_cell(outputSheet.R6), "04:00");
assert.match(outputSheet.Q6.v, /Ghi chú nền/);

const vpOutOnlyFile = makeAttendanceFile([
  [1, "VP1", "VP-Hoa", new Date(2026, 5, 20), "T7", "", time(13, 0), "", "", time(4, 0), 0.5, 0, 0, 0, 0.5, ""],
]);
const vpOutOnlyResult = await processExcelFile(vpOutOnlyFile, employees);
assert.equal(vpOutOnlyResult.determinedShifts[0].shift, "VP Ca 2");
assert.match(vpOutOnlyResult.previewRows[0][16], /Thiếu giờ vào/);
assert.equal(vpOutOnlyResult.highlights[0].missingClock, true);
assert.equal(vpOutOnlyResult.previewHighlights[0][16], "missingClock");

const vpMissingClockFile = makeAttendanceFile([
  [1, "VP1", "VP-Hoa", new Date(2026, 5, 20), "T7", "", "", "", "", "", 0.5, 0, 0, 0, 0.5, ""],
]);
const vpMissingClockResult = await processExcelFile(vpMissingClockFile, employees);
assert.equal(vpMissingClockResult.determinedShifts[0].shift, "VP Ca 1");
assert.match(vpMissingClockResult.previewRows[0][16], /Thiếu giờ vào/);
assert.match(vpMissingClockResult.previewRows[0][16], /Thiếu giờ ra/);

const diaryResult = await processExcelFile(branchRuleFile, employees, {
  diaryEntries: [
    {
      id: "q7-normal-permitted",
      date: "2026-06-15",
      employeeCode: "Q7N",
      employeeName: "Q7-Nam",
      reason: "Đi khám bệnh",
      permission: "Có phép",
      violationTypes: ["Đi trễ"],
    },
  ],
});
const diaryWorkbook = XLSX.read(await diaryResult.blob.arrayBuffer(), { cellNF: true });
const diarySheet = diaryWorkbook.Sheets["Chi tiết"];
assert.equal(diarySheet.M2.v, 5);
assert.equal(diarySheet.N2.v, 0);
assert.match(diarySheet.Q2.v, /Đi trễ có phép: Đi khám bệnh/);
assert.doesNotMatch(diarySheet.Q2.v, /Tăng ca/);
assert.equal(diaryResult.diaryMatchedRows, 1);
assert.equal(diaryResult.diaryExemptedRows, 1);

const q7MondayEmployeeBase = {
  branch: "Q7",
  morningIn: "07:30",
  morningOut: "16:30",
  afternoonIn: "12:00",
  afternoonOut: "21:00",
  eveningIn: "",
  eveningOut: "",
  note: "",
};
const q7MondayEmployees = [
  {
    ...q7MondayEmployeeBase,
    id: "q7-tuan",
    employeeCode: "Q7TUAN",
    employeeName: "Q7-Tuấn",
    registeredShift: "13.5",
  },
  {
    ...q7MondayEmployeeBase,
    id: "q7-tung",
    employeeCode: "Q7TUNG",
    employeeName: "Q7-Tùng",
    registeredShift: "12",
  },
  {
    ...q7MondayEmployeeBase,
    id: "q7-trang",
    employeeCode: "Q7TRANG",
    employeeName: "Q7-Trang",
    registeredShift: "8",
  },
  {
    ...q7MondayEmployeeBase,
    id: "q7-vy",
    employeeCode: "Q7VY",
    employeeName: "Q7-Vy shop",
    registeredShift: "10",
  },
  {
    ...q7MondayEmployeeBase,
    id: "q7-bep-rule",
    employeeCode: "Q7BEP2",
    employeeName: "Bep-Rule",
    registeredShift: "13.5",
  },
];
const q7MondayFile = makeAttendanceFile([
  [1, "Q7TUAN", "Q7-Tuấn", new Date(2026, 5, 15), "Hai", time(9, 7), time(21, 0), "", "", time(11, 53), 1, 0, 0, 0, 1, ""],
  [2, "Q7TUNG", "Q7-Tùng", new Date(2026, 5, 15), "Hai", time(9, 3), time(21, 8), "", "", time(12, 5), 1, 0, 0, 0, 1, ""],
  [3, "Q7TRANG", "Q7-Trang", new Date(2026, 5, 15), "Hai", time(8, 59), time(17, 4), "", "", time(8, 5), 1, 0, 0, 0, 1, ""],
  [4, "Q7VY", "Q7-Vy shop", new Date(2026, 5, 15), "Hai", time(8, 49), time(19, 9), "", "", time(10, 20), 1, 0, 0, 0, 1, ""],
  [5, "Q7BEP2", "Bep-Rule", new Date(2026, 5, 15), "Hai", time(9, 7), time(21, 0), "", "", time(11, 53), 1, 0, 0, 0, 1, ""],
], "q7_monday_rule.xlsx");
const q7MondayResult = await processExcelFile(q7MondayFile, q7MondayEmployees);
const q7MondayWorkbook = XLSX.read(await q7MondayResult.blob.arrayBuffer(), { cellNF: true });
const q7MondaySheet = q7MondayWorkbook.Sheets["Chi tiết"];

assert.equal(q7MondayResult.determinedShifts[0].shift, "Sáng");
assert.equal(q7MondayResult.determinedShifts[0].standardOutTime, "21:00");
assert.equal(q7MondaySheet.M2.v, 7);
assert.equal(q7MondaySheet.O2.v, 90);
assert.equal(q7MondaySheet.P2.v, 0);
assert.match(q7MondaySheet.Q2.v, /Về sớm do Giờ ĐK vượt giờ hoạt động Q7 Thứ 2: 90 phút/);

assert.equal(q7MondayResult.determinedShifts[1].standardOutTime, "21:00");
assert.equal(q7MondaySheet.M3.v, 3);
assert.equal(q7MondaySheet.O3.v, 0);
assert.equal(q7MondaySheet.P3.v, 0);

assert.equal(q7MondayResult.determinedShifts[2].standardOutTime, "17:00");
assert.equal(q7MondaySheet.L4.v, 1);
assert.equal(q7MondaySheet.O4.v, 0);
assert.equal(q7MondaySheet.P4.v, 4);

assert.equal(q7MondayResult.determinedShifts[3].standardOutTime, "19:00");
assert.equal(q7MondaySheet.L5.v, 11);
assert.equal(q7MondaySheet.O5.v, 0);
assert.equal(q7MondaySheet.P5.v, 9);

assert.equal(q7MondayResult.determinedShifts[4].standardOutTime, "16:30");
assert.equal(q7MondaySheet.M6.v, 97);
assert.equal(q7MondaySheet.O6.v, 0);
assert.doesNotMatch(q7MondaySheet.Q6.v, /Q7 Thứ 2/);

const multiplePunchEmployee = {
  id: "multiple-punch",
  branch: "Q7",
  employeeCode: "MP1",
  employeeName: "Multiple Punch",
  registeredShift: "Sáng",
  morningIn: "08:00",
  morningOut: "17:00",
  afternoonIn: "",
  afternoonOut: "",
  eveningIn: "",
  eveningOut: "",
  note: "",
};
const multiplePunchFile = makeAttendanceFile([
  [1, "MP1", "Multiple Punch", new Date(2026, 9, 1), "T5", time(9, 58), time(15, 7), time(12, 44), time(21, 20), time(11, 22), 1, 0, 0, 0, 1, ""],
  [2, "MP1", "Multiple Punch", new Date(2026, 9, 2), "T6", time(7, 30), time(21, 0), "", "", time(13, 30), 1, 0, 0, 0, 1, ""],
  [3, "MP1", "Multiple Punch", new Date(2026, 9, 3), "T7", "", "", time(12, 44), time(21, 20), time(8, 36), 1, 0, 0, 0, 1, ""],
], "multiple_punch_cases.xlsx");
const multiplePunchResult = await processExcelFile(multiplePunchFile, [multiplePunchEmployee]);
const multiplePunchWorkbook = XLSX.read(await multiplePunchResult.blob.arrayBuffer(), { cellNF: true });
const multiplePunchSheet = multiplePunchWorkbook.Sheets["Chi tiết"];
assert.match(multiplePunchSheet.Q2.v, /Mốc chấm công bất thường, cần kiểm tra/);
assert.deepEqual(multiplePunchResult.highlights[0].multiplePunches.slots, ["in1", "out1", "in2", "out2"]);
assert.equal(multiplePunchResult.previewHighlights[0][5], "multiplePunches");
assert.equal(multiplePunchResult.previewHighlights[0][6], "multiplePunches");
assert.equal(multiplePunchResult.previewHighlights[0][7], "multiplePunches");
assert.equal(multiplePunchResult.previewHighlights[0][8], "multiplePunches");
assert.doesNotMatch(multiplePunchSheet.Q3.v, /Mốc chấm công bất thường/);
assert.equal(multiplePunchResult.highlights[1].multiplePunches, null);
assert.match(multiplePunchSheet.Q4.v, /Mốc chấm công bất thường, cần kiểm tra/);
assert.deepEqual(multiplePunchResult.highlights[2].multiplePunches.slots, ["in2", "out2"]);
assert.equal(multiplePunchResult.previewHighlights[2][7], "multiplePunches");
assert.equal(multiplePunchResult.previewHighlights[2][8], "multiplePunches");

const headersWithoutSecondPunch = attendanceHeaders.filter((header) => !["Vào 2", "Ra 2"].includes(header));
const fileWithoutSecondPunch = makeAttendanceFileWithHeaders(
  headersWithoutSecondPunch,
  [[1, "MP1", "Multiple Punch", new Date(2026, 9, 4), "CN", time(8, 0), time(17, 0), time(9, 0), 1, 0, 0, 0, 1, ""]],
  "without_second_punch_columns.xlsx",
);
const resultWithoutSecondPunch = await processExcelFile(fileWithoutSecondPunch, [multiplePunchEmployee]);
assert.equal(resultWithoutSecondPunch.totalRows, 1);
assert.equal(resultWithoutSecondPunch.highlights[0].multiplePunches, null);

const tdTienEmployee = {
  id: "td-tien",
  branch: "TD",
  employeeCode: "TDT",
  employeeName: "TD-Tien",
  registeredShift: "",
  morningIn: "05:30",
  morningOut: "14:30",
  afternoonIn: "07:00",
  afternoonOut: "16:00",
  eveningIn: "09:00",
  eveningOut: "18:00",
  note: "",
};
const tdTienFile = makeAttendanceFile([
  [1, "TDT", "TD-Tien", new Date(2026, 4, 1), "T6", time(6, 57), time(18, 2), "", "", time(11, 5), 1, 0, 0, 0, 1, ""],
], "td_tien_shift_selection.xlsx");
const tdTienResult = await processExcelFile(tdTienFile, [tdTienEmployee]);
assert.equal(tdTienResult.determinedShifts[0].shift, "Chiều");
assert.equal(tdTienResult.determinedShifts[0].source, "nearest");
assert.equal(tdTienResult.determinedShifts[0].standardOutTime, "16:00");
const tdTienWorkbook = XLSX.read(await tdTienResult.blob.arrayBuffer(), { cellNF: true });
const tdTienSheet = tdTienWorkbook.Sheets["Chi tiết"];
assert.equal(tdTienSheet.L2.v, 3);
assert.equal(tdTienSheet.M2.v, 0);
assert.equal(tdTienSheet.P2.v, 122);
assert.match(tdTienSheet.Q2.v, /Đi sớm chưa có Diary/);
assert.match(tdTienSheet.Q2.v, /Tăng ca chưa có Diary/);
assert.doesNotMatch(tdTienSheet.Q2.v, /trên 60 phút - tự tính tổng/);

const tdUyenNhiEmployee = {
  id: "td-uyen-nhi",
  branch: "TD",
  employeeCode: "TD-UN",
  employeeName: "TD-UyenNhi",
  registeredShift: "9",
  morningIn: "05:30",
  morningOut: "14:30",
  afternoonIn: "07:00",
  afternoonOut: "16:00",
  eveningIn: "09:00",
  eveningOut: "18:00",
  note: "",
};
assert.equal(isThuDucEmployee(tdUyenNhiEmployee), true);
assert.equal(isThuDucEmployee({ ...tdUyenNhiEmployee, branch: "" }, "TD-UyenNhi"), true);
assert.equal(isThuDucEmployee({ ...tdUyenNhiEmployee, branch: "Thủ Đức", employeeName: "Uyên Nhi" }), true);
assert.equal(isThuDucEmployee({
  ...tdUyenNhiEmployee,
  branch: "Q7",
  employeeCode: "Q7-UN",
  employeeName: "Q7-Uyên Nhi",
}), false);

const tdThreeShiftFile = makeAttendanceFile([
  [1, "TD-UN", "TD-UyenNhi", new Date(2026, 9, 1), "T5", time(5, 18), time(14, 32), "", "", time(9, 14), 1, 0, 0, 0, 1, ""],
  [2, "TD-UN", "TD-UyenNhi", new Date(2026, 9, 2), "T6", time(5, 15), time(14, 33), "", "", time(9, 18), 1, 0, 0, 0, 1, ""],
  [3, "TD-UN", "TD-UyenNhi", new Date(2026, 9, 3), "T7", time(8, 27), time(18, 0), "", "", time(9, 33), 1, 0, 0, 0, 1, ""],
  [4, "TD-UN", "TD-UyenNhi", new Date(2026, 9, 4), "CN", time(6, 58), time(16, 5), "", "", time(9, 7), 1, 0, 0, 0, 1, ""],
  [5, "TD-UN", "TD-UyenNhi", new Date(2026, 9, 5), "T2", time(8, 40), time(18, 1), "", "", time(9, 21), 1, 0, 0, 0, 1, ""],
], "td_three_shift_overtime_cases.xlsx");
const tdThreeShiftResult = await processExcelFile(tdThreeShiftFile, [tdUyenNhiEmployee], {
  diaryEntries: [{
    date: "2026-10-01",
    employeeCode: "TD-UN",
    employeeName: "TD-UyenNhi",
    reason: "hoàn tất bàn giao",
    permission: "Có phép",
    violationTypes: ["Tăng ca"],
  }],
});
const tdThreeShiftWorkbook = XLSX.read(
  await tdThreeShiftResult.blob.arrayBuffer(),
  { cellNF: true },
);
const tdThreeShiftSheet = tdThreeShiftWorkbook.Sheets["Chi tiết"];

assert.deepEqual(
  tdThreeShiftResult.determinedShifts.map(({ shift }) => shift),
  ["Sáng", "Sáng", "Tối", "Chiều", "Tối"],
);
assert.deepEqual(
  tdThreeShiftResult.determinedShifts.map(({ isFullDayByMorningToAfternoon }) =>
    isFullDayByMorningToAfternoon),
  [false, false, false, false, false],
);
assert.deepEqual(
  ["L2", "L3", "L4", "L5", "L6"].map((address) => tdThreeShiftSheet[address].v),
  [12, 15, 33, 2, 20],
);
assert.deepEqual(
  ["P2", "P3", "P4", "P5", "P6"].map((address) => tdThreeShiftSheet[address].v),
  [2, 3, 0, 5, 1],
);
["Q2", "Q3", "Q4", "Q5", "Q6"].forEach((address) => {
  assert.doesNotMatch(tdThreeShiftSheet[address].v, /full ngày|full ngày sáng - chiều/i);
});
assert.match(tdThreeShiftSheet.Q2.v, /Tăng ca có phép: hoàn tất bàn giao/);
assert.match(tdThreeShiftSheet.Q3.v, /Tăng ca 3 phút/);
assert.equal(tdThreeShiftResult.highlights[0].violationStatuses.overtime, "permitted");
assert.equal(tdThreeShiftResult.highlights[1].violationStatuses.overtime, "missingDiary");
assert.equal(tdThreeShiftSheet.T7.v, 2);

const overtimeRuleEmployee = {
  id: "overtime-rule",
  branch: "Q7",
  employeeCode: "OTR",
  employeeName: "Overtime Rule",
  registeredShift: "Sáng",
  morningIn: "08:00",
  morningOut: "17:00",
  afternoonIn: "",
  afternoonOut: "",
  eveningIn: "",
  eveningOut: "",
  note: "",
};
const overtimeRuleFile = makeAttendanceFile([
  [1, "OTR", "Overtime Rule", new Date(2026, 8, 1), "T3", time(8, 0), time(18, 30), "", "", time(10, 30), 1, 0, 0, 0, 1, ""],
  [2, "OTR", "Overtime Rule", new Date(2026, 8, 2), "T4", time(8, 0), time(17, 45), "", "", time(9, 45), 1, 0, 0, 0, 1, ""],
  [3, "OTR", "Overtime Rule", new Date(2026, 8, 3), "T5", time(8, 0), time(18, 30), "", "", time(10, 30), 1, 0, 0, 0, 1, ""],
  [4, "OTR", "Overtime Rule", new Date(2026, 8, 4), "T6", time(8, 0), time(18, 30), "", "", time(10, 30), 1, 0, 0, 0, 1, ""],
  [5, "OTR", "Overtime Rule", new Date(2026, 8, 5), "T7", time(8, 0), time(17, 0), "", "", time(9, 0), 1, 0, 0, 0, 1, ""],
  [6, "OTR", "Overtime Rule", new Date(2026, 8, 6), "CN", time(8, 0), time(17, 0), "", "", time(9, 0), 1, 0, 0, 0, 1, ""],
], "overtime_rule_cases.xlsx");
const overtimeRuleResult = await processExcelFile(overtimeRuleFile, [overtimeRuleEmployee], {
  diaryEntries: [
    {
      date: "2026-09-03",
      employeeCode: "OTR",
      employeeName: "Overtime Rule",
      reason: "nhập hàng",
      permission: "Có phép",
      violationTypes: ["Tăng ca"],
    },
    {
      date: "2026-09-04",
      employeeCode: "OTR",
      employeeName: "Overtime Rule",
      reason: "tự ý ở lại",
      permission: "Không phép",
      violationTypes: ["Tăng ca"],
    },
  ],
});
const overtimeRuleWorkbook = XLSX.read(await overtimeRuleResult.blob.arrayBuffer(), { cellNF: true });
const overtimeRuleSheet = overtimeRuleWorkbook.Sheets["Chi tiết"];
assert.equal(overtimeRuleSheet.P2.v, 90);
assert.match(overtimeRuleSheet.Q2.v, /Tăng ca chưa có Diary/);
assert.doesNotMatch(overtimeRuleSheet.Q2.v, /trên 60 phút - tự tính tổng/);
assert.equal(overtimeRuleResult.highlights[0].violationStatuses.overtime, "missingDiary");
assert.equal(overtimeRuleResult.previewHighlights[0][15], "overtime preview-status-missingDiary");

assert.equal(overtimeRuleSheet.P3.v, 45);
assert.match(overtimeRuleSheet.Q3.v, /Tăng ca chưa có Diary/);
assert.equal(overtimeRuleResult.highlights[1].violationStatuses.overtime, "missingDiary");
assert.equal(overtimeRuleResult.previewHighlights[1][15], "overtime preview-status-missingDiary");

assert.equal(overtimeRuleSheet.P4.v, 90);
assert.match(overtimeRuleSheet.Q4.v, /Tăng ca có phép: nhập hàng/);
assert.equal(overtimeRuleResult.highlights[2].violationStatuses.overtime, "permitted");
assert.equal(overtimeRuleResult.previewHighlights[2][15], "overtime preview-status-permitted");

assert.equal(overtimeRuleSheet.P5.v, 90);
assert.match(overtimeRuleSheet.Q5.v, /Tăng ca không phép: tự ý ở lại/);
assert.equal(overtimeRuleResult.highlights[3].violationStatuses.overtime, "notPermitted");
assert.equal(overtimeRuleResult.previewHighlights[3][15], "overtime preview-status-notPermitted");
assert.equal(overtimeRuleSheet.T7.v, 90);
assert.equal(overtimeRuleResult.diaryMatchedRows, 2);
assert.equal(overtimeRuleResult.diaryExemptedRows, 1);

const earlyInRuleEmployee = {
  id: "early-in-rule",
  branch: "Q7",
  employeeCode: "EIR",
  employeeName: "Early In Rule",
  registeredShift: "Sáng",
  morningIn: "09:00",
  morningOut: "18:00",
  afternoonIn: "",
  afternoonOut: "",
  eveningIn: "",
  eveningOut: "",
  note: "",
};
const earlyInRuleFile = makeAttendanceFile([
  [1, "EIR", "Early In Rule", new Date(2026, 10, 1), "CN", time(7, 30), time(18, 0), "", "", time(10, 30), 1, 0, 0, 0, 1, ""],
  [2, "EIR", "Early In Rule", new Date(2026, 10, 2), "T2", time(8, 30), time(18, 0), "", "", time(9, 30), 1, 0, 0, 0, 1, ""],
  [3, "EIR", "Early In Rule", new Date(2026, 10, 3), "T3", time(7, 30), time(18, 0), "", "", time(10, 30), 1, 0, 0, 0, 1, ""],
  [4, "EIR", "Early In Rule", new Date(2026, 10, 4), "T4", time(7, 30), time(18, 0), "", "", time(10, 30), 1, 0, 0, 0, 1, ""],
], "early_in_rule_cases.xlsx");
const earlyInRuleResult = await processExcelFile(earlyInRuleFile, [earlyInRuleEmployee], {
  diaryEntries: [
    {
      date: "2026-11-03",
      employeeCode: "EIR",
      employeeName: "Early In Rule",
      reason: "hỗ trợ mở shop",
      permission: "Có phép",
      violationTypes: ["Đi sớm"],
    },
    {
      date: "2026-11-04",
      employeeCode: "EIR",
      employeeName: "Early In Rule",
      reason: "tự ý đến sớm",
      permission: "Không phép",
      violationTypes: ["Đi sớm"],
    },
  ],
});
const earlyInRuleWorkbook = XLSX.read(await earlyInRuleResult.blob.arrayBuffer(), { cellNF: true });
const earlyInRuleSheet = earlyInRuleWorkbook.Sheets["Chi tiết"];

assert.equal(earlyInRuleSheet.L2.v, 90);
assert.match(earlyInRuleSheet.Q2.v, /Đi sớm chưa có Diary/);
assert.doesNotMatch(earlyInRuleSheet.Q2.v, /trên 60 phút - tự tính tổng/);
assert.equal(earlyInRuleResult.highlights[0].violationStatuses.earlyIn, "missingDiary");
assert.equal(earlyInRuleResult.previewHighlights[0][11], "earlyIn preview-status-missingDiary");

assert.equal(earlyInRuleSheet.L3.v, 30);
assert.match(earlyInRuleSheet.Q3.v, /Đi sớm chưa có Diary/);
assert.equal(earlyInRuleResult.highlights[1].violationStatuses.earlyIn, "missingDiary");
assert.equal(earlyInRuleResult.previewHighlights[1][11], "earlyIn preview-status-missingDiary");

assert.equal(earlyInRuleSheet.L4.v, 90);
assert.match(earlyInRuleSheet.Q4.v, /Đi sớm có phép: hỗ trợ mở shop/);
assert.equal(earlyInRuleResult.highlights[2].violationStatuses.earlyIn, "permitted");
assert.equal(earlyInRuleResult.previewHighlights[2][11], "earlyIn preview-status-permitted");

assert.equal(earlyInRuleSheet.L5.v, 90);
assert.match(earlyInRuleSheet.Q5.v, /Đi sớm không phép: tự ý đến sớm/);
assert.equal(earlyInRuleResult.highlights[3].violationStatuses.earlyIn, "notPermitted");
assert.equal(earlyInRuleResult.previewHighlights[3][11], "earlyIn preview-status-notPermitted");
assert.equal(earlyInRuleSheet.T3.v, 0);
assert.equal(earlyInRuleResult.diaryMatchedRows, 2);
assert.equal(earlyInRuleResult.diaryExemptedRows, 1);

const morningToAfternoonEmployee = {
  id: "morning-to-afternoon",
  branch: "Q7",
  employeeCode: "FULLDAY",
  employeeName: "Q7-Trang Full Day",
  registeredShift: "8",
  morningIn: "07:30",
  morningOut: "16:30",
  afternoonIn: "12:00",
  afternoonOut: "21:00",
  eveningIn: "",
  eveningOut: "",
  note: "",
};
const morningToAfternoonFile = makeAttendanceFile([
  [1, "FULLDAY", "Q7-Trang Full Day", new Date(2026, 8, 8), "T3", time(7, 37), time(21, 3), "", "", time(13, 26), 1, 0, 0, 0, 1, ""],
  [2, "FULLDAY", "Q7-Trang Full Day", new Date(2026, 8, 9), "T4", time(7, 34), time(21, 2), "", "", time(13, 28), 1, 0, 0, 0, 1, ""],
  [3, "FULLDAY", "Q7-Trang Full Day", new Date(2026, 8, 10), "T5", time(7, 30), time(18, 0), "", "", time(10, 30), 1, 0, 0, 0, 1, ""],
  [4, "FULLDAY", "Q7-Trang Full Day", new Date(2026, 8, 11), "T6", time(12, 0), time(21, 3), "", "", time(9, 3), 1, 0, 0, 0, 1, ""],
  [5, "FULLDAY", "Q7-Trang Full Day", new Date(2026, 8, 12), "T7", time(7, 30), time(21, 5), "", "", time(13, 35), 1, 0, 0, 0, 1, ""],
], "morning_to_afternoon_full_day_cases.xlsx");
const morningToAfternoonResult = await processExcelFile(
  morningToAfternoonFile,
  [morningToAfternoonEmployee],
  {
    diaryEntries: [{
      date: "2026-09-12",
      employeeCode: "FULLDAY",
      employeeName: "Q7-Trang Full Day",
      reason: "hỗ trợ tồn kho",
      permission: "Không phép",
      violationTypes: ["Tăng ca"],
    }],
  },
);
const morningToAfternoonWorkbook = XLSX.read(
  await morningToAfternoonResult.blob.arrayBuffer(),
  { cellNF: true },
);
const morningToAfternoonSheet = morningToAfternoonWorkbook.Sheets["Chi tiết"];

assert.equal(morningToAfternoonResult.determinedShifts[0].shift, "Sáng");
assert.equal(morningToAfternoonResult.determinedShifts[0].shiftKey, "morning");
assert.equal(morningToAfternoonResult.determinedShifts[0].isFullDayByMorningToAfternoon, true);
assert.equal(morningToAfternoonResult.determinedShifts[0].standardOutTime, "16:30");
assert.equal(morningToAfternoonResult.determinedShifts[0].expectedEndByRegisteredHoursTime, "15:30");
assert.equal(morningToAfternoonResult.determinedShifts[0].overtimeStandardOutTime, "15:30");
assert.equal(morningToAfternoonResult.determinedShifts[0].overtimeActualOutTime, "21:00");
assert.equal(morningToAfternoonSheet.P2.v, 330);
assert.match(morningToAfternoonSheet.Q2.v, /Tăng ca full ngày: tính từ 15:30 đến 21:00/);
assert.match(morningToAfternoonSheet.Q2.v, /Tăng ca làm full ngày sáng - chiều/);
assert.doesNotMatch(morningToAfternoonSheet.Q2.v, /Tăng ca chưa có Diary/);
assert.equal(morningToAfternoonResult.highlights[0].violationStatuses.overtime, "fullDay");
assert.equal(
  morningToAfternoonResult.previewHighlights[0][15],
  "overtime preview-status-fullDay",
);

assert.equal(morningToAfternoonResult.determinedShifts[1].shift, "Sáng");
assert.equal(morningToAfternoonResult.determinedShifts[1].isFullDayByMorningToAfternoon, true);
assert.equal(morningToAfternoonSheet.P3.v, 330);
assert.match(morningToAfternoonSheet.Q3.v, /Tăng ca full ngày: tính từ 15:30 đến 21:00/);
assert.equal(morningToAfternoonResult.highlights[1].violationStatuses.overtime, "fullDay");
assert.equal(
  morningToAfternoonResult.previewHighlights[1][15],
  "overtime preview-status-fullDay",
);

assert.equal(morningToAfternoonResult.determinedShifts[2].shift, "Sáng");
assert.equal(morningToAfternoonResult.determinedShifts[2].isFullDayByMorningToAfternoon, false);
assert.equal(morningToAfternoonResult.determinedShifts[2].expectedEndByRegisteredHoursTime, "15:30");
assert.equal(morningToAfternoonSheet.P4.v, 150);
assert.match(morningToAfternoonSheet.Q4.v, /Tăng ca chưa có Diary/);
assert.equal(morningToAfternoonResult.highlights[2].violationStatuses.overtime, "missingDiary");

assert.equal(morningToAfternoonResult.determinedShifts[3].shift, "Chiều");
assert.equal(morningToAfternoonResult.determinedShifts[3].shiftKey, "afternoon");
assert.equal(morningToAfternoonResult.determinedShifts[3].isFullDayByMorningToAfternoon, false);
assert.equal(morningToAfternoonResult.determinedShifts[3].expectedEndByRegisteredHoursTime, "20:00");
assert.equal(morningToAfternoonSheet.P5.v, 63);
assert.match(morningToAfternoonSheet.Q5.v, /Tăng ca chưa có Diary/);

assert.equal(morningToAfternoonSheet.P6.v, 330);
assert.match(
  morningToAfternoonSheet.Q6.v,
  /Tăng ca full ngày: tính từ 15:30 đến 21:00/,
);
assert.match(
  morningToAfternoonSheet.Q6.v,
  /Tăng ca làm full ngày sáng - chiều: hỗ trợ tồn kho/,
);
assert.equal(morningToAfternoonResult.highlights[4].violationStatuses.overtime, "notPermitted");
assert.equal(morningToAfternoonSheet.T7.v, 990);

const makeOfficeOvertimeEmployee = (employeeCode, employeeName) => ({
  id: `office-overtime-${employeeCode}`,
  branch: "VP",
  employeeCode,
  employeeName,
  registeredShift: "Sáng",
  morningIn: "08:00",
  morningOut: "17:00",
  afternoonIn: "",
  afternoonOut: "",
  eveningIn: "",
  eveningOut: "",
  note: "",
});

const vpNhiEmployee = makeOfficeOvertimeEmployee("VP-NHI", "VP-Nhi");
const vpNhiOvertimeFile = makeAttendanceFile([
  [1, "VP-NHI", "VP-Nhi", new Date(2026, 8, 15), "T3", time(8, 0), time(17, 30), "", "", time(9, 30), 1, 0, 0, 0, 1, ""],
], "vp_nhi_overtime.xlsx");
const vpNhiOvertimeResult = await processExcelFile(vpNhiOvertimeFile, [vpNhiEmployee], {
  diaryEntries: [{
    date: "2026-09-15",
    employeeCode: "VP-NHI",
    employeeName: "VP-Nhi",
    reason: "hoàn tất báo cáo",
    permission: "Có phép",
    violationTypes: ["Tăng ca"],
  }],
});
const vpNhiOvertimeWorkbook = XLSX.read(
  await vpNhiOvertimeResult.blob.arrayBuffer(),
  { cellNF: true },
);
const vpNhiOvertimeSheet = vpNhiOvertimeWorkbook.Sheets["Chi tiết"];
assert.equal(vpNhiOvertimeSheet.P2.v, 30);
assert.equal(vpNhiOvertimeSheet.T7.v, 0);
assert.match(
  vpNhiOvertimeSheet.Q2.v,
  /Tăng ca VP không tính tổng: hoàn tất báo cáo/,
);
assert.doesNotMatch(vpNhiOvertimeSheet.Q2.v, /Tăng ca có phép/);
assert.equal(vpNhiOvertimeResult.highlights[0].overtime, true);
assert.equal(vpNhiOvertimeResult.highlights[0].violationStatuses.overtime, "permitted");
assert.equal(vpNhiOvertimeResult.diaryMatchedRows, 1);
assert.equal(vpNhiOvertimeResult.diaryExemptedRows, 0);

const vpDanhEmployee = makeOfficeOvertimeEmployee("VP-DANH", "VP-Danh");
const vpDanhOvertimeFile = makeAttendanceFile([
  [1, "VP-DANH", "VP-Danh", new Date(2026, 8, 16), "T4", time(8, 0), time(19, 0), "", "", time(11, 0), 1, 0, 0, 0, 1, ""],
], "vp_danh_overtime.xlsx");
const vpDanhOvertimeResult = await processExcelFile(vpDanhOvertimeFile, [vpDanhEmployee]);
const vpDanhOvertimeWorkbook = XLSX.read(
  await vpDanhOvertimeResult.blob.arrayBuffer(),
  { cellNF: true },
);
const vpDanhOvertimeSheet = vpDanhOvertimeWorkbook.Sheets["Chi tiết"];
assert.equal(vpDanhOvertimeSheet.P2.v, 120);
assert.equal(vpDanhOvertimeSheet.T7.v, 0);
assert.match(vpDanhOvertimeSheet.Q2.v, /Tăng ca VP không tính tổng/);
assert.doesNotMatch(vpDanhOvertimeSheet.Q2.v, /Tăng ca chưa có Diary/);
assert.doesNotMatch(vpDanhOvertimeSheet.Q2.v, /trên 60 phút - tự tính tổng/);
assert.equal(vpDanhOvertimeResult.highlights[0].overtime, true);

const vpHoaFullDayEmployee = {
  ...morningToAfternoonEmployee,
  id: "vp-hoa-full-day",
  employeeCode: "VP-HOA",
  employeeName: "VP-Hoa",
};
const vpHoaFullDayFile = makeAttendanceFile([
  [1, "VP-HOA", "VP-Hoa", new Date(2026, 8, 17), "T5", time(7, 37), time(21, 3), "", "", time(13, 26), 1, 0, 0, 0, 1, ""],
], "vp_hoa_full_day_overtime.xlsx");
const vpHoaFullDayResult = await processExcelFile(vpHoaFullDayFile, [vpHoaFullDayEmployee]);
const vpHoaFullDayWorkbook = XLSX.read(
  await vpHoaFullDayResult.blob.arrayBuffer(),
  { cellNF: true },
);
const vpHoaFullDaySheet = vpHoaFullDayWorkbook.Sheets["Chi tiết"];
assert.equal(vpHoaFullDaySheet.P2.v, 330);
assert.equal(vpHoaFullDaySheet.T7.v, 0);
assert.match(vpHoaFullDaySheet.Q2.v, /Tăng ca VP không tính tổng/);
assert.doesNotMatch(vpHoaFullDaySheet.Q2.v, /Tăng ca làm full ngày sáng - chiều/);
assert.equal(vpHoaFullDayResult.determinedShifts[0].isFullDayByMorningToAfternoon, true);
assert.equal(vpHoaFullDayResult.highlights[0].overtime, true);

const fullDayPreferredOut1Calculation = calculateTimekeeping({
  employee: morningToAfternoonEmployee,
  employeeName: morningToAfternoonEmployee.employeeName,
  clockValues: {
    in1: "07:30",
    out1: "21:10",
    in2: "",
    out2: "16:50",
  },
  fallbackTotal: "13:10",
});
assert.equal(fullDayPreferredOut1Calculation.isFullDayByMorningToAfternoon, true);
assert.equal(fullDayPreferredOut1Calculation.actualOutSource, "Ra 2");
assert.equal(fullDayPreferredOut1Calculation.overtimeActualOutTime, "21:00");
assert.equal(fullDayPreferredOut1Calculation.expectedEndByRegisteredHoursTime, "15:30");
assert.equal(fullDayPreferredOut1Calculation.overtimeMinutes, 330);

const vpMonthlyWarningEmployee = {
  id: "vp-monthly-warning",
  branch: "VP",
  employeeCode: "VPW",
  employeeName: "VP-Warning",
  registeredShift: "Sáng",
  morningIn: "08:00",
  morningOut: "17:00",
  afternoonIn: "",
  afternoonOut: "",
  eveningIn: "",
  eveningOut: "",
  note: "",
};
const vpMonthlyWarningFile = makeAttendanceFile([
  [1, "VPW", "VP-Warning", new Date(2026, 11, 1), "T3", time(9, 10), time(17, 0), "", "", time(7, 50), 1, 0, 0, 0, 1, ""],
  [2, "VPW", "VP-Warning", new Date(2026, 11, 2), "T4", time(9, 10), time(17, 0), "", "", time(7, 50), 1, 0, 0, 0, 1, ""],
  [3, "VPW", "VP-Warning", new Date(2026, 11, 3), "T5", time(9, 10), time(17, 0), "", "", time(7, 50), 1, 0, 0, 0, 1, ""],
], "vp_monthly_warning.xlsx");
const vpMonthlyWarningResult = await processExcelFile(vpMonthlyWarningFile, [vpMonthlyWarningEmployee]);
const vpMonthlyWarningWorkbook = XLSX.read(await vpMonthlyWarningResult.blob.arrayBuffer(), { cellNF: true });
const vpMonthlyWarningSheet = vpMonthlyWarningWorkbook.Sheets["Chi tiết"];
assert.equal(vpMonthlyWarningResult.vpMonthlyLateSummaries[0].totalLateMinutes, 210);
["Q2", "Q3", "Q4"].forEach((address) => {
  assert.doesNotMatch(vpMonthlyWarningSheet[address].v, new RegExp(MONTHLY_LATE_WARNING_TEXT));
});
assert.equal(vpMonthlyWarningSheet.S8.v, MONTHLY_LATE_WARNING_TEXT);

assert.deepEqual(normalizeDiaryViolationTypes(["OFF > 2 ngày"]), ["OFF"]);

const makeLongOffEmployee = (employeeCode, employeeName) => ({
  id: employeeCode,
  branch: "Q7",
  employeeCode,
  employeeName,
  registeredShift: "Sáng",
  morningIn: "08:00",
  morningOut: "17:00",
  afternoonIn: "",
  afternoonOut: "",
  eveningIn: "",
  eveningOut: "",
  note: "",
});
const longOffEmployees = [
  makeLongOffEmployee("OFFP", "Off Permitted"),
  makeLongOffEmployee("OFFD", "Off Denied"),
  makeLongOffEmployee("OFFM", "Off Missing"),
  makeLongOffEmployee("OFF1", "Off Single"),
];
const longOffFile = makeAttendanceFile([
  [1, "OFFP", "Off Permitted", new Date(2026, 7, 1), "T7", "", "", "", "", 0, 0, 0, 0, 0, 0, ""],
  [2, "OFFP", "Off Permitted", new Date(2026, 7, 2), "CN", "", "", "", "", 0, 0, 0, 0, 0, 0, ""],
  [3, "OFFD", "Off Denied", new Date(2026, 7, 1), "T7", "", "", "", "", 0, 0, 0, 0, 0, 0, ""],
  [4, "OFFD", "Off Denied", new Date(2026, 7, 2), "CN", "", "", "", "", 0, 0, 0, 0, 0, 0, ""],
  [5, "OFFM", "Off Missing", new Date(2026, 7, 1), "T7", "", "", "", "", 0, 0, 0, 0, 0, 0, ""],
  [6, "OFFM", "Off Missing", new Date(2026, 7, 2), "CN", "", "", "", "", 0, 0, 0, 0, 0, 0, ""],
  [7, "OFF1", "Off Single", new Date(2026, 7, 1), "T7", "", "", "", "", 0, 0, 0, 0, 0, 0, ""],
], "long_off_cases.xlsx");
const longOffResult = await processExcelFile(longOffFile, longOffEmployees, {
  diaryEntries: [
    {
      date: "2026-08-01",
      employeeCode: "OFFP",
      employeeName: "Off Permitted",
      reason: "nghỉ cũ",
      permission: "Không phép",
      violationTypes: ["OFF > 2 ngày"],
      createdAt: "2026-08-01T01:00:00.000Z",
    },
    {
      date: "2026-08-01",
      employeeCode: "OFFP",
      employeeName: "Off Permitted",
      reason: "nghỉ bệnh",
      permission: "Có phép",
      violationTypes: ["OFF > 2 ngày"],
      createdAt: "2026-08-01T02:00:00.000Z",
    },
    {
      date: "2026-08-02",
      employeeCode: "OFFP",
      employeeName: "Off Permitted",
      reason: "nghỉ bệnh",
      permission: "Có phép",
      violationTypes: ["OFF"],
    },
    {
      date: "2026-08-01",
      employeeCode: "OFFD",
      employeeName: "Off Denied",
      reason: "nghỉ không báo",
      permission: "Không phép",
      violationTypes: ["OFF > 2 ngày"],
    },
    {
      date: "2026-08-02",
      employeeCode: "OFFD",
      employeeName: "Off Denied",
      reason: "nghỉ không báo",
      permission: "Không phép",
      violationTypes: ["OFF > 2 ngày"],
    },
  ],
});
const longOffWorkbook = XLSX.read(await longOffResult.blob.arrayBuffer(), { cellNF: true });
const longOffSheet = longOffWorkbook.Sheets["Chi tiết"];
assert.match(longOffSheet.Q2.v, /OFF > 2 ngày có phép: nghỉ bệnh/);
assert.doesNotMatch(longOffSheet.Q2.v, /nghỉ cũ/);
assert.equal(longOffResult.highlights[0].longOff, true);
assert.equal(longOffResult.highlights[0].longOffStatus, "permitted");
assert.equal(longOffResult.previewHighlights[0][16], "off preview-status-permitted");
assert.equal(longOffSheet.L2?.v, undefined);
assert.equal(longOffSheet.M2?.v, undefined);
assert.equal(longOffSheet.O2?.v, undefined);
assert.equal(longOffSheet.P2?.v, undefined);

assert.match(longOffSheet.Q4.v, /OFF > 2 ngày không phép: nghỉ không báo/);
assert.equal(longOffResult.highlights[2].longOffStatus, "notPermitted");
assert.equal(longOffResult.previewHighlights[2][16], "off preview-status-notPermitted");

assert.match(longOffSheet.Q6.v, /OFF > 2 ngày chưa có Diary/);
assert.equal(longOffResult.highlights[4].longOffStatus, "missingDiary");
assert.equal(longOffResult.previewHighlights[4][16], "off preview-status-missingDiary");

assert.doesNotMatch(longOffSheet.Q8.v, /OFF > 2 ngày/);
assert.equal(longOffResult.highlights[6].longOff, false);
assert.equal(longOffResult.previewHighlights[6][16], null);
assert.equal(longOffResult.diaryMatchedRows, 4);
assert.equal(longOffResult.diaryExemptedRows, 2);

const diaryViolationEmployee = {
  id: "diary-violation-case",
  branch: "Q7",
  employeeCode: "DIA1",
  employeeName: "Diary Tester",
  registeredShift: "Sáng",
  morningIn: "08:00",
  morningOut: "17:00",
  afternoonIn: "",
  afternoonOut: "",
  eveningIn: "",
  eveningOut: "",
  note: "",
};
const diaryViolationFile = makeAttendanceFile([
  [1, "DIA1", "Diary Tester", new Date(2026, 6, 1), "T4", time(8, 20), time(17, 0), "", "", time(8, 40), 1, 0, 0, 0, 1, ""],
  [2, "DIA1", "Diary Tester", new Date(2026, 6, 2), "T5", time(8, 20), time(17, 0), "", "", time(8, 40), 1, 0, 0, 0, 1, ""],
  [3, "DIA1", "Diary Tester", new Date(2026, 6, 3), "T6", time(7, 30), time(17, 0), "", "", time(9, 30), 1, 0, 0, 0, 1, ""],
  [4, "DIA1", "Diary Tester", new Date(2026, 6, 4), "T7", time(8, 0), time(16, 30), "", "", time(8, 30), 1, 0, 0, 0, 1, ""],
  [5, "DIA1", "Diary Tester", new Date(2026, 6, 5), "CN", time(8, 0), time(18, 0), "", "", time(10, 0), 1, 0, 0, 0, 1, ""],
], "diary_violation_cases.xlsx");
const diaryViolationResult = await processExcelFile(diaryViolationFile, [diaryViolationEmployee], {
  diaryEntries: [
    {
      date: "2026-07-01",
      employeeCode: "DIA1",
      employeeName: "Diary Tester",
      reason: "Kẹt xe",
      permission: "Có phép",
      violationTypes: ["Đi trễ"],
    },
    {
      date: "2026-07-02",
      employeeCode: "DIA1",
      employeeName: "Diary Tester",
      reason: "Ngủ quên",
      permission: "Không phép",
      violationTypes: ["Đi trễ"],
    },
    {
      date: "2026-07-03",
      employeeCode: "DIA1",
      employeeName: "Diary Tester",
      reason: "Mở cửa",
      permission: "Có phép",
      violationTypes: ["Đi sớm"],
    },
    {
      date: "2026-07-04",
      employeeCode: "DIA1",
      employeeName: "Diary Tester",
      reason: "Khám bệnh",
      permission: "Có phép",
      violationTypes: ["Về sớm"],
    },
    {
      date: "2026-07-05",
      employeeCode: "DIA1",
      employeeName: "Diary Tester",
      reason: "Kiểm kê",
      permission: "Có phép",
      violationTypes: ["Tăng ca"],
    },
  ],
});
const diaryViolationWorkbook = XLSX.read(await diaryViolationResult.blob.arrayBuffer(), {
  cellNF: true,
  cellStyles: true,
});
const diaryViolationSheet = diaryViolationWorkbook.Sheets["Chi tiết"];
assert.equal(diaryViolationSheet.M2.v, 20);
assert.equal(diaryViolationSheet.N2.v, 0);
assert.match(diaryViolationSheet.Q2.v, /Đi trễ có phép: Kẹt xe/);
assert.equal(diaryViolationResult.highlights[0].violationStatuses.late, "permitted");
assert.equal(diaryViolationResult.previewHighlights[0][12], "late preview-status-permitted");

assert.equal(diaryViolationSheet.M3.v, 20);
assert.equal(diaryViolationSheet.N3.v, 70000);
assert.match(diaryViolationSheet.Q3.v, /Đi trễ không phép: Ngủ quên/);
assert.equal(diaryViolationResult.highlights[1].violationStatuses.late, "notPermitted");
assert.equal(diaryViolationResult.previewHighlights[1][12], "late preview-status-notPermitted");

assert.equal(diaryViolationSheet.L4.v, 30);
assert.match(diaryViolationSheet.Q4.v, /Đi sớm có phép: Mở cửa/);
assert.equal(diaryViolationResult.highlights[2].violationStatuses.earlyIn, "permitted");
assert.equal(diaryViolationResult.previewHighlights[2][11], "earlyIn preview-status-permitted");

assert.equal(diaryViolationSheet.O5.v, 30);
assert.match(diaryViolationSheet.Q5.v, /Về sớm có phép: Khám bệnh/);
assert.equal(diaryViolationResult.highlights[3].violationStatuses.early, "permitted");
assert.equal(diaryViolationResult.previewHighlights[3][14], "early preview-status-permitted");

assert.equal(diaryViolationSheet.P6.v, 60);
assert.match(diaryViolationSheet.Q6.v, /Tăng ca có phép: Kiểm kê/);
assert.equal(diaryViolationResult.highlights[4].violationStatuses.overtime, "permitted");
assert.equal(diaryViolationResult.previewHighlights[4][15], "overtime preview-status-permitted");
assert.equal(diaryViolationSheet.T4.v, 40);
assert.equal(diaryViolationResult.diaryMatchedRows, 5);
assert.equal(diaryViolationResult.diaryExemptedRows, 4);

const mandatoryLateEmployee = {
  id: "mandatory-late-total",
  branch: "Q7",
  employeeCode: "LATE15",
  employeeName: "Late Total Tester",
  registeredShift: "Sáng",
  morningIn: "08:00",
  morningOut: "17:00",
  afternoonIn: "",
  afternoonOut: "",
  eveningIn: "",
  eveningOut: "",
  note: "",
};
const mandatoryLateFile = makeAttendanceFile([
  [1, "LATE15", "Late Total Tester", new Date(2026, 10, 10), "T3", time(8, 15), time(17, 0), "", "", time(8, 45), 1, 0, 0, 0, 1, "Ghi chú nền; Đi trễ có phép: kẹt xe"],
  [2, "LATE15", "Late Total Tester", new Date(2026, 10, 11), "T4", time(8, 15), time(17, 0), "", "", time(8, 45), 1, 0, 0, 0, 1, ""],
  [3, "LATE15", "Late Total Tester", new Date(2026, 10, 12), "T5", time(8, 15), time(17, 0), "", "", time(8, 45), 1, 0, 0, 0, 1, ""],
], "mandatory_late_total_cases.xlsx");
const mandatoryLateResult = await processExcelFile(mandatoryLateFile, [mandatoryLateEmployee], {
  diaryEntries: [
    {
      date: "2026-11-10",
      employeeCode: "LATE15",
      employeeName: "Late Total Tester",
      reason: "kẹt xe",
      permission: "Có phép",
      violationTypes: ["Đi trễ"],
      createdAt: "2026-11-10T09:00:00.000Z",
      updatedAt: "2026-11-10T09:00:00.000Z",
    },
    {
      date: "2026-11-10",
      employeeCode: "LATE15",
      employeeName: "Late Total Tester",
      reason: "lý do cũ",
      permission: "Không phép",
      violationTypes: ["Đi trễ"],
      createdAt: "2026-11-10T08:00:00.000Z",
      updatedAt: "2026-11-10T08:00:00.000Z",
    },
    {
      date: "2026-11-11",
      employeeCode: "LATE15",
      employeeName: "Late Total Tester",
      reason: "ngủ quên",
      permission: "Không phép",
      violationTypes: ["Đi trễ"],
    },
  ],
});
const mandatoryLateWorkbook = XLSX.read(await mandatoryLateResult.blob.arrayBuffer(), {
  cellNF: true,
  cellStyles: true,
});
const mandatoryLateSheet = mandatoryLateWorkbook.Sheets["Chi tiết"];

assert.equal(mandatoryLateSheet.M2.v, 15);
assert.equal(mandatoryLateSheet.N2.v, 0);
assert.match(mandatoryLateSheet.Q2.v, /Ghi chú nền; .*Đi trễ có phép: kẹt xe/);
assert.equal((mandatoryLateSheet.Q2.v.match(/Đi trễ có phép: kẹt xe/g) ?? []).length, 1);
assert.doesNotMatch(mandatoryLateSheet.Q2.v, /lý do cũ/);
assert.equal(mandatoryLateResult.highlights[0].violationStatuses.late, "permitted");
assert.equal(mandatoryLateResult.previewHighlights[0][12], "late preview-status-permitted");

assert.equal(mandatoryLateSheet.M3.v, 15);
assert.equal(mandatoryLateSheet.N3.v, 70000);
assert.match(mandatoryLateSheet.Q3.v, /Đi trễ không phép: ngủ quên/);
assert.equal(mandatoryLateResult.highlights[1].violationStatuses.late, "notPermitted");
assert.equal(mandatoryLateResult.previewHighlights[1][12], "late preview-status-notPermitted");

assert.equal(mandatoryLateSheet.M4.v, 15);
assert.equal(mandatoryLateSheet.N4.v, 70000);
assert.match(mandatoryLateSheet.Q4.v, /Đi trễ chưa có Diary/);
assert.equal(mandatoryLateResult.highlights[2].violationStatuses.late, "missingDiary");
assert.equal(mandatoryLateResult.previewHighlights[2][12], "late preview-status-missingDiary");

assert.equal(mandatoryLateSheet.T4.v, 45);
assert.equal(mandatoryLateResult.diaryMatchedRows, 2);
assert.equal(mandatoryLateResult.diaryExemptedRows, 1);

const earlyTotalEmployee = {
  id: "early-total",
  branch: "Q7",
  employeeCode: "EARLYTOTAL",
  employeeName: "Early Total",
  registeredShift: "Sáng",
  morningIn: "08:00",
  morningOut: "17:00",
  afternoonIn: "",
  afternoonOut: "",
  eveningIn: "",
  eveningOut: "",
  note: "",
};
const earlyTotalFile = makeAttendanceFile([
  [1, "EARLYTOTAL", "Early Total", new Date(2026, 9, 1), "T5", time(8, 0), time(16, 30), "", "", time(8, 30), 1, 0, 0, 0, 1, ""],
  [2, "EARLYTOTAL", "Early Total", new Date(2026, 9, 2), "T6", time(8, 0), time(16, 30), "", "", time(8, 30), 1, 0, 0, 0, 1, ""],
  [3, "EARLYTOTAL", "Early Total", new Date(2026, 9, 3), "T7", time(8, 0), time(16, 30), "", "", time(8, 30), 1, 0, 0, 0, 1, ""],
  [4, "EARLYTOTAL", "Early Total", new Date(2026, 9, 4), "CN", time(8, 0), time(17, 0), "", "", time(9, 0), 1, 0, 0, 0, 1, ""],
  [5, "EARLYTOTAL", "Early Total", new Date(2026, 9, 6), "T3", time(8, 0), time(17, 0), "", "", time(9, 0), 1, 0, 0, 0, 1, ""],
], "early_total_cases.xlsx");
const earlyTotalResult = await processExcelFile(earlyTotalFile, [earlyTotalEmployee], {
  diaryEntries: [
    {
      date: "2026-10-01",
      employeeCode: "EARLYTOTAL",
      employeeName: "Early Total",
      reason: "benh",
      permission: "Có phép",
      violationTypes: ["Về sớm"],
    },
    {
      date: "2026-10-02",
      employeeCode: "EARLYTOTAL",
      employeeName: "Early Total",
      reason: "viec rieng",
      permission: "Không phép",
      violationTypes: ["Về sớm"],
    },
  ],
});
const earlyTotalWorkbook = XLSX.read(await earlyTotalResult.blob.arrayBuffer(), {
  cellNF: true,
  cellStyles: true,
});
const earlyTotalSheet = earlyTotalWorkbook.Sheets["Chi tiết"];
assert.equal(earlyTotalSheet.O2.v, 30);
assert.match(earlyTotalSheet.Q2.v, /Về sớm có phép: benh/);
assert.equal(earlyTotalResult.highlights[0].violationStatuses.early, "permitted");
assert.equal(earlyTotalResult.previewHighlights[0][14], "early preview-status-permitted");

assert.equal(earlyTotalSheet.O3.v, 30);
assert.match(earlyTotalSheet.Q3.v, /Về sớm không phép: viec rieng/);
assert.equal(earlyTotalResult.highlights[1].violationStatuses.early, "notPermitted");
assert.equal(earlyTotalResult.previewHighlights[1][14], "early preview-status-notPermitted");

assert.equal(earlyTotalSheet.O4.v, 30);
assert.match(earlyTotalSheet.Q4.v, /Về sớm chưa có Diary/);
assert.equal(earlyTotalResult.highlights[2].violationStatuses.early, "missingDiary");
assert.equal(earlyTotalResult.previewHighlights[2][14], "early preview-status-missingDiary");
assert.equal(earlyTotalSheet.T6.v, 90);
assert.equal(earlyTotalResult.diaryMatchedRows, 2);
assert.equal(earlyTotalResult.diaryExemptedRows, 1);

const earlyInAuditFile = makeAttendanceFile([
  [1, "EIR", "Early In Rule", new Date(2026, 10, 5), "T5", time(8, 15), time(18, 0), "", "", time(9, 45), 1, 0, 0, 0, 1, ""],
  [2, "EIR", "Early In Rule", new Date(2026, 10, 6), "T6", time(8, 15), time(18, 0), "", "", time(9, 45), 1, 0, 0, 0, 1, ""],
], "early_in_audit_only_cases.xlsx");
const earlyInAuditResult = await processExcelFile(earlyInAuditFile, [earlyInRuleEmployee], {
  diaryEntries: [{
    date: "2026-11-05",
    employeeCode: "EIR",
    employeeName: "Early In Rule",
    reason: "hỗ trợ mở shop",
    permission: "Có phép",
    violationTypes: ["Đi sớm"],
  }],
});
const earlyInAuditWorkbook = XLSX.read(
  await earlyInAuditResult.blob.arrayBuffer(),
  { cellNF: true },
);
const earlyInAuditSheet = earlyInAuditWorkbook.Sheets["Chi tiết"];
assert.equal(earlyInAuditSheet.L2.v, 45);
assert.match(earlyInAuditSheet.Q2.v, /Đi sớm có phép: hỗ trợ mở shop/);
assert.equal(earlyInAuditSheet.L3.v, 45);
assert.match(earlyInAuditSheet.Q3.v, /Đi sớm chưa có Diary/);
assert.equal(earlyInAuditSheet.T3.v, 0);

assert.equal(calculateTotalWorkedMinutes("09:00"), 480);
assert.equal(calculateTotalWorkedMinutes("04:00", { deductLunchBreak: false }), 240);
assert.equal(calculateTotalWorkedMinutes("04:00"), 180);
assert.equal(formatDurationMinutes(450), "07:30");

const fullOvertimeCalculation = calculateTimekeeping({
  employee: {
    employeeName: "FULL-Nam",
    registeredShift: "8",
    morningIn: "08:00",
    morningOut: "17:00",
    afternoonIn: "",
    afternoonOut: "",
    eveningIn: "",
    eveningOut: "",
    note: "",
  },
  employeeName: "FULL-Nam",
  clockValues: { in1: "08:00", out1: "18:00", in2: "", out2: "" },
  fallbackTotal: "10:00",
});
assert.equal(fullOvertimeCalculation.totalWorkedMinutes, 540);
assert.equal(fullOvertimeCalculation.overtimeMinutes, 60);

const threeShiftEmployee = {
  morningIn: "07:30",
  morningOut: "11:30",
  afternoonIn: "13:00",
  afternoonOut: "17:00",
  eveningIn: "18:00",
  eveningOut: "22:00",
  fullIn: "07:30",
  fullOut: "17:00",
  note: "",
};

assert.equal(
  determineNearestShift(threeShiftEmployee, { in1: "07:20", in2: "" }).name,
  "Sáng",
);
assert.equal(
  determineNearestShift(threeShiftEmployee, { in1: "12:50", in2: "" }).name,
  "Chiều",
);
assert.equal(
  determineNearestShift(threeShiftEmployee, { in1: "17:58", in2: "" }).name,
  "Tối",
);
assert.equal(
  determineNearestShift(
    {
      morningIn: "08:00",
      morningOut: "17:00",
      afternoonIn: "12:00",
      afternoonOut: "21:00",
      eveningIn: "",
      eveningOut: "",
      registeredShift: "8",
    },
    { in1: "10:00", out1: "21:00", in2: "", out2: "" },
  ).name,
  "Sáng",
);
assert.equal(
  determineNearestShift(
    { fullIn: "08:00", fullOut: "17:00" },
    { in1: "08:00", out1: "17:00" },
  ),
  null,
);

const lateExamples = [
  ["07:20", 0, "Sáng"],
  ["07:45", 15, "Sáng"],
  ["12:50", 0, "Chiều"],
  ["13:12", 12, "Chiều"],
  ["17:58", 0, "Tối"],
];
lateExamples.forEach(([actualIn, expectedLate, expectedShift]) => {
  const calculation = calculateTimekeeping({
    employee: threeShiftEmployee,
    clockValues: { in1: actualIn, out1: "", in2: "", out2: "" },
    fallbackTotal: "",
  });
  assert.equal(calculation.lateMinutes, expectedLate);
  assert.equal(calculation.determinedShift, expectedShift);
});

const earlyUsingOut2 = calculateTimekeeping({
  employee: threeShiftEmployee,
  employeeName: "Nhân viên thường",
  clockValues: {
    in1: "12:55",
    out1: "17:10",
    in2: "",
    out2: "16:50",
  },
  fallbackTotal: "",
});
assert.equal(earlyUsingOut2.determinedShift, "Chiều");
assert.equal(earlyUsingOut2.earlyMinutes, 10);
assert.equal(earlyUsingOut2.standardOutTime, "17:00");
assert.equal(earlyUsingOut2.actualOutTime, "16:50");
assert.equal(earlyUsingOut2.actualOutSource, "Ra 2");

assert.deepEqual(selectActualOut({ out1: "17:10", out2: "16:50" }), {
  minutes: 16 * 60 + 50,
  source: "Ra 2",
});

const missingRegisteredOut = calculateTimekeeping({
  employee: {
    morningIn: "13:00",
    morningOut: "",
    afternoonIn: "",
    afternoonOut: "",
    eveningIn: "",
    eveningOut: "",
  },
  employeeName: "Nhân viên thường",
  clockValues: {
    in1: "13:05",
    out1: "16:50",
    in2: "",
    out2: "",
  },
  fallbackTotal: "",
});
assert.equal(missingRegisteredOut.earlyMinutes, null);
assert.match(missingRegisteredOut.note, /Không xác định được giờ ra chuẩn/);

const normalPenaltyExamples = [
  [0, 0],
  [14, 0],
  [15, 70000],
  [16, 70000],
  [60, 70000],
  [61, 140000],
  [181, 560000],
];
normalPenaltyExamples.forEach(([lateMinutes, expectedPenalty]) => {
  assert.equal(calculateLatePenalty(lateMinutes, "Nguyễn Văn An"), expectedPenalty);
});
assert.equal(calculateLatePenalty(240, "VP-Nguyễn Văn An"), 70000);

const adjustedInToOut = adjustClockColumns(threeShiftEmployee, {
  in1: "11:32",
  out1: "",
  in2: "",
  out2: "",
});
assert.equal(adjustedInToOut.adjusted.in1, null);
assert.equal(adjustedInToOut.adjusted.out1, "11:32");
assert.deepEqual(adjustedInToOut.notes, ["Đã chuyển 11:32 từ Vào 1 sang Ra 1"]);

const adjustedOutToIn = adjustClockColumns(threeShiftEmployee, {
  in1: "",
  out1: "13:05",
  in2: "",
  out2: "",
});
assert.equal(adjustedOutToIn.adjusted.in1, "13:05");
assert.equal(adjustedOutToIn.adjusted.out1, null);
assert.deepEqual(adjustedOutToIn.notes, ["Đã chuyển 13:05 từ Ra 1 sang Vào 1"]);

const specialRule = evaluateShiftRules(
  createRuleContext({
    employeeCode: "00004",
    weekday: "Thứ Bảy",
    employee: threeShiftEmployee,
  }),
  DEFAULT_SHIFT_RULES,
);
assert.equal(specialRule.shift.name, "Chiều");
assert.equal(
  evaluateShiftRules(
    { employeeCode: "NV-CUSTOM", weekday: "T2" },
    [
      {
        id: "full-is-disabled",
        priority: 10,
        conditions: { weekday: "Thứ Hai" },
        assignedShift: "full",
      },
    ],
  ),
  null,
);

const employeeHeaders = [
  "Chi nhánh", "Mã N.Viên", "Tên N.Viên", "Giờ ĐK",
  "Vào sáng", "Ra sáng", "Vào chiều", "Ra chiều",
  "Vào Tối", "Ra Tối", "Ghi chú",
];
const employeeSheet = XLSX.utils.aoa_to_sheet([
  employeeHeaders,
  ["Q7", "NV001", "Nguyễn Văn An", "Sáng", 8 / 24, 16.5 / 24, "", "", "", "", "Ca sáng"],
]);
employeeSheet.E2.z = "hh:mm";
employeeSheet.F2.z = "hh:mm";
const employeeWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(employeeWorkbook, employeeSheet, "Gio lv");
const employeeFile = new File(
  [XLSX.write(employeeWorkbook, { type: "array", bookType: "xlsx" })],
  "RegisHours.xlsx",
);
const importedEmployees = await importEmployeesFromExcel(employeeFile);
assert.equal(importedEmployees.length, 1);
assert.equal(importedEmployees[0].employeeCode, "NV001");
assert.equal(importedEmployees[0].morningIn, "08:00");
assert.equal(importedEmployees[0].morningOut, "16:30");
assert.equal(importedEmployees[0].fullIn, undefined);
assert.equal(importedEmployees[0].fullOut, undefined);

const diaryImportSheet = XLSX.utils.aoa_to_sheet([
  ["Thứ", "Ngày", "Mã N.Viên", "Tên N.Viên", "Lý do", "Có / Không phép", "Biên bản", "Có hồ sơ"],
  ["T4", new Date(2026, 6, 17), 4, "Nguyễn Văn A", "Kẹt xe có báo trước", "Có phép", "Đã báo quản lý", "Có"],
]);
diaryImportSheet.B2.z = "dd/mm/yyyy";
diaryImportSheet.C2.z = "00000";
const diaryImportWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(diaryImportWorkbook, diaryImportSheet, "Xin đi trễ về sớm");
const diaryFile = new File(
  [XLSX.write(diaryImportWorkbook, { type: "array", bookType: "xlsx" })],
  "Dairy.xlsx",
);
const importedDiary = await importDiaryFromExcel(diaryFile);
assert.equal(importedDiary.length, 1);
assert.equal(importedDiary[0].date, "2026-07-17");
assert.equal(importedDiary[0].employeeCode, "00004");
assert.equal(importedDiary[0].permission, "Có phép");

const workbookWithoutSheet = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbookWithoutSheet, XLSX.utils.aoa_to_sheet([["Khác"]]), "Sheet1");
const fileWithoutSheet = new File(
  [XLSX.write(workbookWithoutSheet, { type: "array", bookType: "xlsx" })],
  "thieu_sheet.xlsx",
);
await assert.rejects(() => processExcelFile(fileWithoutSheet), /Không tìm thấy sheet “Chi tiết”/);

const optionalLegacyHeaders = new Set(["TC1", "TC2", "TC3", "Tổng cộng"]);
const headersWithoutOptionalLegacyColumns = attendanceHeaders.filter(
  (header) => !optionalLegacyHeaders.has(header),
);
const completeAttendanceRow = [
  1, "Q7N", "Q7-Nam", new Date(2026, 6, 20), "T2",
  time(9, 0), time(18, 0), "", "", time(9, 0),
  1, 0, 0, 0, 1, "",
];
const rowWithoutOptionalLegacyColumns = headersWithoutOptionalLegacyColumns.map(
  (header) => completeAttendanceRow[attendanceHeaders.indexOf(header)],
);
const fileWithoutOptionalLegacyColumns = makeAttendanceFileWithHeaders(
  headersWithoutOptionalLegacyColumns,
  [rowWithoutOptionalLegacyColumns],
  "khong_co_tc_va_tong_cong.xlsx",
);
const resultWithoutOptionalLegacyColumns = await processExcelFile(
  fileWithoutOptionalLegacyColumns,
  employees,
);
assert.equal(resultWithoutOptionalLegacyColumns.totalRows, 1);
assert.equal(resultWithoutOptionalLegacyColumns.matchedRows, 1);

const fileWithOptionalLegacyColumns = makeAttendanceFile(
  [completeAttendanceRow],
  "co_tc_va_tong_cong.xlsx",
);
const resultWithOptionalLegacyColumns = await processExcelFile(
  fileWithOptionalLegacyColumns,
  employees,
);
assert.equal(resultWithOptionalLegacyColumns.totalRows, 1);
assert.equal(resultWithOptionalLegacyColumns.matchedRows, 1);

const workbookWithoutColumn = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  workbookWithoutColumn,
  XLSX.utils.aoa_to_sheet([attendanceHeaders.filter((header) => header !== "Ngày")]),
  "Chi tiết",
);
const fileWithoutColumn = new File(
  [XLSX.write(workbookWithoutColumn, { type: "array", bookType: "xlsx" })],
  "thieu_cot.xlsx",
);
await assert.rejects(
  () => processExcelFile(fileWithoutColumn),
  (error) => {
    assert.match(error.message, /File thiếu cột bắt buộc: Ngày\./);
    assert.doesNotMatch(error.message, /TC1|TC2|TC3|Tổng cộng/);
    return true;
  },
);

console.log("Excel, employee branch detection, and Diary verification passed");
