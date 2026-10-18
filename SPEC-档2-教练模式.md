# SPEC · 档 2（v0.4）

> **状态**：v0.4，2026-10-18。Q1–Q7 不变；v0.4 起进入 0.4 线，用户已拍板：
> **0.4.0 会话连续性（进度摘要 + 暂停/恢复）→ 0.4.1 脚手架递减 → 0.4.2 成本控制**。
> 0.4.0 已验收；**0.4.1 已验收（A14 通过）**；**0.4.2 已验收（A15 通过，d 为 N/A）**。
> **关系**：档 1 的 `03. SPEC-档1最小切片.md` 从此**冻结**；档 2 的施工以本文件为准。
> **开工基线**：bundle **0.2.4** / DSH **0.2.1-rc.1** / 单测 **63** / 冒烟 **33 项** / 备份
> `_backup-0.2.4-20261017`（bundle + 文档 + 验收报告 + 0.2.4 tgz，哈希已核对）。
> **0.3.2 回退点**：`_backup-0.3.2-20261017`（bundle + 文档 + 报告 + SPEC + 0.3.2 tgz + 冒烟/校验脚本）。
> **当前**：bundle **0.4.2** / 单测 **149** / **8 个教练工具** / `stateVersion` **9**
> （A8–A10 在 0.3.0 跑过、A9 在 0.3.1 复测、A12 在 0.3.2 与 0.3.3 实机通过、A11 在 0.3.4 通过、A13 在 0.4.0 通过、A14 在 0.4.1 通过、A15 在 0.4.2 通过；结果见 §7.7 / §8.3 / §12.7 / §13.8 / §14.6）。

---

## 0. 用户已拍板的 7 条（2026-10-17）

| # | 问题 | 决定 | 含义 |
|---|---|---|---|
| Q1 | 先做哪一块 | **A** | 先修 0.2.4 实机缺陷（0.2.5），再做检索/`RESEARCH`，然后 `INSTALL_TOOL`、`coach_back` |
| Q2 | 四个新关卡怎么落地 | **C** | 只给“模型必须做决定”的加工具；`CLARIFY_ERROR` / `DIAGNOSE_ERROR` 先留在 `WAIT_FEEDBACK` 里当分支 |
| Q3 | 检索缓存放哪 | **A** | 新增 `coach_research` 工具，把来源/时效/可信度写进 `tool/result.data.meta`，继续走“日志折叠” |
| Q4 | 暂停/恢复/回退 | **A** | 只做同会话：`coach_back` 追加回退记录；跨会话不做无缝续接，最多给一段可粘贴的交接摘要 |
| Q5 | 命令白名单 | **B** | 默认给一份**只读**白名单；显式写 `allowCommands: []` 可关闭 |
| Q6 | UI / slash | **A** | 本轮不做 Web UI、不做 slash 命令、不做 `/coach` 切换 |
| Q7 | 规格/验收放哪 | **A** | 新建本文件（v0.1），冻结 03；验收 = A7 12 条 + 08 用例 + 新增 A8–A12 |

**不重开的决策**：D1–D11、R1–R16（见 03）继续有效。特别是 D3/D4（状态全部从日志折叠、不新增事件类型、不注册投影、不用 storage）和 R9（整包禁止 `import '@deepseek-ai/*'`）。

---

## 1. 目标与非目标

### 1.1 目标

1. **0.2.5（补丁）**：修掉 0.2.4 在真实会话里暴露的两个死角，并落实 Q5 B 的只读白名单。
2. **0.3.0**：`RESEARCH` + `coach_research` + `research_cache`（Q3 A）。
3. **0.3.1**：修 0.3.0 实机的三处（【可跑命令】前移、检索失败不自动降级、移除 `consent`）。
4. **0.3.2**：`INSTALL_TOOL` 从 `PLAN + goalMode` 里独立出来（不新增工具，入口是 `coach_plan(toolAvailable="no")`，出口是 `coach_advance` 走完最后一步）。
5. **0.3.3**：安装体验小修（受控早退 A，SPEC §7）。
6. **0.3.4**：`coach_back`（Q4 A，只做同会话；SPEC §8）。
7. **0.4.0**：会话连续性——`【进度摘要】` + `PAUSED` + `coach_pause`（暂停/恢复，SPEC §12）。
8. **0.4.1**：脚手架递减（SPEC §13）。
9. **0.4.2**：成本控制（SPEC §14）。
10. 每个版本都必须保持 A1–A7 回归绿；验收以会话 id + 事件 `seq` 为准。

### 1.2 非目标（本轮明确不做）

| 项 | 原因 |
|---|---|
| Web UI、slash 命令、`/coach` 切换 | Q6 A；D1 也明确不做会话内切换 |
| 跨会话无缝续接、`ctx.storage` | Q4 A；继续坚持“日志是唯一真源” |
| `CLARIFY_ERROR` / `DIAGNOSE_ERROR` 独立相位 | Q2 C；先作为 `WAIT_FEEDBACK` 内的行为分支 |
| `Config` schema | 导出它必须 import `@deepseek-ai/schemastery`，与 R9 冲突；保持手写归一化 |
| `ctx.sessionProjections` 注册式投影 | 当前按需折叠足够；除非长会话出现性能问题 |
| 对话摘要、脚手架递减、成本控制 | 未拍板；放到 0.4 评估 |
| `pwsh` / `bash` 守卫 | 未拍板；需要先解决“只读命令核查”的替代通道，放到 0.4 评估 |
| 工具特定适配器、`uncertain_topics` | 0.4 评估；先保证通用层 + 文件/命令增强层 |

---

## 2. 版本路线

| 版本 | 内容 | 验收重点 |
|---|---|---|
| **0.2.5** | 空 `sections` 死角、`coach_check.kind` 校验、只读命令白名单、INIT 文案补“先问水平/目标” | 单测新增 7 条（总数 70）；`77495b5d` 回放不再循环；`kind:"none"` 被拒 |
| **0.3.0** | `RESEARCH` 过渡态 + `coach_research` + `research_cache` + 检索脱敏；四个文案补丁 | 实机 A8–A10：机制通过；来源质量/复用/A9 旁路降级见下 |
| **0.3.1** | `【可跑命令】` 前移；检索失败不再自动降级；移除模型可写 `consent` | 单测 83/83、冒烟 ALL GOOD；A9 复测通过（分支 + 新会话） |
| **0.3.2** | `INSTALL_TOOL` 独立相位 | 单测 84/84、冒烟 ALL GOOD；A12 实机通过（进入/退出正确），但“已装好仍走安装确认”的 UX 待改 |
| **0.3.3** | 安装体验小修（受控早退 A）：提示词三条 + 状态块两处 + `INSTALL_TOOL` 里 `coach_plan` 可退出安装分支 | A12 重测通过（§7.7）；`stateVersion` 6 |
| **0.3.4** | `coach_back`（同会话回退）：`backs` + 回退后旧证据/结论失效 | A11 实机通过（§8.3）；`stateVersion` 7；单测 110 |
| **0.4.0** | 会话连续性：`【进度摘要】` + `PAUSED` + `coach_pause`（暂停/恢复，同会话） | A13 实机通过（§12.7）；`stateVersion` 8；工具 8 |
| **0.4.1** | 脚手架递减：按板块表现算支撑等级 1–3，只变提示详细度、不放松核查 | 已验收（§13.5）；单测 142；`stateVersion` 8 不变；**A14 通过**（§13.7 / §13.8） |
| **0.4.2** | 成本控制：检索/步上限、状态块预算、检索正文截断、`【用量】` | 已验收（§14.4）；单测 149；`stateVersion` **9**；**A15 通过**（§14.6，d 为 N/A） |
| **0.5+** | UI/slash（若要）、`pwsh` 守卫、适配器分层、`uncertain_topics`、`Config` schema | 另行拍板 |

---

## 3. 0.2.5：修 0.2.4 的实机缺陷（本轮）

### F1 · 空 `sections` 的 `coach_plan` 不再把模型锁在“确认环境”

**问题**：`core/plan.js` 只要 `plan.length === 0` 就无条件进 `CHECK_TOOL_AVAILABILITY`，不看 `toolAvailable`；`tools/coach-plan.js` 的返回文案又固定说“工具可用性还是未知”。实机 `77495b5d` 连续 8 次 `coach_plan(toolAvailable="yes", sections 留空)`，每次都被告诉“还是未知”，会话停在「确认环境」。

**改法**：

- `sections` 为空且 `toolAvailable === "unknown"`：记录工具/目标，进 `CHECK_TOOL_AVAILABILITY`，返回“先问用户能不能打开”，`accepted: false`。
- `sections` 为空且 `toolAvailable` 已知（yes/no）：**不接计划**，留在原阶段（INIT 或 CHECK），保留已记录的工具/可用性，返回“可用性已记录；先问清水平和目标，再提交带 `sections` 的计划”，`accepted: false`。
- `coach_plan` 的返回文案按 `needsAvailability` / `needsSections` 分支，不再按 phase 猜。
- 状态块在 INIT/CHECK 新增 `【工具可用性】` 与 `【待补计划】` 两行。
- `stateVersion` 从 1 升到 **2**（折叠语义变了：同样一条空计划调用，折叠后的 phase 可能不同）。

**验收**：

- 单测覆盖“INIT + 空 sections + yes → 仍 INIT、planAcceptedAt=null、toolAvailable=true”。
- 单测覆盖“CHECK + 空 sections + yes → 仍 CHECK”。
- 用 `_ref/replay-check.mjs` 回放 `77495b5d`，状态块应显示“可用性已记录 / 待补计划”，而不是反复“还是未知”。

### F2 · `coach_check` 的 `kind` 必须在允许集合里

**问题**：宿主不校验 `parameters`（R10），`coach-check.js` 只分 `command` 和“其他”，于是实机 `6899f1df` 的 `kind:"none"` 被当成文件路径记录成环境核查。

**改法**：

- `core/verify.js` 的 `applyCheck` 开头校验 `CHECK_KINDS.includes(kind)`，非法就抛 `COACH_CHECK_KIND`。
- `tools/coach-check.js` 在真正读文件/跑命令**之前**也校验一次，避免非法 kind 触发 IO。
- 错误文案列出允许的四种 kind。

