/**
 * 教练状态机：状态定义与全部合法转移。
 *
 * 本文件属 `core/`，是**纯核心**：不允许 import 任何 `@deepseek-ai/*`，
 * 不允许 IO、时间、随机。所有时间/序号由调用方以 `at` 传入。
 *
 * 设计依据见 `SPEC-档1最小切片.md` 第 3、4 节；v2 修订见第 16 节 R2/R6/R7。
 */

/**
 * 折叠语义版本；改变字段或折叠规则时必须递增。
 * v0.2.5：空 `sections` 且可用性已知时的 phase 结果变了（不再无条件进 CHECK），
 * 所以从 1 升到 2。
 * v0.3.0：新增 `research` 缓存与 `RESEARCH` 过渡态，升到 3。
 * v0.3.1：检索失败不再自动改 phase（只记缓存），折叠语义变了，升到 4。
 * v0.3.2：`INSTALL_TOOL` 成为独立驻留相位，升到 5。
 * v0.3.3：`INSTALL_TOOL` 增加受控早退（`coach_plan` 确认可用后退出安装分支），
 * 且退出安装分支时清空上一份计划的步骤级证据，折叠语义变了，升到 6。
 * v0.3.4：新增 `coach_back` 与 `backs`；回退会让该序号之前的结论/证据失效，
 * 折叠与判定语义都变了，升到 7。
 * v0.4.0：新增 `PAUSED` 相位、`coach_pause` 与 `pauses`；暂停/恢复会改变相位，
 * 折叠语义变了，升到 8。
 * v0.4.2：`research` 条目新增 `stepKey`（预算按步分账），正文按
 * `researchContentMaxChars` 截断；折叠结果变了，升到 9。
 */
export const STATE_VERSION = 9

/** 11 个阶段的中文名（渲染与报错共用一个来源）。 */
export const PHASE_LABELS = {
  INIT: '开始',
  CHECK_TOOL_AVAILABILITY: '确认环境',
  INSTALL_TOOL: '安装工具',
  PLAN: '拆解计划',
  WAIT_FEEDBACK: '等待反馈',
  VERIFY_DONE: '核查中',
  NEXT_STEP: '进入下一步',
  DEGRADED: '降级核查',
  COMPLETE: '已完成',
  RESEARCH: '检索中',
  PAUSED: '已暂停',
}

/** 11 个阶段。 */
export const PHASES = Object.keys(PHASE_LABELS)

/**
 * 过渡态：只在同一次工具调用内进出，不会停留在两次请求之间。
 * `RESEARCH` 与 `PLAN` / `NEXT_STEP` 同类：`coach_research` 在同一次调用里进入、
 * 记录结果后回到调用前的阶段；它没有“等待用户”的语义，做成驻留态会再造一个出口工具。
 */
export const TRANSITIONAL_PHASES = ['PLAN', 'NEXT_STEP', 'RESEARCH']

/** 驻留态：会在两次请求之间停留，因此必须有可读的状态块。 */
export const RESIDENT_PHASES = PHASES.filter((phase) => !TRANSITIONAL_PHASES.includes(phase))

/** 合格标准所需的证据类型（SPEC 第 5.1 节）。 */
export const EVIDENCES = ['file', 'command', 'user_artifact', 'none']

/** 证据类型的中文说明（注入状态块用）。 */
export const EVIDENCE_LABELS = {
  file: '文件（必须由 coach_check 读取核对）',
  command: '只读命令（必须由 coach_check 执行核对）',
  user_artifact: '用户提供的截图 / 文件 / 报错原文',
  none: '无法核查（只能判「无法判断」）',
}

/** 需要插件自己取证的证据类型。 */
export const EVIDENCE_NEEDS_CHECK = ['file', 'command']

/** 核查结论。 */
export const VERDICTS = ['通过', '不通过', '无法判断']

/** 用户水平取值（沿用档 0 提示词）。 */
export const USER_LEVELS = ['从未用过', '会基础', '熟练想进阶']

/** 难度取值（沿用档 0 提示词）。 */
export const DIFFICULTIES = ['低', '中', '高']

/** 目标模式：学习 / 安装。 */
export const GOAL_MODES = ['learn', 'install']

/** `coach_check` 允许的只读核查种类（SPEC 第 5.3 节）。 */
export const CHECK_KINDS = ['path_exists', 'list_dir', 'read_file', 'command']

/** 教练工具名（折叠时只认这八个）。 */
export const COACH_TOOLS = [
  'coach_plan',
  'coach_check',
  'coach_verify',
  'coach_advance',
  'coach_skip',
  'coach_research',
  'coach_back',
  'coach_pause',
]

