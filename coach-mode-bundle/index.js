/**
 * 教练模式 · 档 1 引擎（宿主插件入口）。
 *
 * 挂载位置：`cordis.patch.yml` 里 `preset-coach` 的 `plugins` 列表内的一行。
 * 因此本插件的 `ctx` 就是**教练模式 preset 的作用域**：
 * 工具、状态块、守卫只在选择「教练模式」的会话里生效，其他 preset 完全看不到它们。
 *
 * 职责分工（SPEC 第 11 节硬约束）：
 * - `core/` 是纯核心，零 `@deepseek-ai/*` import，无 IO / 时间 / 随机；
 * - 本文件与 `projection.js` / `guard.js` / `inject.js` / `tools/` 是适配层，
 *   是唯一允许接触 DSH 服务的地方。
 */

import { resolveCoachConfig } from './config.js'
import { coachGuard } from './guard.js'
import { registerStateBlock } from './inject.js'
import { createProjection } from './projection.js'
import { createAdvanceTool } from './tools/coach-advance.js'
import { createBackTool } from './tools/coach-back.js'
import { createCheckTool } from './tools/coach-check.js'
import { createPauseTool } from './tools/coach-pause.js'
import { createPlanTool } from './tools/coach-plan.js'
import { createResearchTool } from './tools/coach-research.js'
import { createSkipTool } from './tools/coach-skip.js'
import { createVerifyTool } from './tools/coach-verify.js'

/** 插件名（Cordis plugin name）。 */
export const name = 'coach-mode-engine'

/** 硬依赖：工具注册表与提示词注册表；缺任何一个就不该激活。 */
export const inject = ['tools', 'systemPrompt']

// 注意：**不导出 `Config`**。导出它需要 `@deepseek-ai/schemastery`，
// 而 profile 装的 bundle 解析不到 dsh 自己的包，会导致整行加载失败。

/** 八个教练工具，全部常驻注册（决策 D6：工具目录稳定，不随状态增删）。 */
const TOOL_FACTORIES = [
  ['coach_plan', createPlanTool],
  ['coach_check', createCheckTool],
  ['coach_verify', createVerifyTool],
  ['coach_advance', createAdvanceTool],
  ['coach_skip', createSkipTool],
  ['coach_research', createResearchTool],
  ['coach_back', createBackTool],
  ['coach_pause', createPauseTool],
]

/**
 * 插件入口。
 * @param {object} ctx 教练模式 preset 作用域内的上下文。
 * @param {object} config 该行的 `config`（已由 `Config` 校验）。
 */
export function apply(ctx, config) {
  const resolved = resolveCoachConfig(config)
  const projection = createProjection(resolved)
  const facts = { platform: process.platform, cwd: process.cwd() }
  const deps = { config: resolved, projection, facts, ctx }

  // 每轮状态块（systemPrompt.context，见 inject.js 的取舍说明）。
  registerStateBlock(ctx, deps)

  // 不代做：write / edit 确定性拒绝。
  ctx.tools.guard(coachGuard)

  // 八个教练工具。
  for (const [, create] of TOOL_FACTORIES) {
    ctx.tools.register(create(deps))
  }

  ctx.logger?.debug?.('coach-mode 档2 引擎已挂载：8 个工具 + 状态块 + write/edit 守卫')
}
