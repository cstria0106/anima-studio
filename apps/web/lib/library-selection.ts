export interface LibrarySelectionState {
  selectedIds: string[];
  anchorId: string | null;
}

export function selectLibraryItem(
  state: LibrarySelectionState,
  orderedIds: readonly string[],
  id: string,
  options: { ctrl?: boolean; shift?: boolean } = {},
): LibrarySelectionState {
  if (options.shift && state.anchorId) {
    const anchorIndex = orderedIds.indexOf(state.anchorId);
    const targetIndex = orderedIds.indexOf(id);
    if (anchorIndex >= 0 && targetIndex >= 0) {
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const range = orderedIds.slice(start, end + 1);
      return {
        selectedIds: options.ctrl
          ? [...new Set([...state.selectedIds, ...range])]
          : [...range],
        anchorId: state.anchorId,
      };
    }
  }
  if (options.ctrl) {
    return {
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((item) => item !== id)
        : [...state.selectedIds, id],
      anchorId: id,
    };
  }
  return { selectedIds: [id], anchorId: id };
}

export function selectLibraryContextTarget(
  state: LibrarySelectionState,
  id: string,
): LibrarySelectionState {
  return state.selectedIds.includes(id)
    ? state
    : { selectedIds: [id], anchorId: id };
}
