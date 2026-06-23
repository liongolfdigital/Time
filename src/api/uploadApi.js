import { apiRequest } from "./apiClient.js";

// Adapter REST cho cấu hình, upload, xem và xóa attachment Diary.
export const uploadApi = {
  list: (diaryEntryId = "") => apiRequest(`/api/attachments${diaryEntryId ? `?diaryEntryId=${encodeURIComponent(diaryEntryId)}` : ""}`),
  config: () => apiRequest("/api/attachments/config"),
  upload: (diaryEntryId, form) => apiRequest(`/api/attachments/${encodeURIComponent(diaryEntryId)}`, { method: "POST", body: form }),
  remove: (id) => apiRequest(`/api/attachments/${encodeURIComponent(id)}`, { method: "DELETE" }),
  removeAll: (diaryEntryId) => apiRequest(`/api/diary/${encodeURIComponent(diaryEntryId)}/attachments`, { method: "DELETE" }),
  contentUrl: (id, download = false) => `/api/attachments/${encodeURIComponent(id)}/content${download ? "?download=1" : ""}`,
};
