import { useState } from "react";
import { AlertIcon, ClockIcon, EyeIcon, EyeOffIcon } from "./Icons";
import { login } from "../api/authApi";

/** Màn hình đăng nhập; quản lý credential, trạng thái loading và thông báo lỗi. */
export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Chặn submit mặc định, gọi API login và chuyển user thành công lên App.
  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const session = await login(username, password);
      onLogin(session.user);
    } catch (loginError) {
      setError(loginError.message || "Không thể đăng nhập.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <span className="brand-mark"><ClockIcon size={28} /></span>
          <div>
            <div className="eyebrow">Hệ thống chấm công nội bộ</div>
            <h1>Đăng nhập</h1>
            <p>Vui lòng đăng nhập để sử dụng đúng phạm vi quyền được cấp.</p>
          </div>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Username</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
              placeholder="admin hoặc manager_q7"
            />
          </label>
          <label className="form-field">
            <span>Password</span>
            <div className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="Nhập mật khẩu"
              />
              <button type="button" onClick={() => setShowPassword((current) => !current)}>
                {showPassword ? <EyeIcon size={16} /> : <EyeOffIcon size={16} />}
              </button>
            </div>
          </label>

          {error && (
            <div className="alert alert-error" role="alert">
              <AlertIcon size={20} />
              <div>
                <strong>Không thể đăng nhập</strong>
                <span>{error}</span>
              </div>
            </div>
          )}

          <button className="button button-primary login-button" type="submit" disabled={isLoading}>
            {isLoading ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
        </form>
      </section>
    </main>
  );
}
