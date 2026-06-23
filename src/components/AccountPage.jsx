import { useEffect, useMemo, useState } from "react";
import { accountApi } from "../api/accountApi";
import { DEFAULT_BRANCH_CODES } from "../branches/branchModel";
import { AlertIcon, CloseIcon, EditIcon, EyeIcon, PlusIcon, TrashIcon, UsersIcon } from "./Icons";

const EMPTY_ACCOUNT = {
  username: "",
  password: "",
  fullName: "",
  role: "Manager",
  branch: "Q7",
  status: "Active",
};

// Định dạng timestamp account theo locale Việt Nam cho bảng quản trị.
function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value : new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
}

/** Màn hình Admin quản lý account, vai trò, chi nhánh, trạng thái và reset mật khẩu. */
export default function AccountPage({ currentUser }) {
  // State danh sách, hai modal form/reset, hiển thị mật khẩu và tiến trình API.
  const [accounts, setAccounts] = useState([]);
  const [editingAccount, setEditingAccount] = useState(null);
  const [formData, setFormData] = useState(EMPTY_ACCOUNT);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [message, setMessage] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showFormPassword, setShowFormPassword] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);

  // Đếm Manager đang hoạt động để hiển thị thống kê đầu trang.
  const activeManagers = useMemo(
    () => accounts.filter((account) => account.role === "Manager" && account.status === "Active").length,
    [accounts],
  );
  const branchOptions = DEFAULT_BRANCH_CODES;

  // Tải danh sách account từ API và cập nhật trạng thái loading/message.
  const loadAccounts = async () => {
    setIsLoading(true);
    try {
      setAccounts(await accountApi.list());
      setMessage(null);
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  // Nạp account một lần khi page được mount.
  useEffect(() => {
    loadAccounts();
  }, []);

  // Reset dữ liệu và mở modal tạo account.
  const openCreateForm = () => {
    setEditingAccount(null);
    setFormData({ ...EMPTY_ACCOUNT, branch: branchOptions[0] || "Q7" });
    setShowFormPassword(false);
    setIsFormOpen(true);
    setMessage(null);
  };

  // Điền dữ liệu account hiện tại vào modal sửa, không đưa password hash lên form.
  const openEditForm = (account) => {
    setEditingAccount(account);
    setFormData({
      username: account.username,
      password: "",
      fullName: account.fullName,
      role: account.role,
      branch: account.role === "Manager" ? account.branch : "",
      status: account.status,
    });
    setShowFormPassword(false);
    setIsFormOpen(true);
    setMessage(null);
  };

  // Tạo/cập nhật account; nếu form sửa có password thì gọi thêm API reset mật khẩu.
  const saveAccount = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setMessage(null);
    try {
      if (editingAccount) {
        const updated = await accountApi.update({ ...formData, id: editingAccount.id });
        const finalAccount = formData.password
          ? await accountApi.resetPassword(updated.id, formData.password) : updated;
        setAccounts((current) => current.map((account) => (
          account.id === finalAccount.id ? finalAccount : account
        )));
      } else {
        const created = await accountApi.create(formData);
        setAccounts((current) => [...current, created]);
      }
      setIsFormOpen(false);
      setEditingAccount(null);
      setMessage({ type: "success", text: "Tài khoản đã được cập nhật." });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  // Khóa hoặc mở account qua API rồi thay phần tử tương ứng trong state.
  const toggleStatus = async (account) => {
    const status = account.status === "Active" ? "Inactive" : "Active";
    try {
      const updated = await accountApi.update({ ...account, status });
      setAccounts((current) => current.map((item) => item.id === account.id ? updated : item));
      setMessage({
        type: "success",
        text: status === "Active" ? "Đã mở khóa tài khoản." : "Đã khóa tài khoản.",
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  };

  // Mở modal reset mật khẩu cho account được chọn.
  const openResetPassword = (account) => {
    setResetTarget(account);
    setResetPasswordValue("");
    setShowResetPassword(false);
    setMessage(null);
  };

  // Gửi mật khẩu mới, đóng modal và hiển thị kết quả.
  const submitResetPassword = async (event) => {
    event.preventDefault();
    if (!resetTarget) return;

    setIsSaving(true);
    try {
      await accountApi.resetPassword(resetTarget.id, resetPasswordValue);
      setResetTarget(null);
      setResetPasswordValue("");
      setMessage({ type: "success", text: "Đã đặt lại mật khẩu." });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  // Xác nhận, xóa account qua API và cập nhật danh sách local.
  const deleteAccount = async (account) => {
    if (!window.confirm(`Xóa tài khoản "${account.username}"?`)) return;
    try {
      await accountApi.remove(account.id);
      setAccounts((current) => current.filter((item) => item.id !== account.id));
      setMessage({ type: "success", text: "Đã xóa tài khoản." });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  };

  return (
    <main className="employee-page account-page">
      <section className="page-intro">
        <div>
          <div className="eyebrow">Quản trị truy cập</div>
          <h1>Account <span>/ Tài khoản</span></h1>
          <p>Admin quản lý tài khoản đăng nhập, vai trò, chi nhánh và trạng thái sử dụng hệ thống.</p>
        </div>
        <div className="employee-stat">
          <span className="employee-stat-icon"><UsersIcon size={24} /></span>
          <div><strong>{activeManagers}</strong><span>manager đang hoạt động</span></div>
        </div>
      </section>

      <section className="employee-card">
        <div className="employee-toolbar">
          <div className="toolbar-actions">
            <button className="button button-primary" type="button" onClick={openCreateForm}>
              <PlusIcon size={18} /> Thêm tài khoản
            </button>
          </div>
        </div>

        {message && (
          <div className={`alert ${message.type === "error" ? "alert-error" : "alert-success"}`} role="status">
            <AlertIcon size={20} />
            <div>
              <strong>{message.type === "error" ? "Không thể thực hiện" : "Đã lưu dữ liệu"}</strong>
              <span>{message.text}</span>
            </div>
          </div>
        )}

        <div className="employee-table-meta">
          <span>Hiển thị <strong>{accounts.length}</strong> tài khoản</span>
          <span>Người đăng nhập hiện tại: {currentUser?.username}</span>
        </div>

        <div className="employee-table-shell account-table-shell">
          <table className="employee-table account-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Họ tên</th>
                <th>Vai trò</th>
                <th>Chi nhánh</th>
                <th>Trạng thái</th>
                <th>Ngày tạo</th>
                <th>Người tạo</th>
                <th className="actions-column">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td className="employee-empty" colSpan={8}>Đang tải danh sách tài khoản...</td></tr>
              ) : accounts.length ? accounts.map((account) => (
                <tr key={account.id}>
                  <td>{account.username}</td>
                  <td>{account.fullName}</td>
                  <td><span className={`role-badge role-${account.role.toLowerCase()}`}>{account.role}</span></td>
                  <td>{account.branch || <span className="empty-cell">—</span>}</td>
                  <td><span className={`status-badge ${account.status === "Active" ? "active" : "inactive"}`}>{account.status}</span></td>
                  <td>{formatDateTime(account.createdAt)}</td>
                  <td>{account.createdBy}</td>
                  <td className="actions-column account-actions">
                    <div className="row-actions">
                      <button type="button" onClick={() => openEditForm(account)} aria-label={`Sửa ${account.username}`}><EditIcon /></button>
                      <button type="button" onClick={() => toggleStatus(account)}>{account.status === "Active" ? "Khóa" : "Mở"}</button>
                      <button type="button" onClick={() => openResetPassword(account)}>Reset</button>
                      <button className="danger-action" type="button" onClick={() => deleteAccount(account)} aria-label={`Xóa ${account.username}`}><TrashIcon /></button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td className="employee-empty" colSpan={8}>
                    <UsersIcon size={30} />
                    <strong>Chưa có tài khoản</strong>
                    <span>Thêm tài khoản Admin hoặc Manager để bắt đầu phân quyền.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {isFormOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !isSaving && setIsFormOpen(false)}>
          <div className="employee-modal account-modal" role="dialog" aria-modal="true" aria-labelledby="account-form-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <div className="eyebrow">Tài khoản đăng nhập</div>
                <h2 id="account-form-title">{editingAccount ? "Cập nhật tài khoản" : "Thêm tài khoản"}</h2>
              </div>
              <button className="icon-button" type="button" disabled={isSaving} onClick={() => setIsFormOpen(false)} aria-label="Đóng">
                <CloseIcon />
              </button>
            </div>

            <form onSubmit={saveAccount}>
              <div className="account-form-grid">
                <label className="form-field">
                  <span>Username</span>
                  <input value={formData.username} onChange={(event) => setFormData((current) => ({ ...current, username: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>{editingAccount ? "Mật khẩu mới (nếu cần)" : "Mật khẩu"}</span>
                  <div className="password-field">
                    <input type={showFormPassword ? "text" : "password"} value={formData.password} onChange={(event) => setFormData((current) => ({ ...current, password: event.target.value }))} />
                    <button type="button" onClick={() => setShowFormPassword((current) => !current)}>
                      <EyeIcon size={16} /> {showFormPassword ? "Ẩn" : "Xem"}
                    </button>
                  </div>
                </label>
                <label className="form-field form-field-wide">
                  <span>Họ tên</span>
                  <input value={formData.fullName} onChange={(event) => setFormData((current) => ({ ...current, fullName: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Vai trò</span>
                  <select value={formData.role} onChange={(event) => setFormData((current) => ({ ...current, role: event.target.value, branch: event.target.value === "Manager" ? current.branch || branchOptions[0] || "Q7" : "" }))}>
                    <option value="Admin">Admin</option>
                    <option value="Manager">Manager</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Chi nhánh</span>
                  <select value={formData.branch} disabled={formData.role !== "Manager"} onChange={(event) => setFormData((current) => ({ ...current, branch: event.target.value }))}>
                    <option value="">Không áp dụng</option>
                    {branchOptions.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                  </select>
                </label>
                <label className="form-field">
                  <span>Trạng thái</span>
                  <select value={formData.status} onChange={(event) => setFormData((current) => ({ ...current, status: event.target.value }))}>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </label>
              </div>
              <div className="modal-actions">
                <button className="button button-secondary" type="button" disabled={isSaving} onClick={() => setIsFormOpen(false)}>Hủy</button>
                <button className="button button-primary" type="submit" disabled={isSaving}>{isSaving ? "Đang lưu..." : "Lưu"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {resetTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !isSaving && setResetTarget(null)}>
          <div className="employee-modal account-reset-modal" role="dialog" aria-modal="true" aria-labelledby="reset-password-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <div className="eyebrow">Đặt lại mật khẩu</div>
                <h2 id="reset-password-title">{resetTarget.username}</h2>
              </div>
              <button className="icon-button" type="button" disabled={isSaving} onClick={() => setResetTarget(null)} aria-label="Đóng">
                <CloseIcon />
              </button>
            </div>
            <form onSubmit={submitResetPassword}>
              <label className="form-field">
                <span>Mật khẩu mới</span>
                <div className="password-field">
                  <input
                    type={showResetPassword ? "text" : "password"}
                    value={resetPasswordValue}
                    onChange={(event) => setResetPasswordValue(event.target.value)}
                    autoFocus
                  />
                  <button type="button" onClick={() => setShowResetPassword((current) => !current)}>
                    <EyeIcon size={16} /> {showResetPassword ? "Ẩn" : "Xem"}
                  </button>
                </div>
              </label>
              <div className="modal-actions">
                <button className="button button-secondary" type="button" disabled={isSaving} onClick={() => setResetTarget(null)}>Hủy</button>
                <button className="button button-primary" type="submit" disabled={isSaving}>{isSaving ? "Đang lưu..." : "Đặt lại"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
