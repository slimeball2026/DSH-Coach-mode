/**
 * 回退（`coach_back`，v0.3.4）。
 *
 * 只做同会话（Q4 A）：把当前进度退回到计划里更早的某一步，**只追加 `backs`，不改写历史**。
 * 回退之后，该序号之前的 `checks` / `verifications` / `skips` 一律不再计入
 * （见 `machine.js` 的 `effectiveSinceBack`），必须重新 `coach_check` + `coach_verify`，
 * 或重新 `coach_skip`。
 *
 * 纯核心：无 IO、无时间、无随机；所有 `at` 由调用方传入。
 */

import {
  CoachError,
  assertPhase,
  currentStep,
  stepKeyOf,
} from './machine.js'

/** `coach_back` 允许的阶段（SPEC §8）。`INIT` / `CHECK_TOOL_AVAILABILITY` / `PLAN` 拒绝。 */
export const BACK_ALLOWED_PHASES = ['WAIT_FEEDBACK', 'VERIFY_DONE', 'DEGRADED', 'COMPLETE']

/** `stepKey` 的格式：`板块序号:步骤序号`。 */
const STEP_KEY_PATTERN = /^(\d+):(\d+)$/

/** 校验一个非负整数序号。 */
function requireIndex(value, field, label) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new CoachError(
      `${label}（${field}）必须是非负整数，收到 ${JSON.stringify(value)}。`,
      'COACH_BACK_TARGET',
    )
  }
  return value
}

/**
 * 解析回退目标。
 *
 * 三种写法（按优先级）：
 * 1. `stepKey: "1:0"` —— 明确目标；
 * 2. `sectionIndex` + `stepIndex` —— 明确目标；
 * 3. 都不给 —— 回到**上一步**（同一板块内退一步；板块开头则退到上一板块的最后一步）。
 *
 * 目标必须存在，且必须**早于**当前步骤：`coach_back` 只能往回退，不能借它往前跳。
 *
 * @param {object} state 当前状态。
 * @param {{ stepKey?: string, sectionIndex?: number, stepIndex?: number }} input 工具入参。
 * @returns {{ sectionIndex: number, stepIndex: number, key: string, section: object, step: object }}
 */
export function resolveBackTarget(state, input = {}) {
  const rawKey = typeof input.stepKey === 'string' ? input.stepKey.trim() : ''
  let sectionIndex
  let stepIndex

  if (rawKey !== '') {
    const matched = STEP_KEY_PATTERN.exec(rawKey)
    if (matched === null) {
      throw new CoachError(
        `stepKey 必须形如「板块序号:步骤序号」（例如 "1:0"），收到 ${JSON.stringify(input.stepKey)}。`,
        'COACH_BACK_TARGET',
      )
    }
    sectionIndex = Number(matched[1])
    stepIndex = Number(matched[2])
  } else if (input.sectionIndex !== undefined || input.stepIndex !== undefined) {
    if (input.sectionIndex === undefined || input.stepIndex === undefined) {
      throw new CoachError(
        'sectionIndex 与 stepIndex 必须同时给出，或改用 stepKey。',
        'COACH_BACK_TARGET',
      )
    }
    sectionIndex = requireIndex(input.sectionIndex, 'sectionIndex', '板块序号')
    stepIndex = requireIndex(input.stepIndex, 'stepIndex', '步骤序号')
  } else {
    // 省略目标：回到上一步。板块第一步则回到上一板块的最后一步。
    if (!Array.isArray(state.plan) || state.plan.length === 0) {
      throw new CoachError('当前没有计划，无法回退。', 'COACH_NO_STEP')
    }
    if (state.stepIndex > 0) {
      sectionIndex = state.sectionIndex
      stepIndex = state.stepIndex - 1
    } else if (state.sectionIndex > 0) {
      sectionIndex = state.sectionIndex - 1
      stepIndex = (state.plan[sectionIndex]?.steps?.length ?? 0) - 1
    } else {
      throw new CoachError(
        '已经在本计划的第一步，没有更早的步骤可以回退。',
        'COACH_BACK_TARGET',
      )
    }
  }

  const section = state.plan?.[sectionIndex]
  const step = section?.steps?.[stepIndex]
  if (section === undefined || step === undefined) {
    throw new CoachError(
      `回退目标「${stepKeyOf(sectionIndex, stepIndex)}」不在当前计划里。`
        + `当前计划有 ${state.plan?.length ?? 0} 个板块。`,
      'COACH_BACK_TARGET',
    )
  }

  const earlier = sectionIndex < state.sectionIndex
    || (sectionIndex === state.sectionIndex && stepIndex < state.stepIndex)
  if (!earlier) {
    throw new CoachError(
      `coach_back 只能回退到当前步骤之前的步骤：当前是「${stepKeyOf(state.sectionIndex, state.stepIndex)}」，`
        + `目标是「${stepKeyOf(sectionIndex, stepIndex)}」。往前推进请用 coach_advance。`,
      'COACH_BACK_FORWARD',
    )
  }

  return { sectionIndex, stepIndex, key: stepKeyOf(sectionIndex, stepIndex), section, step }
}

/**
 * 应用一次回退。
 *
 * - 只追加 `backs`，不改写 `plan` / `checks` / `verifications` / `skips` 的历史；
 * - 回到目标步骤，阶段设为 `WAIT_FEEDBACK`；
 * - `failedAttempts` 保留（供阈值参考，SPEC §8）；
 * - 回退前的记录由 `effectiveSinceBack` 统一判定为失效，不需要也不能删除历史。
 *
 * @param {object} state 当前状态。
 * @param {{ stepKey?: string, sectionIndex?: number, stepIndex?: number, reason?: string }} input 工具入参。
 * @param {number} at 该结果事件序号。
 * @returns {object} 新状态。
 */
export function applyBack(state, input, at) {
  assertPhase(state, BACK_ALLOWED_PHASES, 'coach_back')
  const current = currentStep(state)
  if (current === undefined) {
    throw new CoachError('当前没有生效的步骤，无法回退。', 'COACH_NO_STEP')
  }

  const target = resolveBackTarget(state, input)
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : ''

  return {
    ...state,
    phase: 'WAIT_FEEDBACK',
    sectionIndex: target.sectionIndex,
    stepIndex: target.stepIndex,
    backs: [...state.backs, { stepKey: target.key, reason, at }],
    pendingNoInfoAt: null,
  }
}
