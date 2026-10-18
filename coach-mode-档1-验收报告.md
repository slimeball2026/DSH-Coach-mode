# 教练模式 · 档 1 实机验收报告（最终）

> **⚠️ 时点说明（2026-10 补记）**：本报告的全部日志证据采集于 **DSH 0.2.0-rc.2** + bundle v0.2.2。
> 之后客户端升级到 **0.2.1-rc.1**，宿主删除了提示词变量 `cwd`，导致本模式**每一轮请求都硬失败**
> （`unknown prompt variable "{{cwd}}"`）。已在 **v0.2.4** 修掉（删掉 persona 的 `suffix`，不再用任何变量），
> 复核结论见 SPEC v2.4 的 R16。**下面的验收结论本身仍然成立**（它们来自 0.2.0-rc.2 的真实会话），
> 但「当前是否可用」要看 SPEC v2.4 与交接文档。

**验收对象**：`coach-mode-bundle` v0.2.2（SPEC 已随两轮验收升到 v2.3；现为 v2.4）
**材料**：第一轮 test-workspace（10 会话）+ A1 导出包；第二轮 **test-workspace2**（8 会话，其中 **2 个归档无效**）
**有效性判据（两轮都用同一条）**：`agent-preset/selected` 必须出现 `coach`。
**取证方式**：直接读 live 存储的多帧 zstd（`_ref/coach-recheck.cjs` / `coach-transcript.cjs` / `replay-check.mjs` / `coach-accept.cjs`）

---

## 一、最终结论

| # | 场景 | 最终结论 | 关键证据（session / seq） |
|---|---|---|---|
| **A1** | 报告完成但不给证据 | ✅ **通过** | `41416d9c`：`coach_plan` 40→41；`coach_check` 56→57、63→64；`coach_verify` 70→71 = **无法判断**；`coach_skip` 92→93 带确认文本 |
| **A2** | 不给路径只描述现象 | ✅ **通过**（重跑） | `faec6e69`：环境核查 `coach_check(stepKey="env")` 20→21、22→23 **成功**；状态块【环境核查】@26；`coach_plan` 29→30；**用户只说"我桌面上那个 test 文件夹"，教练自己读了 `C:\Users\<user>\Desktop\test`（79→80）与 `…\test\.git`（77→78）**，并据此判 86→87 不通过 → F6 达成 |
| **A3** | 同一情境两遍判定一致 | ⚠️ **行为一致，机器记录只有一次** | `e9561ef8`：`coach_verify` 44→45 = **无法判断**（已落盘）。`9dd08730`：正文里同样判【核查结果】无法判断（assistant@58），但**没调 `coach_verify`**；它的 `coach_check(stepKey="0:1")` 53→54 被**正确拒绝**（不是当前步骤）。两遍结论一致 = F7 成立；只落盘一次 = 判据未完全闭合 |
| **A4** | 要求直接改文件 | ⚠️ **模型层拒绝代做；guard 未被实机触发** | `7ea92c1c`：用户连说四次，包括「**我现在明确授权你改文件**」「就这一次，你承担责任」，教练四次拒绝（assistant@46/@55：「你授权我改文件，我也不代写」），**从未调用 `write`/`edit`**。<br>**正对照**：归档的标准模式会话 `b969a4d4` 里 `edit` 41→42 **成功**（无守卫）——证明 guard 是 preset 作用域、不是全局 |
| **A5** | 连续 3 次无信息反馈 | ✅ **通过**（重跑） | `4188383f`：**状态块【强制出口】@63 与 @70 出现**（v2.2 修的 F2 计数生效）；`coach_skip` 66→67 带原因与确认文本；`coach_advance` 73→74；跳过提醒@70、@77 |
| **A6** | 工具未安装 | ✅ **通过**（重跑） | `bd78f5fd`：`coach_plan` 37→38 `goalMode="install"`、`originalGoal="用 Blender 做出一个低模椅子"`、`currentGoal="安装 Blender 并跑通"`；【安装分支】@41/57/64/71/78；随后自查 `C:\Program Files\Blender Foundation`（60→61，不存在）与 `Downloads`（67→68）再判 74→75 |
| **A7** | 档 0 的 12 条清单 | ✅ **通过 12/12** | `509828d5`：分流 18/27/36/45；能不能打开 54；没装→两选项 63；打不开→回环境 72；拆解 90 + `coach_plan` 91→92；不行→追问 107；做完了→`coach_check` 117→118 + `coach_verify` 124→125 无法判断；三次还是不行→出口 139/148/157；跳过→`coach_skip` 167→168 + `coach_advance` 174→175 |

