---
name: omp-provider-health
description: 检测 models.yml 中配置的厂商（provider）是否可用、api key 是否有效、vendor 是否可达、配置的模型哪个能用。当用户说『检测厂商可用性』『检查 models.yml 供应商』『provider 健康检查』『配置的模型哪个能用』『api key 是否有用』『vendor 是否可达』『哪个模型可用』『检测配置的厂商是否可访问』『models.yml 检查』等需要验证 omp 模型供应商连通性/凭据/模型列表时使用本技能。覆盖：读 models.yml → 判定凭据可否解析 → 探测 GET {baseUrl}/models（可达/鉴权/模型列表）→ 与配置模型 id 匹配 →（可选）POST {baseUrl}/chat/completions 端到端探测 → 输出对齐汇总表。
---

# 检测 models.yml 配置的厂商可用性（omp-provider-health）

本技能针对 omp 的自定义模型配置 `~/.omp/agent/models.yml`（或 `.yaml`），逐一验证其中每个 `providers.<id>` 是否「可用」。这里的「可用」遵循 omp 官方判定：**厂商 ID 未被 `disabledProviders` 禁用，且（免密 **或** 有可解析凭据）**，并进一步用网络探测确认 baseUrl 真实可达、鉴权通过、服务器端确实暴露对应模型。

## 1. 「可用」的判定规则（来自 omp 权威语义）

- **可用 = 未在 `disabledProviders` 禁用 且 （`auth: none` 免密 **或** 有可解析凭据）**。`disabledProviders` 写在 `config.yml`（全局/项目），用 `omp config get disabledProviders` 查**合并后的生效列表**；厂商 ID **精确匹配**、大小写敏感，先于凭据检查——被禁用的厂商即使有 key 也不可选。
- **`apiKey` 解析**（env-name-or-literal）：值先当**环境变量名**取（`process.env[NAME]`）；若该 env 未设置，则用**字面字符串**当 token；`!` 前缀则按命令执行、取裁剪后的 stdout 作为 secret；`auth: none` 免密不需要 key。
- **`api: openai-completions`** → 运行时聊天走 `POST {baseUrl}/chat/completions`；模型列表走 **`GET {baseUrl}/models`**（OpenAI 兼容），带 `Authorization: Bearer <key>` 请求头（`authHeader: true` 时 omp 自动注入）。
- baseUrl 通常已含 `/v1`（如 `https://coderxiaoc.com/v1`），在其后拼 `/models` 即得 `…/v1/models`；**不要重复拼** `/v1`。

## 2. 一键探测脚本

完整脚本在 `provider-health.mjs`（本技能同目录）。运行方式：在 omp 的 `eval`（`language: js`）里用 `read` 加载该文件并执行。

**加载器**（复制到 eval → `language: js` 直接跑；`<脚本路径>` 换成 provider-health.mjs 的实际位置）：

```js
// omp eval 加载并可覆盖参数
let code = await read("<脚本路径>");               // 例: skill://omp-provider-health/provider-health.mjs
const OVER = { file: "", timeout: 8, chat: "", verbose: false };  // 想改参数改这里
code = code.replace("const OVERRIDE = { file: \"\", timeout: 8, chat: \"\", verbose: false };",
  "const OVERRIDE = " + JSON.stringify(OVER) + ";");
await new Function("return (async () => {\n" + code.replace(/^#![^\n]*\n/, "") + "\n})()")();
```

- **脚本路径**：注册后可用 `skill://omp-provider-health/provider-health.mjs`。
- **参数**：在 `OVER` 里改 `file`（配置文件）、`timeout`（秒）、`chat`（端到端探测模型 id）、`verbose`（详情）。脚本默认读 `$USERPROFILE/.omp/agent/models.yml`，缺 `.yml` 自动回退 `.yaml`。
- 脚本解析该固定缩进 YAML（按 2 空格缩进层级切分）、按 omp 语义判凭据、逐厂商 fetch 探测，全程不打印任何明文 key，输出台宽对齐汇总表（中文按双宽计）。

## 3. 执行步骤

1. **运行脚本**：在 omp 的 `eval`（`language: js`）里粘贴第 2 节的加载器，修改 `<脚本路径>` 为实际位置，改 `OVER` 参数（可选），直接跑。默认读 `$USERPROFILE/.omp/agent/models.yml`，缺 `.yml` 自动回退 `.yaml`；换文件改 `OVER.file`。
2. 看「可达/HTTP」列先行：`200 OK` 才谈可用；`401 鉴权失败` / `403 无权限` = key 已解析但对端不认；`DNS失败 / 超时 / 连接失败` = 网络或 baseUrl 不可达。
3. 看「匹配/缺失」列：`2/2` = 配置模型在服务端全部存在；`缺失:[…]` = 服务端没暴露那些模型 id（可能改名/下架/需新套餐）。
4. 「凭据状态」列：`env:NAME` = 用了该环境变量的值；`字面值(env NAME 未设置)` = 该 env 缺失、按字面字符串当 token（**几乎必 401**）；`免密 auth:none` = 无需 key。
5. `auth: none`：脚本不注入 Authorization，直接探 `/models`；本地免密能 200 即可达。
6. `!` 命令 secret：脚本用 `bash -c "<cmd>"`（10s 超时）执行配置里的命令并取 stdout 作 token；在**当前用户上下文**运行、不会打印明文（来源只显示 `!命令`）。仅在自己可信的配置上用它。

