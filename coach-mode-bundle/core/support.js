/**
 * 支撑等级（v0.4.1：脚手架递减）。
 *
 * 按学习者的**实际表现**决定【请执行】讲多细：
 *   3 手把手 / 2 给要点 / 1 放手。
 *
 * 三条边界（SPEC §13）：
 * 1. 只读现有状态（`userLevel` / `plan` / `verifications` / `skips` / `backs` / `failedAttempts`），
 *    **不新增工具、不新增相位、不改折叠语义**，所以 `stateVersion` 保持 8。
 * 2. 纯函数：`core/` 不允许 IO、时间、随机；等级完全由状态算出来，不是模型可写的字段。
 * 3. 等级只决定“讲多细”，**不放松任何核查标准**。核查仍按【合格标准】与【所需证据】判。
 *
 * 结算口径（比 SPEC 的文字更明确，写在这里当唯一真源）：
 * - **按“已经处理完的板块”结算，与当前停在哪一步无关。**
 *   用“与当前位置无关”而不是“当前板块之前的板块”，是为了让 `coach_back` 退回前面时
 *   不会把已经挣到的降级一笔抹掉——回退是“重做”，不是“失忆”。
 * - 一个板块“处理完”= 其中每一步**曾经**通过或被跳过（用原始记录，不用 `effectiveSinceBack`；
 *   回退只让“一次过”判据失效，不让整个板块的结算失效）。
 * - 只结算**从第 0 个板块起连续处理完的前缀**；中间断了一节，后面的不算。
 * - 一次过 = 每步只有一条结论且是「通过」、`failedAttempts === 0`、无跳过、该板块内无回退目标；
 *   且该板块至少 2 步（`SUPPORT_DEMOTE_MIN_STEPS`）。
 * - 升级 = 该板块有跳过 / 有回退目标 / 有步骤失败达到 2 次（`SUPPORT_ESCALATE_FAILURES`）。
 * - 当前步已失败 2 次 → 立即升一级；因为降级只发生在“已处理完的板块”，
 *   所以“本板块内不再降”自动成立。
 */

import { currentStep } from './machine.js'

/** 等级 1–3 的名称与【请执行】口径（渲染与提示词共用一个来源）。 */
export const SUPPORT_LEVELS = Object.freeze({
  1: Object.freeze({ name: '放手', guidance: '只给目标、约束和合格标准，操作顺序由用户自己规划' }),
  2: Object.freeze({ name: '给要点', guidance: '只给关键操作和目标，具体位置由用户自己找' }),
  3: Object.freeze({ name: '手把手', guidance: '给具体菜单、按钮、快捷键，按顺序点' }),
})

/** 初始等级：从未用过 = 3，会基础 = 2，熟练想进阶 = 1，未知 = 2。 */
export const LEVEL_BY_USER_LEVEL = Object.freeze({
  从未用过: 3,
  会基础: 2,
  熟练想进阶: 1,
})

/** 未知水平按 2（给要点）——比 1 安全，比 3 省 token。 */
export const DEFAULT_SUPPORT_LEVEL = 2

/** 只有至少这么多步的板块才允许降级，避免“第一步就放手”。 */
export const SUPPORT_DEMOTE_MIN_STEPS = 2

/** 当前步骤失败到几次立即升一级（SPEC §13.2）。 */
export const SUPPORT_ESCALATE_FAILURES = 2

/** 等级下限 / 上限。 */
export const MIN_SUPPORT_LEVEL = 1
export const MAX_SUPPORT_LEVEL = 3

/** 夹到 1–3。 */
function clampLevel(level) {
  if (level < MIN_SUPPORT_LEVEL) return MIN_SUPPORT_LEVEL
  if (level > MAX_SUPPORT_LEVEL) return MAX_SUPPORT_LEVEL
  return level
}

/** 由用户自报水平得到初始等级。 */
export function initialSupportLevel(userLevel) {
  return LEVEL_BY_USER_LEVEL[userLevel] ?? DEFAULT_SUPPORT_LEVEL
}

/** `"1:0"` → `1`；无法解析时返回 `undefined`。 */
function sectionIndexOfStepKey(stepKey) {
  const index = Number(String(stepKey ?? '').split(':')[0])
  return Number.isInteger(index) && index >= 0 ? index : undefined
}

/** 某板块的全部步骤键。 */
function stepKeysOf(sectionIndex, section) {
  const steps = Array.isArray(section?.steps) ? section.steps : []
  return steps.map((_step, stepIndex) => `${sectionIndex}:${stepIndex}`)
}

/** 某一步的全部结论（原始记录，不按回退过滤）。 */
function verdictsOf(state, stepKey) {
  const list = Array.isArray(state.verifications) ? state.verifications : []
  return list.filter((entry) => entry?.stepKey === stepKey)
}

/** 某一步是否曾经通过或被跳过。 */
function handledStep(state, stepKey) {
  if (verdictsOf(state, stepKey).some((entry) => entry.verdict === '通过')) return true
  const skips = Array.isArray(state.skips) ? state.skips : []
  return skips.some((entry) => entry?.stepKey === stepKey)
}

/** 该板块是否已经处理完：每一步都曾经通过或被跳过。 */
function sectionHandled(state, sectionIndex, section) {
  const keys = stepKeysOf(sectionIndex, section)
  if (keys.length === 0) return false
  return keys.every((key) => handledStep(state, key))
}

