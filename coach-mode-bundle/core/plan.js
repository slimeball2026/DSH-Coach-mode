/**
 * 计划写入与校验（`coach_plan`）。
 *
 * 计划一旦被接受（`planAcceptedAt !== null`），`coach_plan` 在后续阶段一律失败，
 * 所以"合格标准不得每轮重新发挥"是代码里的 if（SPEC 第 6 节、第 16 节 R5）。
 *
 * 纯核心：无 IO、无时间、无随机。
 */

import {
  CoachError,
  CHECK_KINDS,
  DIFFICULTIES,
  EVIDENCE_NEEDS_CHECK,
  EVIDENCES,
  GOAL_MODES,
  USER_LEVELS,
  acceptPlan,
  beginPlan,
  exitInstallBranch,
  isInstallBranch,
} from './machine.js'

const AVAILABILITY_VALUES = ['yes', 'no', 'unknown']

/** 必填非空字符串。 */
function requiredText(value, field, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CoachError(`${label}（${field}）必须是非空字符串。`, 'COACH_PLAN_FIELD')
  }
  return value.trim()
}

/** 可选非空字符串。 */
function optionalText(value, field, label) {
  if (value === undefined || value === null) return null
  return requiredText(value, field, label)
}

/** 取值集合校验。 */
function oneOf(value, allowed, field, label) {
  if (!allowed.includes(value)) {
    throw new CoachError(
      `${label}（${field}）必须是 ${allowed.join(' / ')} 之一，收到 ${JSON.stringify(value)}。`,
      'COACH_PLAN_FIELD',
    )
  }
  return value
}

/**
 * 校验并归一化 `coach_plan` 的入参。
 * @param {object} input 工具入参（模型给定，可能任意畸形）。
 * @param {object} config 插件配置（用到 maxPlanSteps）。
 * @param {object} [state] 当前状态（用于沿用 originalGoal）。
 * @returns {object} 可直接写进状态的归一化载荷。
 */
export function normalizePlanInput(input, config, state) {
  const raw = input ?? {}
  const toolName = requiredText(raw.toolName, 'toolName', '要学的工具')
  const availability = oneOf(raw.toolAvailable, AVAILABILITY_VALUES, 'toolAvailable', '工具可用性')

  const toolAvailable = availability === 'yes' ? true : availability === 'no' ? false : null

  const originalGoal = optionalText(raw.originalGoal, 'originalGoal', '原始目标')
    ?? state?.originalGoal
    ?? null
  if (originalGoal === null) {
    throw new CoachError('原始目标（originalGoal）必须是非空字符串：安装分支必须保留它。', 'COACH_PLAN_FIELD')
  }

  let currentGoal = optionalText(raw.currentGoal, 'currentGoal', '当前目标') ?? originalGoal
  let goalMode = raw.goalMode === undefined || raw.goalMode === null
    ? null
    : oneOf(raw.goalMode, GOAL_MODES, 'goalMode', '目标模式')

  if (toolAvailable === true) {
    if (goalMode === 'install') {
      throw new CoachError('工具可用时目标模式必须是 learn，不能是 install。', 'COACH_PLAN_FIELD')
    }
    goalMode = 'learn'
  } else if (toolAvailable === false) {
    if (goalMode === 'learn') {
      throw new CoachError(
        '工具不可用时目标模式必须是 install（把「装好并跑通」当成当前学习目标）。',
        'COACH_PLAN_FIELD',
      )
    }
    goalMode = 'install'
    if (raw.currentGoal === undefined || raw.currentGoal === null) currentGoal = `安装并跑通 ${toolName}`
  } else if (goalMode === null) {
    goalMode = 'learn'
  }

  const userLevel = raw.userLevel === undefined || raw.userLevel === null
    ? null
    : oneOf(raw.userLevel, USER_LEVELS, 'userLevel', '用户水平')

  const difficulty = raw.difficulty === undefined || raw.difficulty === null
    ? null
    : oneOf(raw.difficulty, DIFFICULTIES, 'difficulty', '难度')

  const plan = normalizeSections(raw.sections, config)

  return {
    toolName,
    toolAvailable,
    userLevel,
    originalGoal,
    currentGoal,
    goalMode,
    difficulty,
    plan,
  }
}