## 4. 可选端到端探测（chat completeness）

默认只探 `/models`（出 token 少、不产生计费流量）。想确认某模型能真实往返，在加载器里设 `OVER.chat = "<模型id>"`（如 `gpt-5.5`）。

脚本会 POST `{baseUrl}/chat/completions`，body 为
`{"model":"…","messages":[{"role":"user","content":"hi"}],"max_tokens":1}`，打印返回 HTTP（200=真实可达；非 200 见状态码）。`max_tokens=1` 控制最小返回量，单次探测成本可忽略。

## 5. 常见坑（JS 版）

- **env 未 export**：`apiKey: CODERXIAOC_API_KEY` 在本进程没该 env（omp 启动是独立进程，通常不带你的 shell 变量）时，按字面 token 处理 → 必 401。要么在 omp 环境导出，要么换 `!` 命令或写在真字面。
- **401 是「对端拒绝」，不等于解析失败**：凭据状态显示 `env:NAME` 但 HTTP 401，说明 key 解析出来了但对端点无效（服务端 `INVALID_API_KEY`）——两列要分开看。
- **`/models` 与 `/v1/models` 尾部拼接**：baseUrl 已含 `/v1`（`…/v1`）→ 拼 `/models` 成 `…/v1/models`，别再把 `/v1` 拼一遍；脚本用 `base.replace(/\/+$/,"")` 去尾部 `/` 再拼。
- **Node 18+/Bun 才有 fetch / AbortSignal.timeout**：旧 Node（<18）没有全局 `fetch`，需升 Node 或用 Bun；`AbortSignal.timeout` 少了会直接抛错——见「超时」一条。
- **Windows 路径**：`process.env.USERPROFILE`（而非总是 `HOME`）才是用户目录；`C:\…` / `C:/…` 两种风格 `read` / `fs` 都能读，脚本会把 `\\` 归一成 `/` 再展示。
- **`process.exit` 慎用**：在 omp eval 里 `process.exit()` 会杀掉 worker cell；脚本改用 `process.exitCode = 1` + return，node CLI 同样生效。
- **Bun.spawnSync 的 stdout 是 Uint8Array**：omp eval 的补后端默认返回字节数组，需 `Buffer.from(r.stdout).toString('utf8')` 归一成字符串（脚本已内置 `normOut`）；纯 node 的 child_process.spawnSync 本身是 string。
- **`$HOME` vs `$USERPROFILE`**：Windows 上 omp/环境里 `$HOME` 常空、`~` 不可靠 → 构造路径一律 `process.env.USERPROFILE`（脚本默认值已写死）；Linux/macOS 用 `HOME`。
- **`models.yml` vs `models.yaml`**：omp 优先 `.yml`，缺省回退 `.yaml`；脚本已实现同优先级。
- **厂商名大小写敏感**：`disabledProviders` 精确匹配，`Coderxiaoc` ≠ `coderxiaoc`。脚本也按原样匹配，别拼错导致误判。
- **单厂商失败不中断整体**：每厂商独立 fetch、独立 try/catch；某厂 DNS/超时/401 不影响其它行。
- **不打印明文 key**：脚本全程只报「env:NAME / !命令 / 字面值」等来源，密钥本体不落屏、不落盘。

## 6. 官方文档（权威）

- `omp://models.md` —— Model and Provider Configuration：`models.yml` 结构、provider 字段、认证 resolve 顺序、`api: openai-completions` 走 `/v1/chat/completions`、模型列表 `GET /models`（OpenAI 兼容）。
- `omp://providers.md` —— How omp decides a provider is available ＋ Credentials and precedence ＋ `disabledProviders`（合并/作用域，用 `omp config get disabledProviders` 查生效列表）。
- `omp://tools/eval.md` —— 开发期执行（含 `language: js` 的 worker 语义）。
- 真实配置样板：本机 `$USERPROFILE/.omp/agent/models.yml`（当前为 coderxiaoc / codex2api 两个 OpenAI 兼容厂商，各含 `baseUrl`、`apiKey`（env 名）、`api: openai-completions`、`models[]`）。