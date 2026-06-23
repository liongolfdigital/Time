/**
 * Adapter attachment Diary phía trình duyệt: cấu hình loại file, validate, URL nội dung
 * và lời gọi API list/upload/replace/delete. Module không tự quản lý state giao diện.
 */
import { uploadApi } from "../api/uploadApi.js";

// Giới hạn mặc định và whitelist extension/MIME dùng chung cho picker, drop và paste ảnh.
export const DEFAULT_MAX_ATTACHMENT_SIZE_MB = 20;
export const ATTACHMENT_EXTENSIONS = Object.freeze([
  ".jpg", ".jpeg", ".png", ".webp",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
]);
export const ATTACHMENT_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
export const CLIPBOARD_IMAGE_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.join(",");

// Lấy extension chữ thường từ tên file để validate upload.
function getFileExtension(fileName) {
  const name = String(fileName ?? "").trim().toLocaleLowerCase();
  const dotIndex = name.lastIndexOf(".");
  return dotIndex >= 0 ? name.slice(dotIndex) : "";
}

// Tạo timestamp an toàn dùng đặt tên ảnh paste từ clipboard.
function formatClipboardTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return [
    safeDate.getFullYear(),
    String(safeDate.getMonth() + 1).padStart(2, "0"),
    String(safeDate.getDate()).padStart(2, "0"),
    "-",
    String(safeDate.getHours()).padStart(2, "0"),
    String(safeDate.getMinutes()).padStart(2, "0"),
    String(safeDate.getSeconds()).padStart(2, "0"),
  ].join("");
}

/** Bổ sung tên file cho ảnh clipboard không có tên; trả null nếu không phải ảnh hỗ trợ. */
export function ensureClipboardImageFile(file, now = new Date()) {
  if (!file || !CLIPBOARD_IMAGE_TYPES.includes(file.type)) return null;
  if (String(file.name ?? "").trim()) return file;

  const extension = file.type === "image/jpeg"
    ? "jpg"
    : file.type === "image/webp" ? "webp" : "png";
  return new File(
    [file],
    `bien-ban-paste-${formatClipboardTimestamp(now)}.${extension}`,
    {
      type: file.type,
      lastModified: file.lastModified || now.getTime(),
    },
  );
}

/** Lấy attachment từ API, có thể giới hạn theo ID Diary. */
export async function listDiaryAttachments(diaryEntryId = "") {
  return uploadApi.list(diaryEntryId);
}

/** Đọc cấu hình upload attachment từ server. */
export async function getAttachmentConfig() {
  return uploadApi.config();
}

/** Đóng gói file và metadata vào FormData rồi upload/thay thế attachment. */
export async function uploadDiaryAttachment({
  diaryEntryId,
  file,
  uploadedBy,
  replaceAttachmentId = "",
  branch = "",
}) {
  const body = new FormData();
  body.append("file", file);
  body.append("uploadedBy", uploadedBy);
  if (branch) body.append("branch", branch);
  if (replaceAttachmentId) body.append("replaceAttachmentId", replaceAttachmentId);
  return uploadApi.upload(diaryEntryId, body);
}

/** Xóa một attachment qua API. */
export async function deleteDiaryAttachment(id) {
  return uploadApi.remove(id);
}

/** Xóa toàn bộ attachment thuộc một Diary qua API. */
export async function deleteDiaryEntryAttachments(diaryEntryId) {
  return uploadApi.removeAll(diaryEntryId);
}

/** Dựng URL xem hoặc tải nội dung attachment. */
export function getAttachmentContentUrl(id, download = false) {
  return uploadApi.contentUrl(id, download);
}

/** Kiểm tra file có thể preview trực tiếp bằng ảnh/iframe PDF hay không. */
export function isPreviewableAttachment(attachment) {
  return attachment?.fileType === "application/pdf" || attachment?.fileType?.startsWith("image/");
}

/** Validate extension/MIME/dung lượng file; trả chuỗi lỗi hoặc rỗng nếu hợp lệ. */
export function validateAttachmentFile(file, maxSizeMb = DEFAULT_MAX_ATTACHMENT_SIZE_MB) {
  if (!file) return "";
  const extension = getFileExtension(file.name);
  const mimeType = String(file.type ?? "").toLocaleLowerCase();
  if (
    !ATTACHMENT_EXTENSIONS.includes(extension)
    && !ATTACHMENT_MIME_TYPES.includes(mimeType)
  ) {
    return "Định dạng file không được hỗ trợ";
  }
  if (file.size > maxSizeMb * 1024 * 1024) {
    return `File vượt quá dung lượng tối đa ${maxSizeMb}MB`;
  }
  return "";
}
