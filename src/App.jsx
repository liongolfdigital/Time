import { useEffect, useMemo, useState } from "react";
import AccountPage from "./components/AccountPage";
import AttendancePage from "./components/AttendancePage";
import DiaryPage from "./components/DiaryPage";
import EmployeePage from "./components/EmployeePage";
import LoginPage from "./components/LoginPage";
import ProcessPage from "./components/ProcessPage";
import { BookIcon, ClockIcon, FilterIcon, UsersIcon } from "./components/Icons";
import { fetchCurrentUser, logAction, logout } from "./api/authApi";
import {
  clearAuthSession,
  getStoredAuthToken,
  getStoredAuthUser,
  isApiUnavailableError,
} from "./api/apiClient";
import { diaryApi } from "./api/diaryApi";
import { employeeApi } from "./api/employeeApi";
import {
  canAccessBranch,
  canAccessPage,
  defaultPageForUser,
  getDiaryEntryBranch,
  getRecordBranch,
  isAdmin,
  isManager,
} from "./auth/authorization";
import {
  loadStoredEmployees,
  saveStoredEmployees,
} from "./employees/employeeModel";
import { DEFAULT_SHIFT_RULES, loadStoredShiftRules } from "./rules/shiftRuleEngine";
import {
  loadStoredDiaryEntries,
  saveStoredDiaryEntries,
} from "./diary/diaryModel";
import {
  DEFAULT_MAX_ATTACHMENT_SIZE_MB,
  getAttachmentConfig,
  listDiaryAttachments,
} from "./diary/attachmentStorage";

// Cấu hình nhãn/icon điều hướng; quyền từng page được kiểm tra riêng trong authorization.
const PAGE_CONFIG = {
  attendance: { label: "Xử lý chấm công", icon: ClockIcon },
  process: { label: "Xử lý", icon: FilterIcon },
  employees: { label: "Nhân viên / Giờ ĐK", icon: UsersIcon },
  diary: { label: "Diary / Ghi chú", icon: BookIcon },
  accounts: { label: "Account", icon: UsersIcon },
};

