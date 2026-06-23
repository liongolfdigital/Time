/**
 * Modal tạo/sửa Diary, lưu tag vi phạm và chuẩn bị delta attachment cho DiaryPage.
 * File có thể vào từ picker, kéo thả hoặc paste ảnh; component chỉ upload gián tiếp khi submit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CloseIcon,
  DownloadIcon,
  EyeIcon,
  FileIcon,
  TrashIcon,
  UploadIcon,
} from "./Icons";
import {
  createDiaryId,
  DIARY_VIOLATION_OPTIONS,
  EMPTY_DIARY_ENTRY,
  getDiaryWeekday,
  normalizeDiaryEmployeeCode,
  normalizeDiaryViolationTypes,
  sanitizeDiaryEntry,
} from "../diary/diaryModel";
import { normalizeLookup, normalizeText } from "../employees/employeeModel";
import {
  ATTACHMENT_ACCEPT,
  DEFAULT_MAX_ATTACHMENT_SIZE_MB,
  ensureClipboardImageFile,
  getAttachmentContentUrl,
  isPreviewableAttachment,
  validateAttachmentFile,
} from "../diary/attachmentStorage";

// Định dạng dung lượng file chờ lưu hoặc attachment đã có.
function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Định dạng ngày upload theo locale Việt Nam.
function formatUploadedDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
}

// Nhận diện attachment ảnh qua MIME hoặc extension để tạo thumbnail.
function isImageAttachment(item) {
  return String(item?.fileType ?? item?.file?.type ?? "").startsWith("image/")
    || /\.(?:jpe?g|png|webp)$/i.test(String(item?.fileName ?? ""));
}

// Tìm nhân viên theo mã đã normalize, gồm trường hợp mã số có số 0 đầu.
function findEmployeeByCode(employees, value) {
  const code = normalizeDiaryEmployeeCode(value);
  return code
    ? employees.find((employee) => normalizeDiaryEmployeeCode(employee.employeeCode) === code)
    : undefined;
}

// Tìm nhân viên theo tên không phân biệt hoa/thường.
function findEmployeeByName(employees, value) {
  const name = normalizeLookup(value);
  return name
    ? employees.find((employee) => normalizeLookup(employee.employeeName) === name)
    : undefined;
}

// Xác định người lập mặc định từ account, cache cũ hoặc danh sách nhân viên.
function getCurrentUser(employees, account) {
  if (account) {
    return {
      code: account.username || "",
      name: account.fullName || account.username || "Người dùng nội bộ",
    };
  }

  let storedUser = null;
  try {
    const rawUser = localStorage.getItem("timekeeping.currentUser.v1");
    if (rawUser) storedUser = JSON.parse(rawUser);
  } catch {
    storedUser = null;
  }

  const storedName = normalizeText(
    storedUser?.name
      ?? storedUser?.fullName
      ?? localStorage.getItem("timekeeping.attachmentUploader.v1")
      ?? "Người dùng nội bộ",
  );
  const storedCode = normalizeText(storedUser?.code ?? storedUser?.employeeCode);
  const employee = findEmployeeByCode(employees, storedCode)
    ?? findEmployeeByName(employees, storedName);
  return employee
    ? { code: employee.employeeCode, name: employee.employeeName }
    : { code: storedCode, name: storedName };
}

/** Modal tạo/sửa Diary, chọn loại vi phạm và quản lý file chờ upload/xóa khi submit. */
export default function DiaryForm({
  entry,
  employees = [],
  attachments = [],
  currentUser = null,
  fixedBranch = "",
  canRemoveAttachment = () => true,
  maxFileSizeMb = DEFAULT_MAX_ATTACHMENT_SIZE_MB,
  onCancel,
  onSave,
}) {
  // Refs quản lý file picker/object URL/drag depth; state quản lý form, file, preview và submit.
  const fileInputRef = useRef(null);
  const objectUrlsRef = useRef(new Set());
  const dragDepthRef = useRef(0);
  const [formData, setFormData] = useState(EMPTY_DIARY_ENTRY);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState([]);
  const [previewItem, setPreviewItem] = useState(null);
  const [error, setError] = useState("");
  const [attachmentNotice, setAttachmentNotice] = useState("");
  const [isDragActive, setIsDragActive] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Chỉ tính lại người lập mặc định khi account hoặc danh sách nhân viên thay đổi.
  const currentIdentity = useMemo(() => getCurrentUser(employees, currentUser), [currentUser, employees]);

  // Reset form/modal theo entry đang sửa và chi nhánh cố định của Manager.
  useEffect(() => {
    const nextFormData = entry
      ? { ...EMPTY_DIARY_ENTRY, ...entry, ...(fixedBranch ? { branch: fixedBranch } : {}) }
      : {
          ...EMPTY_DIARY_ENTRY,
          branch: fixedBranch,
          creatorCode: currentIdentity.code,
          creatorName: currentIdentity.name,
        };
    setFormData({
      ...nextFormData,
      violationTypes: normalizeDiaryViolationTypes(nextFormData.violationTypes),
    });
    setPendingFiles([]);
    setRemovedAttachmentIds([]);
    setPreviewItem(null);
    setError("");
    setAttachmentNotice("");
    setIsDragActive(false);
    dragDepthRef.current = 0;
  }, [currentIdentity.code, currentIdentity.name, entry, fixedBranch]);

  // Thu hồi mọi object URL preview khi modal unmount để tránh rò bộ nhớ.
  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
  }, []);

  // Cập nhật field; khi đổi ngày sẽ tự suy ra nhãn thứ.
  const changeField = (key, value) => {
    setFormData((current) => ({
      ...current,
      [key]: value,
      ...(key === "date" ? { weekday: getDiaryWeekday(value) } : {}),
    }));
  };

  // Thêm/bỏ một loại ghi chú trong danh sách checkbox đã chuẩn hóa.
  const toggleViolationType = (type) => {
    setFormData((current) => {
      const selected = normalizeDiaryViolationTypes(current.violationTypes);
      const exists = selected.includes(type);
      return {
        ...current,
        violationTypes: exists
          ? selected.filter((item) => item !== type)
          : [...selected, type],
      };
    });
  };

  // Đổi mã và tự điền tên nếu tìm thấy nhân viên.
  const changeEmployeeCode = (value) => {
    const employee = findEmployeeByCode(employees, value);
    setFormData((current) => ({
      ...current,
      employeeCode: value,
      ...(employee ? { employeeName: employee.employeeName } : {}),
    }));
  };

  // Đổi tên và tự điền mã nếu tìm thấy nhân viên.
  const changeEmployeeName = (value) => {
    const employee = findEmployeeByName(employees, value);
    setFormData((current) => ({
      ...current,
      employeeName: value,
      ...(employee ? { employeeCode: employee.employeeCode } : {}),
    }));
  };

  // Đồng bộ tên/mã người lập từ danh sách nhân viên hoặc giữ text nhập tay.
  const changeCreator = (value) => {
    const employee = findEmployeeByName(employees, value)
      ?? findEmployeeByCode(employees, value);
    setFormData((current) => ({
      ...current,
      creatorName: employee?.employeeName ?? value,
      creatorCode: employee?.employeeCode ?? "",
    }));
  };

  // Validate file chọn/drop/paste, tạo object URL và thêm vào hàng đợi submit.
  const handleAttachmentFiles = useCallback((files, source = "picker") => {
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length) return;

    const validationError = selectedFiles
      .map((file) => validateAttachmentFile(file, maxFileSizeMb))
      .find(Boolean);
    if (validationError) {
      setError(validationError);
      setAttachmentNotice("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const additions = selectedFiles.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      objectUrlsRef.current.add(previewUrl);
      return {
        id: `pending-${createDiaryId()}`,
        file,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        previewUrl,
        pending: true,
      };
    });
    setPendingFiles((current) => [...current, ...additions]);
    setError("");
    setAttachmentNotice(
      source === "paste"
        ? "Đã thêm ảnh từ clipboard"
        : source === "drop" ? "Đã thêm file biên bản" : "",
    );
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [maxFileSizeMb]);

  // Bắt ảnh paste toàn cửa sổ trong lúc modal mở và đưa vào cùng pipeline file chờ.
  useEffect(() => {
    const handlePaste = (event) => {
      if (isSaving) return;
      const imageFiles = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => ensureClipboardImageFile(item.getAsFile()))
        .filter(Boolean);
      if (!imageFiles.length) return;

      event.preventDefault();
      handleAttachmentFiles(imageFiles, "paste");
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handleAttachmentFiles, isSaving]);

  // Các handler drag giữ counter để vùng drop không chớp khi đi qua phần tử con.
  const handleDragEnter = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
    dragDepthRef.current += 1;
    setIsDragActive(true);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragActive(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragActive(false);
    if (!isSaving) handleAttachmentFiles(event.dataTransfer?.files, "drop");
  };

  // Xóa file chờ ngay hoặc đánh dấu attachment server để parent xóa sau khi lưu.
  const removeFile = (item) => {
    setAttachmentNotice("");
    if (item.pending) {
      URL.revokeObjectURL(item.previewUrl);
      objectUrlsRef.current.delete(item.previewUrl);
      setPendingFiles((current) => current.filter(({ id }) => id !== item.id));
    } else {
      if (!canRemoveAttachment(item)) {
        setError("Bạn không có quyền truy cập chức năng này");
        return;
      }
      setRemovedAttachmentIds((current) => [...new Set([...current, item.id])]);
    }
    if (previewItem?.id === item.id) setPreviewItem(null);
  };

  // Preview ảnh/PDF trong modal; loại khác mở tab mới.
  const viewFile = (item) => {
    const url = item.pending ? item.previewUrl : getAttachmentContentUrl(item.id);
    if (isPreviewableAttachment(item)) {
      setPreviewItem({ ...item, url });
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  // Validate ngày/nhân viên/lý do rồi trả Diary và delta attachment lên DiaryPage.
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!formData.date) return setError("Vui lòng chọn ngày phát sinh.");
    if (!formData.employeeCode.trim() && !formData.employeeName.trim()) {
      return setError("Cần nhập ít nhất Mã N.Viên hoặc Tên N.Viên.");
    }
    if (!formData.reason.trim()) return setError("Vui lòng nhập lý do.");

    setError("");
    setIsSaving(true);
    try {
      await onSave(
        sanitizeDiaryEntry({
          ...formData,
          ...(fixedBranch ? { branch: fixedBranch } : {}),
          id: entry?.id || createDiaryId(),
        }),
        {
          newFiles: pendingFiles.map(({ file }) => file),
          removedAttachmentIds,
        },
      );
    } catch (saveError) {
      setError(saveError.message || "Không thể lưu dòng Diary.");
    } finally {
      setIsSaving(false);
    }
  };

  const visibleAttachments = [
    ...attachments.filter(({ id }) => !removedAttachmentIds.includes(id)),
    ...pendingFiles,
  ];
  const matchedEmployee = findEmployeeByCode(employees, formData.employeeCode)
    ?? findEmployeeByName(employees, formData.employeeName);
  const creatorOptions = currentIdentity.name && !findEmployeeByName(employees, currentIdentity.name)
    ? [...employees, { id: "current-system-user", employeeCode: currentIdentity.code, employeeName: currentIdentity.name }]
    : employees;
  // Các checkbox lưu tag canonical Đi sớm/Đi trễ/Về sớm/Tăng ca/OFF để pipeline đối chiếu đúng loại.
  const selectedViolationTypes = normalizeDiaryViolationTypes(formData.violationTypes);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={isSaving ? undefined : onCancel}>
      <div className="employee-modal diary-modal" role="dialog" aria-modal="true" aria-labelledby="diary-form-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div><div className="eyebrow">Ghi chú nhân viên</div><h2 id="diary-form-title">{entry ? "Cập nhật Diary" : "Thêm dòng Diary"}</h2></div>
          <button className="icon-button" type="button" disabled={isSaving} onClick={onCancel} aria-label="Đóng"><CloseIcon /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="diary-form-grid">
            <label className="form-field"><span>Ngày</span><input type="date" value={formData.date} onChange={(event) => changeField("date", event.target.value)} /></label>
            <label className="form-field"><span>Thứ</span><input value={formData.weekday} onChange={(event) => changeField("weekday", event.target.value)} placeholder="T2, T3..." /></label>
            <label className="form-field"><span>Mã N.Viên</span><input list="diary-employee-code-options" value={formData.employeeCode} onChange={(event) => changeEmployeeCode(event.target.value)} placeholder="Nhập mã để tìm kiếm" autoComplete="off" /><datalist id="diary-employee-code-options">{employees.map((employee) => <option key={employee.id} value={employee.employeeCode}>{employee.employeeName}</option>)}</datalist></label>
            <label className="form-field"><span>Tên N.Viên</span><input list="diary-employee-name-options" value={formData.employeeName} onChange={(event) => changeEmployeeName(event.target.value)} placeholder="Nhập tên để tìm kiếm" autoComplete="off" /><datalist id="diary-employee-name-options">{employees.map((employee) => <option key={employee.id} value={employee.employeeName}>{employee.employeeCode}</option>)}</datalist></label>
            {matchedEmployee && (matchedEmployee.branch || matchedEmployee.registeredShift) && <div className="employee-lookup-summary form-field-wide"><div><span>Chi nhánh</span><strong>{matchedEmployee.branch || "—"}</strong></div><div><span>Giờ ĐK</span><strong>{matchedEmployee.registeredShift || "—"}</strong></div></div>}
            <label className="form-field"><span>Có / Không phép</span><select value={formData.permission} onChange={(event) => changeField("permission", event.target.value)}><option value="">Chưa xác định</option><option value="Có phép">Có phép</option><option value="Không phép">Không phép</option></select></label>
            <section className="form-field form-field-wide diary-violation-field">
              <span>Loại ghi chú</span>
              <div className="diary-checkbox-grid">
                {DIARY_VIOLATION_OPTIONS.map((type) => {
                  const checked = selectedViolationTypes.includes(type);
                  return (
                    <label className={`diary-checkbox-card ${checked ? "selected" : ""}`} key={type}>
                      <input type="checkbox" checked={checked} onChange={() => toggleViolationType(type)} />
                      <span>{type}</span>
                    </label>
                  );
                })}
              </div>
            </section>
            <label className="form-field form-field-wide"><span>Lý do</span><textarea value={formData.reason} onChange={(event) => changeField("reason", event.target.value)} placeholder="Nhập lý do phát sinh" /></label>
            {/* <label className="form-field form-field-wide"><span>Biên bản</span><textarea value={formData.bienBan} onChange={(event) => changeField("bienBan", event.target.value)} placeholder="Nội dung biên bản (không bắt buộc)" /></label> */}

            <section className="form-field form-field-wide diary-form-files">
              <span>File biên bản</span>
              <input ref={fileInputRef} className="hidden-file-input" type="file" multiple accept={ATTACHMENT_ACCEPT} onChange={(event) => handleAttachmentFiles(event.target.files, "picker")} />
              <div
                className={`form-file-dropzone ${isDragActive ? "is-drag-active" : ""}`}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <span className="form-file-drop-icon"><UploadIcon size={23} /></span>
                <div className="form-file-drop-copy">
                  <strong>{isDragActive ? "Thả file để thêm biên bản" : "Kéo thả file vào đây, paste ảnh hoặc bấm Chọn file"}</strong>
                  <small>Hỗ trợ JPG, JPEG, PNG, WEBP, PDF, DOC, DOCX, XLS, XLSX; tối đa {maxFileSizeMb}MB/file.</small>
                </div>
                <button className="button button-secondary" type="button" disabled={isSaving} onClick={() => fileInputRef.current?.click()}><UploadIcon size={17} /> Chọn file</button>
              </div>
              {attachmentNotice && <div className="attachment-feedback" role="status">{attachmentNotice}</div>}

              <div className="attachment-list form-file-list">
                {visibleAttachments.length ? visibleAttachments.map((item) => (
                  <article className="attachment-item" key={item.id}>
                    <span className={`attachment-file-icon ${item.pending && isImageAttachment(item) ? "has-thumbnail" : ""}`}>
                      {item.pending && isImageAttachment(item)
                        ? <img src={item.previewUrl} alt="" />
                        : <FileIcon size={22} />}
                    </span>
                    <div className="attachment-meta">
                      <strong title={item.fileName}>{item.fileName}</strong>
                      <span>{item.pending ? `Chờ lưu · ${formatFileSize(item.fileSize)}` : `${formatFileSize(item.fileSize)} · ${formatUploadedDate(item.uploadedDate)} · ${item.uploadedBy}`}</span>
                    </div>
                    <div className="attachment-actions">
                      <button type="button" onClick={() => viewFile(item)} title="Xem file" aria-label={`Xem ${item.fileName}`}><EyeIcon /></button>
                      <a href={item.pending ? item.previewUrl : getAttachmentContentUrl(item.id, true)} download={item.pending ? item.fileName : undefined} title="Tải xuống" aria-label={`Tải ${item.fileName}`}><DownloadIcon size={17} /></a>
                      {(item.pending || canRemoveAttachment(item)) && <button className="danger-action" type="button" onClick={() => removeFile(item)} title="Xóa file" aria-label={`Xóa ${item.fileName}`}><TrashIcon /></button>}
                    </div>
                  </article>
                )) : <div className="attachment-empty compact"><FileIcon size={27} /><strong>Chưa chọn file biên bản</strong><span>Có thể lưu Diary mà không cần file.</span></div>}
              </div>

              {previewItem && (
                <div className="attachment-preview">
                  <div><strong>{previewItem.fileName}</strong><button type="button" onClick={() => setPreviewItem(null)} aria-label="Đóng xem trước"><CloseIcon size={16} /></button></div>
                  {previewItem.fileType === "application/pdf"
                    ? <iframe src={previewItem.url} title={previewItem.fileName} />
                    : <img src={previewItem.url} alt={previewItem.fileName} />}
                </div>
              )}
            </section>
            <label className="form-field form-field-wide creator-field"><span>Người lập biên bản</span><input list="diary-creator-options" value={formData.creatorName} onChange={(event) => changeCreator(event.target.value)} placeholder="Chọn hoặc nhập người lập" autoComplete="off" /><datalist id="diary-creator-options">{creatorOptions.map((employee) => <option key={employee.id || `${employee.employeeCode}-${employee.employeeName}`} value={employee.employeeName}>{employee.employeeCode}</option>)}</datalist><small>{formData.creatorCode ? `Mã người lập: ${formData.creatorCode}` : "Có thể chọn từ danh sách nhân viên hoặc nhập tài khoản hệ thống."}</small></label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button className="button button-secondary" type="button" disabled={isSaving} onClick={onCancel}>Hủy</button>
            <button className="button button-primary" type="submit" disabled={isSaving}>
              {isSaving ? "Đang lưu..." : "Lưu"}
              {/* {isSaving ? "Đang lưu..." : entry ? "Lưu" : "Lưu"} */}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
