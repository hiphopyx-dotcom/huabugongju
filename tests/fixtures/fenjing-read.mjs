// fenjing-src/src/lib/read-script-file.ts
var MAX_FILE_BYTES = 2e7;
var MAX_SCRIPT_CHARS = 1e6;
function decodeXml(s) {
  return s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/"/g, '"').replace(/'/g, "'").replace(/&nbsp;/g, " ");
}
function wordXmlToText(xml) {
  const paras = xml.split(/<\/w:p>/i);
  const lines = paras.map((p) => {
    let line = "";
    p.replace(/<w:tab\b[^/]*\/>/gi, () => {
      line += "	";
      return "";
    });
    p.replace(/<w:br\b[^/]*\/>/gi, () => {
      line += "\n";
      return "";
    });
    p.replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi, (_, body) => {
      line += decodeXml(body);
      return "";
    });
    return line.replace(/[ \t]+\n/g, "\n").trimEnd();
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
function markupToText(raw) {
  return raw.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h\d|tr|li|sceneheading|action|dialogue)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function rtfToText(raw) {
  return raw.replace(/\{\\*\\[^{}]+\}/g, " ").replace(/\\'[0-9a-fA-F]{2}/g, " ").replace(/\\par[d]?/gi, "\n").replace(/\\[a-z]+\d* ?/gi, " ").replace(/[{}]/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
async function inflateRaw(data) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function zipEntry(u8, want) {
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const target = want.replace(/\\/g, "/").toLowerCase();
  let offset = 0;
  while (offset + 30 <= u8.length) {
    const sig = view.getUint32(offset, true);
    if (sig === 33639248 || sig === 101010256) break;
    if (sig !== 67324752) break;
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const comp = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const nameBytes = u8.subarray(offset + 30, offset + 30 + nameLen);
    const name = new TextDecoder("utf-8").decode(nameBytes).replace(/\\/g, "/").toLowerCase();
    const dataStart = offset + 30 + nameLen + extraLen;
    if (flags & 8) throw new Error("\u8FD9\u4E2A Word \u6587\u4EF6\u538B\u7F29\u65B9\u5F0F\u5C11\u89C1\uFF0C\u8BF7\u53E6\u5B58\u4E3A .docx \u518D\u5BFC\u5165");
    const payload = u8.subarray(dataStart, dataStart + comp);
    if (name === target || name.endsWith("/" + target)) {
      if (method === 0) return payload;
      if (method === 8) return inflateRaw(payload);
      throw new Error("\u8FD9\u4E2A Word \u6587\u4EF6\u538B\u7F29\u65B9\u5F0F\u4E0D\u652F\u6301");
    }
    offset = dataStart + comp;
  }
  return null;
}
async function docxToText(u8) {
  const xmlBytes = await zipEntry(u8, "word/document.xml");
  if (!xmlBytes) throw new Error("\u4E0D\u662F\u6709\u6548\u7684 .docx\uFF08\u627E\u4E0D\u5230\u6B63\u6587\uFF09");
  const xml = new TextDecoder("utf-8").decode(xmlBytes);
  const text = wordXmlToText(xml);
  if (!text) throw new Error("\u8FD9\u4E2A Word \u91CC\u6CA1\u6709\u53EF\u8BFB\u7684\u6B63\u6587");
  return text;
}
function u16(dv, o) {
  return dv.getUint16(o, true);
}
function u32(dv, o) {
  return dv.getUint32(o, true);
}
function i32(dv, o) {
  return dv.getInt32(o, true);
}
function readCfbStream(u8, streamName) {
  if (u8.length < 512) return null;
  const magic = [208, 207, 17, 224, 161, 177, 26, 225];
  for (let i = 0; i < 8; i++) if (u8[i] !== magic[i]) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const sectorSize = 1 << u16(dv, 30);
  const miniSize = 1 << u16(dv, 32);
  const dirFirst = u32(dv, 48);
  const miniCutoff = u32(dv, 56);
  const miniFatFirst = i32(dv, 60);
  const fatSectors = [];
  for (let i = 0; i < 109; i++) {
    const s = i32(dv, 76 + i * 4);
    if (s >= 0) fatSectors.push(s);
  }
  const fat = [];
  for (const fs of fatSectors) {
    const off = (fs + 1) * sectorSize;
    for (let i = 0; i < sectorSize / 4; i++) fat.push(i32(dv, off + i * 4));
  }
  const ENDOF = 4294967294;
  function chain(start, size) {
    const parts = [];
    let s = start;
    const seen = /* @__PURE__ */ new Set();
    let left = size < 0 ? Number.MAX_SAFE_INTEGER : size;
    while (s >= 0 && s < ENDOF && left > 0) {
      if (seen.has(s)) break;
      seen.add(s);
      const off = (s + 1) * sectorSize;
      const take = Math.min(sectorSize, left);
      parts.push(u8.subarray(off, off + take));
      left -= take;
      s = fat[s] ?? ENDOF;
    }
    const total = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
  const dirBuf = chain(dirFirst, -1);
  const entries = [];
  for (let i = 0; i + 128 <= dirBuf.length; i += 128) {
    const nameBytes = u16(new DataView(dirBuf.buffer, dirBuf.byteOffset + i + 64, 2), 0);
    const chars = Math.max(0, Math.floor(nameBytes / 2) - 1);
    let name = "";
    for (let c = 0; c < chars && c < 32; c++) name += String.fromCharCode(dirBuf[i + c * 2] | dirBuf[i + c * 2 + 1] << 8);
    const type = dirBuf[i + 66];
    const start = i32(new DataView(dirBuf.buffer, dirBuf.byteOffset + i + 116, 4), 0);
    const size = u32(new DataView(dirBuf.buffer, dirBuf.byteOffset + i + 120, 4), 0);
    if (type) entries.push({ name, type, start, size });
  }
  const root = entries[0];
  let miniFat = [];
  let miniStream = new Uint8Array(0);
  if (root && miniFatFirst >= 0) {
    const miniFatBuf = chain(miniFatFirst, -1);
    const mdv = new DataView(miniFatBuf.buffer, miniFatBuf.byteOffset, miniFatBuf.byteLength);
    for (let i = 0; i + 4 <= miniFatBuf.length; i += 4) miniFat.push(i32(mdv, i));
    miniStream = chain(root.start, root.size);
  }
  function readEntry(ent) {
    if (ent.size < miniCutoff && miniStream.length) {
      const parts = [];
      let s = ent.start;
      let left = ent.size;
      const seen = /* @__PURE__ */ new Set();
      while (s >= 0 && s < ENDOF && left > 0) {
        if (seen.has(s)) break;
        seen.add(s);
        const off = s * miniSize;
        const take = Math.min(miniSize, left);
        parts.push(miniStream.subarray(off, off + take));
        left -= take;
        s = miniFat[s] ?? ENDOF;
      }
      const total = parts.reduce((a, p) => a + p.length, 0);
      const out = new Uint8Array(total);
      let o = 0;
      for (const p of parts) {
        out.set(p, o);
        o += p.length;
      }
      return out;
    }
    return chain(ent.start, ent.size);
  }
  const hit = entries.find((e) => e.name.toLowerCase() === streamName.toLowerCase());
  return hit ? readEntry(hit) : null;
}
function decodeDocBytes(bytes, compressed) {
  if (!compressed) return new TextDecoder("utf-16le").decode(bytes);
  for (const enc of ["gb18030", "gbk", "windows-1252"]) {
    try {
      return new TextDecoder(enc).decode(bytes);
    } catch {
    }
  }
  return new TextDecoder("latin1").decode(bytes);
}
function oleDocToText(u8) {
  const word = readCfbStream(u8, "WordDocument");
  if (!word || word.length < 200) throw new Error("\u8FD9\u4E2A .doc \u8BFB\u4E0D\u51FA\u6B63\u6587\uFF0C\u8BF7\u53E6\u5B58\u4E3A .docx");
  const wdv = new DataView(word.buffer, word.byteOffset, word.byteLength);
  const flags = u16(wdv, 10);
  const tableName = flags & 512 ? "1Table" : "0Table";
  const table = readCfbStream(u8, tableName) || readCfbStream(u8, tableName === "1Table" ? "0Table" : "1Table");
  const fcClx = u32(wdv, 418);
  const lcbClx = u32(wdv, 422);
  if (!table || lcbClx < 5 || fcClx + lcbClx > table.length) {
    return decodeDocBytes(word.subarray(2048), false).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  }
  const clx = table.subarray(fcClx, fcClx + lcbClx);
  let p = 0;
  let plc = null;
  while (p < clx.length) {
    const kind = clx[p];
    if (kind === 1) {
      const cb = clx[p + 1] | clx[p + 2] << 8;
      p += 3 + cb;
    } else if (kind === 2) {
      const lcb = clx[p + 1] | clx[p + 2] << 8 | clx[p + 3] << 16 | clx[p + 4] << 24;
      plc = clx.subarray(p + 5, p + 5 + lcb);
      break;
    } else break;
  }
  if (!plc || plc.length < 12) throw new Error("\u8FD9\u4E2A .doc \u7ED3\u6784\u592A\u65E7\uFF0C\u8BF7\u7528 Word \u53E6\u5B58\u4E3A .docx");
  const n = Math.floor((plc.length - 4) / 12);
  const cpDv = new DataView(plc.buffer, plc.byteOffset, plc.byteLength);
  const pieces = [];
  for (let i = 0; i < n; i++) {
    const cp = u32(cpDv, i * 4);
    const cpNext = u32(cpDv, (i + 1) * 4);
    const pcdOff = (n + 1) * 4 + i * 8;
    if (pcdOff + 8 > plc.length) break;
    const fcVal = u32(cpDv, pcdOff + 2);
    const compressed = Boolean(fcVal & 1073741824);
    const fc = compressed ? fcVal & ~1073741824 : fcVal;
    const chars = Math.max(0, cpNext - cp);
    const byteLen = compressed ? chars : chars * 2;
    if (fc < 0 || fc + byteLen > word.length) continue;
    pieces.push(decodeDocBytes(word.subarray(fc, fc + byteLen), compressed));
  }
  return pieces.join("").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\u0007/g, "	").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
function looksZip(u8) {
  return u8.length >= 4 && u8[0] === 80 && u8[1] === 75 && (u8[2] === 3 || u8[2] === 5 || u8[2] === 7);
}
function looksOle(u8) {
  return u8.length >= 8 && u8[0] === 208 && u8[1] === 207 && u8[2] === 17 && u8[3] === 224;
}
function looksXml(u8) {
  const head = new TextDecoder("utf-8").decode(u8.subarray(0, 200)).replace(/^\uFEFF/, "").trimStart();
  return head.startsWith("<?xml") || head.startsWith("<w:wordDocument") || head.startsWith("<w:document");
}
async function bytesToScript(u8, filename) {
  const name = filename.toLowerCase();
  if (looksZip(u8) || name.endsWith(".docx") || name.endsWith(".dotx")) {
    return docxToText(u8);
  }
  if (looksXml(u8) || name.endsWith(".xml")) {
    const xml = new TextDecoder("utf-8").decode(u8);
    const text = wordXmlToText(xml);
    if (text) return text;
    return markupToText(xml);
  }
  if (looksOle(u8) || name.endsWith(".doc")) {
    return oleDocToText(u8);
  }
  if (name.endsWith(".rtf") || new TextDecoder("latin1").decode(u8.subarray(0, 5)) === "{\\rtf") {
    return rtfToText(new TextDecoder("latin1").decode(u8));
  }
  if (name.endsWith(".fdx") || name.endsWith(".html") || name.endsWith(".htm")) {
    return markupToText(new TextDecoder("utf-8").decode(u8).replace(/^\uFEFF/, ""));
  }
  return new TextDecoder("utf-8").decode(u8).replace(/^\uFEFF/, "");
}
async function readScriptFile(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error("\u6587\u4EF6\u592A\u5927\uFF0C\u8BF7\u5148\u53E6\u5B58\u4E3A\u8F83\u5C0F\u7684 txt \u6216 docx");
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) throw new Error("PDF \u8BF7\u53E6\u5B58\u4E3A Word \u6216 txt \u518D\u5BFC\u5165");
  const u8 = new Uint8Array(await file.arrayBuffer());
  if (!u8.length) throw new Error("\u8FD9\u4E2A\u6587\u4EF6\u662F\u7A7A\u7684");
  const text = (await bytesToScript(u8, file.name)).trim();
  if (!text) throw new Error("\u6CA1\u6709\u8BFB\u5230\u6B63\u6587");
  if (text.length > MAX_SCRIPT_CHARS) return text.slice(0, MAX_SCRIPT_CHARS);
  return text;
}
export {
  bytesToScript,
  readScriptFile
};
