// 只读诊断：对照 2026-11-21 导出的 /api/bench-members 状态码。
// 不放宽权限，不发起登录，不读取账号。

export function classifyBenchMembers({
  method,
  action = "",
  staff = false,
  cloudOwner = false,
  memberPhone = "",
  projectPhone = "",
  projectExists = false,
  cookieMember = false,
}) {
  const verb = String(method || "").toUpperCase();
  if (verb === "GET" && action === "admin-session") {
    return done(200, "admin-session", "管理员谷歌会话探测。非管理员也是 200，正文 admin:false");
  }
  if (verb === "GET" && action === "vault") {
    if (!cloudOwner) return done(200, "cloud-unauthenticated", "正文 ok:true、skipped:true、projects:[]");
    return done(200, "cloud-read", "按手机号 scope 读取 vault");
  }
  if (verb === "GET" && (action === "projects" || action === "project")) {
    if (!cloudOwner) return done(401, "cloud-unauthenticated", "请先登录后再查看云端项目");
    if (action === "projects") return done(200, "cloud-list", "只列出该手机号名下的项目");
    if (!projectExists) return done(404, "cloud-missing", "云端没有这个项目");
    if (projectPhone !== memberPhone) return done(403, "ownership", "这不是你的项目");
    return done(200, "cloud-read", "同一手机号可读");
  }
  if (verb === "GET" && (action === "online" || action === "works" || action === "")) {
    if (!staff) return done(401, "admin-denied", "请用管理员登录");
    return done(200, "admin", action || "members");
  }
  if (verb === "POST" && action === "vault-save") {
    if (!cloudOwner) return done(200, "cloud-unauthenticated", "正文 ok:true、skipped:true");
    return done(200, "cloud-write", "vault 写入。跨 scope 覆盖由 vaultWriteDecision 另拒为 409");
  }
  if (verb === "POST" && (action === "project-save" || action === "project-list")) {
    if (!cloudOwner) return done(401, "cloud-unauthenticated", "请先登录后再上传");
    if (action === "project-list") return done(200, "cloud-list", "只列出该手机号名下的项目");
    if (projectExists && projectPhone !== memberPhone) return done(403, "ownership", "这不是你的项目");
    return done(200, "cloud-write", "同一手机号才写入。修订冲突是 409");
  }
  if (verb === "POST" && action === "work") {
    if (!cloudOwner) return done(401, "member-session", "请用开通时的手机号重新登录后再出图");
    return done(200, "member-session", "按请求里的手机号匹配成员");
  }
  if (verb === "POST" && action === "pulse") {
    if (!cloudOwner) return done(401, "member-session", "成员 id 不在服务器名单里");
    return done(200, "member-session", "心跳");
  }
  if (verb === "POST" && action === "logout") return done(200, "member-session", "清除成员 cookie");
  if (verb === "POST" && action === "session") {
    return done(200, "member-session", cookieMember ? "cookie 对应在册成员" : "正文 member:null");
  }
  if (verb === "POST" && action === "login") {
    return done(200, "member-session", "失败也是 200，正文 ok:false。页面再用本机成员表");
  }
  if (verb === "POST") {
    if (!staff) return done(401, "admin-denied", "请用管理员登录");
    return done(200, "admin", "保存成员名单");
  }
  return done(404, "unknown", "导出路由没有这个方法");
}

/** 本机回落登录和服务器名单不一致时，页面可以打开，云端仍未认证。这个状态的 HTTP 不是 403。 */
export function localCloudGap({ serverLoginOk = false, localDeskMatch = false, serverKnowsId = false }) {
  const localOpen = Boolean(serverLoginOk || localDeskMatch);
  const cloudAuthenticated = Boolean(serverLoginOk && serverKnowsId);
  return {
    localOpen,
    cloud: cloudAuthenticated ? "authenticated" : "unauthenticated",
    sessionExpired: false,
    projectSaveStatus: cloudAuthenticated ? 200 : 401,
    vaultStatus: 200,
    vaultBody: cloudAuthenticated ? "projects" : "skipped",
    sessionStatus: 200,
    sessionMember: cloudAuthenticated ? "member" : null,
    ownership403: false,
  };
}

function done(status, kind, detail) {
  return { status, kind, detail };
}
