/** Đăng ký nhóm route CRUD/bulk nhân viên và middleware quyền tương ứng lên Express app. */
export function registerEmployeeRoutes(app, { requireAuth, requireAdmin, controller }) {
  app.get("/api/employees", requireAuth, controller.list);
  app.post("/api/employees", requireAuth, controller.create);
  app.put("/api/employees/:id", requireAuth, controller.update);
  app.delete("/api/employees/:id", requireAuth, requireAdmin, controller.remove);
  app.post("/api/employees/bulk", requireAuth, requireAdmin, controller.bulkReplace);
}