// Đọc page người dùng yêu cầu từ hash/path và loại route không tồn tại.
function readRequestedPage() {
  const hashPage = window.location.hash.replace(/^#\/?/, "");
  const pathPage = window.location.pathname.replace(/^\/+/, "").split("/")[0];
  const requested = hashPage || pathPage;
  return PAGE_CONFIG[requested] ? requested : "";
}

// Ánh xạ page nội bộ sang URL dùng bởi History API.
function pagePath(page) {
  return page === "attendance" ? "/" : `/${page}`;
}

// Ghi diagnostic nguồn dữ liệu chỉ trong môi trường development.
function debugDataLoad(label, detail) {
  if (import.meta.env.DEV) {
    console.debug(`[TimeKeeping data] ${label}`, detail);
  }
}

function loadLocalEmployeesForDev() {
  return import.meta.env.DEV ? loadStoredEmployees() : [];
}

function loadLocalDiaryForDev() {
  return import.meta.env.DEV ? loadStoredDiaryEntries() : [];
}

function loadShiftRulesForRuntime() {
  return import.meta.env.DEV ? loadStoredShiftRules() : DEFAULT_SHIFT_RULES;
}

/**
 * Component gốc điều phối session, routing, dữ liệu nhân viên/Diary/attachment và phân quyền page.
 * Các thay đổi dữ liệu production đi qua API; cache localStorage chỉ dùng cho dev/migrate cũ.
 */
export default function App() {
  // State phiên/routing và các tập dữ liệu production dùng chung cho các page con.
  const [currentUser, setCurrentUser] = useState(getStoredAuthUser);
  const [isCheckingAuth, setIsCheckingAuth] = useState(Boolean(getStoredAuthToken()));
  const [activePage, setActivePage] = useState("attendance");
  const [accessDenied, setAccessDenied] = useState("");
  const [employees, setEmployees] = useState(loadLocalEmployeesForDev);
  const [diaryEntries, setDiaryEntries] = useState(loadLocalDiaryForDev);
  const [attachments, setAttachments] = useState([]);
  const [attachmentConfig, setAttachmentConfig] = useState({
    maxFileSizeMb: DEFAULT_MAX_ATTACHMENT_SIZE_MB,
  });
  const [attachmentError, setAttachmentError] = useState("");
  const [shiftRules] = useState(loadShiftRulesForRuntime);

  // Ghi cache nhân viên nhưng giữ nguyên dữ liệu chi nhánh khác khi user là Manager.
  const persistEmployeesForUser = (nextEmployees, user = currentUser) => {
    if (!import.meta.env.DEV) return;
    if (!user) return;
    if (isAdmin(user)) {
      saveStoredEmployees(nextEmployees);
      return;
    }
    if (!isManager(user)) return;

    const storedEmployees = loadStoredEmployees();
    const otherBranches = storedEmployees.filter((employee) =>
      !canAccessBranch(user, getRecordBranch(employee)),
    );
    const scopedEmployees = nextEmployees.filter((employee) =>
      canAccessBranch(user, getRecordBranch(employee)),
    );
    saveStoredEmployees([...otherBranches, ...scopedEmployees]);
  };

  // Ghi cache Diary theo đúng scope chi nhánh, suy chi nhánh qua hồ sơ nhân viên khi cần.
  const persistDiaryEntriesForUser = (nextEntries, user = currentUser, employeeList = employees) => {
    if (!import.meta.env.DEV) return;
    if (!user) return;
    if (isAdmin(user)) {
      saveStoredDiaryEntries(nextEntries);
      return;
    }
    if (!isManager(user)) return;

    const storedEntries = loadStoredDiaryEntries();
    const branchEmployees = [...loadStoredEmployees(), ...employeeList];
    const otherBranches = storedEntries.filter((entry) =>
      !canAccessBranch(user, getDiaryEntryBranch(entry, branchEmployees)),
    );
    const scopedEntries = nextEntries.filter((entry) =>
      canAccessBranch(user, getDiaryEntryBranch(entry, branchEmployees)),
    );
    saveStoredDiaryEntries([...otherBranches, ...scopedEntries]);
  };

  // Đồng bộ state và cache sau thao tác CRUD/import nhân viên từ EmployeePage.
  const handleEmployeesChange = (nextEmployees) => {
    setEmployees(nextEmployees);
    persistEmployeesForUser(nextEmployees);
  };

  // Đồng bộ state và cache sau thao tác CRUD/import Diary từ DiaryPage.
  const handleDiaryEntriesChange = (nextEntries) => {
    setDiaryEntries(nextEntries);
    persistDiaryEntriesForUser(nextEntries);
  };

  // Kiểm tra token lưu sẵn với server khi App khởi động; xóa phiên nếu không còn hợp lệ.
  useEffect(() => {
    if (!getStoredAuthToken()) {
      setIsCheckingAuth(false);
      return;
    }

    let active = true;
    fetchCurrentUser()
      .then((user) => {
        if (active) setCurrentUser(user);
      })
      .catch(() => {
        clearAuthSession();
        if (active) setCurrentUser(null);
      })
      .finally(() => {
        if (active) setIsCheckingAuth(false);
      });
    return () => { active = false; };
  }, []);

  // Tải attachment và giới hạn upload sau đăng nhập, fallback rỗng nếu API chưa sẵn sàng.
  useEffect(() => {
    if (!currentUser) {
      setAttachments([]);
      return undefined;
    }

    let active = true;
    Promise.all([listDiaryAttachments(), getAttachmentConfig()])
      .then(([storedAttachments, storedConfig]) => {
        if (!active) return;
        setAttachments(storedAttachments);
        setAttachmentConfig(storedConfig);
        setAttachmentError("");
      })
      .catch((error) => {
        if (!active) return;
        if (isApiUnavailableError(error)) {
          console.warn("[TimeKeeping data] Attachment API unavailable, continuing without server attachments.", {
            endpoint: error.endpoint,
            status: error.status,
            message: error.message,
          });
          setAttachments([]);
          setAttachmentConfig({ maxFileSizeMb: DEFAULT_MAX_ATTACHMENT_SIZE_MB });
          setAttachmentError("");
          return;
        }
        setAttachmentError(error.message);
      });
    return () => { active = false; };
  }, [currentUser]);

  // Tải nhân viên/Diary từ API; tự migrate cache local cho Admin khi database đang trống.
  useEffect(() => {
    if (!currentUser) return undefined;

    let active = true;
    const localEmployees = loadLocalEmployeesForDev();
    const localDiaryEntries = loadLocalDiaryForDev();

    debugDataLoad("load:start", {
      currentUser,
      role: currentUser.role,
      branch: currentUser.branch,
      localEmployees: localEmployees.length,
      localDiary: localDiaryEntries.length,
      endpoints: ["/api/employees", "/api/diary"],
    });

    Promise.allSettled([employeeApi.list(), diaryApi.list()])
      .then(async ([employeeResult, diaryResult]) => {
        let nextEmployees = localEmployees;
        let nextDiaryEntries = localDiaryEntries;
        let employeeSource = "localStorage";
        let diarySource = "localStorage";

        if (employeeResult.status === "fulfilled") {
          const serverEmployees = employeeResult.value;
          employeeSource = "api";
          nextEmployees = serverEmployees;

          if (serverEmployees.length === 0 && localEmployees.length > 0) {
            if (isAdmin(currentUser)) {
              try {
                nextEmployees = await employeeApi.replaceAll(localEmployees);
                employeeSource = "api:migrated-from-localStorage";
              } catch (error) {
                if (!isApiUnavailableError(error)) throw error;
                employeeSource = "localStorage:bulk-api-unavailable";
                nextEmployees = localEmployees;
              }
            } else {
              employeeSource = "localStorage:empty-api";
              nextEmployees = localEmployees;
            }
          }
        } else if (!isApiUnavailableError(employeeResult.reason)) {
          throw employeeResult.reason;
        }

        if (diaryResult.status === "fulfilled") {
          const serverDiaryEntries = diaryResult.value;
          diarySource = "api";
          nextDiaryEntries = serverDiaryEntries;

          if (serverDiaryEntries.length === 0 && localDiaryEntries.length > 0) {
            if (isAdmin(currentUser)) {
              try {
                nextDiaryEntries = await diaryApi.replaceAll(localDiaryEntries);
                diarySource = "api:migrated-from-localStorage";
              } catch (error) {
                if (!isApiUnavailableError(error)) throw error;
                diarySource = "localStorage:bulk-api-unavailable";
                nextDiaryEntries = localDiaryEntries;
              }
            } else {
              diarySource = "localStorage:empty-api";
              nextDiaryEntries = localDiaryEntries;
            }
          }
        } else if (!isApiUnavailableError(diaryResult.reason)) {
          throw diaryResult.reason;
        }

        if (!active) return;
        setEmployees(nextEmployees);
        setDiaryEntries(nextDiaryEntries);
        if (import.meta.env.DEV && isAdmin(currentUser)) {
          saveStoredEmployees(nextEmployees);
          saveStoredDiaryEntries(nextDiaryEntries);
        }
        setAttachmentError("");
        debugDataLoad("load:done", {
          currentUser,
          role: currentUser.role,
          branch: currentUser.branch,
          rawEmployees: nextEmployees.length,
          rawDiary: nextDiaryEntries.length,
          employeeSource,
          diarySource,
        });
      })
      .catch((error) => {
        if (!active) return;
        if (isApiUnavailableError(error)) {
          setEmployees(localEmployees);
          setDiaryEntries(localDiaryEntries);
          setAttachmentError("");
          debugDataLoad("load:fallback", {
            currentUser,
            role: currentUser.role,
            branch: currentUser.branch,
            rawEmployees: localEmployees.length,
            rawDiary: localDiaryEntries.length,
            endpoint: error.endpoint,
            status: error.status,
            message: error.message,
          });
          return;
        }
        setAttachmentError(error.message);
      });

    return () => { active = false; };
  }, [currentUser]);

  // Giải route theo quyền user, chuyển về page mặc định và hiển thị cảnh báo nếu bị từ chối.
  const resolveRoute = (user, { replace = false } = {}) => {
    if (!user) return;
    const requestedPage = readRequestedPage();
    const fallbackPage = defaultPageForUser(user);
    const nextPage = requestedPage || fallbackPage;

    if (canAccessPage(user, nextPage)) {
      setActivePage(nextPage);
      setAccessDenied("");
      if (replace && window.location.pathname !== pagePath(nextPage)) {
        window.history.replaceState({}, "", pagePath(nextPage));
      }
      return;
    }

    setActivePage(fallbackPage);
    setAccessDenied("Bạn không có quyền truy cập chức năng này");
    if (replace) window.history.replaceState({}, "", pagePath(fallbackPage));
  };

  // Đồng bộ activePage với nút Back/Forward của trình duyệt.
  useEffect(() => {
    if (!currentUser) return undefined;
    resolveRoute(currentUser, { replace: true });
    const handlePopState = () => resolveRoute(currentUser);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [currentUser]);

  // Gắn attachment vào từng Diary để màn chấm công và chi tiết dùng chung một shape dữ liệu.
  const diaryEntriesWithAttachments = useMemo(
    () => diaryEntries.map((entry) => {
      const entryAttachments = attachments.filter(({ diaryEntryId }) => diaryEntryId === entry.id);
      return { ...entry, attachments: entryAttachments, attachedFiles: entryAttachments };
    }),
    [attachments, diaryEntries],
  );

  // Điều hướng page bằng History API sau khi kiểm tra quyền frontend.
  const openPage = (page) => {
    if (!canAccessPage(currentUser, page)) {
      setAccessDenied("Bạn không có quyền truy cập chức năng này");
      setActivePage(defaultPageForUser(currentUser));
      return;
    }
    setAccessDenied("");
    setActivePage(page);
    window.history.pushState({}, "", pagePath(page));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Nhận user từ LoginPage và đưa họ về page mặc định theo vai trò.
  const handleLogin = (user) => {
    setCurrentUser(user);
    const nextPage = defaultPageForUser(user);
    setActivePage(nextPage);
    setAccessDenied("");
    window.history.replaceState({}, "", pagePath(nextPage));
  };

  // Đăng xuất API, dọn state session và trả URL về trang gốc.
  const handleLogout = async () => {
    await logout();
    setCurrentUser(null);
    setAccessDenied("");
    setActivePage("attendance");
    window.history.replaceState({}, "", "/");
  };

  if (isCheckingAuth) {
    return (
      <main className="login-page">
        <section className="login-card">
          <div className="eyebrow">Hệ thống chấm công nội bộ</div>
          <h1>Đang kiểm tra phiên đăng nhập...</h1>
        </section>
      </main>
    );
  }

  if (!currentUser) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const navPages = isAdmin(currentUser)
    ? ["attendance", "process", "employees", "diary", "accounts"]
    : ["employees", "diary"];

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand brand-button" type="button" onClick={() => openPage(defaultPageForUser(currentUser))} aria-label="Trang chủ Chấm công nội bộ">
          <span className="brand-logo">
            <img src="/images/LionBlk.png" alt="Lion Golf" />
          </span>
          <span><strong>Chấm công</strong><small>Nội bộ</small></span>
        </button>

        <nav className="main-nav" aria-label="Điều hướng chính">
          {navPages.map((page) => {
            const Icon = PAGE_CONFIG[page].icon;
            return (
              <button className={activePage === page ? "active" : ""} type="button" key={page} onClick={() => openPage(page)}>
                <Icon size={page === "employees" ? 18 : 17} /> {PAGE_CONFIG[page].label}
              </button>
            );
          })}
        </nav>

        <div className="session-badge">
          <span className="privacy-dot" />
          <span>{currentUser.fullName} 
            {/* · {currentUser.role}{currentUser.branch ? ` ${currentUser.branch}` : ""} */}
          </span>
          <button type="button" onClick={handleLogout}>Đăng xuất</button>
        </div>
      </header>

      {accessDenied && (
        <main className="access-denied">
          <div className="alert alert-error" role="alert">
            <span className="privacy-dot" />
            <div>
              <strong>Không có quyền</strong>
              <span>{accessDenied}</span>
            </div>
          </div>
        </main>
      )}

      {activePage === "attendance" && isAdmin(currentUser) && (
        <AttendancePage employees={employees} diaryEntries={diaryEntriesWithAttachments} shiftRules={shiftRules} onOpenEmployees={() => openPage("employees")} onOpenDiary={() => openPage("diary")} />
      )}
      {activePage === "process" && isAdmin(currentUser) && (
        <ProcessPage employees={employees} diaryEntries={diaryEntriesWithAttachments} shiftRules={shiftRules} />
      )}
      {activePage === "employees" && (
        <EmployeePage
          currentUser={currentUser}
          employees={employees}
          onEmployeesChange={handleEmployeesChange}
          onLogAction={logAction}
        />
      )}
      {activePage === "diary" && (
        <DiaryPage
          currentUser={currentUser}
          employees={employees}
          entries={diaryEntries}
          attachments={attachments}
          attachmentConfig={attachmentConfig}
          attachmentError={attachmentError}
          onEntriesChange={handleDiaryEntriesChange}
          onAttachmentsChange={setAttachments}
          onLogAction={logAction}
        />
      )}
      {activePage === "accounts" && isAdmin(currentUser) && (
        <AccountPage currentUser={currentUser} />
      )}

      <footer>
        <span>Chấm Công LionGolf by ND</span>
        <span>© 2026 All Rights Reserved</span>
      </footer>
    </div>
  );
}
