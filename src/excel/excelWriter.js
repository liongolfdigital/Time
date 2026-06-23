/** Clone cell và deep-clone style để chỉnh output không làm đổi workbook nguồn. */
export function cloneCell(cell) {
  if (!cell) return undefined;
  return { ...cell, ...(cell.s ? { s: structuredClone(cell.s) } : {}) };
}

/** Ghi cell số/chuỗi tính toán vào worksheet; bỏ qua giá trị rỗng. */
export function writeCalculatedCell(targetSheet, address, value, numberFormat) {
  if (value === null || value === undefined || value === "") return;
  targetSheet[address] = typeof value === "number"
    ? { t: "n", v: value, ...(numberFormat ? { z: numberFormat } : {}) }
    : { t: "s", v: String(value) };
}

/** Chuyển số phút thành phần ngày Excel để format [hh]:mm. */
export function minutesToExcelTime(minutes) {
  return minutes === null || minutes === undefined ? null : Math.max(0, minutes) / (24 * 60);
}

// Chuyển Date UTC sang serial Excel, giữ cả phần thời gian trong ngày.
function dateToExcelSerial(date) {
  return Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds(),
  ) / 86400000 + 25569;
}

/** Mutate workbook trước khi styled-write để mọi Date trở thành cell số tương thích. */
export function normalizeDateCellsForStyledWrite(workbook) {
  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    Object.keys(worksheet).forEach((address) => {
      if (address.startsWith("!")) return;
      const cell = worksheet[address];
      if (!(cell?.v instanceof Date) || Number.isNaN(cell.v.getTime())) return;
      cell.v = dateToExcelSerial(cell.v);
      cell.t = "n";
      delete cell.w;
    });
  });
}

/** Tạo object URL và kích hoạt tải Blob Excel xuống trình duyệt. */
export function downloadExcelBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
