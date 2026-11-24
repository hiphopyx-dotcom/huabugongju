/** 拒绝把别的 scope 的 vault 行改写成当前成员。不删除、不迁移旧行。 */
export function vaultWriteDecision(existingScope: string | null | undefined, nextScope: string) {
  if (existingScope && existingScope !== nextScope) {
    return { status: 409 as const, body: { ok: false, error: "这不是当前成员的云端项目，没有覆盖" } };
  }
  return null;
}
