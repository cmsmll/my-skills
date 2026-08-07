---
name: omp-find-skill
description: 在 SkillHub 平台查找/搜索/安装 Skill，专为 omp 内置工具优化：独立 search.mjs 检索（多关键词并行→按 slug 去重→按 score 排序），用 ask 多选+确认安装。当用户说『找个 xxx 技能』『SkillHub 上搜一下 xxx』『按分类看有哪些技能』『办公效率类有哪些技能』『推荐一个做数据分析的 skill』『这个需求有现成技能吗』『安装技能』等需要在 SkillHub 上发现/检索/推荐/安装技能的场景时使用本技能。
---

# omp-find-skill — SkillHub 查找/安装

通过公开接口 `GET https://api.skillhub.cn/api/skills` 检索（JSON、无需鉴权、关键词为**分词搜索**；**不要**用 `/api/v1/search`）。使用技能同目录的独立 `search.mjs` 检索，交互统一用 ask 多选 + 确认安装。不依赖 curl / jq / POSIX 专用脚本，Windows / macOS / Linux 通用。

## 加载器（通用）

```js
let code = await read("skill://omp-find-skill/search.mjs");
code = code.replace("const OVERRIDE = { kws: [], cat: \"\", labels: \"\", sortBy: \"score\", size: 5, limit: 10 };",
  "const OVERRIDE = " + JSON.stringify(OVER) + ";");
await new Function("return (async () => {\n" + code.replace(/^#![^\n]*\n/, "") + "\n})()")();
```

脚本路径：注册后 `skill://omp-find-skill/search.mjs`。参数在 `OVER` 里改。

## search.mjs — 检索技能

**参数**（`OVER`）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `kws` | `[]` | 关键词（数组或逗号分隔字符串），分词搜索，**多词并行** |
| `cat` | `""` | 一级标签 key（见文末 12 个） |
| `labels` | `""` | `key:value` 逗号分隔，否定 `key:!value` |
| `sortBy` | `"score"` | `updated_at`/`downloads`/`stars`/`installs`/`score` |
| `size` | `5` | 每关键词取前 N 条 |
| `limit` | `10` | 去重排序后取前 N 条 |

- 找技能用 `sortBy=score`（带 keyword 智能打分）；纯浏览分类用 `sortBy=downloads`。
- 输出：每项带编号 + name + slug + category + downloads + score + 中文描述，末尾 `__JSON__` 附结构化结果（agent 据此构造 ask 选项）。

**示例**：

```js
let code = await read("skill://omp-find-skill/search.mjs");
const OVER = { kws: ["周报", "工作汇报"], cat: "office-efficiency", labels: "", sortBy: "score", size: 5, limit: 8 };
code = code.replace("const OVERRIDE = { kws: [], cat: \"\", labels: \"\", sortBy: \"score\", size: 5, limit: 10 };",
  "const OVERRIDE = " + JSON.stringify(OVER) + ";");
await new Function("return (async () => {\n" + code.replace(/^#![^\n]*\n/, "") + "\n})()")();
```

## 流程（由 agent 按步骤执行）

### Step 1 · 理解场景
从自然语言提取：**任务意图** + **领域标签**（映射 `category`）+ **中英文关键词**（同义/上位词扩展 2~4 个）。
- 例："帮我自动写周报发给老板" → `office-efficiency`；`周报`/`工作汇报`/`日报`/`weekly report`。

### Step 2 · 检索
运行 `search.mjs`，`kws` 填扩展的词组，必要时叠加 `cat`/`labels`。输出即去重排序后的候选。

### Step 3 · 意图匹配排序
不要丢原始列表给用户。结合 `name`+`description` 判断契合度，**过滤不相关项**，留**最契合 3~5 个**：契合度优先，同档按热度（`downloads`/`installs`）降序。数量不足→去掉 `cat`、换同义/上位词放宽。

### Step 4 · ask 多选
用 `ask` 工具（`multi: true`）让用户**多选**要安装的技能，每个选项展示 `name`（附 slug/用途/热度）助分辨；随后用 `ask`（y/N）**确认**所选名单。

### Step 5 · 安装（用户确认后由你执行）

**目标目录（注册即生效）**：装到 `$USERPROFILE/.omp/agent/managed-skills/<slug>/`。构造路径**必须用 `$USERPROFILE`，不要用 `~`**——omp bash 里 `$HOME` 为空、`~` 解析不可靠。该目录正是 omp 的 **`omp-managed`** provider（优先级 5）扫描位置，装好后 **下次启动会话时自动注册**；装完必须说明「重开会话后生效」。

**Windows 一律走 zip（方式 A），跳过 CLI**：skillhub 的 `install.sh` 依赖 `$HOME` 定位安装目录，在 omp bash 里会把二进制写到不存在的位置，且每次 bash 都是新进程、PATH 不继承——CLI 在 Windows 上不可靠。仅当 `command -v skillhub` 已确认命中才用 CLI。

**方式 A · zip（首选，跨平台）**——全程在目标目录内完成；多选多个 slug 时逐个循环：
```bash
# 用户确认的 slug（一个或多个），逐行执行下载
slug=<slug>
DIR="$USERPROFILE/.omp/agent/managed-skills/$slug"
mkdir -p "$DIR" && cd "$DIR"
curl -fsSL -L -o skill.zip "https://api.skillhub.cn/api/v1/download?slug=$slug"
unzip -o skill.zip && rm skill.zip
```
装完逐个 `head -3 SKILL.md` 校验 frontmatter `name:` 与目录/slug 一致（不一致则改 `name:` 或目录名，否则注册不上）；确认后回「✅ {name} 已安装，重开会话后生效」。

**方式 B · CLI（仅 CLI 已可用时）**：`command -v skillhub` 命中才用，`--dir` 指向 managed-skills 父目录：
```bash
command -v skillhub >/dev/null && skillhub install <slug> --dir "$USERPROFILE/.omp/agent/managed-skills"
```
未装 CLI 时**不要主动安装 CLI**（Windows 上不可靠），直接走方式 A。

**安装注意**：某技能已装时提醒「已安装（重开会话后生效），是否覆盖」；首次装某技能不要反复询问「是否设为优先源」，仅首次或用户明确要求时问一次。

## 一级标签（category，映射意图时用）

`office-efficiency` 办公效率 · `content-creation` 内容创作 · `dev-programming` 开发编程 · `data-analysis` 数据分析 · `design-media` 设计多媒体 · `ai-agent` AI Agent · `knowledge-management` 知识管理 · `business-ops` 商业运营 · `education` 教育学习 · `professional` 行业专业 · `it-ops-security` IT 运维与安全 · `life-service` 生活服务
（key 不区分大小写，`_`/`-` 等价；实时列表：`read "https://api.skillhub.cn/api/v1/categories"`）

## 数据源与字段

- `data.skills[]`：`slug`/`name`/`description`/`description_zh`/`category`/`downloads`/`stars`/`installs`/`tags`/`labels`/`score`。
- **主页用 `https://skillhub.cn/skills/<slug>`**，不要用返回的 `homepage` 字段（那是 `api.skillhub.cn/<owner>/<slug>` 格式）。