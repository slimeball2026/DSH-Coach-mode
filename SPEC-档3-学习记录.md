# SPEC · 档 3（v0.5）学习记录 / `coach_note`

> **状态**：**已实现（0.5.0，2026-11-13）**。用户已拍板三条（§0）；偏差见「实施状态」。
> **基线**：bundle **0.4.5** / `stateVersion` **11** / **8 个**教练工具 / 单测 **204** / DSH **0.2.2-rc.1**。
> **目标版本**：**0.5.0**；`stateVersion` **12**；工具数 **9**；相位不变（11）；单测 **238**。
> **关系**：档 1（`03. SPEC-档1最小切片.md`）已冻结；档 2（`SPEC-档2-教练模式.md`）的 D1–D11、R1–R16 继续有效。
> 本档只新增一个**只写记录、不可编辑**的能力，**不放松** `write` / `edit` 守卫。

---

## 实施状态（0.5.0，2026-11-13）

已按本 SPEC 落地，代码在 `coach-mode-bundle/`：

| 层 | 文件 |
|---|---|
| 渲染核心 | `core/note.js`（`normalizeNoteInput` / `renderNote` / `selectNoteImages` / `redactSecrets`） |
| 状态规则 | `core/note-state.js`（`assertNoteSaveable` / `applyNote` / `findAlreadySaved`） |
| 适配层 | `tools/coach-note.js`（路径、权限、读图、写盘、幂等） |
| 折叠 | `core/reduce.js` 的 `coach_note` 分支；`core/machine.js` 的 `notes` / `STATE_VERSION = 12` |
| 状态块 | `core/render.js` 的【记录】一行 |
| 人设 | `cordis.patch.yml` 的【学习记录】与 `coach_note` 条目 |
| 测试 | `test/note.test.js` / `note-state.test.js` / `note-tool.test.js`，全量 **238** |

**与设计稿的实现差异（均为有意）**

1. **preview 不展开图片**：预览只写占位符「保存时内嵌」，避免 base64 把 16 KB 的预览上限撑爆；
   保存时才读附件并内嵌。A17-1 按此验收。
2. **`nextSteps` 并入 §1**：不新增第 6 段，保持「固定 5 段」。
3. **复用 `userArtifacts`**：v0.4.5 已有该字段，0.5.0 只把它从 `{id,kind,at}` 扩展为带完整 `ref`；
   教练截图需要 `shot.mediaType` / `shot.bytes`，也在 0.5.0 补进 `shot` 元数据。
4. **`noteMaxBytes` 默认 8 MiB**：3 张 3 MiB 的图 base64 后约 4 MiB，留余量。
5. **A17-19/20 仍需实机**：COMPLETE 提议一次、用户拒绝后不再提——这两条是提示词行为，单测覆盖不到。

---

## 0. 用户已拍板的 3 条（2026-11-13）

| # | 问题 | 决定 | 含义 |
|---|---|---|---|
| Q1 | 记录文档的格式 | **Markdown** | 可编辑、可 diff；用户想要 HTML/PDF 时再单独要求转换（0.5.0 不做导出器） |
| Q2 | 何时生成 | **COMPLETE 时主动提议一次** | 仍必须用户明确同意才落盘；**绝不自动写**；用户拒绝或忽略后不再重复提议 |
| Q3 | 教练自己截的图 | **可以进文档，但默认不进** | 只有显式传 `includeCoachShots: true` 才包含，并逐张标注「教练截图」 |

**本 SPEC 采用、但用户仍可否决的两条**：

| # | 方案 | 理由 |
|---|---|---|
| D1 | **预览 → 保存两步**：`save` 必须晚于一次同标题 `preview`，且两者之间必须有用户消息 | 与截图「必须晚于用户这次反馈」同一套确定性口径；防止模型自说自话落盘 |
| D2 | **不新增 `allowWrite` 配置，只新增窄工具** | 守卫一旦可配置放宽，模型就会把「写记录」当入口改用户工程文件；能力要按用途切，不按开关切 |

---

## 1. 目标与非目标

### 1.1 目标

