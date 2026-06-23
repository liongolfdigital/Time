/**
 * Tính toán chấm công thuần cho từng dòng, không đọc/ghi Excel hay gọi API.
 * Luồng chính: parse clock -> chọn ca từ Employees/rule -> tính Tổng làm và các phát sinh
 * -> áp ngoại lệ Q7 Thứ 2/VP Thứ 7/full ngày -> trả số phút, ca và ghi chú cho processor.
 */
import { normalizeEmployeeCode, normalizeLookup, normalizeText } from "../employees/employeeModel.js";
import { CLOCK_SLOT_LABELS, MINUTES_PER_DAY } from "../constants/attendanceConstants.js";
import {
  calculateTotalWorkedMinutes,
  formatDurationMinutes,
  timeValueToMinutes,
  totalHoursValueToMinutes,
} from "../utils/timeUtils.js";
import {
  applyQ7MondayWindow,
  parseRegisteredShiftMinutes,
} from "../services/attendance/q7RuleService.js";
import {
  getVPSaturdayShift,
  getVPSaturdayShiftAssignment,
  isSaturday,
  isVPEmployee,
  isVpEmployee,
} from "../services/attendance/vpRuleService.js";
import {
  calculateLateEarlyMetrics,
  calculateLatePenalty,
} from "../services/attendance/lateEarlyService.js";
import { calculateOvertimeMinutes } from "../services/attendance/overtimeService.js";
import { isThuDucEmployee } from "../services/attendance/thuDucRuleService.js";

export {
  calculateLatePenalty,
  calculateTotalWorkedMinutes,
  formatDurationMinutes,
  getVPSaturdayShift,
  getVPSaturdayShiftAssignment,
  isSaturday,
  isVPEmployee,
  isVpEmployee,
  timeValueToMinutes,
  totalHoursValueToMinutes,
};

// Tính khoảng cách vòng tròn giữa hai mốc giờ trong một ngày.
function clockDistance(first, second) {
  const directDistance = Math.abs(first - second);
  return Math.min(directDistance, MINUTES_PER_DAY - directDistance);
}

// Ngưỡng nhận diện giờ ra thuộc ca chiều khi xét ngoại lệ làm full ngày sáng - chiều.
export const FULL_DAY_SHIFT_MATCH_THRESHOLD_MINUTES = 90;

// Chọn mốc vào sớm nhất từ Vào 1/Vào 2 và ghi lại cột nguồn.
function selectActualIn(clockValues) {
  const candidates = [
    { minutes: timeValueToMinutes(clockValues.in1), source: "Vào 1" },
    { minutes: timeValueToMinutes(clockValues.in2), source: "Vào 2" },
  ].filter(({ minutes }) => minutes !== null);

  if (candidates.length === 0) return { minutes: null, source: null };

  return candidates.reduce((earliest, candidate) =>
    candidate.minutes < earliest.minutes ? candidate : earliest,
  );
}

