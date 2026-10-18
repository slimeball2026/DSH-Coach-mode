# 教练模式 / Coach Mode — 档 1 + 档 2（状态机 + 强制核查 + 检索 + 回退 + 暂停）

这是一个 **DeepSeek Harness 的 agent preset bundle**。安装后新建会话时，模式选择里会多出一个
「教练模式」。它包含两层：

| 层 | 内容 |
|---|---|
| 提示词层（档 0） | `cordis.patch.yml` 里 `persona.prefix` 的教练提示词：人设、意图分流、固定输出格式、卡住与跳过 |
| 机制层（档 1 + 0.4.x） | **8 个**教练工具 + 插件持有的状态机 + 每轮状态块 + `write`/`edit` 守卫 + 检索缓存 + 安装分支（含受控早退）+ 同会话回退 + 暂停/恢复 + 支撑等级 |

档 1 只做三件事（`SPEC-档1最小切片.md` 第 1 节）：
**状态机骨架**、**强制核查触发**、**合格标准进状态**。其余功能推迟到档 2。

> **当前版本 0.4.2（2026-10-18）**：**成本控制**——检索按步设上限（默认 **3 次/步**，
> 第 4 次直接拒绝、失败也计数）、状态块字符预算（默认 **4000**，超了按
> 检索缓存 → 回退/跳过 → 历史证据 的顺序裁，**当前步骤/标准/结论永不裁**）、
> 检索正文只截“存进状态”的那份（默认 **2000**），并新增 `【用量】` 一行。
> `research` 条目新增 `stepKey`，折叠语义变了，`stateVersion` 升到 **9**；工具仍 **8** 个。
> 单测 **149**。**A15 待实机**。
>
> **0.4.1（2026-10-18）**：**脚手架递减**——状态块新增 `【支撑等级】1–3`
> （3 手把手 / 2 给要点 / 1 放手），由 `core/support.js` 按板块表现**算**出来，
> 只影响【请执行】讲多细，**不放松任何核查标准**。不新增工具/相位，
> `stateVersion` 保持 **8**。**A14 已通过**（实机两轮，见 SPEC §13.7 / §13.8）。
>
> **0.4.0（2026-10-18）**：会话连续性——`【进度摘要】` + 新相位 `PAUSED` + 第 8 个工具
> `coach_pause`（`action:"pause" | "resume"`）。暂停期间除 `resume` 外所有教练工具被拒绝；
> 恢复回到暂停前的阶段和步骤，**不作废任何证据**（与 `coach_back` 相反）。
> `stateVersion` 升到 **8**，单测 **132**，工具数 **8**。
>
> **0.3.4**：`coach_back`（同会话回退）。只追加 `backs`，不改写历史；回退之后的旧
> `checks` / `verifications` / `skips` 一律不再计入，必须重新核查。只能往回退，不能往前跳；
> 跨会话不接。`stateVersion` 7，工具数 7。
>
> **0.3.4 修复记录**：`coach_back` 最初漏写 `description`，宿主写 `request/header` 时会因
> `description: undefined` 硬失败（`carries non-JSON-serializable data`）。已补，
> 并新增 `tool-shape.test.js` 强制“每个工具都有非空 description、schema 是无损 JSON”。
>
> **0.3.3**：安装体验小修——`INSTALL_TOOL` 增加**受控早退**：工具其实已经可用时，
> 一次 `coach_plan(toolAvailable:"yes", …)` 就能清空安装计划、保留 `originalGoal` 回到学习分支。
> 同时修了 0.3.2 的一个真缺陷：安装计划推进到第 2 步会掉回「等待反馈」，现在全程保持 `INSTALL_TOOL`。
>
> **0.3.2**：`INSTALL_TOOL` 成为独立驻留相位——工具不可用时计划直接落到
> 「安装工具」，核查/跳过/推进语义与等待反馈相同；走完最后一步恢复 `originalGoal` 并回到 `PLAN`。
>
> **0.3.1**：修 0.3.0 实机暴露的三处——`【可跑命令】` 在计划建立前也显示；检索失败只记
> 【检索缓存】失败、不再自动降级；移除模型可写的 `consent`（始终自动脱敏并提示）。
>
> **0.3.0**：新增 `coach_research`、`research_cache`、`RESEARCH` 过渡态、检索脱敏；四个文案缺口。
>
> **0.2.5**：修空 `sections` 的 `coach_plan` 死循环、`coach_check` 非法 `kind`，
> 并按 Q5 B 启用 **7 条只读命令白名单**（显式 `allowCommands: []` 仍可关闭）。
> 档 2 的施工图与版本路线见工作区 `../SPEC-档2-教练模式.md`。

---

## 一、它为什么存在

档 0 的两轮实机冒烟证明：提示词能覆盖的部分已经全部达标，但有两个窟窿改提示词补不上：

