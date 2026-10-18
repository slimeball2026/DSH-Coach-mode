/**
 * 进度摘要（v0.4.0）：从 CoachState 算出“做完几步、跳过几步、还剩几步”。
 *
 * 只读状态、纯函数；不新增工具、不新增事件类型。
 * “完成”只认最近一次回退之后的有效「通过」；跳过同理。
 */

import {
  currentStep,
  effectiveSinceBack,
  verificationsFor,
} from './machine.js'

/**
 * 计算进度统计。
 * @param {object} state 当前状态。
 * @returns {object | undefined} 没有计划时返回 undefined。
 */
export function progressStats(state) {
  const plan = Array.isArray(state.plan) ? state.plan : []
  let total = 0
  for (const section of plan) total += section.steps?.length ?? 0
  if (total === 0) return undefined

  const passed = new Set()
  for (let sectionIndex = 0; sectionIndex < plan.length; sectionIndex += 1) {
    const steps = plan[sectionIndex].steps ?? []
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
      const key = `${sectionIndex}:${stepIndex}`
      const history = effectiveSinceBack(state, verificationsFor(state, key))
      const latest = history[history.length - 1]
      if (latest !== undefined && latest.verdict === '通过') passed.add(key)
    }
  }

  const skipped = new Set()
  for (const skip of effectiveSinceBack(state, state.skips ?? [])) {
    if (!passed.has(skip.stepKey)) skipped.add(skip.stepKey)
  }

  const done = passed.size + skipped.size
  const current = currentStep(state)
  return {
    total,
    passed: passed.size,
    skipped: skipped.size,
    done,
    remaining: Math.max(0, total - done),
    research: Array.isArray(state.research) ? state.research.length : 0,
    failed: current?.step?.failedAttempts ?? 0,
    sectionIndex: state.sectionIndex,
    sectionCount: plan.length,
    stepCount: current?.section?.steps?.length ?? 0,
  }
}

/**
 * 渲染一行进度摘要；没有计划时返回空串。
 * @param {object} state 当前状态。
 * @returns {string}
 */
export function progressSummary(state) {
  const stats = progressStats(state)
  if (stats === undefined) return ''

  const skipped = stats.skipped > 0 ? `（其中跳过 ${stats.skipped}）` : ''
  if (state.phase === 'COMPLETE') {
    return `【进度摘要】全部 ${stats.total} 步完成${skipped}；检索 ${stats.research} 次`
  }
  return `【进度摘要】已完成 ${stats.done}/${stats.total} 步${skipped}，剩余 ${stats.remaining}；`
    + `当前第 ${stats.sectionIndex + 1}/${stats.sectionCount} 板块；`
    + `本步失败 ${stats.failed}；检索 ${stats.research} 次`
}