/** 校验板块与步骤。 */
export function normalizeSections(sections, config) {
  if (sections === undefined || sections === null) return []
  if (!Array.isArray(sections)) {
    throw new CoachError('sections 必须是数组。', 'COACH_PLAN_FIELD')
  }
  if (sections.length === 0) return []

  const normalized = sections.map((section, sectionIndex) => {
    const name = requiredText(section?.section, `sections[${sectionIndex}].section`, '板块名')
    const steps = section?.steps
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new CoachError(
        `sections[${sectionIndex}].steps 必须是非空数组：每个板块至少要有一步。`,
        'COACH_PLAN_FIELD',
      )
    }
    return {
      section: name,
      steps: steps.map((step, stepIndex) => normalizeStep(step, sectionIndex, stepIndex)),
    }
  })

  const total = normalized.reduce((count, section) => count + section.steps.length, 0)
  const maxSteps = config?.maxPlanSteps ?? 12
  if (total > maxSteps) {
    throw new CoachError(
      `计划共 ${total} 步，超过上限 ${maxSteps} 步（Config.maxPlanSteps）。请合并步骤或分板块后再提交。`,
      'COACH_PLAN_TOO_LARGE',
    )
  }
  return normalized
}

/** 校验单个步骤。 */
function normalizeStep(step, sectionIndex, stepIndex) {
  const where = `sections[${sectionIndex}].steps[${stepIndex}]`
  const goal = requiredText(step?.goal, `${where}.goal`, '本步目标')
  const action = requiredText(step?.action, `${where}.action`, '请执行')
  const expected = requiredText(step?.expected, `${where}.expected`, '预期结果')
  const standard = requiredText(step?.standard, `${where}.standard`, '合格标准')
  const evidence = oneOf(step?.evidence, EVIDENCES, `${where}.evidence`, '所需证据类型')

  let check = null
  const rawCheck = step?.check
  if (rawCheck !== undefined && rawCheck !== null) {
    const kind = oneOf(rawCheck.kind, CHECK_KINDS, `${where}.check.kind`, '核查种类')
    const target = requiredText(rawCheck.target, `${where}.check.target`, '核查目标（路径或命令）')
    check = { kind, target }
  } else if (EVIDENCE_NEEDS_CHECK.includes(evidence)) {
    throw new CoachError(
      `${where}（${goal}）的所需证据是 ${evidence}，必须给出 check（kind + target），`
        + `否则插件无法取证、只能判「无法判断」。`,
      'COACH_PLAN_NO_CHECK',
    )
  }

  return {
    goal,
    action,
    expected,
    standard,
    evidence,
    check,
    skipped: false,
    skipReason: null,
    failedAttempts: 0,
  }
}

/**
 * 应用一次 `coach_plan`。
 * @param {object} state 当前状态。
 * @param {object} payload 已归一化的载荷。
 * @param {number} at 该调用的结果事件序号。
 * @returns {object} 新状态。
 */
export function applyPlan(state, payload, at) {
  // v0.3.3：安装分支的受控早退是独立分支——不扩大 beginPlan 的允许阶段，
  // 普通阶段“计划一旦受理不可改写”的语义保持原样。
  // v0.4.0：暂停期间不允许借早退绕过 `coach_pause(resume)`。
  if (isInstallBranch(state) && state.phase !== 'PAUSED') {
    return applyPlanInInstallBranch(state, payload, at)
  }

  const basePhase = state.phase
  const begun = beginPlan(state)
  const next = {
    ...begun,
    toolName: payload.toolName,
    toolAvailable: payload.toolAvailable,
    userLevel: payload.userLevel ?? state.userLevel,
    originalGoal: payload.originalGoal,
    currentGoal: payload.currentGoal,
    goalMode: payload.goalMode,
    difficulty: payload.difficulty ?? state.difficulty,
    plan: payload.plan,
    phase: 'PLAN',
    sectionIndex: 0,
    stepIndex: 0,
  }

  if (payload.plan.length === 0) {
    if (payload.toolAvailable === null) {
      // 可用性未知：记下工具/目标，停下来问用户能不能打开。这是原有流程。
      return {
        ...next,
        phase: 'CHECK_TOOL_AVAILABILITY',
        planAcceptedAt: null,
      }
    }
    // v0.2.5：可用性已知、但还没有 steps —— 不接计划，也不要把模型
    // 推到 CHECK（那会让它一直收到"可用性还是未知"的错误暗示）。
    // 留在原阶段，保留已记录的工具/可用性，等下一次带 sections 的 coach_plan。
    return {
      ...next,
      phase: basePhase === 'PLAN' ? 'INIT' : basePhase,
      planAcceptedAt: null,
    }
  }
  return acceptPlan(next, at)
}

