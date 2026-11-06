/**
 * 核查与推进：`coach_check` / `coach_verify` / `coach_advance` 的确定性前置条件。
 *
 * **本文件是整个档 1 的核心**：SPEC 第 5.2 节的四条"代码里的 if"都在这里。
 * 模型违反只会拿到一个失败的工具结果，拿不到"进入下一步"的成功返回。
 *
 * 纯核心：无 IO、无时间、无随机。
 */

import {
  CHECK_KINDS,
  CoachError,
  EVIDENCE_NEEDS_CHECK,
  VERDICTS,
  advanceStep,
  assertPhase,
  bumpFailedAttempts,
  checksFor,
  currentStep,
  currentStepKey,
  effectiveSinceBack,
  enterVerify,
  hasPassedOrSkipped,
  lastBackAt,
  markNextStep,
  verificationsFor,
} from './machine.js'

/** 还没建立计划时，环境核查记在这个步骤键上（不绑定任何真实步骤）。 */
export const ENV_PROBE_KEY = 'env'

/** 允许"环境核查"（不推进状态）的阶段。 */
export const ENV_PROBE_PHASES = ['INIT', 'CHECK_TOOL_AVAILABILITY']

/**
 * 归一化一条截图元数据（v0.4.3）。
 *
 * 纯函数：只做类型收敛，不做 IO，也不读时间。`shot` 会原样进 `checks` 条目，
 * 折叠时从 `presentationMeta` 走同一条路，所以字段一旦定下就不要轻易改名。
 * @param {unknown} raw 来自 `coach_check` 的截图事实。
 * @returns {object|null}
 */
export function normalizeShot(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const text = (value, limit) => (typeof value === 'string' ? value.slice(0, limit) : '')
  const id = text(raw.id, 80)
  if (id === '') return null
  const dimension = (value) => (Number.isInteger(value) && value > 0 ? value : 0)
  return {
    id,
    path: text(raw.path, 400),
    width: dimension(raw.width),
    height: dimension(raw.height),
    window: text(raw.window, 200),
    process: text(raw.process, 120),
    pid: Number.isInteger(raw.pid) && raw.pid > 0 ? raw.pid : null,
  }
}

/** 证据引用是否指向本会话自己抓的某张截图（v0.4.3：堵"自截冒充用户工质"）。 */
function refersToSelfShot(evidenceRef, checks) {
  const needle = String(evidenceRef ?? '').trim().toLowerCase().replace(/\\/g, '/')
  if (needle === '') return false
  for (const check of checks) {
    const shot = check?.shot
    if (shot === undefined || shot === null) continue
    const id = String(shot.id ?? '').toLowerCase()
    const path = String(shot.path ?? '').toLowerCase().replace(/\\/g, '/')
    const name = path === '' ? '' : path.slice(path.lastIndexOf('/') + 1)
    if (id !== '' && needle.includes(id)) return true
    if (path !== '' && (needle === path || needle.includes(path))) return true
    if (name !== '' && needle.includes(name)) return true
  }
  return false
}


/**
 * 记录一次只读核查（`coach_check`）。
 *
 * 两种情形：
 * 1. **计划已生效**（`WAIT_FEEDBACK` / `VERIFY_DONE` / `DEGRADED`）：证据记在当前步骤上，
 *    并进入 `VERIFY_DONE`。
 * 2. **计划还没建立**（`INIT` / `CHECK_TOOL_AVAILABILITY`）：作为**环境核查**记为 `env`，
 *    **不改变阶段**（v2.2）。这一条是 F6 的落实：状态块明确让模型"不要先断言读不到"，
 *    那它就必须能在那两个阶段真的去读——v2.1 把这里禁掉了，A2 实测卡死。
 *
 * @param {object} state 当前状态。
 * @param {object} observation 观测事实 `{ stepKey?, kind, target, ok, detail }`。
 * @param {number} at 该结果事件序号。
 */