**验收**：单测断言 `kind:"none"` 抛 `COACH_CHECK_KIND`；冒烟脚本不再出现 `kind:"none"` 的记录。

### F3 · 默认只读命令白名单（Q5 B）

**改法**：

- `config.js` 增加 `DEFAULT_ALLOW_COMMANDS`，`resolveCoachConfig({})` 返回它的副本。
- 默认 7 条（精确字符串匹配）：
  `git --version`、`git status`、`git config --global --list`、`git log --oneline -5`、`node -v`、`npm -v`、`python --version`。
- `cordis.patch.yml` 的 `allowCommands` 显式列出同一份；显式写 `[]` 仍然可以关闭命令核查。
- 超过白名单的命令仍抛 `COACH_CHECK_COMMAND_DISABLED`，文案保留三条出路（改文件核查 / 改 `user_artifact` / 加白名单）。

**验收**：`config.test.js` 断言默认包含 `git --version`、不含 `rm -rf /`；显式 `[]` 返回空；非数组回落默认。

### F4 · INIT/确认环境阶段先问水平/目标（文案修正，非硬前置）

**问题**：`77495b5d` 里模型直接提交计划、跳过“问水平”，用户原话“你怎么都没问我的水平如何”。

**改法**：在 INIT/CHECK 的状态块引导里加一句“提交计划前先问清水平（从未用过 / 会基础 / 熟练想进阶）和目标；不要替用户填 `userLevel`”。**不**把 `userLevel` 改成必填，避免模型为了过校验而编造。

**验收**：`render.test.js` 断言该句出现；A7 第 8 条回归不退化。

### 0.2.5 实施状态（2026-10-17）

- 单测 **70/70**；装配冒烟 **ALL GOOD**；`node --check` 全部通过；`cordis.patch.yml` 用 js-yaml 解析通过。
- 从 profile 按包名导入：`apply,inject,name`。
- 回放 `77495b5d`：seq 30 仍是 `INIT`（原代码是 `CHECK_TOOL_AVAILABILITY`），不再进入“可用性还是未知”的循环。
- 回放 `34b31edc`（Illustrator 全流程）：`INIT → WAIT_FEEDBACK → VERIFY_DONE → NEXT_STEP → … → COMPLETE`，与修复前一致。
- `_dist/local-coach-mode-0.2.5.tgz` 已重打（43.7 KB，无 BOM）。
- **尚未覆盖安装、尚未重启**；这两步需要用户确认后做。

### 0.2.5 实机导出复核（2026-10-17 晚）

用户先后提供 4 份 `/export` 日志（已解压到 `_verify-20261017`）：`测试1` / `测试2` 是短会话，
`测试无思考` / `测试low级思考` 是同一模型在无思考与 low 思考档下的完整建计划会话。

| 项 | 测试1（我想学 Git） | 测试2（我想学习 HTML） |
|---|---|---|
| preset | `coach` | `coach` |
| 0.2.5 状态块 | ✅ 出现“只有这几条路” | ✅ 出现“只有这几条路” |
| `unknown prompt variable` | 0 次 | 0 次 |
| 5 个教练工具注册 | ✅（`request/header.tools` 可见） | ✅ |
| 教练工具调用 | **0 次** | **0 次** |
| 阶段轨迹 | `开始@10` | `开始@11 → 开始@28` |
| 硬错误 / `isError` | 0 | 0 |

第二轮（同一模型，两个思考档）：

| 项 | 测试无思考 | 测试low级思考 |
|---|---|---|
| preset | `coach` | `coach` |
| `coach_plan` | ✅ 42→43，**2 板块 4 步** | ✅ 32→33，**4 板块 7 步** |
| 阶段轨迹 | `开始@11 → 开始@29 → 等待反馈@46` | `开始@11 → 等待反馈@36` |
| 每步 `check` | `file` 步都有；`user_artifact` 步无（正确） | 同左 |
| 工具结果错误 | 0 | 0 |
| 其它工具 | 0 | `ask_user_question` ×2（可用性 + 水平/目标） |
| 结论 | **计划入口实机通过** | **计划入口实机通过** |

**结论**：0.2.5 的**装载**验证通过（新文案、工具注册、无硬失败）；第二轮又验证了
**计划入口**——两次 `coach_plan` 都带非空 `sections`、成功落到 `WAIT_FEEDBACK`，且 `file` 步骤
都带了 `check`，当前代码回放与日志一致。

### 核查闭环（`check触发`，续跑同一 session `c0e1bffc`）

第三份日志是 `测试无思考` 的续跑，用户说「做好了」，但工作目录实际是空的：

| 事件 | seq | 结果 |
|---|---|---|
| `coach_check(read_file index.html)` | 58→59 | `ok:false`，文件不存在 |
| `coach_check(list_dir 工作目录)` | 65→66 | `ok:true`，**共 0 个条目** |
| `coach_verify` | 72→73 | **不通过**；状态块 76：失败次数 **1**，【核查结论】不通过（seq 73） |
| 用户说「好了」后再查 | 85 | — |
| `coach_check(list_dir)` | 88→89 | `ok:true`，仍是 0 个条目 |
| `coach_verify` | 95→96 | **不通过**；状态块 99：失败次数 **2**，【核查结论】不通过（seq 96） |

阶段：`等待反馈@46 → 核查中@62 → 核查中@69 → 等待反馈@76 → 核查中@92 → 等待反馈@99`，
工具错误 0。

这是本次最有价值的证据：**用户说“做好了”，教练没有判通过**，而是读文件、列目录、两次判
「不通过」并给出具体建议（保存路径/扩展名），失败计数从 0→1→2。F7/R15 的“不轻信用户说完成了”
在实机上成立。

**仍未实机触发**：F1 的“空 sections”分支、F2 的非法 `kind`、F3 的命令白名单；这三条仍只有
单测、冒烟和回放证据。`coach_verify` 判「通过」→ `coach_advance` 的推进路径也还没在这条会话里
走到（档 1 已有实机证据，0.2.5 未改这段）。

**这次暴露的三个行为缺口**（不是 0.2.5 的代码 bug）：

1. 测试1 里教练让用户手动在终端跑 `git --version`，没有调用 `coach_check(kind="command")`。
   默认白名单里明明有这条命令，但状态块**没有列出白名单内容**，`coach_check` 的描述还写着
   “仅当用户在白名单里显式配置过”——模型因此不知道可以直接跑。建议 0.2.6 或 0.3.0 补：
   - 状态块加 `【可跑命令】…`；
   - `coach_check` 描述改成“默认有 7 条只读命令，可直接跑”。
2. 测试2 在用户说“都能打开”后，教练正确地追问了水平和目标（F4 生效），但还没调用
   `coach_plan`，正文却先说“处于正式教学阶段”。建议加一句“计划没被接受前不要宣布进入教学”。
3. 状态块写“别的工具都会被拒绝”，但测试low级思考在 `INIT` 里成功调用了
   `ask_user_question`（两次，用于可用性 + 水平/目标）。实际只拒绝**教练工具**，不拒绝
   只读/交互工具；文案应改成“别的**教练工具**会被拒绝”，否则会误导模型不敢用提问工具。

**进入 0.3.0 的门槛**（建议）：

1. ~~有一轮真实会话从 `INIT` 走到 `WAIT_FEEDBACK`（`coach_plan` 带非空 `sections` 成功）~~
   → **已过**（测试无思考 / 测试low级思考）。
2. ~~至少出现一次 `coach_check` 或 `coach_verify`~~ → **已过**（`check触发`：2 次 check + 2 次 verify）。

**两条都过了，0.3.0 可以开工。** 以下三项作为 0.3.0 期间的回归项，不阻塞开工：
F1 空 `sections`、F2 非法 `kind`、F3 命令白名单；以及 `coach_verify` 判「通过」→ `coach_advance` 的推进路径。
测试1 的“白名单可见性”缺口
不影响 `coach_plan`，但会影响 Q5 B 的实际效果，建议作为 0.2.6 或并进 0.3.0 的提示词改动。

### F5 · 工具链与文档对齐

- `package.json` 的 `scripts.test` 从 `node --test test/` 改为 `node --test --test-isolation=none`（本机 Node 24.21 下前者不可用）。
- README 的用例数、`allowCommands` 默认值、【已知限制】第 2 条同步更新。
- 00/01 的“另一半文档”表加一行指向本文件；不改 11 份阅读顺序的编号。
- 已重打 `_dist/local-coach-mode-0.2.5.tgz`（43.7 KB，无 BOM）；00/01 的历史快照不改写，只追加“0.2.5 起”的说明。

---

## 4. 0.3.0：`RESEARCH` + 检索缓存

### 4.1 状态

`RESEARCH` 是**过渡态**，与 `PLAN` / `NEXT_STEP` 同类：由 `coach_research` 工具在同一次调用内进出，不驻留。理由：它没有“等待用户”的语义；做成驻留态就必须再造一个出口工具，容易出死角。

- 进入：模型调用 `coach_research`。
- 退出：同一调用内检索完成/失败后，回到调用前的阶段（`INIT` / `CHECK_TOOL_AVAILABILITY` / `WAIT_FEEDBACK` / `VERIFY_DONE` / `DEGRADED`）。
- `COMPLETE` 阶段不允许检索。

### 4.2 `coach_research` 工具

```
coach_research({ query, maxResults? })
  → { ok, query, redacted, sources: [{ url, title?, snippet?, publishedAt? }],
      truncated, content, error }
```

- 走宿主 `ctx.web.search({ query, maxResults })`；不 import 宿主包，用 `ctx.get('web')`，取不到就报 `COACH_RESEARCH_NO_WEB`。
- 结果原样记录，不做判断；**检索不等于核查结论**。
- `presentationMeta` 写 `{ coachTool:'coach_research', query, redacted, ok, sources, truncated, content, error }`，折叠时进 `research_cache`。
- 工具返回文本提示模型：引用时必须标【来源】【时效】【可信度】；检索失败要直说“没查到可靠信息”，不许编步骤。

