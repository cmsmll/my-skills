#!/usr/bin/env node
// omp-provider status —— 查看供应商状态（探测配置的每个 provider 是否可用）
// 语义与 omp-provider-health 一致：可用 = 未在 disabledProviders 禁用 且 (免密 或 有可解析凭据)。
// 用法:
//   node status.mjs [-f <models.yml>] [-t 超时秒] [-v]
//   或在 omp eval 里 read 本文件执行（见 SKILL.md 加载器）
// 全程不打印明文 key，只显示来源（env:NAME / !命令 / 字面值）。

const OVERRIDE = { file: "", timeout: 8, verbose: false };

const fsMod = globalThis.fs ?? (await import("node:fs"));
const cp = typeof Bun !== "undefined" ? null : await import("node:child_process").catch(() => null);

const spawnSync = (cmd, args, timeoutMs) => {
  const t = timeoutMs ?? 8000;
  const normOut = (o) => (o == null || o === "" ? "" : (typeof o === "string" ? o : Buffer.from(o).toString("utf8")));
  try {
    if (typeof Bun !== "undefined" && Bun.spawnSync) {
      const r = Bun.spawnSync([cmd, ...args], { encoding: "utf8", timeout: t });
      return { ok: r.exitCode === 0, stdout: normOut(r.stdout), stderr: normOut(r.stderr) };
    }
    const r = cp.spawnSync(cmd, args, { encoding: "utf8", timeout: t });
    return { ok: r.status === 0, stdout: normOut(r.stdout), stderr: normOut(r.stderr) };
  } catch {
    return { ok: false, stdout: "", stderr: "" };
  }
};

const readFileText = async (p) => {
  if (typeof read === "function") {
    try { return await read(p); } catch { /* fallthrough */ }
  }
  return await fsMod.promises.readFile(p, "utf8");
};

const say = (s = "") => (typeof print === "function" ? print(String(s)) : console.log(String(s)));

const cw = (s) => { let w = 0; for (const ch of String(s)) w += ch.codePointAt(0) > 0xff ? 2 : 1; return w; };
const pad = (s, n, ch = " ") => { s = String(s ?? ""); const w = cw(s); return w >= n ? s : s + ch.repeat(n - w); };

// —— 解析固定 2 空格缩进 YAML ——
function stripVal(s) {
  s = s.replace(/^[ \t\r]+|[ \t\r]+$/g, "");
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  return s;
}
function parseProviders(content) {
  const providers = [];
  let cur = null;
  for (const raw of (content || "").split(/\r?\n/)) {
    const line = raw.replace(/\r$/, "");
    const mHead = line.match(/^  ([A-Za-z0-9_.-]+):\s*$/);
    if (mHead) { if (cur) providers.push(cur); cur = { name: mHead[1], baseUrl: "", apiKey: "", api: "", auth: "", ids: [] }; continue; }
    if (!cur) continue;
    let m = line.match(/^    baseUrl:[ \t]*(.*)$/); if (m) { cur.baseUrl = stripVal(m[1]); continue; }
    m = line.match(/^    apiKey:[ \t]*(.*)$/);  if (m) { cur.apiKey = stripVal(m[1]); continue; }
    m = line.match(/^    api:[ \t]*(.*)$/);     if (m) { cur.api = stripVal(m[1]); continue; }
    m = line.match(/^    auth:[ \t]*(.*)$/);    if (m) { cur.auth = stripVal(m[1]); continue; }
    m = line.match(/^      -[ \t]+id:[ \t]*(.*)$/); if (m) { const id = stripVal(m[1]); if (id) cur.ids.push(id); continue; }
  }
  if (cur) providers.push(cur);
  return providers;
}

// —— disabledProviders（精简，够用即可）——
function loadDisabled(cwd) {
  const r = spawnSync("omp", ["config", "get", "disabledProviders"], 8000);
  if (r.ok) {
    const out = new Set();
    for (const raw of r.stdout.trim().split(/\r?\n/)) {
      const m = raw.trim().match(/^-\s*(.*)$/);
      if (m) { const it = m[1].trim().replace(/^"([^"]*)"$/, "$1").replace(/^'([^']*)'$/, "$1"); if (/^[A-Za-z0-9_.-]+$/.test(it)) out.add(it); }
    }
    return { list: [...out], source: "omp config get disabledProviders" };
  }
  return { list: [], source: "未读到（视为空）" };
}

// —— 凭据解析 ——
function resolveCred(apiKeyRaw, auth) {
  if (auth === "none") return { key: "", src: "免密 auth:none" };
  if (!apiKeyRaw) return { key: "", src: "未配置 apiKey" };
  if (apiKeyRaw.startsWith("!")) {
    let out = "";
    const r = spawnSync("bash", ["-c", apiKeyRaw.slice(1)], 10000);
    if (r.ok) out = r.stdout.trim();
    return { key: out, src: "!命令(secret)" };
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyRaw)) {
    const v = process.env[apiKeyRaw];
    if (v) return { key: v, src: `env:${apiKeyRaw}` };
  }
  return { key: apiKeyRaw, src: `字面值(env ${apiKeyRaw} 未设置)` };
}

