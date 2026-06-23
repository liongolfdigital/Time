import { useRef, useState } from "react";
import { FileIcon, UploadIcon } from "./Icons";

/** Vùng chọn/kéo thả một file Excel, chỉ chuyển file lên parent và không tự xử lý nội dung. */
export default function FileDropzone({ file, disabled, onFileSelect }) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  // Chuyển file hợp lệ tồn tại lên callback parent.
  const handleFile = (selectedFile) => {
    if (selectedFile) onFileSelect(selectedFile);
  };

  // Nhận file đầu tiên từ thao tác drop và reset trạng thái kéo.
  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    if (!disabled) handleFile(event.dataTransfer.files?.[0]);
  };

  return (
    <div className={`dropzone ${isDragging ? "is-dragging" : ""} ${file ? "has-file" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false);
      }}
      onDrop={handleDrop} >

      <input ref={inputRef} type="file" disabled={disabled}
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(event) => handleFile(event.target.files?.[0])}/>

      <div className="dropzone-icon">
        {file ? <FileIcon size={32} /> : <UploadIcon size={32} />}
      </div>

      {file ? (<>
        <p className="dropzone-title">{file.name}</p>
        <p className="dropzone-caption">{formatFileSize(file.size)} · File Excel đã sẵn sàng</p>
      </>) : (<>
        <p className="dropzone-title">Kéo thả file Excel vào đây</p>
        <p className="dropzone-caption">hoặc chọn file từ máy tính của bạn</p>
      </>)}

      <button
        className="button button-secondary dropzone-button"
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        {file ? "Chọn file khác" : "Chọn file Excel"}
      </button>
      <span className="dropzone-hint">Chỉ hỗ trợ định dạng .xlsx</span>
    </div>
  );
}

// Định dạng byte thành B/KB/MB cho caption dropzone.
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
