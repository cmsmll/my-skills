#!/usr/bin/env node
// omp-provider update —— 更新供应商模型（供应商推出新模型时，更新 models.yml 配置）
// 用法（agent 通过 ask 工具交互，脚本不做 readline）:
//   node update.mjs --list                       # 自动读配置，列出供应商
//   node update.mjs --name "provider" --probe    # 探测该供应商服务器模型，标记新增（未配置）
//   node update.mjs --name "provider" --add "id1,id2"   # 按指定 id 追加
//   node update.mjs --name "provider" --all      # 探测后自动追加全部新增模型
// 全程不打印 key。

const OVERRIDE = { name: "", list: false, check: false, probe: false, add: "", all: false, file: "", env: "", timeout: 8 };

const fsMod = globalThis.fs ?? (await import("node:fs"));

const readFileText = async (p) => {
  if (typeof read === "function") {
    try { return await read(p); } catch { /* fallthrough */ }
  }
  return await fsMod.promises.readFile(p, "utf8");
};

const say = (s = "") => (typeof print === "function" ? print(String(s)) : console.log(String(s)));

// —— 解析固定 2 空格缩进 YAML，返回供应商名及其行区间 ——
function parseProvidersWithRange(content) {
  const providers = [];
  let cur = null;
  const lines = (content || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mHead = line.match(/^  ([A-Za-z0-9_.-]+):\s*$/);
    if (mHead) {
      if (cur) providers.push(cur);
      cur = { name: mHead[1], start: i, end: null, baseUrl: "", apiKey: "", auth: "", ids: [] };
      continue;
    }
    if (!cur) continue;
    let m = line.match(/^    baseUrl:[ \t]*(.*)$/); if (m) { cur.baseUrl = stripVal(m[1]); continue; }
    m = line.match(/^    apiKey:[ \t]*(.*)$/);  if (m) { cur.apiKey = stripVal(m[1]); continue; }
    m = line.match(/^    auth:[ \t]*(.*)$/);    if (m) { cur.auth = stripVal(m[1]); continue; }
    m = line.match(/^      -[ \t]+id:[ \t]*(.*)$/); if (m) { const id = stripVal(m[1]); if (id) cur.ids.push(id); continue; }
  }
  if (cur) providers.push(cur);
  for (let i = 0; i < providers.length; i++) {
    providers[i].end = i + 1 < providers.length ? providers[i + 1].start - 1 : lines.length - 1;
  }
  return { providers, lines };
}

function stripVal(s) {
  s = s.replace(/^[ \t\r]+|[ \t\r]+$/g, "");
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  return s;
}

function keySrc(p) {
  if (p.auth === "none") return "免密";
  if (!p.apiKey) return "无";
  if (p.apiKey.startsWith("!")) return "!命令";
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.apiKey) && process.env[p.apiKey]) return "env";
  return "字面值";
}

// —— 解析 apiKey：env 变量名 → 从 .env 读值；字面量原样 ——
async function resolveApiKey(p, envPath) {
  if (p.auth === "none") return "";
  if (!p.apiKey) return null;
  if (p.apiKey.startsWith("!")) return null; // 命令型暂不支持
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.apiKey)) {
    if (process.env[p.apiKey]) return process.env[p.apiKey];
    let envContent = "";
    try { envContent = await fsMod.promises.readFile(envPath, "utf8"); } catch {}
    const m = envContent.match(new RegExp(`^${p.apiKey}=(.*)$`, "m"));
    if (m) return stripVal(m[1]);
    return null;
  }
  return p.apiKey;
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
    return { ok: false, http: "000", label: cls, ids: [] };
  }
  const body = await res.text().catch(() => "");
  let ids = [];
  try { const j = JSON.parse(body); if (Array.isArray(j?.data)) ids = j.data.map((x) => x && x.id).filter(Boolean); } catch {}
  const ok = res.status === 200;
  const label = ok ? "200 OK"
    : res.status === 401 ? "401 鉴权失败"
    : res.status === 403 ? "403 无权限"
    : `HTTP ${res.status}`;
  return { ok, http: String(res.status), label, ids };
}

