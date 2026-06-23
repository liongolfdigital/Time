/**
 * Điều phối nhập/xuất file chấm công và tạo metadata xem trước/audit cho giao diện.
 * Với mỗi dòng: match Employees -> normalize clock -> chọn ca -> tính phát sinh -> đối chiếu Diary
 * -> ghép ghi chú/tổng hợp -> ghi cell -> áp màu; sheet nguồn và các sheet phụ không bị mutate.
 */
import {
  calculateTimekeeping,
  createEmployeeLookup,
  findRegisteredEmployee,
} from "../services/attendance/attendanceService.js";
import {
  adjustClockColumns,
  getVPSaturdayShiftAssignment,
  isVpEmployee,
} from "../services/attendance/shiftService.js";
import { getEmployeeGroup, normalizeEmployeeCode, normalizeLookup, normalizeText } from "../employees/employeeModel.js";
import { detectBranchFromText, normalizeBranch } from "../branches/branchModel.js";
import {
  createRuleContext,
  DEFAULT_SHIFT_RULES,
  evaluateShiftRules,
} from "../rules/shiftRuleEngine.js";
import {
  buildAttendanceHighlights,
  getAttendanceEmployeeKey,
  getWeekKey,
  HIGHLIGHT_TYPES,
  isOffAttendanceDay,
} from "./attendanceHighlights.js";
import { normalizeDiaryDate } from "../diary/diaryModel.js";
import {
  createDiaryLookup,
  findDiaryForViolation,
  getDiaryReason,
  isDiaryPermitted,
} from "../services/attendance/diaryReasonService.js";
import { ABNORMAL_ATTENDANCE_NOTE, getAbnormalAttendance, } from "../services/attendance/abnormalAttendanceService.js";
import { KEPT_COLUMNS, MONTHLY_LATE_WARNING_TEXT,
  OUTPUT_COLUMNS, OUTPUT_FILE_NAME, PREVIEW_ROW_LIMIT, SOURCE_SHEET_NAME, SUMMARY_COLUMNS, } from "../constants/excelConstants.js";
import { cloneCell, downloadExcelBlob, minutesToExcelTime, normalizeDateCellsForStyledWrite, writeCalculatedCell } from "./excelWriter.js";
import { getSourceCell as getMappedSourceCell, normalizeHeader } from "./excelColumnMapper.js";
import { readAttendanceWorkbook } from "./excelReader.js";
import { applyAttendanceCellStyle, applyRowHighlights, ATTENDANCE_COLOR_MAP } from "./excelHighlightService.js";
import { buildEmployeeSummaries, writeEmployeeSummaryBox } from "./excelSummaryService.js";

export {
  ATTENDANCE_COLOR_MAP,
  KEPT_COLUMNS,
  MONTHLY_LATE_WARNING_TEXT,
  OUTPUT_COLUMNS,
  OUTPUT_FILE_NAME,
  SOURCE_SHEET_NAME,
  applyAttendanceCellStyle,
};

export const MERGED_SOURCE_COLUMN = "Nguồn file";
export const MERGED_BRANCH_COLUMN = "Chi nhánh";
export const MERGED_SHEET_NAME = "Tổng hợp";
export const MISSING_EMPLOYEE_SHEET_NAME = "Không tìm thấy";
const MISSING_EMPLOYEE_NOTE = "Không có dữ liệu trong các file đã tải lên";

let XLSX;
let xlsxModulePromise;
let XLSX_STYLE;
let xlsxStyleModulePromise;

// Lazy-load thư viện đọc và ghi style Excel một lần cho toàn bộ phiên xử lý.
async function loadXlsx() {
  xlsxModulePromise ??= import("xlsx");
  xlsxStyleModulePromise ??= import("xlsx-js-style");
  const [xlsxModule, xlsxStyleModule] = await Promise.all([
    xlsxModulePromise,
    xlsxStyleModulePromise,
  ]);
  XLSX = xlsxModule;
  XLSX_STYLE = xlsxStyleModule.default ?? xlsxStyleModule;
}

// Adapter lấy cell nguồn bằng mapper header của file hiện tại.
function getSourceCell(sourceSheet, columnMap, row, header) {
  return getMappedSourceCell(XLSX, sourceSheet, columnMap, row, header);
}

// Làm sạch tên chi nhánh để tạo file name hợp lệ trên Windows.
function sanitizeFileName(value) {
  return String(value ?? "")
    .normalize("NFC")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "_");
}

// Tạo tên file kết quả gồm chi nhánh và timestamp phút.
function makeOutputFileName(branchName) {
  const branch = sanitizeFileName(branchName) || "Chi_nhanh";
  const now = new Date();

  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
  ].join("");

  return `${branch}_bang_cham_cong_${timestamp}.xlsx`;
}

// Lấy text hiển thị của cell theo formatter SheetJS.
function getCellDisplayValue(cell) {
  return cell ? XLSX.utils.format_cell(cell) : "";
}

function makeEmployeeSelectionSets(filters = {}) {
  const selectedCodes = new Set();
  const selectedKeys = new Set();

  (filters.employeeIds ?? []).forEach((value) => {
    const code = normalizeEmployeeCode(value);
    const key = normalizeLookup(value);
    if (code) selectedCodes.add(code);
    if (key) selectedKeys.add(key);
  });

  return {
    selectedCodes,
    selectedKeys,
    hasSelection: Boolean(selectedCodes.size || selectedKeys.size),
  };
}

function matchesSelectedEmployee(
  { registeredEmployee, employeeCode, employeeName },
  { selectedCodes, selectedKeys },
) {
  const rowCodes = [
    registeredEmployee?.employeeCode,
    employeeCode,
  ].map(normalizeEmployeeCode).filter(Boolean);
  if (rowCodes.some((code) => selectedCodes.has(code))) return true;

  const rowKeys = [
    registeredEmployee?.id,
    registeredEmployee?.employeeCode,
    registeredEmployee?.employeeName,
    employeeCode,
    employeeName,
  ].map(normalizeLookup).filter(Boolean);
  return rowKeys.some((key) => selectedKeys.has(key));
}

function resolveEmployeeBranch({ registeredEmployee, employeeName, sourceFileName = "" }) {
  return normalizeBranch(registeredEmployee?.branch) ||
    detectBranchFromText(registeredEmployee?.employeeName) ||
    detectBranchFromText(employeeName) ||
    detectBranchFromText(sourceFileName);
}

/** Kiểm tra một dòng chấm công có khớp chi nhánh, nhân viên và khoảng ngày đã chọn hay không. */
export function matchesProcessFilters(
  { registeredEmployee, employeeCode, employeeName, dateValue, sourceFileName = "" },
  filters = {},
) {
  const branches = new Set((filters.branches ?? []).map(normalizeBranch).filter(Boolean));
  const employeeSelection = makeEmployeeSelectionSets(filters);
  const employeeBranch = resolveEmployeeBranch({ registeredEmployee, employeeName, sourceFileName });
  const dayKey = normalizeDiaryDate(dateValue);

  if (filters.dateFrom && (!dayKey || dayKey < filters.dateFrom)) return false;
  if (filters.dateTo && (!dayKey || dayKey > filters.dateTo)) return false;
  if (employeeSelection.hasSelection) {
    return matchesSelectedEmployee(
      { registeredEmployee, employeeCode, employeeName },
      employeeSelection,
    );
  }
  if (branches.size && !branches.has(employeeBranch)) return false;
  return true;
}

