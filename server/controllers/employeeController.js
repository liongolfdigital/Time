export function createEmployeeController({ employeeService, logAudit, handleApiError }) {
  const auditDetail = (employee) => ({
    employeeCode: employee.employeeCode,
    employeeName: employee.employeeName,
    branch: employee.branch,
  });

  return {
    async list(request, response) {
      response.json(await employeeService.listForUser(request.user));
    },
    async create(request, response) {
      try {
        const employee = await employeeService.save(request.body || {}, request.user);
        await logAudit({ user: request.user, action: "employee.create", targetType: "employee", targetId: employee.id, detail: auditDetail(employee) });
        return response.status(201).json(employee);
      } catch (error) {
        return handleApiError(response, error);
      }
    },
    async update(request, response) {
      const existingRow = await employeeService.findRow(request.params.id);
      if (!existingRow) return response.status(404).json({ error: "Khong tim thay nhan vien." });
      try {
        const employee = await employeeService.save(
          { ...(request.body || {}), id: request.params.id }, request.user, existingRow,
        );
        await logAudit({ user: request.user, action: "employee.update", targetType: "employee", targetId: employee.id, detail: auditDetail(employee) });
        return response.json(employee);
      } catch (error) {
        return handleApiError(response, error);
      }
    },
    async remove(request, response) {
      const existingRow = await employeeService.findRow(request.params.id);
      if (!existingRow) return response.status(404).json({ error: "Khong tim thay nhan vien." });
      const employee = employeeService.serializeRow(existingRow);
      await employeeService.deleteById(request.params.id);
      await logAudit({ user: request.user, action: "employee.delete", targetType: "employee", targetId: employee.id, detail: auditDetail(employee) });
      return response.status(204).end();
    },
    async bulkReplace(request, response) {
      const employees = Array.isArray(request.body?.employees) ? request.body.employees : [];
      try {
        const savedEmployees = await employeeService.replaceAll(employees, request.user);
        await logAudit({ user: request.user, action: "employee.bulk_replace", targetType: "employee", detail: { count: savedEmployees.length } });
        return response.json(savedEmployees);
      } catch (error) {
        return handleApiError(response, error);
      }
    },
  };
}
