# Website xử lý bảng chấm công

Ứng dụng React xử lý file Excel `.xlsx` trên thiết bị và dùng Node server cục bộ để lưu riêng file đính kèm Diary. File gốc không bị thay đổi.

## Chức năng

- Nhận file có sheet `Chi tiết`.
- Kiểm tra đầy đủ 15 cột nguồn bắt buộc.
- Giữ 10 cột dữ liệu gốc từ `STT` đến `Tổng giờ`.
- Thay 5 cột cuối bằng `Đi trễ`, `Phạt`, `Về sớm`, `Ghi chú`, `Tổng làm`.
- Giữ kiểu ô và định dạng ngày/giờ của dữ liệu nguồn.
- Xem trước tối đa 100 dòng sau xử lý.
- Tải file kết quả với tên `bang_cham_cong_da_xu_ly.xlsx`.
- Quản lý danh sách nhân viên và giờ đăng ký trong sheet `Gio lv`.
- Thêm, sửa, xóa, tìm kiếm và lọc theo chi nhánh hoặc giờ đăng ký.
- Import/export danh sách nhân viên bằng file `RegisHours.xlsx`.
- Local dev có cache `localStorage` để hỗ trợ migrate dữ liệu cũ; production ưu tiên API/Postgres.
- Upload hồ sơ Diary dạng JPG, JPEG, PNG, WEBP, PDF, DOC, DOCX, XLS, XLSX; mặc định tối đa 20MB/file.
- Metadata file đính kèm nằm trong Postgres; production nên dùng Vercel Blob qua `BLOB_READ_WRITE_TOKEN`, local dev có fallback lưu file trong thư mục dữ liệu server.
- Xem trực tiếp ảnh/PDF, tải xuống, xóa và thay thế file từ popup chi tiết Diary.
- Đối chiếu ưu tiên theo `Mã N.Viên`, fallback theo `Tên N.Viên` khi mã trống.
- Tính `Đi trễ`, `Về sớm`, `Phạt`, `Ghi chú` và `Tổng làm`.

## Quy tắc tính hiện tại

- `Đi trễ` lấy `Vào 1`; chỉ dùng `Vào 2` khi `Vào 1` trống.
- Ca làm được xác định bằng giờ vào gần nhất trong ba mốc `Vào sáng`, `Vào chiều`, `Vào tối`.
- Nếu giờ chấm không muộn hơn giờ vào của ca đã chọn thì `Đi trễ = 0`; ngược lại lưu số phút chênh lệch.
- Ca được xác định (`Sáng`, `Chiều`, `Tối`) được giữ trong metadata nội bộ của từng dòng và không thêm vào file Excel.
- `Đi trễ` và `Về sớm` được lưu dưới dạng số phút.
- `Về sớm` luôn dùng `Ra 2` nếu có, chỉ fallback sang `Ra 1`; giờ ra này được so với mốc Ra của ca đã xác định.
- Metadata ca lưu thêm `standardOutTime`, `actualOutTime`, `actualOutSource` để phục vụ kiểm tra dữ liệu.
- Không xác định được ca hoặc thiếu mốc ra đăng ký sẽ để trống `Về sớm` và ghi `Không xác định được giờ ra chuẩn`.
- Các ô `Vào 1/Ra 1` và `Vào 2/Ra 2` được phân loại lại bằng khoảng cách tới toàn bộ mốc Vào/Ra đã đăng ký. Dữ liệu gốc và nội dung điều chỉnh được giữ trong `adjustmentLogs`.
- Nhân viên thường: trễ tối đa 15 phút không phạt; từ phút 16, mỗi block 60 phút có mức phạt `70.000 * 2^(block - 1)`.
- Nhân viên có `VP-` trong tên: trễ tối đa 15 phút không phạt, từ phút 16 phạt cố định 70.000 VNĐ.
- Tổng trễ theo tháng của nhân viên `VP-` vượt 180 phút sẽ được nối cảnh báo xem xét trừ lương vào `Ghi chú`.
- Rule Engine được cấu hình bằng danh sách rule dữ liệu, hỗ trợ điều kiện `employeeCode`, `branch`, `position`, `weekday` và gán ca `morning`, `afternoon`, `evening`, `full`.
- Rule mặc định: mã `00004` vào `T7`/Thứ Bảy luôn dùng Ca Chiều cho chỉnh Vào/Ra và các phép tính chấm công.
- Rule mặc định vẫn nằm trong code; local dev có thể đọc override `timekeeping.shiftRules.v1` để thử nghiệm mà không sửa module tính toán.
- `Tổng làm = max(0, Tổng giờ - 60 phút)` cho tất cả nhân viên; không làm tròn và không phụ thuộc các cặp Vào/Ra.
- Giá trị `Tổng làm` được lưu nội bộ bằng phút, hiển thị theo `HH:mm` và xuất Excel dưới dạng thời gian số với định dạng `[hh]:mm` để tiếp tục dùng trong công thức.
- OFF được xác định khi ghi chú chứa `OFF` hoặc dòng không có dữ liệu Vào/Ra. Nếu một nhân viên OFF quá 2 ngày trong tuần Thứ Hai-Chủ Nhật, toàn bộ các dòng OFF của tuần đó được tô đỏ nhạt.
- Ô `Đi trễ` lớn hơn 0 được tô vàng nhạt; ô `Về sớm` lớn hơn 0 được tô xanh biển nhạt. Màu OFF có độ ưu tiên cao nhất và được giữ nguyên trong preview lẫn file Excel xuất ra.
- Không tìm thấy nhân viên sẽ ghi `Chưa có giờ đăng ký`.
- Diary có phép luôn miễn phạt; ghi `Có hồ sơ` khi đã có file hoặc `Chưa bổ sung hồ sơ` khi chưa upload.
- Diary không phép vẫn giữ nguyên tiền phạt dù có hồ sơ đính kèm.