1. **0.5.0**：新增 `coach_note`，按用户要求把本次教练会话整理成一份 Markdown 学习记录，落在工作区 `.coach/notes/`。
2. 记录包含三类内容：**会话事实**（进度、证据、跳过、回退、检索）、**模型解释**（概念、踩坑、下一步）、**用户提供的截图证据**。
3. 保持现有不变量：`core/` 零宿主 import、零 IO、零时间、零随机；状态仍从会话日志折叠；不新增会话事件类型。
4. `write` / `edit` 守卫保持原样，且新增测试证明它仍然拦得住。

### 1.2 非目标（0.5.0 明确不做）

| 项 | 原因 |
|---|---|
| 任意路径写入、覆盖已有文件、编辑用户工程文件 | 那就不是「记录」了；守卫的语义会被掏空 |
| HTML / PDF 导出 | Q1：先 Markdown，用户再要求转换；导出器留给 0.6 |
| 自动生成（进入 COMPLETE 就写） | Q2：必须用户点头 |
| 用 shell / PowerShell 复制图片或建目录 | 会绕过 fs 沙箱，重演 0.4.3 的 PowerShell 写入问题 |
| 二进制写入 | 宿主 `ctx.fs` 只有 `writeText`，没有二进制写；图片只能 base64 内嵌（§6.3） |
| 把记录当核查证据 | 记录是产物，不是 `coach_verify` 的输入；不得影响状态机 |
| 跨会话汇总 | 与 Q4 A 一致：只做同会话 |

---

## 2. 不可违反的设计原则

1. **能力门 + 路径门 + 权限门，三道都要。**
   - 能力门：插件自身只有 `coach_note` 能写，`write` / `edit` 仍然被守卫拒绝。
   - 路径门：只能写 `<session.cwd>/.coach/notes/`，`fs.resolve` 后必须 `fs.contains(workspace, target)`。
   - 权限门：写调用必须带会话的 `sandboxPolicy`；`read-only` 会话直接拒绝。
2. **事实区由插件写，解释区由模型写。** 模型在入参里**没有**「第几步通过」这种字段。它写不了状态，只能写复盘。
3. **只创建、不覆盖。** `createIfAbsent`；撞名加 `-2`。已存在的文件永远不动。
4. **图片只认用户提供的附件。** 插件自己截的图默认不进文档（与 `refersToSelfShot` 同一口径）；开了也要标注来源。
5. **写只在适配层。** `core/note.js` 只产出字符串；折叠遇到 `coach_note` 只记元数据，重放绝不重写文件。
6. **宁可报错，不可截断事实。** 状态表、跳过原因、图片数量都是事实；超上限报错，不静默丢。

---

## 3. 工具契约：`coach_note`

### 3.1 入参

| 字段 | 类型 | 必填 | 上限 | 说明 |
|---|---|---|---|---|
| `mode` | `"preview" \| "save"` | 是 | — | 默认语义：`preview` 只渲染、不落盘；`save` 才写文件 |
| `title` | string | 否 | 120 字符 | 缺省 `<toolName> 学习记录` |
| `summary` | string | 否 | 600 字符 | 这次学会了什么，1–3 句 |
| `concepts` | array | 否 | 8 项 | `{ name ≤ 60, explanation ≤ 600 }` |
| `pitfalls` | array | 否 | 8 项 | `{ symptom ≤ 600, cause ≤ 600, fix ≤ 600 }` |
| `nextSteps` | string[] | 否 | 8 项，每项 ≤ 200 | 下一步建议 |
| `includeCoachShots` | boolean | 否 | — | 默认 `false`；`true` 才把插件成功截的图也放进文档 |

**入参里没有任何路径字段。** 路径由插件算，模型无法指定目录或文件名。

### 3.2 出参

```js
{
  mode: 'preview' | 'save',
  status: 'previewed' | 'saved' | 'already-saved',
  title: string,
  path: string,           // preview 时为 ''；save 后为相对工作区的路径
  markdown: string,       // 仅 preview 返回，按 notePreviewMaxChars 截断
  facts: { total, passed, skipped, remaining, images: { included, skipped }, redactions },
  bytes: number,          // save 后实际写入的 UTF-8 字节数
}
```

`presentationMeta` 必须带 `{ coachTool: 'coach_note', mode, status, title, path, images, bytes }`，否则重启后状态块不知道记录存在过。

### 3.3 错误码