// Sao chép phần tiêu đề/banner nằm trước dòng header sang worksheet kết quả.
function copyRowsBeforeHeader(sourceSheet, targetSheet, headerRow, bounds) {
  for (let row = bounds.s.r; row < headerRow; row += 1) {
    for (let column = bounds.s.c; column <= bounds.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      if (sourceSheet[address]) targetSheet[address] = cloneCell(sourceSheet[address]);
    }
  }
}

// Nối ghi chú mới bằng `; ` mà không ghi đè nội dung đã có.
function appendNote(currentNote, appendedNote) {
  if (!appendedNote) return currentNote || "";
  const normalizedAppendedNote = String(appendedNote).trim();
  const existingNotes = String(currentNote ?? "")
    .split(";")
    .map((note) => note.trim())
    .filter(Boolean);
  return existingNotes.includes(normalizedAppendedNote)
    ? existingNotes.join("; ")
    : [...existingNotes, normalizedAppendedNote].join("; ");
}

// Cấu hình bốn loại phát sinh, field phút và field được tính vào tổng tương ứng.
const VIOLATION_TYPES = [
  {
    key: "earlyIn",
    type: "Đi sớm",
    minutesField: "earlyInMinutes",
    validField: "validEarlyInMinutes",
  },
  {
    key: "late",
    type: "Đi trễ",
    minutesField: "lateMinutes",
  },
  {
    key: "early",
    type: "Về sớm",
    minutesField: "earlyMinutes",
    validField: "validEarlyMinutes",
  },
  {
    key: "overtime",
    type: "Tăng ca",
    minutesField: "overtimeMinutes",
    validField: "validOvertimeMinutes",
  },
];

// Tạm tắt rule tự động tính tổng khi Tăng ca > 60 phút.
// Hiện chỉ tự tính Tăng ca nếu có Diary Có phép hoặc nhân viên làm full ngày sáng - chiều.
export const ENABLE_AUTO_COUNT_OVERTIME_OVER_60 = false;

// Tạm tắt rule tự động tính tổng khi Đi sớm > 60 phút.
// Hiện chỉ tính Đi sớm vào tổng nếu có Diary Có phép.
export const ENABLE_AUTO_COUNT_EARLY_OVER_60 = false;

// Giữ rule cũ sau flag để có thể bật lại mà không phải phục hồi code đã xóa.
function shouldAutoCountOver60(violationKey, minutes) {
  if (minutes <= 60) return false;
  if (violationKey === "overtime") return ENABLE_AUTO_COUNT_OVERTIME_OVER_60;
  if (violationKey === "earlyIn") return ENABLE_AUTO_COUNT_EARLY_OVER_60;
  return false;
}

// Diary dùng loại OFF canonical nhưng ghi chú đầu ra hiển thị rõ chuỗi OFF > 2 ngày.
const LONG_OFF_VIOLATION_TYPE = "OFF > 2 ngày";
// Tạo khóa nhân viên-tháng dùng cộng phút trễ và cảnh báo riêng cho VP.
function getEmployeeMonthKey(dateValue, employeeCode, employeeName) {
  let year;
  let month;

  if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
    year = dateValue.getUTCFullYear();
    month = dateValue.getUTCMonth() + 1;
  } else if (typeof dateValue === "number") {
    const parsedDate = XLSX.SSF.parse_date_code(dateValue);
    year = parsedDate?.y;
    month = parsedDate?.m;
  } else {
    const dateText = String(dateValue ?? "").trim();
    const dateMatch = dateText.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (dateMatch) {
      year = Number(dateMatch[3]);
      month = Number(dateMatch[2]);
    }
  }

  if (!year || !month) return null;
  const identity = normalizeLookup(employeeCode) || normalizeLookup(employeeName);
  if (!identity) return null;
  return `${identity}|${year}-${String(month).padStart(2, "0")}`;
}

