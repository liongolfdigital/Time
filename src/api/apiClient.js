const AUTH_STORAGE_KEY = "timekeeping.authSession.v1";

/** Đọc phiên đăng nhập từ localStorage; trả null nếu JSON hỏng hoặc chưa đăng nhập. */
export function readStoredSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null"); }
  catch { return null; }
}

/** Lấy bearer token từ phiên localStorage hiện tại. */
export function getStoredAuthToken() { return readStoredSession()?.token || ""; }
/** Lấy user đã lưu trong phiên localStorage hiện tại. */
export function getStoredAuthUser() { return readStoredSession()?.user || null; }
/** Ghi toàn bộ phiên đăng nhập xuống localStorage. */
export function storeAuthSession(session) { localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session)); }
/** Xóa phiên đăng nhập khỏi localStorage. */
export function clearAuthSession() { localStorage.removeItem(AUTH_STORAGE_KEY); }

// Parse response thành JSON/null hoặc ném Error có status và endpoint cho fallback API.
async function readResponse(response, endpoint) {
  if (response.ok) return response.status === 204 ? null : response.json();
  const payload = await response.json().catch(() => ({}));
  const error = new Error(payload.error || "Không thể kết nối máy chủ.");
  error.status = response.status;
  error.endpoint = endpoint;
  throw error;
}

/** Gửi request API kèm bearer token, tự encode JSON/FormData và chuẩn hóa lỗi kết nối. */
export async function apiRequest(path, { body, headers = {}, ...options } = {}) {
  const token = getStoredAuthToken();
  const requestHeaders = { ...headers };
  const requestOptions = { credentials: "same-origin", ...options, headers: requestHeaders };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (body instanceof FormData) requestOptions.body = body;
  else if (body !== undefined) {
    requestHeaders["Content-Type"] = requestHeaders["Content-Type"] || "application/json";
    requestOptions.body = JSON.stringify(body);
  }
  if (import.meta.env.DEV) console.debug("[TimeKeeping API]", requestOptions.method || "GET", path);
  try { return await readResponse(await fetch(path, requestOptions), path); }
  catch (error) {
    if (!error.endpoint) error.endpoint = path;
    if (error.status === undefined) error.status = 0;
    throw error;
  }
}

/** Chỉ dev mới fallback sang cache localStorage; production phải dùng API/Postgres. */
export function isApiUnavailableError(error) {
  return import.meta.env.DEV && (error?.status === 404 || error?.status === 0);
}