- **硬核查不会自发触发**：5 个会话里真正核查用户机器的工具调用只有 1 次，且要等用户递上路径。
- **软核查判定会漂移**：同一情形两次给出「无法判断」和「通过」。

所以档 1 的核心不是"再写更好的提示词"，而是**让插件持有状态并强制转移**。
关键规则全部落在代码里的 `if`，不是提示词里的嘱咐。

> ## ⚠️ 改这个包之前必读的一条硬约束
>
> **本包的任何 `.js` 都不许 `import '@deepseek-ai/...'`。**
>
> dsh 自己的包装在 `app.asar` 里，不在 profile 的任何祖先 `node_modules` 里。
> profile 装的 bundle 一旦 import 它们，会在加载时 `ERR_MODULE_NOT_FOUND`，
> **整行插件加载失败、preset 在模式列表里显示「加载失败」**。
> （本包曾经因此挂过一次：`defineTool` 来自 `@deepseek-ai/dsh-tools`、`Config` 来自
> `@deepseek-ai/schemastery`。现在这两样都换成本地实现：`tools/define-tool.js` +
> `config.js` 里的手写归一化。）
>
> `cordis.patch.yml` 里出现 `@deepseek-ai/*` 是**插件行名**，由 Loader 解析，
> 那条路是通的、也必须保留。
>
> `test/decoupling.test.js` 会扫全包拦这条，改代码后跑一遍单测即可。

---

## 二、目录内容

| 文件 | 作用 |
|---|---|
| `cordis.patch.yml` | 唯一的声明文件：插入 `@deepseek-ai/dsh-agent-preset`（`id: coach`），并在它的 `plugins` 里挂一行 `coach-engine` 指向本包 |
| `index.js` | 宿主插件入口：注册状态块、守卫、8 个工具 |
| `config.js` | 配置默认值与归一化（**不导出 `Config` schema**，原因见上面那条硬约束） |
| `projection.js` | 按需折叠 live 会话日志 → `CoachState`（带按 seq 的缓存） |
| `inject.js` | 每轮状态块注入（`ctx.systemPrompt.context()`） |
| `guard.js` | `write` / `edit` 的确定性拒绝 |
| `core/` | **纯核心**：状态机、计划校验、判定规则、跳过、回退、暂停/恢复、检索脱敏/缓存、进度摘要、支撑等级、渲染、折叠。零宿主依赖、零 IO、零时间、零随机 |
| `tools/*.js` | **8 个**教练工具 + `define-tool.js`（本地版 `defineTool`：把参数表编译成原始 JSON Schema） |
| `test/` | 零依赖单测（149 个用例） |
| `locale/*.json`、`icon.svg` | 插件卡片显示元数据 |

---

## 三、安装

用任何有 `plugin_manager` 工具的会话执行一次：

```
plugin_manager action: install_bundle
target: <本仓库路径>\coach-mode-bundle
```

这是一次修改 profile 的操作，会弹审批，同意即可。

**判断成功只看两个地方，不要看服务器日志或进程列表：**

1. 返回结果里的 `application` 字段为 **`applied`**；
2. `plugin_manager action: list_bundles` 能看到 `@local/coach-mode`。

**档 1 首次引入 JavaScript 模块**，所以覆盖安装之后**必须重启一次 DSH**，
否则可能仍在跑旧的模块代。重启后：新建会话 → 模式选择里选「教练模式」。

## 四、卸载 / 回退

```
plugin_manager action: remove_bundle
target: @local/coach-mode
```

