#!/usr/bin/env node
// omp-provider register —— 注册供应商到 omp（探测可用性 → 选模型 → 写 models.yml）
// 用法:
//   node register.mjs --url <url> --key <key>              # 仅探测，列出模型编号
//   node register.mjs --url <url> --key <key> --all        # 探测并注册全部模型
//   node register.mjs --url <url> --key <key> --models "1,3,5"  # 按编号选模型
//   node register.mjs --url <url> --key <key> --name my-provider --all  # 指定供应商名
//   node register.mjs --interactive                        # 交互模式（stdin 输入）
// 全程不打印明文 key。

const OVERRIDE = { url: "", key: "", name: "", models: "", all: false, interactive: false, file: "", timeout: 8 };

const fsMod = globalThis.fs ?? (await import("node:fs"));
const pathMod = await import("node:path");
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
    // Bun: write prompt, read stdin
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

// —— 从 URL 生成供应商名 ——
function nameFromUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    // 取主域名第一部分
    const parts = host.split(".");
    if (parts.length >= 2) return parts[0];
    return host;
  } catch {
    return "provider";
  }
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

// —— 生成供应商 YAML 块 ——
function providerYaml(name, baseUrl, apiKey, modelIds) {
  const esc = (s) => {
    if (/[:\{\}\[\],&\*\?\|<>=!%@`#]/.test(s) || s.includes("'") || s.includes('"')) {
      return s.includes("'") ? `"${s}"` : `'${s}'`;
    }
    return s;
  };
  let out = `  ${name}:\n`;
  out += `    baseUrl: ${esc(baseUrl)}\n`;
  out += `    apiKey: ${esc(apiKey)}\n`;
  out += `    api: openai-completions\n`;
  out += `    models:\n`;
  for (const id of modelIds) {
    out += `      - id: ${esc(id)}\n`;
    out += `        name: ${esc(id)}\n`;
    out += `        cost:\n`;
    out += `          input: 0\n`;
    out += `          output: 0\n`;
    out += `          cacheRead: 0\n`;
    out += `          cacheWrite: 0\n`;
    out += `        contextWindow: 128000\n`;
    out += `        maxTokens: 16384\n`;
  }
  return out;
}

// —— 写 models.yml ——
async function writeModelsYaml(filePath, name, baseUrl, apiKey, modelIds) {
  const block = providerYaml(name, baseUrl, apiKey, modelIds);
  let content = "";
  try { content = await fsMod.promises.readFile(filePath, "utf8"); } catch { /* 文件不存在，创建新文件 */ }

  const providersRe = /^providers:\s*$/m;
  const match = content.match(providersRe);

  if (match) {
    // providers 块已存在，在末尾插入
    const idx = match.index + match[0].length;
    const after = content.slice(idx);
    // 查找 providers 块末尾（下一个顶层键或 EOF）
    const nextKey = after.search(/\n(?=[A-Za-z0-9_.-]+:)/);
    if (nextKey === -1) {
      // 无下一个顶层键，直接追加在末尾
      content = content.slice(0, idx) + "\n" + block + after;
    } else {
      // 在下一个顶层键前插入
      content = content.slice(0, idx) + "\n" + block + after.slice(nextKey);
    }
  } else {
    // 无 providers 块，追加在文件末尾
    if (content.length > 0 && !content.endsWith("\n")) content += "\n";
    content += "providers:\n" + block;
  }

  await fsMod.promises.writeFile(filePath, content, "utf8");
  return content;
}

// —— 解析固定 2 空格缩进 YAML，仅用于校验是否有同名供应商 ——
function parseProviderNames(content) {
  const names = [];
  for (const raw of (content || "").split(/\r?\n/)) {
    const m = raw.match(/^  ([A-Za-z0-9_.-]+):\s*$/);
    if (m) names.push(m[1]);
  }
  return names;
}

async function main() {
  const argv = (process.argv || []).slice(2).filter((a) => a && !a.startsWith("_") && !a.includes("omp_worker"));
  const opts = { ...OVERRIDE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const next = () => argv[++i];
    switch (a) {
      case "--url": opts.url = next() ?? ""; break;
      case "--key": opts.key = next() ?? ""; break;
      case "--name": opts.name = next() ?? ""; break;
      case "--models": opts.models = next() ?? ""; break;
      case "--all": opts.all = true; break;
      case "--interactive": opts.interactive = true; break;
      case "-f": case "--file": opts.file = next() ?? ""; break;
      case "-t": case "--timeout": { const n = Number(next()); if (n > 0) opts.timeout = n; break; }
      case "-h": case "--help":
        await say("用法: node register.mjs --url <url> --key <key> [--name <name>] [--all|--models <idx>] [-t 超时秒]");
        await say("       node register.mjs --interactive");
        break;
      default: opts.url = a;
    }
  }

  // 交互模式
  if (opts.interactive) {
    opts.url = await ask("URL: ");
    opts.key = await ask("API Key: ");
    opts.name = await ask("供应商名（留空自动生成）: ");
  }

  if (!opts.url) {
    await say("✗ 需要 --url（或 --interactive 交互输入）");
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }
  if (!opts.key) {
    await say("✗ 需要 --key（或 --interactive 交互输入）");
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }

  const name = opts.name || nameFromUrl(opts.url);
  await say(`▸ 探测 ${name} (${opts.url}) ...`);
  const probe = await probeModels(opts.url, opts.key, opts.timeout * 1000);

  if (!probe.ok) {
    await say(`✗ 供应商不可用: ${probe.label}（${probe.ids.length} 个模型被列出但 HTTP 非 200，不会注册）`);
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }

  if (!probe.ids.length) {
    await say("✗ 服务器返回了 200 但模型列表为空，可能接口不兼容，不注册");
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }

  await say(`✓ 供应商可达，服务端共 ${probe.ids.length} 个模型:\n`);
  for (let i = 0; i < probe.ids.length; i++) {
    await say(`  [${i + 1}] ${probe.ids[i]}`);
  }

  // 确定选哪些模型
  let selected = [];
  if (opts.all) {
    selected = probe.ids;
  } else if (opts.models) {
    const parts = opts.models.split(",").map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      const n = Number(p);
      if (!isNaN(n) && n >= 1 && n <= probe.ids.length) {
        selected.push(probe.ids[n - 1]);
      } else if (probe.ids.includes(p)) {
        selected.push(p);
      }
    }
    if (!selected.length) {
      await say("✗ --models 未匹配到有效模型，不注册");
      if (typeof process !== "undefined") process.exitCode = 1;
      return;
    }
  } else if (opts.interactive || (!opts.all && !opts.models)) {
    // 探测模式：只输出不注册
    await say(`\n▸ 使用 --all 注册全部，或 --models "1,3,5" 按编号选择`);
    if (opts.interactive) {
      await say("  输入编号（逗号分隔）或 all：");
      const ans = await ask("> ");
      if (ans.toLowerCase() === "all") {
        selected = probe.ids;
      } else {
        for (const p of ans.split(",").map((s) => s.trim()).filter(Boolean)) {
          const n = Number(p);
          if (!isNaN(n) && n >= 1 && n <= probe.ids.length) selected.push(probe.ids[n - 1]);
        }
      }
    }
    if (!selected.length) {
      return; // 纯探测模式，不注册
    }
  }

  if (!selected.length) {
    return; // 无选择，不注册
  }

  // 写入 models.yml
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const cfg = opts.file || pathMod.join(home, ".omp", "agent", "models.yml");
  const norm = (p) => String(p).replace(/\\/g, "/");

  // 检查同名供应商
  let existing = "";
  try { existing = await readFileText(cfg); } catch {}
  const existingNames = parseProviderNames(existing);
  if (existingNames.includes(name)) {
    await say(`⚠ 供应商 "${name}" 已存在配置中，覆盖？`);
    if (opts.interactive) {
      const ans = await ask("y/N: ");
      if (ans.toLowerCase() !== "y") {
        await say("✗ 已取消注册");
        if (typeof process !== "undefined") process.exitCode = 1;
        return;
      }
    } else {
      await say("✗ 已取消注册（用 --name 指定不同的供应商名）");
      if (typeof process !== "undefined") process.exitCode = 1;
      return;
    }
  }

  await writeModelsYaml(cfg, name, opts.url, opts.key, selected);
  await say(`\n✓ ${name} 已注册到 ${norm(cfg)}`);
  await say(`  注册模型: ${selected.join(", ")}`);
  await say(`  重开会话后生效`);
}

await main();