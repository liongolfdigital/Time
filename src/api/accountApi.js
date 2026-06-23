import { apiRequest } from "./apiClient.js";

// Adapter REST cho màn hình Account; mỗi method trả Promise từ apiRequest.
export const accountApi = {
  list: () => apiRequest("/api/accounts"),
  create: (account) => apiRequest("/api/accounts", { method: "POST", body: account }),
  update: (account) => apiRequest(`/api/accounts/${encodeURIComponent(account.id)}`, { method: "PUT", body: account }),
  remove: (id) => apiRequest(`/api/accounts/${encodeURIComponent(id)}`, { method: "DELETE" }),
  resetPassword: (id, password) => apiRequest(`/api/accounts/${encodeURIComponent(id)}/password`, { method: "POST", body: { password } }),
};