export function applyCheck(state, observation, at) {
  const { stepKey, kind, target, ok, detail } = observation

  // v0.2.5：宿主不校验工具 parameters（R10），所以这里必须自己拦。
  // 实机 `6899f1df` 出现过 kind:"none" 被当成文件路径记录成环境核查。
  if (!CHECK_KINDS.includes(kind)) {
    throw new CoachError(
      `coach_check 的 kind 必须是 ${CHECK_KINDS.join(' / ')} 之一，收到 ${JSON.stringify(kind)}。`,
      'COACH_CHECK_KIND',
    )
  }

  if (ENV_PROBE_PHASES.includes(state.phase)) {
    if (stepKey !== undefined && stepKey !== null && stepKey !== ENV_PROBE_KEY) {
      throw new CoachError(
        `计划还没建立，此时只能做环境核查（stepKey 必须是 "${ENV_PROBE_KEY}" 或省略）；`
          + `收到「${stepKey}」。请先调用 coach_plan 提交计划。`,
        'COACH_CHECK_STEP_MISMATCH',
      )
    }
    return {
      ...state,
      checks: [...state.checks, {
        stepKey: ENV_PROBE_KEY,
        kind,
        target,
        ok: ok === true,
        detail: typeof detail === 'string' ? detail : String(detail ?? ''),
        shot: normalizeShot(observation.shot),
        at,
      }],
    }
  }

  assertPhase(state, ['WAIT_FEEDBACK', 'INSTALL_TOOL', 'VERIFY_DONE', 'DEGRADED'], 'coach_check')
  const current = currentStep(state)
  if (current === undefined) {
    throw new CoachError('当前没有生效的步骤，无法采集核查证据：计划尚未被接受。', 'COACH_NO_STEP')
  }
  if (stepKey !== undefined && stepKey !== null && stepKey !== current.key) {
    throw new CoachError(
      `stepKey「${stepKey}」不是当前步骤：当前步骤是「${current.key}」（${current.step.goal}）。`
        + '证据只能记在当前步骤上。',
      'COACH_CHECK_STEP_MISMATCH',
    )
  }
  const entered = state.phase === 'VERIFY_DONE' ? state : enterVerify(state)
  return {
    ...entered,
    checks: [...entered.checks, {
      stepKey: current.key,
      kind,
      target,
      ok: ok === true,
      detail: typeof detail === 'string' ? detail : String(detail ?? ''),
      shot: normalizeShot(observation.shot),
      at,
    }],
  }
}

/**
 * 提交核查结论（`coach_verify`）。SPEC 第 5.2 节四条 + 第 6 节"新证据"规则。
 * @param {object} state 当前状态。
 * @param {{ verdict: string, evidenceRef?: string, reason?: string }} input 结论。
 * @param {number} at 该结果事件序号。
 */