/**
 * 安装分支里的受控早退（v0.3.3，方案 A）。
 *
 * 允许的唯一条件是 `toolAvailable === true`：模型已经用 `coach_check` 找到可执行文件，
 * 或用户明确说已经装好并能打开。此时一次 `coach_plan` 就能：
 * - 清空安装计划、把 `goalMode` 切回 `learn`、`currentGoal` 回到 `originalGoal`；
 * - 顺带清空安装步骤的 `checks` / `verifications` / `skips`（见 `exitInstallBranch`），
 *   避免旧步骤键的结论被新学习计划误用；
 * - 带 `sections` → 直接 `WAIT_FEEDBACK`；不带 → 回到 `PLAN` 等模型补学习计划。
 *
 * `no` / `unknown` 一律拒绝：不能用“重新提交”把还没装好的工具洗成学习分支。
 * 安装分支的正常出口仍是走完最后一步 `coach_advance`（`restoreOriginalGoal`）。
 *
 * @param {object} state 处于 `INSTALL_TOOL` 的状态。
 * @param {object} payload 已归一化的载荷。
 * @param {number} at 该调用的结果事件序号。
 */
function applyPlanInInstallBranch(state, payload, at) {
  if (payload.toolAvailable !== true) {
    throw new CoachError(
      '当前在安装分支（工具被判定为不可用）。只有确认工具已经可用（toolAvailable:"yes"）时，'
        + '才能用 coach_plan 重新提交学习计划、退出安装分支；'
        + '如果还没装好，请继续安装计划（coach_check / coach_verify / coach_advance），'
        + '或用 coach_skip 明确跳过。',
      'COACH_PLAN_INSTALL_EXIT',
    )
  }

  const next = {
    ...exitInstallBranch(state),
    toolName: payload.toolName,
    toolAvailable: true,
    userLevel: payload.userLevel ?? state.userLevel,
    originalGoal: payload.originalGoal,
    // 退出安装分支后当前目标固定回到原始目标：不能把“安装并跑通”继续当成学习目标。
    currentGoal: payload.originalGoal,
    goalMode: 'learn',
    difficulty: payload.difficulty ?? state.difficulty,
    plan: payload.plan,
  }

  if (payload.plan.length === 0) {
    return { ...next, phase: 'PLAN', planAcceptedAt: null }
  }
  return {
    ...next,
    phase: 'WAIT_FEEDBACK',
    planAcceptedAt: at,
    sectionIndex: 0,
    stepIndex: 0,
  }
}

/**
 * 折叠时使用：把历史 `coach_plan` 的 meta（或参数）还原成载荷。
 * 优先用 meta —— 它是当时被接受的那份计划，不会因为之后改了 Config 而失效。
 *
 * v0.3.3：v0.3.3 起 `coach_plan` 没有 `presentationMeta`，早退调用可能省略 `originalGoal`；
 * 必须把**当时的状态**传进来做回落，否则重折叠会丢掉这一次调用、状态停在安装分支。
 */
export function planPayloadFromCall(call, config, state) {
  const meta = call?.meta
  if (meta && typeof meta === 'object' && Array.isArray(meta.plan)) {
    return {
      toolName: meta.toolName,
      toolAvailable: meta.toolAvailable ?? null,
      userLevel: meta.userLevel ?? null,
      originalGoal: meta.originalGoal,
      currentGoal: meta.currentGoal,
      goalMode: meta.goalMode,
      difficulty: meta.difficulty ?? null,
      plan: meta.plan,
    }
  }
  return normalizePlanInput(call?.args ?? {}, config, state)
}
