import {
  createDiaryId,
  DIARY_DATA_FIELDS,
  DIARY_EXPORT_FILE_NAME,
  DIARY_EXPORT_FIELDS,
  DIARY_SHEET_NAME,
  formatDiaryViolationTypes,
  formatDiaryDate,
  hasDiaryAttachments,
  normalizeDiaryDate,
  sanitizeDiaryEntry,
} from "./diaryModel.js";
import { normalizeLookup, normalizeText } from "../employees/employeeModel.js";

let xlsxModulePromise;

// Lazy-load SheetJS một lần khi người dùng import/export Diary.
async function loadXlsx() {
  xlsxModulePromise ??= import("xlsx");
  return xlsxModulePromise;
}

// Tìm header Diary hợp lệ trong tối đa 50 dòng đầu worksheet.
function findHeaderRow(XLSX, worksheet, bounds) {
  const headers = new Set(DIARY_EXPORT_FIELDS.map(({ label }) => normalizeLookup(label)));
  const lastRow = Math.min(bounds.e.r, bounds.s.r + 49);

  for (let row = bounds.s.r; row <= lastRow; row += 1) {
    let matched = 0;
    for (let column = bounds.s.c; column <= bounds.e.c; column += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (headers.has(normalizeLookup(cell?.v))) matched += 1;
    }
    if (matched >= 4) return row;
  }

  throw new Error(`Không tìm thấy dòng tiêu đề hợp lệ trong sheet “${DIARY_SHEET_NAME}”.`);
}

// Lập map header-cột và kiểm tra các cột Diary bắt buộc.
function mapHeaderColumns(XLSX, worksheet, headerRow, bounds) {
  const columnMap = new Map();
  for (let column = bounds.s.c; column <= bounds.e.c; column += 1) {
    const cell = worksheet[XLSX.utils.encode_cell({ r: headerRow, c: column })];
    const header = normalizeLookup(cell?.v);
    if (header && !columnMap.has(header)) columnMap.set(header, column);
  }

  const missing = DIARY_EXPORT_FIELDS.filter(
    ({ optional }) => !optional,
  ).filter(
    ({ label }) => !columnMap.has(normalizeLookup(label)),
  ).map(({ label }) => label);
  if (missing.length) throw new Error(`File Diary thiếu cột bắt buộc: ${missing.join(", ")}.`);
  return columnMap;
}

// Trả về cell SheetJS tại tọa độ dòng/cột.
function getCell(XLSX, worksheet, row, column) {
  return worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
}

// Đọc text đã format của cell rồi chuẩn hóa khoảng trắng.
function getCellText(XLSX, worksheet, row, column) {
  const cell = getCell(XLSX, worksheet, row, column);
  return normalizeText(cell ? XLSX.utils.format_cell(cell) : "");
}

/** Đọc Diary.xlsx, chuẩn hóa ngày/vi phạm và trả các entry hợp lệ. */
export async function importDiaryFromExcel(file) {
  if (!file?.name.toLocaleLowerCase().endsWith(".xlsx")) {
    throw new Error("Vui lòng chọn file Diary định dạng .xlsx.");
  }

  const XLSX = await loadXlsx();
  let workbook;
  try {
    workbook = XLSX.read(await file.arrayBuffer(), {
      type: "array",
      cellDates: true,
      cellNF: true,
      cellText: true,
    });
  } catch {
    throw new Error("Không thể đọc file Diary.");
  }

  if (!workbook.SheetNames.includes(DIARY_SHEET_NAME)) {
    throw new Error(`Không tìm thấy sheet “${DIARY_SHEET_NAME}”.`);
  }

  const worksheet = workbook.Sheets[DIARY_SHEET_NAME];
  if (!worksheet?.["!ref"]) throw new Error(`Sheet “${DIARY_SHEET_NAME}” không có dữ liệu.`);
  const bounds = XLSX.utils.decode_range(worksheet["!ref"]);
  const headerRow = findHeaderRow(XLSX, worksheet, bounds);
  const columns = mapHeaderColumns(XLSX, worksheet, headerRow, bounds);
  const entries = [];

  for (let row = headerRow + 1; row <= bounds.e.r; row += 1) {
    const raw = { id: createDiaryId() };
    DIARY_DATA_FIELDS.forEach(({ key, label, type }) => {
      const column = columns.get(normalizeLookup(label));
      if (column === undefined) {
        raw[key] = "";
        return;
      }
      const cell = getCell(XLSX, worksheet, row, column);
      raw[key] = type === "date"
        ? normalizeDiaryDate(cell?.v ?? getCellText(XLSX, worksheet, row, column))
        : type === "datetime" && cell?.v instanceof Date
          ? cell.v.toISOString()
          : getCellText(XLSX, worksheet, row, column);
    });
    if (raw.date || raw.employeeCode || raw.employeeName || raw.reason) {
      entries.push(sanitizeDiaryEntry(raw));
    }
  }

  if (!entries.length) throw new Error("File không có dòng Diary hợp lệ để import.");
  return entries;
}

// Chuyển ngày Diary sang serial Excel để áp format dd/mm/yyyy.
function dateToExcelValue(value) {
  const normalized = normalizeDiaryDate(value);
  if (!normalized) return formatDiaryDate(value);
  const [year, month, day] = normalized.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86400000 + 25569;
}

// Chuyển timestamp ISO sang serial Excel để áp format ngày giờ.
function dateTimeToExcelValue(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.getTime() / 86400000 + 25569
    : value;
}

/** Tạo và tải file Diary Excel, gồm loại vi phạm và trạng thái hồ sơ. */
export async function exportDiaryToExcel(entries) {
  if (!entries.length) throw new Error("Danh sách Diary đang trống.");
  const XLSX = await loadXlsx();
  const rows = [
    DIARY_EXPORT_FIELDS.map(({ label }) => label),
    ...entries.map((entry) =>
      DIARY_EXPORT_FIELDS.map(({ key, type }) =>
        type === "date"
          ? dateToExcelValue(entry[key])
          : type === "datetime"
            ? dateTimeToExcelValue(entry[key])
          : type === "violationTypes"
            ? formatDiaryViolationTypes(entry[key])
          : type === "attachmentStatus"
            ? hasDiaryAttachments(entry) ? "Có" : "Không"
            : entry[key],
      ),
    ),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  for (let row = 1; row < rows.length; row += 1) {
    DIARY_EXPORT_FIELDS.forEach(({ type }, column) => {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      if (typeof worksheet[address]?.v !== "number") return;
      if (type === "date") worksheet[address].z = "dd/mm/yyyy";
      if (type === "datetime") worksheet[address].z = "dd/mm/yyyy hh:mm";
    });
  }
  worksheet["!cols"] = DIARY_EXPORT_FIELDS.map(({ key }) => ({
    // wch: key === "reason" || key === "bienBan" ? 32 : key === "employeeName" || key === "creatorName" ? 24 : 18,
    wch: key === "reason" ? 32 : key === "employeeName" || key === "creatorName" ? 24 : 18,
  }));
  worksheet["!autofilter"] = { ref: worksheet["!ref"] };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, DIARY_SHEET_NAME);
  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array", compression: true });
  const url = URL.createObjectURL(new Blob([output], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  const link = document.createElement("a");
  link.href = url;
  link.download = DIARY_EXPORT_FILE_NAME;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