| 错误码 | 触发 |
|---|---|
| `COACH_NOTE_PHASE` | 在 `INIT` / `CHECK_TOOL_AVAILABILITY` / `PLAN` / `PAUSED` 调用 |
| `COACH_NOTE_PREVIEW_REQUIRED` | `save` 时找不到可用的同标题 `preview`，或 preview 之后没有用户消息 |
| `COACH_NOTE_ALREADY_SAVED` | 同标题刚保存过且中间没有用户消息——**不是错误**：返回 `already-saved` + 已有路径，不重复写 |
| `COACH_NOTE_FIELD` | 字段超长、类型不对、`pitfalls` 缺字段 |
| `COACH_NOTE_BUDGET` | 本次会话保存次数超过 `noteMaxPerSession` |
| `COACH_NOTE_PATH` | 路径逃逸、`notesDir` 非法、解析后不在工作区内 |
| `COACH_NOTE_TOO_LARGE` | 渲染结果超过 `noteMaxBytes` |
| `COACH_NOTE_NO_FS` / `COACH_NOTE_NO_ATTACH` | 宿主服务缺失 |
| `COACH_NOTE_READONLY` | 会话 `sandboxPolicy.mode === 'read-only'` |

### 3.4 允许的相位

`WAIT_FEEDBACK` / `INSTALL_TOOL` / `VERIFY_DONE` / `DEGRADED` / `NEXT_STEP` / `COMPLETE`。

拒绝：`INIT`、`CHECK_TOOL_AVAILABILITY`（还没计划，没内容）、`PLAN`（计划未生效）、`PAUSED`（暂停期间只允许 `resume`）、`RESEARCH`（过渡态）。

---

## 4. 路径与权限规则

### 4.1 目录

```text
<session.cwd>/.coach/notes/
```

- 配置项 `notesDir` 默认 `.coach/notes`；**只接受相对路径**，含 `..` 或盘符一律拒绝。
- 解析：`workspace = await fs.resolve(cwd)`，`root = await fs.resolve(notesDir, { cwd })`，要求 `fs.contains(workspace, root)`。
- 文件名由插件算：`YYYY-MM-DD-HHmm-<slug>.md`
  - 时间取适配层传入的 `now`（本地时区），格式固定；
  - `slug` 取 `toolName` 的 ASCII 小写 `[a-z0-9]+`，最长 24；中文/符号 → `note`；
  - 示例：`2026-11-13-2141-git.md`。
- 撞名：`createIfAbsent` 抛 `FS_NOT_OBSERVED` 时依次尝试 `-2` … `-9`，全满报 `COACH_NOTE_PATH`。**绝不覆盖。**

### 4.2 权限

```js
const policy = ctx.get('sandboxPolicy')?.resolve({ session })
if (policy?.mode === 'read-only') throw new CoachError(..., 'COACH_NOTE_READONLY')
await fs.writeText(target, markdown, { kind: 'createIfAbsent' }, exec.signal, policy)
```

- 必须把 `policy` 传给 `writeText`。省略会落到后端的部署默认值，可能比会话的只读模式更宽——这是 0.4.3 截图写入同一类漏洞。
- 沙箱拒绝（`FS_SANDBOX_DENIED`）原样上报，并提示「工作区不可写」。
- `writeText` 会递归创建父目录（`LocalFileSystem` 的 `mkdir(recursive)`），不需要单独建目录。

### 4.3 降级

`fs` / `attachments` 不可用、或写入被拒时，工具失败，但 `render` 必须给出替代路径：

> 无法落盘。可以把预览正文贴在对话里，由用户自己保存；教练不会改用 `write` / shell 去写。

---

## 5. 内容与真实性规则

### 5.1 事实区（插件计算，模型不可改写）

| 区块 | 来源 |
|---|---|
| 头部 front matter | `state` + `facts`（`now` 由适配层传入） |
| 目标与结果 | `toolName` / `originalGoal` / `userLevel` / `difficulty` / `progressStats` |
| 学习路径表 | `state.plan` + `effectiveSinceBack` 后的 verifications / skips + `failedAttempts` |
| 跳过清单 | `state.skips`（含 `reason`、`failedAttempts`） |
| 回退清单 | `state.backs`（含目标 `stepKey`、`reason`、`at`） |
| 检索记录 | `state.research`（query 已脱敏） |
| 证据来源 | 每步的 `evidence` + `check.target`（截断 80 字符） |