// —— 把新增模型 id 追加到指定供应商的 models 块末尾 ——
function appendModelsSimple(content, name, newIds) {
  const { providers, lines } = parseProvidersWithRange(content);
  const target = providers.find((p) => p.name === name);
  if (!target) return null;
  const esc = (s) => (/[:\{\}\[\],&#'"%@`#]/.test(s) || s.includes("'") ? JSON.stringify(s) : s);
  const block = newIds.map((id) =>
    `      - id: ${esc(id)}\n` +
    `        name: ${esc(id)}\n` +
    `        cost:\n` +
    `          input: 0\n` +
    `          output: 0\n` +
    `          cacheRead: 0\n` +
    `          cacheWrite: 0\n` +
    `        contextWindow: 128000\n` +
    `        maxTokens: 16384`
  ).join("\n");
  let insertAt = -1;
  // 定位该供应商块内最后一个非空内容行（models 块末尾），在其后追加新 model 条目
  for (let i = target.start; i <= target.end; i++) {
    if (lines[i].trim() !== "") insertAt = i;
  }
  if (insertAt === -1) return null; // 空块
  const newLines = [...lines.slice(0, insertAt + 1)];
  newLines.push(...block.split("\n"));
  newLines.push(...lines.slice(insertAt + 1));
  let out = newLines.join("\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}

async function main() {
  const argv = (process.argv || []).slice(2).filter((a) => a && !a.startsWith("_") && !a.includes("omp_worker"));
  const opts = { ...OVERRIDE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const next = () => argv[++i];
    switch (a) {
      case "--name": opts.name = next() ?? ""; break;
      case "--list": opts.list = true; break;
      case "--check": opts.check = true; break;
      case "--probe": opts.probe = true; break;
      case "--add": opts.add = next() ?? ""; break;
      case "--all": opts.all = true; break;
      case "-f": case "--file": opts.file = next() ?? ""; break;
      case "--env": opts.env = next() ?? ""; break;
      case "-t": case "--timeout": { const n = Number(next()); if (n > 0) opts.timeout = n; break; }
      case "-h": case "--help":
        await say("用法: node update.mjs --list | --name <供应商> [--probe | --add \"id1,id2\" | --all]");
        return;
    }
  }

  const home = process.env.USERPROFILE || process.env.HOME || "";
  let cfg = opts.file || `${home}/.omp/agent/models.yml`;
  const envPath = opts.env || `${home}/.omp/agent/.env`;
  const norm = (p) => String(p).replace(/\\/g, "/");

  let content = null, used = "";
  for (const cand of [cfg, cfg.replace(/\.yml$/, ".yaml")]) {
    try { content = await readFileText(cand); used = cand; break; } catch {}
  }
  if (content === null) {
    await say(`✗ 找不到配置: ${norm(cfg)}`);
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }
  const providers = parseProvidersWithRange(content).providers;
  if (!providers.length) { await say("⚠ 配置里没有 providers 块"); return; }

  // --list：列出供应商；--check 时并行探测各供应商，显示新增模型数量
  if (opts.list) {
    await say(`▸ 配置文件: ${norm(used)}`);
    const lines = [];
    for (let i = 0; i < providers.length; i++) {
      const p = providers[i];
      lines.push(`  [${i + 1}] ${p.name}  ${p.baseUrl}  ${p.ids.length} 个模型  key: ${keySrc(p)}`);
    }

    // --check：并行探测，每个供应商标注新增模型数
    if (opts.check) {
      const results = await Promise.all(providers.map(async (p) => {
        if (!p.baseUrl) return { p, err: "缺 baseUrl", fresh: [] };
        const key = await resolveApiKey(p, envPath);
        const probe = await probeModels(p.baseUrl, key, opts.timeout * 1000);
        if (!probe.ok) return { p, err: probe.label, fresh: [] };
        const configured = new Set(p.ids);
        return { p, err: "", fresh: probe.ids.filter((id) => !configured.has(id)), server: probe.ids.length };
      }));
      const total = results.reduce((s, r) => s + r.fresh.length, 0);
      await say(`正在探测新增模型...`);
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const tag = r.err ? `探测失败(${r.err})` : (r.fresh.length ? `🔺 新增 ${r.fresh.length} 个` : "已是最新");
        await say(`  [${i + 1}] ${r.p.name}  ${tag}`);
      }
      await say(`合计: ${total} 个新增模型`);
      await say("__JSON__ " + JSON.stringify({
        total,
        providers: results.map((r, i) => ({
          idx: i + 1, name: r.p.name, err: r.err || "", fresh: r.fresh,
          freshCount: r.fresh.length, configuredCount: r.p.ids.length,
        })),
      }));
      return;
    }

    for (const l of lines) await say(l);
    return;
  }

  // 定位供应商（支持编号或名称）
  const target = providers.find((p) => p.name === opts.name) ||
    (Number.isInteger(Number(opts.name)) ? providers[Number(opts.name) - 1] : undefined);
  if (!target) {
    await say(`✗ 未找到供应商 "${opts.name}"。可用：${providers.map((p) => p.name).join(", ")}`);
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }
  const name = target.name;

  // 探测模式 & --all
  if (opts.probe || opts.all) {
    if (!target.baseUrl) {
      await say(`✗ 供应商 "${name}" 缺 baseUrl，无法探测`);
      if (typeof process !== "undefined") process.exitCode = 1;
      return;
    }
    const key = await resolveApiKey(target, envPath);
    await say(`▸ 探测 ${name} (${target.baseUrl}) ...`);
    const probe = await probeModels(target.baseUrl, key, opts.timeout * 1000);
    if (!probe.ok) {
      await say(`✗ 供应商不可用: ${probe.label}`);
      if (typeof process !== "undefined") process.exitCode = 1;
      return;
    }
    const configured = new Set(target.ids);
    const fresh = probe.ids.filter((id) => !configured.has(id));
    const stale = target.ids.filter((id) => !probe.ids.includes(id));
    await say(`✓ 供应商可达，服务端共 ${probe.ids.length} 个模型:`);
    if (fresh.length) {
      await say(`  🔺 新增 ${fresh.length} 个（未在配置中）:`);
      for (let fi = 0; fi < fresh.length; fi++) await say(`    [${fi + 1}] ${fresh[fi]}`);
    } else {
      await say("  · 无新增模型，配置已是最新");
    }
    if (stale.length) await say(`  ⤓ 已配置但服务端已无 ${stale.length} 个: ${stale.join(", ")}`);
    await say(`  已配置: ${configured.size} 个`);
    await say("__JSON__ " + JSON.stringify({ fresh, stale, configured: [...configured], server: probe.ids }));

    // --all：探测后自动追加全部新增
    if (opts.all && fresh.length) {
      const newContent = appendModelsSimple(content, name, fresh);
      if (newContent === null) {
        await say(`✗ 供应商 "${name}" 无 models 块，无法追加`);
        if (typeof process !== "undefined") process.exitCode = 1;
        return;
      }
      await fsMod.promises.writeFile(used, newContent, "utf8");
      await say(`✓ 已为 ${name} 追加 ${fresh.length} 个新模型（${norm(used)}）`);
      await say(`  新增: ${fresh.join(", ")}`);
      await say(`  重开会话后生效`);
    }
    return;
  }

  // --add：按指定 id 追加
  if (opts.add) {
    const newIds = opts.add.split(",").map((s) => s.trim()).filter(Boolean);
    if (!newIds.length) {
      await say("✗ --add 需逗号分隔的模型 id");
      if (typeof process !== "undefined") process.exitCode = 1;
      return;
    }
    const configured = new Set(target.ids);
    const toAdd = newIds.filter((id) => !configured.has(id));
    if (!toAdd.length) { await say("· 指定模型均已配置，无需追加"); return; }
    const newContent = appendModelsSimple(content, name, toAdd);
    if (newContent === null) {
      await say(`✗ 供应商 "${name}" 无 models 块，无法追加`);
      if (typeof process !== "undefined") process.exitCode = 1;
      return;
    }
    await fsMod.promises.writeFile(used, newContent, "utf8");
    await say(`✓ 已为 ${name} 追加 ${toAdd.length} 个新模型（${norm(used)}）`);
    await say(`  新增: ${toAdd.join(", ")}`);
    await say(`  重开会话后生效`);
    return;
  }

  await say("✗ 需要 --probe（查看新增）或 --add / --all（追加模型）");
  if (typeof process !== "undefined") process.exitCode = 1;
}

await main();