**已复核（2026-10-17）**：host `Service` provider 返回 `web` 服务契约——`ctx.get('web')` 是可选访问
（需要 undefined 检查），`ctx.web` 是硬依赖；`search(request: { query, maxResults? }, signal?)`
返回 `{ sources: [{ url, title?, snippet?, publishedAt? }], truncated, content? }`。
本包用 `ctx.get('web')`，不放 `inject`，所以 `tool-web` 行没挂时插件仍能加载、检索时报
`COACH_RESEARCH_NO_WEB`。preset 内的实机 A8 已随 0.3.0 跑过（`99cf8b64`，见 §4.6）。

### 4.3 `research_cache`

`CoachState` 新增：

```js
research: [{
  query, at,
  redacted,
  ok,
  sources: [{ url, title, snippet, publishedAt }],
  truncated,
  content,
  error
}]
```

- 折叠来源：`coach_research` 的 `tool/result.data.meta`；只吃成功结果（R4）。
- `stateVersion` 升到 **3**。
- 状态块只渲染最近 3 条、每条只显示“查询 → N 个来源”，不塞长 snippet。
- 同一 query 再次检索时，状态块显示“已有缓存”，由模型决定是否复用；v0.3.0 不做自动去重。

### 4.4 脱敏

`coach_research` 在发请求前做**确定性脱敏**：

- 绝对路径（`C:\...`、`/...`、`\\server\...`）→ `<path>`；
- 附件对象 id（长 hex）→ `<attachment>`；
- 邮箱 → `<email>`。

命中时返回 `redacted: true`，工具文本要求模型在正文说明“检索词已脱敏”。语义级 PII（人名、公司名）不在 v0.3.0 的自动范围内；需要保留原文才能检索时，模型必须在正文里征得用户同意——**v0.3.1 起工具没有 `consent` 开关**，脱敏始终执行，避免模型自己“授权自己”。

### 4.5 检索失败

- **v0.3.1 起：失败不改 phase**，只写 `research_cache`（`ok:false`）+ 状态块 `【检索缓存】…失败`。
- 是否降级由模型用 `coach_verify` 判「无法判断」决定；检索失败不等于本步判定失败。
- 工具返回失败文本，明确“没查到可靠来源”；不编造。

### 4.6 验收（A8–A10）

| # | 场景 | 通过标准 |
|---|---|---|
| A8 | 问一个需要查官方文档的工具细节 | 出现 `coach_research` 调用；`tool/result.data.meta` 有 sources；正文有【来源】【时效】【可信度】；状态块有检索缓存 |
| A9 | 检索不到可靠信息 | 明确说“没查到”；不编造步骤；**不自动降级**（0.3.1 起）；需要降级时由 `coach_verify` 判「无法判断」 |
| A10 | 同一问题问两次 | 第二次状态块显示已有缓存；不重复调用或明确说明复用 |

### 0.3.0 实施状态（2026-10-17）

- 已实现：`core/research.js`（脱敏 / 来源归一化 / `applyResearch`）、`tools/coach-research.js`、
  `RESEARCH` 过渡态、`research` 缓存字段、`coach_research` 折叠、状态块【可跑命令】/【检索缓存】。
- 四个文案补丁已收：`【可跑命令】`、`别的**教练工具**`、`coach_plan.sections` 必须性描述、
  “计划没被接受前不要宣布进入正式教学”。
- `stateVersion` 升到 **3**；单测 **82/82**；冒烟 **ALL GOOD**；`node --check` 全部通过；
  `cordis.patch.yml` 用 js-yaml 解析通过（9 行子插件、7 条白名单）；从 profile 导入 `apply,inject,name`。
- 已重打 `_dist/local-coach-mode-0.3.0.tgz`（49.4 KB，无 BOM）。
- 0.3.0 已由用户覆盖安装/重启，并在 `session-99cf8b64` 上跑完 A8–A10。
- 回归项仍包括：F1 空 `sections`、F2 非法 `kind`、`coach_verify` 通过 → `coach_advance`。

### A8–A10 实机复核（`session-99cf8b64`，2026-10-17）

| 用例 | 证据 | 结论 |
|---|---|---|
| **A8** | `coach_research` 67→69，`ok:true`、6 个来源；状态块 72 出现【检索缓存】；正文有【来源】【时效】【可信度】 | **机制通过**；但来源里**没有 git-scm.com 官方原文**，模型明确说“没查到官方原文”、把社区来源和推断分开标注——诚实，但来源质量只算部分 |
| **A10** | 第二次 `coach_research` 84→86；状态块 89 有两条缓存；模型说“缓存里没有官方原文，复用不到新东西”，于是换查询词重查 | **通过（带说明）**：缓存可见、没有重复同一查询；但**不是严格复用**，属于“读缓存后改查询” |
| **A9** | `coach_research` 101→103，`ok:false`、`sources:[]`、`error:"没有查到可靠来源"`；状态块 106 进「降级核查」；正文“查不到，我不会编” | **0.3.0 通过**；但降级是**旁路副作用**。**0.3.1 已复测通过**：见下 |
| **F3 回归** | `coach_check(kind="command", target="git --version")` 29→30 成功，stdout `git version 2.56.0.windows.2` | **通过**：模型真的用了白名单命令，没有让用户手动跑 |
| **计划校验** | 第一次 `coach_plan` 45→46 被拒：`evidence:"path_exists"` 不是合法证据类型；模型改成 `command` 后 51→52 成功 | **通过**：代码里的计划校验有效，模型能自我修正 |

**这次暴露的三个问题**（0.3.1 已按建议处理，详见下）：

1. **`【可跑命令】` 在计划建立前不显示**：状态块 33 还没有【可跑命令】，因为渲染被 `state.toolName` 门控；模型仍猜中了 `git --version`。应把 `allowCommands` 行移到 `setupPhase` 下、不受 `toolName` 限制。
2. **检索失败会旁路降级当前步骤**：A9 的查询与“配置 user.name”这一步无关，但 `applyResearch` 只要“有当前步骤 + 检索失败”就进 `DEGRADED`。模型在正文里解释了“降级不是你的设置坏了、我照样能 coach_check”，但状态块确实变成了「降级核查」。建议改成：检索失败只记录【检索缓存】失败，不改 phase；或给 `coach_research` 加 `stepKey`/`affectsStep`，只有与当前步骤相关时才降级。
3. **`consent` 被模型自行设为 true**：84/101 两次都带 `consent:true`，用户并没有明确同意。当前 `redactQuery` 仍会脱敏，`consent` 只影响提示文案，所以没有实际泄露；但语义不对。建议移除模型可写的 `consent`，或改成工具内部不可由模型设置的标志。

**A9 重测（`session-99d3bbb5`，0.3.1）**：

- `coach_research` 105→107，args **没有 `consent`**，meta `ok:false`、`sources:[]`、
  `error:"没有查到可靠来源"`。
- 状态块 110：`【当前阶段】等待反馈`，有【检索缓存】失败，**没有【降级提示】**；
  正文 112 明确说“检索失败不自动导致当前步骤降级”“【本步失败次数】仍是 0”“查不到就直说，不会编”。
- 阶段轨迹：`… → 等待反馈@101 → 等待反馈@110`，**没有进「降级核查」**。
- 结论：**A9 在 0.3.1 语义下通过**。

注意：这是从 `A8A10` **分支**出来的会话，前 89 个事件沿用了 0.3.0 的旧日志，所以：
- 早期状态块里没有【可跑命令】（那是 0.3.0 的渲染），不能用它判断 0.3.1 的显示修复；
- 84/101 的旧 `coach_research` 仍带 `consent:true`，也是复制过来的 0.3.0 事件；
- 105→107 的新调用没有 `consent`，证明 0.3.1 的工具代码已生效。

**A9 新会话（`session-fcaf00c2`，0.3.1）**：

- 状态块 **10 / 23** 直接出现【可跑命令】7 条（计划建立前）；
- 19→20 `coach_check(kind="command", target="git --version")` 成功，模型没有让用户手动跑；
- 35→36 `coach_plan` → 39 `等待反馈`；
- 48 用户问 ZQX 不存在工具 → 模型用 **`web_search`**（51→54，No results），没有用 `coach_research`；
  正文明确说“不影响当前步骤、不降级”，状态块仍是「等待反馈」；
- 结论：**【可跑命令】修复实机通过**；A9 的“不编造 / 不自动降级”行为通过，
  但这次没覆盖 `coach_research` 失败路径（上一份 A9retest 105→107 已覆盖）。

**另**：A8 的来源质量是搜索 provider 的结果，不是代码 bug；如果要把“官方优先”做实，可以给 `coach_research` 加 `site`/`sourcePreference`，或在人设里要求先 `site:git-scm.com` 这类官方域检索。

### 0.3.1 实施状态（2026-10-17）

- **`【可跑命令】` 前移**：不再被 `state.toolName` 门控；`INIT` / `确认环境` 即使还没 `coach_plan`
  也会显示 7 条白名单。
- **检索失败不再自动降级**：`applyResearch` 失败只写 `research_cache`（`ok:false`），`phase`
  保持原样；是否判「无法判断」/进 `DEGRADED` 由模型用 `coach_verify` 决定。
- **移除模型可写的 `consent`**：`coach_research` 参数、输出 schema、meta 都不再有 `consent`；
  `redactQuery` 始终脱敏，命中时返回 `redacted:true` 并在工具文本里提示。
- `stateVersion` 升到 **4**；单测 **83/83**；冒烟 **ALL GOOD**；`node --check` / YAML 解析 / 文档校验通过。
- `_ref/coach-recheck.cjs`、`coach-accept.cjs`、`coach-evidence.cjs` 的 `COACH_TOOLS` 已补
  `coach_research`，复核不再漏报检索调用。
- 已重打 `_dist/local-coach-mode-0.3.1.tgz`（49.7 KB，无 BOM）；用户已覆盖安装/重启。
- A9 分支重测（`session-99d3bbb5`）通过：`coach_research` 失败后仍是「等待反馈」，没有【降级提示】，新调用无 `consent`。
- A9 新会话（`session-fcaf00c2`）通过：**第 10/23 轮状态块就有【可跑命令】**；19→20 直接跑
  `coach_check(command git --version)`；48 的 ZQX 查询用 `web_search` 返回 No results，模型明确
  “不编造、不影响当前步骤”，状态块仍是「等待反馈」——但没有覆盖 `coach_research` 失败路径
  （分支重测已覆盖）。
