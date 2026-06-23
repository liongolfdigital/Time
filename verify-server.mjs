import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

if (!process.env.DATABASE_URL || process.env.VERIFY_SERVER_WITH_DATABASE !== "1") {
  console.log("Skipping server verification: set VERIFY_SERVER_WITH_DATABASE=1 with a disposable DATABASE_URL to run API integration checks.");
  process.exit(0);
}

const port = 22000 + Math.floor(Math.random() * 5000);
const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "timekeeping-attachments-"));
const server = spawn(process.execPath, ["--no-warnings", "server.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    TIMEKEEPING_DATA_DIR: dataDirectory,
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let serverError = "";
server.stderr.on("data", (chunk) => { serverError += chunk; });

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://localhost:${port}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "Admin@123" }),
      });
      if (response.ok) return response.json();
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Attachment server did not start. ${serverError}`);
}

async function upload(token, name, type, replaceAttachmentId = "", branch = "Q7") {
  const form = new FormData();
  form.append("file", new File([`content:${name}`], name, { type }));
  form.append("uploadedBy", "Verification Manager");
  form.append("branch", branch);
  if (replaceAttachmentId) form.append("replaceAttachmentId", replaceAttachmentId);
  const response = await fetch(
    `http://localhost:${port}/api/attachments/verification-diary`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  return { response, payload: await response.json() };
}

async function loginAs(username, password = "Manager@123") {
  const response = await fetch(`http://localhost:${port}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { response, payload: await response.json() };
}

async function api(token, pathName, options = {}) {
  const response = await fetch(`http://localhost:${port}${pathName}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
  });
  const payload = response.status === 204 ? null : await response.json();
  return { response, payload };
}

