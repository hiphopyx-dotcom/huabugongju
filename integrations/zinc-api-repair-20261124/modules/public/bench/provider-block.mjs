// 付费 xAI 主机与别名。不发起请求。

const SUFFIX = /(?:^|\.)(?:x\.ai|api\.x\.ai|api\.x\.com)$/i;

function labelsOf(hostname) {
  return String(hostname || "").replace(/\.+$/, "").toLowerCase().split(".").filter(Boolean);
}

function hasRun(labels, run) {
  for (let i = 0; i <= labels.length - run.length; i += 1) {
    if (run.every((part, offset) => labels[i + offset] === part)) return true;
  }
  return false;
}

export function isBlockedProvider(baseUrl) {
  try {
    const raw = String(baseUrl ?? "").trim().replace(/[\u3002\uff0e\uff61]/g, ".").replace(/\/+$/, "");
    const url = new URL(raw);
    const host = url.hostname.replace(/\.+$/, "").toLowerCase();
    if (SUFFIX.test(host)) return true;
    const labels = labelsOf(host);
    return hasRun(labels, ["x", "ai"]) || hasRun(labels, ["api", "x", "com"]);
  } catch {
    return false;
  }
}
