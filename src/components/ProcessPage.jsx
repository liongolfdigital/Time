import { useMemo, useRef, useState } from "react";
import {
  AlertIcon,
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  FileIcon,
  FilterIcon,
  SearchIcon,
  TrashIcon,
  UploadIcon,
} from "./Icons";
import { detectBranchFromText, normalizeBranch } from "../branches/branchModel";
import { normalizeEmployeeCode, normalizeLookup, normalizeText } from "../employees/employeeModel";
import {
  downloadProcessedFile,
  mergeProcessedExcelResults,
  processExcelFile,
} from "../excel/excelProcessor";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const EXCEL_EXTENSION = /\.(xlsx|xls)$/i;

function createQueueId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `process-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function makeProcessedFileName(fileName) {
  const baseName = String(fileName ?? "ket_qua").replace(EXCEL_EXTENSION, "");
  return `${baseName}_processed.xlsx`;
}

function getEmployeeFilterKey(employee) {
  return normalizeEmployeeCode(employee.employeeCode) ||
    normalizeLookup(employee.employeeName) ||
    normalizeLookup(employee.id);
}

function getEmployeeBranch(employee) {
  return normalizeBranch(employee.branch) || detectBranchFromText(employee.employeeName);
}

function formatEmployeeBrief(employee) {
  return `${normalizeEmployeeCode(employee.employeeCode) || employee.employeeCode || "Chưa có mã"} - ${employee.employeeName || "Chưa có tên"}`;
}

function validateFile(file) {
  if (!EXCEL_EXTENSION.test(file.name)) return "Chỉ hỗ trợ file Excel .xlsx hoặc .xls.";
  if (file.size > MAX_FILE_SIZE) return "File vượt quá giới hạn 25 MB.";
  return "";
}

const STATUS_LABELS = {
  pending: "Chờ xử lý",
  processing: "Đang xử lý",
  success: "Thành công",
  error: "Có lỗi",
};

/** Trang xử lý hàng loạt dùng nguyên pipeline Excel của màn hình chấm công hiện tại. */
export default function ProcessPage({ employees, diaryEntries, shiftRules }) {
  const inputRef = useRef(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [batchError, setBatchError] = useState("");
  const [batchWarning, setBatchWarning] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [exportMode, setExportMode] = useState("merged");
  const [mergedResult, setMergedResult] = useState(null);
  const [processFilters, setProcessFilters] = useState({
    branches: [],
    employeeIds: [],
    dateFrom: "",
    dateTo: "",
    onlyMatchingRows: true,
  });

  const branchOptions = useMemo(
    () => Array.from(new Set(employees.map(({ branch }) => normalizeBranch(branch)).filter(Boolean)))
      .sort((first, second) => first.localeCompare(second, "vi-VN")),
    [employees],
  );

  const visibleEmployees = useMemo(() => {
    const query = normalizeLookup(employeeSearch);
    if (!query) return employees;
    return employees.filter((employee) =>
      normalizeLookup(`${employee.employeeCode} ${employee.employeeName} ${employee.branch}`).includes(query),
    );
  }, [employeeSearch, employees]);

  const selectedEmployeeRecords = useMemo(() => {
    const selectedKeys = new Set(processFilters.employeeIds);
    if (!selectedKeys.size) return [];
    return employees.filter((employee) => selectedKeys.has(getEmployeeFilterKey(employee)));
  }, [employees, processFilters.employeeIds]);

  const selectedEmployeeCodes = useMemo(() => {
    const codes = [
      ...selectedEmployeeRecords.map((employee) => normalizeEmployeeCode(employee.employeeCode)),
      ...processFilters.employeeIds.map(normalizeEmployeeCode),
    ].filter(Boolean);
    return Array.from(new Set(codes));
  }, [processFilters.employeeIds, selectedEmployeeRecords]);

  const selectedEmployeeBranches = useMemo(() => Array.from(new Set(
    selectedEmployeeRecords.map(getEmployeeBranch).filter(Boolean),
  )).sort((first, second) => first.localeCompare(second, "vi-VN")), [selectedEmployeeRecords]);

  const selectedEmployeesForExport = useMemo(() => selectedEmployeeRecords.map((employee) => ({
    id: employee.id,
    employeeCode: normalizeEmployeeCode(employee.employeeCode) || employee.employeeCode,
    employeeName: normalizeText(employee.employeeName),
    branch: getEmployeeBranch(employee),
  })), [selectedEmployeeRecords]);

  const successfulFiles = selectedFiles.filter(({ status, resultFile }) =>
    status === "success" && resultFile,
  );
  const processableFiles = selectedFiles.filter(({ validationError }) => !validationError);
  const completedCount = selectedFiles.filter(({ status }) => status === "success" || status === "error").length;
  const hasActiveFilters = Boolean(
    processFilters.branches.length ||
    processFilters.employeeIds.length ||
    processFilters.dateFrom ||
    processFilters.dateTo,
  );

  function invalidateResults() {
    setBatchError("");
    setBatchWarning("");
    setMergedResult(null);
    setSelectedFiles((current) => current.map((item) => item.validationError
      ? item
      : {
          ...item,
          status: "pending",
          progress: 0,
          resultFile: null,
          processedMeta: null,
          errorMessage: "",
        },
    ));
  }

  function updateProcessFilters(updater) {
    setProcessFilters((current) => typeof updater === "function" ? updater(current) : updater);
    invalidateResults();
  }

  /** Thêm nhiều file Excel vào hàng đợi, giữ lỗi validation riêng trên từng file. */
  function addSelectedFiles(files) {
    const nextItems = Array.from(files ?? []).map((file) => {
      const validationError = validateFile(file);
      return {
        id: createQueueId(),
        file,
        name: file.name,
        size: file.size,
        status: validationError ? "error" : "pending",
        progress: 0,
        resultFile: null,
        errorMessage: validationError,
        validationError,
      };
    });
    if (nextItems.length) {
      setBatchError("");
      setBatchWarning("");
      setMergedResult(null);
      setSelectedFiles((current) => [
        ...current.map((item) => item.validationError ? item : {
          ...item,
          status: "pending",
          progress: 0,
          resultFile: null,
          processedMeta: null,
        }),
        ...nextItems,
      ]);
    }
  }

  function updateQueueItem(id, updates) {
    setSelectedFiles((current) => current.map((item) =>
      item.id === id ? { ...item, ...updates } : item,
    ));
  }

  function toggleFilterValue(field, value) {
    updateProcessFilters((current) => {
      const values = current[field];
      return {
        ...current,
        [field]: values.includes(value)
          ? values.filter((item) => item !== value)
          : [...values, value],
      };
    });
  }

  function handleExportModeChange(nextMode) {
    setExportMode(nextMode);
    setBatchError("");
    invalidateResults();
  }

  /** Xử lý danh sách file Excel theo hàng đợi để tránh làm trình duyệt bị quá tải. */
  async function handleProcessAllFiles() {
    setBatchError("");
    setBatchWarning("");
    if (processFilters.dateFrom && processFilters.dateTo && processFilters.dateFrom > processFilters.dateTo) {
      setBatchError("Khoảng ngày không hợp lệ: Từ ngày phải trước hoặc bằng Đến ngày.");
      return;
    }

    const effectiveFilters = {
      ...processFilters,
      onlyMatchingRows: exportMode === "merged" ? true : processFilters.onlyMatchingRows,
    };
    console.debug("Selected employees for export", selectedEmployeeCodes);
    const mergedCandidates = [];
    setMergedResult(null);
    setIsProcessing(true);
    try {
      for (const item of selectedFiles) {
        if (item.validationError) continue;
        updateQueueItem(item.id, {
          status: "processing",
          progress: 20,
          resultFile: null,
          errorMessage: "",
        });
        try {
          const result = await processExcelFile(item.file, employees, {
            shiftRules,
            diaryEntries,
            processFilters: effectiveFilters,
            includeProcessedSheet: exportMode === "merged",
          });
          if (exportMode === "merged") mergedCandidates.push(result);
          updateQueueItem(item.id, {
            status: "success",
            progress: 100,
            processedMeta: {
              totalRows: result.totalRows,
              filteredOutRows: result.filteredOutRows,
            },
            resultFile: exportMode === "separate"
              ? { ...result, fileName: makeProcessedFileName(item.name) }
              : null,
          });
        } catch (error) {
          updateQueueItem(item.id, {
            status: "error",
            progress: 0,
            resultFile: null,
            errorMessage: error.message || "Không thể xử lý file Excel này.",
          });
        }
      }
      if (exportMode === "merged") {
        try {
          const nextMergedResult = await mergeProcessedExcelResults(mergedCandidates, {
            processFilters: effectiveFilters,
            selectedEmployees: selectedEmployeesForExport,
          });
          setMergedResult(nextMergedResult);
          if (nextMergedResult.missingEmployees?.length) {
            setBatchWarning(`Không tìm thấy dữ liệu chấm công cho: ${nextMergedResult.missingEmployees.map(formatEmployeeBrief).join(", ")}`);
          }
        } catch (error) {
          setBatchError(error.message || "Không thể tạo file Excel tổng hợp.");
        }
      }
    } finally {
      setIsProcessing(false);
    }
  }

  function handleDownloadAll() {
    successfulFiles.forEach(({ resultFile }, index) => {
      window.setTimeout(() => {
        downloadProcessedFile(resultFile.blob, resultFile.fileName);
      }, index * 180);
    });
  }

  return (
    <main className="process-page" id="top">
      <section className="process-hero">
        <div className="eyebrow">Công cụ hàng loạt</div>
        <h1>Xử lý</h1>
        <p>Tải lên một hoặc nhiều file chấm công để xử lý hàng loạt.</p>
        <div className="process-hero-stats" aria-label="Trạng thái hàng đợi">
          <span><strong>{selectedFiles.length}</strong> file trong hàng đợi</span>
          <span><strong>{completedCount}</strong> file đã hoàn tất</span>
        </div>
      </section>

      <div className="process-layout">
        <section className="workspace-card process-upload-card" aria-labelledby="process-upload-title">
          <div className="card-heading">
            <div>
              <div className="section-number">01</div>
              <div>
                <h2 id="process-upload-title">Chọn file chấm công</h2>
                <p>Có thể chọn hoặc kéo thả nhiều file Excel cùng lúc.</p>
              </div>
            </div>
          </div>

          <div
            className={`dropzone process-dropzone ${isDragging ? "is-dragging" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              if (!isProcessing) setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              if (!isProcessing) addSelectedFiles(event.dataTransfer.files);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              disabled={isProcessing}
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={(event) => {
                addSelectedFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <div className="dropzone-icon"><UploadIcon size={32} /></div>
            <p className="dropzone-title">Kéo thả các file Excel vào đây</p>
            <p className="dropzone-caption">Có thể chọn nhiều file Excel cùng lúc</p>
            <button className="button button-secondary" type="button" disabled={isProcessing} onClick={() => inputRef.current?.click()}>
              <UploadIcon size={17} /> Chọn file Excel
            </button>
            <span className="dropzone-hint">Hỗ trợ .xlsx, .xls · Tối đa 25 MB mỗi file</span>
          </div>
        </section>

        <section className="workspace-card process-filter-card" aria-labelledby="process-filter-title">
          <div className="card-heading">
            <div>
              <div className="section-number"><FilterIcon size={18} /></div>
              <div>
                <h2 id="process-filter-title">Tùy chọn xử lý</h2>
                <p>Không chọn bộ lọc để xử lý toàn bộ dữ liệu như trang hiện tại.</p>
              </div>
            </div>
          </div>

          <div className="process-filter-section">
            <div className="process-filter-label">
              <strong>Chi nhánh</strong>
              <button type="button" onClick={() => updateProcessFilters((current) => ({ ...current, branches: [] }))}>Tất cả</button>
            </div>
            <div className="process-chip-list">
              {branchOptions.map((branch) => (
                <label className={`process-chip ${processFilters.branches.includes(branch) ? "selected" : ""}`} key={branch}>
                  <input type="checkbox" checked={processFilters.branches.includes(branch)} disabled={isProcessing} onChange={() => toggleFilterValue("branches", branch)} />
                  {branch}
                </label>
              ))}
              {!branchOptions.length && <span className="process-filter-empty">Chưa có chi nhánh trong Employees.</span>}
            </div>
          </div>

          <div className="process-filter-section">
            <div className="process-filter-label">
              <strong>Nhân viên <small>{processFilters.employeeIds.length ? `(${processFilters.employeeIds.length} đã chọn)` : "(Tất cả)"}</small></strong>
              <button type="button" onClick={() => updateProcessFilters((current) => ({ ...current, employeeIds: [] }))}>Tất cả</button>
            </div>
            <label className="process-search">
              <SearchIcon size={17} />
              <input value={employeeSearch} disabled={isProcessing} placeholder="Tìm theo mã hoặc tên nhân viên" onChange={(event) => setEmployeeSearch(event.target.value)} />
            </label>
            <div className="process-employee-options">
              {visibleEmployees.map((employee) => {
                const key = getEmployeeFilterKey(employee);
                const checked = processFilters.employeeIds.includes(key);
                return (
                  <label className={checked ? "selected" : ""} key={employee.id || `${employee.employeeCode}-${employee.employeeName}`}>
                    <input type="checkbox" checked={checked} disabled={isProcessing} onChange={() => toggleFilterValue("employeeIds", key)} />
                    <span><strong>{employee.employeeCode || "Chưa có mã"}</strong>{employee.employeeName}</span>
                    <small>{normalizeBranch(employee.branch) || "—"}</small>
                  </label>
                );
              })}
              {!visibleEmployees.length && <span className="process-filter-empty">Không tìm thấy nhân viên phù hợp.</span>}
            </div>
          </div>

          <div className="process-selection-summary" role="status">
            <strong>
              {processFilters.employeeIds.length
                ? `Đã chọn ${processFilters.employeeIds.length} nhân viên thuộc ${selectedEmployeeBranches.length || "chưa rõ"} chi nhánh${selectedEmployeeBranches.length ? `: ${selectedEmployeeBranches.join(", ")}` : ""}`
                : "Chưa chọn nhân viên cụ thể"}
            </strong>
            <span>
              {processFilters.employeeIds.length
                ? `Danh sách chọn được giữ độc lập với ô search. Số file upload: ${selectedFiles.length}.`
                : `Nếu không chọn nhân viên, hệ thống xử lý theo chi nhánh/ngày hoặc toàn bộ dữ liệu. Số file upload: ${selectedFiles.length}.`}
            </span>
          </div>

          <div className="process-date-grid">
            <label className="form-field">
              <span>Từ ngày</span>
              <input type="date" value={processFilters.dateFrom} disabled={isProcessing} onChange={(event) => updateProcessFilters((current) => ({ ...current, dateFrom: event.target.value }))} />
            </label>
            <label className="form-field">
              <span>Đến ngày</span>
              <input type="date" value={processFilters.dateTo} disabled={isProcessing} onChange={(event) => updateProcessFilters((current) => ({ ...current, dateTo: event.target.value }))} />
            </label>
          </div>

          <label className="process-only-match">
            <input type="checkbox" checked={exportMode === "merged" || processFilters.onlyMatchingRows} disabled={isProcessing || exportMode === "merged"} onChange={(event) => updateProcessFilters((current) => ({ ...current, onlyMatchingRows: event.target.checked }))} />
            <span><strong>Chỉ xuất dòng khớp bộ lọc</strong><small>{exportMode === "merged" ? "Luôn bật khi xuất file tổng hợp." : "Tắt tùy chọn này để xử lý toàn bộ file."}</small></span>
          </label>

          <fieldset className="process-export-mode">
            <legend>Kiểu xuất file</legend>
            <label className={exportMode === "merged" ? "selected" : ""}>
              <input type="radio" name="export-mode" value="merged" checked={exportMode === "merged"} disabled={isProcessing} onChange={() => handleExportModeChange("merged")} />
              <span><strong>Xuất 1 file tổng hợp</strong><small>File tổng hợp chỉ chứa dữ liệu khớp bộ lọc đang chọn.</small></span>
            </label>
            <label className={exportMode === "separate" ? "selected" : ""}>
              <input type="radio" name="export-mode" value="separate" checked={exportMode === "separate"} disabled={isProcessing} onChange={() => handleExportModeChange("separate")} />
              <span><strong>Xuất từng file riêng</strong><small>Giữ một kết quả riêng cho mỗi file tải lên.</small></span>
            </label>
          </fieldset>
        </section>
      </div>

      <section className="workspace-card process-queue-card" aria-labelledby="process-queue-title">
        <div className="card-heading">
          <div>
            <div className="section-number">02</div>
            <div>
              <h2 id="process-queue-title">Danh sách file</h2>
              <p>Mỗi file được xử lý độc lập; lỗi ở một file không ảnh hưởng các file còn lại.</p>
            </div>
          </div>
          <button className="button button-secondary" type="button" disabled={!selectedFiles.length || isProcessing} onClick={() => { setBatchError(""); setBatchWarning(""); setMergedResult(null); setSelectedFiles([]); }}>
            <TrashIcon size={17} /> Xóa danh sách
          </button>
        </div>

        {batchError && (
          <div className="alert alert-error" role="alert">
            <AlertIcon size={21} />
            <div><strong>Chưa thể xử lý</strong><span>{batchError}</span></div>
          </div>
        )}
        {batchWarning && (
          <div className="alert alert-warning" role="status">
            <AlertIcon size={21} />
            <div><strong>Cần kiểm tra thêm</strong><span>{batchWarning}</span></div>
          </div>
        )}

        <div className="process-file-list">
          {selectedFiles.map((item) => (
            <article className={`process-file-item status-${item.status}`} key={item.id}>
              <div className="process-file-icon"><FileIcon size={23} /></div>
              <div className="process-file-copy">
                <strong title={item.name}>{item.name}</strong>
                <span>{formatFileSize(item.size)}</span>
                {item.errorMessage && <small className="process-file-error">{item.errorMessage}</small>}
                {(item.processedMeta || item.resultFile) && (
                  <small>
                    {(item.processedMeta || item.resultFile).totalRows} dòng đã xử lý
                    {(item.processedMeta || item.resultFile).filteredOutRows ? ` · ${(item.processedMeta || item.resultFile).filteredOutRows} dòng không khớp đã bỏ qua` : ""}
                  </small>
                )}
              </div>
              <div className="process-file-status">
                {item.status === "processing" && <span className="spinner process-spinner" />}
                {item.status === "success" && <CheckIcon size={16} />}
                {item.status === "error" && <AlertIcon size={16} />}
                <span>{STATUS_LABELS[item.status]}</span>
              </div>
              <div className="process-file-actions">
                {item.resultFile && (
                  <button className="button button-secondary" type="button" onClick={() => downloadProcessedFile(item.resultFile.blob, item.resultFile.fileName)}>
                    <DownloadIcon size={16} /> Tải kết quả
                  </button>
                )}
                <button className="icon-button" type="button" disabled={isProcessing} title="Xóa file" aria-label={`Xóa ${item.name}`} onClick={() => { setBatchError(""); setBatchWarning(""); setMergedResult(null); setSelectedFiles((current) => current.filter(({ id }) => id !== item.id)); }}>
                  <CloseIcon size={18} />
                </button>
              </div>
              {item.status === "processing" && <div className="process-file-progress"><span style={{ width: `${item.progress}%` }} /></div>}
            </article>
          ))}
          {!selectedFiles.length && (
            <div className="process-queue-empty">
              <FileIcon size={30} />
              <strong>Chưa có file trong hàng đợi</strong>
              <span>Chọn một hoặc nhiều file Excel ở khu vực phía trên.</span>
            </div>
          )}
        </div>

        {mergedResult && (
          <div className="process-merged-result" role="status">
            <div className="download-icon"><DownloadIcon size={25} /></div>
            <div>
              <strong>File tổng hợp đã sẵn sàng</strong>
              <span>
                {mergedResult.totalRows} dòng từ {mergedResult.sourceFileCount} file
                {mergedResult.selectedEmployeeCount
                  ? ` · ${mergedResult.exportedEmployeeCount}/${mergedResult.selectedEmployeeCount} nhân viên có dữ liệu · ${mergedResult.missingEmployeeCount} không tìm thấy`
                  : ` · ${mergedResult.exportedEmployeeCount} nhân viên có dữ liệu`}
                {" "}· Có cột “Chi nhánh”, “Nguồn file”
              </span>
              <small>{mergedResult.fileName}</small>
            </div>
            <button className="button button-dark" type="button" onClick={() => downloadProcessedFile(mergedResult.blob, mergedResult.fileName)}>
              <DownloadIcon size={17} /> Tải file tổng hợp
            </button>
          </div>
        )}

        <div className="process-actions">
          <span>
            File gốc luôn được giữ nguyên. {exportMode === "merged"
              ? hasActiveFilters ? "Kết quả tổng hợp chỉ gồm dữ liệu khớp bộ lọc." : "Kết quả tổng hợp gồm dữ liệu từ tất cả file."
              : <>Kết quả riêng dùng hậu tố <strong>_processed.xlsx</strong>.</>}
          </span>
          <div>
            {exportMode === "separate" && successfulFiles.length > 1 && (
              <button className="button button-secondary" type="button" disabled={isProcessing} onClick={handleDownloadAll}>
                <DownloadIcon size={17} /> Tải tất cả
              </button>
            )}
            <button className="button button-primary" type="button" disabled={!processableFiles.length || isProcessing} onClick={handleProcessAllFiles}>
              {isProcessing
                ? <><span className="spinner" /> Đang xử lý hàng đợi...</>
                : exportMode === "merged" ? "Xử lý và xuất file tổng hợp" : "Xử lý từng file"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
