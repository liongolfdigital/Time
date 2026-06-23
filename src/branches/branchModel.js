import { normalizeText } from "../employees/employeeModel.js";

export const DEFAULT_BRANCH_CODES = Object.freeze(["NHC", "Q7", "RC", "TD", "OL"]);

// Gấp dấu và chuyển hoa văn bản để nhận diện chi nhánh từ nhiều cách nhập.
function foldBranchText(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .toLocaleUpperCase("vi-VN");
}

// Ánh xạ các alias quen thuộc về mã chi nhánh chuẩn.
function normalizeKnownBranch(value) {
  const folded = foldBranchText(value);
  const compact = folded.replace(/[^A-Z0-9]/g, "");

  if (["Q7", "QUAN7", "QUAN07"].includes(compact)) return "Q7";
  if (["OL", "OUTLET", "ONLINE", "ONL"].includes(compact)) return "OL";
  if (["TD", "THUDUC"].includes(compact)) return "TD";
  if (["RC", "RACHCHIEC"].includes(compact)) return "RC";
  if (compact === "NHC") return "NHC";
  return "";
}

/** Chuẩn hóa giá trị chi nhánh trực tiếp; trả chuỗi rỗng nếu văn bản không phải một mã đơn. */
export function normalizeBranch(value) {
  const text = normalizeText(value);
  if (!text) return "";

  const knownBranch = normalizeKnownBranch(text);
  if (knownBranch) return knownBranch;

  const folded = foldBranchText(text);
  const compact = folded.replace(/[^A-Z0-9]/g, "");
  if (!compact || /[\s-]/.test(folded)) return "";
  return compact;
}

/** Dò mã chi nhánh trong tên/mã nhân viên hoặc văn bản tự do. */
export function detectBranchFromText(value) {
  const directBranch = normalizeBranch(value);
  if (directBranch) return directBranch;

  const text = foldBranchText(value);
  if (!text) return "";

  const patterns = [
    ["Q7", /(^|[^A-Z0-9])(Q7|QUAN\s*0?7)([^A-Z0-9]|$)/],
    ["OL", /(^|[^A-Z0-9])(OL|OUTLET|ONLINE|ONL)([^A-Z0-9]|$)/],
    ["TD", /(^|[^A-Z0-9])(TD|THU\s*DUC)([^A-Z0-9]|$)/],
    ["RC", /(^|[^A-Z0-9])(RC|RACH\s*CHIEC)([^A-Z0-9]|$)/],
    ["NHC", /(^|[^A-Z0-9])NHC([^A-Z0-9]|$)/],
  ];

  return patterns.find(([, pattern]) => pattern.test(text))?.[0] || "";
}
