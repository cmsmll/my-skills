#!/usr/bin/env node
// omp-find-skill search —— 在 SkillHub 检索技能（多关键词并行 → 按 slug 去重 → 按 score 排序）
// 用法:
//   node search.mjs --kws "周报,工作汇报" --cat office-efficiency --size 5 --limit 10
// 批量：OVERRIDE.kws = ["周报","weekly report"] 数组一次检索多个词
// 输出: 每项带编号 + name + slug + category + downloads + score + 中文描述，供 ask 多选。
// 全程只读，不安装；安装由 agent 用 ask 多选 + 确认后执行下载。

const OVERRIDE = { kws: [], cat: "", labels: "", sortBy: "score", size: 5, limit: 10 };

const say = (s = "") => (typeof print === "function" ? print(String(s)) : console.log(String(s)));

async function searchOne(keyword, cat, labels, sortBy, size) {
  const q = new URLSearchParams({ keyword, sortBy, pageSize: size });
  if (cat) q.set("category", cat);
  if (labels) q.set("labels", labels);
  const j = await fetch(`https://api.skillhub.cn/api/skills?${q}`).then((r) => r.json());
  return j?.data?.skills ?? [];
}

async function main() {
  // 关键词来源：OVERRIDE.kws（逗号分隔或数组）
  let kws = [];
  if (Array.isArray(OVERRIDE.kws)) kws = OVERRIDE.kws;
  else if (typeof OVERRIDE.kws === "string") kws = OVERRIDE.kws.split(",").map((s) => s.trim()).filter(Boolean);

  const argv = (process.argv || []).slice(2).filter((a) => a && !a.startsWith("_") && !a.includes("omp_worker"));
  const opts = { ...OVERRIDE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const next = () => argv[++i];
    switch (a) {
      case "--kws": kws = (next() ?? "").split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--cat": opts.cat = next() ?? ""; break;
      case "--labels": opts.labels = next() ?? ""; break;
      case "--sortBy": opts.sortBy = next() ?? ""; break;
      case "--size": { const n = Number(next()); if (n > 0) opts.size = n; break; }
      case "--limit": { const n = Number(next()); if (n > 0) opts.limit = n; break; }
      case "-h": case "--help":
        await say("用法: node search.mjs [--kws \"词1,词2\"] [--cat <key>] [--labels <k:v>] [--sortBy score] [--size N] [--limit N]");
        break;
    }
  }

  if (!kws.length) {
    await say("✗ 需要 --kws（关键词，逗号分隔）或 OVERRIDE.kws");
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }

  const q = `检索: ${kws.join(" | ")}${opts.cat ? "  [cat=" + opts.cat + "]" : ""}${opts.labels ? "  [labels=" + opts.labels + "]" : ""}`;
  await say(`▸ ${q}`);

  const lists = await Promise.all(kws.map((k) => searchOne(k, opts.cat, opts.labels, opts.sortBy, opts.size).catch(() => [])));
  const uniq = new Map();
  for (const l of lists) for (const s of l) if (s && s.slug && !uniq.has(s.slug)) uniq.set(s.slug, s);
  const sorted = [...uniq.values()]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, opts.limit);

  if (!sorted.length) {
    await say("✗ 未找到匹配技能（换同义词/上位词，或去掉 category 放宽）");
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }

  await say(`✓ 共 ${sorted.length} 条（${uniq.size} 去重后取前 ${opts.limit}）:\n`);
  let i = 0;
  for (const s of sorted) {
    i++;
    const zh = s.description_zh || s.description || "";
    await say(`  [${i}] ${s.name}  分:${(s.score ?? 0).toFixed(0)}  下载:${s.downloads ?? 0}  安装:${s.installs ?? 0}`);
    await say(`      slug: ${s.slug} | cat: ${s.category || "?"}`);
    if (zh) await say(`      ${zh.slice(0, 120)}`);
  }

  // 末尾输出结构化结果（供 agent 构造 ask 选项），以 __JSON__ 标记
  const out = sorted.map((s) => ({
    idx: 0, name: s.name, slug: s.slug, category: s.category || "",
    downloads: s.downloads ?? 0, installs: s.installs ?? 0, score: s.score ?? 0,
    zh: (s.description_zh || s.description || "").slice(0, 120),
  }));
  out.forEach((o, n) => (o.idx = n + 1));
  await say("\n__JSON__ " + JSON.stringify(out));
}

await main();