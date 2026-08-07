---
name: omp-provider
description: 供应商管理命令集：查看供应商状态、注册新供应商、查看供应商模型。当用户说『供应商状态』『查看供应商』『注册供应商』『添加供应商』『添加模型』『注册模型』『查看模型』『供应商列表』『移除供应商』『删除供应商』『provider status』『register provider』『remove provider』等需要管理 omp 模型供应商时使用本技能。交互统一用 ask 多选+确认：status（探测配置供应商可用性）、register（URL+key 探测→ask 多选模型→确认→写 models.yml+env）、list（查看配置供应商模型列表）、remove（list→ask 多选供应商→确认→移除+清理 env）。
---

# omp-provider — 供应商管理

供应商管理命令集，每个命令为独立 `mjs` 文件（本技能同目录）。运行方式：omp eval 加载器。

## 加载器（通用）

```js
// 命令通用加载器，<脚本路径> 换成实际位置
let code = await read("<脚本路径>");
// 改参数（各命令 OVERRIDE 见下）
code = code.replace("const OVERRIDE = { file: \"\", timeout: 8, verbose: false };",
  "const OVERRIDE = " + JSON.stringify(OVER) + ";");
await new Function("return (async () => {\n" + code.replace(/^#![^\n]*\n/, "") + "\n})()")();
```

- **脚本路径**：注册后 `skill://omp-provider/status.mjs` / `register.mjs` / `list.mjs`。
- **参数**：在 `OVER` 里改。各命令参数不同，见下。

## 1. status — 查看供应商状态

探测配置的每个供应商，输出可用性汇总表，与 `omp-provider-health` 相同语义。

**参数**（`OVER`）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `file` | `""` | 配置文件路径，默认 `$USERPROFILE/.omp/agent/models.yml` |
| `timeout` | `8` | 探测超时秒 |
| `verbose` | `false` | 详情模式（打印服务端模型列表） |

**示例**：

```js
// 基础探测
let code = await read("skill://omp-provider/status.mjs");
const OVER = { file: "", timeout: 8, verbose: false };
code = code.replace("const OVERRIDE = { file: \"\", timeout: 8, verbose: false };",
  "const OVERRIDE = " + JSON.stringify(OVER) + ";");
await new Function("return (async () => {\n" + code.replace(/^#![^\n]*\n/, "") + "\n})()")();
```

## 2. register — 注册供应商

用户提供 URL 和 API Key，探测供应商可用性，列出模型供选择，写入 `models.yml`。

**流程**（由 agent 按步骤执行，全程用 `ask` 工具交互）：

1. 用 `ask` 收集 URL、API Key（以及可选供应商名）
2. 运行探测模式 → 列出服务器模型（编号仅用于查看数量/规模）
3. 用 `ask` 让用户**多选**要注册的模型（`multi: true`，每个选项展示模型 id）
4. 用 `ask` 让用户**确认**所选模型列表（y/N）
5. 运行注册模式，`models` 填选中的模型 id → 写入 `models.yml`

**参数**（`OVER`）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `url` | `""` | 供应商 baseUrl（如 `https://example.com/v1`） |
| `key` | `""` | API Key |
| `name` | `""` | 供应商名，留空自动从 URL 生成 |
| `models` | `""` | 逗号分隔的模型 id（如 `"gpt-4,gpt-3.5"`）|
| `all` | `false` | 注册全部模型 |
| `file` | `""` | models.yml 路径，默认 `$USERPROFILE/.omp/agent/models.yml` |
| `env` | `""` | .env 路径，默认 `$USERPROFILE/.omp/agent/.env` |
| `timeout` | `8` | 探测超时秒 |

**key 存储**：注册时 API Key 写入 `.env`（默认 `~/.omp/agent/.env`，omp 启动自动加载），`models.yml` 只存 env 变量名（供应商名大写 + `_API_KEY`），不落明文。可用 `--env` 指定其它 .env 文件。

**探测模式**（仅列出模型，不写入）：

```js
let code = await read("skill://omp-provider/register.mjs");
const OVER = { url: "https://example.com/v1", key: "sk-xxx", name: "", models: "", all: false, interactive: false, file: "", env: "", timeout: 8 };
code = code.replace("const OVERRIDE = { url: \"\", key: \"\", name: \"\", models: \"\", all: false, interactive: false, file: \"\", env: \"\", timeout: 8 };",
  "const OVERRIDE = " + JSON.stringify(OVER) + ";");
await new Function("return (async () => {\n" + code.replace(/^#![^\n]*\n/, "") + "\n})()")();
```

**注册模式**（探测 + 写入，需指定模型）：

```js
let code = await read("skill://omp-provider/register.mjs");
const OVER = { url: "https://example.com/v1", key: "sk-xxx", name: "my-provider", models: "gpt-4,gpt-3.5", all: false, interactive: false, file: "", env: "", timeout: 8 };
code = code.replace("const OVERRIDE = { url: \"\", key: \"\", name: \"\", models: \"\", all: false, interactive: false, file: \"\", env: \"\", timeout: 8 };",
  "const OVERRIDE = " + JSON.stringify(OVER) + ";");
await new Function("return (async () => {\n" + code.replace(/^#![^\n]*\n/, "") + "\n})()")();
```