回退到档 0：把 `coach-mode-bundle-backup-tier0\` 的内容复制回 `coach-mode-bundle\`
→ `install_bundle` → 重启 DSH。

---

## 五、状态机（11 个状态）

```
INIT ──coach_plan(可用性未知)──▶ CHECK_TOOL_AVAILABILITY ──coach_plan(补齐)──▶ PLAN
INIT ──coach_plan(可用性已知)──────────────────────────────────────────────▶ PLAN
PLAN ──受理(可用)──▶ WAIT_FEEDBACK
PLAN ──受理(不可用)──▶ INSTALL_TOOL
WAIT_FEEDBACK / INSTALL_TOOL ──coach_check / coach_verify──▶ VERIFY_DONE
VERIFY_DONE ──通过──▶ NEXT_STEP ──coach_advance──▶ WAIT_FEEDBACK / COMPLETE / INSTALL_TOOL(下一步) / PLAN(安装收尾)
VERIFY_DONE ──不通过──▶ WAIT_FEEDBACK / INSTALL_TOOL（本步失败次数 +1）
INSTALL_TOOL（任意一步）──coach_plan(可用性 yes)──▶ WAIT_FEEDBACK / PLAN（受控早退，v0.3.3）
VERIFY_DONE ──无法判断且无证据──▶ DEGRADED
DEGRADED ──coach_check / coach_verify / coach_skip──▶ …
WAIT_FEEDBACK / INSTALL_TOOL / VERIFY_DONE / DEGRADED ──coach_skip──▶ NEXT_STEP
WAIT_FEEDBACK / VERIFY_DONE / DEGRADED / COMPLETE ──coach_back──▶ WAIT_FEEDBACK（目标步骤；旧证据/结论失效）
INIT / CHECK / INSTALL_TOOL / WAIT_FEEDBACK / VERIFY_DONE / DEGRADED ──coach_research──▶ RESEARCH
RESEARCH（过渡态）──▶ 回原阶段；失败只记【检索缓存】失败，不自动降级
INIT / CHECK / INSTALL_TOOL / WAIT_FEEDBACK / VERIFY_DONE / DEGRADED ──coach_pause(pause)──▶ PAUSED
PAUSED ──coach_pause(resume)──▶ 回暂停前阶段（证据不作废）
```

- **过渡态**：`PLAN`、`NEXT_STEP`、`RESEARCH`（同一次工具调用内进出，不会停在两次请求之间）。
- **驻留态**：`INIT`、`CHECK_TOOL_AVAILABILITY`、`INSTALL_TOOL`、`WAIT_FEEDBACK`、`VERIFY_DONE`、`DEGRADED`、`COMPLETE`、`PAUSED`。
- `PAUSED` 期间除 `coach_pause(resume)` 外，所有教练工具都被拒绝。
- 状态**全部从会话日志折叠出来**：插件不新增事件类型、不用 storage、不注册投影单元。

## 六、八个工具

| 工具 | 作用 | 拒绝条件（代码里的 if） |
|---|---|---|
| `coach_plan` | 写入板块与步骤（含合格标准与所需证据） | 计划已被接受后再调用（例外：安装分支里 `toolAvailable="yes"` 的受控早退）；`evidence` 为 `file`/`command` 却没给 `check`；步数超 `maxPlanSteps`；`PAUSED` 时拒绝 |
| `coach_check` | 只读取证 | 阶段不对；`stepKey` 不是当前步骤；`kind=command` 不在白名单 |
| `coach_verify` | 提交核查结论 | 见下面四条 |
| `coach_advance` | 进入下一步 | 上一步没有「通过」或「跳过」记录 |
| `coach_skip` | 明确跳过 | 阶段是 `INIT` / `CHECK_TOOL_AVAILABILITY`（物理前提不可跳过） |
| `coach_research` | 联网检索并写检索缓存 | 阶段是 `COMPLETE` / 过渡态；宿主 `web` 服务不可用；`query` 为空 |
| `coach_back` | 回到更早的某一步重做（同会话） | 阶段是 `INIT` / `CHECK_TOOL_AVAILABILITY` / `PLAN`；目标不存在；目标不是更早的步骤（不能往前跳） |
| `coach_pause` | 暂停 / 恢复（`action` 二选一，同会话） | `pause` 只在驻留阶段（`COMPLETE` 除外）；`resume` 只在 `PAUSED`；重复 pause / 无暂停时 resume 被拒 |

### 安装分支（v0.3.3）

`coach_plan(toolAvailable="no")` 且计划非空时，计划直接落到 `INSTALL_TOOL`（不是 `WAIT_FEEDBACK`）。
之后 `coach_check` / `coach_verify` / `coach_skip` / `coach_research` 都允许；核查不通过只把
`failedAttempts` 加一、**仍留在 `INSTALL_TOOL`**，推进到下一步也保持这个相位（0.3.2 会掉回
`WAIT_FEEDBACK`，0.3.3 已修）。走完最后一步 `coach_advance` 会恢复 `originalGoal`、清空计划
（以及旧步骤的核查 / 跳过记录）、回到 `PLAN`，等待为原目标重新拆计划。

**受控早退（v0.3.3）**：如果 `coach_check` 已找到可执行文件或安装目录，或用户说已经装好并能打开，
**任何一步**都可以调用
`coach_plan(toolAvailable="yes", goalMode:"learn", originalGoal=原目标, sections=学习计划)`
直接退出安装分支：插件清空安装计划与旧步骤证据、`currentGoal` 回到 `originalGoal`；
带 `sections` 直接进 `WAIT_FEEDBACK`，不带则回 `PLAN` 等补计划。
`toolAvailable` 报 `no` / `unknown` 会被拒绝（`COACH_PLAN_INSTALL_EXIT`）——不能用重新提交
把没装好的工具洗成学习分支。

### 回退（v0.3.4）

`coach_back` 只做同会话：把进度退回到当前步骤**之前**的某一步（`stepKey` 形如 `"1:0"`，
或 `sectionIndex + stepIndex`；都不给就回到上一步）。目标必须存在且更早——不能借它往前跳，
往前用 `coach_advance`。`COMPLETE` 之后也能回退复习。

回退只追加 `backs`，不改写历史；但**这次回退之前的 `checks` / `verifications` / `skips` 全部不再计入**：
- 状态块显示【回退记录】；
- 旧结论显示「回退后旧结论已作废」，旧证据不再计数；
- 必须重新 `coach_check` + `coach_verify`，或重新 `coach_skip`，`coach_advance` 才会再次放行；
- `failedAttempts` 保留，供阈值参考。

跨会话不接：换会话重新开始，或手动粘贴摘要。

### 暂停 / 恢复（v0.4.0）

`coach_pause({ action: "pause" | "resume", note? })`，只做同会话：

- `pause`：在 `INIT` / `确认环境` / `安装工具` / `等待反馈` / `核查中` / `降级核查` 都可用；
  进入「已暂停」，记录暂停位置与备注；`COMPLETE` 和计划过渡态不允许暂停。
- 暂停期间除 `resume` 外所有教练工具被拒绝；状态块只显示暂停位置、备注、进度摘要，**不再给【请执行】**。
- `resume`：恢复到暂停前的阶段与步骤；**证据不作废**（与 `coach_back` 相反），可以继续核查/推进。
- 关闭后重开同一个会话仍是暂停状态；换新会话不接（Q4 A）。

### 支撑等级（v0.4.1）

`core/support.js` 的纯函数 `supportLevel(state)` 每轮算一个 1–3 的等级，状态块渲染成

```
【支撑等级】2（给要点）：只给关键操作和目标，具体位置由用户自己找；核查标准不变（依据：初始「会基础」）。
```

| 等级 | 名称 | 正文里的【请执行】 |
|---|---|---|
| 3 | 手把手 | 具体菜单、按钮、快捷键，按顺序点 |
| 2 | 给要点 | 目标 + 关键操作；具体位置用户自己找 |
| 1 | 放手 | 只给目标、约束和【合格标准】 |

结算规则（**全部由代码算，模型不可写**）：

- 初始：从未用过 = 3，会基础 = 2，熟练想进阶 = 1，未知 = 2。
- **按板块结算，与当前停在哪一步无关**：只看“从第 0 个板块起连续处理完的前缀”。
  这样 `coach_back` 退回前面时，已经挣到的降级不会被一笔抹掉——回退是“重做”，不是“失忆”。
- 一个板块**至少 2 步**且全部一次过（零失败、无跳过、无回退）→ 降一级（最低 1）。
- 该板块有跳过 / 有回退目标 / 有步骤失败 ≥2 次 → 升一级（最高 3）。
- 当前步失败到 2 次 → 立即升一级；降级只发生在已处理完的板块，所以“本板块内不再降”自动成立。
- 依据行描述**结果**，不描述意图：被下限/上限夹住时写“已在下限 1，不再降”／“已在上限 3，不再升”，
  不会出现“写了降 1、等级却没动”的假账（A14 第一轮 `38ae3b7b` seq 85 暴露后修的）。

**等级只决定讲多细，不放松任何核查**：`【合格标准】`、`【所需证据】`、`coach_verify` 的四条前置、
`coach_advance` 的闸门一个字都没变。人设里也写明了“拿不准时按 2 处理”。

### 成本控制（v0.4.2）

- **检索上限**：`research` 条目记 `stepKey`；同一步第 4 次调用在**联网之前**就被拒
  （`COACH_RESEARCH_BUDGET`），不会白烧一次请求。失败调用也落一条 `ok:false` 并计数；
  换到下一步额度重置。计划还没建立时记在 `env` 上。
- **状态块预算**：超过 `maxStateBlockChars` 时，按【检索缓存】→【回退记录】/【跳过提醒】→
  【核查证据】→【环境核查】/【可跑命令】/【位置关系】的顺序，先换成一句短提示，再整行删。
  当前阶段/板块/步骤、【请执行】、【合格标准】、【所需证据】、【核查结论】、强制出口/降级/安装分支
  提示**都不在裁剪表里**；如果这些行本身就超预算，宁可超预算也不裁。
- **检索正文**：只截**存进状态**的那份（默认 2000 字符）；工具当次回传给模型的文本仍按 `render` 给。
  > **实测提醒**：宿主的 `web.search` 目前**只返回 sources、不填 `content`**——A15 扫了
  > 140 个会话、11 次真实检索，`content` 长度全是 0。所以这个上限是**防御性**的，
  > 在本机不会触发。真正在省成本的是“检索次数上限”和“状态块预算”这两刀。
- **`【用量】`**：`本步检索 1/3；本会话检索 5；本步核查 2 次`（核查 = 本步 `coach_check` 次数）。
  数字全部由状态算，模型不可写。

> 预算按“行”裁，所以裁完的块可能明显小于预算（先把一整行换成短提示，再判断是否够了）。
> 这是刻意的：宁可块小一点，也不要为了“刚好 4000”去截断【请执行】。

**`coach_verify` 的四条硬前置条件：**

1. `evidence` 为 `file` / `command` 且本步没有 `coach_check` 记录 → **直接失败**；
2. `evidence` 为 `none` 时只允许判「无法判断」；
3. `evidence` 为 `user_artifact` 判「通过」却没给工质（`evidenceRef` 为空）→ 失败；
4. 同一步的重复核查必须引用**新的** `coach_check` 证据（新证据序号必须大于上一条结论的序号）。

## 七、每轮状态块

由插件注入，内容来自 `CoachState` 的纯函数渲染：

```
【当前阶段】【学习工具】【工具可用性】【可跑命令】【待补计划】【当前板块】【当前步骤】【请执行】【合格标准】
【所需证据】【本步失败次数】【核查证据】【核查结论】【检索缓存】【位置关系】
【环境核查】  ← 计划还没建立时做的外观检查（v2.2；记在 env 上，不推进状态）
【用量】  ← 本步检索 X/N、本会话检索 M、本步核查 K 次（v0.4.2）
【安装分支】  ← 只在安装分支出现
【安装分支·可早退】  ← 只在安装分支出现：工具其实可用时怎么一步退出（v0.3.3）
【回退记录】  ← 有过回退时出现：最近回退到哪一步，以及旧证据/结论作废（v0.3.4）
【进度摘要】  ← 已完成/跳过/剩余、当前板块、本步失败、检索次数（v0.4.0）
【支撑等级】  ← 1–3，由板块表现算出；只调【请执行】讲多细（v0.4.1）
【暂停位置】【暂停备注】  ← 只在 PAUSED 出现；暂停块不再给执行步骤
【降级提示】  ← 只在 DEGRADED 出现
【强制出口】  ← 只在失败次数达到阈值时出现
【跳过提醒】  ← 只在有步骤被跳过时出现
```

机制是 `ctx.systemPrompt.context()`：运行时上下文**每次模型请求重新装配**，
语义是"本快照取代上一份快照"，所以它**每轮都在、且不随轮次累积**。

**`【核查结论】` 一行是 v2.3 加的**：第二轮验收发现模型会在**正文**里写【核查结果】
却不调 `coach_verify`，于是状态机看不到结论、也推进不了。现在只要"有证据但没有结论"，
这一行就直接点出来——判定必须落盘，正文里写的不算。
`【位置关系】` 那一行是插件生成的**事实陈述**（F6 的落实），不写在人设里。

**状态块在 `INIT` / `确认环境` 阶段是命令式的**（v2.2；v0.2.5 补了第 3 条）：用 `coach_check`
采环境证据；可用性已知时**必须同时提交 `sections`**；只有可用性未知时才允许只报
`toolAvailable=unknown`。第一轮实机验收里有 5 个会话卡死在"确认环境"之后再也不建计划，
v0.2.5 又发现"空 sections 只报可用性"会让模型反复收到"可用性还是未知"——两处都已修。
v0.3.3 又补了两条：可用性只认三类证据（`coach_check` 找到可执行文件/安装目录、用户明确说能打开、
用户说已经装好）；环境核查只查与当前工具相关的路径/命令，不许跑无关的白名单命令。

**v0.3.x 新增两行**：
- `【可跑命令】`：把 `Config.allowCommands` 的 7 条只读命令直接列出来，并写明“可以直接用
  `coach_check(kind="command")` 跑，不必先让用户手动跑”。v0.3.1 起在**计划建立前**也显示
  （`INIT` / `确认环境`，不要求已有 `toolName`）。
- `【检索缓存】`：最近 3 条检索的“查询 → N 个来源”摘要；失败时显示错误，并提示不要编造。
  `RESEARCH` 是过渡态，状态块不会停在「检索中」，只显示缓存结果。

**v0.3.3 新增 `【安装分支·可早退】`**：安装分支里每一步都提示“工具其实可用时怎么一步退出”，
并说明 `sections` 留空会回到「拆解计划」。配合人设的三条可用性规则，A12 的“已经装好仍走完
3 步安装确认”不再依赖模型自己想起来。

**v0.3.1：检索失败不再自动降级**。失败只写一条 `research_cache`（`ok:false`），
`phase` 保持原样；是否判「无法判断」/进 `DEGRADED` 由模型用 `coach_verify` 决定。
这样一次与当前步骤无关的检索失败，不会把“配置 user.name”这种步骤旁路成「降级核查」。

**「本步失败次数」的两个来源**（v2.2，F2 口径）：`coach_verify` 判不通过/无法判断，
**以及用户只回「不行」「还是不行」这类零信息短句**。一轮只计一次（用户说了之后模型又判一次，
不会算两次）。长回复一律不算——里面通常有可核对的现象。

### 排版：为什么固定格式里每个字段之间要空一行（v0.2.3）

这是踩过的坑，改人设时**不要**把这几个空行去掉。

DSH 的助手正文用的是自研 mdast→React 渲染器（`dsh-client-ui-primitives` 的 `renderNode`）：

```js
case "text":      return node.value          // 软换行原样留在 text 节点里
case "paragraph": return <p>{…}</p>          // 包进段落
case "break":     return <br>                // 只有硬换行才换行
```

`.markdown` 容器上**没有** `white-space: pre-wrap`（有 pre-wrap 的是用户气泡
`user-text.module.css`）。所以：**段落内部的单个换行会被 HTML 折成一个空格**，
只有空行才能分段。

后果很具体：固定格式原本是六行连着写（`【当前板块】…`↵`【本步目标】…`…），
实测 97 条教练回复里有 **21 条（22%）**踩中，最严重的一条把 6 个字段挤成了 1 行。
现在人设要求**每个字段之间空一行**，三处固定格式都改了：
步骤 6 段、核查结果 4 段、检索来源 3 段。

> 改完仍是"概率性"的：它依赖模型遵守格式约定（模型至今 100% 输出了这 6 个标签，
> 加空行是更小的增量）。如果哪天又出现挤成一行，先看那条回复是不是漏了空行，
> 而不是怀疑渲染器。


## 八、Config

在 `cordis.patch.yml` 的 `coach-engine` 行里改：

> **注意：这一行没有 schema 校验。** 因为导出 `Config` 需要 `@deepseek-ai/schemastery`，
> 而那是被禁止的宿主依赖（见第一节那条硬约束）。所以：
> - Plugin Manager 里看不到这些字段的表单，只能手改 YAML；
> - 写错的字段**不会报错**，`config.js` 会静默回落到默认值（例如把 `failureThreshold`
>   写成 `"三"`，实际生效的是 `3`）。改完建议看一次状态块里的【本步失败次数】确认阈值。

| 字段 | 默认 | 含义 |
|---|---|---|
| `failureThreshold` | `3` | 连续失败多少次后状态块主动给出强制出口 |
| `maxPlanSteps` | `12` | 一次计划允许的最大步骤总数 |
| `allowCommands` | 7 条只读命令（见 `cordis.patch.yml`） | `coach_check(kind="command")` 的命令白名单（完整命令字符串精确匹配）。**显式写 `[]` = 关闭命令核查** |
| `sameMachine` | `true` | 教练与用户是否同一台机器；远端 fs 后端部署时设 `false`，【位置关系】自动改写 |
| `commandTimeoutMs` | `15000` | 命令核查超时 |
| `readFileMaxChars` | `1200` | `read_file` 回传给模型的字符上限 |
| `listDirMaxEntries` | `30` | `list_dir` 回传的条目上限 |
| `maxResearchPerStep` | `3` | 同一步最多检索几次；第 N+1 次直接拒绝（`COACH_RESEARCH_BUDGET`），**失败也计数**。换到下一步额度重置 |
| `maxStateBlockChars` | `4000` | 状态块字符预算；超了按【检索缓存】→【回退记录】/【跳过提醒】→【核查证据】→【环境核查】/【可跑命令】/【位置关系】的顺序换成短提示或删除；**当前步骤/【请执行】/【合格标准】/【核查结论】/错误提示永不裁** |
| `researchContentMaxChars` | `2000` | **只截存进状态**的检索正文；工具当次回传给模型的文本不受影响 |

例：在默认白名单之外，再允许 `git branch --show-current` 这一条命令核查：

```yaml
          - id: coach-engine
            name: '@local/coach-mode'
            config:
              allowCommands:
                - git branch --show-current
