/** Render preview giới hạn của sheet kết quả, gồm class màu vi phạm và badge Diary. */
export default function PreviewTable({
  headers,
  rows,
  highlights = [],
  totalRows,
  previewLimit,
  diaryMatches = [],
}) {
  const isLimited = totalRows > previewLimit;
  const noteColumn = headers.indexOf("Ghi chú");

  return (
    <section className="preview-card" aria-labelledby="preview-title">
      <div className="preview-heading">
        <div>
          <div className="eyebrow">Kết quả xử lý</div>
          <h2 id="preview-title">Xem trước dữ liệu</h2>
        </div>
        <div className="row-count">
          <strong>{totalRows.toLocaleString("vi-VN")}</strong>
          <span>dòng dữ liệu</span>
        </div>
      </div>

      <div className="table-shell">
        <table>
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row, rowIndex) => (
                <tr key={`${row[0]}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td
                      className={
                        highlights[rowIndex]?.[cellIndex]
                          ? `preview-highlight-${highlights[rowIndex][cellIndex]}`
                          : undefined
                      }
                      key={`${rowIndex}-${cellIndex}`}
                    >
                      {diaryMatches[rowIndex] && cellIndex === noteColumn && (
                        <span className="diary-match-badge">Đã đối chiếu Diary</span>
                      )}
                      {cell || <span className="empty-cell">—</span>}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td className="empty-table" colSpan={headers.length}>
                  File không có dòng dữ liệu bên dưới tiêu đề.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isLimited && (
        <p className="preview-note">
          Bảng đang hiển thị {previewLimit} dòng đầu tiên. File tải xuống vẫn chứa đầy đủ {totalRows.toLocaleString("vi-VN")} dòng.
        </p>
      )}
    </section>
  );
}
