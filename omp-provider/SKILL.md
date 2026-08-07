---
name: omp-provider
description: 供应商管理命令集：查看供应商状态、注册新供应商、查看供应商模型。当用户说『供应商状态』『查看供应商』『注册供应商』『添加供应商』『添加模型』『注册模型』『查看模型』『供应商列表』『provider status』『register provider』等需要管理 omp 模型供应商时使用本技能。覆盖：status（探测配置供应商可用性）、register（URL+key 探测→选模型→写 models.yml）、list（查看配置供应商模型列表）。
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

**流程**（由 agent 按步骤执行）：

1. 收集 URL 和 API Key（用 `ask` 工具或命令行参数）
2. 运行探测模式 → 列出服务器模型及编号
3. 让用户选择模型（`ask` 工具，多选）
4. 运行注册模式 → 写入 `models.yml`

**参数**（`OVER`）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `url` | `""` | 供应商 baseUrl（如 `https://example.com/v1`） |
| `key` | `""` | API Key |
| `name` | `""` | 供应商名，留空自动从 URL 生成 |
| `models` | `""` | 逗号分隔的模型编号或 id，如 `"1,3,5"` 或 `"gpt-4,gpt-3.5"` |
| `all` | `false` | 注册全部模型 |
| `file` | `""` | 配置文件路径，默认 `$USERPROFILE/.omp/agent/models.yml` |
| `timeout` | `8` | 探测超时秒 |

**探测模式**（仅列出模型，不写入）：

```js
let code = await read("skill://omp-provider/register.mjs");
const OVER = { url: "https://example.com/v1", key: "sk-xxx", name: "", models: "", all: false, interactive: false, file: "", timeout: 8 };
code = code.replace("const OVERRIDE = { url: \"\", key: \"\", name: \"\", models: \"\", all: false, interactive: false, file: \"\", timeout: 8 };",
  "const OVERRIDE = " + JSON.stringify(OVER) + ";");
await new Function("return (async () => {\n" + code.replace(/^#![^\n]*\n/, "") + "\n})()")();
```

**注册模式**（探测 + 写入，需指定模型）：

```js
let code = await read("skill://omp-provider/register.mjs");
const OVER = { url: "https://example.com/v1", key: "sk-xxx", name: "my-provider", models: "1,3,5", all: false, interactive: false, file: "", timeout: 8 };
code = code.replace("const OVERRIDE = { url: \"\", key: \"\", name: \"\", models: \"\", all: false, interactive: false, file: \"\", timeout: 8 };",
  "const OVERRIDE = " + JSON.stringify(OVER) + ";");
await new Function("return (async () => {\n" + code.replace(/^#![^\n]*\n/, "") + "\n})()")();
```

- `models` 支持编号（如 `"1,3,5"`）或模型 id（如 `"gpt-4,gpt-3.5"`）。
- `all: true` 注册全部模型。
- 供应商不可用（HTTP 非 200）不注册。
- 同名供应商已存在时提示覆盖确认。

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

从配置中删除指定供应商及其模型。

**参数**（`OVER`）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `name` | `""` | 要移除的供应商名 |
| `list` | `false` | 列出可移除的供应商（不删除） |
| `file` | `""` | 配置文件路径，默认 `$USERPROFILE/.omp/agent/models.yml` |

**示例**：

```js
// 列出可移除的供应商
let code = await read("skill://omp-provider/remove.mjs");
const OVER = { name: "", list: true, file: "" };
code = code.replace("const OVERRIDE = { name: \"\", list: false, file: \"\" };",
  "const OVERRIDE = " + JSON.stringify(OVER) + ";");
await new Function("return (async () => {\n" + code.replace(/^#![^\n]*\n/, "") + "\n})()")();
```

```js
// 移除指定供应商
let code = await read("skill://omp-provider/remove.mjs");
const OVER = { name: "coderxiaoc", list: false, file: "" };
code = code.replace("const OVERRIDE = { name: \"\", list: false, file: \"\" };",
  "const OVERRIDE = " + JSON.stringify(OVER) + ";");
await new Function("return (async () => {\n" + code.replace(/^#![^\n]*\n/, "") + "\n})()")();
```

- 用 `--list` 先查看可移除的供应商名。
- 移除后重开会话生效。

## 5. 常见坑

- **路径解析**：Windows 上 `bash` 的 `/tmp` 与 `node` 的 `/tmp` 可能映射到不同盘符。传给 `-f` 时用绝对路径（如 `C:/Users/...`）或系统环境变量展开后的路径。
- **`models.yml` vs `models.yaml`**：脚本优先 `.yml`，缺省回退 `.yaml`。
- **供应商名大小写敏感**：`Coderxiaoc` ≠ `coderxiaoc`，`disabledProviders` 精确匹配。
- **写入后重开会话生效**：`register` 写完后需重启 omp 会话才可见。
- **`register` 只写入不原地生效**：脚本不触发 omp 重载。需要重开会话才能使用新的供应商。
- **`models` 参数逗号分隔**：`"1, 3, 5"` 带空格也可解析（自动 trim）。