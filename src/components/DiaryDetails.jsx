import { useRef, useState } from "react";
import { CloseIcon, DownloadIcon, EditIcon, EyeIcon, FileIcon, ReplaceIcon, TrashIcon, UploadIcon } from "./Icons";
import { formatDiaryDate, formatDiaryDateTime, normalizeDiaryViolationTypes } from "../diary/diaryModel";
import { ATTACHMENT_ACCEPT, deleteDiaryAttachment, getAttachmentContentUrl, isPreviewableAttachment, uploadDiaryAttachment, validateAttachmentFile } from "../diary/attachmentStorage";

const UPLOADER_STORAGE_KEY = "timekeeping.attachmentUploader.v1";

// Định dạng dung lượng attachment cho danh sách file.
function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Định dạng ngày upload theo locale Việt Nam, giữ nguyên input nếu không parse được.
function formatUploadedDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

// Render các loại ghi chú Diary thành tag, với style riêng cho OFF.
function renderViolationTags(value, emptyText = "Không có") {
  const types = normalizeDiaryViolationTypes(value);
  if (!types.length) return <strong>{emptyText}</strong>;
  return (
    <div className="diary-tag-list">
      {types.map((type) => <span className={`diary-tag ${type === "OFF" ? "diary-tag-off" : ""}`} key={type}>{type}</span>)}
    </div>
  );
}

