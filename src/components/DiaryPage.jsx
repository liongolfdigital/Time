/**
 * Màn hình quản lý Diary: phân quyền theo chi nhánh, search/filter, CRUD/bulk delete,
 * import/export và liên kết file biên bản trước khi mở form hoặc chi tiết.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import DiaryDetails from "./DiaryDetails";
import DiaryForm from "./DiaryForm";
import { AlertIcon, BookIcon, DownloadIcon, EditIcon, EyeIcon, FilterIcon, PlusIcon, SearchIcon, TrashIcon, UploadIcon } from "./Icons";
import { exportDiaryToExcel, importDiaryFromExcel } from "../diary/diaryExcel";
import { deleteDiaryAttachment, uploadDiaryAttachment } from "../diary/attachmentStorage";
import { DIARY_FIELDS, DIARY_VIOLATION_OPTIONS, formatDiaryDate, formatDiaryViolationTypes, hasDiaryAttachments, mergeDiaryEntries, normalizeDiaryDate, 
  normalizeDiaryViolationTypes, sanitizeDiaryEntry, sortDiaryEntries } from "../diary/diaryModel";
import {
  confirmAndDeleteSelectedDiaries,
  getDiaryBulkDeleteLabel,
  getVisibleDiarySelectionState,
  toggleAllVisibleDiarySelection,
  toggleDiarySelection,
} from "../diary/diarySelection";
import { normalizeLookup } from "../employees/employeeModel";
import { canDeleteDiaryEntry, canImportExportDiary, canManageDiaryEntry, canModifyAttachment, filterDiaryEntriesForUser, filterEmployeesForUser,
  getDiaryEntryBranch, isManager } from "../auth/authorization";
import { isApiUnavailableError } from "../api/apiClient";
import { diaryApi } from "../api/diaryApi";

// Định dạng ngày attachment ngắn gọn cho cell bảng Diary.
function formatAttachmentDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("vi-VN");
}
// Render các loại vi phạm thành tag màu, dùng style riêng cho OFF.
function renderViolationTags(value, emptyText = "—") {
  const types = normalizeDiaryViolationTypes(value);
  if (!types.length) return <span className="empty-cell">{emptyText}</span>;
  return (
    <div className="diary-tag-list">
      {types.map((type) => <span className={`diary-tag ${type === "OFF" ? "diary-tag-off" : ""}`} key={type}>{type}</span>)}
    </div>
  );
}
/**
 * ============================================
 * DIARY PAGE
 * ============================================
 * Module quản lý ghi chú nhân viên
 *
 * Chức năng:
 * - Thêm / Sửa / Xóa Diary
 * - Upload hồ sơ đính kèm
 * - Import Excel
 * - Export Excel
 * - Phân quyền theo chi nhánh
 * - Lọc dữ liệu
 *
 * Data Flow:
 * API -> entries
 * API -> attachments
 * DiaryPage -> DiaryForm
 * DiaryPage -> DiaryDetails
 */
