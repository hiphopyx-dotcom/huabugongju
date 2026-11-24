// 会员登录不再把访客库复制进会员库。已在会员库里的工程原样留下，不删除、不改写。

export function shouldCopyGuestLibrary(_scope) {
  return false;
}

/** 会员范围不使用无前缀的旧 jbp-active。访客范围仍可读它。 */
export function activeCandidates(scope, { requestedId, scopedId, legacyId } = {}) {
  const ids = [];
  if (requestedId) ids.push(requestedId);
  if (scopedId) ids.push(scopedId);
  if (scope === "guest" && legacyId) ids.push(legacyId);
  return ids;
}
