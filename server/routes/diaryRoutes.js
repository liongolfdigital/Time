/** Đăng ký hai alias route Diary cho CRUD, export và bulk import với đúng middleware quyền. */
export function registerDiaryImportExportRoutes(app, {
  requireAuth,
  requireAdmin,
  requireDiaryImportExport,
  diaryController,
}) {
  ["/api/diary-entries", "/api/diary"].forEach((route) => {
    app.get(route, requireAuth, diaryController.list);
    app.post(route, requireAuth, diaryController.create);
    app.put(`${route}/:id`, requireAuth, diaryController.update);
    app.delete(`${route}/:id`, requireAuth, requireAdmin, diaryController.remove);
  });
  ["/api/diary-entries/export", "/api/diary/export"].forEach((route) => {
    app.get(route, requireAuth, requireDiaryImportExport, diaryController.exportEntries);
  });
  ["/api/diary-entries/bulk", "/api/diary/bulk"].forEach((route) => {
    app.post(route, requireAuth, requireDiaryImportExport, diaryController.replaceEntries);
  });
}