- A8/A10 没有在 0.3.1 下重跑；它们的行为未被 0.3.1 改动（除 `consent` 移除）。
- **0.3.1 验收通过**，可以进 0.3.2。

---

## 6. 0.3.2：`INSTALL_TOOL` 独立相位

- `coach_plan(toolAvailable="no")` 且计划非空 → `acceptPlan` 落到 `INSTALL_TOOL`（代替 `WAIT_FEEDBACK`）。
- `INSTALL_TOOL` 允许 `coach_check` / `coach_verify` / `coach_advance` / `coach_skip` / `coach_research`，语义与 `WAIT_FEEDBACK` 相同，只是状态块显示【安装分支】。
- 核查不通过：`failedAttempts +1`，但**留在 `INSTALL_TOOL`**，不能掉回 `WAIT_FEEDBACK`。
- 最后一步 `coach_advance` → `restoreOriginalGoal()`：`goalMode` 回 `learn`、`currentGoal` 回 `originalGoal`、`plan=[]`、进 `PLAN`，等待为原目标重新拆计划。
- 不新增工具；入口和出口都是现有工具。
- `stateVersion` 升到 **5**。

**验收 A12**：工具未安装 → 计划落到 `INSTALL_TOOL`；装好后走完最后一步 → 回到 `PLAN` 且 `originalGoal` 未丢（A6 回归）。

### 0.3.2 实施状态（2026-10-17）

- `acceptPlan`：`toolAvailable === false` + 非空计划 → `INSTALL_TOOL`；`true` → `WAIT_FEEDBACK`；`null` → `CHECK`。
- `INSTALL_TOOL` 已加入 `check` / `verify` / `skip` / `research` 的允许阶段；`bumpFailedAttempts` 在
  `INSTALL_TOOL` 时保留原 phase；`restoreOriginalGoal` 路径不变。
- `stateVersion` 升到 **5**；单测 **84/84**；冒烟 **ALL GOOD**（含 install 分支 plan → verify → advance → PLAN）。
- 已重打 `_dist/local-coach-mode-0.3.2.tgz`（50.2 KB，无 BOM）；用户已覆盖安装/重启。

### A12 实机复核（`session-755a0295`，2026-10-17）

| 事件 | seq | 结果 |
|---|---|---|
| `coach_plan(toolAvailable="no")` | 60→61 | 落 `INSTALL_TOOL`，3 步安装确认；`originalGoal` 保存 |
| `coach_check(path_exists blender.exe)` | 76→77 | 存在（112,975,320 字节） |
| `coach_verify` 通过 + `coach_advance` | 83→84 / 90→91 | 进入第 2 步 |
| `coach_check(list_dir D:\Blender\5.2)` | 106→107 | 成功 |
| `coach_verify` 通过 + `coach_advance` | 113→114 / 120→121 | 进入第 3 步 |
| 截图 `coach_verify` 通过 + `coach_advance` | 136→137 / 143→144 | 安装分支收尾 |
| 重新 `coach_plan(originalGoal)` | 150→151 | 回到 `PLAN`，原目标保留；154 等待反馈 |

**A12 机制通过**：进入 `INSTALL_TOOL`、逐步核查、最后一步恢复 `originalGoal` 并重新拆计划，
全部按预期走完。

**但这里有一个真实的 UX 问题（“顽固的安装检测”）**：

- 模型在 53→54 已经发现 `D:\Blender` 里有 `blender.exe`，却在 60 仍然提交
  `toolAvailable:"no"` / `goalMode:"install"`，把“已经装好”的用户继续按“安装确认”流程走。
- 用户在 73 明确说“我已经装好了，能不能直接让我开始学”，模型仍完成了 3 个安装确认步骤
  （可执行文件、5.2 目录、启动截图），到 143 才结束安装分支。
- 根因有两层：
  1. **模型层**：把用户最初“我还没装”当成固定事实，没有把后来 `coach_check` 找到的
     `blender.exe` 转成 `toolAvailable:"yes"`；
  2. **状态机层**：`coach_plan` 一旦接受就不能改写，`INSTALL_TOOL` 没有“工具已经可用 →
     立刻切回学习分支”的出口；只能把 3 步走完或逐步 `coach_skip`。
- 建议（**不阻塞 0.3.3**，作为 0.3.4 或 0.3.3 的小修）：
  - 人设/状态块加一句：“如果 `coach_check` 已找到可执行文件，或用户说已经装好并能打开，
    `toolAvailable` 必须填 `yes`，直接走学习分支；不要为了‘安装确认’再建安装计划。”
  - 更彻底：给 `INSTALL_TOOL` 一个受控出口，例如 `coach_plan` 在 `INSTALL_TOOL` 阶段允许
    用 `goalMode:"learn"` 重新提交（保留 `originalGoal`，清空安装计划）；或新增
    `coach_available` / `coach_replan` 工具。这样用户说“已经装好”时可以一跳回学习分支，
    不用走完 3 步。

**结论**：0.3.2 的 `INSTALL_TOOL` 状态机是正确的；需要修的是“可用性判断”和“已装好后的早退”，
不是状态机相位本身。

---

## 7. 0.3.3：安装体验小修（受控早退 A，2026-10-17 拍板）

### 7.1 问题

A12（`session-755a0295`）机制通过，但暴露“顽固的安装检测”：模型在 53→54 已经发现
`D:\Blender\blender.exe`，60 仍以 `toolAvailable:"no"` 建安装计划；用户 73 说“我已经装好了，
能不能直接让我开始学”，模型仍走完 3 步安装确认（76/83/90、106/113/120、136/143）才回到原目标。

根因两层：

1. **模型层**：把最初“我还没装”当成固定事实，没有把后来 `coach_check` 找到的证据转成 `toolAvailable:"yes"`；
2. **状态机层**：`coach_plan` 一旦受理就不能改写，`INSTALL_TOOL` 没有“工具已经可用 → 立刻切回学习分支”的出口。

### 7.2 方案 A：`INSTALL_TOOL` 里的受控早退

不新增工具；入口仍是 `coach_plan`，但**只在安装分支里**放开一条受控通道。

安装分支的判据是 **`goalMode === 'install'` 且有非空计划**——不是 `phase === 'INSTALL_TOOL'`。
原因有两个，都在写测试时暴露：

1. 0.3.2 的 `advanceStep` 在安装计划推进到第 2 步时会掉回 `WAIT_FEEDBACK`（本版一并修正为保持 `INSTALL_TOOL`），
   如果早退只看相位，A12 那种“3 步安装里的第 2 步”就没有早退入口；
2. 旧会话折叠出来可能是“安装分支 + 等待反馈”；用 `goalMode` 判断，旧日志不需要重写。

规则：

- `coach_plan(toolAvailable:"yes", sections:[…])` 在安装分支里 → 视为“工具已可用”：
  - 退出安装分支：`goalMode='learn'`、`currentGoal=originalGoal`、清空安装计划；
  - **清空上一份计划的步骤级证据**（`checks` 里除 `env` 外的记录、`verifications`、`skips`、`pendingNoInfoAt`）。
    否则旧安装步骤的 `0:0` 结论会被新学习计划的 `0:0` 误用，`coach_verify` 可能凭旧截图判通过；
  - `originalGoal` 保留（参数没给就沿用状态里的）；`currentGoal` 固定回到 `originalGoal`；
  - 提交了非空 `sections` → 直接 `WAIT_FEEDBACK`，`planAcceptedAt` = 本次结果 `seq`；
  - `sections` 留空 → 回到 `PLAN` 等模型补学习计划（不接空计划）。
- `coach_plan(toolAvailable:"no"/"unknown")` 在安装分支里 → 拒绝（`COACH_PLAN_INSTALL_EXIT`），
  继续走安装计划；不能用“重新提交”把安装分支洗成学习分支。
- 学习分支（`goalMode='learn'`）的 `WAIT_FEEDBACK` / `VERIFY_DONE` / `DEGRADED` / `COMPLETE`
  **保持原样**：计划已受理后仍不能改写（`COACH_PHASE`）。`beginPlan` 的允许阶段不扩大，
  早退是 `applyPlan` 里的独立分支。
- `advanceStep` 推进安装计划时保持 `INSTALL_TOOL`；`bumpFailedAttempts` 也按 `goalMode` 判断
  （0.3.2 在推进后会掉回 `WAIT_FEEDBACK`，状态块把安装阶段误显示成「等待反馈」）。
- 安装分支正常走完（最后一步 `coach_advance`）仍走 `restoreOriginalGoal()`，但它现在**也清空步骤级证据**
  ——与早退对齐，避免同一个误用。
- `stateVersion` 升到 **6**（折叠语义变了）。

不放松任何核查前置条件：`coach_check` / `coach_verify` 的阶段与证据规则不动。

### 7.3 提示词层（必做，成本最低）

`cordis.patch.yml` 的 persona 补三条：

1. 可用性只看证据：`coach_check` 已找到可执行文件/安装目录、用户明确说能打开并使用、或用户说已经装好
   ——任一成立，`toolAvailable` 必须填 `yes`，直接走学习分支；不要因为最初说过“没装”就继续安装分支。
2. 环境核查只查与当前工具相关的路径/命令；不要跑无关的白名单命令（A12 查 Blender 时跑了 `git --version`）。
3. 用户说“已经装好了，直接开始学”时：如果还在安装分支，立刻用
   `coach_plan(toolAvailable:"yes", goalMode:"learn", originalGoal=原目标, sections=学习计划)` 早退；
   不要继续安装确认，也不要再走完剩余安装步骤。

### 7.4 状态块（`core/render.js`）

- `INIT` / `确认环境` 的【下一步】补：可用性只认那三类证据；环境核查只查当前工具相关项。
- `INSTALL_TOOL` 的步骤块新增**【安装分支·可早退】**：工具其实可用时直接重新提交学习计划，
  插件会清空安装计划、保留原目标。

### 7.5 验收（A12 重测）