/** 状态机拒绝时抛出的错误；工具层把它转成失败的工具结果。 */
export class CoachError extends Error {
  /**
   * @param {string} message 面向模型的中文原因。
   * @param {string} [code] 稳定的错误码，便于日志检索。
   */
  constructor(message, code = 'COACH_STATE') {
    super(message)
    this.name = 'CoachError'
    this.code = code
  }
}

/** 折叠起点。 */
export function initialState() {
  return {
    stateVersion: STATE_VERSION,
    phase: 'INIT',
    toolName: null,
    toolAvailable: null,
    userLevel: null,
    originalGoal: null,
    currentGoal: null,
    goalMode: null,
    difficulty: null,
    plan: [],
    sectionIndex: 0,
    stepIndex: 0,
    checks: [],
    verifications: [],
    skips: [],
    // v0.3.4：回退记录。每条 `{ stepKey, reason, at }`，只追加、不改写历史。
    backs: [],
    // v0.4.0：暂停记录。每条 `{ at, fromPhase, stepKey, note, resumedAt }`。
    pauses: [],
    // v0.3.0：检索缓存。每条
    // `{ stepKey, query, redacted, ok, sources, truncated, content, error, at }`（v0.4.2 起带 stepKey）。
    research: [],
    planAcceptedAt: null,
    // v2.2：最近一条「用户零信息反馈」的序号；供同一步上的 coach_verify 失败"认领"，
    // 保证一轮无效反馈只计一次（F2 口径）。null = 没有待认领的。
    pendingNoInfoAt: null,
  }
}

/** 阶段的中文名。 */
export function phaseLabel(phase) {
  return PHASE_LABELS[phase] ?? String(phase)
}

/**
 * 校验当前阶段是否允许该动作。
 * @param {object} state 当前状态。
 * @param {string[]} allowed 允许的阶段集合。
 * @param {string} action 动作名（报错用）。
 */
export function assertPhase(state, allowed, action) {
  if (!allowed.includes(state.phase)) {
    throw new CoachError(
      `${action} 不能在「${phaseLabel(state.phase)}」阶段调用；`
        + `当前阶段只允许：${allowed.map(phaseLabel).join('、')}。`,
      'COACH_PHASE',
    )
  }
}

/** 步骤键：`板块序号:步骤序号`。 */
export function stepKeyOf(sectionIndex, stepIndex) {
  return `${sectionIndex}:${stepIndex}`
}

/** 当前步骤的键。 */
export function currentStepKey(state) {
  return stepKeyOf(state.sectionIndex, state.stepIndex)
}

/**
 * 当前生效的步骤。
 * @returns {{ section: object, step: object, key: string } | undefined}
 */
export function currentStep(state) {
  const section = state.plan[state.sectionIndex]
  if (!section || !Array.isArray(section.steps)) return undefined
  const step = section.steps[state.stepIndex]
  if (!step) return undefined
  return { section, step, key: currentStepKey(state) }
}

/** 计划总步数。 */
export function totalSteps(state) {
  let total = 0
  for (const section of state.plan) total += section.steps?.length ?? 0
  return total
}

/**
 * 是否处于安装分支（v0.3.3）。
 *
 * 判据是 **`goalMode === 'install'` + 还有计划**，不是 `phase === 'INSTALL_TOOL'`：
 * 0.3.2 的 `advanceStep` 在推进到第 2 步时会掉回 `WAIT_FEEDBACK`（本次一并修正），
 * 而且旧会话折叠出来也可能是“安装分支 + 等待反馈”。用 goalMode 判断，
 * 早退在安装分支的任何一步都成立，旧日志也不需要重写。
 */
export function isInstallBranch(state) {
  return state.goalMode === 'install' && Array.isArray(state.plan) && state.plan.length > 0
}

/** 当前是否处于最后一步。 */
export function isLastStep(state) {
  const lastSectionIndex = state.plan.length - 1
  if (lastSectionIndex < 0) return true
  const lastSection = state.plan[lastSectionIndex]
  return state.sectionIndex === lastSectionIndex
    && state.stepIndex === (lastSection.steps?.length ?? 0) - 1
}

/** 某一步已采集的核查证据。 */
export function checksFor(state, stepKey) {
  return state.checks.filter((check) => check.stepKey === stepKey)
}

/** 某一步已提交的核查结论。 */
export function verificationsFor(state, stepKey) {
  return state.verifications.filter((verification) => verification.stepKey === stepKey)
}