```

注意：写 `allowCommands` 会**整体替换**默认白名单，不是追加。要保留默认 7 条，就把它们
和新命令一起写进去；要关闭命令核查，写 `allowCommands: []`。

---

## 九、测试

在 **bundle 目录内**执行（用 DSH 自带的 Node）：

```powershell
cd <本仓库路径>\coach-mode-bundle
node --test --test-isolation=none
```

> **两个环境事实**（实测，与 SPEC v1 第 12.1 节写的 `node --test test/` 不同）：
> 1. Node **24.21** 把 `--test` 后面的目录位置参数当成**单个入口模块**，会报
>    `ERR_UNSUPPORTED_DIR_IMPORT` / `MODULE_NOT_FOUND`。所以不要传 `test/`，用自动发现。
> 2. 默认的 test isolation 会为每个测试文件派生带管道 stdio 的子进程；在 DSH 的工作区沙箱下
>    会以 `EPERM` 失败。`--test-isolation=none` 在同一进程里跑完全部文件，不需要提权。

覆盖：`machine.test.js`（11 状态全部转移 + 安装分支恢复原始目标 + 受控早退与旧证据清理）、
`back.test.js`（v0.3.4 回退：目标解析、只能往回、旧证据/结论/跳过失效、重核后恢复推进、A11）、
`pause.test.js`（v0.4.0 暂停/恢复：PAUSED 拒其它工具、证据不作废、安装分支/INIT 暂停、备注截断）、
`summary.test.js`（v0.4.0 进度摘要：完成/跳过/剩余、回退失效、COMPLETE、失败与检索计数）、
`support.test.js`（v0.4.1 支撑等级：初始映射、整板块一次过降级、跳过/回退/失败升级、
板块内只升不降、上下限、状态块字段）、
`budget.test.js`（v0.4.2 成本控制：检索按步预算、失败也计数、换步重置、正文截断、
【用量】数字、状态块超预算裁剪顺序与“关键行永不裁”、Config 默认值与非法回落）、
`preconditions.test.js`（第 5.2 节四条 + 新证据规则 + 计划校验）、
`reduce.test.js`（折叠、幂等、`stateVersion`、失败结果不推进状态、检索/早退/回退/暂停折叠）、
`render.test.js`（状态块字段、跳过提醒、尚未采集、强制出口、【可跑命令】、【检索缓存】、
【安装分支·可早退】、【可用性判断】、【回退记录】、【进度摘要】、PAUSED 块）、
`research.test.js`（脱敏、来源归一化、成功写缓存、失败降级）、
`config.test.js`（默认只读白名单）、
`tool-shape.test.js`（八个工具都有非空 `description`，模型可见 schema 是无损 JSON——v0.3.4 事故回归）、
`decoupling.test.js`（**整包**零宿主依赖 + `core/` 零 Node 内置模块 + 零时间/随机）。

另有一个**零宿主依赖**的装配冒烟脚本，不碰 dsh 的 `node_modules` 就能跑通
"plan → check（真磁盘）→ verify → advance"、安装分支受控早退、回退重核、暂停/恢复、支撑等级、
检索成功/失败、检索预算与状态块裁剪，以及守卫：

```powershell
node <本仓库路径>\_ref\smoke-coach.mjs
```

---

## 十、已知限制（诚实写在这里）

1. **`pwsh` / `bash` 本切片不加守卫。**"不代做"在命令行这一项上仍靠提示词。
   命令的副作用难以可靠判定，列为档 2 待办。文件编辑（`write` / `edit`）已经物理拒绝。
2. **命令核查默认只读白名单。** 默认允许 7 条只读命令（`git --version` / `git status` /
   `git config --global --list` / `git log --oneline -5` / `node -v` / `npm -v` / `python --version`）；
   白名单外的命令仍会失败。显式写 `allowCommands: []` 可以关闭命令核查、只留文件系统。
3. **配置没有 schema 校验。** 见第八节：字段只能手改 YAML，写错会静默回落默认值，
   Plugin Manager 里也没有表单。这是"不许 import 宿主包"的直接代价。
4. **状态是"按需折叠 + 进程内缓存"。** 没有跨进程持久化；但状态本身完全可从会话日志重算，
   所以重启、恢复、fork 之后仍然正确（只是重算一次）。
5. **`coach_check` 的读取走宿主 `fs` 服务**，会受沙箱与审批策略约束——这是设计意图（决策 D7），
   不是缺陷：它保证"核查"不会变成绕过策略的读写后门。
6. **依赖 DSH 插件 API，API 随版本变化。** DSH 升级后请重新核对
   `SPEC-档1最小切片.md` 第 13 节的 8 项，以及本节第 3 条背后的"不许 import 宿主包"约束。
7. **宿主提供的提示词变量会随版本增删。** 0.2.0-rc.2 注册过 `cwd`，0.2.1-rc.1 只剩
   `provider` / `model`。人设里一旦引用不存在的变量，**不是降级而是每一轮直接失败**：
   `unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix"`。
   本包现在**不使用任何提示词变量**（工作目录由状态块【位置关系】给出）。