// —— 探测 GET {baseUrl}/models ——
async function probeModels(base, key, timeoutMs) {
  const url = `${base.replace(/\/+$/, "")}/models`;
  const headers = {};
  if (key) headers.Authorization = `Bearer ${key}`;
  let res = null;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const name = e?.name || "";
    const msg = String(e?.message || e || "") + " " + String(e?.cause?.code || e?.cause?.message || "");
    let cls = "连接失败";
    if (name === "TimeoutError" || /timed out|timeout/i.test(msg)) cls = "超时";
    else if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|could not resolve|resolve host|Name or service/i.test(msg)) cls = "DNS失败";
    return { http: "000", label: cls, ids: [] };
  }
  const body = await res.text().catch(() => "");
  let ids = [];
  try { const j = JSON.parse(body); if (Array.isArray(j?.data)) ids = j.data.map((x) => x && x.id).filter(Boolean); } catch {}
  const label = res.status === 200 ? "200 OK"
    : res.status === 401 ? "401 鉴权失败"
    : res.status === 403 ? "403 无权限"
    : `HTTP ${res.status}`;
  return { http: String(res.status), label, ids };
}

async function main() {
  const argv = (process.argv || []).slice(2).filter((a) => a && !a.startsWith("_") && !a.includes("omp_worker"));
  const opts = { ...OVERRIDE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const next = () => argv[++i];
    switch (a) {
      case "-f": case "--file": opts.file = next() ?? ""; break;
      case "-t": case "--timeout": { const n = Number(next()); if (n > 0) opts.timeout = n; break; }
      case "-v": case "--verbose": opts.verbose = true; break;
      case "-h": case "--help": await say("用法: node status.mjs [-f models.yml] [-t 超时秒] [-v]"); break;
      default: opts.file = a;
    }
  }

  const home = process.env.USERPROFILE || process.env.HOME || "";
  let cfg = opts.file || `${home}/.omp/agent/models.yml`;
  const norm = (p) => String(p).replace(/\\/g, "/");

  let content = null, used = "";
  for (const cand of [cfg, cfg.replace(/\.yml$/, ".yaml")]) {
    try { content = await readFileText(cand); used = cand; break; } catch {}
  }
  if (content === null) {
    await say(`✗ 找不到配置: ${norm(cfg)}（用 -f 显式指定）`);
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }
  await say(`▸ 配置文件: ${norm(used)}  (探测超时 ${opts.timeout}s)`);

  const providers = parseProviders(content);
  if (!providers.length) { await say("⚠ 配置里没有 providers 块"); return; }

  const disp = loadDisabled(process.cwd());
  await say(`▸ disabledProviders(生效): ${disp.list.length ? disp.list.join(", ") : "空"}（来源: ${disp.source}）`);

  const H = ["厂商", "baseUrl", "凭据状态", "可达/HTTP码", "配置模型数", "服务端模型数", "匹配/缺失", "备注"];
  const W = [14, 30, 26, 16, 11, 11, 18, 28];
  const row = (cells) => cells.map((c, i) => pad(c, W[i])).join("").replace(/\s+$/, "");
  await say(row(H));
  await say(W.map((w) => "-".repeat(w)).join(""));

  for (const p of providers) {
    const cfgC = p.ids.length;
    if (disp.list.includes(p.name)) {
      await say(row([p.name, p.baseUrl, "-", "只读·已禁用", cfgC, "-", "N/A", "disabledProviders 精确命中，不可选"]));
      continue;
    }
    const cred = resolveCred(p.apiKey, p.auth);
    if (opts.verbose) await say(`  [${p.name}] baseUrl=${p.baseUrl} auth=${p.auth || "-"} key_src=${cred.src}`);
    const r = await probeModels(p.baseUrl, cred.key, opts.timeout * 1000);
    if (opts.verbose && r.ids.length) await say(`      服务器模型列表: ${r.ids.join(", ")}`);
    let okC = 0; const miss = [];
    for (const m of p.ids) { if (r.ids.includes(m)) okC++; else miss.push(m); }
    let mt = `${okC}/${cfgC}`;
    if (miss.length) mt += ` 缺失:[ ${miss.join(" ")} ]`;
    let note = "";
    if (r.label === "200 OK") note = cfgC > 0 ? "模型全部可用" : "可达(无配置模型)";
    if (!r.label.startsWith("200")) note = "端不可用";
    await say(row([p.name, p.baseUrl, cred.src, r.label, cfgC, r.ids.length, mt, note]));
  }
}

await main();