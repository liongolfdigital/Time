// Giá trị role canonical dùng chung giữa UI và API phân quyền.
export const ROLES = Object.freeze({
  ADMIN: "Admin",
  MANAGER: "Manager",
  USER: "User",
});

// Trạng thái account canonical dùng cho khóa/mở đăng nhập.
export const ACCOUNT_STATUSES = Object.freeze({
  ACTIVE: "Active",
  INACTIVE: "Inactive",
});