export function applyVerify(state, input, at) {
  assertPhase(state, ['WAIT_FEEDBACK', 'INSTALL_TOOL', 'VERIFY_DONE', 'DEGRADED'], 'coach_verify')
  const current = currentStep(state)
  if (current === undefined) {
    throw new CoachError('当前没有生效的步骤，无法提交核查结论。', 'COACH_NO_STEP')
  }

  const verdict = input?.verdict
  if (!VERDICTS.includes(verdict)) {
    throw new CoachError(
      `verdict 必须是 ${VERDICTS.join(' / ')} 之一，收到 ${JSON.stringify(verdict)}。`,
      'COACH_VERIFY_VERDICT',
    )
  }
  const evidenceRef = typeof input?.evidenceRef === 'string' ? input.evidenceRef.trim() : ''
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : ''
  const evidence = current.step.evidence
  // v0.3.4：回退之前的证据不再计入——只认最近一次回退之后的 coach_check。
  const rawChecks = checksFor(state, current.key)
  const checks = effectiveSinceBack(state, rawChecks)

  // ── 5.2(2)：evidence = none 只能判「无法判断」 ────────────────────────────
  if (evidence === 'none' && verdict !== '无法判断') {
    throw new CoachError(
      `本步的【所需证据】是「无法核查」，只能判「无法判断」；不能判「${verdict}」。`,
      'COACH_VERIFY_EVIDENCE_NONE',
    )
  }

  // ── 5.2(1)：file / command 必须先有 coach_check 证据 ──────────────────────
  if (EVIDENCE_NEEDS_CHECK.includes(evidence) && checks.length === 0) {
    const backAt = lastBackAt(state)
    const stale = rawChecks.length > 0 && backAt !== null
    throw new CoachError(
      '必须先用 coach_check 采集证据，再调用 coach_verify。'
        + `本步的【所需证据】是「${evidence}」，`
        + (stale
          ? `但最近一次回退（seq ${backAt}）之前的证据已经作废，请在回退之后重新 coach_check。`
          : '但这一步上还没有任何 coach_check 记录。')
        + (current.step.check
          ? `请先调用 coach_check({ kind: "${current.step.check.kind}", target: ${JSON.stringify(current.step.check.target)} })。`
          : ''),
      'COACH_VERIFY_NO_CHECK',
    )
  }

  // ── 5.2(3)：user_artifact 判「通过」必须给出工质引用 ─────────────────────
  if (verdict === '通过' && evidence === 'user_artifact' && evidenceRef === '') {
    throw new CoachError(
      '本步的【所需证据】是「用户提供的截图 / 文件 / 报错原文」，要判「通过」就必须在 evidenceRef 里'
        + '写出用户提供的工质（截图引用、文件路径或报错原文）。没有工质只能判「无法判断」。',
      'COACH_VERIFY_NO_ARTIFACT',
    )
  }

  // ── v0.4.3：自截的截图不能冒充「用户提供的工质」 ─────────────────────────
  if (verdict === '通过' && evidence === 'user_artifact' && evidenceRef !== ''
    && refersToSelfShot(evidenceRef, state.checks ?? [])) {
    throw new CoachError(
      '这个 evidenceRef 指向的是教练自己抓的截图，不是用户提供的工质。'
        + '要按界面判定，请把该步的 evidence 设成 "screen" 并用 coach_check(kind="screenshot") 取证；'
        + 'user_artifact 只能填用户给的截图 / 文件 / 报错原文。',
      'COACH_VERIFY_SELF_EVIDENCE',
    )
  }

  // ── v0.4.3：screen 证据 = 最新一张截图必须成功，且必须晚于用户这次反馈 ────
  if (verdict === '通过' && evidence === 'screen') {
    const shots = checks.filter((check) => check.kind === 'screenshot')
    const latest = shots[shots.length - 1]
    if (latest === undefined) {
      throw new CoachError(
        '本步的【所需证据】是「界面截图」，但还没有任何截图取证。'
          + '先调用 coach_check({ kind: "screenshot", target: "<进程名 / 窗口标题片段 / foreground>" })，'
          + '拿到截图之后再 coach_verify。',
        'COACH_VERIFY_NO_SCREEN',
      )
    }
    if (latest.ok !== true) {
      throw new CoachError(
        '最近一次截图取证失败了（窗口最小化 / 找不到目标窗口 / 抓取被拒绝）。'
          + '失败的截图不能当证据：先按失败原因处理（让用户把窗口恢复出来，或换一个窗口名），'
          + '再重新 coach_check(kind="screenshot")。',
        'COACH_VERIFY_SCREEN_FAILED',
      )
    }
    const lastUser = state.lastUserFeedbackAt
    if (typeof lastUser !== 'number' || typeof latest.at !== 'number' || latest.at <= lastUser) {
      throw new CoachError(
        '这张截图不是用户这次反馈之后抓的，不能用来判「通过」。'
          + '用户说了做完之后再截一次（coach_check(kind="screenshot")），然后重新 coach_verify。',
        'COACH_VERIFY_SCREEN_STALE',
      )
    }
  }

  // ── 第 6 节：同一步的重复核查必须引用新的 coach_check 证据 ───────────────
  const previous = effectiveSinceBack(state, verificationsFor(state, current.key)).at(-1)
  if (EVIDENCE_NEEDS_CHECK.includes(evidence) && previous !== undefined) {
    const newest = checks[checks.length - 1]
    if (newest === undefined || typeof newest.at !== 'number'
      || typeof previous.at !== 'number' || newest.at <= previous.at) {
      throw new CoachError(
        '同一步的重复核查必须引用新的 coach_check 证据：上一次结论之后没有再采集过证据，'
          + '不能凭记忆重复判。请先调用 coach_check 采集新证据。',
        'COACH_VERIFY_STALE_EVIDENCE',
      )
    }
  }

  const verification = { stepKey: current.key, verdict, evidenceRef, reason, at }
  const withRecord = {
    ...state,
    verifications: [...state.verifications, verification],
    pendingNoInfoAt: null,
  }

  if (verdict === '通过') return markNextStep(withRecord)

  if (verdict === '无法判断' && checks.length === 0) {
    // SPEC 第 3 节：无法判断且无可用证据 → DEGRADED
    return { ...withRecord, phase: 'DEGRADED' }
  }

  // 不通过，或"有证据但不足"的无法判断：失败计数 +1，停在本步。
  // F2 口径（v2.2）：如果上一轮已经因为"用户零信息反馈"计过一次（pendingNoInfoAt 待认领），
  // 这次判定只认领那一次、不重复加，保证一轮无效反馈只计一次。
  if (state.pendingNoInfoAt !== null) {
    return { ...withRecord, phase: 'WAIT_FEEDBACK' }
  }
  return bumpFailedAttempts(withRecord)
}

/**
 * 推进到下一步（`coach_advance`）。SPEC 第 5.2 节第 4 条：最后一道闸。
 * @param {object} state 当前状态。
 */
export function applyAdvance(state) {
  assertPhase(state, ['NEXT_STEP'], 'coach_advance')
  const current = currentStep(state)
  const key = current === undefined ? currentStepKey(state) : current.key
  if (!hasPassedOrSkipped(state, key)) {
    throw new CoachError(
      '上一步必须已存在「通过」或「跳过」记录，才能进入下一步。'
        + `当前步骤「${key}」还没有通过核查，也没有跳过记录。`
        + '请先 coach_check + coach_verify，或使用 coach_skip 明确跳过。',
      'COACH_ADVANCE_NOT_VERIFIED',
    )
  }
  return advanceStep(state)
}
