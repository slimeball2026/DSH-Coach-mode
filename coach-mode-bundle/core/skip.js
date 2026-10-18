/**
 * 强制跳过（`coach_skip`）：阈值计数与跳过记录。
 *
 * 依据交底文档 F1~F3 与 SPEC 第 9 节：
 * - 阈值触发不靠提示词，靠状态块由插件主动输出出口指令；
 * - 跳过必须说出口，不允许静默跳过；
 * - 物理前提（工具可用性）不允许跳过。
 *
 * **F2 的计数口径（v2.2 修）**：同一核查点上的无效反馈次数，两种都计入——
 * 「用户只回『还是不行』这类不含信息的回复」和「coach_verify 判不通过/无法判断」，
 * 一轮只算一次（先到者为准，后来的那次不重复加）。v2.1 只实现了后半段，
 * 结果模型不调 coach_verify 时阈值永远不触发（A5 实测出来的）。
 *
 * 纯核心：无 IO、无时间、无随机。
 */

import { CoachError, assertPhase, currentStep, phaseLabel } from './machine.js'

/** 用户没说明原因时的占位文本（SPEC 第 9 节）。 */
export const UNSPECIFIED_REASON = '用户未说明'

/** `coach_skip` 允许的阶段。 */
export const SKIP_ALLOWED_PHASES = ['WAIT_FEEDBACK', 'INSTALL_TOOL', 'VERIFY_DONE', 'DEGRADED']

/** 允许把用户回复计入失败计数的阶段（核查点确实在等反馈）。 */
export const COUNTING_PHASES = ['WAIT_FEEDBACK', 'INSTALL_TOOL', 'VERIFY_DONE', 'DEGRADED']

/** 去掉空白与常见标点，便于判定"不含信息"。 */
function normalizeReply(text) {
  return String(text ?? '')
    .replace(/\s+/g, '')
    .replace(/[，。、！？,.!?~～…；;：:"'「」『』（）()【】]/g, '')
}

/** 明确属于"零信息"的短回复。 */
const NO_INFO_EXACT = new Set([
  '不行', '不行啊', '不行了', '还是不行', '仍然不行', '依然不行', '还是不行啊',
  '不对', '还是不对', '仍然不对', '不好', '还是不好', '没好', '还是没好', '没反应',
  '没变化', '没变', '没用', '没有', '没成功', '不成功', '失败', '还是失败', '不行不行',
  '不会', '不会做', '看不懂', '不知道', '不清楚', '找不到', '没找到', '还是不会',
])

/** 以这些词开头、且总长很短，同样视为零信息。 */
const NO_INFO_PREFIX = ['不行', '不对', '不好', '还是不行', '还是不对', '还是没好', '没反应', '没成功', '不会']

/**
 * 判断一条用户回复是否"不含信息"（F2 口径）。
 *
 * 判据刻意保守：**长回复一律不算**（那里面通常有可核对的现象或报错），
 * 只有短、且属于"零信息"常见说法的才计入。
 * @param {string} text 用户回复原文。
 * @returns {boolean}
 */
export function isNoInfoFeedback(text) {
  const normalized = normalizeReply(text)
  if (normalized === '') return true
  if (normalized.length > 12) return false
  if (NO_INFO_EXACT.has(normalized)) return true
  return NO_INFO_PREFIX.some((prefix) => normalized.startsWith(prefix) && normalized.length <= 8)
}

/** 把当前步骤的失败计数加一（不改变阶段）。 */
export function bumpCurrentStepFailure(state) {
  const plan = state.plan.map((section, sectionIndex) => {
    if (sectionIndex !== state.sectionIndex) return section
    return {
      ...section,
      steps: section.steps.map((step, stepIndex) => {
        if (stepIndex !== state.stepIndex) return step
        return { ...step, failedAttempts: (step.failedAttempts ?? 0) + 1 }
      }),
    }
  })
  return { ...state, plan }
}

/**
 * 记一次"用户零信息反馈"。
 *
 * 只在核查点确实在等反馈的阶段计入；首次计入时把 `pendingNoInfoAt` 设为该条消息的序号，
 * 随后同一步上的 `coach_verify` 失败会"认领"这一次，不再重复加（一轮算一次）。
 * @param {object} state 当前状态。
 * @param {string} text 用户回复。
 * @param {number} at 该条消息的事件序号。
 * @returns {object} 新状态（未计入时原样返回）。
 */
export function applyUserFeedback(state, text, at) {
  if (!COUNTING_PHASES.includes(state.phase)) return state
  if (currentStep(state) === undefined) return state
  if (!isNoInfoFeedback(text)) {
    // 有信息的反馈：清掉待认领标记，避免和后面的判定串在一起。
    return state.pendingNoInfoAt === null ? state : { ...state, pendingNoInfoAt: null }
  }
  const bumped = bumpCurrentStepFailure(state)
  return { ...bumped, pendingNoInfoAt: typeof at === 'number' ? at : null }
}

/**
 * 标记当前步骤被跳过。
 * @param {object} state 当前状态。
 * @param {{ reason?: string }} input 跳过原因。
 * @param {number} at 该结果事件序号。
 * @returns {object} 新状态（阶段进入 `NEXT_STEP`，旁路转移见 SPEC 第 3 节）。
 */
export function applySkip(state, input, at) {
  // 物理前提不可跳过：先给这两条专门的报错，再走通用阶段校验。
  if (state.phase === 'INIT' || state.phase === 'CHECK_TOOL_AVAILABILITY') {
    throw new CoachError(
      `工具可用性检查这类物理前提不允许跳过（当前阶段：${phaseLabel(state.phase)}）。`
        + '必须先确认工具能不能用；这一步没有跳过这个选项。',
      'COACH_SKIP_PREREQUISITE',
    )
  }
  assertPhase(state, SKIP_ALLOWED_PHASES, 'coach_skip')

  const current = currentStep(state)
  if (current === undefined) {
    throw new CoachError('当前没有生效的步骤，无法跳过。', 'COACH_NO_STEP')
  }

  const rawReason = typeof input?.reason === 'string' ? input.reason.trim() : ''
  const reason = rawReason === '' ? UNSPECIFIED_REASON : rawReason

  const plan = state.plan.map((section, sectionIndex) => {
    if (sectionIndex !== state.sectionIndex) return section
    return {
      ...section,
      steps: section.steps.map((step, stepIndex) => {
        if (stepIndex !== state.stepIndex) return step
        return { ...step, skipped: true, skipReason: reason }
      }),
    }
  })

  return {
    ...state,
    plan,
    skips: [...state.skips, {
      stepKey: current.key,
      reason,
      at,
      failedAttempts: current.step.failedAttempts ?? 0,
    }],
    pendingNoInfoAt: null,
    phase: 'NEXT_STEP',
  }
}

/**
 * 生成会留在对话历史里的跳过确认文本（F3：不允许静默跳过）。
 * @param {object} state 跳过之后的状态。
 * @param {number} threshold 失败阈值。
 */
export function skipConfirmation(state, threshold) {
  const last = state.skips[state.skips.length - 1]
  if (last === undefined) return ''
  const lines = [
    `已记录跳过：步骤 ${last.stepKey}。`,
    `跳过原因：${last.reason}`,
    `这一步没有通过核查（本步失败次数 ${last.failedAttempts}，阈值 ${threshold}）。`
      + '后续相关步骤会提醒你「之前有一步没通过，可能影响这里」。',
    '你可以随时要求回到那一步重新做。',
  ]
  return lines.join('\n')
}