状态枚举固定：`通过` / `跳过` / `未完成` / `未开始`。

### 5.2 解释区（模型撰写，结构化）

- `summary`、`concepts[]`、`pitfalls[]`、`nextSteps[]` 原样进入对应段落。
- 段落带固定小标题；模型正文里的 Markdown 只允许普通段落、列表、行内代码、代码块（围栏 ≤ 20 行），**不允许** `<script>` / `<iframe>` / `<style>` / 图片语法（防止伪造「证据」）。
- 超过长度上限 → `COACH_NOTE_FIELD` 报错，让模型自己缩短；不静默截断。

### 5.3 图片规则

1. **只认用户消息里的 image 块**：折叠时把 `user/message` 的 `{ type: 'image', attachment }` 收进 `state.userArtifacts`（只存 attachment 引用，不存字节），最多保留最近 20 条。
2. 选取：`at > planAcceptedAt` 的用户图片，按时间升序取最后 `noteMaxImages` 张（默认 3）。
3. `includeCoachShots: true` 时，追加当前计划内**成功**的截图（`check.kind === 'screenshot' && check.ok === true`），按同样上限截取；用户图片优先。
4. 读字节：`attachments.readImage(ref)`。单张 > `noteImageMaxBytes`（默认 1 MiB）或读取失败 → **跳过这张，但在文档里留占位符**；累计字节达到 `noteMaxTotalImageBytes`（默认 3 MiB）后，剩余图片同样留占位符。**不静默丢、也不让整份记录失败**——用户还能拿到文字部分。`facts.images = { included, skipped }` 如实回报。
5. 每张图标注来源：
   - 用户图片：`图 N · 用户提供（seq 123）`
   - 教练截图：`图 N · 教练截图（窗口「Blender」，printwindow）`
6. 占位符格式：`> 〔图片未内嵌：`<attachmentId 前 12 位>`…，原因：超过单张上限 / 超过总量上限 / 读取失败〕`。

### 5.4 脱敏

渲染完成后扫一遍高置信度密钥模式，命中就替换成 `〔已脱敏〕` 并计数，写进 front matter 的 `redactions`：

- `sk-[A-Za-z0-9]{20,}`
- `AKIA[0-9A-Z]{16}`
- `ghp_[A-Za-z0-9]{20,}`
- `xox[baprs]-[A-Za-z0-9-]{10,}`
- `-----BEGIN [A-Z ]*PRIVATE KEY-----`

只做替换、不失败（失败会让用户拿不到记录）。正文里的本地路径**不脱敏**——记录是本地文件，路径是有用信息。

---

## 6. 格式

### 6.1 结构（固定 5 段，顺序不变）

```markdown
---
title: Git 入门 · 学习记录
tool: Git
level: 会基础
goal: 能在本地完成一次分支合并
mode: learn
session: 3f2a9c1e
stateVersion: 12
generatedAt: 2026-11-13T21:41:00+01:00
generator: coach-mode 0.5.0
redactions: 0
---

# Git 入门 · 学习记录

> 事实区由插件从会话日志计算，解释区由模型撰写。含屏幕截图，请勿提交到公共仓库。

## 1. 目标与结果
- 原始目标：…
- 结果：共 8 步，通过 6 / 跳过 2 / 未完成 0
- 检索：3 次

## 2. 学习路径
| # | 板块 · 步骤 | 状态 | 证据 | 失败 |
|---|---|---|---|---|
| 1 | 基础 · 初始化仓库 | 通过 | command `git status` | 0 |
| 2 | 基础 · 第一次提交 | 通过 | file `.git/HEAD` | 1 |
| 3 | 分支 · 合并冲突 | 跳过 | — | 3 |

## 3. 关键概念
### 暂存区
…

## 4. 踩过的坑
### `error: pathspec 'x' did not match`
- 原因：…
- 解决：…

## 5. 证据
### 图 1 · 用户提供（seq 123）
![用户截图 1](data:image/png;base64,…)
```

### 6.2 格式硬规则

- UTF-8、LF、文件以单个换行结尾。
- 状态枚举只用 `通过 / 跳过 / 未完成 / 未开始`。
- 表格列固定为 `# | 板块 · 步骤 | 状态 | 证据 | 失败`，不增不减。
- 不用 emoji（便于 grep 与 diff）。
- 「3. 关键概念」「4. 踩过的坑」为空时整段省略，不写空标题。
- 同一 `state` + 同一入参 + 同一 `now` → 逐字节相同的 Markdown（可做 golden test）。