/** 该板块内是否有回退目标（回退到该板块的任一步）。 */
function sectionHasBack(state, sectionIndex) {
  const backs = Array.isArray(state.backs) ? state.backs : []
  return backs.some((entry) => sectionIndexOfStepKey(entry?.stepKey) === sectionIndex)
}

/** 该板块内是否有步骤失败达到阈值。 */
function sectionHasRepeatedFailure(section) {
  const steps = Array.isArray(section?.steps) ? section.steps : []
  return steps.some((step) => (step?.failedAttempts ?? 0) >= SUPPORT_ESCALATE_FAILURES)
}

/** 该板块是否“一次过”：每步一条结论且通过、零失败、无跳过、无回退。 */
function sectionFirstTry(state, sectionIndex, section) {
  if (sectionHasBack(state, sectionIndex)) return false
  const skips = Array.isArray(state.skips) ? state.skips : []
  const keys = stepKeysOf(sectionIndex, section)
  for (const key of keys) {
    if (skips.some((entry) => entry?.stepKey === key)) return false
    const verdicts = verdictsOf(state, key)
    if (verdicts.length !== 1 || verdicts[0].verdict !== '通过') return false
    const stepIndex = Number(key.split(':')[1])
    const step = section.steps[stepIndex]
    if ((step?.failedAttempts ?? 0) > 0) return false
  }
  return true
}

/**
 * 计算当前支撑等级。
 *
 * @param {object} state CoachState。
 * @returns {{ level: number, name: string, guidance: string, reason: string, settled: number }}
 *   没有计划时也返回初始等级（`settled` 为 0）。
 */
export function supportLevel(state) {
  const plan = Array.isArray(state?.plan) ? state.plan : []
  const userLevel = state?.userLevel
  const initialLevel = initialSupportLevel(userLevel)
  let level = initialLevel
  const notes = []
  let settled = 0

  /**
   * 升降一级；被上下限夹住时把“其实没变”写进依据。
   *
   * A14 第一轮实机（session-38ae3b7b，seq 85）暴露过：熟练用户初始已经是 1，
   * 整板块一次过时“降 1”被下限夹住，依据却仍写“降 1”，看起来像算错。
   * 依据必须描述**结果**，不是描述意图。
   */
  function changeBy(delta, note) {
    const next = clampLevel(level + delta)
    const applied = next - level
    level = next
    if (applied === 0) {
      const bound = delta < 0 ? MIN_SUPPORT_LEVEL : MAX_SUPPORT_LEVEL
      notes.push(`${note}，已${delta < 0 ? '在下限' : '在上限'} ${bound}，不再${delta < 0 ? '降' : '升'}`)
      return
    }
    notes.push(`${note}，${delta < 0 ? '降' : '升'} 1`)
  }

  // 只结算“从第 0 个板块起连续处理完的前缀”，与当前停在哪一步无关。
  for (let sectionIndex = 0; sectionIndex < plan.length; sectionIndex += 1) {
    const section = plan[sectionIndex]
    if (!sectionHandled(state, sectionIndex, section)) break
    settled = sectionIndex + 1
    const steps = Array.isArray(section?.steps) ? section.steps : []
    if (steps.length >= SUPPORT_DEMOTE_MIN_STEPS && sectionFirstTry(state, sectionIndex, section)) {
      changeBy(-1, `板块「${section.section}」${steps.length} 步一次过`)
      continue
    }
    if (sectionHasBack(state, sectionIndex)) {
      changeBy(1, `板块「${section.section}」有回退`)
      continue
    }
    if (Array.isArray(state?.skips) && state.skips.some(
      (entry) => sectionIndexOfStepKey(entry?.stepKey) === sectionIndex,
    )) {
      changeBy(1, `板块「${section.section}」有跳过`)
      continue
    }
    if (sectionHasRepeatedFailure(section)) {
      changeBy(1, `板块「${section.section}」有步骤失败 ${SUPPORT_ESCALATE_FAILURES} 次以上`)
    }
  }

  // 板块内立即升级：当前步失败到 2 次。
  // 依据里带上阈值，避免“失败 3 次也写升 1”看起来像每次失败都升级。
  const current = currentStep(state)
  if (current !== undefined && (current.step.failedAttempts ?? 0) >= SUPPORT_ESCALATE_FAILURES) {
    changeBy(1, `本步失败 ${current.step.failedAttempts} 次（阈值 ${SUPPORT_ESCALATE_FAILURES}）`)
  }

  const meta = SUPPORT_LEVELS[level]
  return {
    level,
    name: meta.name,
    guidance: meta.guidance,
    reason: notes.join('；'),
    initialLevel,
    settled,
  }
}

/**
 * 渲染【支撑等级】一行。
 *
 * 等级数字要能被模型直接照做，所以把“为什么是这个等级”也压成一句短依据：
 * 没有这句话时，模型容易把低等级当成“可以少查一点”。
 * @param {object} state CoachState。
 * @returns {string}
 */
export function supportLine(state) {
  const support = supportLevel(state)
  const basis = support.reason === ''
    ? `初始「${state?.userLevel ?? '未知'}」`
    : support.reason
  return `【支撑等级】${support.level}（${support.name}）：${support.guidance}；`
    + `核查标准不变（依据：${basis}）。`
}
