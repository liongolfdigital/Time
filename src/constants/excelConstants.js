import {
  MONTHLY_LATE_WARNING_TEXT,
} from "./attendanceConstants.js";

export const SOURCE_SHEET_NAME = "Chi tiết";
export const OUTPUT_FILE_NAME = "bang_cham_cong_da_xu_ly.xlsx";

// Các cột nguồn được giữ nguyên và thứ tự chuẩn của sheet kết quả.
export const KEPT_COLUMNS = Object.freeze([
  "STT",
  "Mã N.Viên",
  "Tên N.Viên",
  "Ngày",
  "Thứ",
  "Vào 1",
  "Ra 1",
  "Vào 2",
  "Ra 2",
  "Tổng giờ",
  "Giờ ĐK",
]);

// Cấu hình cột nguồn loại bỏ, cột tính mới và hộp tổng hợp nhân viên.
export const REMOVED_COLUMNS = Object.freeze(["Ngày Công", "TC1", "TC2", "TC3", "Tổng cộng"]);
export const ADDED_COLUMNS = Object.freeze(["Đi sớm", "Đi trễ", "Phạt", "Về sớm", "Tăng ca", "Ghi chú", "Tổng làm"]);
export const SUMMARY_COLUMNS = Object.freeze(["Nhân viên", "Tổng"]);
export const OUTPUT_COLUMNS = Object.freeze([...KEPT_COLUMNS, ...ADDED_COLUMNS, ...SUMMARY_COLUMNS]);

// Các cột tùy chọn có thể vắng mặt mà không ảnh hưởng pipeline tính chấm công.
// TC1/TC2/TC3/Tổng cộng là cột legacy chỉ bị loại khỏi output, không phải nguồn tính chính.
export const OPTIONAL_SOURCE_COLUMNS = Object.freeze([
  "Giờ ĐK",
  "Vào 2",
  "Ra 2",
  "TC1",
  "TC2",
  "TC3",
  "Tổng cộng",
]);
export const REQUIRED_COLUMNS = Object.freeze([
  ...KEPT_COLUMNS.filter((header) => !OPTIONAL_SOURCE_COLUMNS.includes(header)),
  ...REMOVED_COLUMNS.filter((header) => !OPTIONAL_SOURCE_COLUMNS.includes(header)),
]);

export const HEADER_SEARCH_LIMIT = 50;
export const PREVIEW_ROW_LIMIT = 100;
export { MONTHLY_LATE_WARNING_TEXT };
