import { useEffect, useState } from "react";
import { CloseIcon } from "./Icons";
import {
  createEmployeeId,
  EMPTY_EMPLOYEE,
  EMPLOYEE_FIELDS,
  sanitizeEmployee,
} from "../employees/employeeModel";

const SHIFT_OPTIONS = ["Sáng", "Chiều", "Tối"];

/** Modal thêm/sửa hồ sơ nhân viên và giờ đăng ký; validate rồi trả dữ liệu đã sanitize lên parent. */
export default function EmployeeForm({ employee, fixedBranch = "", onCancel, onSave }) {
  const [formData, setFormData] = useState(EMPTY_EMPLOYEE);
  const [error, setError] = useState("");

  // Reset form theo nhân viên đang sửa và khóa chi nhánh khi Manager mở modal.
  useEffect(() => {
    setFormData({
      ...(employee ? { ...EMPTY_EMPLOYEE, ...employee } : EMPTY_EMPLOYEE),
      ...(fixedBranch ? { branch: fixedBranch } : {}),
    });
    setError("");
  }, [employee, fixedBranch]);

  // Validate định danh và mọi field HH:mm trước khi gọi onSave.
  const handleSubmit = (event) => {
    event.preventDefault();

    if (!formData.employeeCode.trim() && !formData.employeeName.trim()) {
      setError("Cần nhập ít nhất Mã N.Viên hoặc Tên N.Viên.");
      return;
    }

    const invalidTimeField = EMPLOYEE_FIELDS.find(
      ({ key, type }) =>
        type === "time" &&
        formData[key].trim() &&
        !/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(formData[key].trim()),
    );
    if (invalidTimeField) {
      setError(`${invalidTimeField.label} phải theo định dạng HH:mm, ví dụ 08:30.`);
      return;
    }

    onSave(
      sanitizeEmployee({
        ...formData,
        ...(fixedBranch ? { branch: fixedBranch } : {}),
        id: employee?.id || createEmployeeId(),
      }),
    );
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="employee-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="employee-form-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <div className="eyebrow">Giờ làm việc đăng ký</div>
            <h2 id="employee-form-title">
              {employee ? "Cập nhật nhân viên" : "Thêm nhân viên"}
            </h2>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="Đóng">
            <CloseIcon />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="employee-form-grid">
            {EMPLOYEE_FIELDS.map(({ key, label, type }) => (
              <label
                className={`form-field ${key === "note" ? "form-field-wide" : ""}`}
                key={key}
              >
                <span>{label}</span>
                {key === "registeredShift" ? (
                  <>
                    <input
                      list="registered-shift-options"
                      value={formData[key]}
                      onChange={(event) =>
                        setFormData((current) => ({ ...current, [key]: event.target.value }))
                      }
                      placeholder="Sáng, Chiều hoặc Tối"
                    />
                    <datalist id="registered-shift-options">
                      {SHIFT_OPTIONS.map((option) => <option key={option} value={option} />)}
                    </datalist>
                  </>
                ) : (
                  <input
                    type="text"
                    disabled={key === "branch" && Boolean(fixedBranch)}
                    inputMode={type === "time" ? "numeric" : undefined}
                    pattern={type === "time" ? "(?:[01]?[0-9]|2[0-3]):[0-5][0-9]" : undefined}
                    value={formData[key]}
                    onChange={(event) =>
                      setFormData((current) => ({ ...current, [key]: event.target.value }))
                    }
                    placeholder={type === "time" ? "--:--" : "Nhập dữ liệu"}
                  />
                )}
              </label>
            ))}
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="modal-actions">
            <button className="button button-secondary" type="button" onClick={onCancel}>
              Hủy
            </button>
            <button className="button button-primary" type="submit">
              {employee ? "Lưu thay đổi" : "Thêm nhân viên"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