// Quy đổi YYYY-MM-DD thành số ngày UTC để dò chuỗi OFF liên tiếp.
function getDayNumber(dayKey) {
  const [year, month, day] = String(dayKey ?? "").split("-").map(Number);
  if (!year || !month || !day) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

// Gom các ngày OFF liên tiếp của từng nhân viên và đánh dấu chuỗi từ hai ngày.
function findLongOffSequences(rowResults) {
  const rowsByEmployee = new Map();

  rowResults.forEach((rowResult) => {
    if (!rowResult.isOff || !rowResult.employeeKey || !rowResult.dayKey) return;
    const dayNumber = getDayNumber(rowResult.dayKey);
    if (dayNumber === null) return;
    rowsByEmployee.set(rowResult.employeeKey, [
      ...(rowsByEmployee.get(rowResult.employeeKey) ?? []),
      { ...rowResult, dayNumber },
    ]);
  });

  const longOffRows = new Map();
  // Ghi metadata cho mọi dòng thuộc một chuỗi OFF đủ dài.
  const markSequence = (sequence) => {
    if (sequence.length < 2) return;
    sequence.forEach((item) => {
      longOffRows.set(item.row, { sequenceLength: sequence.length });
    });
  };

  rowsByEmployee.forEach((items) => {
    const sortedItems = [...items].sort((first, second) =>
      first.dayNumber === second.dayNumber
        ? first.row - second.row
        : first.dayNumber - second.dayNumber,
    );
    let sequence = [];
    let previousDay = null;

    sortedItems.forEach((item) => {
      if (sequence.length === 0 || item.dayNumber === previousDay + 1) {
        sequence.push(item);
      } else if (item.dayNumber !== previousDay) {
        markSequence(sequence);
        sequence = [item];
      } else {
        sequence.push(item);
      }
      previousDay = item.dayNumber;
    });
    markSequence(sequence);
  });

  return longOffRows;
}

// Dựng trạng thái và câu ghi chú OFF > 2 ngày từ Diary Có/Không phép.
function getLongOffDiaryNote(diaryMatch) {
  if (!diaryMatch) {
    return {
      status: "missingDiary",
      note: `${LONG_OFF_VIOLATION_TYPE} chưa có Diary`,
    };
  }

  const permitted = isDiaryPermitted(diaryMatch.entry);
  return {
    status: permitted ? "permitted" : "notPermitted",
    note: `${LONG_OFF_VIOLATION_TYPE} ${permitted ? "có phép" : "không phép"}: ${getDiaryReason(diaryMatch.entry)}`,
  };
}

// Đối chiếu Diary cho các chuỗi OFF, nối ghi chú và thêm log audit vào kết quả.
function applyLongOffWarnings(rowResults, diaryLookup, diaryMatchLogs) {
  const longOffRows = findLongOffSequences(rowResults);

  rowResults.forEach((rowResult) => {
    const longOffMeta = longOffRows.get(rowResult.row);
    if (!longOffMeta) return;

    const diaryMatch = findDiaryForViolation(diaryLookup, {
      date: rowResult.dateValue,
      employeeCode: rowResult.employeeCode,
      employeeName: rowResult.effectiveEmployeeName,
      violationType: LONG_OFF_VIOLATION_TYPE,
    });
    const warning = getLongOffDiaryNote(diaryMatch);

    rowResult.longOff = true;
    rowResult.longOffStatus = warning.status;
    rowResult.offSequenceLength = longOffMeta.sequenceLength;
    rowResult.calculation.note = appendNote(rowResult.calculation.note, warning.note);

    if (!diaryMatch) return;

    rowResult.diaryMatched = true;
    if (warning.status === "permitted") rowResult.diaryExempted = true;
    diaryMatchLogs.push({
      rowNumber: rowResult.row + 1,
      employeeCode: rowResult.employeeCode,
      employeeName: rowResult.employeeName,
      date: diaryMatch.entry.date,
      matchType: diaryMatch.matchType,
      violationType: LONG_OFF_VIOLATION_TYPE,
      reason: diaryMatch.entry.reason,
      permission: diaryMatch.entry.permission,
      creatorCode: diaryMatch.entry.creatorCode,
      creatorName: diaryMatch.entry.creatorName,
      attachmentCount: (diaryMatch.entry.attachedFiles ?? diaryMatch.entry.attachments)?.length ?? 0,
      hasAttachments: Boolean((diaryMatch.entry.attachedFiles ?? diaryMatch.entry.attachments)?.length),
      previousPenalty: rowResult.calculation.penalty,
      finalPenalty: rowResult.calculation.penalty,
      exempted: warning.status === "permitted",
    });
  });
}

// Ghi lại bốn cell clock sau normalize bằng cách clone đúng cell nguồn/style gốc.
function writeAdjustedClockCells(
  targetSheet,
  sourceSheet,
  columnMap,
  sourceRow,
  targetRow,
  outputStartColumn,
  adjustment,
) {
  const slotHeaders = {
    in1: "Vào 1",
    out1: "Ra 1",
    in2: "Vào 2",
    out2: "Ra 2",
  };

  Object.entries(slotHeaders).forEach(([slot, targetHeader]) => {
    const targetColumn = outputStartColumn + KEPT_COLUMNS.indexOf(targetHeader);
    const targetAddress = XLSX.utils.encode_cell({ r: targetRow, c: targetColumn });
    const sourceSlot = adjustment.sourceSlots[slot];
    delete targetSheet[targetAddress];

    if (!sourceSlot || adjustment.adjusted[slot] === null || adjustment.adjusted[slot] === "") {
      return;
    }

    const sourceHeader = slotHeaders[sourceSlot];
    const sourceCell = getSourceCell(sourceSheet, columnMap, sourceRow, sourceHeader);
    if (sourceCell) targetSheet[targetAddress] = cloneCell(sourceCell);
  });
}

/**
 * Xử lý toàn bộ dòng của sheet Chi tiết: normalize clock -> chọn ca -> tính chỉ số
 * -> đối chiếu Diary -> tổng hợp/highlight. Hàm mutate worksheet output mới, không sửa sheet nguồn.
 * Thứ tự nghiệp vụ cần đọc là normalize, chọn ca, tính toán, Diary, metadata màu, ghi chú và tổng.
 * Style Excel được áp cuối cùng vì cell kết quả phải tồn tại trước khi có thể gắn style.
 */
function createProcessedSheet(
  sourceSheet,
  headerRow,
  bounds,
  columnMap,
  employees,
  shiftRules,
  diaryEntries,
  processFilters,
  sourceFileName = "",
) {
  const targetSheet = {};
  const outputStartColumn = bounds.s.c;
  const employeeLookup = createEmployeeLookup(employees);
  const diaryLookup = createDiaryLookup(diaryEntries);
  let matchedRows = 0;
  let unmatchedRows = 0;
  const determinedShifts = [];
  const adjustmentLogs = [];
  const rowResults = [];
  const vpMonthlyLateMinutes = new Map();
  const appliedShiftRules = [];
  const diaryMatchLogs = [];
  let filteredOutRows = 0;

  copyRowsBeforeHeader(sourceSheet, targetSheet, headerRow, bounds);

  OUTPUT_COLUMNS.forEach((header, outputIndex) => {
    const targetAddress = XLSX.utils.encode_cell({
      r: headerRow,
      c: outputStartColumn + outputIndex,
    });

    if (KEPT_COLUMNS.includes(header)) {
      const sourceCell = header === "Giờ ĐK" ? null : getSourceCell(sourceSheet, columnMap, headerRow, header);
      targetSheet[targetAddress] = cloneCell(sourceCell) ?? { t: "s", v: header };
      targetSheet[targetAddress].v = header;
      targetSheet[targetAddress].w = header;
      return;
    }

    const styleSource = getSourceCell(sourceSheet, columnMap, headerRow, "Tổng giờ");
    targetSheet[targetAddress] = {
      t: "s",
      v: header,
      w: header,
      ...(styleSource?.s ? { s: structuredClone(styleSource.s) } : {}),
    };
  });

  for (let sourceRow = headerRow + 1; sourceRow <= bounds.e.r; sourceRow += 1) {
    const codeCell = getSourceCell(sourceSheet, columnMap, sourceRow, "Mã N.Viên");
    const employeeCode = getCellDisplayValue(codeCell);
    const nameCell = getSourceCell(sourceSheet, columnMap, sourceRow, "Tên N.Viên");
    const employeeName = nameCell?.v ?? "";

    if (!normalizeText(employeeCode) && !normalizeText(employeeName)) {
      continue;
    }

    const registeredEmployee = findRegisteredEmployee(
      employeeLookup,
      employeeCode,
      employeeName,
    );
    const dateValue = getSourceCell(sourceSheet, columnMap, sourceRow, "Ngày")?.v;
    if (
      processFilters?.onlyMatchingRows &&
      !matchesProcessFilters(
        { registeredEmployee, employeeCode, employeeName, dateValue, sourceFileName },
        processFilters,
      )
    ) {
      filteredOutRows += 1;
      continue;
    }
    const row = headerRow + rowResults.length + 1;

    KEPT_COLUMNS.forEach((header, outputIndex) => {
      const targetAddress = XLSX.utils.encode_cell({
        r: row,
        c: outputStartColumn + outputIndex,
      });

      if (header === "Giờ ĐK") return;

      const sourceCell = getSourceCell(sourceSheet, columnMap, sourceRow, header);
      if (sourceCell) targetSheet[targetAddress] = cloneCell(sourceCell);
    });

    const weekdayCell = getSourceCell(sourceSheet, columnMap, sourceRow, "Thứ");

    const registeredShiftColumn =
      outputStartColumn + KEPT_COLUMNS.indexOf("Giờ ĐK");

    const registeredShiftAddress = XLSX.utils.encode_cell({
      r: row,
      c: registeredShiftColumn,
    });

    writeCalculatedCell(
      targetSheet,
      registeredShiftAddress,
      registeredEmployee?.registeredShift ?? "",
    );
    const originalClockValues = {
      in1: getSourceCell(sourceSheet, columnMap, sourceRow, "Vào 1")?.v,
      out1: getSourceCell(sourceSheet, columnMap, sourceRow, "Ra 1")?.v,
      in2: getSourceCell(sourceSheet, columnMap, sourceRow, "Vào 2")?.v,
      out2: getSourceCell(sourceSheet, columnMap, sourceRow, "Ra 2")?.v,
    };
    const abnormalAttendance = getAbnormalAttendance(originalClockValues);
    const effectiveEmployeeName = normalizeText(employeeName || registeredEmployee?.employeeName);
    const employeeGroup = getEmployeeGroup(effectiveEmployeeName);
    const branchCode = resolveEmployeeBranch({ registeredEmployee, employeeName, sourceFileName });
    const ruleShiftAssignment = evaluateShiftRules(
      createRuleContext({
        employeeCode,
        weekday: getCellDisplayValue(weekdayCell),
        employee: registeredEmployee,
      }),
      shiftRules,
    );
    const vpSaturdayShiftAssignment = getVPSaturdayShiftAssignment({
      employeeName,
      attendanceDate: dateValue,
      clockValues: originalClockValues,
    });
    const shiftAssignment = vpSaturdayShiftAssignment ?? ruleShiftAssignment;
    // Normalize bốn cột clock trước khi calculateTimekeeping chọn ca và tính mọi chỉ số.
    const clockAdjustment = registeredEmployee
      ? adjustClockColumns(
          registeredEmployee,
          originalClockValues,
          shiftAssignment,
        )
      : {
          original: originalClockValues,
          adjusted: originalClockValues,
          sourceSlots: { in1: "in1", out1: "out1", in2: "in2", out2: "out2" },
          notes: [],
          changed: false,
          hasLog: false,
        };
    writeAdjustedClockCells(
      targetSheet,
      sourceSheet,
      columnMap,
      sourceRow,
      row,
      outputStartColumn,
      clockAdjustment,
    );
    const sourceNote = getCellDisplayValue(
      getSourceCell(sourceSheet, columnMap, sourceRow, "Ghi chú"),
    );
    const calculation = calculateTimekeeping({
      employee: registeredEmployee,
      employeeName,
      clockValues: clockAdjustment.adjusted,
      fallbackTotal: getSourceCell(sourceSheet, columnMap, sourceRow, "Tổng giờ")?.v,
      additionalNotes: [...clockAdjustment.notes, sourceNote].filter(Boolean),
      shiftAssignment,
      attendanceDate: dateValue,
    });
    if (abnormalAttendance.abnormal) {
      calculation.note = appendNote(calculation.note, ABNORMAL_ATTENDANCE_NOTE);
    }
    calculation.violationStatuses = {};
    // Đi trễ phát sinh luôn vào Tổng đi trễ; Diary Có phép chỉ có thể xóa tiền Phạt.
    calculation.totalLateMinutes = Number(calculation.lateMinutes) > 0
      ? Number(calculation.lateMinutes)
      : 0;
    calculation.validEarlyInMinutes = 0;
    calculation.validEarlyMinutes = 0;
    calculation.validOvertimeMinutes = 0;
    let diaryMatched = false;
    let diaryExempted = false;

    // Diary cung cấp lý do và trạng thái Có/Không phép cho đúng loại phát sinh của ngày này.
    VIOLATION_TYPES.forEach((config) => {
      const minutes = Number(calculation[config.minutesField]) || 0;
      if (minutes <= 0) return;
      const isOfficeOvertime = employeeGroup === "VP" && config.key === "overtime";
      const isAutoTotalViolation = shouldAutoCountOver60(config.key, minutes);
      const isFullDayOvertime = config.key === "overtime" &&
        Boolean(calculation.isFullDayByMorningToAfternoon);

      const diaryMatch = findDiaryForViolation(diaryLookup, {
        date: dateValue,
        employeeCode,
        employeeName: effectiveEmployeeName,
        violationType: config.type,
      });
      const previousPenalty = calculation.penalty;
      let status = "missingDiary";

      if (diaryMatch) {
        diaryMatched = true;
        const permitted = isDiaryPermitted(diaryMatch.entry);
        status = permitted ? "permitted" : "notPermitted";
        if (permitted && !isOfficeOvertime) diaryExempted = true;
        const diaryReason = getDiaryReason(diaryMatch.entry);
        const diaryNotePrefix = isOfficeOvertime
          ? "Tăng ca VP không tính tổng"
          : isFullDayOvertime && !permitted
            ? "Tăng ca làm full ngày sáng - chiều"
            : `${config.type} ${permitted ? "có phép" : "không phép"}`;
        calculation.note = appendNote(
          calculation.note,
          diaryReason ? `${diaryNotePrefix}: ${diaryReason}` : diaryNotePrefix,
        );
      } else {
        calculation.note = appendNote(
          calculation.note,
          isOfficeOvertime
            ? "Tăng ca VP không tính tổng"
            : isFullDayOvertime
            ? "Tăng ca làm full ngày sáng - chiều"
            : isAutoTotalViolation
              ? `${config.type} trên 60 phút - tự tính tổng`
              : `${config.type} chưa có Diary`,
        );
      }

      calculation.violationStatuses[config.key] =
        isFullDayOvertime && !diaryMatch
          ? "fullDay"
          : isAutoTotalViolation && !diaryMatch
            ? "autoTotal"
            : status;
      if (config.key === "late") {
        if (status === "permitted") {
          calculation.penalty = 0;
        }
      } else if (config.key === "earlyIn") {
        // Đi sớm chỉ hiển thị/audit và lấy lý do Diary, không cộng Tổng đi sớm.
        calculation.validEarlyInMinutes = 0;
      } else if (config.key === "early") {
        // Về sớm phát sinh luôn vào Tổng về sớm, không phụ thuộc trạng thái Diary.
        calculation.validEarlyMinutes = minutes;
      } else if (isOfficeOvertime) {
        // VP vẫn hiển thị/tô màu Tăng ca theo ngày, nhưng tuyệt đối không cộng vào tổng.
        calculation.validOvertimeMinutes = 0;
      } else if (isAutoTotalViolation || isFullDayOvertime) {
        // Nhân viên thường chỉ cộng tăng ca theo rule hiện hành: full ngày, Diary Có phép hoặc flag >60.
        calculation[config.validField] = minutes;
      } else {
        calculation[config.validField] = status === "permitted" ? minutes : 0;
      }

      if (diaryMatch) {
        diaryMatchLogs.push({
          rowNumber: row + 1,
          employeeCode,
          employeeName,
          date: diaryMatch.entry.date,
          matchType: diaryMatch.matchType,
          violationType: config.type,
          reason: diaryMatch.entry.reason,
          permission: diaryMatch.entry.permission,
          creatorCode: diaryMatch.entry.creatorCode,
          creatorName: diaryMatch.entry.creatorName,
          attachmentCount: (diaryMatch.entry.attachedFiles ?? diaryMatch.entry.attachments)?.length ?? 0,
          hasAttachments: Boolean((diaryMatch.entry.attachedFiles ?? diaryMatch.entry.attachments)?.length),
          previousPenalty,
          finalPenalty: calculation.penalty,
          exempted: status === "permitted" && !isOfficeOvertime,
        });
      }
    });

    const employeeKey = getAttendanceEmployeeKey(employeeCode, employeeName);
    const dayKey = normalizeDiaryDate(dateValue);
    const isOff = Boolean(employeeKey) && Boolean(dayKey) &&
      isOffAttendanceDay(
        calculation.note,
        clockAdjustment.adjusted,
        calculation.totalWorkedMinutes,
      );

    if (calculation.matched) matchedRows += 1;
    else unmatchedRows += 1;
    determinedShifts.push({
      rowNumber: row + 1,
      employeeCode,
      employeeName: nameCell?.v ?? "",
      shift: calculation.determinedShift,
      shiftKey: calculation.determinedShiftKey ?? null,
      source: calculation.shiftSource ?? null,
      ruleId: calculation.appliedRuleId ?? null,
      ruleName: calculation.appliedRuleName ?? null,
      branch: branchCode,
      employeeGroup,
      standardOutMinutes: calculation.standardOutMinutes ?? null,
      standardOutTime: calculation.standardOutTime ?? null,
      overtimeStandardOutMinutes: calculation.overtimeStandardOutMinutes ?? null,
      overtimeStandardOutTime: calculation.overtimeStandardOutTime ?? null,
      expectedEndByRegisteredHoursMinutes:
        calculation.expectedEndByRegisteredHoursMinutes ?? null,
      expectedEndByRegisteredHoursTime:
        calculation.expectedEndByRegisteredHoursTime ?? null,
      overtimeActualOutMinutes: calculation.overtimeActualOutMinutes ?? null,
      overtimeActualOutTime: calculation.overtimeActualOutTime ?? null,
      isFullDayByMorningToAfternoon: Boolean(calculation.isFullDayByMorningToAfternoon),
      actualOutMinutes: calculation.actualOutMinutes ?? null,
      actualOutTime: calculation.actualOutTime ?? null,
      actualOutSource: calculation.actualOutSource ?? null,
      totalWorkedMinutes: calculation.totalWorkedMinutes ?? null,
    });
    if (shiftAssignment) {
      appliedShiftRules.push({
        rowNumber: row + 1,
        employeeCode,
        employeeName,
        weekday: getCellDisplayValue(weekdayCell),
        shift: shiftAssignment.shift.name,
        ruleId: shiftAssignment.ruleId,
        ruleName: shiftAssignment.ruleName,
      });
    }
    if (clockAdjustment.hasLog) {
      adjustmentLogs.push({
        rowNumber: row + 1,
        employeeCode,
        employeeName,
        originalClockValues: clockAdjustment.original,
        adjustedClockValues: clockAdjustment.adjusted,
        notes: clockAdjustment.notes,
        changed: clockAdjustment.changed,
      });
    }

    const monthKey = isVpEmployee(employeeName)
      ? getEmployeeMonthKey(dateValue, employeeCode, employeeName)
      : null;
    if (monthKey && calculation.totalLateMinutes !== null) {
      const currentSummary = vpMonthlyLateMinutes.get(monthKey) ?? {
        employeeCode,
        employeeName,
        month: monthKey.slice(monthKey.lastIndexOf("|") + 1),
        totalLateMinutes: 0,
      };
      currentSummary.totalLateMinutes += calculation.totalLateMinutes;
      vpMonthlyLateMinutes.set(monthKey, currentSummary);
    }
    rowResults.push({
      row,
      sourceRow,
      calculation,
      monthKey,
      isOff,
      employeeKey,
      employeeCode,
      employeeName,
      branch: branchCode,
      effectiveEmployeeName,
      dateValue,
      dayKey,
      weekKey: getWeekKey(dateValue),
      clockValues: originalClockValues,
      multiplePunches: abnormalAttendance.abnormal
        ? {
            slots: abnormalAttendance.slots,
          }
        : null,
      diaryMatched,
      diaryExempted,
    });
  }

  // OFF liên tiếp từ hai ngày được đối chiếu Diary riêng và tô tại cột Ghi chú.
  applyLongOffWarnings(rowResults, diaryLookup, diaryMatchLogs);
  const highlights = buildAttendanceHighlights(rowResults);
  const employeeSummaries = buildEmployeeSummaries(rowResults);

  // Ghi số phút và ghi chú hoàn chỉnh trước; màu chỉ được áp sau khi clock đã normalize và cell đã tạo.
  rowResults.forEach(({ row, calculation }) => {
    const calculatedValues = [
      [calculation.earlyInMinutes, "0"],
      [calculation.lateMinutes, "0"],
      [calculation.penalty, "#,##0"],
      [calculation.earlyMinutes, "0"],
      [calculation.overtimeMinutes, "0"],
      [calculation.note],
      [minutesToExcelTime(calculation.totalWorkedMinutes), "[hh]:mm"],
    ];
    calculatedValues.forEach(([value, numberFormat], index) => {
      const address = XLSX.utils.encode_cell({
        r: row,
        c: outputStartColumn + KEPT_COLUMNS.length + index,
      });
      writeCalculatedCell(targetSheet, address, value, numberFormat);
    });
  });

  // Tổng hợp theo nhân viên dùng các field valid* đã quyết định bởi rule/Diary ở trên.
  const outputDataEndRow = headerRow + rowResults.length;
  let outputEndRow = outputDataEndRow;
  employeeSummaries.forEach((summary) => {
    outputEndRow = Math.max(
      outputEndRow,
      writeEmployeeSummaryBox(XLSX, targetSheet, outputStartColumn, summary),
    );
  });

  const outputEndColumn = outputStartColumn + OUTPUT_COLUMNS.length - 1;
  applyRowHighlights(XLSX, targetSheet, highlights, outputStartColumn);
  targetSheet["!ref"] = XLSX.utils.encode_range({
    s: { r: bounds.s.r, c: outputStartColumn },
    e: { r: outputEndRow, c: outputEndColumn },
  });
  if (sourceSheet["!rows"]) {
    targetSheet["!rows"] = sourceSheet["!rows"].slice(0, headerRow + 1).map((row) =>
      row ? structuredClone(row) : row,
    );
    rowResults.forEach(({ row, sourceRow }) => {
      const sourceRowStyle = sourceSheet["!rows"][sourceRow];
      if (sourceRowStyle) targetSheet["!rows"][row] = structuredClone(sourceRowStyle);
    });
  }

  const sourceColumns = sourceSheet["!cols"] ?? [];
  targetSheet["!cols"] = KEPT_COLUMNS.map((header) => {
    const sourceColumn = columnMap.get(normalizeHeader(header));
    return sourceColumns[sourceColumn] ? structuredClone(sourceColumns[sourceColumn]) : undefined;
  });
  targetSheet["!cols"].push(
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 34 }, { wch: 14 },
    { wch: 18 }, { wch: 12 },
  );
  targetSheet["!autofilter"] = {
    ref: XLSX.utils.encode_range({
      s: { r: headerRow, c: outputStartColumn },
      e: { r: outputDataEndRow, c: outputEndColumn },
    }),
  };

  return {
    processedSheet: targetSheet,
    matchedRows,
    unmatchedRows,
    determinedShifts,
    adjustmentLogs,
    adjustedRows: adjustmentLogs.filter(({ changed }) => changed).length,
    vpMonthlyLateSummaries: Array.from(vpMonthlyLateMinutes.values()),
    appliedShiftRules,
    diaryMatchLogs,
    diaryMatchedRows: diaryMatchLogs.length,
    diaryExemptedRows: diaryMatchLogs.filter(({ exempted }) => exempted).length,
    highlights,
    processedRowCount: rowResults.length,
    filteredOutRows,
    employeeSummaries,
    processedEmployees: rowResults.map(({ employeeCode }) => normalizeEmployeeCode(employeeCode) || employeeCode),
    processedRows: rowResults.map(({ employeeCode, employeeName, branch }) => ({
      employeeCode,
      normalizedEmployeeCode: normalizeEmployeeCode(employeeCode),
      employeeName,
      branch,
    })),
    diaryRows: rowResults.map(({ row, diaryMatched, diaryExempted }) => ({
      row,
      diaryMatched,
      diaryExempted,
    })),
  };
}

