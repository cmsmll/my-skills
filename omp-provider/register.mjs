#!/usr/bin/env node
// omp-provider register —— 注册供应商到 omp（探测可用性 → 选模型 → 写 models.yml）
// 用法:
//   node register.mjs --url <url> --key <key>              # 仅探测，列出模型编号
//   node register.mjs --url <url> --key <key> --all        # 探测并注册全部模型
//   node register.mjs --url <url> --key <key> --models "1,3,5"  # 按编号选模型
//   node register.mjs --url <url> --key <key> --name my-provider --all  # 指定供应商名
//   node register.mjs --interactive                        # 交互模式（stdin 输入）
// 批量：OVERRIDE.providers = [{url,key,name?,models?,all?}, ...] 一次注册多个
// 全程不打印明文 key。

const OVERRIDE = { url: "", key: "", name: "", models: "", all: false, interactive: false, file: "", env: "", timeout: 8, providers: [] };

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

// —— 由供应商名生成 env 变量名（大写 + _API_KEY） ——
function envVarName(name) {
  const base = name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^[0-9]/, "_$&").toUpperCase();
  return `${base}_API_KEY`;
}

// —— 把 key 写入 .env：已有同名变量则替换，否则追加 ——
async function writeEnvKey(envPath, varName, key) {
  let content = "";
  try { content = await fsMod.promises.readFile(envPath, "utf8"); } catch { /* 文件不存在，创建 */ }
  const re = new RegExp(`^${varName}=.*$`, "m");
  const line = `${varName}=${key}`;
  if (re.test(content)) {
    content = content.replace(re, line);
  } else {
    if (content.length > 0 && !content.endsWith("\n")) content += "\n";
    content += line + "\n";
  }
  await fsMod.promises.writeFile(envPath, content, "utf8");
  return content;
}

// —— 单个供应商完整注册（探测→选模型→写 .env+models.yml） ——
async function registerOne(sp) {
  const name = sp.name || nameFromUrl(sp.url);
  await say(`\n▸ 探测 ${name} (${sp.url}) ...`);
  const probe = await probeModels(sp.url, sp.key, sp.timeout);

  if (!probe.ok) {
    await say(`✗ 供应商不可用: ${probe.label}（${probe.ids.length} 个模型被列出但 HTTP 非 200，不会注册）`);
    return false;
  }

  if (!probe.ids.length) {
    await say("✗ 服务器返回了 200 但模型列表为空，可能接口不兼容，不注册");
    return false;
  }

  await say(`✓ 供应商可达，服务端共 ${probe.ids.length} 个模型:\n`);
  for (let i = 0; i < probe.ids.length; i++) {
    await say(`  [${i + 1}] ${probe.ids[i]}`);
  }

  // 确定选哪些模型
  let selected = [];
  if (sp.all) {
    selected = probe.ids;
  } else if (sp.models) {
    const parts = sp.models.split(",").map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      const n = Number(p);
      if (!isNaN(n) && n >= 1 && n <= probe.ids.length) {
        selected.push(probe.ids[n - 1]);
      } else if (probe.ids.includes(p)) {
        selected.push(p);
      }
    }
    if (!selected.length) {
      await say("✗ models 未匹配到有效模型，不注册");
      return false;
    }
  } else if (sp.interactive) {
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
  } else {
    // 纯探测模式，只输出不注册
    await say(`\n▸ 使用 all 注册全部，或 models 按编号选择`);
    return null; // 探测完成
  }

  if (!selected.length) {
    await say("✗ 未选择任何模型，不注册");
    return false;
  }

  // 检查同名供应商
  let existing = "";
  try { existing = await readFileText(sp.cfg); } catch {}
  const existingNames = parseProviderNames(existing);
  if (existingNames.includes(name)) {
    await say(`⚠ 供应商 "${name}" 已存在配置中，覆盖？`);
    if (sp.interactive) {
      const ans = await ask("y/N: ");
      if (ans.toLowerCase() !== "y") {
        await say("✗ 已取消注册");
        return false;
      }
    } else {
      await say("✗ 已取消注册（用 name 指定不同的供应商名）");
      return false;
    }
  }

  const varName = envVarName(name);
  await writeEnvKey(sp.envPath, varName, sp.key);
  await say(`✓ API Key 已写入 ${sp.norm(sp.envPath)}（${varName}）`);

  await writeModelsYaml(sp.cfg, name, sp.url, varName, selected);
  await say(`\n✓ ${name} 已注册到 ${sp.norm(sp.cfg)}`);
  await say(`  apiKey 引用: ${varName}（omp 启动时从 .env 加载）`);
  await say(`  注册模型: ${selected.join(", ")}`);
  await say(`  重开会话后生效`);
  return true;
}

async function main() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const norm = (p) => String(p).replace(/\\/g, "/");
  const defaultCfg = pathMod.join(home, ".omp", "agent", "models.yml");
  const defaultEnv = pathMod.join(home, ".omp", "agent", ".env");

  // 批量模式：providers 数组一次注册多个
  if (Array.isArray(OVERRIDE.providers) && OVERRIDE.providers.length) {
    const ok = [];
    for (const p of OVERRIDE.providers) {
      const r = await registerOne({
        url: p.url, key: p.key, name: p.name || "", models: p.models || "",
        all: !!p.all, interactive: false, timeout: (p.timeout || OVERRIDE.timeout) * 1000,
        cfg: OVERRIDE.file || defaultCfg, envPath: OVERRIDE.env || defaultEnv, norm,
      });
      ok.push(r);
    }
    if (typeof process !== "undefined" && ok.includes(false)) process.exitCode = 1;
    return;
  }

  // 命令行/单例模式
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
      case "--env": opts.env = next() ?? ""; break;
      case "-t": case "--timeout": { const n = Number(next()); if (n > 0) opts.timeout = n; break; }
      case "-h": case "--help":
        await say("用法: node register.mjs --url <url> --key <key> [--name <name>] [--all|--models <idx>] [--env .env路径] [-t 超时秒]");
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
    await say("✗ 需要 --url（或 providers 批量、--interactive 交互输入）");
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }
  if (!opts.key) {
    await say("✗ 需要 --key（或 --interactive 交互输入）");
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }

  const r = await registerOne({
    url: opts.url, key: opts.key, name: opts.name || "", models: opts.models || "",
    all: !!opts.all, interactive: !!opts.interactive,
    timeout: opts.timeout * 1000,
    cfg: opts.file || defaultCfg, envPath: opts.env || defaultEnv, norm,
  });
  if (typeof process !== "undefined" && r === false) process.exitCode = 1;
}

await main();