// Định dạng một giá trị clock hỗn hợp thành HH:mm để đưa vào log điều chỉnh.
function formatClockValue(value) {
  const minutes = timeValueToMinutes(value);
  if (minutes === null) return normalizeText(value);

  const roundedMinutes = Math.round(minutes) % MINUTES_PER_DAY;
  const hours = Math.floor(roundedMinutes / 60);
  const minutePart = roundedMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutePart).padStart(2, "0")}`;
}

// Định dạng số phút thành HH:mm theo đồng hồ 24 giờ.
function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return null;
  const roundedMinutes = Math.round(minutes) % MINUTES_PER_DAY;
  const normalizedMinutes = roundedMinutes < 0
    ? roundedMinutes + MINUTES_PER_DAY
    : roundedMinutes;
  return `${String(Math.floor(normalizedMinutes / 60)).padStart(2, "0")}:${String(
    normalizedMinutes % 60,
  ).padStart(2, "0")}`;
}

// Kiểm tra cell clock có dữ liệu thô hay không, chưa đánh giá tính hợp lệ của giờ.
function hasClockValue(value) {
  return value !== null && value !== undefined && value !== "";
}

// Lấy giờ bắt đầu ca từ override của rule hoặc field hồ sơ nhân viên.
function getShiftStartValue(employee, shift) {
  return shift.startValue ?? employee[shift.startField];
}

// Lấy giờ kết thúc ca từ override của rule hoặc field hồ sơ nhân viên.
function getShiftEndValue(employee, shift) {
  return shift.endValue ?? employee[shift.endField];
}

// Dựng các mốc Vào/Ra đăng ký dùng phân loại lại bốn cột clock trước khi tính.
function getRegisteredMarkers(employee, shiftAssignment, shiftCandidates = []) {
  const markerValues = shiftAssignment
    ? {
        in: [
          [
            `Vào ${shiftAssignment.shift.name}`,
            getShiftStartValue(employee, shiftAssignment.shift),
          ],
        ],
        out: [
          [
            `Ra ${shiftAssignment.shift.name}`,
            getShiftEndValue(employee, shiftAssignment.shift),
          ],
        ],
      }
    : shiftCandidates.length > 0
      ? {
          in: shiftCandidates.map((shift) => [`Vào ${shift.name}`, getShiftStartValue(employee, shift)]),
          out: shiftCandidates.map((shift) => [`Ra ${shift.name}`, getShiftEndValue(employee, shift)]),
        }
    : {
    in: [
      ["Vào sáng", employee.morningIn],
      ["Vào chiều", employee.afternoonIn],
      ["Vào tối", employee.eveningIn],
    ],
    out: [
      ["Ra sáng", employee.morningOut],
      ["Ra chiều", employee.afternoonOut],
      ["Ra tối", employee.eveningOut],
    ],
      };

  return Object.fromEntries(
    Object.entries(markerValues).map(([type, markers]) => [
      type,
      markers
        .map(([label, value]) => ({ label, minutes: timeValueToMinutes(value) }))
        .filter(({ minutes }) => minutes !== null),
    ]),
  );
}

// Tìm mốc đăng ký gần giờ thực tế nhất trong một nhóm Vào hoặc Ra.
function findNearestMarker(actualMinutes, markers) {
  if (markers.length === 0) return null;

  return markers.reduce((nearest, marker) =>
    clockDistance(actualMinutes, marker.minutes) <
    clockDistance(actualMinutes, nearest.minutes)
      ? marker
      : nearest,
  );
}

// Phân loại một clock là Vào/Ra theo khoảng cách tới các mốc đăng ký.
function classifyClockValue(value, originalType, registeredMarkers) {
  const actualMinutes = timeValueToMinutes(value);
  if (actualMinutes === null) return null;

  const nearestIn = findNearestMarker(actualMinutes, registeredMarkers.in);
  const nearestOut = findNearestMarker(actualMinutes, registeredMarkers.out);
  if (!nearestIn && !nearestOut) return null;
  if (!nearestIn) return { type: "out", marker: nearestOut };
  if (!nearestOut) return { type: "in", marker: nearestIn };

  const inDistance = clockDistance(actualMinutes, nearestIn.minutes);
  const outDistance = clockDistance(actualMinutes, nearestOut.minutes);
  if (inDistance === outDistance) {
    return {
      type: originalType,
      marker: originalType === "in" ? nearestIn : nearestOut,
    };
  }

  return inDistance < outDistance
    ? { type: "in", marker: nearestIn }
    : { type: "out", marker: nearestOut };
}

// Tạo ghi chú audit khi một clock được chuyển sang cột Vào/Ra khác.
function makeMoveNote(value, sourceSlot, targetSlot) {
  return `Đã chuyển ${formatClockValue(value)} từ ${CLOCK_SLOT_LABELS[sourceSlot]} sang ${CLOCK_SLOT_LABELS[targetSlot]}`;
}

/**
 * Chuẩn hóa vị trí bốn mốc Vào/Ra trước khi chọn ca và tính chấm công.
 * @param {object} employee - Hồ sơ Employees chứa các mốc giờ đăng ký.
 * @param {object} clockValues - Bốn clock thô in1/out1/in2/out2 của dòng nguồn.
 * @param {object|null} shiftAssignment - Ca được rule gán trước, nếu có.
 * @param {object[]} shiftCandidates - Danh sách ca tùy chỉnh dùng thay các ca trong Employees.
 * @returns {object} Clock gốc/đã chỉnh, map cột nguồn và ghi chú audit; không sửa input.
 */
export function adjustClockColumns(
  employee,
  clockValues,
  shiftAssignment = null,
  shiftCandidates = [],
) {
  const original = { ...clockValues };
  const adjusted = { in1: null, out1: null, in2: null, out2: null };
  const sourceSlots = { in1: null, out1: null, in2: null, out2: null };
  const notes = [];
  const registeredMarkers = getRegisteredMarkers(employee, shiftAssignment, shiftCandidates);
  const slots = ["in1", "out1", "in2", "out2"];
  const targetSlots = { in: ["in1", "in2"], out: ["out1", "out2"] };
  const punches = slots
    .filter((slot) => hasClockValue(original[slot]))
    .map((sourceSlot) => {
      const originalType = sourceSlot.startsWith("in") ? "in" : "out";
      const classification = classifyClockValue(
        original[sourceSlot],
        originalType,
        registeredMarkers,
      );
      return {
        sourceSlot,
        originalType,
        targetType: classification?.type ?? originalType,
        value: original[sourceSlot],
      };
    });
  let changed = false;

  punches
    .filter(({ originalType, targetType }) => originalType === targetType)
    .forEach(({ sourceSlot, value }) => {
      adjusted[sourceSlot] = value;
      sourceSlots[sourceSlot] = sourceSlot;
    });

  punches
    .filter(({ originalType, targetType }) => originalType !== targetType)
    .forEach(({ sourceSlot, targetType, value }) => {
      const pairNumber = sourceSlot.endsWith("1") ? "1" : "2";
      const preferredTarget = `${targetType}${pairNumber}`;
      const availableTarget =
        (adjusted[preferredTarget] === null && preferredTarget) ||
        targetSlots[targetType].find((slot) => adjusted[slot] === null);

      if (availableTarget) {
        adjusted[availableTarget] = value;
        sourceSlots[availableTarget] = sourceSlot;
        notes.push(makeMoveNote(value, sourceSlot, availableTarget));
        changed = true;
        return;
      }

      adjusted[sourceSlot] = value;
      sourceSlots[sourceSlot] = sourceSlot;
      const targetLabel = targetType === "in" ? "Vào" : "Ra";
      notes.push(
        `Không thể chuyển ${formatClockValue(value)} từ ${CLOCK_SLOT_LABELS[sourceSlot]} vì cả hai cột ${targetLabel} đã có dữ liệu; giữ nguyên giá trị`,
      );
    });

  return {
    original,
    adjusted,
    sourceSlots,
    notes,
    changed,
    hasLog: notes.length > 0,
  };
}

/**
 * Chọn ca có giờ vào gần giờ thực tế nhất; dùng Giờ ĐK, giờ ra và thứ tự ca để phân xử hòa.
 * Đồng thời áp khung Q7 Thứ 2 lên từng ứng viên trước khi so sánh.
 * @returns {object|null} Ca đã chọn kèm giờ chuẩn/phút lệch, hoặc null khi thiếu mốc ca.
 */
export function determineNearestShift(employee, clockValues, shiftCandidates = [], options = {}) {
  const actualIn = selectActualIn(clockValues).minutes;
  const selectedActualOut = selectActualOut(clockValues);
  const actualOut = normalizeActualOut(actualIn, selectedActualOut.minutes);

  if (actualIn === null && actualOut === null) return null;

  const candidateSource = Array.isArray(shiftCandidates) && shiftCandidates.length > 0
    ? shiftCandidates
    : [
    // Ca mặc định luôn lấy từ hồ sơ Employees; chi nhánh chỉ kích hoạt rule đặc biệt, không cấp giờ ca.
    { key: "morning", name: "Sáng", startValue: employee.morningIn, endValue: employee.morningOut },
    { key: "afternoon", name: "Chiều", startValue: employee.afternoonIn, endValue: employee.afternoonOut },
    { key: "evening", name: "Tối", startValue: employee.eveningIn, endValue: employee.eveningOut },
  ];

  const normalizedShiftCandidates = candidateSource
    .map((candidate, index) => {
      const start = timeValueToMinutes(candidate.startValue);
      let end = timeValueToMinutes(candidate.endValue);

      if (start !== null && end !== null && end < start) {
        end += MINUTES_PER_DAY;
      }

      const q7MondayWindow = start !== null && end !== null
        ? applyQ7MondayWindow({
            employee,
            employeeName: options.employeeName,
            attendanceDate: options.attendanceDate,
            start,
            end,
          })
        : { start, end, q7MondayShopShortageMinutes: 0, q7MondayAdjusted: false };

      return {
        ...candidate,
        index,
        start: q7MondayWindow.start,
        end: q7MondayWindow.end,
        q7MondayShopShortageMinutes: q7MondayWindow.q7MondayShopShortageMinutes,
        q7MondayAdjusted: q7MondayWindow.q7MondayAdjusted,
      };
    })
    .filter(({ start, end }) => start !== null && end !== null);

  if (normalizedShiftCandidates.length === 0) return null;

  // Khoảng cách giờ ra chỉ dùng làm fallback khi dòng hoàn toàn thiếu giờ vào.
  const getOutDistance = (candidate) =>
    actualOut !== null && candidate.end !== null
      ? Math.abs(actualOut - candidate.end)
      : Number.POSITIVE_INFINITY;

  // Khi có giờ vào, tuyệt đối không dùng giờ ra để đổi ca: giờ vào -> Giờ ĐK -> thứ tự gốc.
  const compareCandidates = (first, second) => {
    if (actualIn !== null) {
      const checkInDistance = scoreShiftByCheckIn(actualIn, first) -
        scoreShiftByCheckIn(actualIn, second);
      if (checkInDistance !== 0) return checkInDistance;

      const registeredShiftDistance =
        getRegisteredShiftScore(employee, first) - getRegisteredShiftScore(employee, second);
      if (registeredShiftDistance !== 0) return registeredShiftDistance;

      return first.index - second.index;
    }

    const outDistance = getOutDistance(first) - getOutDistance(second);
    if (outDistance !== 0) return outDistance;

    const registeredShiftDistance =
      getRegisteredShiftScore(employee, first) - getRegisteredShiftScore(employee, second);
    if (registeredShiftDistance !== 0) return registeredShiftDistance;

    return first.index - second.index;
  };

  const selectedShift = [...normalizedShiftCandidates].sort(compareCandidates)[0];

  return {
    key: selectedShift.key ?? getShiftKeyFromName(selectedShift.name),
    name: selectedShift.name,
    start: selectedShift.start,
    end: selectedShift.end,
    actualIn,
    source: selectedShift.source ?? "nearest",
    branchCode: selectedShift.branchCode ?? null,
    q7MondayShopShortageMinutes: selectedShift.q7MondayShopShortageMinutes ?? 0,
    q7MondayAdjusted: Boolean(selectedShift.q7MondayAdjusted),
    distanceMinutes:
      actualIn === null || selectedShift.start === null
        ? null
        : Math.max(0, Math.round(actualIn - selectedShift.start)),
  };
}

/** Chọn ca rule đã gán (VP Thứ 7/custom), hoặc fallback sang ca gần nhất nếu không có rule. */
export function determineAssignedShift(
  employee,
  clockValues,
  shiftAssignment,
  shiftCandidates = [],
  options = {},
) {
  if (!shiftAssignment) return determineNearestShift(employee, clockValues, shiftCandidates, options);

  const start = timeValueToMinutes(getShiftStartValue(employee, shiftAssignment.shift));
  let end = timeValueToMinutes(getShiftEndValue(employee, shiftAssignment.shift));
  if (start !== null && end !== null && end < start) end += MINUTES_PER_DAY;
  const q7MondayWindow = start !== null && end !== null
    ? applyQ7MondayWindow({
        employee,
        employeeName: options.employeeName,
        attendanceDate: options.attendanceDate,
        start,
        end,
      })
    : { start, end, q7MondayShopShortageMinutes: 0, q7MondayAdjusted: false };
  const actualIn = selectActualIn(clockValues).minutes;

  return {
    key: shiftAssignment.shift.key ?? getShiftKeyFromName(shiftAssignment.shift.name),
    name: shiftAssignment.shift.name,
    start: q7MondayWindow.start,
    end: q7MondayWindow.end,
    actualIn,
    distanceMinutes:
      actualIn === null || q7MondayWindow.start === null ? null : Math.abs(actualIn - q7MondayWindow.start),
    source: "rule",
    ruleId: shiftAssignment.ruleId,
    ruleName: shiftAssignment.ruleName,
    q7MondayShopShortageMinutes: q7MondayWindow.q7MondayShopShortageMinutes,
    q7MondayAdjusted: q7MondayWindow.q7MondayAdjusted,
  };
}

/** Chọn giờ ra thực tế, ưu tiên Ra 2 rồi Ra 1, kèm tên cột nguồn. */
export function selectActualOut(clockValues) {
  const out2 = timeValueToMinutes(clockValues.out2);
  if (out2 !== null) return { minutes: out2, source: "Ra 2" };

  const out1 = timeValueToMinutes(clockValues.out1);
  if (out1 !== null) return { minutes: out1, source: "Ra 1" };
  return { minutes: null, source: null };
}

// Đẩy giờ ra sang ngày kế tiếp khi ca đi qua nửa đêm.
function normalizeActualOut(actualIn, actualOut) {
  if (actualIn === null || actualOut === null) return actualOut;
  return actualOut < actualIn ? actualOut + MINUTES_PER_DAY : actualOut;
}

// Suy ra key chuẩn từ tên ca khi ứng viên ca cũ chưa khai báo key.
function getShiftKeyFromName(value) {
  const normalizedName = normalizeShiftKey(value);
  if (normalizedName.includes("sang") || normalizedName.includes("morning")) return "morning";
  if (normalizedName.includes("chieu") || normalizedName.includes("afternoon")) return "afternoon";
  if (normalizedName.includes("toi") || normalizedName.includes("evening")) return "evening";
  return null;
}

// Chọn đúng cột ưu tiên sau normalize chỉ để nhận diện full ngày; không đổi selectActualIn/Out hiện hữu.
function selectPreferredClock(clockValues, primarySlot, fallbackSlot) {
  const primary = timeValueToMinutes(clockValues?.[primarySlot]);
  if (primary !== null) return primary;
  return timeValueToMinutes(clockValues?.[fallbackSlot]);
}

// Tìm ca có mốc Vào/Ra gần clock thực tế nhất từ chính hồ sơ Employees.
function findNearestEmployeeShiftKey(actualMinutes, employee, markerSuffix) {
  if (actualMinutes === null) return null;
  const markers = ["morning", "afternoon", "evening"]
    .map((key) => ({
      key,
      minutes: timeValueToMinutes(employee?.[`${key}${markerSuffix}`]),
    }))
    .filter(({ minutes }) => minutes !== null);
  if (markers.length === 0) return null;

  return markers.reduce((nearest, marker) =>
    clockDistance(actualMinutes, marker.minutes) < clockDistance(actualMinutes, nearest.minutes)
      ? marker
      : nearest,
  ).key;
}

/**
 * Nhận diện ngoại lệ làm full ngày bằng clock đã normalize và giờ ca trong Employees.
 * Vào 1/Ra 1 được ưu tiên; kết quả chỉ phục vụ rule Tổng tăng ca, không thay đổi ca đã chọn.
 */
export function getMorningToAfternoonFullDayStatus(
  employee,
  clockValues,
  determinedShift,
  thresholdMinutes = FULL_DAY_SHIFT_MATCH_THRESHOLD_MINUTES,
  employeeName = "",
) {
  // Ba ca TD chồng giờ nên không suy diễn full ngày từ giờ ra gần mốc ca chiều.
  if (isThuDucEmployee(employee, employeeName)) {
    return {
      isFullDay: false,
      afternoonEndMinutes: null,
      preferredActualOutMinutes: null,
    };
  }

  const actualIn = selectPreferredClock(clockValues, "in1", "in2");
  const rawActualOut = selectPreferredClock(clockValues, "out1", "out2");
  const morningStart = timeValueToMinutes(employee?.morningIn);
  const afternoonEnd = timeValueToMinutes(employee?.afternoonOut);
  if (
    actualIn === null ||
    rawActualOut === null ||
    morningStart === null ||
    afternoonEnd === null
  ) {
    return {
      isFullDay: false,
      afternoonEndMinutes: null,
      preferredActualOutMinutes: null,
    };
  }

  const selectedShiftKey = determinedShift?.key ?? getShiftKeyFromName(determinedShift?.name);
  const nearestInShiftKey = findNearestEmployeeShiftKey(actualIn, employee, "In");
  const afternoonOutDistance = clockDistance(rawActualOut, afternoonEnd);
  const isCheckInMorningShift = selectedShiftKey
    ? selectedShiftKey === "morning"
    : nearestInShiftKey === "morning";
  const isCheckOutAfternoonShift = afternoonOutDistance <= thresholdMinutes;
  let normalizedAfternoonEnd = afternoonEnd;
  if (normalizedAfternoonEnd < actualIn) normalizedAfternoonEnd += MINUTES_PER_DAY;

  return {
    isFullDay: isCheckInMorningShift && isCheckOutAfternoonShift,
    afternoonEndMinutes: normalizedAfternoonEnd,
    preferredActualOutMinutes: normalizeActualOut(actualIn, rawActualOut),
  };
}

// Chuẩn hóa tên ca không dấu để so với Giờ ĐK.
function normalizeShiftKey(value) {
  return normalizeLookup(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Ä‘/g, "d");
}

// Chấm điểm 0/1 cho mức khớp giữa ca ứng viên và Giờ ĐK của nhân viên.
function getRegisteredShiftScore(employee, shift) {
  const registeredShift = normalizeShiftKey(
    employee?.registeredShift ?? employee?.regisHours ?? employee?.regisHour,
  );
  if (!registeredShift) return 1;

  const shiftName = normalizeShiftKey(shift?.name);
  return shiftName === registeredShift ||
    shiftName.includes(registeredShift) ||
    registeredShift.includes(shiftName)
    ? 0
    : 1;
}

// Tính khoảng cách tuyệt đối giữa giờ vào thực tế và giờ bắt đầu ca.
function scoreShiftByCheckIn(actualInMinutes, shift) {
  if (actualInMinutes === null || actualInMinutes === undefined || shift?.start === null) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(actualInMinutes - shift.start);
}

/** Lập hai chỉ mục nhân viên theo mã và tên để tra cứu nhanh từng dòng Excel. */
export function createEmployeeLookup(employees) {
  const byCode = new Map();
  const byName = new Map();

  employees.forEach((employee) => {
    const code = normalizeEmployeeCode(employee.employeeCode);
    const name = normalizeLookup(employee.employeeName);
    if (code && !byCode.has(code)) byCode.set(code, employee);
    if (name && !byName.has(name)) byName.set(name, employee);
  });

  return { byCode, byName };
}

/** Tìm hồ sơ nhân viên từ lookup, ưu tiên mã nhân viên trước tên. */
export function findRegisteredEmployee(lookup, employeeCode, employeeName) {
  const code = normalizeEmployeeCode(employeeCode);
  if (code) return lookup.byCode.get(code) ?? null;

  const name = normalizeLookup(employeeName);
  return name ? lookup.byName.get(name) ?? null : null;
}

/**
 * Điều phối tính một dòng chấm công sau normalize clock và chọn ca.
 * Trả Đi sớm/Đi trễ/Về sớm/Tăng ca, Phạt, Tổng làm, ca xác định và ghi chú;
 * không ghi worksheet, localStorage hay API.
 */
export function calculateTimekeeping({
  employee,
  employeeName = "",
  clockValues,
  fallbackTotal,
  additionalNotes = [],
  shiftAssignment = null,
  shiftCandidates = [],
  attendanceDate = null,
}) {
  const selectedActualOut = selectActualOut(clockValues);

  if (!employee) {
    const totalWorkedMinutes = calculateTotalWorkedMinutes(fallbackTotal);
    return {
      lateMinutes: null,
      earlyInMinutes: null,
      penalty: null,
      earlyMinutes: null,
      overtimeMinutes: null,
      note: [...additionalNotes, "Chưa có giờ đăng ký"].join("; "),
      totalWorkedMinutes,
      matched: false,
      determinedShift: null,
      standardOutMinutes: null,
      standardOutTime: null,
      actualOutMinutes: selectedActualOut.minutes,
      actualOutTime: formatMinutes(selectedActualOut.minutes),
      actualOutSource: selectedActualOut.source,
    };
  }

  const vpSaturdayShiftAssignment = getVPSaturdayShiftAssignment({
    employeeName: employeeName || employee.employeeName,
    attendanceDate,
    clockValues,
  });
  const totalWorkedMinutes = calculateTotalWorkedMinutes(fallbackTotal, {
    // VP Thứ 7 là ca 4 tiếng nên không trừ thêm một giờ nghỉ trưa khỏi Tổng làm.
    deductLunchBreak: !vpSaturdayShiftAssignment,
  });
  const effectiveShiftAssignment = vpSaturdayShiftAssignment ?? shiftAssignment;

  const determinedShift = determineAssignedShift(
    employee,
    clockValues,
    effectiveShiftAssignment,
    shiftCandidates,
    {
      employeeName: employeeName || employee.employeeName,
      attendanceDate,
    },
  );
  if (!determinedShift) {
    return {
      lateMinutes: null,
      earlyInMinutes: null,
      penalty: null,
      earlyMinutes: null,
      overtimeMinutes: null,
      note: [
        ...additionalNotes,
        "Chưa xác định ca làm",
        "Không xác định được giờ ra chuẩn",
        employee.note,
      ]
        .filter(Boolean)
        .join("; "),
      totalWorkedMinutes,
      matched: true,
      determinedShift: null,
      standardOutMinutes: null,
      standardOutTime: null,
      actualOutMinutes: selectedActualOut.minutes,
      actualOutTime: formatMinutes(selectedActualOut.minutes),
      actualOutSource: selectedActualOut.source,
    };
  }

  const actualOut = normalizeActualOut(
    determinedShift.actualIn,
    selectedActualOut.minutes,
  );
  const fullDayStatus = getMorningToAfternoonFullDayStatus(
    employee,
    clockValues,
    determinedShift,
    FULL_DAY_SHIFT_MATCH_THRESHOLD_MINUTES,
    employeeName || employee.employeeName,
  );
  const q7MondayShopShortageMinutes =
    Number(determinedShift.q7MondayShopShortageMinutes) > 0
      ? Number(determinedShift.q7MondayShopShortageMinutes)
      : 0;
  const { lateMinutes, earlyInMinutes, earlyMinutes } = calculateLateEarlyMetrics({
    actualIn: determinedShift.actualIn,
    shiftStart: determinedShift.start,
    actualOut,
    shiftEnd: determinedShift.end,
    q7ShortageMinutes: q7MondayShopShortageMinutes,
  });
  const penalty = calculateLatePenalty(lateMinutes, employeeName);
  const notes = [...additionalNotes];
  const hasStandardOut = determinedShift.end !== null;
  const registeredMinutes = parseRegisteredShiftMinutes(
    employee.registeredShift ?? employee.regisHours ?? employee.regisHour,
  );
  const expectedEndByRegisteredHours =
    determinedShift.start !== null && registeredMinutes !== null && registeredMinutes > 0
      ? determinedShift.start + registeredMinutes
      : determinedShift.end;
  const overtimeStandardOut = expectedEndByRegisteredHours;
  const overtimeActualOut = fullDayStatus.isFullDay
    ? Math.min(
        fullDayStatus.preferredActualOutMinutes,
        fullDayStatus.afternoonEndMinutes,
      )
    : actualOut;
  const overtimeMinutes = fullDayStatus.isFullDay
    ? Math.max(0, Math.round(overtimeActualOut - overtimeStandardOut))
    : calculateOvertimeMinutes({
        actualOut: overtimeActualOut,
        standardOut: overtimeStandardOut,
        totalWorkedMinutes,
        employee,
        employeeName: employeeName || employee.employeeName,
        shiftStart: determinedShift.start,
      });

  if (determinedShift.actualIn === null) notes.push("Thiếu giờ vào");
  if (!hasStandardOut) {
    notes.push("Không xác định được giờ ra chuẩn");
  }
  if (actualOut === null) notes.push("Thiếu giờ ra");
  if (earlyInMinutes > 0) notes.push(`Đi sớm ${earlyInMinutes} phút`);
  if (lateMinutes > 0) notes.push(`Đi trễ ${lateMinutes} phút`);
  if (earlyMinutes > 0) notes.push(`Về sớm ${earlyMinutes} phút`);
  if (q7MondayShopShortageMinutes > 0) {
    notes.push(
      `Về sớm do Giờ ĐK vượt giờ hoạt động Q7 Thứ 2: ${q7MondayShopShortageMinutes} phút`,
    );
  }
  if (overtimeMinutes > 0) {
    if (fullDayStatus.isFullDay) {
      notes.push(
        `Tăng ca full ngày: tính từ ${formatMinutes(overtimeStandardOut)} đến ${formatMinutes(overtimeActualOut)}`,
      );
    } else {
      notes.push(`Tăng ca ${overtimeMinutes} phút`);
    }
  }
  
  if (notes.length === 0) notes.push("Đúng giờ");
  if (employee.note) notes.push(employee.note);

  return {
    lateMinutes,
    earlyInMinutes,
    penalty,
    earlyMinutes,
    note: notes.join("; "),
    totalWorkedMinutes,
    matched: true,
    determinedShift: determinedShift.name,
    determinedShiftKey: determinedShift.key ?? getShiftKeyFromName(determinedShift.name),
    shiftSource: determinedShift.source ?? "nearest",
    appliedRuleId: determinedShift.ruleId ?? null,
    appliedRuleName: determinedShift.ruleName ?? null,
    standardOutMinutes: determinedShift.end,
    standardOutTime: formatMinutes(determinedShift.end),
    overtimeStandardOutMinutes: overtimeStandardOut,
    overtimeStandardOutTime: formatMinutes(overtimeStandardOut),
    expectedEndByRegisteredHoursMinutes: expectedEndByRegisteredHours,
    expectedEndByRegisteredHoursTime: formatMinutes(expectedEndByRegisteredHours),
    overtimeActualOutMinutes: overtimeActualOut,
    overtimeActualOutTime: formatMinutes(overtimeActualOut),
    isFullDayByMorningToAfternoon: fullDayStatus.isFullDay,
    q7MondayAdjusted: Boolean(determinedShift.q7MondayAdjusted),
    q7MondayShopShortageMinutes,
    actualOutMinutes: actualOut,
    actualOutTime: formatMinutes(actualOut),
    actualOutSource: selectedActualOut.source,
    overtimeMinutes,
  };
}