try {
  const session = await waitForServer();
  assert.equal(session.user.role, "Admin");
  assert.equal(session.user.username, "admin");

  const { response: managerLogin, payload: managerSession } = await loginAs("manager_q7");
  assert.equal(managerLogin.status, 200);
  assert.equal(managerSession.user.branch, "Q7");

  const { payload: managerOl } = await loginAs("manager_ol");
  const { payload: managerTd } = await loginAs("manager_td");
  const { payload: managerRc } = await loginAs("manager_rc");
  const { payload: managerNhc } = await loginAs("manager_nhc");

  const seedEmployees = await api(session.token, "/api/employees/bulk", {
    method: "POST",
    body: JSON.stringify({
      employees: [
        { id: "emp-q7", branch: "Quận 7", employeeCode: "Q7-001", employeeName: "Lan Q7" },
        { id: "emp-ol", store: "Online", employeeCode: "OL-001", employeeName: "Minh OL" },
        { id: "emp-td", chiNhanh: "Thủ Đức", employeeCode: "TD-001", employeeName: "An TD" },
        { id: "emp-rc", employeeCode: "RC-001", employeeName: "Hoa" },
        { id: "emp-nhc", location: "NHC", employeeCode: "NHC-001", employeeName: "Nhi NHC" },
      ],
    }),
  });
  assert.equal(seedEmployees.response.status, 200);
  assert.deepEqual(
    seedEmployees.payload.map(({ branch }) => branch).sort(),
    ["NHC", "OL", "Q7", "RC", "TD"],
  );

  const seedDiary = await api(session.token, "/api/diary/bulk", {
    method: "POST",
    body: JSON.stringify({
      entries: [
        { id: "diary-q7", date: "2026-06-01", employeeCode: "Q7-001", employeeName: "Lan Q7", reason: "Q7 note", violationTypes: ["Đi trễ", "Tăng ca", "OFF"] },
        { id: "diary-ol", date: "2026-06-01", employeeCode: "OL-001", employeeName: "Minh OL", reason: "OL note" },
        { id: "diary-td", date: "2026-06-01", employeeCode: "TD-001", employeeName: "An TD", reason: "TD note" },
        { id: "diary-rc", date: "2026-06-01", employeeCode: "RC-001", employeeName: "RC - Hoa", reason: "RC note" },
        { id: "diary-nhc", date: "2026-06-01", employeeCode: "NHC-001", employeeName: "Nhi NHC", reason: "NHC note" },
      ],
    }),
  });
  assert.equal(seedDiary.response.status, 200);

  const q7Employees = await api(managerSession.token, "/api/employees");
  assert.deepEqual(q7Employees.payload.map(({ id }) => id), ["emp-q7"]);
  const olEmployees = await api(managerOl.token, "/api/employees");
  assert.deepEqual(olEmployees.payload.map(({ id }) => id), ["emp-ol"]);
  const tdEmployees = await api(managerTd.token, "/api/employees");
  assert.deepEqual(tdEmployees.payload.map(({ id }) => id), ["emp-td"]);
  const rcEmployees = await api(managerRc.token, "/api/employees");
  assert.deepEqual(rcEmployees.payload.map(({ id }) => id), ["emp-rc"]);
  const nhcEmployees = await api(managerNhc.token, "/api/employees");
  assert.deepEqual(nhcEmployees.payload.map(({ id }) => id), ["emp-nhc"]);

  const q7Diary = await api(managerSession.token, "/api/diary");
  assert.deepEqual(q7Diary.payload.map(({ id }) => id), ["diary-q7"]);
  assert.deepEqual(q7Diary.payload[0].violationTypes, ["Đi trễ", "Tăng ca", "OFF"]);
  const olDiary = await api(managerOl.token, "/api/diary");
  assert.deepEqual(olDiary.payload.map(({ id }) => id), ["diary-ol"]);
  assert.deepEqual(olDiary.payload[0].violationTypes, []);
  const tdDiary = await api(managerTd.token, "/api/diary");
  assert.deepEqual(tdDiary.payload.map(({ id }) => id), ["diary-td"]);
  const rcDiary = await api(managerRc.token, "/api/diary");
  assert.deepEqual(rcDiary.payload.map(({ id }) => id), ["diary-rc"]);
  const nhcDiary = await api(managerNhc.token, "/api/diary");
  assert.deepEqual(nhcDiary.payload.map(({ id }) => id), ["diary-nhc"]);

  const managerSpoofEmployee = await api(managerOl.token, "/api/employees", {
    method: "POST",
    body: JSON.stringify({ branch: "Q7", employeeCode: "BAD", employeeName: "Bad Q7" }),
  });
  assert.equal(managerSpoofEmployee.response.status, 403);
  assert.equal(managerSpoofEmployee.payload.error, "Bạn không có quyền truy cập dữ liệu chi nhánh này");

  const managerSpoofDiary = await api(managerOl.token, "/api/diary", {
    method: "POST",
    body: JSON.stringify({ date: "2026-06-02", employeeCode: "Q7-001", employeeName: "Lan Q7", reason: "Bad" }),
  });
  assert.equal(managerSpoofDiary.response.status, 403);
  assert.equal(managerSpoofDiary.payload.error, "Bạn không có quyền truy cập dữ liệu chi nhánh này");

  const managerOlImport = await api(managerOl.token, "/api/diary/bulk", {
    method: "POST",
    body: JSON.stringify({
      entries: [
        { id: "diary-ol-import-1", branch: "Q7", date: "2026-06-03", employeeCode: "OL-I01", employeeName: "OL Import 1", reason: "Import OL" },
        { id: "diary-ol-import-2", chiNhanh: "TD", date: "2026-06-04", employeeCode: "OL-I02", employeeName: "OL Import 2", reason: "Import OL" },
      ],
    }),
  });
  assert.equal(managerOlImport.response.status, 200);
  assert.deepEqual(managerOlImport.payload.map(({ branch }) => branch), ["OL", "OL"]);

  const managerOlExport = await api(managerOl.token, "/api/diary/export?branch=TD");
  assert.equal(managerOlExport.response.status, 200);
  assert.deepEqual(
    managerOlExport.payload.map(({ id }) => id).sort(),
    ["diary-ol-import-1", "diary-ol-import-2"],
  );
  assert.ok(managerOlExport.payload.every(({ branch }) => branch === "OL"));

  const managerQ7Import = await api(managerSession.token, "/api/diary/bulk", {
    method: "POST",
    body: JSON.stringify({
      entries: [
        { id: "diary-q7-import", branch: "OL", date: "2026-06-05", employeeCode: "Q7-I01", employeeName: "Q7 Import", reason: "Import Q7" },
      ],
    }),
  });
  assert.equal(managerQ7Import.response.status, 200);
  assert.deepEqual(managerQ7Import.payload.map(({ branch }) => branch), ["Q7"]);

  const managerQ7Export = await api(managerSession.token, "/api/diary/export");
  assert.deepEqual(managerQ7Export.payload.map(({ id }) => id), ["diary-q7-import"]);
  assert.ok(managerQ7Export.payload.every(({ branch }) => branch === "Q7"));

  const managerTdExport = await api(managerTd.token, "/api/diary/export");
  assert.deepEqual(managerTdExport.payload.map(({ id }) => id), ["diary-td"]);
  assert.ok(managerTdExport.payload.every(({ branch }) => branch === "TD"));

  const managerOlCrossBranchId = await api(managerOl.token, "/api/diary/bulk", {
    method: "POST",
    body: JSON.stringify({
      entries: [
        { id: "diary-td", branch: "OL", date: "2026-06-06", employeeCode: "OL-BAD", employeeName: "Bad collision", reason: "Bad" },
      ],
    }),
  });
  assert.equal(managerOlCrossBranchId.response.status, 403);

  const managerDeleteDiary = await api(managerOl.token, "/api/diary/diary-ol-import-1", {
    method: "DELETE",
  });
  assert.equal(managerDeleteDiary.response.status, 403);

  const adminDiaryExport = await api(session.token, "/api/diary/export");
  assert.equal(adminDiaryExport.response.status, 200);
  assert.deepEqual(
    [...new Set(adminDiaryExport.payload.map(({ branch }) => branch))].sort(),
    ["NHC", "OL", "Q7", "RC", "TD"],
  );
  assert.equal(adminDiaryExport.payload.length, 6);

  const managerOlBulkSeed = await Promise.all([
    api(managerOl.token, "/api/diary", {
      method: "POST",
      body: JSON.stringify({ id: "diary-ol-delete-1", date: "2026-06-07", employeeCode: "OL-001", employeeName: "Minh OL", reason: "Bulk 1" }),
    }),
    api(managerOl.token, "/api/diary", {
      method: "POST",
      body: JSON.stringify({ id: "diary-ol-delete-2", date: "2026-06-08", employeeCode: "OL-001", employeeName: "Minh OL", reason: "Bulk 2" }),
    }),
  ]);
  assert.ok(managerOlBulkSeed.every(({ response }) => response.status === 201));

  const managerOlBulkDelete = await api(managerOl.token, "/api/diary/bulk", {
    method: "DELETE",
    body: JSON.stringify({ ids: ["diary-ol-delete-1", "diary-ol-delete-2"] }),
  });
  assert.equal(managerOlBulkDelete.response.status, 200);
  assert.equal(managerOlBulkDelete.payload.deletedCount, 2);
  assert.deepEqual(managerOlBulkDelete.payload.deletedIds.sort(), ["diary-ol-delete-1", "diary-ol-delete-2"]);

  const managerCrossBranchBulkDelete = await api(managerOl.token, "/api/diary/bulk", {
    method: "DELETE",
    body: JSON.stringify({ ids: ["diary-td"] }),
  });
  assert.equal(managerCrossBranchBulkDelete.response.status, 403);
  assert.equal(managerCrossBranchBulkDelete.payload.error, "Bạn không có quyền truy cập dữ liệu chi nhánh này");
  const tdDiaryAfterBlockedDelete = await api(managerTd.token, "/api/diary");
  assert.deepEqual(tdDiaryAfterBlockedDelete.payload.map(({ id }) => id), ["diary-td"]);

  const emptyBulkDelete = await api(session.token, "/api/diary/bulk", {
    method: "DELETE",
    body: JSON.stringify({ ids: [] }),
  });
  assert.equal(emptyBulkDelete.response.status, 400);

  const authHeaders = { Authorization: `Bearer ${session.token}` };
  const configResponse = await fetch(
    `http://localhost:${port}/api/attachments/config`,
    { headers: authHeaders },
  );
  const config = await configResponse.json();
  assert.equal(config.maxFileSizeMb, 20);
  assert.ok(config.allowedExtensions.includes(".pdf"));

  const first = await upload(session.token, "GiayKhamBenh.pdf", "application/pdf");
  assert.equal(first.response.status, 201);
  assert.equal(first.payload.fileName, "GiayKhamBenh.pdf");
  assert.equal(first.payload.fileType, "application/pdf");
  assert.equal(first.payload.uploadedBy, "Verification Manager");
  assert.equal(first.payload.uploadedByUsername, "admin");
  assert.equal(first.payload.diaryEntryId, "verification-diary");
  assert.equal(first.payload.branch, "Q7");
  assert.ok(first.payload.fileSize > 0);
  assert.ok(first.payload.filePath.includes(first.payload.id));

  const content = await fetch(`http://localhost:${port}${first.payload.filePath}`, {
    headers: authHeaders,
  });
  assert.equal(content.status, 200);
  assert.equal(content.headers.get("content-type"), "application/pdf");

  const replacement = await upload(
    session.token,
    "AnhXacNhan.png",
    "image/png",
    first.payload.id,
  );
  assert.equal(replacement.response.status, 200);
  assert.equal(replacement.payload.id, first.payload.id);
  assert.equal(replacement.payload.fileName, "AnhXacNhan.png");

  const invalid = await upload(session.token, "khong-hop-le.txt", "text/plain");
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.payload.error, /không được hỗ trợ/i);

  const managerListResponse = await fetch(
    `http://localhost:${port}/api/attachments?diaryEntryId=verification-diary`,
    { headers: { Authorization: `Bearer ${managerSession.token}` } },
  );
  const managerAttachments = await managerListResponse.json();
  assert.equal(managerAttachments.length, 1);
  assert.equal(managerAttachments[0].branch, "Q7");

  const managerDeleteOtherUpload = await fetch(
    `http://localhost:${port}/api/attachments/${first.payload.id}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${managerSession.token}` },
    },
  );
  assert.equal(managerDeleteOtherUpload.status, 403);

  const listResponse = await fetch(
    `http://localhost:${port}/api/attachments?diaryEntryId=verification-diary`,
    { headers: authHeaders },
  );
  const attachments = await listResponse.json();
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].fileName, "AnhXacNhan.png");

  const deleteResponse = await fetch(
    `http://localhost:${port}/api/diary/verification-diary/attachments`,
    { method: "DELETE", headers: authHeaders },
  );
  assert.equal(deleteResponse.status, 204);

  console.log("Auth, Diary branch import/export, and attachment server verification passed");
} finally {
  if (server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
  }
  fs.rmSync(dataDirectory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
