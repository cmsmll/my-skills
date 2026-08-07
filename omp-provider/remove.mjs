#!/usr/bin/env node
// omp-provider remove —— 移除供应商
// 用法（agent 通过 ask 工具交互，脚本不做 readline）:
//   node remove.mjs --list                  # 自动读配置，列出供应商
//   node remove.mjs --name <供应商名>      # 移除指定供应商
//   node remove.mjs --list -f <models.yml>  # 指定配置文件
// 全程不打印明文 key。

const OVERRIDE = { name: "", list: false, file: "" };

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
      cur = { name: mHead[1], start: i, end: null };
    }
  }
  if (cur) providers.push(cur);
  for (let i = 0; i < providers.length; i++) {
    providers[i].end = i + 1 < providers.length ? providers[i + 1].start - 1 : lines.length - 1;
  }
  return { providers, lines };
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

async function main() {
  const argv = (process.argv || []).slice(2).filter((a) => a && !a.startsWith("_") && !a.includes("omp_worker"));
  const opts = { ...OVERRIDE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const next = () => argv[++i];
    switch (a) {
      case "--name": opts.name = next() ?? ""; break;
      case "--list": opts.list = true; break;
      case "-f": case "--file": opts.file = next() ?? ""; break;
      case "-h": case "--help":
        await say("用法: node remove.mjs --list [-f models.yml] | --name <供应商名>");
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
      await say(`  [${i + 1}] ${providers[i].name}`);
    }
    return;
  }

  // --name：移除指定供应商
  if (!opts.name) {
    await say("✗ 需要 --list 查看后 --name 指定要移除的供应商");
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }

  const { ok, content: newContent } = removeProvider(content, opts.name);
  if (!ok) {
    await say(`✗ 未找到供应商 "${opts.name}"。可用：${providers.map((p) => p.name).join(", ")}`);
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }

  await fsMod.promises.writeFile(used, newContent, "utf8");
  const remaining = providers.filter((p) => p.name !== opts.name).map((p) => p.name);
  await say(`✓ 已移除供应商 "${opts.name}"（${norm(used)}）`);
  await say(`  剩余供应商: ${remaining.join(", ") || "无"}`);
  await say(`  重开会话后生效`);
}

await main();