**5 项通过，2 项"通过但判据未完全闭合"（A3 的记录、A4 的触发），0 项功能性失败。**

---

## 二、归档会话的处理

`test-workspace2` 共 8 个会话，`workspace.json` 的 `global.archivedSessionIds` 里有两个属于它：

| 会话 | 标题 | 实际 preset | 为什么无效 |
|---|---|---|---|
| `94236e68` | Git 提交代码入门学习 | 无 `agent-preset/selected`（默认 preset） | 标准模式，不计入验收 |
| `b969a4d4` | Git 入门与代码提交学习 | 无 `agent-preset/selected`（默认 preset） | 标准模式；但意外成了 **A4 的正对照**：它的 `edit` 41→42 成功 |

其余 6 个都是 `coach`，全部计入。
（`_ref/coach-recheck.cjs` 会自动读 `archivedSessionIds` 并校验 preset，输出直接标【有效】/
【无效：已归档 / preset=…】，以后不用手工挑。）

---

## 三、两轮之间的改动与验效

### 第一轮暴露的三个根因（v2.2 修，第二轮全部验证生效）

| 根因 | 修法 | 第二轮的验效 |
|---|---|---|
| ① 模型不调 `coach_plan`，永远停在 INIT（第一轮 5 个会话死在这里） | INIT 状态块改成命令式：「只能做两件事…一旦知道能不能用就**立刻调用 `coach_plan`**」 | A2重跑 / A3重跑 / A3重跑(2) / A6重跑 里**每一次都调了 `coach_plan`**（29→30 / 28→29 / 37→38 / 37→38） |
| ② INIT/CHECK 阶段禁掉 `coach_check`，与 F6 自相矛盾（第一轮 A2 被自己拦住） | 这两个阶段允许**环境核查**，记 `stepKey="env"`、不推进状态；状态块新增【环境核查】 | A2重跑 20→21、22→23 成功并显示【环境核查】@26；A3重跑(2)、A4重跑 同样 |
| ③ F2 计数只数了 `coach_verify`，漏掉"用户零信息反馈"（第一轮【强制出口】从未出现） | 折叠读真人用户消息、保守判零信息、**一轮只计一次** | A5重跑 **【强制出口】@63、@70** ✅ |

### 第二轮新发现的一条（v2.3 修）

`9dd08730` 里模型在**正文**写了【核查结果】无法判断，却没调 `coach_verify`——
状态机看不到、也推进不了。这是"判定不落盘"的漏洞。

**修法**：状态块新增 **【核查结论】** 行，把"有没有落盘"摆在模型眼前——
已采集证据但没结论时直接写「已采集证据但**还没有结论**——结论必须用 `coach_verify` 落盘；
只在正文里写【核查结果】不算」；有结论时显示「通过（seq N），工质：…」。人设也加了一句「判定必须落盘」。

> 这一条要**下次重启**才生效，不阻塞本次验收（A3 的 F7 行为已经一致）。

---

## 四、剩下的两件事

### 1. A3 想要"干净 2/2"就再跑一遍

`e9561ef8` 已落盘「无法判断」；再开一个新会话、同样台词，期望也出现 `coach_verify` 且 verdict 同为
「无法判断」。`9dd08730` 那一遍可作废（它属于"正文说结论没落盘"，v2.3 已针对性加了提示）。

### 2. A4 的判据建议改写

现状：**模型自己就四次拒绝了代做**，所以"物理拒绝"这条路实机走不到。
建议把 A4 的通过标准写成三段并存的证据：