// Tạo tối đa PREVIEW_ROW_LIMIT dòng text và class highlight cho bảng xem trước React.
function makePreview(worksheet, headerRow, bounds, highlights, diaryRows, dataRowCount) {
  const rows = [];
  const previewHighlights = [];
  const previewDiaryMatches = [];
  const lastRow = Math.min(
    bounds.e.r,
    headerRow + PREVIEW_ROW_LIMIT,
    headerRow + dataRowCount,
  );
  const highlightByRow = new Map(highlights.map((highlight) => [highlight.row, highlight]));
  const diaryByRow = new Map(diaryRows.map((item) => [item.row, item]));
  // Ghép class màu loại vi phạm với class border trạng thái Diary.
  const makeViolationPreviewClass = (type, status) =>
    status ? `${type} preview-status-${status}` : type;

  for (let row = headerRow + 1; row <= lastRow; row += 1) {
    const highlight = highlightByRow.get(row);

    const previewRow = OUTPUT_COLUMNS.map((_, columnIndex) => {
      const address = XLSX.utils.encode_cell({ r: row, c: bounds.s.c + columnIndex });
      const cell = worksheet[address];

      if (!cell) return "";

      if (OUTPUT_COLUMNS[columnIndex] === "Phạt" && typeof cell.v === "number") {
        return cell.v.toLocaleString("vi-VN");
      }

      return XLSX.utils.format_cell(cell);
    });

    if (previewRow.some(Boolean)) {
      rows.push(previewRow);

      previewHighlights.push(
        OUTPUT_COLUMNS.map((header) => {
          if (highlight?.missingClock) return HIGHLIGHT_TYPES.missingClock;
          if (
            ["Vào 1", "Ra 1", "Vào 2", "Ra 2"].includes(header) &&
            highlight?.multiplePunches?.slots?.includes(
              header === "Vào 1"
                ? "in1"
                : header === "Ra 1"
                  ? "out1"
                  : header === "Vào 2"
                    ? "in2"
                    : "out2",
            )
          ) {
            return HIGHLIGHT_TYPES.multiplePunches;
          }
          if (header === "Ghi chú" && highlight?.longOff) {
            return makeViolationPreviewClass(
              HIGHLIGHT_TYPES.off,
              highlight.longOffStatus,
            );
          }
          if (header === "Đi sớm" && highlight?.earlyIn) {
            return makeViolationPreviewClass(
              HIGHLIGHT_TYPES.earlyIn,
              highlight.violationStatuses?.earlyIn,
            );
          }
          if (header === "Đi trễ" && highlight?.late) {
            return makeViolationPreviewClass(
              HIGHLIGHT_TYPES.late,
              highlight.violationStatuses?.late,
            );
          }
          if (header === "Về sớm" && highlight?.early) {
            return makeViolationPreviewClass(
              HIGHLIGHT_TYPES.early,
              highlight.violationStatuses?.early,
            );
          }
          if (header === "Tăng ca" && highlight?.overtime) {
            return makeViolationPreviewClass(
              HIGHLIGHT_TYPES.overtime,
              highlight.violationStatuses?.overtime,
            );
          }
          return null;
        }),
      );
      previewDiaryMatches.push(diaryByRow.get(row)?.diaryMatched ?? false);
    }
  }

  return { rows, highlights: previewHighlights, diaryMatches: previewDiaryMatches };
}