/** 某一步最新一条核查证据。 */
export function latestCheck(state, stepKey) {
  const list = checksFor(state, stepKey)
  return list.length === 0 ? undefined : list[list.length - 1]
}

/** 某一步最新一条核查结论。 */
export function latestVerification(state, stepKey) {
  const list = verificationsFor(state, stepKey)
  return list.length === 0 ? undefined : list[list.length - 1]
}

/** 最近一次回退的记录（没有则 undefined）。 */
export function latestBack(state) {
  const list = Array.isArray(state.backs) ? state.backs : []
  return list.length === 0 ? undefined : list[list.length - 1]
}

/**
 * 最近一次回退的事件序号；没回退过返回 `null`。
 * v0.3.4：回退之后，更早的结论/证据/跳过一律不再计入（SPEC §8）。
 */
export function lastBackAt(state) {
  const list = Array.isArray(state.backs) ? state.backs : []
  let last = null
  for (const back of list) {
    if (typeof back?.at === 'number' && (last === null || back.at > last)) last = back.at
  }
  return last
}

/**
 * 按"最近一次回退"过滤记录：没有回退时原样返回；回退后只保留 `at` 晚于回退的记录。
 * 用于 checks / verifications / skips 三处，保证"回退前的旧结论不算数"落在同一口径上。
 * @param {object} state 当前状态。
 * @param {Array<object>} list 带 `at` 的记录。
 */
export function effectiveSinceBack(state, list) {
  const backAt = lastBackAt(state)
  if (backAt === null) return list
  return list.filter((entry) => typeof entry?.at === 'number' && entry.at > backAt)
}

/**
 * 某一步是否已经"通过核查或被跳过"——`coach_advance` 的最后一道闸（SPEC 第 5.2 节第 4 条）。
 * v0.3.4：只认最近一次回退之后的记录；回退前的「通过」或跳过需要重做。
 * @returns {boolean}
 */
export function hasPassedOrSkipped(state, stepKey) {
  const verification = effectiveSinceBack(state, verificationsFor(state, stepKey)).at(-1)
  if (verification !== undefined && verification.verdict === '通过') return true
  return effectiveSinceBack(state, state.skips).some((skip) => skip.stepKey === stepKey)
}

/**
 * 进入 PLAN（过渡态）。`coach_plan` 的入口校验。
 * 安装分支收尾（NEXT_STEP → PLAN）也走这里。
 */
export function beginPlan(state) {
  assertPhase(state, ['INIT', 'CHECK_TOOL_AVAILABILITY', 'PLAN'], 'coach_plan')
  return { ...state, phase: 'PLAN' }
}

/**
 * 受理计划：
 * - 可用性未知 → `CHECK_TOOL_AVAILABILITY`；
 * - 可用性已知但不可用（`goalMode=install`）→ `INSTALL_TOOL`；
 * - 可用性已知且可用 → `WAIT_FEEDBACK`。
 * @param {object} state 处于 PLAN 的状态。
 * @param {number} at 受理该计划的事件序号。
 */
export function acceptPlan(state, at) {
  assertPhase(state, ['PLAN'], '受理计划')
  if (state.toolAvailable === null) {
    return { ...state, phase: 'CHECK_TOOL_AVAILABILITY', planAcceptedAt: null }
  }
  return {
    ...state,
    phase: state.toolAvailable === false ? 'INSTALL_TOOL' : 'WAIT_FEEDBACK',
    planAcceptedAt: at,
    sectionIndex: 0,
    stepIndex: 0,
  }
}

/**
 * 进入核查流程：`WAIT_FEEDBACK` / `INSTALL_TOOL` / `DEGRADED` → `VERIFY_DONE`
 * （SPEC 第 3 节 v2 说明；安装分支与等待反馈的核查语义相同）。
 */
export function enterVerify(state) {
  assertPhase(state, ['WAIT_FEEDBACK', 'INSTALL_TOOL', 'DEGRADED'], '进入核查流程')
  return { ...state, phase: 'VERIFY_DONE' }
}

/** `VERIFY_DONE` → `NEXT_STEP`（核查通过后的待推进态）。 */
export function markNextStep(state) {
  assertPhase(state, ['VERIFY_DONE', 'WAIT_FEEDBACK', 'INSTALL_TOOL', 'DEGRADED'], '标记进入下一步')
  return { ...state, phase: 'NEXT_STEP' }
}

/**
 * 把某一步的失败计数加一，并回到原阶段。
 * 安装分支要回到 `INSTALL_TOOL`，不能掉回 `WAIT_FEEDBACK`，否则状态块就丢了【安装分支】。
 */
