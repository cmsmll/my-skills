---
name: visual-augment
description: 视觉增强补全技能。部分基座模型仅支持纯文本输入、无法直接处理图片，本技能接管图片类请求：通过子 Agent 调用选定的外部视觉模型（OpenAI 兼容 /chat/completions）完成图像理解/视觉增强/画面补全，把文本结果回传主模型。当用户上传图片、请求图像理解/看图/画面补全/视觉增强/OCR/截图分析，而主模型不支持图像输入时触发。覆盖：视觉模型选型（ask 多选→配置持久化）、首次初始化提示、执行图片任务（read+重定向到子Agent调用外部模型）。
---

# visual-augment — 视觉增强补全

接管图片类请求，补齐主基座模型缺失的图像能力。主模型只做文本处理；图像相关逻辑全部交由 **子 Agent + 外部视觉模型** 完成，处理结果以文本交付主模型继续处理。

## 核心原则

- **主模型不直接发图像给基座**：图片类任务一律交给子 Agent，经外部视觉模型处理后，把文本结果回传主模型。
- **未完成模型选型前，禁止发起任何视觉模型调用**。首次调用且无已保存配置时，不执行任务，先引导用户完成选型。
- **配置持久化**：选型结果保存到 skill 目录 `config.json`，作为后续 DEFAULT 配置。

## 配置存储与路径

- 配置文件：`$USERPROFILE/.omp/agent/managed-skills/visual-augment/config.json`（omp 的 `omp-managed` provider 扫描目录内）。
- 格式：`[{"provider": "...", "model": "..."}, ...]`（数组，支持多选，执行时按序取）。
- 构造路径一律用 `$USERPROFILE`，不要用 `~`（omp bash 中 `$HOME` 为空、`~` 解析不可靠）。

## 配置流程（agent 执行）

### ① 首次调用 & 无配置
会话中出现图片请求，且主模型不支持图像时：
1. 读取 `config.json`：存在且非空 → 直接用；不存在/为空 → 进入选型流程（不执行任务）。
2. 运行 `config.mjs --list` 列出现有候选（来自 `models.yml` 已注册供应商，含 baseUrl/计费/免费标记）。
3. 用 `ask` 让用户**多选**视觉模型（`multi: true`，每选项展示 provider::model + 免费/计费标识 + ★视觉标记）。
4. 用 `ask`（y/N）确认所选。
5. 运行 `config.mjs --set "provider:model,provider:model"` 持久化所选。
6. 再执行图片任务。

### ② 修改已有配置
用户主动发起「改视觉模型/换视觉模型/重新选型」时，同样走选型→`--set` 覆盖旧配置（覆盖前先用 `ask` y/N 确认）。

### ③ 查看当前配置
用户问「当前用哪个视觉模型」→ 读 `config.json` 展示选型结果。

**加载器（通用）**：

```js
let code = await read("skill://visual-augment/config.mjs");
code = code.replace("const OVERRIDE = { file: \"\", config: \"\", list: false, set: \"\", remove: false };",
  "const OVERRIDE = " + JSON.stringify(OVER) + ";");
await new Function("return (async () => {\n" + code.replace(/^#![^\n]*\n/, "") + "\n})()")();
```

`OVERRIDE` 参数：
| 字段 | 默认 | 说明 |
|---|---|---|
| `list` | `false` | 列出候选模型（控制台直接 `--list` 亦可） |
| `set` | `""` | 持久化 `"provider:model"`（逗号分隔多选） |
| `remove` | `false` | 清空已存配置 |
| `config` | `""` | 配置文件路径，默认 `managed-skills/visual-augment/config.json` |
| `file` | `""` | models.yml 路径，默认 `$USERPROFILE/.omp/agent/models.yml` |

## 任务执行（已配置后）

用户发图片类请求时：

1. **读配置**：读 `~/.omp/agent/managed-skills/visual-augment/config.json` 取 `provider`/`model` 列表；空则走选型流程。
2. **派子 Agent**：把**图片路径 + 任务指令 + 所选 provider/model + baseUrl + apiKey（从 models.yml 读对应供应商）** 打包发给子 Agent。子 Agent 用 omp eval 加载执行。
3. **子 Agent 调用**：命中 OpenAI 兼容接口，把图片 base64 作为 message content 发送到 `{baseUrl}/chat/completions`，返回视觉模型的文本结果。

子 Agent 执行按如下模式（批注占位，实际替换）：

```js
// 图片转 base64 + 公式组装 messages（OpenAI 兼容，图文混合）
let provider = "sensenova";        // 读 settings 得到
let model   = "glm-5.2";           // 读 settings 得到
let apiKey  = process.env.SENSENOVA_API_KEY;   // 环境变量，不要明文
let baseUrl = "https://token.sensenova.cn/v1"; // 读 models.yml 对应 provider
let imgBase64 = ...;               // 图片文件 base64
let body = {
  model,
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "描述这张图片的内容" },
      { type: "image_url", image_url: { url: "data:image/png;base64," + imgBase64 } }
    ]
  }]
};
const r = await fetch(baseUrl + "/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
  body: JSON.stringify(body)
}).then(r => r.json());
// 取 r.choices[0].message.content 作为文本结果
```

3. **主模型收尾**：子 Agent 把文本结果交回主模型，继续后处理、汇总、输出。

## 约束

- 主模型仅做文本处理；图像相关逻辑全部交由子 Agent + 外部视觉模型完成。
- **未完成模型配置前，禁止发起任何视觉模型调用**——只提示选型，不执行任务。
- 配置、key 均从本地文件/env 读取，不在输出正文中落明文。
- 此后若用户上传新图片/新视觉任务，复用已存配置，不再重复询问选型（除非用户要求改）。