import test from "node:test";
import assert from "node:assert/strict";
import { activeCandidates, shouldCopyGuestLibrary } from "../modules/public/bench/guest-adopt-guard.mjs";
import { createProjectSelection } from "../modules/public/bench/project-selection.mjs";
import { classifyBenchMembers, localCloudGap } from "../modules/public/bench/bench-members-diagnose.mjs";
import {
  adoptCloudDocument,
  autoSaveBlocked,
  clientAutoSave,
  createProjectStore,
  noteSaveResponse,
  resolveConflict,
  revisionProvesStoredBody,
} from "../modules/public/bench/cloud-conflict.mjs";

test("会员登录不复制访客工程，旧 jbp-active 不会把桂花选成当前", () => {
  assert.equal(shouldCopyGuestLibrary("member-director-2"), false);
  const member = [{ id: "ep02-s03", title: "EP02_导演二_s03s05", script: "导演二正文", assets: new Array(8), shots: [] }];
  const guest = [{ id: "guihua", title: "桂花 EP04", script: "桂花正文" }];
  const copied = shouldCopyGuestLibrary("member-director-2") ? guest : [];
  assert.equal(copied.length, 0);
  assert.equal(member[0].script, "导演二正文");
  assert.equal(member[0].assets.length, 8);
  assert.equal(member[0].shots.length, 0);
  assert.equal(guest[0].script, "桂花正文");
  const storage = new Map();
  const selection = createProjectSelection({
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
  });
  storage.set("jbp-active", "guihua");
  storage.set("jbp-active:member-director-2", "ep02-s03");
  const projects = [...member, { id: "guihua", title: "桂花 EP04", script: "桂花正文" }];
  assert.equal(selection.choose(projects, { scope: "member-director-2" }).id, "ep02-s03");
  assert.deepEqual(activeCandidates("member-director-2", { scopedId: "", legacyId: "guihua" }).includes("guihua"), false);
  assert.equal(activeCandidates("guest", { legacyId: "guihua" })[0], "guihua");
});

test("bench-members 的 403 只表示项目归属冲突，本地回落登录不是 403", () => {
  const ownership = classifyBenchMembers({
    method: "GET",
    action: "project",
    cloudOwner: true,
    projectExists: true,
    memberPhone: "13900008057",
    projectPhone: "13900000001",
  });
  assert.equal(ownership.status, 403);
  assert.equal(ownership.kind, "ownership");
  const saveOwnership = classifyBenchMembers({
    method: "POST",
    action: "project-save",
    cloudOwner: true,
    projectExists: true,
    memberPhone: "13900008057",
    projectPhone: "13900000001",
  });
  assert.equal(saveOwnership.status, 403);
  assert.equal(classifyBenchMembers({ method: "POST", action: "login" }).status, 200);
  assert.equal(classifyBenchMembers({ method: "POST", action: "session", cookieMember: false }).status, 200);
  assert.equal(classifyBenchMembers({ method: "POST", action: "pulse", cloudOwner: false }).status, 401);
  assert.equal(classifyBenchMembers({ method: "POST", action: "project-save", cloudOwner: false }).status, 401);
  assert.equal(classifyBenchMembers({ method: "GET", action: "", staff: false }).status, 401);
  assert.equal(classifyBenchMembers({ method: "GET", action: "online", staff: false }).kind, "admin-denied");
  const gap = localCloudGap({ serverLoginOk: false, localDeskMatch: true, serverKnowsId: false });
  assert.equal(gap.localOpen, true);
  assert.equal(gap.cloud, "unauthenticated");
  assert.equal(gap.projectSaveStatus, 401);
  assert.equal(gap.ownership403, false);
  assert.equal(gap.sessionExpired, false);
});

test("两个客户端在 409 之后再次自动保存不会覆盖较新云正文", () => {
  const phone = "13900008057";
  const patched = createProjectStore({ id: "ep-new", phone, revision: 3, document: "云端较新" });
  const clientA = { cloudRevision: 3, body: "甲写下的新正文", cloudConflict: null };
  const clientB = { cloudRevision: 3, body: "乙仍是旧正文", cloudConflict: null };
  const savedA = clientAutoSave(patched, clientA, phone);
  assert.equal(savedA.response.wrote, true);
  assert.equal(patched.read().document, "甲写下的新正文");
  assert.equal(patched.read().revision, 4);
  const conflicted = clientAutoSave(patched, clientB, phone);
  assert.equal(conflicted.response.status, 409);
  assert.equal(conflicted.response.wrote, false);
  assert.equal(conflicted.project.cloudRevision, 3);
  assert.equal(autoSaveBlocked(conflicted.project), true);
  const again = clientAutoSave(patched, conflicted.project, phone);
  assert.equal(again.sent, false);
  assert.equal(patched.read().document, "甲写下的新正文");
  assert.equal(patched.read().revision, 4);

  const poisoned = createProjectStore({ id: "ep-new", phone, revision: 4, document: "甲写下的新正文" });
  const buggy = poisoned.save({ phone, revision: 4, document: "乙仍是旧正文" });
  assert.equal(buggy.wrote, true);
  assert.equal(poisoned.read().document, "乙仍是旧正文");
  const noted = noteSaveResponse(clientB, conflicted.response);
  assert.equal(noted.cloudRevision, 3);
  assert.notEqual(noted.cloudRevision, conflicted.response.revision);
});

test("冲突后的显式处理不上传旧正文，别的会员即使拿到修订号也不能写", () => {
  const phone = "13900008057";
  const server = createProjectStore({ id: "ep-new", phone, revision: 4, document: "甲写下的新正文" });
  const local = {
    cloudRevision: 3,
    body: "乙仍是旧正文",
    cloudConflict: { serverRevision: 4, localRevision: 3, explicit: null },
  };
  const keep = resolveConflict(local, "keep-cloud");
  assert.equal(keep.send, false);
  assert.equal(keep.project.cloudRevision, 3);
  assert.equal(server.read().document, "甲写下的新正文");
  const force = resolveConflict(local, "use-local");
  assert.equal(force.send, false);
  assert.equal(force.error, "云端有更新的版本，没有覆盖");
  const foreign = server.save({ phone: "13900000001", revision: 4, document: "别人的正文" });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.wrote, false);
  assert.equal(server.read().document, "甲写下的新正文");
  assert.equal(server.read().revision, 4);
  const opened = adoptCloudDocument({ id: "ep-new", body: "甲写下的新正文" }, 4);
  assert.equal(opened.cloudConflict, null);
  assert.equal(opened.cloudRevision, 4);
  assert.equal(opened.body, "甲写下的新正文");
  assert.equal(revisionProvesStoredBody(), false);
  assert.equal(noteSaveResponse({ cloudRevision: 3 }, { status: 403, ok: false }).cloudRevision, 3);
});
