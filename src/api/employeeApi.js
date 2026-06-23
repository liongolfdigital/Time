import { apiRequest } from "./apiClient.js";

// Adapter REST cho CRUD/import danh sách nhân viên.
export const employeeApi = {
  list: () => apiRequest("/api/employees"),
  create: (employee) => apiRequest("/api/employees", { method: "POST", body: employee }),
  update: (employee) => apiRequest(`/api/employees/${encodeURIComponent(employee.id)}`, { method: "PUT", body: employee }),
  remove: (id) => apiRequest(`/api/employees/${encodeURIComponent(id)}`, { method: "DELETE" }),
  replaceAll: (employees) => apiRequest("/api/employees/bulk", { method: "POST", body: { employees } }),
};
