import { apiRequest } from "./apiClient.js";

// Adapter REST cho CRUD, export và bulk replace Diary.
export const diaryApi = {
  list: () => apiRequest("/api/diary"),
  listForExport: () => apiRequest("/api/diary/export"),
  create: (entry) => apiRequest("/api/diary", { method: "POST", body: entry }),
  update: (entry) => apiRequest(`/api/diary/${encodeURIComponent(entry.id)}`, { method: "PUT", body: entry }),
  remove: (id) => apiRequest(`/api/diary/${encodeURIComponent(id)}`, { method: "DELETE" }),
  removeMany: (ids) => apiRequest("/api/diary/bulk", { method: "DELETE", body: { ids } }),
  replaceAll: (entries) => apiRequest("/api/diary/bulk", { method: "POST", body: { entries } }),
};