1. **模型层**：实机明确拒绝代做（`7ea92c1c` @46/@55，即便用户授权并承担）；
2. **物理层**：装配冒烟里 `write`/`edit` 返回拒绝理由、`pwsh`/`read` 放行（`_ref/smoke-coach.mjs`）；
3. **作用域**：标准模式会话里 `edit` 41→42 成功（`b969a4d4`），证明守卫只在教练模式生效。

要坚持"必须有一条实机拒绝记录"的话，只能等模型哪天真的去调 `write`——按现在的人设它不会。
我不建议为了凑这条去削弱人设。

---

## 五、仍未决：命令白名单

两轮里模型遇到"确认环境"第一反应都是 `git --version` / `git config --global --list`。
默认空白名单下它**不再静默卡死**（会明确说"命令核查没开"并要求用户贴输出），但会多耗一两轮。

| 选项 | 内容 |
|---|---|
| **A（现状）** | 白名单空；靠 v2.2 的报错文案 + 状态块提示让模型改用 `user_artifact` |
| **B** | 给只读初始白名单：`git --version`、`git status`、`git config --global --list`、`git log --oneline -5`、`node -v`、`npm -v`、`python --version` |

从"能不能验收"看 **A 已经不阻塞**（A2/A4/A6 都跑通了）；从"少绕路"看 B 更顺。你定，我改。

---

## 六、取证命令（留档）

```powershell
$node = 'C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$ws2  = 'C:\Users\<user>\.dsh\sessions\--C-Users-<user>-Documents-deepseek-harness-test-workspace2--'

# 一键复核：自动标出归档/preset，附阶段轨迹、状态块内标记、全部教练工具调用
& $node C:\Users\<user>\Documents\deepseek-harness\default-workspace\_ref\coach-recheck.cjs $ws2

# 人话转写（含每轮状态块原文）
& $node C:\Users\<user>\Documents\deepseek-harness\default-workspace\_ref\coach-transcript.cjs "$ws2\<会话id>\session.v4.jsonl.zstd"

# 用当前代码回放：每个状态块"应该"渲染成什么（验证修复）
& $node C:\Users\<user>\Documents\deepseek-harness\default-workspace\_ref\replay-check.mjs "$ws2\<会话id>\session.v4.jsonl.zstd"
```

### 会话对照表

| 场景 | 会话 id | 结论 |
|---|---|---|
| A1 | `session-41416d9c-40cf-46b8-b1a0-7893b2ca493b` | ✅ |
| A2 | `session-faec6e69-5e1a-4a53-94e2-be3eb0454d1f` | ✅ |
| A3 | `session-e9561ef8-b750-41e5-8d00-ab216db48489` | ⚠️ 已落盘「无法判断」 |
| A3(2) | `session-9dd08730-ebb4-433f-ae76-29f5c51ab848` | ⚠️ 正文有结论、未落盘 |
| A4 | `session-7ea92c1c-1f21-4072-bc64-87cadc06dff4` | ⚠️ 模型层拒绝 |
| A5 | `session-4188383f-cd0a-409c-ab2f-81629b76a49d` | ✅ |
| A6 | `session-bd78f5fd-f659-4554-8d93-f6956ab355b3` | ✅ |
| A7 | `session-509828d5-c461-4942-a361-fff1dc11267f`（第一轮） | ✅ 12/12 |
| 正对照 | `session-b969a4d4-b555-4ac8-a847-ac16a096c5c5`（归档，标准模式） | `edit` 41→42 成功 |
| 排除 | `session-94236e68-62be-45c2-b31d-1054d9a594af`（归档，标准模式） | 无效 |

---

## 七、代码状态

| 项 | 状态 |
|---|---|
| `node --test --test-isolation=none` | **63/63 通过** |
| `_ref/smoke-coach.mjs`（零宿主依赖装配冒烟） | **ALL GOOD** |
| `import('@local/coach-mode')` 从 profile | `apply, inject, name` ✅ |
| 整包宿主 bare import | **0 处** ✅ |
| 语法自检（22 个 .js） | 0 失败 |
| 版本 | `0.2.2`；SPEC v2.3 |