### 6.3 为什么图片是 data URI

宿主 `ctx.fs` 只有 `writeText` / `editText` / `patchText` / `moveFile` / `deleteFile`，**没有二进制写**；用 shell 复制会绕过沙箱（禁止）。所以 0.5.0 只能把 PNG 以 base64 内嵌成 data URI。代价：

- 文件体积约为图片字节的 1.33 倍；
- 所以有 `noteMaxTotalImageBytes` 与 `noteMaxBytes` 两道上限；
- 0.6 若要做「Markdown + `assets/` 目录」，必须先有受沙箱约束的二进制写能力，或让宿主提供 `writeBytes`。

---

## 7. 状态与折叠

### 7.1 新增状态

```js
initialState = {
  // …
  notes: [],            // { title, path, status: 'preview'|'saved', at, images, bytes, redactions }
  // userArtifacts 已在 v0.4.5 落地（{ id, kind, at }），本档直接复用，不再新增字段。
}
```

`STATE_VERSION` 11 → **12**。

### 7.2 折叠规则

- `itemsFromEvents`：v0.4.5 起已经把 `user/message` 里的 image/file `attachment` 收进 `state.userArtifacts`，本档直接复用（最多 20 条）。
- `applyToolCall`：`case 'coach_note'` → `applyNote(state, meta, at)`。
- `applyNote` 是纯函数，只做状态校验与记录，**不写文件**：
  1. 相位校验；
  2. `mode === 'preview'`：追加 `{ status: 'preview', at }`，返回新状态；
  3. `mode === 'save'`：
     - 找到同标题、`at` 最近的 `preview`；不存在 → `COACH_NOTE_PREVIEW_REQUIRED`；
     - 要求 `state.lastUserFeedbackAt > preview.at`（预览之后用户说过话）；
     - 要求 `preview.at > lastBackAt(state)`（回退之后旧预览不算数，防止拿过期预览落盘）；
     - 若最近一条同标题记录已是 `saved` 且 `at > lastUserFeedbackAt` → `COACH_NOTE_ALREADY_SAVED`；
     - 追加 `{ status: 'saved', path, ... }`；
  4. 保存次数（`status === 'saved'` 的总数）≥ `noteMaxPerSession` → `COACH_NOTE_BUDGET`。

> 重放时 `applyNote` 只重算 `notes`，不会重新写盘；文件只在工具执行的那一次产生。

### 7.3 幂等

同一标题在**用户没有新消息**的情况下重复 `save` → 返回已有路径与 `already-saved`，不写第二个文件。

### 7.4 状态块

新增一行（`notes.length > 0` 或 `phase === 'COMPLETE'` 时出现；`PAUSED` 除外），三态之一：

```text
【记录】未生成（可用 coach_note 预览；保存前需用户确认）
【记录】有 1 份预览未保存（保存前需用户确认）
【记录】已生成 2 份，最近 2026-11-13-2141-git.md
```

---

## 8. 适配层实现

```
core/note.js        新增。纯函数：renderNote(state, payload, facts) → { markdown, filenameSlug, stats }
core/machine.js     新增 notes（userArtifacts 已存在）；STATE_VERSION → 12
core/reduce.js      user/message 收图片引用；case 'coach_note' → applyNote
core/note-state.js  新增。纯函数：applyNote（相位、预览门、保存门、预算）
core/render.js      【记录】一行
tools/coach-note.js 新增。校验字段 → 收图 → 渲染 → 解析路径 → 权限 → writeText → 返回
index.js            TOOL_FACTORIES 增加 coach_note（工具数 9）
config.js           新增 notesDir / note* 上限
```

`tools/coach-note.js` 的步骤顺序（顺序很重要）：

1. `projection.stateForExec(exec)`；
2. 字段校验与长度上限（纯函数 `validateNotePayload`）；
3. `attachments` / `fs` 存在性检查；
4. 选图（用户附件 → 可选教练截图），`readImage` 读字节，超限处理；
5. `renderNote`（传入 `now`、`version`）；
6. `preview`：直接返回，不碰磁盘；
7. `save`：`fs.resolve` → `contains` 校验 → `sandboxPolicy` → `writeText(createIfAbsent)`；
8. 返回 `presentationMeta`。

