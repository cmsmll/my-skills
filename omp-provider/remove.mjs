#!/usr/bin/env node
// omp-provider remove —— 移除供应商（从 models.yml 删除指定 provider）
// 用法:
//   node remove.mjs --name <供应商名>                     # 移除指定供应商
//   node remove.mjs --interactive                        # 交互模式（编号/名称选择，多选）
//   node remove.mjs --list                               # 列出可移除的供应商名
//   node remove.mjs --name <供应商名> -f <models.yml>     # 指定配置文件
// 全程不打印明文 key。

const OVERRIDE = { name: "", list: false, interactive: false, file: "" };

const fsMod = globalThis.fs ?? (await import("node:fs"));
const readline = typeof Bun !== "undefined" ? null : await import("node:readline").catch(() => null);

const readFileText = async (p) => {
  if (typeof read === "function") {
    try { return await read(p); } catch { /* fallthrough */ }
  }
  return await fsMod.promises.readFile(p, "utf8");
};

const say = (s = "") => (typeof print === "function" ? print(String(s)) : console.log(String(s)));

// —— 交互式 stdin 输入（TTY 走 readline；管道输入一次性读全量、按行缓存） ——
let pipedLines = null;
let pipedInit = null;
const initPiped = () => {
  if (pipedInit) return pipedInit;
  pipedInit = new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { buf += c; });
    process.stdin.on("end", () => { pipedLines = buf.split(/\r?\n/); resolve(); });
    process.stdin.resume();
  });
  return pipedInit;
};
const ask = (q) => new Promise(async (resolve) => {
  if (typeof Bun !== "undefined" && Bun.stdin) {
    process.stdout.write(q);
    Bun.stdin.stream().getReader().read().then(({ value }) => resolve(new TextDecoder().decode(value).trim()));
  } else if (readline && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (ans) => { rl.close(); resolve(ans.trim()); });
  } else {
    if (!pipedLines) await initPiped();
    const line = pipedLines.shift() ?? "";
    resolve(line.trim());
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
  // 计算 end：每个供应商从 start 到下一供应商 start（或文件尾）
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
  // 删除 start..end 行（含空行边界清理）
  const newLines = lines.filter((_, i) => i < target.start || i > target.end);
  // 清理连续空行（保留一个）
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
      case "--interactive": opts.interactive = true; break;
      case "-f": case "--file": opts.file = next() ?? ""; break;
      case "-h": case "--help":
        await say("用法: node remove.mjs --name <供应商名> [-f models.yml] | --interactive | --list");
        break;
      default: opts.name = a;
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

  // --list 模式
  if (opts.list) {
    await say(`▸ 配置文件: ${norm(used)}`);
    await say("可移除的供应商：");
    for (const p of providers) await say(`  - ${p.name}`);
    return;
  }

  // 交互模式：编号/名称选择（多选）
  let targets = [];
  if (opts.interactive) {
    await say(`▸ 配置文件: ${norm(used)}`);
    await say("可移除的供应商：");
    for (let i = 0; i < providers.length; i++) {
      await say(`  [${i + 1}] ${providers[i].name}`);
    }
    const ans = await ask("\n输入编号（逗号分隔）或供应商名: ");
    for (const p of ans.split(",").map((s) => s.trim()).filter(Boolean)) {
      const n = Number(p);
      if (!isNaN(n) && n >= 1 && n <= providers.length) {
        targets.push(providers[n - 1].name);
      } else if (providers.some((x) => x.name === p)) {
        targets.push(p);
      } else {
        await say(`⚠ 未识别 "${p}"，跳过`);
      }
    }
    targets = [...new Set(targets)]; // 去重
    if (!targets.length) {
      await say("✗ 未选择任何供应商，取消");
      return;
    }
    await say(`\n将移除 ${targets.length} 个供应商：${targets.join(", ")}`);
    const confirm = await ask("确认？y/N: ");
    if (confirm.toLowerCase() !== "y") {
      await say("✗ 已取消");
      return;
    }
  } else if (opts.name) {
    targets = [opts.name];
  } else {
    await say("✗ 需要 --name <供应商名>、--interactive（交互选择）或 --list（查看列表）");
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }

  // 执行移除
  let content2 = content;
  const found = [];
  const missing = [];
  for (const t of targets) {
    const { ok, content: newContent } = removeProvider(content2, t);
    if (!ok) { missing.push(t); continue; }
    content2 = newContent;
    found.push(t);
  }

  if (!found.length) {
    await say(`✗ 未找到供应商：${missing.join(", ")}。可用：${providers.map((p) => p.name).join(", ")}`);
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }
  if (missing.length) {
    await say(`⚠ 未找到并跳过：${missing.join(", ")}`);
  }

  await fsMod.promises.writeFile(used, content2, "utf8");
  await say(`✓ 已移除供应商: ${found.join(", ")}（${norm(used)}）`);
  const remaining = providers.filter((p) => !found.includes(p.name)).map((p) => p.name);
  await say(`  剩余供应商: ${remaining.join(", ") || "无"}`);
  await say(`  重开会话后生效`);
}

await main();