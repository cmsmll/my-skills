#!/usr/bin/env node
// omp-provider remove —— 移除供应商
// 用法（agent 通过 ask 工具交互，脚本不做 readline）:
//   node remove.mjs --list                  # 自动读配置，列出供应商
//   node remove.mjs --name "a,b"            # 移除指定供应商（多选，名称或编号）
//   node remove.mjs --list -f <models.yml>  # 指定配置文件
// 全程不打印明文 key。

const OVERRIDE = { name: "", list: false, file: "", env: "" };

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

// —— key 来源描述 ——
function keySrc(p) {
  if (p.auth === "none") return "免密";
  if (!p.apiKey) return "无";
  if (p.apiKey.startsWith("!")) return "!命令";
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.apiKey) && process.env[p.apiKey]) return "env";
  return "字面值";
}

// —— 从文件中移除指定供应商，返回 (成功, 新内容) ——
function removeProvider(content, name) {
  const { providers, lines } = parseProvidersWithRange(content);
  const target = providers.find((p) => p.name === name);
  if (!target) return { ok: false, content: null };
  const newLines = lines.filter((_, i) => i < target.start || i > target.end);
  let out = "";
  for (const l of newLines) {
    if (l.trim() === "" && out.endsWith("\n\n")) continue;
    out += l + "\n";
  }
  out = out.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  return { ok: true, content: out };
}

// —— 从 .env 删除指定变量行，返回被删的变量名列表 ——
async function removeEnvKeys(envPath, varNames) {
  if (!varNames.length) return [];
  let content = "";
  try { content = await fsMod.promises.readFile(envPath, "utf8"); } catch { return []; }
  const removed = [];
  let changed = false;
  const lines = content.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (m && varNames.includes(m[1])) {
      removed.push(m[1]);
      changed = true;
      continue;
    }
    out.push(line);
  }
  if (changed) {
    await fsMod.promises.writeFile(envPath, out.join("\n").replace(/\n{2,}/g, "\n").trimEnd() + "\n", "utf8");
  }
  return removed;
}

async function main() {
  const argv = (process.argv || []).slice(2).filter((a) => a && !a.startsWith("_") && !a.includes("omp_worker"));
  const opts = { ...OVERRIDE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const next = () => argv[++i];
    switch (a) {
      case "--name": opts.name = next() ?? ""; break;
      case "--list": opts.list = true; break;
      case "-f": case "--file": opts.file = next() ?? ""; break;
      case "--env": opts.env = next() ?? ""; break;
      case "-h": case "--help":
        await say("用法: node remove.mjs --list [-f models.yml] | --name <供应商名> [--env .env路径]");
        return;
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
    await say(`✗ 找不到配置: ${norm(cfg)}`);
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }

  const providers = parseProvidersWithRange(content).providers;
  if (!providers.length) { await say("⚠ 配置里没有 providers 块"); return; }

  // --list：自动读取配置并列出供应商（带编号，给 agent 转述用户选择）
  if (opts.list) {
    await say(`▸ 配置文件: ${norm(used)}`);
    await say("当前供应商：");
    for (let i = 0; i < providers.length; i++) {
      const p = providers[i];
      const models = p.ids.length ? `${p.ids.length} 个模型` : "无模型";
      await say(`  [${i + 1}] ${p.name}  ${p.baseUrl}  ${models}  key: ${keySrc(p)}`);
    }
    return;
  }

  // --name：移除指定供应商（逗号分隔多选）
  if (!opts.name) {
    await say("✗ 需要 --list 查看后 --name 指定要移除的供应商（逗号分隔多选）");
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }

  // 解析多选：逗号分隔 + 支持编号（1,3 或 a,b）
  const picks = opts.name.split(",").map((s) => s.trim()).filter(Boolean);
  const targets = [];
  for (const p of picks) {
    const n = Number(p);
    if (!isNaN(n) && n >= 1 && n <= providers.length) {
      targets.push(providers[n - 1].name);
    } else if (providers.some((x) => x.name === p)) {
      targets.push(p);
    } else {
      await say(`⚠ 未找到 "${p}"，跳过`);
    }
  }
  const unique = [...new Set(targets)];
  if (!unique.length) {
    await say(`✗ 未匹配到任何供应商。可用：${providers.map((p) => p.name).join(", ")}`);
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }

  // 逐个移除
  let content2 = content;
  for (const t of unique) {
    const { ok, content: newC } = removeProvider(content2, t);
    if (ok) content2 = newC;
  }

  await fsMod.promises.writeFile(used, content2, "utf8");
  const remaining = providers.filter((p) => !unique.includes(p.name)).map((p) => p.name);
  await say(`✓ 已移除供应商: ${unique.join(", ")}（${norm(used)}）`);
  await say(`  剩余供应商: ${remaining.join(", ") || "无"}`);

  // 清理 .env：对每个被移除供应商，取其 apiKey 字段（若是 env 变量名则删除该行）
  const removedProvs = providers.filter((p) => unique.includes(p.name));
  const envVarNames = removedProvs.map((p) => p.apiKey).filter((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k));
  if (envVarNames.length) {
    const envPath = opts.env || `${process.env.USERPROFILE || process.env.HOME || ""}/.omp/agent/.env`;
    const cleaned = await removeEnvKeys(envPath, envVarNames);
    if (cleaned.length) {
      await say(`  ✓ 已清理 .env（${cleaned.join(", ")}）: ${norm(envPath)}`);
    } else {
      await say(`  · .env 中未找到 ${envVarNames.join(", ")}（可忽略）`);
    }
  }
  await say(`  重开会话后生效`);
}

await main();