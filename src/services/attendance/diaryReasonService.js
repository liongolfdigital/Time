import {
  createDiaryLookup,
  findDiaryForViolation,
  isDiaryPermitted,
} from "../../diary/diaryModel.js";
import { normalizeText } from "../../employees/employeeModel.js";

export { createDiaryLookup, findDiaryForViolation, isDiaryPermitted };

/** Lấy lý do Diary đã chuẩn hóa, dùng nhãn dự phòng khi bản ghi không có lý do. */
export function getDiaryReason(entry) {
  return normalizeText(entry?.reason) || "Có Diary";
}
