import { useState } from "react";
import FileDropzone from "./FileDropzone";
import PreviewTable from "./PreviewTable";
import { AlertIcon, BookIcon, CheckIcon, CloseIcon, DownloadIcon, UsersIcon } from "./Icons";
import { downloadProcessedFile, OUTPUT_FILE_NAME, processExcelFile } from "../excel/excelProcessor";

const MAX_FILE_SIZE = 25 * 1024 * 1024;

/** Màn hình upload, xử lý, preview và tải file chấm công đã đối chiếu nhân viên/Diary. */
export default function AttendancePage({ employees, diaryEntries, shiftRules, onOpenEmployees, onOpenDiary }) {
  // selectedFile/result điều khiển ba bước xử lý; error/isProcessing điều khiển phản hồi UI.
  const [selectedFile, setSelectedFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Validate extension/dung lượng trước khi lưu file người dùng chọn vào state.
  const handleFileSelect = (file) => {
    setError("");
    setResult(null);

    if (!file.name.toLocaleLowerCase().endsWith(".xlsx")) {
      setSelectedFile(null);
      setError("Định dạng không hợp lệ. Vui lòng chọn file Excel .xlsx.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setSelectedFile(null);
      setError("File vượt quá 25 MB. Vui lòng chọn file có dung lượng nhỏ hơn.");
      return;
    }
    setSelectedFile(file);
  };

  // Gọi pipeline Excel với nhân viên, rule ca và Diary rồi lưu Blob/preview vào result.
  const handleProcess = async () => {
    setError("");
    setIsProcessing(true);
    try {
      setResult(await processExcelFile(selectedFile, employees, {
        shiftRules,
        diaryEntries,
      }));
    } catch (processingError) {
      setResult(null);
      setError(processingError.message || "Đã có lỗi xảy ra khi xử lý file.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Dọn file, kết quả và lỗi để bắt đầu lượt xử lý mới.
  const resetFile = () => {
    setSelectedFile(null);
    setResult(null);
    setError("");
  };

  return (
    <main id="top">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">Công cụ tổng hợp</div>
          <h1>Xử lý chấm công<br /> {/* <span>nhanh và chính xác.</span> */} </h1>
          <p>Tải file Excel từ máy chấm công, đối chiếu giờ đăng ký của nhân viên và nhận file kết quả hoàn chỉnh.</p>
        </div>

        <div className="steps" aria-label="Quy trình xử lý">
          <div className="step active">
            <span>01</span>
            <div>
              <strong>Tải file lên</strong>
              <small>Chọn file .xlsx</small>
            </div>
          </div>
          <div className={`step ${result ? "active" : ""}`}>
            <span>02</span>
            <div>
              <strong>Đối chiếu dữ liệu</strong>
              <small>Tính giờ và vi phạm</small>
            </div>
          </div>
          <div className={`step ${result ? "active" : ""}`}>
            <span>03</span>
            <div>
              <strong>Tải kết quả</strong>
              <small>File Excel hoàn chỉnh</small>
            </div>
          </div>
        </div>
      </section>

      <div className="data-status-grid">
      <section className="registration-status">
        <div className="registration-status-icon"><UsersIcon size={22} /></div>
        <div>
          <strong>{employees.length.toLocaleString("vi-VN")} nhân viên có giờ đăng ký</strong>
          <span>
            {employees.length
              ? "Dữ liệu này sẽ được dùng để tính đi trễ, về sớm và tổng làm."
              : "Chưa có dữ liệu nền. Các dòng chấm công sẽ được ghi chú “Chưa có giờ đăng ký”."}
          </span>
        </div>
        <button className="text-button" type="button" onClick={onOpenEmployees}>Quản lý danh sách</button>
      </section>
      <section className="registration-status">
        <div className="registration-status-icon"><BookIcon size={22} /></div>
        <div><strong>{diaryEntries.length.toLocaleString("vi-VN")} dòng Diary đã lưu</strong><span>Dùng để bổ sung lý do, trạng thái Có phép / Không phép và phục vụ audit.</span></div>
        <button className="text-button" type="button" onClick={onOpenDiary}>Quản lý Diary</button>
      </section>
      </div>

      <section className="workspace-card" aria-labelledby="upload-title">
        <div className="card-heading">
          <div>
            <div className="section-number">01</div>
            <div>
              <h2 id="upload-title">Tải file chấm công</h2>
              <p>File cần có sheet “Chi tiết” và các cột chấm công chính; TC1, TC2, TC3, Tổng cộng có thể không có.</p>
            </div>
          </div>
          {selectedFile && (
            <button className="icon-button" type="button" onClick={resetFile} title="Bỏ file đã chọn">
              <CloseIcon />
            </button>
          )}
        </div>

        <FileDropzone file={selectedFile} disabled={isProcessing} onFileSelect={handleFileSelect} />

        {error && (
          <div className="alert alert-error" role="alert">
            <AlertIcon size={22} />
            <div><strong>Không thể xử lý file</strong><span>{error}</span></div>
          </div>
        )}

        {result && (
          <div className="alert alert-success" role="status">
            <CheckIcon size={22} />
            <div>
              <strong>Xử lý thành công</strong>
              <span>
                Đã đối chiếu {result.matchedRows} dòng; {result.unmatchedRows} dòng chưa có giờ đăng ký; tự động điều chỉnh {result.adjustedRows} dòng Vào/Ra; khớp Diary {result.diaryMatchedRows} dòng, trong đó Có phép {result.diaryExemptedRows} dòng.
              </span>
            </div>
          </div>
        )}

        <div className="card-actions">
          <div className="security-note"><span className="security-icon"><CheckIcon size={15} /></span>File gốc luôn được giữ nguyên</div>
          <button className="button button-primary process-button" type="button" disabled={!selectedFile || isProcessing} onClick={handleProcess}>
            {isProcessing ? <><span className="spinner" />Đang xử lý...</> : "Xử lý file"}
          </button>
        </div>
      </section>

      {result && (
        <>
          <PreviewTable
            headers={result.headers}
            rows={result.previewRows}
            highlights={result.previewHighlights}
            totalRows={result.totalRows}
            previewLimit={result.previewLimit}
            diaryMatches={result.previewDiaryMatches}
          />
          <section className="download-card">
            <div className="download-icon"><DownloadIcon size={29} /></div>
            <div className="download-copy"><div className="eyebrow">File kết quả</div><h2>Sẵn sàng để tải xuống</h2><p>{OUTPUT_FILE_NAME}</p></div>
            <button className="button button-dark download-button" type="button" onClick={() => downloadProcessedFile(result.blob, result.fileName)}>
              <DownloadIcon size={19} /> Tải file Excel kết quả
            </button>
          </section>
        </>
      )}
    </main>
  );
}