/** Modal xem chi tiết Diary, preview/upload/thay thế/xóa attachment và mở form chỉnh sửa. */
export default function DiaryDetails({
  entry,
  attachments,
  currentUser = null,
  canModifyAttachment = () => true,
  maxFileSizeMb,
  onClose,
  onEdit,
  onEntryTouched,
  onAttachmentsChange,
}) {
  // Ref giữ input/thao tác thay thế; state quản lý uploader, preview, upload và lỗi.
  const fileInputRef = useRef(null);
  const replaceIdRef = useRef("");
  const [uploadedBy, setUploadedBy] = useState(
    () => currentUser?.fullName || entry.creatorName || localStorage.getItem(UPLOADER_STORAGE_KEY) || "",
  );
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");

  // Kiểm tra quyền/uploader rồi mở file picker cho upload mới hoặc thay thế.
  const chooseFile = (replaceAttachmentId = "") => {
    if (replaceAttachmentId) {
      const attachment = attachments.find(({ id }) => id === replaceAttachmentId);
      if (!canModifyAttachment(attachment)) {
        setError("Bạn không có quyền truy cập chức năng này");
        return;
      }
    }
    if (!uploadedBy.trim()) {
      setError("Vui lòng nhập người upload trước khi chọn file.");
      return;
    }
    replaceIdRef.current = replaceAttachmentId;
    fileInputRef.current?.click();
  };

  // Validate và upload file, cập nhật list parent/localStorage và preview nếu đang thay thế.
  const handleFile = async (file) => {
    if (!file) return;
    const validationError = validateAttachmentFile(file, maxFileSizeMb);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError("");
    setIsUploading(true);
    try {
      const replaceAttachmentId = replaceIdRef.current;
      const saved = await uploadDiaryAttachment({
        diaryEntryId: entry.id,
        file,
        uploadedBy: uploadedBy.trim(),
        replaceAttachmentId,
        branch: entry.branch,
      });
      localStorage.setItem(UPLOADER_STORAGE_KEY, uploadedBy.trim());
      onAttachmentsChange(
        replaceAttachmentId
          ? attachments.map((attachment) =>
              attachment.id === replaceAttachmentId ? saved : attachment,
            )
          : [saved, ...attachments],
      );
      onEntryTouched?.();
      if (previewAttachment?.id === replaceAttachmentId) setPreviewAttachment(saved);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setIsUploading(false);
      replaceIdRef.current = "";
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Kiểm tra quyền, xác nhận, xóa attachment API và đồng bộ preview/list parent.
  const removeAttachment = async (attachment) => {
    if (!canModifyAttachment(attachment)) {
      setError("Bạn không có quyền truy cập chức năng này");
      return;
    }
    if (!window.confirm(`Xóa file "${attachment.fileName}"?`)) return;
    setError("");
    try {
      await deleteDiaryAttachment(attachment.id);
      onAttachmentsChange(attachments.filter(({ id }) => id !== attachment.id));
      onEntryTouched?.();
      if (previewAttachment?.id === attachment.id) setPreviewAttachment(null);
    } catch (deleteError) {
      setError(deleteError.message);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="employee-modal diary-detail-modal" role="dialog" aria-modal="true" aria-labelledby="diary-detail-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div><div className="eyebrow">Chi tiết Diary</div><h2 id="diary-detail-title">{entry.employeeName || entry.employeeCode}</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Đóng"><CloseIcon /></button>
        </div>

        <div className="diary-detail-grid">
          <div><span>Mã N.Viên</span><strong>{entry.employeeCode || "—"}</strong></div>
          <div><span>Tên N.Viên</span><strong>{entry.employeeName || "—"}</strong></div>
          <div><span>Chi nhánh</span><strong>{entry.branch || "—"}</strong></div>
          <div><span>Ngày</span><strong>{formatDiaryDate(entry.date)}</strong></div>
          <div><span>Trạng thái</span><strong className={entry.permission === "Có phép" ? "status-permitted" : "status-not-permitted"}>{entry.permission || "Chưa xác định"}</strong></div>
          <div><span>Loại ghi chú</span>{renderViolationTags(entry.violationTypes)}</div>
          <div><span>Người lập biên bản</span><strong>{entry.creatorName || "—"}</strong>{entry.creatorCode && <small>{entry.creatorCode}</small>}</div>
          <div><span>Ngày tạo</span><strong>{formatDiaryDateTime(entry.createdAt)}</strong></div>
          <div><span>Ngày cập nhật</span><strong>{formatDiaryDateTime(entry.updatedAt)}</strong></div>
          <div className="diary-detail-reason"><span>Lý do</span><strong>{entry.reason}</strong></div>
        </div>

        <section className="attachment-section">
          <div className="attachment-heading">
            <div><h3>File biên bản</h3><p>{attachments.length ? `${attachments.length} file đã lưu trên server` : "Chưa bổ sung hồ sơ"}</p></div>
            <button className="button button-secondary" type="button" disabled={isUploading} onClick={() => chooseFile()}><UploadIcon size={17} />{isUploading ? "Đang tải..." : "Upload file"}</button>
          </div>

          <input ref={fileInputRef} className="hidden-file-input" type="file" accept={ATTACHMENT_ACCEPT} onChange={(event) => handleFile(event.target.files?.[0])} />
          <label className="form-field attachment-uploader"><span>Người upload</span><input value={uploadedBy} onChange={(event) => setUploadedBy(event.target.value)} placeholder="Tên nhân viên hoặc quản lý" /></label>
          <p className="attachment-hint">Hỗ trợ JPG, JPEG, PNG, WEBP, PDF, DOC, DOCX, XLS, XLSX. Tối đa {maxFileSizeMb}MB/file.</p>

          {error && <p className="form-error">{error}</p>}

          <div className="attachment-list">
            {attachments.length ? attachments.map((attachment) => (
              <article className="attachment-item" key={attachment.id}>
                <span className="attachment-file-icon"><FileIcon size={22} /></span>
                <div className="attachment-meta"><strong title={attachment.fileName}>{attachment.fileName}</strong><span>{formatFileSize(attachment.fileSize)} · {formatUploadedDate(attachment.uploadedDate)} · {attachment.uploadedBy}</span></div>
                <div className="attachment-actions">
                  {isPreviewableAttachment(attachment) && <button type="button" onClick={() => setPreviewAttachment(attachment)} title="Xem file" aria-label={`Xem ${attachment.fileName}`}><EyeIcon /></button>}
                  <a href={getAttachmentContentUrl(attachment.id, true)} title="Tải file" aria-label={`Tải ${attachment.fileName}`}><DownloadIcon size={17} /></a>
                  {canModifyAttachment(attachment) && <button type="button" onClick={() => chooseFile(attachment.id)} title="Thay thế file" aria-label={`Thay thế ${attachment.fileName}`}><ReplaceIcon /></button>}
                  {canModifyAttachment(attachment) && <button className="danger-action" type="button" onClick={() => removeAttachment(attachment)} title="Xóa file" aria-label={`Xóa ${attachment.fileName}`}><TrashIcon /></button>}
                </div>
              </article>
            )) : <div className="attachment-empty"><FileIcon size={30} /><strong>Chưa có file đính kèm</strong><span>Upload giấy tờ, ảnh hoặc tài liệu xác nhận.</span></div>}
          </div>

          {previewAttachment && (
            <div className="attachment-preview">
              <div><strong>{previewAttachment.fileName}</strong><button type="button" onClick={() => setPreviewAttachment(null)} aria-label="Đóng xem trước"><CloseIcon size={16} /></button></div>
              {previewAttachment.fileType === "application/pdf"
                ? <iframe src={getAttachmentContentUrl(previewAttachment.id)} title={previewAttachment.fileName} />
                : <img src={getAttachmentContentUrl(previewAttachment.id)} alt={previewAttachment.fileName} />}
            </div>
          )}
        </section>

        <div className="modal-actions"><button className="button button-secondary" type="button" onClick={onClose}>Đóng</button><button className="button button-primary" type="button" onClick={onEdit}><EditIcon /> Sửa thông tin</button></div>
      </div>
    </div>
  );
}