8. **preset 不是安全沙箱。** YAML 与插件仍然执行宿主代码。
9. **改完必须"覆盖安装 + 重启"，两个都要。** 只重启不重装：失败的 preset 声明会一直挂在
   名单上带诊断、无法组合会话；只重装不重启：加载的是旧的模块代。
10. **检索依赖宿主 `web` 服务。** `coach_research` 通过 `ctx.get('web')` 调用；preset 没挂
    `tool-web` 或 provider 不可用时，会报 `COACH_RESEARCH_NO_WEB` 或结构化检索失败。
    来源摘要进 `research_cache`；长正文会截断，不把整页内容塞进状态。
11. **检索脱敏是保守规则。** 只替换 Windows/UNC/常见 POSIX 路径、32 位以上 hex 附件 id、
    邮箱；不做语义级 PII 识别。需要保留原文检索时，模型要先征得用户同意。
12. **检索失败不自动降级。** 0.3.1 起失败只写 `research_cache`（`ok:false`）和状态块的
    【检索缓存】失败；是否判「无法判断」/进 `DEGRADED` 由模型用 `coach_verify` 决定。
13. **安装分支的受控早退只认 `toolAvailable:"yes"`。** 这是刻意的：没装好时用重新提交
    “洗”成学习分支，会把物理前提绕过去。没装好就继续安装计划，或用 `coach_skip` 明确跳过。
    早退会作废安装步骤的核查/跳过记录，新学习计划从第 1 步重新开始。