| # | 场景 | 通过标准 |
|---|---|---|
| A12-a | 新会话，用户先说“还没装”，随后提供已安装路径 | `coach_check` 找到 `blender.exe` 后，`coach_plan` 的 `toolAvailable` 是 `yes`；不再建 3 步安装计划 |
| A12-b | 已经进入 `INSTALL_TOOL`，用户说“我已经装好了，直接学” | 一次 `coach_plan`（早退）回到学习分支；状态块不再有【安装分支】；不再产生剩余安装步骤的核查调用 |
| A12-c | 早退后 | `originalGoal` 仍在；新计划从 `sectionIndex=0 / stepIndex=0` 开始；旧安装步骤的【核查结论】不再显示 |
| A12-d | 反向：早退时把 `toolAvailable` 报成 `no` / `unknown` | 被拒（`COACH_PLAN_INSTALL_EXIT`），仍在 `INSTALL_TOOL`，安装计划还在 |

回归：单测全绿、冒烟 ALL GOOD、A6（安装分支正常走完恢复原目标）不退化、A1–A7 不退化。

### 7.6 0.3.3 实施状态（2026-10-17）

- **代码**：`core/machine.js` 新增 `isInstallBranch` / `exitInstallBranch` / `resetPlanScope`，
  `advanceStep` 与 `bumpFailedAttempts` 改按 `goalMode` 保持 `INSTALL_TOOL`；
  `core/plan.js` 新增 `applyPlanInInstallBranch`（`COACH_PLAN_INSTALL_EXIT`）；
  `planPayloadFromCall` 接收当时状态，早退调用省略 `originalGoal` 也能重折叠；
  `tools/coach-plan.js` 增加 `exitedInstallBranch` / `originalGoal` 输出与早退文案；
  `core/render.js` 增加【可用性判断】、【安装分支·可早退】。
- **提示词**：`cordis.patch.yml` 补三条（可用性三类证据、环境核查范围、已装好立刻早退），
  并在 coach_plan 的工具说明里写明 v0.3.3 例外。
- **测试**：单测 **93/93**；装配冒烟 **ALL GOOD**（新增早退 6 项）；`node --check` 全部通过；
  从 profile 导入 `apply,inject,name`；`plugin_manager list_bundles` 显示 `@local/coach-mode` **0.3.3**。
- **回放**：`_verify-20261017\A12` 在新折叠语义下重跑，安装分支推进后相位保持 `INSTALL_TOOL`
  （seq 94 / 124），收尾回 `PLAN`（147）、重新拆计划后 `WAIT_FEEDBACK`（154），无崩溃。
- **产物**：`_dist\local-coach-mode-0.3.3.tgz`（52.8 KB，无 BOM）；
  回退点 `_backup-0.3.2-20261017`。
- **待办**：A12-d（反向）实机触发；0.3.4 `coach_back`。
- **部署说明**：profile 是 `link:`，`install_bundle` 返回 `already-installed` 属正常；
  改的是链接目录里的文件，**重启 DSH 即可加载新模块与新声明**，不需要 remove/reinstall。

### 7.7 A12 重测实机结果（2026-10-17）