/**
 * Entry point xử lý file chấm công: đọc/validate workbook, tạo sheet kết quả có style,
 * serialize Blob và trả metadata preview/audit cho AttendancePage.
 */
export async function processExcelFile(
  file,
  employees = [],
  {
    shiftRules = DEFAULT_SHIFT_RULES,
    diaryEntries = [],
    processFilters = {},
    includeProcessedSheet = false,
  } = {},
) {
  await loadXlsx();
  const {
    workbook: sourceWorkbook,
    sourceSheet,
    bounds,
    headerRow,
    columnMap,
  } = await readAttendanceWorkbook(file, XLSX);
  const {
    processedSheet,
    matchedRows,
    unmatchedRows,
    determinedShifts,
    adjustmentLogs,
    adjustedRows,
    vpMonthlyLateSummaries,
    appliedShiftRules,
    diaryMatchLogs,
    diaryMatchedRows,
    diaryExemptedRows,
    highlights,
    processedRowCount,
    filteredOutRows,
    employeeSummaries,
    processedEmployees,
    processedRows,
    diaryRows,
  } = createProcessedSheet(
    sourceSheet,
    headerRow,
    bounds,
    columnMap,
    employees,
    shiftRules,
    diaryEntries,
    processFilters,
    file?.name || "",
  );
  const outputWorkbook = XLSX.utils.book_new();

  sourceWorkbook.SheetNames.forEach((sheetName) => {
    XLSX.utils.book_append_sheet(
      outputWorkbook,
      sheetName === SOURCE_SHEET_NAME ? processedSheet : sourceWorkbook.Sheets[sheetName],
      sheetName,
    );
  });

  normalizeDateCellsForStyledWrite(outputWorkbook);
  const outputBuffer = XLSX_STYLE.write(outputWorkbook, {
    bookType: "xlsx",
    type: "array",
    cellStyles: true,
    compression: true,
  });
  const previewBounds = XLSX.utils.decode_range(processedSheet["!ref"]);
  const preview = makePreview(
    processedSheet,
    headerRow,
    previewBounds,
    highlights,
    diaryRows,
    processedRowCount,
  );
  const processedEmployeeCodes = new Set(processedEmployees.map(normalizeEmployeeCode).filter(Boolean));

  const branchName =
    employees.find((employee) =>
      processedEmployeeCodes.has(normalizeEmployeeCode(employee.employeeCode))
    )?.branch ?? "";

  return {
    blob: new Blob([outputBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    headers: OUTPUT_COLUMNS,
    previewRows: preview.rows,
    previewHighlights: preview.highlights,
    previewDiaryMatches: preview.diaryMatches,
    totalRows: processedRowCount,
    filteredOutRows,
    previewLimit: PREVIEW_ROW_LIMIT,
    matchedRows,
    unmatchedRows,
    determinedShifts,
    adjustmentLogs,
    adjustedRows,
    vpMonthlyLateSummaries,
    appliedShiftRules,
    diaryMatchLogs,
    diaryExemptionLogs: diaryMatchLogs.filter(({ exempted }) => exempted),
    diaryMatchedRows,
    diaryExemptedRows,
    highlights,
    processedRows,
    sourceFileName: file?.name || "",
    fileName: makeOutputFileName(branchName),
    ...(includeProcessedSheet ? {
      processedSheet,
      processedHeaderRow: headerRow,
      processedStartColumn: previewBounds.s.c,
      employeeSummaries,
    } : {}),
  };
}

/** Tạo tên file tổng hợp theo loại bộ lọc và thời điểm xử lý. */
export function makeMergedOutputFileName(filters = {}, now = new Date()) {
  const scope = filters.employeeIds?.length
    ? "NhanVien"
    : filters.branches?.length
      ? "ChiNhanh"
      : "All";
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("") + "_" + [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
  ].join("");
  return `XuLy_TongHop_${scope}_${timestamp}.xlsx`;
}

function getEmployeeReportKey(employee) {
  return normalizeEmployeeCode(employee?.employeeCode) ||
    normalizeLookup(employee?.employeeName) ||
    normalizeLookup(employee?.id);
}

function buildSelectedEmployeeReports(selectedEmployees = [], processFilters = {}) {
  const reports = [];
  const seen = new Set();
  const pushReport = (employee) => {
    const key = getEmployeeReportKey(employee);
    if (!key || seen.has(key)) return;
    seen.add(key);
    reports.push({
      key,
      employeeCode: normalizeEmployeeCode(employee.employeeCode) || String(employee.employeeCode ?? employee.id ?? ""),
      employeeName: normalizeText(employee.employeeName),
      branch: normalizeBranch(employee.branch) || detectBranchFromText(employee.employeeName),
    });
  };

  selectedEmployees.forEach(pushReport);

  if (!reports.length) {
    (processFilters.employeeIds ?? []).forEach((employeeId) => {
      const code = normalizeEmployeeCode(employeeId);
      const key = code || normalizeLookup(employeeId);
      if (!key || seen.has(key)) return;
      seen.add(key);
      reports.push({
        key,
        employeeCode: code || String(employeeId ?? ""),
        employeeName: "",
        branch: "",
      });
    });
  }

  return reports;
}

function appendMissingEmployeesSheet(workbook, missingEmployees) {
  if (!missingEmployees.length) return;
  const rows = [
    ["Mã N.Viên", "Tên N.Viên", "Chi nhánh", "Ghi chú"],
    ...missingEmployees.map((employee) => [
      employee.employeeCode,
      employee.employeeName,
      employee.branch,
      MISSING_EMPLOYEE_NOTE,
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 14 }, { wch: 28 }, { wch: 12 }, { wch: 42 }];
  for (let column = 0; column < rows[0].length; column += 1) {
    const address = XLSX.utils.encode_cell({ r: 0, c: column });
    sheet[address].s = {
      fill: { patternType: "solid", fgColor: { rgb: "FCE4D6" } },
      font: { bold: true, color: { rgb: "7C2D12" } },
      alignment: { vertical: "center", wrapText: true },
    };
  }
  XLSX.utils.book_append_sheet(workbook, sheet, MISSING_EMPLOYEE_SHEET_NAME);
}

/** Thêm cột Chi nhánh/Nguồn file và gom các worksheet đã xử lý thành một workbook tổng hợp duy nhất. */
export async function mergeProcessedExcelResults(
  processedResults,
  { processFilters = {}, fileName = "", selectedEmployees = [] } = {},
) {
  await loadXlsx();
  const selectedEmployeeReports = buildSelectedEmployeeReports(selectedEmployees, processFilters);
  const availableResults = (processedResults ?? []).filter(({ processedSheet, totalRows }) =>
    processedSheet && totalRows > 0,
  );
  const totalRows = availableResults.reduce((total, result) => total + result.totalRows, 0);
  if (!totalRows) {
    throw new Error("Không có dữ liệu nào khớp bộ lọc đã chọn.");
  }

  const dataColumnCount = OUTPUT_COLUMNS.length - SUMMARY_COLUMNS.length;
  const dataHeaders = OUTPUT_COLUMNS.slice(0, dataColumnCount);
  const sourceHeaderToColumn = new Map(dataHeaders.map((header, index) => [header, index]));
  const branchColumnIndex = Math.max(0, dataHeaders.indexOf("Tên N.Viên")) + 1;
  const mergedDataHeaders = [
    ...dataHeaders.slice(0, branchColumnIndex),
    MERGED_BRANCH_COLUMN,
    ...dataHeaders.slice(branchColumnIndex),
  ];
  const sourceColumnIndex = mergedDataHeaders.length;
  const summaryStartColumn = sourceColumnIndex + 1;
  const mergedHeaders = [
    ...mergedDataHeaders,
    MERGED_SOURCE_COLUMN,
    ...SUMMARY_COLUMNS,
  ];
  const mergedSheet = {};
  const firstResult = availableResults[0];
  const firstSheet = firstResult.processedSheet;
  const firstHeaderRow = firstResult.processedHeaderRow;
  const firstStartColumn = firstResult.processedStartColumn;
  const fallbackStyleColumn = sourceHeaderToColumn.get("Tên N.Viên") ?? 0;

  mergedHeaders.forEach((header, column) => {
    let sourceColumn = sourceHeaderToColumn.get(header);
    if (header === MERGED_BRANCH_COLUMN || header === MERGED_SOURCE_COLUMN) {
      sourceColumn = fallbackStyleColumn;
    }
    if (SUMMARY_COLUMNS.includes(header)) {
      sourceColumn = dataColumnCount + SUMMARY_COLUMNS.indexOf(header);
    }
    const sourceCell = firstSheet[XLSX.utils.encode_cell({
      r: firstHeaderRow,
      c: firstStartColumn + (sourceColumn ?? 0),
    })];
    mergedSheet[XLSX.utils.encode_cell({ r: 0, c: column })] = {
      ...(cloneCell(sourceCell) ?? { t: "s" }),
      t: "s",
      v: header,
      w: header,
    };
  });

  let mergedRow = 1;
  const firstRowsByEmployee = new Map();
  const combinedSummaries = new Map();
  const exportedEmployeeKeys = new Set();

  availableResults.forEach((result) => {
    for (let offset = 0; offset < result.totalRows; offset += 1) {
      const sourceRow = result.processedHeaderRow + offset + 1;
      const employeeCodeCell = result.processedSheet[XLSX.utils.encode_cell({
        r: sourceRow,
        c: result.processedStartColumn + KEPT_COLUMNS.indexOf("Mã N.Viên"),
      })];
      const employeeNameCell = result.processedSheet[XLSX.utils.encode_cell({
        r: sourceRow,
        c: result.processedStartColumn + KEPT_COLUMNS.indexOf("Tên N.Viên"),
      })];
      const employeeCode = getCellDisplayValue(employeeCodeCell);
      const employeeName = getCellDisplayValue(employeeNameCell);
      const rowDetail = result.processedRows?.[offset] ?? {};
      const branch = normalizeBranch(rowDetail.branch) ||
        detectBranchFromText(rowDetail.employeeName || employeeName) ||
        detectBranchFromText(result.sourceFileName);
      const employeeKey = normalizeEmployeeCode(employeeCode) || normalizeLookup(employeeName);
      if (employeeKey) {
        exportedEmployeeKeys.add(employeeKey);
        if (!firstRowsByEmployee.has(employeeKey)) firstRowsByEmployee.set(employeeKey, mergedRow);
      }

      mergedDataHeaders.forEach((header, column) => {
        const targetAddress = XLSX.utils.encode_cell({ r: mergedRow, c: column });
        if (header === MERGED_BRANCH_COLUMN) {
          mergedSheet[targetAddress] = {
            ...(cloneCell(employeeNameCell) ?? { t: "s" }),
            t: "s",
            v: branch,
            w: branch,
          };
          return;
        }

        const sourceColumn = sourceHeaderToColumn.get(header);
        const sourceCell = result.processedSheet[XLSX.utils.encode_cell({
          r: sourceRow,
          c: result.processedStartColumn + sourceColumn,
        })];
        if (sourceCell) mergedSheet[targetAddress] = cloneCell(sourceCell);
      });

      mergedSheet[XLSX.utils.encode_cell({ r: mergedRow, c: sourceColumnIndex })] = {
        t: "s",
        v: result.sourceFileName || "",
        s: { alignment: { vertical: "center", wrapText: true } },
      };
      if (result.processedSheet["!rows"]?.[sourceRow]) {
        mergedSheet["!rows"] ??= [];
        mergedSheet["!rows"][mergedRow] = structuredClone(result.processedSheet["!rows"][sourceRow]);
      }
      mergedRow += 1;
    }

    (result.employeeSummaries ?? []).forEach((summary) => {
      const key = normalizeEmployeeCode(summary.employeeCode) || normalizeLookup(summary.employeeName);
      if (!key) return;
      const combined = combinedSummaries.get(key) ?? {
        ...summary,
        firstRow: firstRowsByEmployee.get(key) ?? 1,
        lateMinutes: 0,
        earlyInMinutes: 0,
        penalty: 0,
        earlyMinutes: 0,
        overtimeMinutes: 0,
      };
      combined.firstRow = Math.min(combined.firstRow, firstRowsByEmployee.get(key) ?? combined.firstRow);
      combined.lateMinutes += Number(summary.lateMinutes) || 0;
      combined.earlyInMinutes += Number(summary.earlyInMinutes) || 0;
      combined.penalty += Number(summary.penalty) || 0;
      combined.earlyMinutes += Number(summary.earlyMinutes) || 0;
      combined.overtimeMinutes += Number(summary.overtimeMinutes) || 0;
      combinedSummaries.set(key, combined);
    });
  });

  const missingEmployees = selectedEmployeeReports.filter(({ key }) => !exportedEmployeeKeys.has(key));
  let outputEndRow = mergedRow - 1;
  combinedSummaries.forEach((summary) => {
    outputEndRow = Math.max(
      outputEndRow,
      writeEmployeeSummaryBox(XLSX, mergedSheet, 0, summary, summaryStartColumn),
    );
  });

  const firstColumns = firstSheet["!cols"] ?? [];
  mergedSheet["!cols"] = mergedHeaders.map((header) => {
    if (header === MERGED_BRANCH_COLUMN) return { wch: 12 };
    if (header === MERGED_SOURCE_COLUMN) return { wch: 38 };
    if (SUMMARY_COLUMNS.includes(header)) {
      const sourceColumn = firstStartColumn + dataColumnCount + SUMMARY_COLUMNS.indexOf(header);
      return firstColumns[sourceColumn] ? structuredClone(firstColumns[sourceColumn]) : { wch: 16 };
    }
    const sourceColumn = sourceHeaderToColumn.get(header);
    return firstColumns[firstStartColumn + sourceColumn]
      ? structuredClone(firstColumns[firstStartColumn + sourceColumn])
      : undefined;
  });
  mergedSheet["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: mergedRow - 1, c: sourceColumnIndex } }),
  };
  mergedSheet["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: outputEndRow, c: mergedHeaders.length - 1 },
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, mergedSheet, MERGED_SHEET_NAME);
  appendMissingEmployeesSheet(workbook, missingEmployees);
  normalizeDateCellsForStyledWrite(workbook);
  const outputBuffer = XLSX_STYLE.write(workbook, {
    bookType: "xlsx",
    type: "array",
    cellStyles: true,
    compression: true,
  });
  return {
    blob: new Blob([outputBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    fileName: fileName || makeMergedOutputFileName(processFilters),
    totalRows,
    sourceFileCount: availableResults.length,
    headers: mergedHeaders,
    selectedEmployeeCount: selectedEmployeeReports.length,
    exportedEmployeeCount: selectedEmployeeReports.length
      ? selectedEmployeeReports.length - missingEmployees.length
      : exportedEmployeeKeys.size,
    missingEmployeeCount: missingEmployees.length,
    missingEmployees,
  };
}

/** Kích hoạt tải Blob kết quả xuống trình duyệt với tên file đã tạo. */
export function downloadProcessedFile(blob, fileName = OUTPUT_FILE_NAME) {
  downloadExcelBlob(blob, fileName);
}
