import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { copies, replacements, untouched } from "./edits.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const flag = process.argv.indexOf("--root");
if (flag < 0 || !process.argv[flag + 1]) {
  console.error("拒绝：需要 --root 指向待修补的 Grok 项目根。此命令不发布、不连接现站。");
  process.exit(2);
}
const root = resolve(process.argv[flag + 1]);
const hash = (body) => createHash("sha256").update(body).digest("hex");

function refuse(message) {
  console.error(message);
  process.exit(2);
}

const beforeUntouched = new Map();
for (const rel of untouched) {
  const path = join(root, rel);
  if (!existsSync(path)) continue;
  beforeUntouched.set(rel, hash(readFileSync(path)));
}

for (const item of replacements) {
  const path = join(root, item.dest);
  if (!existsSync(path)) refuse("拒绝：缺少 " + item.dest);
  const text = readFileSync(path, "utf8");
  const current = hash(text);
  if (item.after && current === item.after) continue;
  if (current !== item.before) {
    refuse("拒绝：源文件已漂移 " + item.dest + "\n期望 " + item.before + "\n实际 " + current);
  }
  let next = text;
  for (const step of item.steps) {
    const count = next.split(step.old).length - 1;
    if (count !== 1) refuse("拒绝：片段不是恰好一处 " + item.dest + " count=" + count);
    next = next.replace(step.old, step.new);
  }
  if (next === text) refuse("拒绝：替换没有改变 " + item.dest);
  writeFileSync(path, next);
}

for (const item of copies) {
  const dest = join(root, item.dest);
  const payload = readFileSync(join(here, item.src));
  const payloadHash = hash(payload);
  if (existsSync(dest)) {
    const current = hash(readFileSync(dest));
    if (current === payloadHash) continue;
    if (item.before && current === item.before) {
      writeFileSync(dest, payload);
      continue;
    }
    refuse("拒绝：源文件已漂移 " + item.dest + "\n期望 " + (item.before || "新文件") + "\n实际 " + current);
  } else if (item.before) {
    refuse("拒绝：缺少 " + item.dest);
  } else {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, payload);
  }
}

for (const [rel, previous] of beforeUntouched) {
  const now = hash(readFileSync(join(root, rel)));
  if (now !== previous) refuse("拒绝：不应改动的文件变了 " + rel);
}

console.log("已按前置哈希写入隔离补丁。未发布，未连接现站。");