---

## 9. 提示词与状态块

### 9.1 persona 增补

- **COMPLETE 收尾时提议一次**：「要不要我把这次学习整理成一份记录（Markdown，含你提供的截图）？」
  - 用户拒绝、或没有回应 → 之后**不再重复提议**。
  - 用户同意 → 先 `coach_note(mode:"preview")`，把预览的要点贴在对话里，问「确认保存吗？」；用户确认后才 `mode:"save"`。
- **不许声称已保存**，除非工具返回 `status: "saved"`。
- 记录只写「这次会话发生了什么」，**不写用户本该自己完成的产物**（代码、配置、作业答案）。
- 绝不为了写记录去用 `write` / `edit` / `pwsh` / `bash`。

### 9.2 状态块

- COMPLETE 且无记录：给出【记录】可用提示；
- 已有记录：显示份数与最近路径；
- 暂停期间：不显示（暂停块已经不含执行步骤）。

---

## 10. Config（`cordis.patch.yml` 的 `coach-engine` 行）

| 字段 | 默认 | 含义 |
|---|---|---|
| `notesDir` | `.coach/notes` | 相对工作区的记录目录；只接受相对路径 |
| `noteMaxPerSession` | `5` | 单会话最多保存几份 |
| `noteMaxBytes` | `8388608` | 渲染后 Markdown 的字节上限（含 base64） |
| `noteMaxImages` | `3` | 单份记录最多几张图 |
| `noteImageMaxBytes` | `1048576` | 单张图片字节上限 |
| `noteMaxTotalImageBytes` | `3145728` | 单份记录图片总字节上限 |
| `notePreviewMaxChars` | `16000` | `preview` 回给模型的正文上限 |

沿用 `naturalOf` / `stringListOf` 的归一化风格；没有 schema，写错静默回落（与现状一致）。

---

## 11. 验收（A17）

| # | 用例 | 期望 |
|---|---|---|
| A17-1 | `preview` | 不创建任何文件；返回 Markdown；状态块显示「有 1 份预览未保存」 |
| A17-2 | 同回合 `preview` + `save` | `COACH_NOTE_PREVIEW_REQUIRED`（没有用户消息） |
| A17-3 | 用户说「好」之后 `save` | 文件落在 `.coach/notes/`；事实区与预览一致，图片在保存时才内嵌（`generatedAt` / 证据段除外） |
| A17-4 | `notesDir: "../x"` / 绝对路径 | `COACH_NOTE_PATH` |
| A17-5 | 目录内已有同名文件 | 生成 `-2`，不覆盖 |
| A17-6 | 只读会话 | `COACH_NOTE_READONLY` |
| A17-7 | 用户发过 2 张图 | 文档内嵌 2 张，标注「用户提供」 |
| A17-8 | 插件截过图、`includeCoachShots:false` | 文档内不含教练截图 |
| A17-9 | `includeCoachShots:true` | 含教练截图并标注窗口与方式 |
| A17-10 | 有跳过 / 回退 / 失败步骤 | 状态表与清单如实显示，模型无法改写 |
| A17-11 | 同标题重复 `save` | 返回 `already-saved`，不产生第二个文件 |
| A17-12 | 超过 `noteMaxPerSession` | `COACH_NOTE_BUDGET` |
| A17-13 | 超过正文上限 | `COACH_NOTE_TOO_LARGE`，不截断事实 |
| A17-14 | 单张图片超限 / 读取失败 | 文档内留占位符，`facts.images.skipped` 计数，文字部分照常保存 |
| A17-15 | 记录含 `sk-…` | 替换为 `〔已脱敏〕`，`redactions: 1` |
| A17-16 | 会话日志重放 | `notes` 可重算，不重复写盘 |
| A17-17 | `write` / `edit` / `apply_patch` | 仍被守卫拒绝（回归） |
| A17-18 | 渲染同一状态两次 | 逐字节相同（`now` 固定） |

A17-1 – A17-18 已由单测覆盖；实机验收留空：`A17-19`（COMPLETE 提议一次后不再重复）、
`A17-20`（用户拒绝后不写）。

---

## 12. 测试清单

