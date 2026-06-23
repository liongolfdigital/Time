import { detectBranchFromText } from "../../branches/branchModel.js";

/**
 * Nhận diện nhân viên Thủ Đức từ chi nhánh hoặc mã/tên có tiền tố TD/Thủ Đức.
 * Dùng helper branch chung để giữ cách normalize dấu và hoa/thường nhất quán.
 */
export function isThuDucEmployee(employee, employeeName = "") {
  return [
    employee?.branch,
    employeeName,
    employee?.employeeName,
    employee?.employeeCode,
  ].some((value) => detectBranchFromText(value) === "TD");
}
