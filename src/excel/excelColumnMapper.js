import {
  HEADER_SEARCH_LIMIT,
  REQUIRED_COLUMNS,
  SOURCE_SHEET_NAME,
} from "../constants/excelConstants.js";

/** Chuẩn hóa header Excel để ánh xạ không phụ thuộc hoa/thường/khoảng trắng. */
export function normalizeHeader(value) {
  return String(value ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi-VN");
}

/** Đọc vùng dữ liệu `!ref` của worksheet hoặc báo sheet rỗng. */
export function getWorksheetBounds(XLSX, worksheet) {
  if (!worksheet?.["!ref"]) throw new Error(`Sheet “${SOURCE_SHEET_NAME}” không có dữ liệu.`);
  return XLSX.utils.decode_range(worksheet["!ref"]);
}

/** Dò dòng header chấm công trong giới hạn cấu hình bằng số cột bắt buộc khớp. */
export function findHeaderRow(XLSX, worksheet, bounds) {
  const requiredHeaders = new Set(REQUIRED_COLUMNS.map(normalizeHeader));
  const lastSearchRow = Math.min(bounds.e.r, bounds.s.r + HEADER_SEARCH_LIMIT - 1);
  for (let row = bounds.s.r; row <= lastSearchRow; row += 1) {
    const values = [];
    for (let column = bounds.s.c; column <= bounds.e.c; column += 1) {
      values.push(normalizeHeader(worksheet[XLSX.utils.encode_cell({ r: row, c: column })]?.v));
    }
    if (values.filter((value) => requiredHeaders.has(value)).length >= 5) return row;
  }
  throw new Error(`Không tìm thấy dòng tiêu đề hợp lệ trong ${HEADER_SEARCH_LIMIT} dòng đầu của sheet “${SOURCE_SHEET_NAME}”.`);
}

/** Tạo map header sang chỉ số cột và validate mọi cột nguồn bắt buộc. */
export function mapHeaderColumns(XLSX, worksheet, headerRow, bounds) {
  const columnMap = new Map();
  for (let column = bounds.s.c; column <= bounds.e.c; column += 1) {
    const header = normalizeHeader(worksheet[XLSX.utils.encode_cell({ r: headerRow, c: column })]?.v);
    if (header && !columnMap.has(header)) columnMap.set(header, column);
  }
  const missing = REQUIRED_COLUMNS.filter((header) => !columnMap.has(normalizeHeader(header)));
  if (missing.length) throw new Error(`File thiếu cột bắt buộc: ${missing.join(", ")}.`);
  return columnMap;
}

/** Trả cell nguồn theo tên header và số dòng; không sửa worksheet. */
export function getSourceCell(XLSX, sourceSheet, columnMap, row, header) {
  const column = columnMap.get(normalizeHeader(header));
  return column === undefined ? undefined : sourceSheet[XLSX.utils.encode_cell({ r: row, c: column })];
}
