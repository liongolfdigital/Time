import {
  apiRequest,
  clearAuthSession,
  readStoredSession,
  storeAuthSession,
} from "./apiClient.js";

/** Đăng nhập qua API, lưu session và trả session cho App. */
export async function login(username, password) {
  const session = await apiRequest("/api/auth/login", { method: "POST", body: { username, password } });
  storeAuthSession(session);
  return session;
}

/** Làm mới user của session hiện tại từ server và cập nhật localStorage. */
export async function fetchCurrentUser() {
  const payload = await apiRequest("/api/auth/me");
  const current = readStoredSession();
  if (current) storeAuthSession({ ...current, user: payload.user });
  return payload.user;
}

/** Đăng xuất server và luôn xóa session local dù request thất bại. */
export async function logout() {
  try { await apiRequest("/api/auth/logout", { method: "POST" }); }
  finally { clearAuthSession(); }
}

/** Gửi audit log UI theo kiểu best-effort; lỗi log không chặn thao tác chính. */
export function logAction(action, { targetType = "", targetId = "", detail = null } = {}) {
  return apiRequest("/api/audit-logs", {
    method: "POST", body: { action, targetType, targetId, detail },
  }).catch(() => null);
}
