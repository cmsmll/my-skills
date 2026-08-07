#!/usr/bin/env node
// visual-augment config —— 列出本地视觉模型候选 & 持久化选型配置
// 用法:
//   node config.mjs --list                       # 读 models.yml 列出所有候选模型（含厂商/计费）
//   node config.mjs --set "provider:model"       # 持久化单个（逗号分隔可多选）
//   node config.mjs --remove                     # 清空已存配置
// 输出: 每项带编号 + 模型名 + 厂商 + 计费标记，末尾 __JSON__ 结构化结果供 ask 构造选项。
// 配置落盘到 skill 目录 config.json（默认 managed-skills/visual-augment，--config 可指定）。
// 只读/写配置，不发起任何模型调用——未配置前禁止调用视觉模型。

const OVERRIDE = { file: "", config: "", list: false, set: "", remove: false };

const fsMod = globalThis.fs ?? (await import("node:fs"));
const pathMod = await import("node:path");

const readFileText = async (p) => {
  if (typeof read === "function") {
    try { return await read(p); } catch { /* fallthrough */ }
  }
  return await fsMod.promises.readFile(p, "utf8");
};

const say = (s = "") => (typeof print === "function" ? print(String(s)) : console.log(String(s)));

// —— 解析固定 2 空格缩进 YAML：providers -> {name: {baseUrl, apiKey, api, models:[{id,name,input,output}]}} ——
function parseWorkspace(content) {
  const prov = new Map();
  let cur = null, curModel = null;
  for (const line of (content || "").split(/\r?\n/)) {
    const indent = (line.match(/^ */) || [""])[0].length;
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const prv = t.match(/^([A-Za-z0-9_.-]+):\s*$/);
    const kv = t.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    const listItem = t.match(/^-\s*id:\s*(.+)$/);
    if (indent <= 2 && prv) {
      cur = { name: prv[1], baseUrl: "", apiKey: "", api: "", models: [] };
      prov.set(prv[1], cur);
      curModel = null;
    } else if (cur && indent === 4 && kv) {
      if (kv[1] === "baseUrl") cur.baseUrl = kv[2];
      else if (kv[1] === "apiKey") cur.apiKey = kv[2];
      else if (kv[1] === "api") cur.api = kv[2];
    } else if (cur && indent === 6 && listItem) {
      curModel = { id: listItem[1].trim(), name: listItem[1].trim(), input: 0, output: 0 };
      cur.models.push(curModel);
    } else if (curModel && indent === 8 && kv && /^name$/.test(kv[1])) {
      curModel.name = kv[2].replace(/^['"]|['"]$/g, "");
    } else if (curModel && indent === 8 && kv && /^(input|output)$/.test(kv[1])) {
      curModel[kv[1]] = parseFloat(kv[2]) || 0;
    }
  }
  return prov;
}

// —— 模型名是否像视觉/多模态 ——
function isVision(m) {
  return /vision|vlm|multimodal|multimod|image|visual|qwen-vl|glm-4v|minicpm|internvl|step-1v|gemini|gpt-4o|gpt-4\.1|gpt-5|claude|dall-e|sora/i
    .test((m.id + " " + (m.name || "")).toLowerCase());
}

async function main() {
  const argv = (process.argv || []).slice(2).filter((a) => a && !a.startsWith("_") && !a.includes("omp_worker"));
  const opts = { ...OVERRIDE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const next = () => argv[++i];
    switch (a) {
      case "--list": opts.list = true; break;
      case "--set": case "--name": opts.set = next() ?? ""; break;
      case "--config": opts.config = next() ?? ""; break;
      case "-f": case "--file": opts.file = next() ?? ""; break;
      case "--remove": opts.remove = true; break;
      case "-h": case "--help":
        await say("用法: node config.mjs [--list] [--set \"provider:model\"[,更多]] [--config <config.json>] [-f <models.yml>] [--remove]");
        break;
    }
  }

  const home = process.env.USERPROFILE || process.env.HOME || "";
  const cfgYml = opts.file || pathMod.join(home, ".omp", "agent", "models.yml");
  const configJson = opts.config || pathMod.join(home, ".omp", "agent", "managed-skills", "visual-augment", "config.json");
  const norm = (p) => String(p).replace(/\\/g, "/");

  // 载入 models.yml
  let content = "";
  try { content = await readFileText(cfgYml); } catch { /* 缺省空 */ }
  const prov = parseWorkspace(content);

  // 组装候选列表（全部模型 + 视觉标记 + 计费）
  const candidates = [];
  for (const [pname, p] of prov) {
    for (const m of p.models) {
      candidates.push({
        provider: pname, model: m.id, name: m.name || m.id,
        baseUrl: p.baseUrl, api: p.api,
        input: m.input || 0, output: m.output || 0,
        free: (m.input || 0) === 0 && (m.output || 0) === 0,
        vision: isVision(m),
      });
    }
  }
  if (!candidates.length) {
    await say("✗ 未在 models.yml 中找到任何可用模型（文件为空或格式不符），无法选型");
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }

  // 展示
  await say(`▸ 候选模型（${candidates.length} 个，来自 ${prov.size} 个供应商）:\n`);
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const tag = c.vision ? "★视觉" : "—";
    const price = c.free ? "免费" : `计费(${c.input}/${c.output})`;
    await say(`  [${i + 1}] ${c.provider} :: ${c.model}  ${tag}  ${price}`);
    if (c.baseUrl) await say(`      base: ${c.baseUrl}`);
  }
  await say("\n__JSON__ " + JSON.stringify(candidates.map((c, i) => ({
    idx: i + 1, provider: c.provider, model: c.model, name: c.name,
    baseUrl: c.baseUrl, free: c.free, vision: c.vision,
  }))));

  // 持久化：--set "provider:model,provider:model"
  if (opts.set) {
    const parts = opts.set.split(",").map((s) => s.trim()).filter(Boolean);
    const picked = [];
    for (const p of parts) {
      const fm = p.split(":");
      if (fm.length === 2 && fm[0] && fm[1]) picked.push({ provider: fm[0], model: fm[1] });
    }
    if (!picked.length) {
      await say("✗ --set 格式需为 \"provider:model\"（逗号分隔多选）");
      if (typeof process !== "undefined") process.exitCode = 1;
      return;
    }
    let exist = "";
    try { exist = await readFileText(configJson); } catch { /* 首次 */ }
    let saved = [];
    try { saved = JSON.parse(exist || "[]"); } catch { saved = []; }
    if (!Array.isArray(saved)) saved = [];
    for (const np of picked) {
      saved = saved.filter((x) => !(x.provider === np.provider && x.model === np.model));
      saved.push(np);
    }
    await fsMod.promises.mkdir(pathMod.dirname(configJson), { recursive: true });
    await fsMod.promises.writeFile(configJson, JSON.stringify(saved, null, 2), "utf8");
    await say(`✓ 视觉模型配置已持久化到 ${norm(configJson)}`);
    await say(`  当前选型: ${saved.map((s) => s.provider + ":" + s.model).join(", ")}`);
  }

  // 清空配置
  if (opts.remove) {
    await fsMod.promises.mkdir(pathMod.dirname(configJson), { recursive: true });
    await fsMod.promises.writeFile(configJson, "[]", "utf8");
    await say(`✓ 已清空视觉模型配置 ${norm(configJson)}`);
  }
}

await main();