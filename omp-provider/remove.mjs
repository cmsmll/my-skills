#!/usr/bin/env node
// omp-provider remove —— 移除供应商（TUI 选择 → 确认 → 删除）
// 用法:
//   node remove.mjs                        # 交互选择要移除的供应商
//   node remove.mjs -f <models.yml>        # 指定配置文件
// 全程不打印明文 key。

const OVERRIDE = { file: "" };

const fsMod = globalThis.fs ?? (await import("node:fs"));
const readline = typeof Bun !== "undefined" ? null : await import("node:readline").catch(() => null);

const readFileText = async (p) => {
  if (typeof read === "function") {
    try { return await read(p); } catch { /* fallthrough */ }
  }
  return await fsMod.promises.readFile(p, "utf8");
};

const say = (s = "") => (typeof print === "function" ? print(String(s)) : console.log(String(s)));

// —— 交互式 stdin 输入 ——
const ask = (q) => new Promise((resolve) => {
  if (typeof Bun !== "undefined" && Bun.stdin) {
    process.stdout.write(q);
    Bun.stdin.stream().getReader().read().then(({ value }) => resolve(new TextDecoder().decode(value).trim()));
  } else if (readline) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (ans) => { rl.close(); resolve(ans.trim()); });
  } else {
    say(q);
    resolve(""); // fallback
  }
});

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
  let cfgOverride = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const next = () => argv[++i];
    switch (a) {
      case "-f": case "--file": cfgOverride = next() ?? ""; break;
      case "-h": case "--help":
        await say("用法: node remove.mjs  [-f models.yml]");
        return;
    }
  }

  const home = process.env.USERPROFILE || process.env.HOME || "";
  let cfg = cfgOverride || `${home}/.omp/agent/models.yml`;
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

  // TUI：编号列表 → 选择 → 确认
  await say(`▸ 配置文件: ${norm(used)}`);
  await say("选择要移除的供应商：");
  for (let i = 0; i < providers.length; i++) {
    await say(`  [${i + 1}] ${providers[i].name}`);
  }

  const ans = await ask("\n输入编号（逗号分隔多选）: ");
  const targets = [];
  for (const p of ans.split(",").map((s) => s.trim()).filter(Boolean)) {
    const n = Number(p);
    if (!isNaN(n) && n >= 1 && n <= providers.length) {
      targets.push(providers[n - 1].name);
    } else {
      await say(`⚠ 无效编号 "${p}"，跳过`);
    }
  }
  const unique = [...new Set(targets)];
  if (!unique.length) { await say("✗ 未选择，取消"); return; }

  await say(`\n将移除 ${unique.length} 个供应商：${unique.join(", ")}`);
  const confirm = await ask("确认？y/N: ");
  if (confirm.toLowerCase() !== "y") { await say("✗ 已取消"); return; }

  // 执行
  let content2 = content;
  for (const t of unique) {
    const { ok, content: newC } = removeProvider(content2, t);
    if (ok) content2 = newC;
  }

  await fsMod.promises.writeFile(used, content2, "utf8");
  const remaining = providers.filter((p) => !unique.includes(p.name)).map((p) => p.name);
  await say(`✓ 已移除: ${unique.join(", ")}（${norm(used)}）`);
  await say(`  剩余供应商: ${remaining.join(", ") || "无"}`);
  await say(`  重开会话后生效`);
}

await main();