export function bumpFailedAttempts(state) {
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
  return {
    ...state,
    plan,
    // v0.3.3：按 goalMode 判断，安装分支（含推进后的步骤）不掉回 WAIT_FEEDBACK。
    phase: state.goalMode === 'install' ? 'INSTALL_TOOL' : 'WAIT_FEEDBACK',
  }
}

/**
 * 清空上一份计划的步骤级证据（v0.3.3）。
 *
 * 退出安装分支后计划会被替换或清空，而步骤键（`0:0`）按位置生成：
 * 如果保留旧安装步骤的 `verification` / `skip`，新学习计划的第一步会继承“已通过”的假象，
 * `coach_verify` 甚至能凭安装阶段的旧截图判通过。
 *
 * `env`（环境核查）不绑定计划，保留——它是关于机器的既有事实，不是某一步的结论。
 * 不改写历史：旧记录仍留在会话日志里，只是不再参与当前计划的推导。
 */
function resetPlanScope(state) {
  return {
    ...state,
    plan: [],
    sectionIndex: 0,
    stepIndex: 0,
    planAcceptedAt: null,
    checks: state.checks.filter((check) => check.stepKey === 'env'),
    verifications: [],
    skips: [],
    pendingNoInfoAt: null,
  }
}

/**
 * 恢复原始目标：安装分支走完最后一步时调用（SPEC 第 12.1 节"安装分支完成后 originalGoal 被正确恢复"）。
 * 结果落在 `PLAN`，等待为原目标重新拆解计划。
 *
 * v0.3.3：同时清空步骤级证据——安装计划的 `0:0` 与之后学习计划的 `0:0` 不是同一步。
 */
export function restoreOriginalGoal(state) {
  if (state.goalMode !== 'install') return state
  return {
    ...resetPlanScope(state),
    goalMode: 'learn',
    currentGoal: state.originalGoal,
    phase: 'PLAN',
  }
}

/**
 * 受控早退（v0.3.3）：用户已经能打开工具、`coach_check` 也找到了可执行文件，
 * 但状态还停在 `INSTALL_TOOL`。此时允许退出安装分支，回到学习分支的入口。
 *
 * 入口只有 `coach_plan(toolAvailable:"yes", …)`（见 `core/plan.js`）；
 * 本函数只做状态转移，保留 `originalGoal`、清空安装计划与步骤级证据。
 * 结果落在 `PLAN`：调用方若同时提交了学习计划，会直接受理到 `WAIT_FEEDBACK`。
 */
export function exitInstallBranch(state) {
  if (!isInstallBranch(state)) {
    throw new CoachError(
      '只有在安装分支（目标模式是 install、且还有安装计划）里才能退出安装分支。',
      'COACH_PHASE',
    )
  }
  return {
    ...resetPlanScope(state),
    goalMode: 'learn',
    currentGoal: state.originalGoal,
    phase: 'PLAN',
  }
}

/**
 * 推进到下一条步骤：`NEXT_STEP` → `WAIT_FEEDBACK` / `COMPLETE` / `PLAN`。
 * 前置条件（上一步已通过或被跳过）由调用方校验，这里只做转移。
 */
export function advanceStep(state) {
  assertPhase(state, ['NEXT_STEP'], 'coach_advance')
  if (isLastStep(state)) {
    if (state.goalMode === 'install') return restoreOriginalGoal(state)
    return { ...state, phase: 'COMPLETE' }
  }
  const section = state.plan[state.sectionIndex]
  if (state.stepIndex + 1 < section.steps.length) {
    return {
      ...state,
      stepIndex: state.stepIndex + 1,
      // v0.3.3：安装分支推进到下一步时仍留在 INSTALL_TOOL；0.3.2 会掉回 WAIT_FEEDBACK。
      phase: state.goalMode === 'install' ? 'INSTALL_TOOL' : 'WAIT_FEEDBACK',
    }
  }
  return {
    ...state,
    sectionIndex: state.sectionIndex + 1,
    stepIndex: 0,
    phase: state.goalMode === 'install' ? 'INSTALL_TOOL' : 'WAIT_FEEDBACK',
  }
}

/** 该步骤是否已达到强制出口阈值（SPEC 第 9 节）。 */
export function reachedThreshold(state, threshold) {
  const current = currentStep(state)
  if (!current) return false
  return (current.step.failedAttempts ?? 0) >= threshold
}

/** 过往被跳过的步骤（渲染【跳过提醒】用）。 */
export function skippedSteps(state) {
  return state.skips
}
