# Skill 开发手册

本手册定义本仓库（`E:\CMS\code\my-skills`）的 Skill 开发与发布流程。

## 1. 目录与角色

| 位置 | 角色 | 说明 |
|---|---|---|
| `my-skills\<skill-name>\SKILL.md` | **开发区（唯一编写地）** | 新技能与一切修改**先**在此编写、走 git 版本管理；不影响运行中的 omp |
| `C:\Users\CMS\.omp\agent\managed-skills\<skill-name>\SKILL.md` | **注册区（发布地）** | omp 的 `omp-managed` provider（优先级 5）扫描目录，技能在**会话启动时**注册 |

**一致性约定**：技能目录名 = frontmatter `name` = slug（三者必须一致，否则注册不上）。

## 2. 开发流程

```
本地编写 → 自查 → 用户查验 → 用户下达注册指令 → 复制到 managed-skills → 提交本地（推送需指令） → 重开会话生效
```

### Step 1 · 本地编写
- 在 `my-skills\<skill-name>\SKILL.md` 编写，正文中文、自包含（接口参数/流程内联，不依赖外部参考文件）。

### Step 2 · 自查
- frontmatter `name` 为 kebab-case 且 == 目录名；
- `description` 写清触发场景（用户哪些说法应命中本技能）；
- 正文为可执行步骤，命令/路径可直接照抄运行；
- 正文只含使用者视角内容，不含开发元文本（如「不内嵌」「开发期」「本仓库」「与 xxx 同风格」等，见红线 5）。

### Step 3 · 等待用户查验
- ⛔ **用户查验前，绝不复制/注册到 omp**：开发区内容只存在于本地项目与 git 中，运行中的 omp 不受任何影响。
- 查验通过后，用户会**明确下达注册指令**（例如「注册到 omp」「下达注册」）。

### Step 4 · 用户下达注册指令后
- 复制到注册区（**必须用 `$USERPROFILE`，不要用 `~`**——omp bash 中 `$HOME` 为空，`~` 解析不可靠）：

```bash
mkdir -p "$USERPROFILE/.omp/agent/managed-skills/<skill-name>"
cp "E:/CMS/code/my-skills/<skill-name>/SKILL.md" "$USERPROFILE/.omp/agent/managed-skills/<skill-name>/SKILL.md"
```

- 注册区存在同名旧版时：**先经用户确认**再覆盖或删除；
- 校验：`head -3` 确认 frontmatter `name:` 与目录名一致。

### Step 5 · 提交（本地自动，远端需指令）
- `git add` → `git commit -m "<skill-name>: <变更摘要>"` → **自动提交到本地**。
- **不自动推送远端**。需要推送到远端正由用户下达指令（如「推送」「推送到远端」）。
- 远程：`git@github.com:cmsmll/my-skills.git`。

### Step 6 · 生效
- omp 技能在启动时扫描注册：注册后**重开会话**才可见；当前会话内 `skill://<skill-name>` 可能仍报 `Unknown skill`，属正常现象。

## 3. 红线

1. 未收到用户明确注册指令 → 不复制、不注册、不删改注册区；
2. 删除/覆盖注册区技能 → 必须先获得用户授权；
3. 本流程只管理 `managed-skills`；不自行改动 `~/.omp/agent/skills`（native）等其它技能目录；
4. 用户查验通过前，不得将开发区内容宣称为「已生效」。
5. **SKILL.md 正文只写使用者可执行的说明**，不混入开发元文本（如「不内嵌」「不调用用户安装的 X」「开发期用本仓库路径」「与 xxx 同风格」「本仓库」「注册指令」「开发区」等）。技能设计决策、交付流程说明见 AGENTS.md，不写入 SKILL.md 正文。

## 4. 环境备忘（Windows / git-bash 踩坑记录）

- omp bash 中 `$HOME` 为空、`USERPROFILE=C:\Users\CMS` → 构造路径一律用 `$USERPROFILE`；
- git-bash 的 `/tmp` 映射到 `C:\tmp`，且 `ls`/`cp` 对同一路径的解析可能不一致 → 避免依赖 `/tmp`，全程在目标目录内操作；
- SkillHub 安装：CLI 的 `install.sh` 在 Windows 上会把二进制写到不存在的 `/home/*`，不可用 → 用 zip 方式（`GET /api/v1/download?slug=<slug>` + `unzip`）；
- 会话内新注册的技能对当前会话不可见（启动时扫描），需重开会话。