14. **安装分支的相位在 0.3.3 才是全程 `INSTALL_TOOL`。** 0.3.2 推进到第 2 步会掉回
    `WAIT_FEEDBACK`；如果你的会话是在 0.3.2 上建的，折叠后仍显示旧相位，重新建会话即可。
15. **`coach_back` 只做同会话、只能往回退。** 不提供跨会话续接；也不会“自动回滚”已经发生的
    真实操作——它只改教练状态，用户改过的文件需要用户自己还原。回退后重做的判定
    一律按新证据算。
16. **暂停/恢复只做同会话。** 暂停状态跟当前会话绑定：关闭后重开同一个会话仍是暂停；换新会话不接。
    暂停不作废旧证据，恢复后可以继续核查；如果模型忘记调 `resume`，用户说一句「继续」即可。
    状态块在 `PAUSED` 时不会给【请执行】，避免模型“暂停了还在讲课”。
17. **支撑等级不改计划里的 `action` 原文。** 等级只改变**正文怎么讲**（人设规定），
    【请执行】在状态块里仍是当初写进计划的那句话。所以等级降为 1 以后，模型仍可能在正文里
    把细节讲全——这是软约束，A14 验收要抽查真实回复，不能只看状态块。
    等级本身是代码算的（不可由模型写），因此不会出现“模型自降等级少核查”。
