/** Render icon đồng hồ SVG thuần, không có state hay side effect. */
export function ClockIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.75" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 7.5V12L15.25 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Render icon upload SVG thuần theo kích thước nhận vào. */
export function UploadIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 15.5V4.5M12 4.5L8 8.5M12 4.5L16 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 14.5V18C5 19.1 5.9 20 7 20H17C18.1 20 19 19.1 19 18V14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Render icon file SVG thuần theo kích thước nhận vào. */
export function FileIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 3.75H13.25L18 8.5V19C18 19.7 17.7 20.25 17.25 20.25H7C6.45 20.25 6 19.8 6 19.25V4.75C6 4.2 6.45 3.75 7 3.75Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M13 4V9H18" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8.5 13H15.5M8.5 16H13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Render icon dấu kiểm SVG thuần theo kích thước nhận vào. */
export function CheckIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5L9.25 16.75L19 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Render icon download SVG thuần theo kích thước nhận vào. */
export function DownloadIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4.5V15.5M12 15.5L8 11.5M12 15.5L16 11.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 19.5H19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Render icon cảnh báo SVG thuần theo kích thước nhận vào. */
export function AlertIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10.25 4.75L3.25 17C2.75 17.9 3.4 19 4.45 19H19.55C20.6 19 21.25 17.9 20.75 17L13.75 4.75C12.95 3.35 11.05 3.35 10.25 4.75Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 9V13M12 16.25V16.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/** Render icon đóng SVG thuần theo kích thước nhận vào. */
export function CloseIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 7L17 17M17 7L7 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/** Render icon người dùng SVG thuần theo kích thước nhận vào. */
export function UsersIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8.5 11.25A3.25 3.25 0 1 0 8.5 4.75a3.25 3.25 0 0 0 0 6.5ZM3.75 19.25v-1.5a4.75 4.75 0 0 1 9.5 0v1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M15.25 11a2.75 2.75 0 1 0 0-5.5M15.5 13.5a4.2 4.2 0 0 1 4.75 4.15v1.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Render icon dấu cộng SVG thuần theo kích thước nhận vào. */
export function PlusIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/** Render icon tìm kiếm SVG thuần theo kích thước nhận vào. */
export function SearchIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.75" cy="10.75" r="5.75" stroke="currentColor" strokeWidth="1.6" />
      <path d="M15 15L19 19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Render icon chỉnh sửa SVG thuần theo kích thước nhận vào. */
export function EditIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 19L6 14.75L15.75 5L19 8.25L9.25 18L5 19Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M13.75 7L17 10.25" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Render icon thùng rác SVG thuần theo kích thước nhận vào. */
export function TrashIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.5 7.5H18.5M9 7.5V5.25H15V7.5M7.25 7.5L8 19H16L16.75 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 11V16M14 11V16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Render icon bộ lọc SVG thuần theo kích thước nhận vào. */
export function FilterIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.5 6H19.5M7 12H17M10 18H14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Render icon sổ Diary SVG thuần theo kích thước nhận vào. */
export function BookIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 4.5H10.5C11.3 4.5 12 5.2 12 6V19.5C12 18.7 11.3 18 10.5 18H5V4.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M19 4.5H13.5C12.7 4.5 12 5.2 12 6V19.5C12 18.7 12.7 18 13.5 18H19V4.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7.5 8H9.5M14.5 8H16.5M7.5 11H9.5M14.5 11H16.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/** Render icon cửa hàng SVG thuần theo kích thước nhận vào. */
export function StoreIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 10.5V19.25H19V10.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M4.25 10.5L5.6 4.75H18.4L19.75 10.5H4.25Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8.25 10.5L8.8 4.75M12 10.5V4.75M15.75 10.5L15.2 4.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 19.25V14.25H15V19.25M7.25 12.75H16.75" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** Render icon xem SVG thuần theo kích thước nhận vào. */
export function EyeIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3.5 12S6.5 6.5 12 6.5 20.5 12 20.5 12 17.5 17.5 12 17.5 3.5 12 3.5 12Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Render icon ẩn nội dung SVG thuần theo kích thước nhận vào. */
export function EyeOffIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3.5 12S6.5 6.5 12 6.5 20.5 12 20.5 12 17.5 17.5 12 17.5 3.5 12 3.5 12Z" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 4L20 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Render icon thay thế SVG thuần theo kích thước nhận vào. */
export function ReplaceIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 7H17L14.5 4.5M17 7L14.5 9.5M17 17H7L9.5 14.5M7 17L9.5 19.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
