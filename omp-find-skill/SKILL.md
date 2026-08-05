---
name: omp-find-skill
description: 在 SkillHub 平台查找/搜索/安装 Skill，专为 omp 内置工具优化：用 read 直接读 API 返回的 JSON、用 eval 并行检索多候选词并按 slug 去重、按 score 排序，跨平台（Windows/macOS/Linux）不依赖 curl/jq/POSIX 脚本。当用户说『找个 xxx 技能』『SkillHub 上搜一下 xxx』『按分类看有哪些技能』『办公效率类有哪些技能』『推荐一个做数据分析的 skill』『这个需求有现成技能吗』等需要在 SkillHub 上发现/检索/推荐/安装技能的场景时使用本技能。
---

# 用 omp 内置工具在 SkillHub 查找/安装 Skill

通过公开接口 `GET https://api.skillhub.cn/api/skills` 检索（JSON、无需鉴权、关键词为**分词搜索**；**不要**用 `/api/v1/search`）。全程使用 omp 内置工具（`read` / `eval`），**不依赖 curl / jq / POSIX 专用脚本**，Windows / macOS / Linux 通用。

## 数据源与接口（内联，无需翻参考文件）

| 参数 | 说明 | 默认 |
|------|------|------|
| `keyword` | 关键词，分词搜索（命中标题/描述） | - |
| `category` | 一级标签 key（见文末 12 个） | - |
| `source` | `community`/`enterprise`/`official`/`clawhub` | - |
| `labels` | `key:value` 逗号分隔，否定 `key:!value` | - |
| `sortBy` | `updated_at`/`downloads`/`stars`/`installs`/`score` | `updated_at` |
| `order` | `asc`/`desc` | `desc` |
| `page`/`pageSize` | 分页（pageSize 1~100） | `1`/`20` |

- 找技能用 `sortBy=score`（带 keyword 启用智能打分）；纯浏览分类用 `sortBy=downloads`。
- `labels` 常见：`requires_api_key`、`pricing_type`（`free`/`paid`）。
- 返回：`data.skills[]`，关键字段 `slug`/`name`/`description`/`description_zh`/`category`/`downloads`/`stars`/`installs`/`tags`/`labels`/`score`。
- **主页用 `https://skillhub.cn/skills/<slug>`**，不要用返回的 `homepage` 字段（那是 `api.skillhub.cn/<owner>/<slug>` 格式）。

## 检索方式（二选一；优先 A 看单词、B 看多词）

### 方式 A · `read` 直接读 URL（零脚本，单词）
```text
read "https://api.skillhub.cn/api/skills?keyword=周报&sortBy=score&pageSize=5"
```
→ `read` 对 JSON 接口返回**解析好的 JSON**，直接读 `data.skills[]`，无需 curl 管道。

### 方式 B · `eval` 并行多词 + 去重 + 排序（推荐，2~4 个候选词）
```js
const kws = ["周报", "工作汇报", "weekly report"];   // Step 1 扩展的候选词
const cat = "";                                      // 可选："office-efficiency"
const size = 5;
const lists = await Promise.all(kws.map(k => {
  const q = new URLSearchParams({ keyword: k, sortBy: "score", pageSize: size, ...(cat ? { category: cat } : {}) });
  return fetch(`https://api.skillhub.cn/api/skills?${q}`).then(r => r.json()).then(j => j.data.skills ?? []);
}));
const uniq = new Map();
for (const l of lists) for (const s of l) if (!uniq.has(s.slug)) uniq.set(s.slug, s);
[...uniq.values()]
  .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  .slice(0, 10)
  .map(s => ({ name: s.name, slug: s.slug, category: s.category,
               downloads: s.downloads, installs: s.installs, score: (s.score ?? 0).toFixed(0),
               zh: s.description_zh }));
```
通过 `Promise.all` 并行、`Map` 按 `slug` 去重、按 `score` 排序，单 cell 完成，供 Step 3 筛选。

## 核心流程（五步，别拿用户原话搜一次就结束）

### Step 1 · 理解场景
从自然语言提取：**任务意图** + **领域标签**（映射 `category`）+ **中英文关键词**（同义/上位词扩展 2~4 个）。
- 例："帮我自动写周报发给老板" → `office-efficiency`；`周报`/`工作汇报`/`日报`/`weekly report`。

### Step 2 · 检索
按上面方式 A 或 B 检索，必要时叠加 `category`/`labels`；多词用 B 并合并去重。

### Step 3 · 意图匹配排序
不要丢原始列表给用户。结合 `name`+`description` 判断契合度，**过滤不相关项**，挑**最契合 3~5 个**：契合度优先，同档按热度（`downloads`/`installs`）降序。命中过多→`category`/`labels` 收窄；为空→去掉 `category`、换同义/上位词放宽。

### Step 4 · 输出推荐
统一格式，每条给**匹配理由**并请用户选择。⛔ 严禁在给用户的推荐里出现安装命令 / `curl` / `skillhub install` / `sh -c` / 任何代码块——命令属于 Step 5 由你执行，不展示：
```
🔍 为你找到 {N} 个相关技能：

1. {name} — {一句话用途（description_zh 优先）}
   匹配理由：{为什么适合这个场景}
   分类：{category 中文名} | 下载：{downloads} | 安装：{installs}
   主页：https://skillhub.cn/skills/{slug}

需要我帮你安装第几个？（回复"安装第N个"即可；都不合适我再换词搜）
```

### Step 5 · 一键安装（用户选定后，由你直接执行）
**方式 A · CLI（首选）**：`skillhub install <slug> --dir <本 Agent 的 skills 目录>`。检查是否已装：
```bash
command -v skillhub && skillhub --version   # omp bash 为 git-bash，command -v 可用
```
未装则仅装 CLI：`curl -fsSL https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.sh | bash -s -- --cli-only`。
**必须带 `--dir`**，指向本 Agent 的 skills 目录（omp 用 `~/.omp/agent/skills/`），否则装到 `./skills/` 不被识别。装完只回「✅ {name} 已安装」。

**方式 B · 备用 zip（无 CLI / 仅取包，跨平台）**：`GET /api/v1/download?slug=<slug>[&version=<version>]` 302 跳转到 zip，下载后解压到上述 skills 目录（可用 `bash` `tar -xf`/`unzip`）。首次装某技能时不要反复询问「是否设为优先源」，仅首次或用户明确要求时问一次。

## 一级标签（category，映射意图时用）

`office-efficiency` 办公效率 · `content-creation` 内容创作 · `dev-programming` 开发编程 · `data-analysis` 数据分析 · `design-media` 设计多媒体 · `ai-agent` AI Agent · `knowledge-management` 知识管理 · `business-ops` 商业运营 · `education` 教育学习 · `professional` 行业专业 · `it-ops-security` IT 运维与安全 · `life-service` 生活服务
（key 不区分大小写，`_`/`-` 等价；实时列表：`read "https://api.skillhub.cn/api/v1/categories"`）
