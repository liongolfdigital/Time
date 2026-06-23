import { useEffect, useMemo, useRef, useState } from "react";
import EmployeeForm from "./EmployeeForm";
import {AlertIcon, DownloadIcon, EditIcon, FilterIcon, PlusIcon, SearchIcon, TrashIcon, UploadIcon, UsersIcon} from "./Icons";
import {exportEmployeesToExcel, importEmployeesFromExcel} from "../employees/employeeExcel";
import {EMPLOYEE_FIELDS, getEmployeeGroup, mergeEmployeeLists, normalizeLookup, sanitizeEmployee} from "../employees/employeeModel";
import { canDeleteEmployee, canImportExport, canManageEmployee, filterEmployeesForUser, getRecordBranch, isManager} from "../auth/authorization";
import { isApiUnavailableError } from "../api/apiClient";
import { employeeApi } from "../api/employeeApi";

const EMPLOYEE_SAVE_RELOAD_FAILED_MESSAGE = "Đã lưu thành công nhưng không thể tải lại danh sách nhân viên";
const EMPLOYEE_DELETE_RELOAD_FAILED_MESSAGE = "Đã xóa thành công nhưng không thể tải lại danh sách nhân viên";
const EMPLOYEE_IMPORT_RELOAD_FAILED_MESSAGE = "Đã import thành công nhưng không thể tải lại danh sách nhân viên";