| 文件 | 内容 |
|---|---|
| `test/note.test.js` | 渲染 golden、状态枚举、跳过/回退表、空段落省略、字段上限、脱敏、slug |
| `test/note-state.test.js` | 相位、预览门、保存门、幂等、预算、stateVersion |
| `test/note-tool.test.js` | 假 fs/attachments：路径逃逸、只读、撞名、图片选择与上限、失败降级 |
| `test/decoupling.test.js` | 追加：`core/note*.js` 不得 import Node 内置模块（禁止 `node:crypto`） |
| `test/tool-shape.test.js` | 工具数 8 → 9；`coach_note` 的 schema 无损 |
| `test/machine.test.js` | 现有断言 `stateVersion === 11` 改为 12 |
| `_ref/smoke-coach.mjs` | 预览 → 保存 → 重放 不重复写；guard 仍拒 `write` |

预计新增 30–40 个用例，总数 171 → 约 205。

---

## 13. 风险与待复核

| 风险 | 处置 |
|---|---|
| base64 让文件很大（3 MB 图 → 约 4 MB 文本） | 三道上限；默认 3 张、单张 1 MiB |
| 附件被存储层回收后 `readImage` 失败 | 文档里留占位符，不失败；README 写明 |
| 用户把含截图/路径的记录提交到公共仓库 | 文档头固定警示；`notesDir` 建议加 `.gitignore` |
| 模型把「记录」写成作业答案 | persona 明确范围；事实区只描述会话；标题固定为「学习记录」 |
| 模型谎报 `save` 成功 | 记录只在工具返回 `saved` 后才在状态块出现 |
| `notesDir` 被用户配到工作区外 | `fs.contains` 拒绝 |
| 只读会话被绕过 | 必须传 `sandboxPolicy`；测试覆盖 |
| 预览内容很长，贴进对话占 token | `notePreviewMaxChars` 截断，并提示「完整内容保存后可看」 |

---

## 14. 实施顺序

1. **SPEC**（本文件）→ 用户确认。
2. `core/`：`machine` 字段、`reduce` 收图片、`note` 渲染、`note-state` 校验；单测。
3. `tools/coach-note.js` + `index.js` 注册 + `config.js`；冒烟。
4. `render.js` 的【记录】行 + persona 增补。
5. 文档：bundle `README`（工具表、Config 表、格式）、根 `README`（版本/工具数）、`CHANGELOG` 0.5.0。
6. 真机跑 A17-19/20；记录 session id + seq。

---

## 附录 A · 完整的 Markdown 模板

见 §6.1；渲染器必须逐段匹配该结构（空段落整段省略）。

## 附录 B · 工具 schema（JSON 形态）

```json
{
  "name": "coach_note",
  "parameters": {
    "type": "object",
    "properties": {
      "mode": { "type": "string", "enum": ["preview", "save"] },
      "title": { "type": "string" },
      "summary": { "type": "string" },
      "concepts": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "name": { "type": "string" },
            "explanation": { "type": "string" }
          },
          "required": ["name", "explanation"]
        }
      },
      "pitfalls": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "symptom": { "type": "string" },
            "cause": { "type": "string" },
            "fix": { "type": "string" }
          },
          "required": ["symptom", "cause", "fix"]
        }
      },
      "nextSteps": { "type": "array", "items": { "type": "string" } },
      "includeCoachShots": { "type": "boolean" }
    },
    "required": ["mode"],
    "additionalProperties": false
  }
}
```

## 附录 C · 决策台账

| # | 决定 | 状态 |
|---|---|---|
| Q1 | Markdown；转换由用户另行要求 | 用户拍板 |
| Q2 | COMPLETE 主动提议一次，仍需确认 | 用户拍板 |
| Q3 | 教练截图默认不进，`includeCoachShots` 显式开 | 用户拍板 |
| D1 | 预览 → 保存两步门 | 本 SPEC 采用 |
| D2 | 不新增 `allowWrite`，只加窄工具 | 本 SPEC 采用 |
| D3 | 图片 base64 内嵌（fs 无二进制写） | 技术约束 |
| D4 | 事实区 / 解释区分离 | 设计原则 |
| D5 | 只收用户附件；教练截图需显式 | 与 `refersToSelfShot` 同口径 |
| D6 | `stateVersion` 11 → 12 | 折叠语义变化 |
