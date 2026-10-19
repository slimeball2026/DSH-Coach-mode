# Agent教练模式档1施工

> 由 [dsh-chat-export](https://github.com/DDDMUC/dsh-chat-export) 从 DeepSeek Harness 会话导出

`session-4b80306d-dbca-40a1-b0e1-831add5bff78` · `C:\\Users\\user_name\\Documents\\deepseek-harness\\default-workspace`

| 项 | 内容 |
| --- | --- |
| 模型 | `deepseek-account/deepseek-flash` |
| 时间 | 2026-10-17 09:19:47 → 2026-10-17 20:49:27（11h 29m） |
| 规模 | 14 轮 · 482 步 · 用户 14 条 · 助手 111 条 · 493 次工具调用 |
| 范围 | 仅当前模型上下文 |

---

## 回合 1 · 17m 31s

### 用户

请先读这个文件，再动手：
C:\Users\user_name\Desktop\Agent教练模式 prompt\Agent教练模式 prompt\00-交接说明.md

读完按里面的阅读顺序读其余文档，然后严格按 SPEC-档1最小切片.md 施工。

开工前必须做的四件事：
1. 按本文档第十一节，先把 coach-mode-bundle 备份一份。
2. 按 SPEC 第 13 节，用 cordis_inspect_query 复核那 8 项 API，并把结果回填进 SPEC。
3. 读本文档第十节——交底文档第 6 节的 5 个问题已经有答案了，不要再问一遍。
4. SPEC 第 14 节那 3 个问题需要先问我。

施工时的硬性约束：
- 在现有的 coach-mode-bundle 上扩展，不要新建目录，也不要动 profile 里的安装副本。
- 档 1 只做：状态机骨架 + 强制核查触发 + 合格标准进状态。范围以 SPEC 第 1 节为准。
- 完成标准以 SPEC 第 12 节为准，验收要附会话日志路径与事件 seq。

如果复核结果与 SPEC 的设计冲突，以实测为准，并更新 SPEC（版本改为 v2）。

### 助手 · `deepseek-account/deepseek-flash`

I'll start by reading the handoff document as instructed.

### 助手 · `deepseek-account/deepseek-flash`

Now let me read the SPEC (my construction blueprint) and the revision notes.

### 助手 · `deepseek-account/deepseek-flash`

Now let me create the backup (task 1 required before anything else).

### 助手 · `deepseek-account/deepseek-flash`

Backup is in place. Now let me ask the 3 questions from SPEC §14 and simultaneously start the API inspection.

### 助手 · `deepseek-account/deepseek-flash`

All 3 answers align with SPEC recommendations. Now task 2 — verifying the 8 APIs. Let me start with the Service directory.

### 助手 · `deepseek-account/deepseek-flash`

Key services confirmed. Now let me get exact contracts for the ones I'll depend on.

### 助手 · `deepseek-account/deepseek-flash`

Now the Event directory and the Session/fs contracts.

### 助手 · `deepseek-account/deepseek-flash`

Let me dig into the remaining unknowns. First the full service catalog for session-log access.

### 助手 · `deepseek-account/deepseek-flash`

Now let me look at the DSH reference implementations — practices docs and plan-mode (the closest precedent).

### 助手 · `deepseek-account/deepseek-flash`

The DSH packages live inside `app.asar`. Let me extract the docs and reference plugins I need (read-only, into the workspace).

### 助手 · `deepseek-account/deepseek-flash`

Now let me read the authoritative plugin-development references.

### 助手 · `deepseek-account/deepseek-flash`

Critical confirmations. Let me read the plugin-development references for the bundle + preset + tool patterns.

### 助手 · `deepseek-account/deepseek-flash`

Let me verify `defineTool` and the tool error contract directly from the shipped package.

### 助手 · `deepseek-account/deepseek-flash`

`presentationMeta` looks like a clean durable channel. Let me verify it lands in the logged `tool/result`.

### 助手 · `deepseek-account/deepseek-flash`

All 8 APIs verified. Let me record the results and rewrite the SPEC as v2 (one write, outside workspace → will need approval).

### 助手 · `deepseek-account/deepseek-flash`

Now let me verify the schemastery API before writing `Config`.

### 助手 · `deepseek-account/deepseek-flash`

Verification complete. Now let me build. Setting up the task list:

### 助手 · `deepseek-account/deepseek-flash`

Now the adapter layer:

### 助手 · `deepseek-account/deepseek-flash`

Now the five coach tools:

### 助手 · `deepseek-account/deepseek-flash`

Now the unit tests:

### 助手 · `deepseek-account/deepseek-flash`

Now let's run the tests:

### 助手 · `deepseek-account/deepseek-flash`

The sandbox blocks `node --test`'s per-file child processes (documented EPERM boundary). Escalating this exact command once:

### 助手 · `deepseek-account/deepseek-flash`

All 53 tests pass. Let me syntax-check every module, then install:

### 助手 · `deepseek-account/deepseek-flash`

Now the README:

### 助手 · `deepseek-account/deepseek-flash`

Now let's install the bundle:

### 助手 · `deepseek-account/deepseek-flash`

The live process needs a restart for the preset to activate. Meanwhile, let me de-risk the module code by loading it against a real copy of the DSH packages:

### 助手 · `deepseek-account/deepseek-flash`

Let me check how the shipped template imports DSH packages — this decides whether my `import '@deepseek-ai/...'` resolves:

### 助手 · `deepseek-account/deepseek-flash`

Let me verify one more thing about name resolution, then clean up the temp tree:

### 助手 · `deepseek-account/deepseek-flash`

Node 24 has zstd — I can read the live session logs directly. Let me verify:

### 助手 · `deepseek-account/deepseek-flash`

Now the evidence extraction tool (needed for acceptance with real `seq`s):

### 助手 · `deepseek-account/deepseek-flash`

Now the final SPEC update with the environment findings:

### 助手 · `deepseek-account/deepseek-flash`

Final verification pass:

### 助手 · `deepseek-account/deepseek-flash`

档 1 已经施工完成并装好。先说四件必做的事，再说结果。

##### 开工前四件事

| # | 事项 | 结果 |
|---|---|---|
| 1 | 备份 | ✅ `coach-mode-bundle-backup-tier0`（6 文件，与原始档 0 逐字节同长） |
| 2 | 8 项 API 复核 | ✅ **8 项全部可用，无一项需要走退路**，已回填 SPEC → **v2** |
| 3 | 第十节 5 个开放问题 | 没有重问，直接按 SPEC 决策执行 |
| 4 | SPEC §14 三个问题 | 已问，按你的选择：白名单空 / pwsh 不守卫 / 状态块中文 |

##### 复核结论（8 项，两条改变了设计）

- `systemPrompt.section()` 动态渲染**可用**（`text` 支持 `(AssembleContext)=>string`，`assembleContextFor` 保证里面有 `agent`），但我改选了 **`systemPrompt.context()`** —— 运行时上下文每请求重算、"取代上一份快照"，天然满足"每轮都有且不累积"，还不改系统提示词前缀：**D9**。
- 结构化工具事实找到了唯一的干净落盘通道：**`output.presentationMeta()` → `tool/result.data.meta`**（agent-loop 明确写入）。所以 `checks` 的 `ok/detail` 不靠解析文本、不新增事件 type：**R3**。
- 其余：`agent/pre-step`、`sessionQuery`、`ctx.fs`、`tools.guard`、`Config`(schemastery)、`register(defineTool)`、宿主可判定"同一台机器" 全部实测通过（退路一条没用上）。

v2 共 8 处修订（R1~R8），其中两条是**修掉 v1 的硬伤**：`VERIFY_DONE` 原本没有任何工具能进入（按字面实现会死锁）；折叠只吃成功结果，否则被拒一次的 `coach_verify` 等于凭空记了一次核查。

##### 施工结果

27 个文件，`core/` 零 `@deepseek-ai/*`、零 IO、零时间（由 `decoupling.test.js` 强制）。

- **53 个单测全绿**（8 状态全部转移、第 5.2 节四条前置条件、折叠幂等/stateVersion、渲染、解耦）
- **装配冒烟 26 项全过**：把 dsh 安装的 `node_modules` 解出来，用**真的** `dsh-tools`+`schemastery` 加载本插件跑完整链路（plan→check→verify→advance），失败调用确实不推进状态，`write/edit` 被拒而 `pwsh/read` 放行，安装分支 `originalGoal` 正确保留
- **安装**：`application: applied`，`warnings: []`

##### 三个偏差，需要你知情

1. **交接文档说 bundle 已装好 —— 实际没装**：`node_modules/@local/` 是空目录，profile 的 bundles 里也没有它。已重新安装（这次走 `link:`，不是文档描述的 tgz）。
2. **profile 的 `reasoningEffort` 是 `high`，不是文档说的 `off`**。A3（两遍判定一致）对此敏感。我没动 profile——改回去还是承认跑在 `high` 上，你定。
3. **`node --test test/` 在 Node 24.21 上跑不通**（目录参数不被发现；默认 isolation 的管道子进程被沙箱 EPERM）。实际命令是 `node --test --test-isolation=none`，已回填 SPEC §12.1。

##### 还差的一步：重启 DSH

架构上必须重启才能加载新的 JS 模块代——`application: applied` 只代表 profile 写好了。重启后按验收指南 §二 的 4 步确认，然后跑 A1~A7。

取证不用你导 zip：live 存储的 `session.v4.jsonl.zstd` 是**多帧 zstd 拼接**（不是普通 zstd），我写了 `_ref\coach-evidence.cjs` 按帧魔数切开，能直接吐出每个教练工具的 `call@seq → result@seq`、参数、成败和 `meta`。**你只要告诉我会话 id，我自己读日志填报告。**

## 回合 2 · 4m 49s

### 用户

@C:\Users\user_name\Downloads\dsh-session-session-0332c691-b248-4b24-9d4f-151579584725.zip 中途遇到问题，我安装不了这个模式，它在我的Agent预设中显示加载失败。这个文件是我的那次安装后的另一个对话。

### 助手 · `deepseek-account/deepseek-flash`

Let me read that log.

### 助手 · `deepseek-account/deepseek-flash`

The preset row exists but its child plugin never instantiated. Let me get the error:

### 助手 · `deepseek-account/deepseek-flash`

Let me verify my main suspect: a profile-installed package can't resolve dsh's own packages.

### 助手 · `deepseek-account/deepseek-flash`

**找到根因了。** `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/schemastery' imported from .../config.js` —— profile 里装的 bundle **不能 import dsh 自己的包**（dsh 的包在 `app.asar` 里，不在 profile 的任何祖先目录）。所以 `coach-engine` 这行加载失败 → preset 显示"加载失败"。

我的错：`defineTool` / `Config` 两个 import 依赖了这条错误假设。修掉它。

### 助手 · `deepseek-account/deepseek-flash`

Now switch all five tools to the local helper:

### 助手 · `deepseek-account/deepseek-flash`

Two failures are my smoke-test assertion being too strict (optional-only params legitimately have no `required`). But let me verify the registry's parameter constraints for real:

### 助手 · `deepseek-account/deepseek-flash`

Registry only validates the output schema — parameters pass through unvalidated (so no risk there). Fixing my over-strict assertion and exercising the real command-whitelist path:

### 助手 · `deepseek-account/deepseek-flash`

All green (55 tests + full smoke). Now updating docs with the new hard constraint:

### 助手 · `deepseek-account/deepseek-flash`

Before reinstalling, let me eliminate one more unknown: does the loader accept a row `config` when the plugin exports no `Config`?

### 助手 · `deepseek-account/deepseek-flash`

`resolveConfig` returns raw config when no `Config` is exported — safe. Reinstalling (a failed preset declaration can't compose sessions until the bundle is reinstalled):

### 助手 · `deepseek-account/deepseek-flash`

`ambiguous-install` = "already installed, nothing changed" (the manager compares `dependencies` diffs; a directory link never differs). Let me check what a successful activation looks like, to give you an exact post-restart check:

### 助手 · `deepseek-account/deepseek-flash`

Important: `@deepseek-ai/dsh-persona` also shows **zero** entries — so preset **children never appear in the Config directory**. My earlier verification step 3 was wrong. Let me correct the guide:

### 助手 · `deepseek-account/deepseek-flash`

Final verification pass:

### 助手 · `deepseek-account/deepseek-flash`

找到了，是我的错，已经修好。

##### 根因

你那份日志里 `preset-coach` 其实是 `fiberPhase: active` 的，但查 `@local/coach-mode` 返回空——子插件行没起来。我直接复现出来了：

```
ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/schemastery'
  imported from ...\coach-mode-bundle\config.js
```

**dsh 自己的包装在 `app.asar` 里，不在 profile 的任何祖先 `node_modules` 里。** 所以 profile 装的 bundle 一旦 `import '@deepseek-ai/...'` 就必挂，而且不是降级、是整行加载失败 → preset 带诊断挂在名单上、显示"加载失败"。

而我在两处用了这个错误假设：`defineTool`（`@deepseek-ai/dsh-tools`）和 `Config`（`@deepseek-ai/schemastery`）。SKILL 里那句"shipped 的包从 dsh 安装解析"我读成了"模块也能 import"——它其实只指**插件行名**能解析。

##### 修法（两处依赖全部去掉）

| 原来 | 现在 |
|---|---|
| `import { defineTool } from '@deepseek-ai/dsh-tools'` | 本地 `tools/define-tool.js`：把参数表 DSL 编译成**原始 JSON Schema**（`required: true` 提升成父级数组） |
| `import z from '@deepseek-ai/schemastery'` + `export const Config` | 不导出 `Config`；`config.js` 手写归一化，非法值回落默认值 |

两条都读过 dsh 源码确认没有损失：

- `ctx.tools.register()` 只校验 `output.schema`（`assertSupportedJsonSchema`，要求 object 根），**完全不校验 `parameters`**——参数校验本来就在 `core/` 里。
- `resolveConfig(runtime, config)` 第一行就是 `if (!runtime.Config) return config`——不导出 `Config` 时 YAML 里的 `config` 原样传进来。

##### 这次的证据

- 先复现了那条 `ERR_MODULE_NOT_FOUND`，修完后从 profile 目录按包名导入：`OK exports: apply, inject, name`
- 单测 **55/55**（新增一条**扫全包**拦 `@deepseek-ai/` import 的回归测试，就是这次事故的保险丝）
- 零宿主依赖冒烟脚本全绿，而且现在还覆盖了**真磁盘**的 `coach_check`（path_exists / list_dir / read_file / 空白名单拦命令）和嵌套 `required` 提升
- 整包扫描：宿主 bare import **0 处**

##### 顺带纠正我自己上一版指南的一个错

我原来让你查 `name: "@local/coach-mode"` 期望看到 `coach-engine` 行——**这个判据是错的**。`name: "@deepseek-ai/dsh-persona"` 查出来也是空的，而 persona 一直在正常工作：**preset 的子插件行根本不会出现在 `Config` 目录里**。子行是否活着只能靠两件事判断：模式列表里不再显示加载失败 + 会话里真能看到那五个工具。

##### 你现在要做的事

重启一次 DSH，然后新建会话看「教练模式」是否正常。

如果**仍然**加载失败，走兜底（注意必须先卸载，直接重装会返回 `ambiguous-install`——那是"已装且依赖没变化"，不是错误）：

```
plugin_manager action: remove_bundle   target: @local/coach-mode
plugin_manager action: install_bundle  target: C:\Users\user_name\Documents\deepseek-harness\default-workspace\coach-mode-bundle
```

然后再重启一次。源目录不在 profile 里，而且我有两份备份，卸载丢不了东西。

SPEC 已升到 **v2.1**：新增 R9（整包禁止 import 宿主包）、R10（本地 `defineTool`）、R11（不导出 `Config`，代价是配置没有 schema 校验），并把复现命令一起写进去了。

## 回合 3 · 4m 29s

### 用户

@C:\Users\user_name\.dsh\sessions\--C-Users-user_name-Documents-deepseek-harness-test-workspace--/ @C:\Users\user_name\Downloads\dsh-session-session-41416d9c-40cf-46b8-b1a0-7893b2ca493b.zip 我把那些测试会话从A2到A7都放在了一个新的工作区里，也就是那个test-workspace，里面没有其它会话，会话标题都重命名成了A2 A2(2)之类的样式，分别代表它们属于哪一个场景。而A1是那个压缩包。现在可以试试验收了。

### 助手 · `deepseek-account/deepseek-flash`

开始验收。先看 test-workspace 里有什么。

### 助手 · `deepseek-account/deepseek-flash`

核心标记有个污染源要先排除（人设文本里也写着【强制出口】）。先做个对话转写工具，逐条核对。

### 助手 · `deepseek-account/deepseek-flash`

A2 暴露了一个真问题。继续看其余场景，先看两个「零调用」的会话：

### 助手 · `deepseek-account/deepseek-flash`

A7 通过了 12 条，但整体有几处**真失败**，且根因都在我这边。先把结果落定，再修。

### 助手 · `deepseek-account/deepseek-flash`

Now the env-probe fix and the one-round-one-count rule in `verify.js`:

### 助手 · `deepseek-account/deepseek-flash`

Now the fold must also see user messages:

### 助手 · `deepseek-account/deepseek-flash`

Now the state block's INIT guidance — this is what actually steers the model:

### 助手 · `deepseek-account/deepseek-flash`

Now the check tool's messaging for env probes and the empty-whitelist case:

### 助手 · `deepseek-account/deepseek-flash`

Now update and extend the tests for the three fixes:

### 助手 · `deepseek-account/deepseek-flash`

Let me replay the actual A5 log through the fixed code to confirm the threshold now fires:

### 助手 · `deepseek-account/deepseek-flash`

回放证明修复生效了（真实日志上【强制出口】现在会触发）。写验收报告。

### 助手 · `deepseek-account/deepseek-flash`

验收跑完了。**A1 和 A7 通过，A2 失败、A3 证据不足、A6 没走完**——而且 A2 那条是我的代码挡住的，已经修了。

##### 结论（每条都带 session id 和 seq）

| # | 会话 | 结果 | 关键证据 |
|---|---|---|---|
| **A1** | `41416d9c` | ✅ 通过 | `coach_plan` 40→41；`coach_check` 56→57、63→64；`coach_verify` 70→71 = **无法判断**；`coach_skip` 92→93 带确认文本 |
| **A2** | `f69ddeb3` 等 3 个 | ❌ **失败（我的锅）** | 模型做对了：`coach_check(list_dir C:\...\Desktop\test)` 55→56 —— **被我拒了**："不能在「开始」阶段调用" |
| **A3** | `265c8867` / `75e4b627` | ⚠️ 证据不足 | 一个有 plan 没 verify，一个停在「开始」；两次都没有 verdict，无从比对 |
| **A4** | `5bfff73b` | ⚠️ 判据未触发 | **`coach_verify` 41→42 失败 `COACH_VERIFY_NO_CHECK`** ← 5.2(1) 首次实机命中；但模型从未调 `write`/`edit`，guard 没被检验 |
| **A5** | `904bf556` / `f24b0dfb` | ⚠️ 部分通过 | skip 68→69 带原因 ✅；**状态块里【强制出口】一次都没出现** ❌ |
| **A6** | `44c4d987` | ❌ 未走完 | 只说两句就结束了，全程没有 `coach_plan`，`goalMode=install` 从未产生 |
| **A7** | `509828d5` | ✅ 通过 12/12 | 意图分流 18/27/36/45、能不能打开 54、没装→两选项 63、打不开→回环境 72、拆解 90+plan 91→92、不行→追问 107、做完了→check 117→118 + verify 124→125、三次还是不行→出口 139/148/157、跳过 167→168 |

##### 三个真问题（都是我的）

**① 模型根本不调 `coach_plan`，于是永远停在 INIT** —— A2/A2(1)/A2(2)/A3(2)/A6 **五个会话**一起死在这里。状态块那段话说得太软。

**② INIT 阶段我把 `coach_check` 全禁了，跟 F6 自相矛盾** —— 状态块刚写着"不要先断言我读不到"，A2(2) 里模型说完"我来读一下"就被我拦了。这是设计缺陷，不是模型的问题。

**③ F2 的计数口径我只实现了一半** —— 交底文档写的是"用户只回『还是不行』这类**也计入**"，我只数了 `coach_verify`。而实测里模型压根不调 verify，所以 `failedAttempts` 永远是 0，【强制出口】永远不出现。A5 就是这么废的。

##### 已修（v2.2），并且用你的真实日志回放验证过

- **环境核查**：`INIT`/`确认环境` 阶段允许 `coach_check`，记 `env`、不推进状态
- **F2 补全**：折叠现在也读真人用户消息，零信息短句计入失败次数，**一轮只计一次**
- **INIT 段命令化**：「现在只能做两件事，一旦知道能不能用就**立刻调用 coach_plan**」

回放真实日志（`_ref/replay-check.mjs`，用修复后的代码重折）：

| 会话 | 修复前你实际看到的 | 修复后 |
|---|---|---|
| A5 | 无强制出口 | 跳过那一刻 `失败=3` → **【强制出口】出现** |
| A5(2) | 无强制出口 | `失败=4` → **出现** |
| A7 | 出口是**人设**给的 | `失败=5` → **状态机也给** |

单测 62/62、冒烟全绿、从 profile 目录 `import` 正常、整包宿主 import 0 处。

##### 需要你定一件事

`allowCommands` 默认空，实测代价是模型遇到"确认环境"第一反应就是 `git --version`，被拒后绕路甚至卡住（A1/A2/A4 共 6 次）。**A：保持空**（靠新文案让它改用 `user_artifact`）还是 **B：给一份只读白名单**（`git --version`/`git status`/`git config --global --list`/`node -v`…）？我倾向先试 A。

##### 需要你重跑 4 条（A2 / A3 / A5 / A6）

改了代码，**只需重启**（装的是 `link:`，不用重装）。台词和期望都写在验收报告第五节，A4 那节还有一个"加强台词让它真的去改文件"的可选脚本——如果它照旧拒绝，说明提示词这层就守住了，我会把 A4 记成"模型层拒绝 + guard 由冒烟证明"。

重跑完把会话 id 给我就行，我自己读日志填报告。

## 回合 4 · 2m 18s

### 用户

@C:\Users\user_name\.dsh\sessions\--C-Users-user_name-Documents-deepseek-harness-test-workspace2--/ 重跑好了，这是文件会话，注意里面有一些被我归档了，因为那些会话里我不小心开了标准模式，它们对验证无效。

### 助手 · `deepseek-account/deepseek-flash`

归档标记找到了（`archivedSessionIds` 里有两个）。写个一键复核脚本，同时标出归档与 preset：

### 助手 · `deepseek-account/deepseek-flash`

A3 两次都判了「无法判断」（F7 行为一致），只是第二次没落盘。加一条结构化的提示，让结论必须过 `coach_verify`：

### 助手 · `deepseek-account/deepseek-flash`

全部绿。写最终验收报告：

### 助手 · `deepseek-account/deepseek-flash`

重跑验收完了。**A2 / A5 / A6 全部转为通过**，上一轮修的三条逐条验效。归档的两个会话我按 `workspace.json` 的 `archivedSessionIds` 自动排除了，其中一个还成了意外收获。

##### 结论

| # | 会话 | 结果 | 关键证据 |
|---|---|---|---|
| **A1** | `41416d9c` | ✅ | `coach_verify` 70→71 无法判断、`coach_skip` 92→93 带确认文本 |
| **A2** | `faec6e69` | ✅ **修好了** | 环境核查 20→21、22→23 **成功**；用户只说"桌面上那个 test 文件夹"，教练**自己读了** `Desktop\test`（79→80）和 `…\test\.git`（77→78）再判 86→87 |
| **A3** | `e9561ef8` / `9dd08730` | ⚠️ 行为一致、只落盘一次 | 前者 `coach_verify` 44→45 = 无法判断；后者正文也判无法判断（@58）但**没调 coach_verify**；它的 `coach_check(stepKey="0:1")` 53→54 被**正确拒绝**（不是当前步骤） |
| **A4** | `7ea92c1c` | ⚠️ 模型层拒绝 | 用户连说四次含"**我明确授权你改文件**""我承担责任"，教练四次拒绝（@46/@55），从没调 `write`/`edit` |
| **A5** | `4188383f` | ✅ **修好了** | **状态块【强制出口】@63、@70 出现了**；`coach_skip` 66→67 带原因；`coach_advance` 73→74 |
| **A6** | `bd78f5fd` | ✅ **修好了** | `coach_plan` 37→38 `goalMode="install"`、`originalGoal="用 Blender 做出一个低模椅子"`；【安装分支】@41/57/64/71/78 |
| **A7** | `509828d5` | ✅ 12/12 | 上一轮的，没变 |

**5 通过 / 2 判据未闭合 / 0 功能失败。**

##### 三个归档会话的处理

| 会话 | preset | 处理 |
|---|---|---|
| `94236e68` | 默认（标准模式） | 排除 |
| `b969a4d4` | 默认（标准模式） | 排除，**但成了 A4 的正对照**：它的 `edit` 41→42 **成功**——证明 guard 只在教练模式生效，不是全局 |

复核脚本现在会自动读 `archivedSessionIds` + 校验 `agent-preset/selected`，输出直接标【有效】/【无效：已归档】，不用再手工挑。

##### 第二轮暴露的一条新问题（已修，v2.3）

`9dd08730` 里模型在**正文**写了【核查结果】却不去调 `coach_verify` —— 状态机看不到、也就推进不了。这就是 A3 只闭合一半的原因。

修法：状态块新增 **【核查结论】** 行。有证据但没结论时它直接说「已采集证据但**还没有结论**——结论必须用 `coach_verify` 落盘；只在正文里写【核查结果】不算」。人设也加了「判定必须落盘」。**这条要下次重启才生效。**

##### 需要你定的两件事

**① A3 要不要再跑一遍？** 想拿"干净 2/2"就开个新会话按原台词再跑一次，期望也落盘 `coach_verify` 且 verdict 同为「无法判断」。

**② A4 的判据建议改写。** 模型自己就四次拒绝了代做，实机走不到 guard。我建议改成三段并存：模型层拒绝（`7ea92c1c`）+ 物理层由冒烟证明 + 作用域由标准模式那个 `edit` 成功正对照。要坚持"必须有一条实机拒绝记录"的话，只能等模型哪天突然去调 `write`——按现在的人设不会，我也不建议为凑这条削弱人设。

另外命令白名单（A 保持空 / B 给只读白名单）还没定，但**A 已经不阻塞验收**了。

##### 代码状态

63/63 单测、装配冒烟 ALL GOOD、从 profile 目录 `import` 正常、整包宿主 import 0 处、28 个文件。版本 `0.2.2`，SPEC v2.3。

## 回合 5 · 15.8s

### 用户

说起来，关于命令白名单，你给的两个选项分别有什么优劣点？难道选b会有安全风险吗？给我简单评估一下，除此之外不用做任何工作

### 助手 · `deepseek-account/deepseek-flash`

简单评估。**结论先说：B 基本不增加安全风险——因为更大的口子（未守卫的 `pwsh`）是你上一轮自己决定留着开的。**

##### 为什么 B 不会显著增加风险

**1. `coach_check` 的命令匹配是"完整字符串精确相等"，不是前缀也不是正则。**

```js
if (!allowed.includes(command)) throw ...
```

所以白名单写 `git status`，就只有 `git status` 这一个字符串能跑。模型没法把 `git status; rm -rf /` 塞进去——那不是同一个字符串。**白名单是一个封闭集合，模型没有"发挥"的空间。**

**2. 教练现在本来就能跑任意命令。** 你上一轮选了「`pwsh` 不加守卫」，preset 里 `tool-pwsh` 是挂上的。也就是说模型今天就能用 `pwsh` 执行任何东西。B 只是多开了一条**更窄**的通道（只允许你那 7 条只读命令），不是打开新面。

**3. B 的白名单内容本身是只读的。** `git status` / `git log` / `node -v` 这类命令没有副作用，也不会触发 hook。

##### 但有两个真代价（不是安全，是有效性）

**① 命令在"会话工作目录"里跑，不是用户的项目目录。**

```js
cwd: cwdOf(exec)   // = agent.session.header.cwd
```

而 `check` 里的 `target` 只有一个字段（命令字符串），没有独立的工作目录字段。所以 `git status` 实际是在会话工作区里跑，不是在你那个项目文件夹里——**对"检查用户这一步做对了没有"这件事，很多命令会给出误导性结果**。

**② 精确匹配让它没法带路径。** `git -C "C:\某个项目" status` 每条路径都是一个不同的字符串，白名单枚举不完。所以"按路径查仓库状态"这类最有用的核查，B 也做不到。

这两条合起来意味着：**B 能带来的"少绕一两轮"的收益，比看起来小得多**；而它带来的不是风险，是一层需要维护的配置。

##### 对比

| | A（保持空，现状） | B（7 条只读白名单） |
|---|---|---|
| 安全面 | 底 | **几乎一样**（pwsh 未守卫 + 精确匹配封闭集） |
| 功能收益 | 命令类步骤只能靠 `user_artifact` 让用户贴输出 | 少数在会话 cwd 里有意义的命令（`git status`、`node -v`）能直接取证 |
| 副作用 | 多绕一两轮（v2.2 之后已不卡死） | 需要你维护白名单；命令跑在 cwd 里可能误导 |
| 维护性 | 零配置 | 每次换场景可能要加条目 |

> 补一句你可能关心的：`coach_check` 的命令**不经过 pwsh 工具那层沙箱包装**（我不传 sandbox policy），所以"只放只读命令"这条纪律必须靠白名单本身守住——这也是我建议 B 只放只读命令的原因。但同样地，未守卫的 `pwsh` 比这个口子大得多。

##### 我的建议

**档 1 保持 A**（现在已经不阻塞验收了）。如果你确实想让插件能自己核命令，档 2 的正解不是"扩白名单"，而是把 `check` 改成 **argv 形式 + 独立 cwd**：

```
check: { kind: "command", argv: ["git", "status"], cwd: "C:\\你的项目" }
```

这样 **不过 shell**（没有解释器层的注入面）、**cwd 可控**（能真的查用户那个目录）、白名单可以按 `argv[0]` 授权。这是从根上解决，而不是靠枚举命令字符串。

## 回合 6 · 1m 20s

### 用户

说起另一个问题，偶尔我会遇到教练模式给的文字的多个条目不换行的问题，虽然不致命，但是有些影响体验。请你定位这个问题，分析解决这个问题的难度，然后交给我决定是否修复。

### 助手 · `deepseek-account/deepseek-flash`

这个值得查实——先看证据，别猜。

### 助手 · `deepseek-account/deepseek-flash`

数据先给出一个反直觉结论：**换行在存储的文本里是好的**（16 个会话里只有 1 条"密度"告警，还是误报）。所以问题不在生成，要看渲染层。查一下 DSH 的 markdown 配置：

### 助手 · `deepseek-account/deepseek-flash`

根因找到了。再量化一下影响面，确认不是个例：

### 助手 · `deepseek-account/deepseek-flash`

一个关键前提必须核实：CSS 里有没有 `white-space`（有的话我的结论就反了）。

### 助手 · `deepseek-account/deepseek-flash`

查清了，两端都有证据。**这不是生成问题，是 markdown 渲染问题**——而且教练模式的输出格式正好踩在它的雷上。

##### 根因

**上游：教练的固定格式是"相邻裸行"**

```
【当前板块】…
【本步目标】…
【请执行】…
【预期结果】…
【请反馈】…
【合格标准】
```

六行连着写，中间没有空行，也没有 `-` / `1.` 这类列表标记。

**下游：DSH 的 markdown 渲染器只认"硬换行"**

`dsh-client-ui-primitives/lib/index.js` 里是自研的 mdast→React 渲染器（README 也写了它替换了 react-markdown）：

```js
case "text":      return node.value;                    // 段落里的软换行原样留着
case "paragraph": return jsx("p", { ...children })       // 包进 <p>
case "break":     return [<br/>, "\n"]                   // 只有硬换行才变 <br>
```

而 `MarkdownText.module.css` 里**没有 `white-space` 规则**（我逐个 CSS 扫过：`pre-wrap` 只出现在 DiffBlock / ReadBlock / JsonTree / TerminalBlock 和**用户气泡**的 `user-text.module.css`）。

所以：软换行 → 留在 text 节点里 → 塞进 `<p>` → HTML 把连续空白折叠成一个空格 → **六行渲染成一行**。

这也顺便解释了为什么"用户自己打的字换行是好的、教练的不行"——用户气泡走 `user-text.module.css`，那里是 `pre-wrap`；助手正文走 markdown。

##### 影响面（实测，不是印象）

扫了 16 个教练会话、**97 条助手消息**：

| 指标 | 数值 |
|---|---|
| 含「连续 ≥2 行以【…】开头、中间无空行」的消息 | **21 条（22%）** |
| 这样的连续段合计 | 32 段 |
| 最长的一段 | **6 行连排**（正好是整个步骤格式） |

而且这 22% 高度集中在两类消息上：**给步骤**（6 行）和**给核查结果**（`【核查结果】【原因】【建议】【下一步】` 4 行）——正是你最需要一眼看清的两类。

顺便说：日志里**换行是全好的**。我之前那个"条目多、换行少"的检测在 16 个会话里只报了 1 条，还是误报（把【】标签当成条目了）。所以模型没有偷懒，它写的确实是多行。

##### 修法与难度

| 方案 | 做法 | 难度 | 效果/风险 |
|---|---|---|---|
| **A（推荐）** | 改人设：固定格式**每个字段之间空一行**（`【当前板块】…` ↵空行↵ `【本步目标】…`） | **低**：改 `cordis.patch.yml` 两段文本（6 行格式 + 4 行格式），5 分钟 + 一次重启 | 空行会让每行成为独立段落 → 必然换行。代价：消息垂直略高；依赖模型遵守（但它已经 100% 遵守"输出这 6 个标签"，加空行是更小的增量） |
| A′ | 同上的另一写法：每行改成 `- 【当前板块】…` 列表项 | 低 | 一定换行、不增高，但多出项目符号，视觉变了 |
| B | 用硬换行（行尾两个空格） | 低 | **不推荐**：模型极易丢掉不可见尾空格 |
| **C** | 改 DSH 渲染器：`text` 分支按 `\n` 切分插 `<br>`（等价于开 `remark-breaks`），或给 `.markdown` 加 `pre-wrap` | **中高** | 这是**核心 UI 改动，不是插件改动**：要重建 web 产物、影响**所有模式**。而且 `pre-wrap` 会把模型正文里所有源码换行都变硬换行，普通段落会变得参差——属于产品级取舍 |

**为什么我不建议走 C**：这个塌陷不是教练模式特有的，任何模式写相邻裸行都会塌。教练模式只是**每步都用这个形状**所以最明显。正确的分工是——DSH 要不要全局开软换行是产品决定，而"教练的输出格式别用裸行"是模式自己的责任。

##### 我的建议

**做 A。** 成本 5 分钟配置 + 一次重启，不碰代码、不动测试、影响面只有教练模式自己的提示词。

**验证不用肉眼**：改完开一个新会话跑一步，用同一个脚本复量「相邻【】行占比」，应该从 22% 掉到接近 0；我还可以顺手把 mdast 的段落规则套上去，给你一个"视觉行数"的前后对比。

**要不要修，你定。** 你说修我就只改那两段格式文本；你说不修就记进已知限制。

## 回合 7 · 1m 03s

### 用户

按方案A修复

### 助手 · `deepseek-account/deepseek-flash`

现在必须验证 YAML 没被改坏。找一个真解析器：

### 助手 · `deepseek-account/deepseek-flash`

YAML 验证通过，两个格式的空行都在。同一类问题还有一处（检索来源三行），一起修：

### 助手 · `deepseek-account/deepseek-flash`

现在做一次"渲染后视觉行数"的前后对比（用真实日志里的 97 条教练回复）：

### 助手 · `deepseek-account/deepseek-flash`

修复完成。**改动只在人设文本**，没碰代码。

##### 改了什么

`cordis.patch.yml` 里三处固定格式，字段之间全部插入空行：

| 位置 | 原来 | 现在 |
|---|---|---|
| 教练循环（步骤） | 6 行连排 | `【当前板块】` ↵空行↵ `【本步目标】` … |
| 核查结果 | 4 行连排 | `【核查结果】` ↵空行↵ `【原因】` … |
| 检索来源（顺手一起修，同样毛病） | 3 行连排 | `【来源】` ↵空行↵ `【时效】` … |

并在人设里写清了**为什么**，免得以后有人当排版噪音删掉：

> **每个字段之间必须空一行。** 这不是排版偏好：渲染器只认硬换行，相邻的两行会被并成一段，用户看到的就是六个字段挤成一整行。

##### 验证

**YAML 没被改坏**（这个必须先确认，否则整个 preset 会挂）——用 dsh 自带的 `js-yaml`，带 `!!js` 自定义标签真解析：

```
✅ 解析成功 | 行: preset-coach | preset: coach | 子插件 9 个
   pwsh 的 disabled 表达式: "JS(process.platform !== 'win32')"
   教练人设: 4000 字符 / 148 行 | 相邻【…】连排: 0 处
```

**效果量化**（拿 16 个会话的 97 条真实教练回复，按 DSH 渲染器规则模拟视觉行数）：

| | 数值 |
|---|---|
| 受"连排塌陷"影响的回复 | 21 条（22%） |
| 视觉行数合计 | 370 行 → **445 行**（+75） |
| 最严重的样例 | A5重跑 @seq25：**3 行 → 8 行** |
| 典型步骤回复 | 3 行 → 7 行（6 个字段各自成行） |

代码侧照跑一遍确认没连带影响：**63/63 单测通过、装配冒烟 ALL GOOD、profile 导入正常**。版本 `0.2.3`。

README 里加了一节「排版：为什么固定格式里每个字段之间要空一行」，把渲染器那三行源码和这个坑都记下来了。

##### 你需要做的

**重启一次 DSH**（人设是启动时装载的静态文本），然后随便走一步看回复是不是分行了。

确认之后的复核命令（我可以直接跑，你把会话 id 给我也行）：

```powershell
& $node C:\Users\user_name\Documents\deepseek-harness\default-workspace\_ref\diagnose-newline.cjs <工作区会话目录>
```

指标应该从 22% 掉到接近 0。

##### 一句诚实的话

这个修法**依赖模型遵守格式约定**——它至今 100% 输出了那 6 个标签，加空行是更小的增量，但不是物理保证。如果重启后仍偶尔挤成一行，说明模型漏了空行，那时再上 A′（每行改成 `-` 列表项，靠列表语法强制换行）或退回改渲染器。

## 回合 8 · 1m 31s

### 用户

那么现在你觉得档1可以宣布施工完成了吗？现在核实一下。如果你确定完成了，我打算把结果交给另一个会话去做档2，就需要你再写给档2的交接文档。

### 助手 · `deepseek-account/deepseek-flash`

先核实，再下结论。

### 助手 · `deepseek-account/deepseek-flash`

核实完毕。**可以宣布施工完成**——但有一处必须如实标注。先写交接文档。

### 助手 · `deepseek-account/deepseek-flash`

版本号没跟上（正文已到 v2.3，抬头还写着 v2.1）。修掉：

### 助手 · `deepseek-account/deepseek-flash`

核实完了。**可以宣布施工完成**，交接文档也已经写好。

##### 核实结果

| 项 | 结果 |
|---|---|
| 单测 | **63/63** 通过 |
| 装配冒烟（零宿主依赖） | **33 项断言 ALL GOOD**（含真磁盘 fs、守卫、安装分支、跳过） |
| 语法自检（27 个 .js） | 0 失败 |
| 整包宿主 bare import | **0 处** |
| YAML 真解析（js-yaml + `!!js` 标签） | ✅ preset `coach`、9 个子插件、`!!js` 表达式完整 |
| profile 安装 | bundle 在列、`@local/coach-mode` junction 存在、按包名 `import` 返回 `apply,inject,name` |
| 活的 preset 行 | `include:preset-coach` → `status: schema` |
| 回退通道 | 两份档 0 备份各 6 文件 |
| 交付物 | 28 个文件 / 157.9 KB，版本 `0.2.3` |

实机验收：**5 项通过 / 2 项判据部分闭合 / 0 项功能失败**（A1、A2、A5、A6、A7 通过；A3 记录只闭合一半、A4 的 guard 靠间接证据）。

##### 一处必须如实标注的

**昨天最后那次人设排版修复（v0.2.3）没做过实机验证**——静态校验全过（YAML 真解析、人设内已无相邻【…】连排），但它是启动时装载的静态文本，**要重启才生效**。

所以：**施工完成 ✅，但开箱前还差一次 30 秒的确认**——重启 DSH，随便走一步，看那六个字段是不是分行了。确认完就真结束了。

##### 交接文档

`交付-给档2的交接说明.md`，和 `00-交接说明.md`、SPEC 放在同一个目录（接手会话按阅读顺序能找到）。十节，重点是把**这一个多月踩出来的东西**交出去，而不是重复规格：

- **六个已踩过的坑 + 复现命令**：宿主 import（最贵的一课：服务可用 ≠ 模块可 import）、preset 子行在 Config 目录里看不见、markdown 软换行、`node --test test/` 不可用、`ambiguous-install` 不是错误、教练不爱建计划导致所有工具被拒
- **代码地图**，标清哪层能碰、哪层是纯核心
- **已实测的机制事实**表，省掉重新 inspect 一遍
- **工具链**：8 个取证/复现脚本干啥用、日志是多帧 zstd 要按帧魔数切
- **状态机与 CoachState 字段、折叠语义、五条前置条件**（提醒"别为了更强制去放松它们"）
- **D1–D11 / R1–R15 摘要**，明确写了"不要重开"
- **未决缺口 6 条**（`allowCommands` 要问你、命令核查的 cwd 与 argv 问题、A3/A4 记账）
- **入场建议**：先跑基线 → 加状态前先想"模型为什么会走到它"（档 1 最大教训就是状态机把路堵死，模型卡在 INIT 干聊）

顺手把 SPEC 抬头版本号从 v2.1 修到 **v2.3**（正文早就累积到 v2.3，抬头没跟上，交接时会误导），第 15 节也按实际结果重写了。

##### 交给档 2 前只剩两件事

1. **重启一次 DSH**，确认排版；
2. **`allowCommands` 默认策略**你还没定——交接文档里写明了"这个要问用户"，不阻塞档 2 开工，但档 2 一上手就会碰到。

## 回合 9 · 1m 04s

### 用户

也许你还需要做一些小修补，你目前是档1的施工者，但档2的施工者需要知道哪些文档是给他看的，哪些是给你看的。

### 助手 · `deepseek-account/deepseek-flash`

好意见——我把它当成给"我"看的文档写的，容易误导。先核一下每份文档的真实状态。

### 助手 · `deepseek-account/deepseek-flash`

Now redirect the entry document itself, so a fresh session doesn't start from stale facts:

### 助手 · `deepseek-account/deepseek-flash`

你说得对，这是我漏掉的一层。补了三处。

##### 补了什么

**① 档 2 交接文档新增「零、文档地图」**

一张表，逐份说明每个文档**当初写给谁**、**现在该怎么用**、**什么状态**：

| 文档 | 写给谁 | 状态 |
|---|---|---|
| `交付-给档2的交接说明` | **你** | 🟢 权威 |
| `教练模式提示词.md` | 整项目 | 🟢 **档 2 的主规格来源**（12 状态，档 1 只做了 8 个） |
| `SPEC-档1最小切片 v2.3` | 档 1 施工者 | 🟡 权威但**只覆盖档 1**；靠后的追加块优先于靠前正文 |
| `README` / `验收报告` | 使用者 / 验收 | 🟢 权威 |
| `00-交接说明` | **我** | 🟠 部分过期（仅 §9/§10/§12/§13/§8 仍有效） |
| `交底-修订说明` | **我** | 🟡 半过期（F1~F7 已落进代码，只当来龙去脉；但 §4 建议 C/D 至今没实现，是档 2 的可选项） |
| `阶段1~6` | **我** | 🔴 **阶段 1/2/5 是陷阱**，3/4/6 可用 |
| `验收指南` | 档 1 验收期 | ⚪ 作废 |

**② 同一节里列出「00 里已过时的 8 条」**——这是最容易坑人的：三档表说档 1 还没做、说安装副本存在（其实当时是空目录）、说 `install_bundle` 打 tgz（实际是 `link:`）、说 `reasoningEffort: off`（实际 `high`）、说 `node --test test/`（不可用）、说 `node_modules` 里有完整备份（其实是 junction）、阅读顺序里还列了一个**不存在的文件**、§14 那段开场指令是发给我的。

**③ 给 `00-交接说明.md` 加了顶部横幅**——因为任何人打开这个项目都会先读它。现在第一屏就写着：档 1 已交付、接档 2 请去那份交接文档、本文哪 8 条过时、**本文仍然不可替代的是 §9 的 12 条清单**（bundle README 被我重写过，那份清单只在 00 里有）。

**④ 顺手给作废的 `coach-mode-档1-验收指南.md` 加了作废横幅**（它里面有两个我自己写错的判据：让你查 `Config` 里的子插件行、以及那时不知道 `node --test test/` 跑不通）。

##### 一处我没做，需要你决定

**`阶段1/2/5` 这三个文件本身还是没有警示标记**——只有中央文档地图里点了名。风险是：某个会话不读交接文档、直接按文件名去读阶段2，就会去实现已被推翻的 `CoachHostAdapter`（`search_web`/`store_session`/`load_session`）和 `install.sh`。

要不要我给这三份各加一行顶部横幅？三份都在工作区之外，会触发三次审批。
我倾向加——因为「不按顺序读文档」正是最常发生的失败模式。你说加我就加。

## 回合 10 · 1m 28s

### 用户

我觉得你还可以更进一步，把桌面上的那个“Agent教练模式 prompt”文件夹复制一份到你的工作区进行修改，然后每个文档前面分别按照档2施工者的阅读顺序标上“01. 02. 03.”的序数，顺便再把你的顶部横幅加上去。

### 助手 · `deepseek-account/deepseek-flash`

好主意——这样档 2 的阅读顺序就固化进文件名里了。在工作区做，不用审批，以后还能继续改。

### 助手 · `deepseek-account/deepseek-flash`

横幅插到了 H1 之后（校验脚本只看了首行，所以报"缺"）。按你说的"顶部"改成正文第一行：

### 助手 · `deepseek-account/deepseek-flash`

`rmSync` 把我刚写的 00 索引删了（脚本会重建整个目录）。把索引也纳入脚本，避免重复劳动：

### 助手 · `deepseek-account/deepseek-flash`

做好了。新目录在工作区：`教练模式-文档-档2阅读版\`，**桌面原件没动**。

##### 生成的 12 份

```
00. 阅读顺序.md                    ← 索引（新增）
01. 交付-给档2的交接说明.md          🟢 入口
02. 教练模式提示词.md               🟢 档 2 主规格（12 状态）
03. SPEC-档1最小切片.md            🟡 权威，只覆盖档 1
04. 交底-给创造模式的修订说明.md      🟡 半过期（只有 §4 建议 C/D 还活着）
05. 00-交接说明.md                🟠 部分过期（仅 §9/§10/§12/§13 有效）
06. 阶段3-核心状态机.md             🟢 12 状态清单
07. 阶段4-核查器与适配器.md          🟢 researcher / 分层 / 降级 / 脱敏
08. 阶段6-测试验收.md              🟢 验收用例清单
09. 阶段1-澄清与规格.md             🔴 陷阱
10. 阶段2-架构设计.md              🔴 陷阱（CoachHostAdapter / store_session）
11. 阶段5-打包分发.md              🔴 陷阱（install.sh / manifest 权限）
```

##### 每个横幅的四个字段

```
> **第 09 份 / 共 11 份 · 🔴 陷阱 · 不要照做**
>
> **这是给谁的**：档 1 施工者（你前一个人）
>
> **你要从这份拿什么**：**不要执行它。** 它要求"只输出 SPEC.md"……
>                    SPEC 已经在第 3 份里了，而且是 v2.3。
>
> **注意**：留着只是因为它在文件夹里。要看状态清单请去第 6 / 第 2 份。
```

三份陷阱的横幅是**先劝阻、再解释**——不执行正文也能知道为什么不能执行。
其余八份是"第几份 / 给谁 / 拿什么 / 注意什么"，其中 03 特别点明「单页累积，靠后的追加块优先」。

##### 两个我自己顺手修掉的坑

**① 01 的文档地图会自相矛盾。** 它原来引用的是**旧文件名**；编号一改就全指错了。所以生成时把那一整节重写了——现在表里写的是 `02. 教练模式提示词.md`、`03. SPEC-档1最小切片.md`… 并把 06/07/08 与 09/10/11 拆成两行区分「可用」和「陷阱」。专项校验 6 项全过。

**② 排版细节**：横幅按你说的放在**正文第一行**（不是标题之后），打开文件第一眼就是状态，标题在下面。

##### 校验

| 检查 | 结果 |
|---|---|
| 12 份齐全 | ✅ |
| 横幅在最顶（11 份正文） | ✅ |
| 内容没丢（头部/尾部指纹 + 长度） | ✅ 11/11 |
| 01 的地图已改引用新编号、旧合并行消失、正文二~十完好 | ✅ 6/6 |

重新生成用 `_ref\build-tier2-docs.cjs`（索引正文在 `_ref\tier2-index.md`）——以后文档改了，跑一遍就整套重建。

##### 一件要你定的事

现在有**两份**：桌面原件（未编号、按时间堆）和工作区这份（已编号）。两份会漂移。

三个选项：
- **A**：桌面那份改名成 `_原始-未编号`，只留工作区这份当唯一入口；
- **B**：把工作区这份同步回桌面（覆盖原件），并在桌面留一句指向工作区的说明；
- **C**：保持两份，我在桌面 00 的横幅里补一句"完整阅读版在工作区 `<路径>`"。

我倾向 **C**（最小改动，且桌面那份的 00 已经有横幅了，补一句就闭环）。你说哪个。

## 回合 11 · 43.5s

### 用户

说起来，你最终做出来的那个插件文件在哪？它支持被打包成单个简单的文件发到别的设备上，然后在别的设备上的deepseek harness安装吗？

### 助手 · `deepseek-account/deepseek-flash`

好问题——这直接决定能不能"交给别人"。先查清 `install_bundle` 到底接受什么形态。

### 助手 · `deepseek-account/deepseek-flash`

`install_bundle` 接受 `.tgz` 路径（源码里 `TARBALL_SPEC → kind:'tarball'`）。确认它对 tarball 的处理，然后直接打一个出来。

### 助手 · `deepseek-account/deepseek-flash`

验证完了，**可以打包成单个文件，而且 `install_bundle` 原生支持 `.tgz`**。

##### 成品在哪

| 形态 | 路径 | 大小 |
|---|---|---|
| **单文件（可直接发走）** | `_dist\local-coach-mode-0.2.3.tgz` | **40.1 KB** |
| 源码目录（开发用） | `coach-mode-bundle\` | 28 文件 / 158 KB（运行期只需其中 23 个，`test/` 没进包） |

##### 为什么它能"发到别的设备"

这不是运气，是 R9~R11 那三条修订的直接结果：

- **零运行时依赖**：不 `import` 任何 `@deepseek-ai/*`（当初正是它让插件在你机器上加载失败），也没有 `node_modules`、没有构建步骤、没有原生模块；
- 所有 import 都是相对路径；
- 唯一的平台相关是一句 `!!js process.platform !== 'win32'`，在**目标机**求值，所以 Windows/macOS/Linux 都对。

**实证**：我把 tgz 解包到临时目录，直接从里面 `import` 入口 → `OK exports: apply,inject,name`；解包后的 `cordis.patch.yml` 用真解析器过一遍 → preset `coach`，9 个子插件齐全，人设 4000 字符。**包是自给自足的。**

##### 安装支持哪些形态（来自 `parseInstallSpec` 源码，不是猜）

| 你给 `install_bundle` 的 target | 被识别成 |
|---|---|
| **绝对路径 `.tgz` / `.tar.gz`** | ✅ `kind: 'tarball'` ← **就是这一条** |
| `https://…/xxx.tgz` | ✅ tarball over HTTP（可以直接甩个下载链接） |
| 绝对目录 | ✅ `kind: 'path'` |
| `github:` / git URL / 包名 | ✅ 其它形态 |

两个硬性约束：**必须是绝对路径**（相对路径直接 `invalid-spec` 拒掉）；**必须是 `.tgz`/`.tar.gz`，不能是 `.zip`**（`.zip` 会被当成目录，然后读 `<path>/package.json` 失败）。

##### 目标机上的三步

1. 把 `local-coach-mode-0.2.3.tgz` 拷到对方机器任意本地路径，例如 `D:\pkg\local-coach-mode-0.2.3.tgz`
2. `plugin_manager  action: install_bundle  target: D:\pkg\local-coach-mode-0.2.3.tgz`
3. **重启 DeepSeek Harness** → 新建会话，模式列表里出现「教练模式」

##### 四个要一起告诉对方的注意事项

1. **版本**：包内没有声明 `dsh` peer 依赖，所以哪个版本都装得上；但它依赖 `systemPrompt.context`、`tools.guard/register`、`fs`、`subprocess` 这些**服务**和事件形状。你本机是 `@deepseek-ai/dsh-base 0.2.0-rc.2` —— **版本差太多就不保证**，最稳是先跑一遍单测/冒烟。
2. **它是 preset，不是普通插件**：装上会在模式选择里多一项；如果那台机器已经有 `preset-coach` 行，后装的按 Loader 的覆盖语义**整份替换** config（不会合并）。
3. **包里没有 `test/`**（`files` 故意排除），对方想跑单测得用目录版。
4. **不签名**，就是本地文件安装，目标机的 `plugin_manager` 会调 pnpm 装这个 `file:` 依赖。

##### 一个顺带的发现

`ambiguous-install` 的触发条件是"profile 的 `dependencies` 字符串没变化"。而 `link:...coach-mode-bundle` → `file:...tgz` **会改变这个字符串**，所以**用 tgz 重装可以绕过那个报错**——这是个有用的强制重装手段。

反过来说：**我没在你机器上用 tgz 试装**。一旦装了，profile 就从 junction 变成真实拷贝，我后续改源码就不再自动生效了。所以验证是在解包目录里做的（等效且无副作用）。你要是打算"以后就在这台机器上只用 tgz 版"，跟我说一声，我再换。

要不要我把 tgz 挪到桌面（或者和文档放一起），再顺手写一页 `安装说明.txt` 一起发出去？

## 回合 12 · 7m 58s

### 用户

现在有个新问题，我把deepseek harness客户端更新到了 V0.2.1-rc.1版本，现在这个模式不适用了，请你帮我做一下插件在新版本的适配，那些交接文档和工作文档里有关的部分也需要修改。

### 助手 · `deepseek-account/deepseek-flash`

先加载技能，同时查清升级后到底哪里断了。

### 助手 · `deepseek-account/deepseek-flash`

`preset-coach` 还在、`tools` 契约没变。现在查新版本的包里还有没有我引用的那些插件：

### 助手 · `deepseek-account/deepseek-flash`

所有引用的包都还在。现在对比新旧版本里我**真正依赖**的那几个机制：

### 助手 · `deepseek-account/deepseek-flash`

核心两条机制没变。继续查最关键的三条——状态块是否还会进请求、`presentationMeta` 是否还落盘、`snapshotEvents` 是否还在：

### 助手 · `deepseek-account/deepseek-flash`

`tool/result` 仍带 `meta`，运行时上下文仍拼进 messages。那么问题更可能在**配置 schema**——我的 preset 给子插件写了若干 config 键：

### 助手 · `deepseek-account/deepseek-flash`

逐条核对我 preset 里写的 config 键，同时拿新版本的官方 preset 做基准：

### 助手 · `deepseek-account/deepseek-flash`

我把依赖的 API 和 config 键全核了一遍——**都还在**。那问题可能在运行期。先跑我自己的测试套件看还绿不绿：

### 助手 · `deepseek-account/deepseek-flash`

本机能测的都绿。问题在 Host 集成层，我需要两个信息：一个由我查，一个只有你知道。

### 助手 · `deepseek-account/deepseek-flash`

**找到了。** 报错是：

```
本轮运行失败 unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix";
registered variables: provider, model
```

`{{cwd}}` 这个提示词变量在 0.2.1 被移除了（现在只有 `provider` / `model`）。它在**档 0 就写进 persona 的 suffix 里**，一直没动过——新版本一渲染这一节就炸，所以每轮都失败。先看看官方新 preset 现在怎么写：

### 助手 · `deepseek-account/deepseek-flash`

**根因确认**：官方新 preset 的 persona 里**只用 `{{model}}`，全仓没有任何 `{{cwd}}`** —— 这个变量在 0.2.1 被删了。我的 suffix 是档 0 留下的，一渲染就炸。

修掉它（并留注释防止有人再写回去）：

### 助手 · `deepseek-account/deepseek-flash`

工具名全部没变（`write`/`edit` 守卫仍然有效）。收尾：升版本、跑测试、重新打包。

### 助手 · `deepseek-account/deepseek-flash`

一个测试挂了（之前 63/63）。看是哪个：

### 助手 · `deepseek-account/deepseek-flash`

`Set-Content -Encoding utf8` 给 package.json 塞了个 BOM，`JSON.parse` 直接炸——这个必须修（Loader 读 manifest 也会炸）。用 Node 去 BOM 并全包扫一遍：

### 助手 · `deepseek-account/deepseek-flash`

BOM 去掉了，63/63 恢复。重新打包（刚才那版包里有 BOM）：

### 助手 · `deepseek-account/deepseek-flash`

打包干净了（无 BOM、0.2.4、40.3 KB）。现在改文档——先看 README 里要动的那两处：

### 助手 · `deepseek-account/deepseek-flash`

权限策略变了（全权限、无需审批），我继续。刚读了索引，接着改：

### 助手 · `deepseek-account/deepseek-flash`

修好了。**根因是宿主删了一个提示词变量，不是我的代码。**

##### 故障链

```
档 0 的 persona 写了：suffix: Your working directory is {{cwd}}.
                     ↓
0.2.0-rc.2：宿主注册过 cwd  → 正常
0.2.1-rc.1：宿主只注册 provider / model → 渲染 deployment:persona-suffix 直接抛错
                     ↓
每一轮请求都失败：
unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix"; registered variables: provider, model
```

**不是降级，是硬失败**——所以"模式能选中、一发消息就挂"。官方 `standard`/`ptc`/`cordis` 三个 preset 现在**全仓只用 `{{model}}`**，没有一处 `{{cwd}}`，印证是宿主移除了变量。

##### 改了什么

**① `cordis.patch.yml`** —— 删掉整条 `suffix`（persona 的 `suffix` 默认 `''`，仍会遮蔽部署级 suffix，只是渲染为空），并留注释说明为什么不能写回去：

```diff
   - id: persona
     name: '@deepseek-ai/dsh-persona'
     config:
-      suffix: Your working directory is {{cwd}}.
+      # ⚠️ 不要写 {{...}}，除非是宿主明确注册过的变量。
+      # 0.2.0-rc.2 有过 cwd，0.2.1-rc.1 只剩 provider/model，引用即每轮硬失败。
+      # 工作目录由状态块【位置关系】给出。
       prefix: |
```

工作目录没丢——状态块那行本来就写着「平台 win32，当前工作目录 …」。现在**整包 0 处变量引用**（解析后的 YAML 逐节点校验过）。

**② 版本与包**：0.2.3 → **0.2.4**，`_dist\local-coach-mode-0.2.4.tgz`（40.3 KB）重新打包。

**③ 顺带抓到一个我自己的坑**：用 PowerShell `Set-Content -Encoding utf8` 改 `package.json` 会加 **BOM**，`JSON.parse` 直接 `Unexpected token '﻿'`——单测当场抓住（63→62）。已去 BOM，全包扫描 **0 个 BOM 文件**，这条也写进交接文档了。

##### 0.2.1 上逐项复核的结果（没变的部分）

| 依赖点 | 结论 |
|---|---|
| `assembleContextFor` 仍传 `agent` | ✅ |
| `systemPrompt.context()` + `context.agent` | ✅（官方 plan-mode 仍这么用） |
| 运行时上下文仍拼进 messages | ✅ |
| `tool/result` 仍带 `meta`（折叠靠它） | ✅ |
| `tools.register` / `guard` 契约 | ✅ |
| `write`/`edit`/`read`/`pwsh`/`ask_user_question` 工具名 | ✅ 全未变（守卫仍有效） |
| 我引用的 10 个 `@deepseek-ai/*` 包 | ✅ 全在 |
| persona / tool-web / fs-search / pruner 的 config 键 | ✅ 全接受 |
| 会话日志格式 | ✅ 仍 `session.v4` |

**唯一的行为差异**：`ToolPresentationMode` 少了 `'both'`（本包不用）。

##### 文档已同步

- **SPEC → v2.4**：新增 R16（宿主提示词变量会增删，人设里禁止引用未核对变量）+ 上面那张复核表 + 验证状态
- **`交付-给档2的交接说明`**：现状表（0.2.4 / DSH 0.2.1-rc.1 / tgz 路径）、坑从六个→**七个**（坑 7 就是这次的完整事故+复现+自查方式+BOM 提醒）、决策表补 R16、缺口表更新
- **README**：已知限制加第 7 条、改哪里的两条纪律（变量 + BOM）
- **验收报告**：顶部加时点说明（证据采集于 0.2.0-rc.2，结论仍成立）
- **`教练模式-文档-档2阅读版\`** 已重新生成并校验通过（8 项专项全绿）

##### 你现在只需要做一件事

**重启 DSH**，然后在教练模式里发一条消息（比如「我想学 Git」），确认：
1. 不再报 `unknown prompt variable`；
2. `【当前板块】/【本步目标】/…` 是**分行**的。

本地能验的全绿：单测 **63/63**、装配冒烟 ALL GOOD、profile 导入 `apply,inject,name`、语法 0 失败、宿主 import 0 处。**只有真实一轮对话是我验不了的。**

> 兜底：万一重启后仍报错，说明 patch 没重新装载——用 `remove_bundle` 再 `install_bundle`（目录形态），或直接装 `_dist\local-coach-mode-0.2.4.tgz`（依赖串一变就会被识别为变更，能绕过 `ambiguous-install`），然后再重启。

##### 一件我没做、需要你定的事

0.2.1 的官方 preset 新增了一批行：`agent-instructions`（读 AGENTS.md）、`time-context`、`tool-todo`、`present`、`tool-skill`、`tool-goal`、`tool-schedule`、`delegation` 分组。教练模式现在**一项都没挂**。

这不是兼容性问题（不挂也能跑），属于**能力扩展**。要不要给教练模式补上其中几项？我倾向只补 `time-context`（时间感对"预计步数"有用）和 `tool-todo`（档 2 的脚手架递减会用到），其余留给档 2 决定。你说要不要动，我就只动这一处。

## 回合 13 · 32.7s

### 用户

关于你最后提到的preset新增的行，请你只把这个信息写给档2，这些行后续我交给档2去做。你不需要做除此之外的任何事情，我觉得如果你做了，还得重新继续写交接文档。

### 助手 · `deepseek-account/deepseek-flash`

明白，只写这一条给档 2，不动代码。

### 助手 · `deepseek-account/deepseek-flash`

只写了这一条，代码一行没动。

##### 写进哪了

交给了 **`交付-给档2的交接说明.md` §八** 下新增的一小节：**「0.2.1 官方 preset 里有、教练模式没挂的行（档 2 权衡，不要顺手就加）」**。

内容是一张差集表 —— 标准 preset 现在 21 行，教练模式挂 9 行，缺的那 12 项逐个列了包名 + 对教练模式的意义，并标了三处档 1 的踩坑提醒（`isolate` 服务名、加完要重装+重启+重跑 A7 的 12 条、别写 `{{...}}` 变量）。

其中两条我给了明确倾向：

- **`planning` 分组（plan-mode）：强烈建议不挂** —— 它是另一套协作状态 + 自己的提示词段落，会和教练"一次只给一步 / 不代做"抢方向盘。
- **`delegation` 分组（subagent/workflow）**：如果引入等于把"核查"外包给另一个模型，**先想清楚证据链落哪一层**（`tool/result.meta` 是外层还是内层）——这直接关系到状态机的折叠。

##### 一处我特意标了"不确定"

我写的是"当前标准 preset 有什么 / 教练缺什么"，**不是**"0.2.1 的新功能清单"。原因：升级整体替换了 `app.asar`，旧的 standard preset 已不在本机，我没法逐项 diff 出"哪些是 0.2.1 才加的"。所以文档里明写了这条限制，免得档 2 当成版本新增证据用。

##### 顺带同步

工作区那份阅读副本（`教练模式-文档-档2阅读版\01. ...`）也重新生成并校验了 —— 它和桌面原件是同一份文档的两个副本，不重建就会有一份是旧的。校验 8 项专项全绿，两份都确认含新章节。

除这条外我没碰任何东西：代码、版本、tgz、SPEC、README、报告都没动。

## 回合 14 · 2m 05s

### 用户

我觉得你犯了一个错，我曾经要求你把桌面上的那个文件夹迁移进工作区，但是你后续的工作还是在桌面上那个文件夹里做的。你需要修复这个问题，也许你可以把后续新增的文本同步写进工作区里的那个文件夹里。

### 助手 · `deepseek-account/deepseek-flash`

你说得对，这是我的错：**我把桌面那份当成编辑对象，工作区那份当成了生成产物**。方向反了——应该是「工作区是工作副本，桌面是归档」。先查两边的实际差异，再修工具链。

### 助手 · `deepseek-account/deepseek-flash`

内容其实**已经同步**（每次改完桌面我都重建过工作区副本）。所以问题不在文本，在**编辑方向**——这个必须修掉，否则下次还会走错。先看两份的顶部：

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

> 压缩裁剪了一部分工具结果

### 助手 · `deepseek-account/deepseek-flash`

最后一步：把桌面那份的入口指向工作区，避免以后再从桌面开工。

### 助手 · `deepseek-account/deepseek-flash`

两处校验报错——正是我刚在桌面改完没同步。先看具体哪条：

### 助手 · `deepseek-account/deepseek-flash`

修好了。先说实话：**文本其实没丢**（我每次改完桌面都重建过工作区副本，逐行比对 11 份全部吻合）。真正的错误是**方向反了**——桌面当编辑对象、工作区当生成产物，而且那个生成脚本会**覆盖**工作区里的手工改动（横幅、重编号、`01` 里被重写的文档地图、`00` 索引都是这么来的）。这个必须拔掉。

##### 改了什么

**① 删掉会覆盖工作副本的生成脚本**
- `_ref\build-tier2-docs.cjs` —— 它的方向是「桌面 → 工作区」，再跑一次就会把工作区的手改清掉
- `_ref\tier2-index.md` —— 它的私有输入，内容已就是工作区的 `00`

**② 让工作目录自己声明身份**（原来是"原件未动"这种含糊说法）

`00. 阅读顺序.md` 顶部新增一块：

```
📍 这个文件夹是**工作副本**，就在这里改
   教练模式-文档-档2阅读版\（当前目录）= 唯一的工作副本
   桌面那份是归档，不要再拿它当编辑对象
   历史教训：之前一度是反过来做的……生成脚本已经删掉了，现在这里就是真源
```

`01.` 的文档地图第一句也改成「本文件夹 = 档 2 阅读顺序版，也就是**唯一的工作副本**……桌面上那份同名目录是**归档**」。`05.` 补了一句「母本状态：原桌面目录已整体标为归档；工作副本就是你现在所在的这个目录」。

**③ 桌面那份改成归档指引**（不再指向它自己目录里的旧副本）

桌面 `00-交接说明.md` 现在是第一屏就写着：

```
🗄️ 这个文件夹是归档，不要去这里编辑
   工作副本：…\default-workspace\教练模式-文档-档2阅读版\
   接档 2 请直接读那个目录的 00. 阅读顺序.md
   在这里改了不会影响工作副本，反而会让两份漂移——所以别改这里
```

**④ 加了两道自动检查，防再犯**
- `_ref\sync-check.cjs`：逐行核对**桌面的每一行是否都已并入工作副本**（`01` 的文档地图、`05` 的归档指引这两处是有意重写的，单列豁免）
- `_ref\verify-tier2-docs.cjs`：新增 3 条**归属断言**——`00` 必须声明自己是工作副本、不许再指向已删除的生成脚本、`01` 必须声明唯一工作副本

##### 现在的结果

```
sync-check  → 结论：工作区副本包含桌面的全部内容 ✅
verify      → 总体：全部通过 ✅   （11 条结构/归属断言 + 逐份指纹）
```

工作目录 12 份：`00. 阅读顺序.md` + `01`~`11`，首行都带状态横幅（🟢 权威 / 🟡 需甄别 / 🟠 只当背景 / 🔴 陷阱）。

**以后改文档只改工作区这个目录。** 桌面那份只在你回头想看"原始命名、原始顺序"时才翻——它已经在两处明确标成归档了。
