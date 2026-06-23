import { SOURCE_SHEET_NAME } from "../constants/excelConstants.js";
import {
  findHeaderRow,
  getWorksheetBounds,
  mapHeaderColumns,
} from "./excelColumnMapper.js";

/** Đọc file chấm công .xlsx, tìm sheet/header/cột và trả workbook đã validate. */
export async function readAttendanceWorkbook(file, XLSX) {
  if (!file) throw new Error("Vui lòng chọn file Excel cần xử lý.");
  if (!file.name.toLocaleLowerCase().endsWith(".xlsx")) {
    throw new Error("Định dạng không hợp lệ. Vui lòng chọn file .xlsx.");
  }
  let workbook;
  try {
    workbook = XLSX.read(await file.arrayBuffer(), {
      type: "array",
      cellDates: true,
      cellStyles: true,
      cellNF: true,
      cellText: true,
    });
  } catch {
    throw new Error("Không thể đọc file Excel. File có thể bị hỏng hoặc sai định dạng.");
  }
  if (!workbook.SheetNames.includes(SOURCE_SHEET_NAME)) {
    throw new Error(`Không tìm thấy sheet “${SOURCE_SHEET_NAME}” trong file Excel.`);
  }
  const sourceSheet = workbook.Sheets[SOURCE_SHEET_NAME];
  const bounds = getWorksheetBounds(XLSX, sourceSheet);
  const headerRow = findHeaderRow(XLSX, sourceSheet, bounds);
  const columnMap = mapHeaderColumns(XLSX, sourceSheet, headerRow, bounds);
  return { workbook, sourceSheet, bounds, headerRow, columnMap };
}