18. **状态块预算裁的是“注入文本”，不是计划本身。** 预算超了以后，被裁掉的是
    检索缓存/回退记录/跳过提醒/历史证据这些**展示用**内容；计划里的 `action`、`standard`
    以及会话日志里的原始记录都还在。下一轮如果不再超预算，它们会重新出现。
    反过来，如果【请执行】+【合格标准】本身就超过预算，块会**超预算**——这是刻意的优先级。
19. **检索预算按“步”而不是按“会话”。** 同一会话里换到下一步，额度就重置；
    用户明确要求放宽时，只能改 `maxResearchPerStep`，模型没有绕过入口。

## 十一、改哪里

| 想改 | 改哪个文件 |
|---|---|
| 教练人设 / 固定输出格式 / 意图分流 | `cordis.patch.yml` 的 `persona.prefix` |
| 阈值、白名单、上限 | `cordis.patch.yml` 的 `coach-engine.config` |
| 状态机与判定规则 | `core/`（改完先跑单测） |
| 回退目标解析 / 失效口径 | `core/back.js`（判定口径在 `core/machine.js` 的 `effectiveSinceBack`） |
| 暂停/恢复规则 | `core/pause.js`（`PAUSED` 相位在 `core/machine.js`） |
| 进度摘要口径 | `core/summary.js` |
| 支撑等级的结算规则 / 文案 | `core/support.js` |
| 状态块文案 / 字符预算与裁剪顺序 | `core/render.js`（`BUDGET_STUBS`） |
| 检索脱敏 / 缓存字段 / 按步预算 / 正文截断 | `core/research.js` |
| 检索工具 / 宿主 web 调用 | `tools/coach-research.js` |
| 工具的参数与描述 | `tools/*.js` |

> **改 `cordis.patch.yml` 的两条纪律**
> 1. **`{{...}}` 只能用宿主确实注册过的变量**（0.2.1-rc.1 是 `provider` / `model`）。
>    写错一个不存在的变量，整套模式每一轮都会失败——见第十节第 7 条。
> 2. **不要用 PowerShell 的 `Set-Content -Encoding utf8` 改 `package.json`**：它会在开头加 BOM，
>    而 `JSON.parse` 读到 BOM 直接抛错。用 `edit` 工具或 Node 的 `fs.writeFileSync`。

改完：`install_bundle` 覆盖安装 → **重启 DSH** → 用新会话验证（preset 按会话绑定）。
