# A15 · 0.4.2 成本控制验收（已通过）

> **结论：A15 通过（A15-d 记为 N/A），0.4.2 可验收。**
> 逐条结果见 [`A15-results.md`](A15-results.md)；用例定义见 `..\..\SPEC-档2-教练模式.md` §14.5，
> 结果回填在 §14.6。本目录里 4 个会话就是证据原件。

## 0. 前置

1. **重启 DSH**（`stateVersion` 已升到 **9**；旧会话会从空状态重折，属正常）。
2. 新建会话 → 选「教练模式」。
3. 状态块里应出现 `【用量】本步检索 0/3；本会话检索 0；本步核查 0 次`；没有就是还在跑旧模块代。

## 1. 五条用例

| # | 怎么造 | 期望 |
|---|---|---|
| A15-a | 在**同一步**里连续让教练检索 4 次（问 4 个需要查资料的问题） | 第 4 次工具结果报 `COACH_RESEARCH_BUDGET`；前 3 次 `research` 条目都有 `stepKey`；`【用量】` 显示 `3/3`。换到下一步后 `【用量】` 回到 `0/3`，会话累计保留 |
| A15-b | 造一个长状态：多次跳过 + 一次回退 + 多条检索（或临时把 `maxStateBlockChars` 调到 **800**） | 状态块明显变短，被裁项出现“已省略”；`【当前步骤】【请执行】【合格标准】【核查结论】` **仍在**；块长度 ≤ 设定值 |
| A15-c | 任意正常会话 | `【用量】` 的三个数字与状态一致：本步检索含失败、会话检索是累计、本步核查是 `coach_check` 次数 |
| A15-d | 检索一个内容很长的页面 | 日志里 `research` 条目的 `content` ≤2000（`coach-recheck` 的 meta 可看）；当次工具回传给模型的文本不受影响 |
| A15-e | 回归 | `stateVersion` 9；工具仍 8 个；`coach_verify` 四条前置、`coach_advance` 闸门不变；跳过的步骤数在 `【用量】` 之外不新增行 |

> **造场景的两个省事办法（验完必须改回）**：
> - 想让 A15-a 容易触发：临时把 `cordis.patch.yml` 的 `maxResearchPerStep` 改成 **1**，一次就撞上限；
> - 想让 A15-b 容易触发：临时把 `maxStateBlockChars` 改成 **800**。
> 两者都在 `coach-engine.config` 里，改完**重启**才生效。

## 2. 取证

```powershell
$node = 'C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'

# 工具调用与 meta（看 COACH_RESEARCH_BUDGET、research 条目的 stepKey/content 长度）
& $node ..\..\_ref\coach-recheck.cjs C:\Users\<user>\.dsh\sessions\<工作区 slug>

# 用当前代码重折日志：逐块打印 支撑等级 / 检索用量 / 块字符数
& $node ..\..\_ref\replay-check.mjs .\session-<id>\session.v4.jsonl.zstd
```

`replay-check.mjs` 现在每块会多打两行：`【支撑等级】` 和 `【用量】`，
行首的 `检索=X/N  块=NNN字` 可以直接用来判 A15-b / A15-c。

## 3. 判定

- 通过：五条都对上，且 A1–A14 不退化。
- 典型不通过：
  - 第 4 次没被拒 → 预算检查被放到了联网之后，或 `stepKey` 没进 meta；
  - 裁剪后 `【请执行】` 或 `【核查结论】` 不见 → `BUDGET_STUBS` 里混进了关键行；
  - `【用量】` 的本步数与换步后不一致 → `researchStepKey` 取错。
- 不过就回退到 `_backup-0.4.1-20261018\`（0.4.2 落地前建的），不要继续往上叠。
