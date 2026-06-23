import {
  normalizeDiaryEmployeeCode,
} from "../diary/diaryModel";
import { normalizeLookup, normalizeText } from "../employees/employeeModel";
import {
  DEFAULT_BRANCH_CODES,
  detectBranchFromText,
  normalizeBranch,
} from "../branches/branchModel";
import { ROLES } from "../constants/roleConstants";

export const BRANCHES = DEFAULT_BRANCH_CODES;
export const ADMIN_PAGES = ["attendance", "process", "employees", "diary", "accounts"];
export const MANAGER_PAGES = ["employees", "diary"];

export { detectBranchFromText, normalizeBranch };

/** Kiểm tra tài khoản có vai trò Admin hay không. */
export function isAdmin(user) {
  return user?.role === ROLES.ADMIN;
}

/** Kiểm tra tài khoản có vai trò Manager hay không. */
export function isManager(user) {
  return user?.role === ROLES.MANAGER;
}

/** Suy ra chi nhánh từ field trực tiếp rồi fallback sang mã/tên nhân viên. */
export function getRecordBranch(record) {
  const directBranch = [
    record?.branch,
    record?.chiNhanh,
    record?.chi_nhanh,
    record?.store,
    record?.location,
    record?.["Chi nhánh"],
    record?.["CHI NHÁNH"],
    record?.["Chi Nhanh"],
    record?.["CHI NHANH"],
  ].map(detectBranchFromText).find(Boolean);
  if (directBranch) return directBranch;

  return [
    record?.employeeCode,
    record?.code,
    record?.maNhanVien,
    record?.ma_nhan_vien,
    record?.["Mã N.viên"],
    record?.["MÃ N.VIÊN"],
    record?.["Ma N.vien"],
    record?.["MA N.VIEN"],
    record?.employeeName,
    record?.name,
    record?.fullName,
    record?.["Tên N.viên"],
    record?.["TÊN N.VIÊN"],
    record?.["Ten N.vien"],
    record?.["TEN N.VIEN"],
  ].map(detectBranchFromText).find(Boolean) || "";
}

/** Chọn trang mặc định theo vai trò sau đăng nhập. */
export function defaultPageForUser(user) {
  return isManager(user) ? "employees" : "attendance";
}

/** Kiểm tra quyền truy cập một page frontend theo vai trò. */
export function canAccessPage(user, page) {
  if (!user) return false;
  if (isAdmin(user)) return ADMIN_PAGES.includes(page);
  if (isManager(user)) return MANAGER_PAGES.includes(page);
  return false;
}

/** Kiểm tra user có được thao tác dữ liệu của chi nhánh chỉ định hay không. */
export function canAccessBranch(user, branch) {
  if (isAdmin(user)) return true;
  const normalizedBranch = normalizeBranch(branch);
  return isManager(user) && Boolean(normalizedBranch) && normalizedBranch === normalizeBranch(user.branch);
}

/** Lọc danh sách nhân viên theo phạm vi chi nhánh của user. */
export function filterEmployeesForUser(employees, user) {
  if (isAdmin(user)) return employees;
  return employees.filter((employee) => canAccessBranch(user, getRecordBranch(employee)));
}

/** Kiểm tra quyền tạo/cập nhật một nhân viên cụ thể. */
export function canManageEmployee(user, employee) {
  return isAdmin(user) || (isManager(user) && canAccessBranch(user, getRecordBranch(employee)));
}

/** Chỉ Admin được import/export toàn bộ danh sách nhân viên. */
export function canImportExport(user) {
  return isAdmin(user);
}

/** Cho phép Admin và Manager import/export Diary trong phạm vi được cấp. */
export function canImportExportDiary(user) {
  return isAdmin(user) || isManager(user);
}

/** Chỉ Admin được xóa nhân viên. */
export function canDeleteEmployee(user) {
  return isAdmin(user);
}

// Tìm nhân viên gốc của Diary theo mã trước, tên sau để suy ra chi nhánh.
function findDiaryEmployee(entry, employees) {
  const code = normalizeDiaryEmployeeCode(entry.employeeCode);
  const name = normalizeLookup(entry.employeeName);

  if (code) {
    const byCode = employees.find(
      (employee) => normalizeDiaryEmployeeCode(employee.employeeCode) === code,
    );
    if (byCode) return byCode;
  }

  return name
    ? employees.find((employee) => normalizeLookup(employee.employeeName) === name)
    : null;
}

/** Xác định chi nhánh Diary từ chính entry hoặc hồ sơ nhân viên liên quan. */
export function getDiaryEntryBranch(entry, employees) {
  return normalizeBranch(
    getRecordBranch(entry) || getRecordBranch(findDiaryEmployee(entry, employees)),
  );
}

/** Lọc Diary theo phạm vi chi nhánh của user. */
export function filterDiaryEntriesForUser(entries, employees, user) {
  if (isAdmin(user)) return entries;
  return entries.filter((entry) => canAccessBranch(user, getDiaryEntryBranch(entry, employees)));
}

/** Kiểm tra quyền tạo/cập nhật một Diary cụ thể. */
export function canManageDiaryEntry(user, entry, employees) {
  return isAdmin(user) || (
    isManager(user) && canAccessBranch(user, getDiaryEntryBranch(entry, employees))
  );
}

/** Admin và Manager được yêu cầu xóa Diary; backend tiếp tục chặn Manager ngoài chi nhánh. */
export function canDeleteDiaryEntry(user) {
  return isAdmin(user) || isManager(user);
}

/** Cho phép Admin hoặc chính Manager đã upload sửa/xóa attachment cùng chi nhánh. */
export function canModifyAttachment(user, attachment) {
  if (isAdmin(user)) return true;
  if (!isManager(user) || !attachment) return false;
  const sameUploader =
    attachment.uploadedByAccountId === user.id ||
    normalizeLookup(attachment.uploadedByUsername) === normalizeLookup(user.username);
  return sameUploader && canAccessBranch(user, attachment.branch);
}