export default function DiaryPage({ // input data
  currentUser, employees, entries, attachments, attachmentConfig, 
  attachmentError, onEntriesChange, onAttachmentsChange, onLogAction,
}) {
  // State thao tác import, modal form/detail, thông báo và các tiêu chí lọc.
  const importInputRef = useRef(null);
  const selectAllCheckboxRef = useRef(null);
  const [message, setMessage] = useState(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  // Lưu ID thật của các Diary được tick; selection vẫn giữ khi search/filter thay đổi.
  const [selectedDiaryIds, setSelectedDiaryIds] = useState([]);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);

  // ============================================
  // SEARCH & FILTER STATES

  // Từ khóa tìm kiếm
  const [search, setSearch] = useState(""); 
  // Lọc theo ngày
  const [dateFilter, setDateFilter] = useState(""); 
  // Lọc theo tháng
  const [monthFilter, setMonthFilter] = useState(""); 
  // Lọc theo nhân viên
  const [employeeFilter, setEmployeeFilter] = useState("");
  // Có phép / Không phép
  const [permissionFilter, setPermissionFilter] = useState(""); 
  // Loại vi phạm
  const [violationFilter, setViolationFilter] = useState(""); 

  // Entry đang sửa và ID entry đang mở modal chi tiết.
  const [editingEntry, setEditingEntry] = useState(undefined);
  const [selectedEntryId, setSelectedEntryId] = useState("");

  // ============================================
  // PERMISSION CHECK

  // Quyền import/export excel
  const allowImportExport = canImportExportDiary(currentUser);
  // Quyền xóa diary
  const allowDeleteEntry = canDeleteDiaryEntry(currentUser);

  // ============================================
  // EMPLOYEE LIST AFTER AUTHORIZATION
  // Admin: thấy toàn bộ nhân viên
  // Manager: chỉ thấy nhân viên chi nhánh mình
  const visibleEmployees = useMemo(
    () => filterEmployeesForUser(employees, currentUser),
    [currentUser, employees],
  );

  // ============================================
  // ATTACH ATTACHMENTS TO DIARY ENTRY
  const enrichedEntries = useMemo(() => entries.map((entry) => {
    const entryAttachments = attachments.filter(({ diaryEntryId }) => diaryEntryId === entry.id);
    const branch = getDiaryEntryBranch(entry, employees);
    return {
      ...entry,
      branch: entry.branch || branch,
      attachments: entryAttachments,
      attachedFiles: entryAttachments,
    };
  }), [attachments, employees, entries]);

  // Lọc Diary đã gắn attachment theo phạm vi chi nhánh của user.
  const visibleEntries = useMemo(
    () => filterDiaryEntriesForUser(enrichedEntries, employees, currentUser),
    [currentUser, employees, enrichedEntries],
  );

  const selectedEntry = visibleEntries.find(({ id }) => id === selectedEntryId);

  // Dựng danh sách nhân viên xuất hiện trong Diary cho select filter.
  const employeeOptions = useMemo(() => {
    const options = new Map();
    visibleEntries.forEach((entry) => {
      const key = entry.employeeCode ? `code:${normalizeLookup(entry.employeeCode)}` : `name:${normalizeLookup(entry.employeeName)}`;
      const label = [entry.employeeCode, entry.employeeName].filter(Boolean).join(" - ");
      if (label && !options.has(key)) options.set(key, label);
    });
    return Array.from(options, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "vi"));
  }, [visibleEntries]);

  // Áp filter rồi sort theo ngày phát sinh Diary; createdAt chỉ phân xử các dòng cùng ngày.
  const filteredEntries = useMemo(() => {
    const term = normalizeLookup(search);
    const matches = visibleEntries.filter((entry) => {
      const employeeKey = entry.employeeCode ? `code:${normalizeLookup(entry.employeeCode)}` : `name:${normalizeLookup(entry.employeeName)}`;
      const violationTypes = normalizeDiaryViolationTypes(entry.violationTypes);
      const matchesSearch = !term || [entry.employeeCode, entry.employeeName, entry.date, formatDiaryDate(entry.date), entry.reason, entry.bienBan, entry.branch, formatDiaryViolationTypes(violationTypes)].some((value) => normalizeLookup(value).includes(term));
      return matchesSearch &&
        (!dateFilter || normalizeDiaryDate(entry.date) === dateFilter) &&
        (!monthFilter || normalizeDiaryDate(entry.date).startsWith(monthFilter)) &&
        (!employeeFilter || employeeKey === employeeFilter) &&
        (!permissionFilter || entry.permission === permissionFilter) &&
        (!violationFilter || violationTypes.includes(violationFilter));
    });
    return sortDiaryEntries(matches);
  }, [dateFilter, employeeFilter, monthFilter, permissionFilter, search, violationFilter, visibleEntries]);

  const visibleDiaryIds = useMemo(
    () => filteredEntries.map(({ id }) => id).filter(Boolean),
    [filteredEntries],
  );
  const visibleSelectionState = useMemo(
    () => getVisibleDiarySelectionState(selectedDiaryIds, visibleDiaryIds),
    [selectedDiaryIds, visibleDiaryIds],
  );

  // Đồng bộ trạng thái indeterminate vì đây là DOM property, không phải JSX attribute.
  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = visibleSelectionState.someSelected;
    }
  }, [visibleSelectionState.someSelected]);

  // Ghi số lượng Diary sau phân quyền/filter trong development để hỗ trợ audit.
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.debug("[TimeKeeping data] diary:filter", {
        currentUser,
        role: currentUser?.role,
        branch: currentUser?.branch,
        rawDiary: entries.length,
        visibleDiary: visibleEntries.length,
        filteredDiary: filteredEntries.length,
      });
    }
  }, [currentUser, entries.length, filteredEntries.length, visibleEntries.length]);

  // Lưu Diary trước, sau đó upload/xóa attachment; rollback file mới nếu bước sau lỗi.
  const saveEntry = async (entry, { newFiles = [], removedAttachmentIds = [] } = {}) => {
    const existing = entries.find(({ id }) => id === entry.id);
    const now = new Date().toISOString();
    const resolvedBranch = getDiaryEntryBranch(entry, employees) || (isManager(currentUser) ? currentUser.branch : "");
    const entryWithBranch = { ...entry, branch: resolvedBranch };

    if (!canManageDiaryEntry(currentUser, entryWithBranch, employees)) {
      throw new Error("Bạn không có quyền truy cập dữ liệu chi nhánh này");
    }

    const sanitized = sanitizeDiaryEntry({
      ...entryWithBranch,
      createdAt: existing?.createdAt || entry.createdAt || now,
      updatedAt: now,
    });

    const uploadedAttachments = [];
    const uploadedBy = currentUser.fullName
      || sanitized.creatorName
      || sanitized.employeeName
      || sanitized.employeeCode
      || "Người dùng nội bộ";

    let savedEntry;
    let usingLocalDiaryApi = false;
    try {
      savedEntry = editingEntry ? await diaryApi.update(sanitized) : await diaryApi.create(sanitized);
    } catch (error) {
      if (!isApiUnavailableError(error)) throw error;
      console.warn("[TimeKeeping data] Diary API unavailable, saving to localStorage cache.", {
        endpoint: error.endpoint,
        status: error.status,
        message: error.message,
      });
      savedEntry = sanitized;
      usingLocalDiaryApi = true;
    }

    try {
      if (!usingLocalDiaryApi) {
        for (const file of newFiles) {
          uploadedAttachments.push(await uploadDiaryAttachment({
            diaryEntryId: savedEntry.id,
            file,
            uploadedBy,
            branch: savedEntry.branch,
          }));
        }
      }

      const removableIds = removedAttachmentIds.filter((id) => {
        const attachment = attachments.find((item) => item.id === id);
        return canModifyAttachment(currentUser, attachment);
      });
      if (!usingLocalDiaryApi) {
        await Promise.all(removableIds.map(deleteDiaryAttachment));
      }

      const nextEntries = editingEntry
        ? entries.map((item) => item.id === savedEntry.id ? savedEntry : item) : [...entries, savedEntry];
      const nextAttachments = [
        ...attachments.filter(({ id }) => !removableIds.includes(id)),
        ...uploadedAttachments,
      ];
      onEntriesChange(nextEntries);
      onAttachmentsChange(nextAttachments);
      setIsFormOpen(false);
      setEditingEntry(undefined);
      setSelectedEntryId(editingEntry ? savedEntry.id : "");
      setMessage({
        type: "success",
        text: `Dữ liệu Diary đã được cập nhật${uploadedAttachments.length ? ` cùng ${uploadedAttachments.length} file biên bản` : ""}${usingLocalDiaryApi && newFiles.length ? ". API file đính kèm chưa sẵn sàng, vui lòng upload lại sau khi server được khởi động đúng." : ""}.`,
      });
      onLogAction?.(editingEntry ? "diary.update.ui" : "diary.create.ui", {
        targetType: "diary",
        targetId: savedEntry.id,
        detail: {
          employeeCode: savedEntry.employeeCode,
          employeeName: savedEntry.employeeName,
          branch: savedEntry.branch,
          uploadedCount: uploadedAttachments.length,
          removedAttachmentCount: removableIds.length,
        },
      });
    } catch (error) {
      await Promise.allSettled(uploadedAttachments.map(({ id }) => deleteDiaryAttachment(id)));
      throw error;
    }
  };

  // Cập nhật updatedAt local sau khi attachment của Diary thay đổi.
  const touchEntry = (entryId) => {
    const updatedAt = new Date().toISOString();
    onEntriesChange(entries.map((entry) => entry.id === entryId ? { ...entry, updatedAt } : entry));
  };

  /** Tick hoặc bỏ tick một dòng Diary bằng ID database/API. */
  const toggleSelectDiary = (id) => {
    setSelectedDiaryIds((current) => toggleDiarySelection(current, id));
  };

  /** Chọn/bỏ chọn toàn bộ Diary đang hiển thị, không tác động các dòng bị filter ẩn. */
  const toggleSelectAllVisible = () => {
    setSelectedDiaryIds((current) => toggleAllVisibleDiarySelection(current, visibleDiaryIds));
  };

  /** Gọi API bulk delete; chỉ fallback xóa cache local khi endpoint server không sẵn sàng. */
  const requestDeleteDiaryIds = async (ids) => {
    try {
      return await diaryApi.removeMany(ids);
    } catch (error) {
      if (!isApiUnavailableError(error)) throw error;
      console.warn("[TimeKeeping data] Diary bulk delete API unavailable, deleting from localStorage cache.", {
        endpoint: error.endpoint,
        status: error.status,
        message: error.message,
      });
      return { deletedCount: ids.length, deletedIds: ids, localOnly: true };
    }
  };

  /** Đồng bộ entries, attachment, modal chi tiết và selection sau khi server xóa thành công. */
  const applyDeletedDiaryIds = (deletedIds) => {
    const deletedSet = new Set(deletedIds);
    onAttachmentsChange(attachments.filter(({ diaryEntryId }) => !deletedSet.has(diaryEntryId)));
    onEntriesChange(entries.filter(({ id }) => !deletedSet.has(id)));
    setSelectedDiaryIds((current) => current.filter((id) => !deletedSet.has(id)));
    if (deletedSet.has(selectedEntryId)) setSelectedEntryId("");
  };

  // Xác nhận và xóa Diary cùng attachment khi user có quyền, rồi ghi audit.
  const deleteEntry = async (entry) => {
    if (!allowDeleteEntry) {
      setMessage({ type: "error", text: "Bạn không có quyền truy cập chức năng này" });
      return;
    }

    if (!window.confirm(`Xóa ghi chú Diary ngày ${formatDiaryDate(entry.date)} của ${entry.employeeName || entry.employeeCode} và toàn bộ file đính kèm?`)) return;
    setMessage(null);
    try {
      const result = await requestDeleteDiaryIds([entry.id]);
      if (!result.deletedIds?.includes(entry.id)) throw new Error("Không tìm thấy dòng Diary cần xóa.");
      applyDeletedDiaryIds(result.deletedIds);
      setMessage({ type: "success", text: "Đã xóa dòng Diary và hồ sơ đính kèm." });
      onLogAction?.("diary.delete.ui", {
        targetType: "diary",
        targetId: entry.id,
        detail: { employeeCode: entry.employeeCode, employeeName: entry.employeeName, branch: entry.branch },
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  };

  /** Xác nhận và xóa toàn bộ Diary đang chọn; lỗi API sẽ giữ nguyên selection để thử lại. */
  const handleDeleteSelectedDiaries = async () => {
    if (!allowDeleteEntry || !selectedDiaryIds.length) return;
    setMessage(null);
    setIsDeletingSelected(true);
    try {
      const requestedCount = selectedDiaryIds.length;
      const result = await confirmAndDeleteSelectedDiaries(selectedDiaryIds, {
        confirmDelete: (count) => window.confirm(
          `Bạn có chắc muốn xóa ${count} ghi chú Diary đã chọn không? Hành động này không thể hoàn tác.`,
        ),
        deleteMany: requestDeleteDiaryIds,
      });
      if (!result.confirmed) return;

      applyDeletedDiaryIds(result.deletedIds);
      const failedCount = requestedCount - result.deletedCount;
      setMessage(failedCount > 0
        ? { type: "error", text: `Đã xóa ${result.deletedCount} ghi chú Diary; ${failedCount} dòng chưa xóa được và vẫn được chọn.` }
        : { type: "success", text: `Đã xóa ${result.deletedCount} ghi chú Diary` });
      onLogAction?.("diary.bulk_delete.ui", {
        targetType: "diary",
        detail: { ids: result.deletedIds, deletedCount: result.deletedCount },
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message || "Không thể xóa các ghi chú Diary đã chọn." });
    } finally {
      setIsDeletingSelected(false);
    }
  };

  // Import Diary.xlsx, ép scope Manager, merge và bulk-save qua API hoặc cache fallback.
  const handleImport = async (file) => {
    if (!file) return;
    if (!allowImportExport) {
      setMessage({ type: "error", text: "Bạn không có quyền truy cập chức năng này" });
      return;
    }

    setMessage(null);
    setIsImporting(true);
    try {
      const imported = await importDiaryFromExcel(file);
      const scopedImported = isManager(currentUser)
        ? imported.map((entry) => sanitizeDiaryEntry({ ...entry, branch: currentUser.branch }))
        : imported;
      const currentScope = isManager(currentUser) ? visibleEntries : entries;
      const merged = mergeDiaryEntries(currentScope, scopedImported);
      let savedEntries;
      try {
        savedEntries = await diaryApi.replaceAll(merged);
      } catch (error) {
        if (!isApiUnavailableError(error)) throw error;
        console.warn("[TimeKeeping data] Diary bulk API unavailable, importing to localStorage cache.", {
          endpoint: error.endpoint,
          status: error.status,
          message: error.message,
        });
        savedEntries = merged;
      }
      onEntriesChange(savedEntries);
      setMessage({ type: "success", text: `Đã import ${imported.length} dòng. File đính kèm cần được upload riêng trên trang Diary.` });
      onLogAction?.("diary.import.ui", {
        targetType: "diary",
        detail: {
          importedCount: imported.length,
          totalCount: savedEntries.length,
          branch: isManager(currentUser) ? currentUser.branch : "ALL",
        },
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setIsImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  // Lấy tập Diary export đúng scope từ API, gắn attachment và tải file Excel.
  const handleExport = async () => {
    if (!allowImportExport) {
      setMessage({ type: "error", text: "Bạn không có quyền truy cập chức năng này" });
      return;
    }

    setMessage(null);
    try {
      let exportEntries;
      try {
        const serverEntries = await diaryApi.listForExport();
        exportEntries = serverEntries.map((entry) => {
          const entryAttachments = attachments.filter(({ diaryEntryId }) => diaryEntryId === entry.id);
          return {
            ...entry,
            attachments: entryAttachments,
            attachedFiles: entryAttachments,
          };
        });
      } catch (error) {
        if (!isApiUnavailableError(error)) throw error;
        exportEntries = visibleEntries;
      }
      await exportDiaryToExcel(exportEntries);
      onLogAction?.("diary.export", {
        targetType: "diary",
        detail: {
          exportedCount: exportEntries.length,
          branch: isManager(currentUser) ? currentUser.branch : "ALL",
        },
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  };

  // Render cell theo type field: ngày, trạng thái hồ sơ, tag vi phạm hoặc metadata file.
  const renderCell = (entry, field) => {
    if (field.type === "date") return formatDiaryDate(entry[field.key]);
    if (field.type === "attachmentStatus") {
      return <span className={`attachment-status ${hasDiaryAttachments(entry) ? "has-files" : "no-files"}`}>{hasDiaryAttachments(entry) ? "Có" : "Không"}</span>;
    }
    if (field.type === "violationTypes") return renderViolationTags(entry[field.key]);
    if (field.type === "attachments") {
      const firstAttachment = entry.attachments[0];
      return firstAttachment ? (
        <div className="attachment-cell"><strong>{firstAttachment.fileName}</strong><span>{formatAttachmentDate(firstAttachment.uploadedDate)} · {firstAttachment.uploadedBy}{entry.attachments.length > 1 ? ` · +${entry.attachments.length - 1} file` : ""}</span></div>
      ) : <span className="empty-cell">Chưa có hồ sơ</span>;
    }
    return entry[field.key] || <span className="empty-cell">—</span>;
  };

  // Tạo title hover cho cell, bỏ attachment và format riêng danh sách vi phạm.
  const getCellTitle = (entry, field) => {
    if (field.type === "attachments") return undefined;
    if (field.type === "violationTypes") return formatDiaryViolationTypes(entry[field.key]);
    return String(entry[field.key] ?? "");
  };

  return (
    <main className="employee-page diary-page">
      <section className="page-intro">
        <div><div className="eyebrow">Dữ liệu đối chiếu chấm công</div><h1>Diary <span>/ Ghi chú nhân viên</span></h1><p>Lưu lý do phát sinh và hồ sơ chứng minh trên server để đối chiếu tự động khi xử lý chấm công.</p></div>
        <div className="employee-stat"><span className="employee-stat-icon"><BookIcon size={24} /></span><div><strong>{visibleEntries.length.toLocaleString("vi-VN")}</strong><span>dòng Diary đã lưu</span></div></div>
      </section>

      <section className="employee-card">
        <div className="employee-toolbar">
          <div className="toolbar-actions">
            <input ref={importInputRef} className="hidden-file-input" type="file" aria-hidden="true" tabIndex={-1} accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => handleImport(event.target.files?.[0])} />
            {allowImportExport && (
              <>
                <button className="button button-secondary" type="button" disabled={isImporting} onClick={() => importInputRef.current?.click()}><UploadIcon size={18} />{isImporting ? "Đang import..." : "Import Diary.xlsx"}</button>
                <button className="button button-secondary" type="button" onClick={handleExport}><DownloadIcon size={18} /> Export Excel</button>
              </>
            )}
            <button className="button button-primary" type="button" onClick={() => { setEditingEntry(undefined); setIsFormOpen(true); }}><PlusIcon size={18} /> Thêm ghi chú</button>
            {allowDeleteEntry && (
              <button
                className="button button-secondary diary-bulk-delete"
                type="button"
                disabled={!selectedDiaryIds.length || isDeletingSelected}
                onClick={handleDeleteSelectedDiaries}
              >
                <TrashIcon size={18} />
                {getDiaryBulkDeleteLabel(selectedDiaryIds.length, isDeletingSelected)}
              </button>
            )}
          </div>
          <div className="employee-filters diary-filters">
            <label className="search-field"><SearchIcon size={18} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm mã, tên, ngày, lý do..." />
            </label>
            <label className="select-field date-field"><FilterIcon size={17} />
              <input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} title="Lọc theo ngày" /></label>
            <label className="select-field date-field"><FilterIcon size={17} />
              <input type="month" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)} title="Lọc theo tháng" />
            </label>
            <label className="select-field"><FilterIcon size={17} />
              <select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}>
                <option value="">Tất cả nhân viên</option>{employeeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="select-field"><FilterIcon size={17} />
              <select value={permissionFilter} onChange={(event) => setPermissionFilter(event.target.value)}>
                <option value="">Có phép / Không phép</option>
                <option value="Có phép">Có phép</option>
                <option value="Không phép">Không phép</option>
              </select>
            </label>
            <label className="select-field"><FilterIcon size={17} />
              <select value={violationFilter} onChange={(event) => setViolationFilter(event.target.value)}>
                <option value="">Tất cả loại ghi chú</option>
                {DIARY_VIOLATION_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
          </div>
        </div>

        {(message || attachmentError) && 
          <div className={`alert ${(message?.type === "error" || attachmentError) ? "alert-error" : "alert-success"}`} role="status">
            <AlertIcon size={20} />
            <div>
              <strong>{(message?.type === "error" || attachmentError) ? "Không thể thực hiện" : "Đã lưu dữ liệu"}</strong>
              <span>{attachmentError || message?.text}</span>
            </div>
          </div>
        }
        <div className="employee-table-meta">
          <span>Hiển thị <strong>{filteredEntries.length}</strong> / {visibleEntries.length} dòng</span>
          {selectedDiaryIds.length > 0 && <span className="diary-selection-meta">Đã chọn <strong>{selectedDiaryIds.length}</strong> ghi chú</span>}
          <span>{isManager(currentUser) ? `Manager chỉ thao tác dữ liệu Diary thuộc chi nhánh ${currentUser.branch}` : "Ghi chú được lưu qua API có kiểm tra phân quyền"}</span>
        </div>
        <div className="employee-table-shell diary-table-shell">
          <table className="employee-table diary-table">
            <thead><tr>
              {allowDeleteEntry && (
                <th className="diary-selection-column">
                  <input
                    ref={selectAllCheckboxRef}
                    type="checkbox"
                    checked={visibleSelectionState.allSelected}
                    disabled={!visibleDiaryIds.length || isDeletingSelected}
                    onChange={toggleSelectAllVisible}
                    aria-label="Chọn tất cả Diary đang hiển thị"
                  />
                </th>
              )}
              <th className="index-column">STT</th>
              {DIARY_FIELDS.map(({ label }) => <th key={label}>{label}</th>)}
              <th className="actions-column">Thao tác</th>
            </tr></thead>
            <tbody>
              {filteredEntries.length ? filteredEntries.map((entry, index) => (
                <tr className={`diary-clickable-row ${selectedDiaryIds.includes(entry.id) ? "is-selected" : ""}`} key={entry.id} onClick={() => setSelectedEntryId(entry.id)}>
                  {allowDeleteEntry && (
                    <td className="diary-selection-column" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedDiaryIds.includes(entry.id)}
                        disabled={isDeletingSelected}
                        onChange={() => toggleSelectDiary(entry.id)}
                        aria-label={`Chọn Diary của ${entry.employeeName || entry.employeeCode}`}
                      />
                    </td>
                  )}
                  <td className="index-column">{index + 1}</td>
                  {DIARY_FIELDS.map((field) => <td key={field.key} title={getCellTitle(entry, field)}>{renderCell(entry, field)}</td>)}
                  <td className="actions-column">
                    <div className="row-actions">
                      <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedEntryId(entry.id); }} aria-label={`Xem ${entry.employeeName}`}>
                        <EyeIcon />
                      </button> 
                      <button type="button" onClick={(event) => { event.stopPropagation(); setEditingEntry(entry); setIsFormOpen(true); }} aria-label={`Sửa ${entry.employeeName}`}>
                        <EditIcon />
                      </button>
                      {allowDeleteEntry && 
                        <button className="danger-action" type="button" onClick={(event) => { event.stopPropagation(); deleteEntry(entry); }} aria-label={`Xóa ${entry.employeeName}`}>
                          <TrashIcon />
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              )) : <tr>
                <td className="employee-empty" colSpan={DIARY_FIELDS.length + (allowDeleteEntry ? 3 : 2)}>
                  <BookIcon size={30} />
                  <strong>{visibleEntries.length ? "Không có kết quả phù hợp" : "Chưa có dữ liệu Diary"}</strong>
                  <span>{allowImportExport ? "Import Dairy.xlsx hoặc thêm ghi chú mới." : "Bạn chỉ thấy Diary thuộc chi nhánh được phân quyền."}</span>
                </td>
              </tr>}
            </tbody>
          </table>
        </div>
      </section>

      {isFormOpen && 
        <DiaryForm 
          entry={editingEntry} 
          employees={visibleEmployees} 
          attachments={editingEntry?.attachments ?? []} 
          currentUser={currentUser} fixedBranch={isManager(currentUser) ? currentUser.branch : ""} 
          canRemoveAttachment={(attachment) => canModifyAttachment(currentUser, attachment)} 
          maxFileSizeMb={attachmentConfig.maxFileSizeMb} 
          onCancel={() => { setIsFormOpen(false); setEditingEntry(undefined); }} onSave={saveEntry} />}
      {selectedEntry && !isFormOpen && 
        <DiaryDetails 
          entry={selectedEntry} 
          attachments={selectedEntry.attachments} 
          currentUser={currentUser} 
          canModifyAttachment={(attachment) => canModifyAttachment(currentUser, attachment)} 
          maxFileSizeMb={attachmentConfig.maxFileSizeMb} 
          onClose={() => setSelectedEntryId("")} 
          onEdit={() => { setEditingEntry(selectedEntry); setSelectedEntryId(""); setIsFormOpen(true); }} 
          onEntryTouched={() => touchEntry(selectedEntry.id)} 
          onAttachmentsChange={(nextEntryAttachments) => onAttachmentsChange([...attachments.filter(({ diaryEntryId }) => diaryEntryId !== selectedEntry.id), ...nextEntryAttachments])} />}
    </main>
  );
}
