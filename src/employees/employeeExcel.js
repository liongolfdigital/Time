import {
  createEmployeeId,
  EMPLOYEE_EXPORT_FILE_NAME,
  EMPLOYEE_FIELDS,
  EMPLOYEE_SHEET_NAME,
  normalizeLookup,
  normalizeText,
  sanitizeEmployee,
} from "./employeeModel.js";

let xlsxModulePromise;

// Lazy-load SheetJS một lần để giảm bundle khởi tạo của màn hình nhân viên.
async function loadXlsx() {
  xlsxModulePromise ??= import("xlsx");
  return xlsxModulePromise;
}

// Tìm dòng tiêu đề RegisHours trong tối đa 50 dòng đầu.
function findHeaderRow(XLSX, worksheet, bounds) {
  const requiredHeaders = new Set(
    EMPLOYEE_FIELDS.map(({ label }) => normalizeLookup(label)),
  );
  const lastSearchRow = Math.min(bounds.e.r, bounds.s.r + 49);

  for (let row = bounds.s.r; row <= lastSearchRow; row += 1) {
    let matchedHeaders = 0;

    for (let column = bounds.s.c; column <= bounds.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      if (requiredHeaders.has(normalizeLookup(worksheet[address]?.v))) {
        matchedHeaders += 1;
      }
    }

    if (matchedHeaders >= 4) return row;
  }

  throw new Error(
    `Không tìm thấy dòng tiêu đề hợp lệ trong sheet “${EMPLOYEE_SHEET_NAME}”.`,
  );
}

// Ánh xạ tên header chuẩn sang chỉ số cột và báo lỗi khi thiếu field bắt buộc.
function mapHeaderColumns(XLSX, worksheet, headerRow, bounds) {
  const columnMap = new Map();

  for (let column = bounds.s.c; column <= bounds.e.c; column += 1) {
    const address = XLSX.utils.encode_cell({ r: headerRow, c: column });
    const header = normalizeLookup(worksheet[address]?.v);
    if (header && !columnMap.has(header)) columnMap.set(header, column);
  }

  const missingColumns = EMPLOYEE_FIELDS.filter(
    ({ label }) => !columnMap.has(normalizeLookup(label)),
  ).map(({ label }) => label);

  if (missingColumns.length > 0) {
    throw new Error(`File thiếu cột bắt buộc: ${missingColumns.join(", ")}.`);
  }

  return columnMap;
}

// Đọc ô giờ từ Date, serial Excel hoặc chuỗi và trả về HH:mm.
function formatTimeCell(XLSX, cell) {
  if (!cell) return "";

  if (cell.v instanceof Date) {
    return `${String(cell.v.getUTCHours()).padStart(2, "0")}:${String(
      cell.v.getUTCMinutes(),
    ).padStart(2, "0")}`;
  }

  if (typeof cell.v === "number") {
    const totalMinutes = Math.round((cell.v % 1) * 24 * 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  const formatted = XLSX.utils.format_cell(cell);
  const match = formatted.match(/(\d{1,2})[:h](\d{2})/i);
  if (match) {
    return `${match[1].padStart(2, "0")}:${match[2]}`;
  }

  return normalizeText(formatted);
}

// Lấy giá trị một ô theo type field, dùng parser giờ cho các cột ca.
function getCellValue(XLSX, worksheet, row, column, type) {
  const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
  return type === "time"
    ? formatTimeCell(XLSX, cell)
    : normalizeText(cell ? XLSX.utils.format_cell(cell) : "");
}

/** Đọc RegisHours.xlsx, validate cấu trúc và trả danh sách nhân viên đã sanitize. */
export async function importEmployeesFromExcel(file) {
  if (!file?.name.toLocaleLowerCase().endsWith(".xlsx")) {
    throw new Error("Vui lòng chọn file danh sách nhân viên định dạng .xlsx.");
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
    throw new Error("Không thể đọc file danh sách nhân viên.");
  }

  if (!workbook.SheetNames.includes(EMPLOYEE_SHEET_NAME)) {
    throw new Error(`Không tìm thấy sheet “${EMPLOYEE_SHEET_NAME}”.`);
  }

  const worksheet = workbook.Sheets[EMPLOYEE_SHEET_NAME];
  if (!worksheet?.["!ref"]) {
    throw new Error(`Sheet “${EMPLOYEE_SHEET_NAME}” không có dữ liệu.`);
  }

  const bounds = XLSX.utils.decode_range(worksheet["!ref"]);
  const headerRow = findHeaderRow(XLSX, worksheet, bounds);
  const columnMap = mapHeaderColumns(XLSX, worksheet, headerRow, bounds);
  const employees = [];

  for (let row = headerRow + 1; row <= bounds.e.r; row += 1) {
    const employee = { id: createEmployeeId() };

    EMPLOYEE_FIELDS.forEach(({ key, label, type }) => {
      employee[key] = getCellValue(
        XLSX,
        worksheet,
        row,
        columnMap.get(normalizeLookup(label)),
        type,
      );
    });

    if (employee.employeeCode || employee.employeeName) {
      employees.push(sanitizeEmployee(employee));
    }
  }

  if (employees.length === 0) {
    throw new Error("File không có nhân viên hợp lệ để import.");
  }

  return employees;
}

// Chuyển HH:mm thành phần ngày Excel để export giữ đúng kiểu giờ.
function timeToExcelValue(value) {
  const match = normalizeText(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return value;
  return (Number(match[1]) * 60 + Number(match[2])) / (24 * 60);
}

/** Tạo và tải RegisHours.xlsx từ danh sách nhân viên; có side effect click download. */
export async function exportEmployeesToExcel(employees) {
  if (employees.length === 0) {
    throw new Error("Danh sách nhân viên đang trống.");
  }

  const XLSX = await loadXlsx();
  const rows = [
    EMPLOYEE_FIELDS.map(({ label }) => label),
    ...employees.map((employee) =>
      EMPLOYEE_FIELDS.map(({ key, type }) =>
        type === "time" ? timeToExcelValue(employee[key]) : employee[key],
      ),
    ),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);

  EMPLOYEE_FIELDS.forEach(({ type }, columnIndex) => {
    if (type !== "time") return;

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      if (typeof worksheet[address]?.v === "number") worksheet[address].z = "hh:mm";
    }
  });

  worksheet["!cols"] = EMPLOYEE_FIELDS.map(({ key }) => ({
    wch: key === "employeeName" || key === "note" ? 25 : 13,
  }));
  worksheet["!autofilter"] = { ref: worksheet["!ref"] };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, EMPLOYEE_SHEET_NAME);
  const output = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
    compression: true,
  });

  const url = URL.createObjectURL(
    new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = EMPLOYEE_EXPORT_FILE_NAME;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
