// 409 之后不能把服务端修订号套到尚未同步的正文上。
// 自动保存因此不再发出下一次写入。显式处理只保留云端，不覆盖、不删除。

export function revisionProvesStoredBody() {
  return false;
}

export function noteSaveResponse(project, response) {
  const localRevision = Number(project?.cloudRevision) || 0;
  const status = Number(response?.status) || 0;
  const conflict = status === 409 || response?.conflict === true;
  if (conflict) {
    return {
      cloudRevision: localRevision,
      cloudConflict: {
        serverRevision: Number(response?.revision) || 0,
        localRevision,
        explicit: null,
      },
      vault: false,
    };
  }
  if (response?.ok && Number(response?.revision) > 0) {
    return { cloudRevision: Number(response.revision), cloudConflict: null, vault: true };
  }
  return {
    cloudRevision: localRevision,
    cloudConflict: project?.cloudConflict || null,
    vault: false,
  };
}

export function autoSaveBlocked(project) {
  return Boolean(project?.cloudConflict);
}

/** 显式选择只停止自动上传。use-local 在本修复里不发送，避免旧正文覆盖较新云内容。 */
export function resolveConflict(project, choice) {
  if (!project?.cloudConflict) return { send: false, project };
  if (choice === "keep-cloud") {
    return {
      send: false,
      project: {
        ...project,
        cloudRevision: Number(project.cloudRevision) || 0,
        cloudConflict: { ...project.cloudConflict, explicit: "keep-cloud" },
      },
    };
  }
  return { send: false, error: "云端有更新的版本，没有覆盖", project };
}

export function adoptCloudDocument(cloudProject, cloudRevision) {
  return {
    ...cloudProject,
    cloudRevision: Number(cloudRevision) || 0,
    cloudConflict: null,
  };
}

export function createProjectStore(row) {
  let current = row ? { id: row.id, phone: row.phone, revision: Number(row.revision) || 0, document: row.document } : null;
  return {
    read() {
      return current ? { ...current } : null;
    },
    save({ phone, revision, document }) {
      const clientRev = Number(revision) || 0;
      if (!current) {
        if (clientRev !== 0) return { status: 409, ok: false, conflict: true, wrote: false, error: "云端有更新的版本，没有覆盖" };
        current = { id: "new", phone, revision: 1, document };
        return { status: 200, ok: true, revision: 1, wrote: true };
      }
      if (current.phone !== phone) return { status: 403, ok: false, wrote: false, error: "这不是你的项目" };
      if (Number(current.revision) !== clientRev) {
        return {
          status: 409,
          ok: false,
          conflict: true,
          wrote: false,
          revision: current.revision,
          error: "云端有更新的版本，没有覆盖",
        };
      }
      current = { ...current, document, revision: current.revision + 1 };
      return { status: 200, ok: true, revision: current.revision, wrote: true };
    },
  };
}

/** 模拟修复后的客户端。冲突后不再提交。 */
export function clientAutoSave(store, project, phone) {
  if (autoSaveBlocked(project)) return { sent: false, response: null, project };
  const response = store.save({ phone, revision: Number(project.cloudRevision) || 0, document: project.body });
  const noted = noteSaveResponse(project, response);
  return {
    sent: true,
    response,
    project: { ...project, cloudRevision: noted.cloudRevision, cloudConflict: noted.cloudConflict },
  };
}
