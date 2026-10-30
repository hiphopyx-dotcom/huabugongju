export const OPPOSITE_VIEW = Object.freeze({
  view_n: 'view_s', view_s: 'view_n', view_w: 'view_e', view_e: 'view_w',
  establishing: 'view_s', a_establishing: 'a_view_s', a_view_w: 'a_view_e', a_view_e: 'a_view_w', a_view_s: 'a_establishing',
  pano: 'pano',
});

export function oppositeViewKind(kind) {
  return OPPOSITE_VIEW[kind] || '';
}

/** 正打优先用全景或北机位当空房间；反打必须换到同一场景的对面墙。 */
export function coverageSlot(slot, selected = 'view_n', hasPano = false) {
  if (slot === 'reverse') return oppositeViewKind(selected === 'pano' ? 'view_n' : selected) || 'view_s';
  if (hasPano) return 'pano';
  return selected || 'view_n';
}
