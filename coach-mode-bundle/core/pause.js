/**
 * 暂停 / 恢复（`coach_pause`，v0.4.0）。
 *
 * 只做同会话：暂停后阶段进入 `PAUSED`，除 `coach_pause(resume)` 外的教练工具全部拒绝；
 * 恢复回到暂停前的阶段与步骤，**不作废任何证据**（这与 `coach_back` 相反）。
 *
 * 纯核心：无 IO、无时间、无随机；`at` 由调用方传入。
 */

import {
  CoachError,
  assertPhase,
  currentStep,
} from './machine.js'

/** 允许暂停的阶段：所有驻留态，但不含 `COMPLETE` / `PAUSED` / 过渡态。 */
export const PAUSE_ALLOWED_PHASES = [
  'INIT',
  'CHECK_TOOL_AVAILABILITY',
  'INSTALL_TOOL',
  'WAIT_FEEDBACK',
  'VERIFY_DONE',
  'DEGRADED',
]

/** 暂停备注的最大长度（避免状态块被一段长文撑爆）。 */
export const MAX_PAUSE_NOTE_CHARS = 200

/**
 * 找最近一条尚未恢复的暂停记录。
 * @param {object} state 当前状态。
 * @returns {{ index: number, pause: object } | undefined}
 */
export function openPause(state) {
  const list = Array.isArray(state.pauses) ? state.pauses : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const pause = list[index]
    if (pause.resumedAt === null || pause.resumedAt === undefined) return { index, pause }
  }
  return undefined
}

/**
 * 应用一次暂停或恢复。
 * @param {object} state 当前状态。
 * @param {{ action?: string, note?: string }} input 工具入参。
 * @param {number} at 该结果事件序号。
 * @returns {object} 新状态。
 */
export function applyPause(state, input, at) {
  const action = input?.action

  if (action === 'pause') {
    assertPhase(state, PAUSE_ALLOWED_PHASES, 'coach_pause(pause)')
    if (openPause(state) !== undefined) {
      throw new CoachError('当前已经在暂停状态，不能重复暂停。', 'COACH_PAUSE_STATE')
    }
    const current = currentStep(state)
    const rawNote = typeof input?.note === 'string' ? input.note.trim() : ''
    const note = rawNote.length <= MAX_PAUSE_NOTE_CHARS
      ? rawNote
      : `${rawNote.slice(0, MAX_PAUSE_NOTE_CHARS - 1)}…`
    return {
      ...state,
      phase: 'PAUSED',
      pauses: [...(state.pauses ?? []), {
        at,
        fromPhase: state.phase,
        stepKey: current?.key ?? null,
        note,
        resumedAt: null,
      }],
      pendingNoInfoAt: null,
    }
  }

  if (action === 'resume') {
    assertPhase(state, ['PAUSED'], 'coach_pause(resume)')
    const open = openPause(state)
    if (open === undefined) {
      throw new CoachError('没有待恢复的暂停记录：当前并不在暂停状态。', 'COACH_PAUSE_STATE')
    }
    return {
      ...state,
      phase: open.pause.fromPhase,
      pauses: (state.pauses ?? []).map((pause, index) => (
        index === open.index ? { ...pause, resumedAt: at } : pause
      )),
      pendingNoInfoAt: null,
    }
  }

  throw new CoachError(
    `coach_pause 的 action 必须是 "pause" 或 "resume"，收到 ${JSON.stringify(action)}。`,
    'COACH_PAUSE_ACTION',
  )
}
