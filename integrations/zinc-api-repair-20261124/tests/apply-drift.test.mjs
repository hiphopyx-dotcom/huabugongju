import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const apply = fileURLToPath(new URL("../apply.mjs", import.meta.url));

test("前置哈希不符时拒绝写入", () => {
  const root = mkdtempSync(join(tmpdir(), "zinc-drift-"));
  mkdirSync(join(root, "public/bench"), { recursive: true });
  writeFileSync(join(root, "public/bench/accounts.mjs"), "drift\n");
  const result = spawnSync(process.execPath, [apply, "--root", root], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /拒绝/);
  assert.match(result.stderr, /漂移/);
  assert.equal(readFileSync(join(root, "public/bench/accounts.mjs"), "utf8"), "drift\n");
});