/** Màn hình quản lý nhân viên/Giờ ĐK với filter, CRUD, import/export và scope theo chi nhánh. */
export default function EmployeePage({currentUser, employees, onEmployeesChange, onLogAction}) {
  // State filter, modal chỉnh sửa, thông báo và tiến trình import của trang.
  const importInputRef = useRef(null);
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [shiftFilter, setShiftFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [editingEmployee, setEditingEmployee] = useState(undefined);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [message, setMessage] = useState(null);
  const [isImporting, setIsImporting] = useState(false);

  // Chỉ giữ nhân viên thuộc phạm vi user trước khi tạo filter hoặc render.
  const visibleEmployees = useMemo(
    () => filterEmployeesForUser(employees, currentUser),
    [currentUser, employees],
  );
  const allowImportExport = canImportExport(currentUser);
  const allowDelete = canDeleteEmployee(currentUser);

  // Dựng các option filter từ tập nhân viên user được phép xem.
  const branches = useMemo(
    () => [...new Set(visibleEmployees.map(getRecordBranch).filter(Boolean))].sort(),
    [visibleEmployees],
  );
  const shifts = useMemo(
    () => [...new Set(visibleEmployees.map(({ registeredShift }) => registeredShift).filter(Boolean))].sort(),
    [visibleEmployees],
  );
  const employeeGroups = useMemo(
    () => [...new Set(visibleEmployees.map(({ employeeName }) => getEmployeeGroup(employeeName)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi")),
    [visibleEmployees],
  );

  // Áp tìm kiếm cùng các filter chi nhánh/Giờ ĐK/nhóm lên danh sách đã phân quyền.
  const filteredEmployees = useMemo(() => {
    const normalizedSearch = normalizeLookup(search);

    return visibleEmployees.filter((employee) => {
      const branch = getRecordBranch(employee);
      const employeeGroup = getEmployeeGroup(employee.employeeName);
      const matchesSearch = !normalizedSearch ||
        [employee.employeeCode, employee.employeeName, branch, employeeGroup].some((value) => normalizeLookup(value).includes(normalizedSearch));
      const matchesBranch = !branchFilter || branch === branchFilter;
      const matchesShift = !shiftFilter || employee.registeredShift === shiftFilter;
      const matchesGroup = !groupFilter || employeeGroup === groupFilter;
      return matchesSearch && matchesBranch && matchesShift && matchesGroup;
    });
  }, [branchFilter, groupFilter, search, shiftFilter, visibleEmployees]);

  // Ghi số lượng sau phân quyền/filter trong development để hỗ trợ audit dữ liệu.
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.debug("[TimeKeeping data] employees:filter", {
        currentUser,
        role: currentUser?.role,
        branch: currentUser?.branch,
        rawEmployees: employees.length,
        visibleEmployees: visibleEmployees.length,
        filteredEmployees: filteredEmployees.length,
        groupFilter,
      });
    }
  }, [currentUser, employees.length, filteredEmployees.length, groupFilter, visibleEmployees.length]);

  const clearMessage = () => setMessage(null);

  const reloadEmployeesAfterSuccess = async (fallbackEmployees, reloadFailureMessage) => {
    try {
      const reloadedEmployees = await employeeApi.list();
      onEmployeesChange(reloadedEmployees);
      clearMessage();
      return { employees: reloadedEmployees, reloadFailed: false };
    } catch {
      onEmployeesChange(fallbackEmployees);
      setMessage({ type: "error", text: reloadFailureMessage });
      return { employees: fallbackEmployees, reloadFailed: true };
    }
  };

  // Mở modal ở chế độ tạo mới.
  const openCreateForm = () => {
    setEditingEmployee(undefined);
    setIsFormOpen(true);
  };

  // Mở modal với hồ sơ nhân viên được chọn.
  const openEditForm = (employee) => {
    setEditingEmployee(employee);
    setIsFormOpen(true);
  };

  // Kiểm tra scope, gọi API create/update (fallback local), cập nhật parent và ghi audit.
  const saveEmployee = async (employee) => {
    const scopedEmployee = isManager(currentUser)
      ? { ...employee, branch: currentUser.branch } : employee;
    if (!canManageEmployee(currentUser, scopedEmployee)) {
      setMessage({ type: "error", text: "Bạn không có quyền truy cập dữ liệu chi nhánh này" });
      return;
    }

    clearMessage();
    try {
      let savedEmployee;
      let usingLocalEmployeeApi = false;
      try {
        savedEmployee = editingEmployee ? await employeeApi.update(scopedEmployee) : await employeeApi.create(scopedEmployee);
      } catch (error) {
        if (!isApiUnavailableError(error)) throw error;
        console.warn("[TimeKeeping data] Employee API unavailable, saving to localStorage cache.", {
          endpoint: error.endpoint,
          status: error.status,
          message: error.message,
        });
        savedEmployee = sanitizeEmployee(scopedEmployee);
        usingLocalEmployeeApi = true;
      }

      const nextEmployees = editingEmployee
        ? employees.map((item) => (item.id === savedEmployee.id ? savedEmployee : item)) : [...employees, savedEmployee];
      let reloadFailed = false;
      if (usingLocalEmployeeApi) {
        onEmployeesChange(nextEmployees);
        clearMessage();
      } else {
        ({ reloadFailed } = await reloadEmployeesAfterSuccess(nextEmployees, EMPLOYEE_SAVE_RELOAD_FAILED_MESSAGE));
      }
      setIsFormOpen(false);
      if (!reloadFailed) setMessage({ type: "success", text: "Danh sách nhân viên đã được cập nhật." });
      onLogAction?.(editingEmployee ? "employee.update.ui" : "employee.create.ui", {
        targetType: "employee",
        targetId: savedEmployee.id,
        detail: {
          employeeCode: savedEmployee.employeeCode,
          employeeName: savedEmployee.employeeName,
          branch: savedEmployee.branch,
        },
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  };

  // Xác nhận và xóa nhân viên khi user có quyền; fallback xóa cache nếu API không có.
  const deleteEmployee = async (employee) => {
    if (!allowDelete) {
      setMessage({ type: "error", text: "Bạn không có quyền truy cập chức năng này" });
      return;
    }

    const displayName = employee.employeeName || employee.employeeCode;
    if (!window.confirm(`Xóa nhân viên "${displayName}" khỏi danh sách?`)) return;

    clearMessage();
    try {
      let usingLocalEmployeeApi = false;
      try {
        await employeeApi.remove(employee.id);
      } catch (error) {
        if (!isApiUnavailableError(error)) throw error;
        console.warn("[TimeKeeping data] Employee delete API unavailable, deleting from localStorage cache.", {
          endpoint: error.endpoint,
          status: error.status,
          message: error.message,
        });
        usingLocalEmployeeApi = true;
      }
      const nextEmployees = employees.filter((item) => item.id !== employee.id);
      let reloadFailed = false;
      if (usingLocalEmployeeApi) {
        onEmployeesChange(nextEmployees);
        clearMessage();
      } else {
        ({ reloadFailed } = await reloadEmployeesAfterSuccess(nextEmployees, EMPLOYEE_DELETE_RELOAD_FAILED_MESSAGE));
      }
      if (!reloadFailed) setMessage({ type: "success", text: "Đã xóa nhân viên khỏi danh sách." });
      onLogAction?.("employee.delete.ui", {
        targetType: "employee",
        targetId: employee.id,
        detail: {
          employeeCode: employee.employeeCode,
          employeeName: employee.employeeName,
          branch: employee.branch,
        },
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  };

  // Parse RegisHours.xlsx, merge danh sách, bulk-save và báo số bản ghi import.
  const handleImport = async (file) => {
    if (!file) return;
    if (!allowImportExport) {
      setMessage({ type: "error", text: "Bạn không có quyền truy cập chức năng này" });
      return;
    }

    clearMessage();
    setIsImporting(true);

    try {
      const importedEmployees = await importEmployeesFromExcel(file);
      const mergedEmployees = mergeEmployeeLists(employees, importedEmployees);
      let savedEmployees;
      let usingLocalEmployeeApi = false;
      try {
        savedEmployees = await employeeApi.replaceAll(mergedEmployees);
      } catch (error) {
        if (!isApiUnavailableError(error)) throw error;
        console.warn("[TimeKeeping data] Employee bulk API unavailable, importing to localStorage cache.", {
          endpoint: error.endpoint,
          status: error.status,
          message: error.message,
        });
        savedEmployees = mergedEmployees;
        usingLocalEmployeeApi = true;
      }
      let syncedEmployees = savedEmployees;
      let reloadFailed = false;
      if (usingLocalEmployeeApi) {
        onEmployeesChange(savedEmployees);
        clearMessage();
      } else {
        const reloadResult = await reloadEmployeesAfterSuccess(savedEmployees, EMPLOYEE_IMPORT_RELOAD_FAILED_MESSAGE);
        syncedEmployees = reloadResult.employees;
        reloadFailed = reloadResult.reloadFailed;
      }
      if (!reloadFailed) {
        setMessage({
          type: "success",
          text: `Đã import ${importedEmployees.length} nhân viên. Danh sách hiện có ${syncedEmployees.length} người.`,
        });
      }
      onLogAction?.("employee.import.ui", {
        targetType: "employee",
        detail: { importedCount: importedEmployees.length, totalCount: syncedEmployees.length },
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setIsImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  // Kiểm tra quyền rồi tạo/tải RegisHours.xlsx và ghi audit export.
  const handleExport = async () => {
    if (!allowImportExport) {
      setMessage({ type: "error", text: "Bạn không có quyền truy cập chức năng này" });
      return;
    }

    clearMessage();
    try {
      await exportEmployeesToExcel(employees);
      onLogAction?.("employee.export", {
        targetType: "employee",
        detail: { exportedCount: employees.length },
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  };

  return (
    <main className="employee-page">
      <section className="page-intro">
        <div>
          <div className="eyebrow">Dữ liệu nền chấm công</div>
          <h1>Danh sách nhân viên <span>/ Giờ đăng ký</span></h1>
          <p>
            Quản lý khung giờ làm việc để hệ thống tự động đối chiếu đi trễ, về sớm và tổng thời gian làm.
          </p>
        </div>
        <div className="employee-stat">
          <span className="employee-stat-icon"><UsersIcon size={24} /></span>
          <div><strong>{visibleEmployees.length.toLocaleString("vi-VN")}</strong><span>nhân viên đã lưu</span></div>
        </div>
      </section>

      <section className="employee-card">
        <div className="employee-toolbar">
          <div className="toolbar-actions">
            <input
              ref={importInputRef}
              className="hidden-file-input"
              type="file"
              aria-hidden="true"
              tabIndex={-1}
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => handleImport(event.target.files?.[0])}
            />
            {allowImportExport && (<>
              <button
                className="button button-secondary"
                type="button"
                disabled={isImporting}
                onClick={() => importInputRef.current?.click()}
              >
                <UploadIcon size={18} />
                {isImporting ? "Đang import..." : "Import RegisHours.xlsx"}
              </button>
              <button className="button button-secondary" type="button" onClick={handleExport}>
                <DownloadIcon size={18} /> Export Excel
              </button>
            </>)}
            <button className="button button-primary" type="button" onClick={openCreateForm}>
              <PlusIcon size={18} /> Thêm nhân viên
            </button>
          </div>

          <div className="employee-filters">
            <label className="search-field">
              <SearchIcon size={18} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm mã, tên, chi nhánh..."
              />
            </label>
            <label className="select-field">
              <FilterIcon size={17} />
              <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
                <option value="">Tất cả chi nhánh</option>
                {branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
              </select>
            </label>
            <label className="select-field">
              <FilterIcon size={17} />
              <select value={shiftFilter} onChange={(event) => setShiftFilter(event.target.value)}>
                <option value="">Tất cả giờ ĐK</option>
                {shifts.map((shift) => <option key={shift} value={shift}>{shift}</option>)}
              </select>
            </label>
            <label className="select-field">
              <FilterIcon size={17} />
              <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
                <option value="">Tất cả nhóm</option>
                {employeeGroups.map((group) => <option key={group} value={group}>{group}</option>)}
              </select>
            </label>
          </div>
        </div>

        {message && (
          <div className={`alert ${message.type === "error" ? "alert-error" : "alert-success"}`} role="status">
            <AlertIcon size={20} />
            <div><strong>{message.type === "error" ? "Không thể thực hiện" : "Đã lưu dữ liệu"}</strong><span>{message.text}</span></div>
          </div>
        )}

        <div className="employee-table-meta">
          <span>Hiển thị <strong>{filteredEmployees.length}</strong> / {visibleEmployees.length} nhân viên</span>
          <span>{isManager(currentUser) ? `Manager chi nhánh ${currentUser.branch}` : "Dữ liệu được lưu qua API có kiểm tra phân quyền"}</span>
        </div>

        <div className="employee-table-shell">
          <table className="employee-table">
            <thead>
              <tr>
                <th className="index-column">STT</th>
                {EMPLOYEE_FIELDS.map(({ label }) => <th key={label}>{label}</th>)}
                <th className="actions-column">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.length > 0 ? (
                filteredEmployees.map((employee, index) => (
                  <tr key={employee.id}>
                    <td className="index-column">{index + 1}</td>
                    {EMPLOYEE_FIELDS.map(({ key }) => (
                      <td key={key} title={employee[key]}>{employee[key] || <span className="empty-cell">—</span>}</td>
                    ))}
                    <td className="actions-column">
                      <div className="row-actions">
                        <button type="button" onClick={() => openEditForm(employee)} aria-label={`Sửa ${employee.employeeName}`}><EditIcon /></button>
                        {allowDelete && <button className="danger-action" type="button" onClick={() => deleteEmployee(employee)} aria-label={`Xóa ${employee.employeeName}`}><TrashIcon /></button>}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="employee-empty" colSpan={EMPLOYEE_FIELDS.length + 2}>
                    <UsersIcon size={30} />
                    <strong>{visibleEmployees.length ? "Không có kết quả phù hợp" : "Chưa có danh sách nhân viên"}</strong>
                    <span>{allowImportExport ? "Import file RegisHours.xlsx hoặc thêm nhân viên mới." : "Bạn chỉ thấy nhân viên thuộc chi nhánh được phân quyền."}</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {isFormOpen && (
        <EmployeeForm
          employee={editingEmployee}
          fixedBranch={isManager(currentUser) ? currentUser.branch : ""}
          onCancel={() => setIsFormOpen(false)}
          onSave={saveEmployee}
        />
      )}
    </main>
  );
}