## Chạy dự án

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Lệnh `npm run dev` chạy giao diện Vite và API upload cùng địa chỉ `http://localhost:5173`.

Giới hạn upload có thể đổi bằng `ATTACHMENT_MAX_MB`. Local dev cần `DATABASE_URL` trỏ tới Postgres/Neon; nếu chưa cấu hình Vercel Blob thì file đính kèm chỉ lưu local trong `TIMEKEEPING_DATA_DIR`.

Bản production:

```bash
npm run build
npm start
```

## Kiểm tra và build

```bash
npm run verify
npm run build
```

Module xử lý Excel nằm tại `src/excel/excelProcessor.js`, công thức thời gian tại `src/excel/timekeepingCalculations.js`, import/export Diary tại `src/diary/diaryExcel.js`, và API file đính kèm tại `server.mjs`.

## Database deploy Vercel/Neon

Backend đã được chuyển sang Postgres serverless qua `@neondatabase/serverless`. Không commit `.env`, token, database file hoặc upload thật.

Env cần tạo trên Vercel:

- `DATABASE_URL`: connection string Postgres. Ưu tiên tạo Neon Postgres từ Vercel Marketplace, sau đó gắn biến này cho Production/Preview/Development.
- `JWT_SECRET`: secret riêng cho mỗi môi trường. Seed script yêu cầu biến này để đảm bảo môi trường đã cấu hình secret, dù auth hiện tại vẫn dùng session lưu trong Postgres.
- `DEFAULT_ADMIN_PASSWORD`: mật khẩu seed cho user `admin`.
- `DEFAULT_MANAGER_PASSWORD`: mật khẩu seed cho user `manager`.
- `DEFAULT_MANAGER_BRANCH`: tùy chọn, mặc định `Q7`.
- `BLOB_READ_WRITE_TOKEN`: tùy chọn nhưng nên có trên Vercel để file đính kèm lưu vào Vercel Blob. Nếu thiếu, local dev fallback sang thư mục local.

Tạo database trên Vercel:

1. Mở project Vercel, vào Marketplace.
2. Chọn Neon Postgres và kết nối vào project.
3. Kiểm tra Vercel đã tạo `DATABASE_URL`.
4. Tạo thêm các env secret ở trên.

Chạy migration/seed:

```bash
npm run db:migrate
npm run db:seed
```

Nếu cần migrate dữ liệu SQLite cũ, đặt `TIMEKEEPING_SQLITE_PATH` nếu file không nằm ở `data/timekeeping.sqlite`, rồi chạy:

```bash
npm run db:migrate:sqlite
```

Script này chỉ copy/upsert sang Postgres, không xóa SQLite cũ và không tự chạy khi deploy.

Thiết lập deploy Vercel:

- Install command: `npm install`
- Build command: `npm run build`
- Output directory: `dist`

Sau khi tạo database mới, chạy `npm run db:migrate` và `npm run db:seed` một lần bằng môi trường có đầy đủ env. Không commit `.env`, `.env.local`, file `.sqlite`, `.db`, `uploads/`, `data/` hoặc file upload thật.
