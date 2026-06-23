/**
 * Tick hoặc bỏ tick một Diary bằng ID thật của database/API.
 *
 * @param {string[]} selectedIds - Các ID đang được chọn.
 * @param {string} id - ID Diary cần đổi trạng thái.
 * @returns {string[]} Danh sách ID mới, không mutate input.
 */
export function toggleDiarySelection(selectedIds, id) {
  if (!id) return [...selectedIds];
  return selectedIds.includes(id)
    ? selectedIds.filter((item) => item !== id)
    : [...selectedIds, id];
}

/**
 * Tính trạng thái checked/indeterminate của checkbox tổng theo các dòng đang hiển thị.
 * Các ID đang bị search/filter ẩn không ảnh hưởng kết quả.
 */
export function getVisibleDiarySelectionState(selectedIds, visibleIds) {
  const selectedSet = new Set(selectedIds);
  const normalizedVisibleIds = [...new Set(visibleIds.filter(Boolean))];
  const selectedVisibleCount = normalizedVisibleIds.filter((id) => selectedSet.has(id)).length;
  const allSelected = normalizedVisibleIds.length > 0
    && selectedVisibleCount === normalizedVisibleIds.length;

  return {
    allSelected,
    someSelected: selectedVisibleCount > 0 && !allSelected,
    selectedVisibleCount,
  };
}

/**
 * Chọn hoặc bỏ chọn toàn bộ Diary đang hiển thị sau search/filter.
 * Selection của các dòng đang ẩn được giữ nguyên.
 */
export function toggleAllVisibleDiarySelection(selectedIds, visibleIds) {
  const normalizedVisibleIds = [...new Set(visibleIds.filter(Boolean))];
  const { allSelected } = getVisibleDiarySelectionState(selectedIds, normalizedVisibleIds);
  const visibleSet = new Set(normalizedVisibleIds);

  if (allSelected) return selectedIds.filter((id) => !visibleSet.has(id));
  return [...new Set([...selectedIds, ...normalizedVisibleIds])];
}

/** Trả label nút bulk delete theo số dòng chọn và trạng thái request. */
export function getDiaryBulkDeleteLabel(selectedCount, isDeleting = false) {
  if (isDeleting) return "Đang xóa...";
  return `Xóa đã chọn${selectedCount > 0 ? ` (${selectedCount})` : ""}`;
}

/**
 * Xin xác nhận rồi gọi hàm xóa nhiều Diary được truyền vào.
 * Nếu người dùng hủy thì không gọi API và selection có thể được giữ nguyên ở component.
 */
export async function confirmAndDeleteSelectedDiaries(
  selectedIds,
  { confirmDelete, deleteMany },
) {
  const ids = [...new Set(selectedIds.filter(Boolean))];
  if (!ids.length || !confirmDelete(ids.length)) {
    return { confirmed: false, deletedCount: 0, deletedIds: [] };
  }

  const result = await deleteMany(ids);
  const deletedIds = Array.isArray(result?.deletedIds) ? result.deletedIds : ids;
  return {
    confirmed: true,
    deletedCount: Number(result?.deletedCount) || deletedIds.length,
    deletedIds,
  };
}
