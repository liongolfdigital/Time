export function createDiaryController({ diaryService, logAudit, normalizeBranch, handleApiError }) {
  const auditDetail = (entry) => ({
    employeeCode: entry.employeeCode,
    employeeName: entry.employeeName,
    branch: entry.branch,
  });

  return {
    async list(request, response) {
      return response.json(await diaryService.listForUser(request.user));
    },
    async create(request, response) {
      try {
        const entry = await diaryService.save(request.body || {}, request.user);
        await logAudit({ user: request.user, action: "diary.create", targetType: "diary", targetId: entry.id, detail: auditDetail(entry) });
        return response.status(201).json(entry);
      } catch (error) {
        return handleApiError(response, error);
      }
    },
    async update(request, response) {
      const existingRow = await diaryService.findRow(request.params.id);
      if (!existingRow) return response.status(404).json({ error: "Khong tim thay ghi chu." });
      try {
        const entry = await diaryService.save(
          { ...(request.body || {}), id: request.params.id }, request.user, existingRow,
        );
        await logAudit({ user: request.user, action: "diary.update", targetType: "diary", targetId: entry.id, detail: auditDetail(entry) });
        return response.json(entry);
      } catch (error) {
        return handleApiError(response, error);
      }
    },
    async remove(request, response) {
      const existingRow = await diaryService.findRow(request.params.id);
      if (!existingRow) return response.status(404).json({ error: "Khong tim thay ghi chu." });
      const entry = diaryService.serializeRow(existingRow);
      await diaryService.deleteById(request.params.id);
      await logAudit({ user: request.user, action: "diary.delete", targetType: "diary", targetId: entry.id, detail: auditDetail(entry) });
      return response.status(204).end();
    },
    async exportEntries(request, response) {
      return response.json(await diaryService.listForExport(request.user));
    },
    async replaceEntries(request, response) {
      const entries = Array.isArray(request.body?.entries) ? request.body.entries : [];
      try {
        const savedEntries = await diaryService.replaceDiaryRecords(entries, request.user);
        await logAudit({
          user: request.user,
          action: "diary.bulk_replace",
          targetType: "diary",
          detail: {
            count: savedEntries.length,
            branch: request.user.role === "Manager" ? normalizeBranch(request.user.branch) : "ALL",
          },
        });
        return response.json(savedEntries);
      } catch (error) {
        try { await diaryService.rollback(); } catch {}
        return handleApiError(response, error);
      }
    },
  };
}