> 环境：DSH 0.2.1-rc.1 / bundle 0.3.3 / 重启后新建会话；日志副本在 `_verify-20261017\A12-0.3.3\`。

| 用例 | 会话 | 证据 | 结论 |
|---|---|---|---|
| A12-a | `session-0520a336` | 状态块 11/26/37/53/60 都有【可用性判断】；20→34 查常见路径都没找到；49→50 `D:\Blender` 存在、56→57 列出 28 项（含 `5.2/`、`blender.exe`）；62 判「已装好，不走安装分支」；用户 70 补「从未用过 + 想做小桌子」；**73→74 `coach_plan(toolAvailable:"yes", goalMode:"learn", originalGoal:"学会用 Blender 做基础建模", 4 板块/7 步)` 成功**；77 状态块「等待反馈」、无【安装分支】、第 1/4 板块第 1/2 步 | **通过**：可用性判断正确、没有安装计划，学习计划直接受理 |
| A12-b（第一次） | `session-9856a0f8` | 28→29 `coach_plan(no)` 落 `INSTALL_TOOL@32`；44→45 找到 `blender.exe`；51→52 却用 `coach_verify` 判「通过」→ `NEXT_STEP@55`；57 尝试早退的 `coach_plan` 时宿主报 `MALFORMED_RESPONSE`（`tool input is invalid JSON`） | **未按早退走**：模型先把安装第 1 步判通过；早退调用被 provider 流式 JSON 错误中断（非插件缺陷） |
| A12-b（重试分支） | `session-05eeb432` | 28→29 落 `INSTALL_TOOL@32`，状态块 97/165 有【安装分支·可早退】；47→48 找到 `blender.exe`；54→55 `coach_plan(toolAvailable:"yes", goalMode:"learn", originalGoal:"学 Blender 基础建模", sections 4 步)` 成功；58 状态块「等待反馈」、无【安装分支】、无【核查结论】、新计划从 `0:0` 开始，学习目标仍是「学 Blender 基础建模」（模型在早退时把安装分支里的「学 Blender（装好后回到正式学习）」细化了，按 §7.2 允许） | **通过（A12-b / A12-c）**：一次受控早退，旧安装计划与证据不残留 |
| A12-d（反向） | 无实机会话 | 单测 + 冒烟：`no`/`unknown` → `COACH_PLAN_INSTALL_EXIT`，仍在安装分支 | **仅代码级通过**，未实机触发 |

**观察 1（第一次 A12-b）**：用户明确说“已经装好了”，模型仍先把安装第 1 步判「通过」——
用 `blender.exe` 的存在去满足“Downloads 里有 .msi”的合格标准，而不是直接早退。
这不是状态机错误（证据链成立、判定已落盘），是“合格标准漂移”的模型行为；
早退入口在状态块里（97/165），重试分支立刻用了它。若以后高频出现，应把
“已装好 → 不要再判安装步骤”写成更强的前置提示，而不是继续放松核查。

**观察 2（provider 错误）**：`9856a0f8` 的 seq 59 `turn/end` 是 `MALFORMED_RESPONSE`
（tool-call 参数不是合法 JSON）。该轮没有 `tool/result`，状态未推进；重试分支重新走通。
参数本身只有 1275 字符，不是“计划太长”，属于流式响应偶发，插件侧无需处理。

---

## 8. 0.3.4：`coach_back`（只做同会话，Q4 A）

```
coach_back({ stepKey? , sectionIndex?, stepIndex?, reason? })
```

- 允许阶段：`WAIT_FEEDBACK` / `VERIFY_DONE` / `DEGRADED` / `COMPLETE`；`INIT` / `CHECK_TOOL_AVAILABILITY` / `PLAN` 拒绝。
- 目标必须存在于当前计划里；省略 `stepKey` 时回退到上一步。
- 追加 `backs: [{ stepKey, at, reason }]`，**不改写历史**；`stateVersion` 升到 **7**。
- 回到目标步骤后：
  - `phase = WAIT_FEEDBACK`，`sectionIndex/stepIndex` 指向目标；
  - 目标步骤在本次 `back` 之后的旧 `verification` / `skip` **不再算数**（`hasPassedOrSkipped` 要求“通过/跳过记录的 seq > 最近一次 back 的 seq”），必须重新 `coach_check` + `coach_verify` 或重新 `coach_skip`；
  - `failedAttempts` 保留，供阈值参考。
- 跨会话不接：换会话重新开始，或用户手动粘贴摘要。

**验收 A11**：从第 3 步回退到第 2 步；`coach_advance` 在重新核查前被拒；重新 `coach_verify` 通过后可继续。

### 8.1 0.3.4 实施状态（2026-10-17）

- `core/back.js`：`resolveBackTarget`（`stepKey` / `sectionIndex+stepIndex` / 省略=上一步；
  目标必须**早于**当前步骤，不能借回退往前跳）、`applyBack`（只追加 `backs`，不改写历史）。
- **旧 `checks` 也失效**：§8 原文只写 `verification` / `skip`；实现把 `checks` 纳入同一口径——
  否则回退后 `evidence: file|command` 的步骤能拿回退前的 `coach_check` 直接判通过，等于绕过“必须重新核查”。
  `core/machine.js` 的 `effectiveSinceBack` 统一过滤 `checks` / `verifications` / `skips`；
  `hasPassedOrSkipped`、`applyVerify`、状态块的【核查证据】【核查结论】【跳过提醒】都用这个口径。
- 状态块新增【回退记录】；回退后旧结论显示「回退后旧结论已作废」，不再显示成「通过」。
- 新工具 `coach_back`（第 7 个，D6 常驻）；`COACH_TOOLS`、`index.js`、`_ref/coach-recheck|accept|evidence.cjs`
  已同步。
- `stateVersion` **7**；单测 **110/110**；冒烟 **ALL GOOD**（新增回退 5 项）；`node --check` 全部通过。
- 产物 `_dist/local-coach-mode-0.3.4.tgz`（57.3 KB，无 BOM）；A11 实机已通过（§8.3）。

### 8.2 0.3.4 实机事故与修复（2026-10-17）

- **现象**：新会话第一轮即失败：`session event "request/header" carries non-JSON-serializable data`
  （`session-e23b0027-1fdd-4137-84f2-fc6648a60f3e`，seq 11 `turn/end`；`request/header` 没有落盘）。
- **根因**：`tools/coach-back.js` 的 `defineTool({...})` 漏了 `description`，注册出来的定义里
  `description: undefined`。宿主写 `request/header` 前会对 `header.tools` 做无损 JSON 快照
  （`snapshotJsonValue` 拒绝任何 `undefined`），于是整轮请求硬失败。状态机、折叠、schema 都没参与。
- **修复**：补 `description: DESCRIPTION`。
- **回归**：新增 `test/tool-shape.test.js`——七个工具都必须有非空 `name` / `description`，
  `parameters` 与 `output.schema` 必须是无损 JSON（plain object、无 undefined/function、数组无空槽）；
  冒烟脚本也加了同一断言。单测 109 → **110**。
- **教训**：宿主对“模型可见的工具定义”有比 `JSON.stringify` 更严的规则；`undefined` 不是“省略”，
  是硬失败。新增工具时必须跑 `tool-shape` 测试与冒烟，不能只看 `node --check`。

### 8.3 A11 实机结果（2026-10-17，通过）

- 环境：修完 `description` 后重启；会话 `session-966958cf-980e-4c79-97ea-e3644f9cd803`。
- `request/header` seq 10 有 **19 个工具**、含 `coach_back`；全程 `turn/end` 错误 **0**——事故修复确认。
- 计划 57→58 落 `WAIT_FEEDBACK@61`；第 1 步核查 73→74 通过；80→81 进入第 2 步（`WAIT_FEEDBACK@84`）。
- 用户 93 要求回退；96→97 `coach_back({stepKey:"0:0", reason:…})` 成功。
  （本次计划只有 2 步，实际是「第 2 步 → 第 1 步」；与 SPEC 原文「第 3 步 → 第 2 步」是同一机制。）
- seq 100 状态块：【核查结论】回退后旧结论已作废（最近一次回退 seq 97）；【回退记录】…；
  【核查证据】显示“尚未采集”。
- 102 模型重新讲第 1 步并等反馈——**没有**继续引用旧结论。
- 109 用户给出五区描述；**112→113 `coach_verify` 重判通过**；**119→120 `coach_advance` 回到第 2 步**；
  123 状态块：第 2/2 步、【核查结论】尚无结论（不残留第 1 步的通过）。
- **通过**：回退 → 旧结论失效 → 重新取证 → 重判通过 → 继续推进，A11 全链路实机闭合。
- “重核前 `coach_advance` 被拒”没有被模型触发（它先 verify 再 advance），由单测/冒烟覆盖（`COACH_PHASE`）。

---

## 9. 设计约束（继续有效）

- `core/` 零宿主 import、零 IO / 时间 / 随机；所有 `at` 由调用方传。
- 整包禁止 `import '@deepseek-ai/*'`；插件行名在 YAML 里不受影响（R9）。
- 只有成功的工具结果推进状态（R4）；失败调用只留错误，不进 `checks` / `verifications` / `research`。
- 状态字段或折叠语义变化必须升 `stateVersion`。
- 判定必须落盘：正文里的【核查结果】不算，必须 `coach_verify`。
- 不代做：`write` / `edit` 继续 guard；`pwsh` / `bash` 本阶段仍不守卫（0.4 再议）。

---

## 10. 风险与待复核

| 风险 | 处理 |
|---|---|
| `ctx.web` 在 preset 作用域内不可用 | 先 `ctx.get('web')` 探测；不可用就报 `COACH_RESEARCH_NO_WEB`，不假装检索成功 |
| `coach_research` 被 `web_search` 绕过 | 人设/状态块引导；v0.3.0 不强制移除 `web_search`，先看行为，再决定是否 `restrict` |
| 检索脱敏误伤（路径片段是必要信息） | 返回 `redacted: true`，让模型在正文说明；需要原文时由模型征得用户同意，工具始终脱敏 |
| `coach_back` 后旧结论被误用 | 用 `back.at` 与 `verification.at` / `skip.at` 比序；单测覆盖 |
| 0.3.3 早退后旧安装步骤的 `0:0` 证据被新学习计划误用 | 早退与 `restoreOriginalGoal` 都清空步骤级证据（保留 `env`）；单测覆盖 |
| 早退把“还没装好”洗成学习分支 | 只放行 `toolAvailable:"yes"`；`no` / `unknown` 报 `COACH_PLAN_INSTALL_EXIT` |
| `stateVersion` 频繁升位 | 每次升位只影响进程内缓存；日志可重折，成本可接受 |
| 0.2.5 的 `applyPlan` 改动影响旧日志回放 | 已按“折叠语义变化”升到 2；回放脚本只用于验证，不改历史 |

---

## 11. 验收总表

| 范围 | 用例 | 证据 |
|---|---|---|
| 0.2.5 | F1 / F2 / F3 单测 + 冒烟；`77495b5d` 回放；`kind:"none"` 拒绝 | 单测输出、冒烟 ALL GOOD、回放状态块 |
| 0.3.0 | A8 / A9 / A10 | 会话 id + `seq` + `tool/result.data.meta` |
| 0.3.1 | A9 分支复测 + 【可跑命令】前移 | `99d3bbb5` / `fcaf00c2` |
| 0.3.2 | A12（安装分支进入/退出）+ A6 回归 | `755a0295` |
| 0.3.3 | A12-a ~ A12-c（已装好不再走 3 步、受控早退、旧结论不残留）；A12-d 仅代码级 | `0520a336` / `05eeb432`；§7.7 |
| 0.3.4 | A11（回退 → 重新核查 → 继续） | `session-966958cf`（§8.3） |
| 0.4.0 | A13（摘要、暂停、重开同会话、恢复、安装分支暂停） | `42139899` / `85453caa`（§12.7） |
| 0.4.1 | A14（支撑等级升降、提示详细度） | 单测 + 抽样会话（人工核对） |
| 0.4.2 | A15（检索上限、状态块预算、用量） | 单测/冒烟 + 实机会话 id + `seq` |
| 全程 | A1–A7、A7 的 12 条 | 同上；A7 清单以 05 §9 为准 |

> 验收不接受“应该可以”；每条都要能指到会话日志里的 `seq`，或单测/冒烟里的可复现断言。

---

## 12. 0.4.0：会话连续性（摘要 + 暂停/恢复）

> **状态**：开工中。用户 2026-10-18 拍板：摘要与暂停/恢复合并为 0.4.0；暂停用**一个**工具
> `coach_pause`（`action: pause | resume`）；先做“确定性进度摘要 + 暂停备注”，
> 如果实机不够再补“学习笔记”工具。

### 12.1 目标

1. 长会话随时能看清“总共几步、做完几步、跳过几步、还剩几步”。
2. 用户说“先停一下 / 今天到这 / 晚点继续”时，有一个**明确的暂停点**；暂停期间模型不再继续讲课。
3. 关闭后重开**同一个会话**仍是暂停状态；`resume` 回到原步骤/原阶段，**不作废旧证据**。
4. 不做跨会话：换新会话重新开始（Q4 A 不变）。

### 12.2 状态与工具

- 新驻留相位 `PAUSED`（第 11 个相位）。
- `CoachState` 新增 `pauses: [{ at, fromPhase, stepKey, note, resumedAt }]`。
- 新工具 `coach_pause`（第 8 个，D6 常驻）：
  - `pause`：允许 `INIT` / `CHECK_TOOL_AVAILABILITY` / `INSTALL_TOOL` / `WAIT_FEEDBACK` / `VERIFY_DONE` / `DEGRADED`；
    记录 `fromPhase`、当前 `stepKey`、`note`，进入 `PAUSED`。
  - `resume`：只允许 `PAUSED`；找最近一条 `resumedAt === null` 的暂停，回到 `fromPhase`，写入 `resumedAt`。
  - 其他阶段调用返回明确错误；`PLAN` / `COMPLETE` 不允许暂停。
- `PAUSED` 期间除 `coach_pause(resume)` 外，所有教练工具拒绝；`coach_plan` 的安装分支早退也必须先 `resume`
  （`isInstallBranch` 在 `PAUSED` 时不放行）。
- `applyUserFeedback` 在 `PAUSED` 不累计失败次数。
- `stateVersion` 升到 **8**。

### 12.3 进度摘要

`core/summary.js` 的纯函数 `progressSummary(state)`：

```
【进度摘要】已完成 3/7 步（其中跳过 1，剩余 3）；当前第 2/4 板块；本步失败 0；检索 2 次
```

- “完成”只认最近一次回退之后的有效「通过」；跳过同理；两者按 `stepKey` 去重。
- 没有计划时不显示；`COMPLETE` 显示“全部 N 步完成（跳过 S）”。
- 暂停块也显示；不新增工具、不新增事件类型。

### 12.4 状态块

- 正常步骤块在【当前步骤】之后加 `【进度摘要】`。
- `PAUSED` 块只显示：当前阶段、暂停位置、暂停备注、进度摘要、位置关系，以及
  “说「继续」后调用 `coach_pause({action:"resume"})`”；**不显示【请执行】/【合格标准】/【核查结论】**。
- 恢复后回到正常块；工具结果回显一次暂停备注。

### 12.5 验收 A13

| # | 场景 | 通过标准 |
|---|---|---|
| A13-a | 等待反馈时暂停 | 进 `PAUSED`；`coach_verify` / `coach_advance` / `coach_back` 被拒；重复 pause 被拒 |
| A13-b | 关闭 DSH 后重开同一会话 | 折叠后仍是 `PAUSED`；`resume` 回到原步骤/阶段；旧证据仍在，可继续 `coach_verify` |
| A13-c | 安装分支里暂停 | `resume` 后仍是 `INSTALL_TOOL`，`originalGoal` / 安装计划不丢 |
| A13-d | 摘要计数 | 有跳过、有回退时，完成/剩余/失败数字与状态一致 |
| A13-e | 暂停备注 | 暂停块显示备注；恢复后不残留成当前步骤内容 |

回归：A1–A12 不退化；单测/冒烟全绿；`stateVersion` 8。

### 12.6 0.4.0 实施状态（2026-10-18）

- `core/pause.js`：`PAUSE_ALLOWED_PHASES`、`openPause`、`applyPause`（pause/resume、备注截断 200 字）；
  `core/summary.js`：`progressStats` / `progressSummary`（按 `effectiveSinceBack` 去重计数）。
- `core/machine.js`：新增 `PAUSED`、`pauses`、`stateVersion` 8；`COACH_TOOLS` 加 `coach_pause`。
- `tools/coach-pause.js`：第 8 个工具；`presentationMeta` 写 `action/fromPhase/stepKey/note`，折叠可回放。
- `core/render.js`：正常步骤块加【进度摘要】；`PAUSED` 块只显示暂停位置/备注/摘要；`COMPLETE` 也带摘要。
- `core/plan.js`：`PAUSED` 时禁止安装分支早退，必须先 resume。
- 人设补 `coach_pause` 说明，阈值出口里的“暂停”明确指向该工具。
- 单测 **132/132**；冒烟 **ALL GOOD**（新增暂停/恢复 4 项）；`node --check` / 文档校验通过。
- `_dist/local-coach-mode-0.4.0.tgz`（61.6 KB，无 BOM）已重打；A13 实机已通过（§12.7）。

### 12.7 A13 实机结果（2026-10-18，通过）

| 用例 | 会话 | 证据 | 结论 |
|---|---|---|---|
| A13-a | `42139899` | 45→46 暂停；49 状态块【已暂停】+【暂停位置】+【进度摘要】，无【请执行】 | 暂停块正确；**“其它工具被拒”没有被模型触发**，由单测/冒烟覆盖 |
| A13-b | `42139899` | 109→110 第二次暂停；113 / 124 两块都是「已暂停」；`request/header` 125 `reason:"resume"`（重启后）；128→129 resume；132 回到等待反馈第 2 步 | **通过**：重开同一会话仍是暂停；恢复回到原步骤；第 1 步的完成状态（1/2）保留 |
| A13-c | `85453caa` | 52→53 从 `INSTALL_TOOL` 暂停；68→69 resume；72 状态块仍是「安装工具」；折叠后 `goalMode=install`、`originalGoal=学会使用 Photoshop`、计划 1 步 | **通过**：安装分支不丢 |
| A13-d | `42139899` | 块 33/65 摘要 0/2；块 90/97 摘要 1/2；块 113/124 摘要 1/2 | **通过** |
| A13-e | 两个会话 | 暂停块显示备注（存 105 / 153 字，渲染按 80 字截断）；恢复后不残留成当前步骤内容 | **通过** |

- 两个会话的 `turn/end` 错误均为 **0**；`request/header` 125 的 `resume` 证明是重启后重新打开同一会话。
- 结论：**A13 通过**（A13-a 的工具拒绝路径为单测/冒烟级）。

---

## 13. 0.4.1：脚手架递减（已落地，2026-10-18）

### 13.1 目标

按学习者的实际表现调整【请执行】的详细程度，但不放松任何核查标准。

### 13.2 支撑等级

| 等级 | 名称 | 【请执行】 |
|---|---|---|
| 3 | 手把手 | 具体菜单、按钮、快捷键，按顺序点 |
| 2 | 给要点 | 目标 + 关键操作；具体位置用户自己找 |
| 1 | 放手 | 只给目标、约束、合格标准；操作由用户规划 |

初始：从未用过 = 3，会基础 = 2，熟练想进阶 = 1，未知 = 2。

按板块结算：

- 上一板块**至少 2 步**且全部“一次过”（无失败、无跳过、无回退）→ 降一级（最低 1）。
- 上一板块有跳过/回退，或有步骤失败 ≥2 次 → 升一级（最高 3）。
- 板块内当前步骤失败到 2 次 → 立即升一级，本板块内不再降。

只读现有状态（`userLevel` / `verifications` / `skips` / `backs` / `failedAttempts`），
不新增工具、不新增相位、不改折叠语义，`stateVersion` 保持 8。

### 13.3 状态块与提示词

- 状态块加 `【支撑等级】2（给要点）：只给关键操作和目标；核查标准不变`。
- 人设增加“按支撑等级调整【请执行】的详细度；等级降低不等于放松核查”。
- 固定格式、证据要求、`coach_verify` 四条前置不变。

### 13.4 验收 A14

- 单测：初始映射、整板块一次过降级、失败/跳过/回退升级、板块内只升不降、上下限。
- 实机：熟练用户连续过 3 步后等级降为 1；抽 3 步检查【请执行】不再逐键指路。
- 回归：核查前置与推进闸门完全不变。

### 13.5 0.4.1 实施状态（2026-10-18）

- `core/support.js`：`supportLevel(state)` 纯函数，返回 `{ level, name, guidance, reason, initialLevel, settled }`；
  常量 `SUPPORT_DEMOTE_MIN_STEPS = 2`、`SUPPORT_ESCALATE_FAILURES = 2`、`MIN/MAX_SUPPORT_LEVEL`。
  **结算口径落在代码注释里，比 §13.2 的文字更明确**：
  - **按“从第 0 个板块起连续处理完的前缀”结算，与当前停在哪一步无关。** §13.2 写的是“上一板块”，
    但 `coach_back` 会让 `sectionIndex` 倒退；若按“当前板块之前”结算，回退会把已经挣到的降级抹掉。
  - “处理完”= 每步**曾经**通过或被跳过（原始记录，不按 `effectiveSinceBack` 过滤）；
    “一次过”才用严格判据（每步只有一条通过结论、`failedAttempts === 0`、无跳过、无回退目标）。
  - 当前步失败 ≥2 次 → 立即 +1；降级只发生在已处理完的板块，所以“板块内不再降”自动成立。
- `core/render.js`：正常步骤块在【进度摘要】之后、【请执行】之前加 `【支撑等级】` 一行；
  `PAUSED` 块**不加**（§12.4 已固定该块只显示暂停位置/备注/摘要）。
- `cordis.patch.yml`：人设新增【支撑等级】段（16 空格缩进、在 `prefix` 块内、三处固定格式的空行未动）：
  3/2/1 各讲多细 + “等级降低不等于放松核查”+“拿不准按 2”。
- `test/support.test.js`：9 条（初始映射、无计划、整板块降级、单步板块不降、跳过升级、
  回退升级且不抹掉降级、失败 2 次立即升级、上下限、状态块字段）。
- `_ref/smoke-coach.mjs`：新增 `7) 支撑等级` 3 项断言（2 → 1 降级 + 状态块；失败 2 次 → 3）。
- 单测 **142/142**、冒烟 **ALL GOOD**、`node --check` 全过；`stateVersion` **保持 8**、工具 **8**、相位 **11**。
- `_dist/local-coach-mode-0.4.1.tgz` 已重打（无 BOM）。
- **A14 已通过**（两轮，2026-10-18）：a / b / c / e 有实机证据；d 用“门槛文件哈希 + 拒绝通道”结构证明。
  结果见 §13.7 / §13.8，证据副本在 `_verify-20261018\A14-0.4.1\`。

### 13.6 A14 验收表

| # | 场景 | 通过标准 | 状态 |
|---|---|---|---|
| A14-a | 会基础（初始 2）整板块 ≥2 步一次过 | 进入下一板块时等级 2 → 1，依据写“降 1”，正文的【请执行】不再逐键指路 | ✅ 通过（`62782ef5` seq 93；反向 `49c77184` seq 77 的 3→2） |
| A14-b | 当前步失败 2 次 | 等级立即 +1；失败 1 次不升、超过 2 次不再升 | ✅ 通过（`38ae3b7b` seq 111/121/135；跳过升级见 §13.8） |
| A14-c | 有回退 | 等级 +1，且不因回退回弹到初始值 | ✅ 通过（`38ae3b7b` seq 154→158） |
| A14-d | 回归 | `coach_verify` 四条前置、`coach_advance` 闸门仍拒绝非法调用 | ✅ 通过（结构证明：15 个门槛/折叠文件与 0.4.0 哈希相同；实机另证拒绝通道正常） |
| A14-e | 等级 3 与低等级正文对比 | 等级 3 明显更手把手 | ✅ 通过（`49c77184` seq 34 vs `62782ef5` seq 36/102） |

> **软约束的诚实边界**：等级只改人设里的“讲多细”，【请执行】在状态块里仍是计划原文。
> 所以 A14-a / A14-e 必须抽查**真实回复正文**，不能只看状态块。
> 而且正文的“下限”由【合格标准】决定：标准本身写得越具体，等级 1 也压不下去。
> 若发现模型照抄细节，下一刀是在状态块里把等级写成“不得照抄上面的细节”的硬指令，而不是放松核查。

### 13.7 A14 第一轮实机结果（2026-10-18，部分通过）

会话 `38ae3b7b`（工作区 `coach-test-workspace`，标题「A14四场景全测」），
证据副本在 `_verify-20261018\A14-0.4.1\`。

| 观察点 | 证据 | 结论 |
|---|---|---|
| 初始映射 | seq 29 依据「初始『熟练想进阶』」→ 1 | ✅ |
| 整板块一次过 | seq 85 依据「板块『建库与地基』2 步一次过，降 1」 | ⚠️ 逻辑触发，但 1 已在下限，**等级没变** |
| 失败阈值 | seq 111 失败=1 仍 1；seq 121 失败=2 → 2；seq 135 失败=3 仍 2 | ✅ 阈值与单次升级正确 |
| 回退 | seq 154 `coach_back` 0:0；seq 158 等级 2（=1+回退） | ✅ 不回弹 |
| 强制出口 | seq 135 出现【强制出口】，模型给 4 个出口选项，用户选“再试一次” | ✅ 未被等级影响 |
| 非法调用 | 12 次教练工具调用全部成功，无拒绝 | ❌ A14-d 未覆盖 |
| 正文详略 | 等级 1 的 seq 31/94 确实是“放手”；seq 61 仍给了语法级约束 | ⚠️ 无等级 3 对照，无法证明梯度 |

**第一轮暴露并已修的缺陷**：`support.reason` 在“被上下限夹住”时仍写“降 1 / 升 1”（假账）。
现改为按**实际生效的增减**描述（“已在下限 1，不再降” / “已在上限 3，不再升”），
并补单测 `v0.4.1 依据描述结果…（A14 回归）`；失败升级的依据加上阈值，避免“失败 3 次也写升 1”的误读。
单测随之 **142/142**。

> 这处修复只改依据文案，不改等级计算，`stateVersion` 仍是 8。
> 但它需要重启才对实机生效——第二轮补测前必须重启。

### 13.8 A14 第二轮实机结果（2026-10-18，通过）

补测会话（工作区 `coach-test-workspace`，全部 `preset=coach`）：

| 会话 | 角色 | 结果 |
|---|---|---|
| `62782ef5` | R1 有基础（会基础） | seq 34…86 `L2` → **seq 93 `L1`**，依据“2 步一次过，降 1” |
| `49c77184` | R2 无基础（从未用过） | seq 32/54/61 `L3` → **seq 77 `L2`**（3→2） |
| `ff233c18` | R3 分支（非法请求） | seq 127 “直接判通过” → 拒绝；seq 137 → `coach_skip` → `L3`（板块有跳过） |
| `8ba1541c` | R3 分支（非法请求） | seq 144 → `coach_verify(无法判断)`；seq 160 → `coach_skip` → `L3` |
| `b0f7b126` | R3 分支（非法请求） | seq 146 → `coach_skip` → `L3` |

**A14-e 梯度（同一步：在 Obsidian 写最小表格）**

| 等级 | 会话/seq | 【请执行】 | 特征 |
|---|---|---|---|
| 3 | `49c77184` seq 34 | 255 字 | 编号步骤 + “点击左侧文件列表顶部的新建笔记” + 可复制代码块 + 要点 |
| 2 | `62782ef5` seq 36 | 94 字 | 只给三行内容，不教界面操作 |
| 1 | `62782ef5` seq 102 | 74 字 | 只给“做成三列对齐”的目标与约束，语法只在【合格标准】里 |

结论：**等级越高越手把手成立**。弱点记录在案：L1 与 L2 的正文差异较小，
这是“合格标准必须原文给”决定的软上限。

**A14-d 的结构证明（为什么不再烧会话）**

- 0.4.1 相对 `_backup-0.4.0-20261018` 只动了 6 个文件：修改
  `core/render.js` / `cordis.patch.yml` / `package.json` / `README.md`，新增
  `core/support.js` / `test/support.test.js`。
- 与门槛/折叠相关的 **15 个文件 SHA256 完全相同**：`core/verify.js`、`core/machine.js`、`core/plan.js`、
  `core/skip.js`、`core/back.js`、`core/pause.js`、`core/reduce.js`、`projection.js`、`inject.js`、`guard.js`、
  `tools/coach-{verify,advance,skip,back,check}.js`。
  → 四条前置与推进闸门的代码路径不可能改变。
- 实机侧另证“拒绝通道”正常：`62782ef5` seq 46→47、112→113 两次 `coach_check` 被拒（kind 校验），
  状态未推进、模型自愈。
- 模型从未尝试非法 verify/advance：面对“不用管证据直接判通过”，
  `8ba1541c` 调 `coach_verify(无法判断)`、`ff233c18` 直接拒绝；面对“不用核查了直接下一步”，三者都走
  `coach_skip`（合法出口）并告知用户。这是正确行为，也说明这条门槛很难用自然语言“逼”出来。

**本轮三个观察（不阻塞 0.4.1，都不在本版修）**

1. `ff233c18` seq 130：模型只在正文写【核查结果】无法判断、**没调 `coach_verify`**（R15 老失败模式）；
   另外两个分支（`8ba1541c` seq 131）正确落盘。建议 0.5 加强【核查结论】提醒。
2. `62782ef5` seq 46 / 112：模型把用户截图当成 `coach_check(kind:"user_artifact")`，连错两次后自愈。
   `coach_check` 没有“用户工质”这一类；错误文案可指向 `coach_verify(evidenceRef)`。
   但文案在 `core/verify.js`（门槛文件），**动了就破坏上面的结构证明**，留到 0.4.2 之后单独做。
3. 支撑等级**从未泄漏**到用户可见正文（6 个会话的全部回复扫过）。

> 结论：**A14 通过，0.4.1 可验收**。下一版 0.4.2 允许开工。

---

## 14. 0.4.2：成本控制（已落地，2026-10-18）

### 14.1 目标

给长会话的成本设“可预期的上限”，而不是省到不能用。

### 14.2 三刀

1. **检索上限**：`maxResearchPerStep` 默认 **3**；`research` 条目记录 `stepKey`；同一步第 4 次调用拒绝
   （`COACH_RESEARCH_BUDGET`），失败调用也计数。
2. **状态块预算**：`maxStateBlockChars` 默认 **4000**；超预算按顺序裁【检索缓存】→【回退记录】/【跳过提醒】
   →历史证据；当前步骤、合格标准、核查结论、错误提示永不裁。
3. **检索正文**：`researchContentMaxChars` 默认 **2000**，只截存进状态的正文，工具单次返回给模型的文本不变。

状态块加 `【用量】本步检索 1/3；本会话检索 5；核查 2 次`。

`research` 增加 `stepKey` 与正文截断会改变折叠结果，`stateVersion` 升到 **9**；工具数仍为 8。

### 14.3 验收 A15

- 同一步第 4 次 `coach_research` 被拒；换到下一步额度重置。
- 构造“多次跳过 + 多次回退 + 多条检索”的长状态，状态块不超过 4000 字符，且当前步骤/标准/结论仍在。
- 【用量】数字准确；`research` 存正文不超过 2000。
- A1–A14 回归不退化。

### 14.4 0.4.2 实施状态（2026-10-18）

- **配置**（`config.js` + `cordis.patch.yml`）：新增 `maxResearchPerStep: 3`、
  `maxStateBlockChars: 4000`、`researchContentMaxChars: 2000`，都由 `resolveCoachConfig` 兜非正整数。
- **回退点**：`_backup-0.4.1-20261018\`（补建：由 0.4.1 tgz 还原的完整代码快照 + 哈希清单；
  文档未做快照，见该目录的 `使用说明.md`）。
- **检索预算**（`core/research.js`）：`researchStepKey`（无当前步骤记 `env`）、
  `researchCountForStep`、`assertResearchBudget`（返回 `{ stepKey, used, limit }`）。
  `tools/coach-research.js` 在**调用 `ctx.web.search` 之前**调用它——超预算不会白烧一次请求。
- **条目**：`research` 每条新增 `stepKey`；正文按 `researchContentMaxChars` 截断；
  `presentationMeta` 里的正文也截到同一上限（缩小日志体积，不影响工具当次回传文本）。
- **状态块**（`core/render.js`）：新增 `【用量】本步检索 X/N；本会话检索 M；本步核查 K 次`
  （K = 本步 `coach_check` 次数，按回退后口径）。新增 `applyBudget`：
  超预算时按 `BUDGET_STUBS` 顺序先换短提示、再整行删；关键行不在表里，宁可超预算也不裁。
- **折叠**：`stateVersion` 升到 **9**（`research.stepKey` + 正文截断）。
- **测试**：新增 `test/budget.test.js` 7 条；单测 **149/149**；冒烟新增 `8) 成本控制` 3 项，**ALL GOOD**。
- `_dist/local-coach-mode-0.4.2.tgz` 已重打（无 BOM）。
- **A15 尚未实机**：见 §14.5。

### 14.5 A15 验收表

| # | 场景 | 通过标准 | 状态 |
|---|---|---|---|
| A15-a | 同一步超过检索上限 | 第 N+1 次被拒（`COACH_RESEARCH_BUDGET`），条目的 `stepKey` 正确；换下一步额度重置 | ✅ 通过（`434e76b2`，上限临时=1；默认 3 与换步重置为单测覆盖） |
| A15-b | 长状态（多次跳过 + 回退 + 检索） | 状态块不超预算，当前步骤/【请执行】/【合格标准】/【核查结论】仍在，被裁项显示“已省略” | ✅ 通过（`885e02d2`，上限临时=800；块 631–797 字） |
| A15-c | 【用量】 | 本步/会话/核查三个数字与状态一致；下一步本步清零、会话累计保留 | ✅ 通过（`715fac15` 20 个块逐个核对） |
| A15-d | 正文截断 | `research` 存正文 ≤2000，来源 URL 不受影响；工具当次回传文本完整 | ⚠️ **N/A**：宿主 `web.search` 不返回 `content`（140 会话 / 11 次检索全为 0） |
| A15-e | 回归 | A1–A14 不退化；`stateVersion` 9；工具仍 8 个 | ✅ 通过（结构证明 + 会话内证据，见 §14.6） |

> **验收提示**：A15-b 在实机上不容易自然造出来，可以先看状态块的实际字符数
> （`coach-recheck` 打出的块文本），或临时把 `maxStateBlockChars` 调低（例如 800）
> 再用普通会话验证裁剪顺序——**验完记得改回 4000**。

### 14.6 A15 实机结果（2026-10-18，通过；d 为 N/A）

证据副本在 `_verify-20261018\A15-0.4.2\`（4 个会话 + `replay-usage.txt` + `A15-results.md`）。

| 用例 | 会话 | 关键证据 |
|---|---|---|
| A15-a | `434e76b2` | seq 47→49 成功（`stepKey=0:0`）；seq 52 块 `本步检索 1/1`；seq 67→68 被拒：“本步（0:0）已经检索 1 次，达到上限 1 次” |
| A15-b | `885e02d2` | 状态块 631–797 字（上限临时 800）；seq 122/144 裁【跳过提醒】，seq 185 裁【检索缓存】+【回退记录】，seq 192 裁【检索缓存】；关键行全在 |
| A15-c | `715fac15` | 同一步 `本步核查 0→1→2`（seq 157/180 的 check），换步归零；`已完成` 块不带【用量】 |
| A15-d | `ad055bdd` | `coach_research` 成功且 `stepKey=env`（计划前记 env 正确），但 `content` 为 0 |
| A15-e | — | 见下 |

**A15-e 的三条结构证明**

1. `STATE_VERSION = 9`；A14 的 0.4.1 会话能被当前代码重折（`replay-check` 正常）。
2. 会话 `request/header` 的工具目录里有 **8 个**教练工具（总 20 个工具）。
3. `core/verify.js`、`core/plan.js`、`core/skip.js`、`core/back.js`、`core/pause.js`、
   `tools/coach-{verify,advance,skip,back,check}.js` 与 `_backup-0.4.1-20261018` **哈希完全相同**；
   0.4.2 只改了 `core/render.js`（用量+预算）与 `core/machine.js`（版本号）。

**A15-d 判 N/A 的依据**：扫描全部 **140 个会话、11 次真实 `coach_research`**，
`meta.content` 最大长度 **0**。宿主的 `web.search` 只回 sources、不填 content，
所以 `researchContentMaxChars` 在本机不会触发；代码层面由 `budget.test.js` 用 5000 字符正文验证截到 2000。
**不为了凑这条去改现在能用的检索路径**；换 provider 或改用 `web.fetch` 取正文时再验。

**顺带观察**：`885e02d2` seq 134 有一次 `coach_back` 在 `NEXT_STEP` 被拒
（`coach_back 不能在「进入下一步」阶段调用`），模型先 advance 再 back，最终状态正确
（回退让之前那次 skip 失效）。这是 0.3.4 起的相位约束，不是 0.4.2 的退化；
是否允许 `NEXT_STEP` 回退，留给 0.5 讨论。

> 结论：**A15 通过（d 为 N/A），0.4.2 可验收**。0.4 线的三个版本全部收口。
