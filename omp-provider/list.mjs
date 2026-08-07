#!/usr/bin/env node
// omp-provider list —— 查看配置中的供应商模型
// 用法:
//   node list.mjs [-f <models.yml>]
// 输出: 每个供应商下配置的模型列表

const OVERRIDE = { file: "" };

const fsMod = globalThis.fs ?? (await import("node:fs"));

const readFileText = async (p) => {
  if (typeof read === "function") {
    try { return await read(p); } catch { /* fallthrough */ }
  }
  return await fsMod.promises.readFile(p, "utf8");
};

const say = (s = "") => (typeof print === "function" ? print(String(s)) : console.log(String(s)));

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

async function main() {
  const argv = (process.argv || []).slice(2).filter((a) => a && !a.startsWith("_") && !a.includes("omp_worker"));
  const opts = { ...OVERRIDE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const next = () => argv[++i];
    if (a === "-f" || a === "--file") opts.file = next() ?? "";
    else if (a === "-h" || a === "--help") { await say("用法: node list.mjs [-f models.yml]"); return; }
    else opts.file = a;
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

  const providers = parseProviders(content);
  if (!providers.length) {
    await say("⚠ 配置里没有 providers 块");
    return;
  }

  await say(`▸ 配置文件: ${norm(used)}`);
  await say("");

  for (const p of providers) {
    const keySrc = p.apiKey ? (p.apiKey.startsWith("!") ? "!命令" : /^[A-Za-z_][A-Za-z0-9_]*$/.test(p.apiKey) && process.env[p.apiKey] ? "env" : "字面值") : (p.auth === "none" ? "免密" : "无");
    await say(`${p.name}  (${p.baseUrl})  key: ${keySrc}`);
    if (p.ids.length) {
      for (const id of p.ids) {
        await say(`  └─ ${id}`);
      }
    } else {
      await say("  └─ (无配置模型)");
    }
    await say("");
  }

  const total = providers.reduce((s, p) => s + p.ids.length, 0);
  await say(`共 ${providers.length} 个供应商，${total} 个模型`);
}

await main();