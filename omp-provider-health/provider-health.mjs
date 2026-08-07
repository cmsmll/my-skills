#!/usr/bin/env node
// omp-provider-health 一键探测脚本（JS 版，自包含，无第三方依赖）
// 语义与 bash 版一致：可用 = 未在 disabledProviders 禁用 且 (免密 或 有可解析凭据)。
// 用法（推荐）:
//   在 omp 里 eval → language: js，用 read 加载本文件后执行（见 SKILL.md 第2节加载器），
//   参数在加载器注入的 OVERRIDE 里改；默认读 $USERPROFILE/.omp/agent/models.yml。
// 也可直接 node 运行: node provider-health.mjs [-f <models.yml>] [-t 超时秒] [-c <模型id>] [-v]
// 全程不打印明文 key，只显示来源（env:NAME / !命令 / 字面值）。

// —— 可在此覆盖参数（omp eval 加载器会整体替换本行；node 直跑时改这里）——
const OVERRIDE = { file: "", timeout: 8, chat: "", verbose: false };

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

// readFile 优先走 omp 的 prelude read（能正确解析 C:/… / /c/…），读不到再 fallback 原生 fs
const readFileText = async (p) => {
  if (typeof read === "function") {
    try { return await read(p); } catch { /* fallthrough */ }
  }
  return await fsMod.promises.readFile(p, "utf8");
};

// print 优先，退化为 console.log
const say = (s = "") => (typeof print === "function" ? print(String(s)) : console.log(String(s)));

// 台宽-aware 补位（中文按 2 个英文字符宽）
const cw = (s) => { let w = 0; for (const ch of String(s)) w += ch.codePointAt(0) > 0xff ? 2 : 1; return w; };
const pad = (s, n, ch = " ") => { s = String(s ?? ""); const w = cw(s); return w >= n ? s : s + ch.repeat(n - w); };

// —— 解析固定 2 空格缩进 YAML（同 bash 版解析假设）——
//   providers:            # 0 缩进
//     <厂商id>:           # 2
//       baseUrl: ...      # 4
//       apiKey: ...       # 4
//       api: ...          # 4
//       auth: ...         # 4
//       models:
//         - id: gpt-x     # 6（只取单行 id）
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

// —— disabledProviders ——
function disabledFromYamlText(text) {
  const out = new Set();
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === "[]" || line.startsWith("#")) continue;
    const m = line.match(/^-\s*(.*)$/);
    if (!m) continue;
    let item = m[1].trim();
    item = item.replace(/^"([^"]*)"$/, "$1").replace(/^'([^']*)'$/, "$1");
    if (/^[A-Za-z0-9_.-]+$/.test(item)) out.add(item); // 只收纯标识符；path 作用域条目带 ':'，自动跳过
  }
  return [...out];
}
// 读 config.yml 的 disabledProviders 块；无该键返回 null（不参与覆盖）
function disabledFromConfigFile(path) {
  let text; try { text = fsMod.readFileSync(path, "utf8"); } catch { return null; }
  const out = new Set(); let inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, "");
    if (/^disabledProviders:\s*$/.test(line)) { inBlock = true; continue; }
    if (!inBlock) continue;
    if (/^[A-Za-z0-9_.-]+:/.test(line) && !line.startsWith("-")) break; // 下一个顶层键结束块
    const m = line.match(/^\s*-\s*(.*)$/);
    if (!m) continue;
    let item = m[1].trim().replace(/^"([^"]*)"$/, "$1").replace(/^'([^']*)'$/, "$1");
    if (/^[A-Za-z0-9_.-]+$/.test(item)) out.add(item);
  }
  if (!inBlock) return null; // 块根本没出现，返回 null
  return [...out];
}
function loadDisabled(cwd) {
  // 1) omp config get disabledProviders（生效合并列表）
  const r = spawnSync("omp", ["config", "get", "disabledProviders"], 8000);
  if (r.ok) return { list: disabledFromYamlText(r.stdout), source: "omp config get disabledProviders" };
  // 2) fallback: 项目 config.yml 优先（wholesale 覆盖全局），其次全局 config.yml
  const home = process.env.USERPROFILE || process.env.HOME || "";
  for (const p of [`${cwd}/.omp/config.yml`, `${home}/.omp/agent/config.yml`]) {
    const list = disabledFromConfigFile(p);
    if (list !== null) return { list, source: p };
  }
  return { list: [], source: "未读到（视为空）" };
}

// —— 凭据解析：auth:none 免密；否则 env-name-or-literal；! 前缀命令取 stdout ——
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

// —— 探测 GET {baseUrl}/models：可达 / 鉴权 / 模型列表 ——
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
    return { http: "000", label: cls, body: "", ids: [] };
  }
  const body = await res.text().catch(() => "");
  let ids = [];
  try { const j = JSON.parse(body); if (Array.isArray(j?.data)) ids = j.data.map((x) => x && x.id).filter(Boolean); } catch {}
  const label = res.status === 200 ? "200 OK"
    : res.status === 401 ? "401 鉴权失败"
    : res.status === 403 ? "403 无权限"
    : `HTTP ${res.status}`;
  return { http: String(res.status), label, body, ids };
}

// —— 端到端 POST {base}/chat/completions，1 token ——
async function chatProbe(base, key, model, timeoutMs) {
  const url = `${base.replace(/\/+$/, "")}/chat/completions`;
  const headers = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  let code = "无响应";
  try {
    const res = await fetch(url, {
      method: "POST", headers, body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.text().catch(() => {});
    code = res.status === 0 ? "连接失败/超时(000)" : String(res.status);
  } catch (e) {
    code = /timed out|timeout/i.test(String(e?.message || e)) ? "连接失败/超时(000)" : "连接失败/超时(000)";
  }
  return code;
}

async function main() {
  // eval worker 的 argv 里带哨兵标记，过滤掉；node CLI 则正常
  const argv = (process.argv || []).slice(2).filter((a) => a && !a.startsWith("_") && !a.includes("omp_worker"));
  const opts = { ...OVERRIDE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const next = () => argv[++i];
    switch (a) {
      case "-f": case "--file": opts.file = next() ?? ""; break;
      case "-t": case "--timeout": { const n = Number(next()); if (n > 0) opts.timeout = n; break; }
      case "-c": case "--chat": opts.chat = next() ?? ""; break;
      case "-v": case "--verbose": opts.verbose = true; break;
      case "-h": case "--help": await say("用法: node omp-provider-health.mjs [-f models.yml] [-t 超时秒] [-c 模型id] [-v]"); break;
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

  // 汇总表（中文按双宽对齐）
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

  // 可选端到端
  if (opts.chat) {
    await say("");
    await say(`▸ 端到端 chat 探测 model=${opts.chat}`);
    for (const p of providers) {
      if (!p.ids.includes(opts.chat)) continue;
      const cred = resolveCred(p.apiKey, p.auth);
      const code = await chatProbe(p.baseUrl, cred.key, opts.chat, opts.timeout * 1000);
      await say(`  └─ POST ${p.baseUrl.replace(/\/+$/, "")}/chat/completions  model=${opts.chat} → HTTP ${code}`);
    }
  }
}

await main();