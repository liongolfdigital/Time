export function createAuthMiddlewares({ getSession, readBearerToken }) {
  async function requireAuth(request, response, next) {
    const session = await getSession(readBearerToken(request));
    if (!session) return response.status(401).json({ error: "Vui long dang nhap." });
    request.sessionTokenHash = session.tokenHash;
    request.user = session.user;
    return next();
  }

  function requireAdmin(request, response, next) {
    return request.user?.role === "Admin"
      ? next()
      : response.status(403).json({ error: "Ban khong co quyen truy cap chuc nang nay" });
  }

  function requireDiaryImportExport(request, response, next) {
    return ["Admin", "Manager"].includes(request.user?.role)
      ? next()
      : response.status(403).json({ error: "Ban khong co quyen truy cap chuc nang nay" });
  }

  return { requireAuth, requireAdmin, requireDiaryImportExport };
}