- `models` 填**模型 id**（逗号分隔，如 `"gpt-4,gpt-3.5"`）；探测列表里的编号只是展示序号（用于查看数量/规模），选择一律用 `ask` 多选 id，不填编号。
- 用 `ask`（`multi: true`）收集用户多选，再用 `ask`（y/N）确认后落入 `models` 参数。
- `all: true` 注册全部模型。
- 供应商不可用（HTTP 非 200）不注册。
- 同名供应商已存在时用 `ask`（y/N）确认覆盖。
- **key 不落明文**：写入 `~/.omp/agent/.env`，models.yml 的 `apiKey` 是生成的 env 变量名。

## 3. list — 查看供应商模型

列出配置中所有供应商及其模型，不含探测。

**参数**（`OVER`）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `file` | `""` | 配置文件路径，默认 `$USERPROFILE/.omp/agent/models.yml` |

**示例**：

```js
let code = await read("skill://omp-provider/list.mjs");
const OVER = { file: "" };
code = code.replace("const OVERRIDE = { file: \"\" };",
  "const OVERRIDE = " + JSON.stringify(OVER) + ";");
await new Function("return (async () => {\n" + code.replace(/^#![^\n]*\n/, "") + "\n})()")();
```

## 4. remove — 移除供应商

**agent 流程**（全程用 `ask` 工具交互，脚本不做 readline）：

1. 运行 `--list` → 自动读取配置，列出供应商（编号仅用于查看数量；含 baseUrl、模型数、key 来源）
2. 用 `ask` 让用户**多选**要移除的供应商（`multi: true`，每个选项展示供应商名 + baseUrl + 模型数）
3. 用 `ask` 让用户**确认**所选供应商列表（y/N）
4. 运行 `--name "a,b"` → 一次移除多个供应商（填选中的供应商名）

**参数**（`OVER`）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `name` | `""` | 要移除的供应商名，**逗号分隔多选**（如 `"coderxiaoc,codex2api"`） |
| `list` | `false` | 列出供应商（自动读配置，不删除） |
| `file` | `""` | models.yml 路径，默认 `$USERPROFILE/.omp/agent/models.yml` |
| `env` | `""` | .env 路径，默认 `$USERPROFILE/.omp/agent/.env` |

**env 清理**：移除供应商时，若其 `models.yml` 的 `apiKey` 是 env 变量名，会同步从 `.env` 删除对应变量行。

**示例**：

```js
// 列出供应商（自动读配置）
let code = await read("skill://omp-provider/remove.mjs");
const OVER = { name: "", list: true, file: "", env: "" };
code = code.replace("const OVERRIDE = { name: \"\", list: false, file: \"\", env: \"\" };",
  "const OVERRIDE = " + JSON.stringify(OVER) + ";");
await new Function("return (async () => {\n" + code.replace(/^#![^\n]*\n/, "") + "\n})()")();
```

```js
// 移除指定供应商（多选：名称逗号分隔）
let code = await read("skill://omp-provider/remove.mjs");
const OVER = { name: "coderxiaoc,codex2api", list: false, file: "", env: "" };
code = code.replace("const OVERRIDE = { name: \"\", list: false, file: \"\", env: \"\" };",
  "const OVERRIDE = " + JSON.stringify(OVER) + ";");
await new Function("return (async () => {\n" + code.replace(/^#![^\n]*\n/, "") + "\n})()")();
```

- `--list` 自动读取配置文件并列出供应商（编号仅用于查看数量；含 baseUrl、模型数、key 来源）。
- 用 `ask`（`multi: true`）收集用户多选，再用 `ask`（y/N）确认后落入 `name` 参数（逗号分隔供应商名）。
- `name` 填**供应商名**（逗号分隔），不填编号。
- 移除时同步清理 `.env` 中的对应 key 变量。
- 移除后重开会话生效。

## 5. 常见坑

- **路径解析**：Windows 上 `bash` 的 `/tmp` 与 `node` 的 `/tmp` 可能映射到不同盘符。传给 `-f` 时用绝对路径（如 `C:/Users/...`）或系统环境变量展开后的路径。
- **`models.yml` vs `models.yaml`**：脚本优先 `.yml`，缺省回退 `.yaml`。
- **供应商名大小写敏感**：`Coderxiaoc` ≠ `coderxiaoc`，`disabledProviders` 精确匹配。
- **写入后重开会话生效**：`register` 写完后需重启 omp 会话才可见。
- **`register` 只写入不原地生效**：脚本不触发 omp 重载。需要重开会话才能使用新的供应商。
- **`models` / `name` 参数逗号分隔**：填模型 id 或供应商名，逗号分隔、自动 trim。