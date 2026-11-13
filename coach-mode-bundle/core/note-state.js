/**
 * `coach_note` 的状态规则：相位、预览门、保存门、预算、幂等。
 *
 * 纯核心：不写文件、不取时间、不取随机。写盘只发生在适配层；折叠到这里时
 * 只把「预览过 / 保存过」记进 `state.notes`，重放不会重复写。
 *
 * 两道门（SPEC-档3 D1）：
 * 1. `save` 必须晚于一次同标题 `preview`；
 * 2. 预览之后必须有用户消息（`lastUserFeedbackAt > preview.at`）——用户确认过才落盘。
 * 回退会让预览作废；上一次保存之后的预览才算新的保存。
 */

import {
  CoachError,
  lastBackAt,
  phaseLabel,
} from './machine.js'

/** `coach_note` 允许的相位；INIT / 确认环境 / PLAN / PAUSED / RESEARCH 拒绝。 */
export const NOTE_ALLOWED_PHASES = [
  'WAIT_FEEDBACK',
  'INSTALL_TOOL',
  'VERIFY_DONE',
  'DEGRADED',
  'NEXT_STEP',
  'COMPLETE',
]

/** 每次会话最多保存几份（Config 可覆盖）。 */
export const DEFAULT_NOTE_MAX_PER_SESSION = 5

/** `state.notes` 的硬上限，避免模型反复预览把状态撑大。 */
export const MAX_NOTE_ENTRIES = 50

/** 相位校验。 */
export function assertNotePhase(state) {
  if (!NOTE_ALLOWED_PHASES.includes(state.phase)) {
    throw new CoachError(
      `coach_note 不能在「${phaseLabel(state.phase)}」阶段调用；`
        + `当前阶段只允许：${NOTE_ALLOWED_PHASES.map(phaseLabel).join('、')}。`,
      'COACH_NOTE_PHASE',
    )
  }
}

/** `state.notes` 里最近一条同标题、指定状态的记录。 */
export function latestNote(state, title, status) {
  const notes = Array.isArray(state.notes) ? state.notes : []
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    const note = notes[index]
    if (note?.title === title && (status === undefined || note.status === status)) return note
  }
  return undefined
}

/** 最近一条同标题预览。 */
export function latestPreview(state, title) {
  return latestNote(state, title, 'preview')
}

/** 最近一条同标题保存记录。 */
export function latestSaved(state, title) {
  return latestNote(state, title, 'saved')
}

/**
 * 同一标题刚保存过、且用户还没再说话 → 认为这次是重复保存。
 * 返回已有记录；否则 `undefined`。
 */
export function findAlreadySaved(state, title) {
  const saved = latestSaved(state, title)
  if (saved === undefined) return undefined
  const lastUser = typeof state.lastUserFeedbackAt === 'number' ? state.lastUserFeedbackAt : -1
  return saved.at > lastUser ? saved : undefined
}

/**
 * 保存前的确定性校验。适配层在写盘之前调用；折叠时 `applyNote` 也会再调一次。
 * @param {object} state 当前状态。
 * @param {string} title 记录标题。
 * @param {object} config 插件配置。
 */
export function assertNoteSaveable(state, title, config = {}) {
  assertNotePhase(state)

  const preview = latestPreview(state, title)
  if (preview === undefined) {
    throw new CoachError(
      `还没有「${title}」的预览。先用 coach_note(mode:"preview") 生成预览，`
        + '把要点给用户看、等用户确认之后再 mode:"save"。',
      'COACH_NOTE_PREVIEW_REQUIRED',
    )
  }
  const lastUser = typeof state.lastUserFeedbackAt === 'number' ? state.lastUserFeedbackAt : null
  if (lastUser === null || lastUser <= preview.at) {
    throw new CoachError(
      '预览之后还没有用户消息：不能替用户确认。'
        + '把预览内容给用户看，等用户说「保存 / 可以」之后再调用 mode:"save"。',
      'COACH_NOTE_PREVIEW_REQUIRED',
    )
  }
  const backAt = lastBackAt(state)
  if (backAt !== null && preview.at <= backAt) {
    throw new CoachError(
      `这次预览在最近一次回退（seq ${backAt}）之前，已经作废；请重新 preview 再 save。`,
      'COACH_NOTE_PREVIEW_REQUIRED',
    )
  }
  const saved = latestSaved(state, title)
  if (saved !== undefined && preview.at <= saved.at) {
    throw new CoachError(
      '这份记录上一次保存之后没有新的预览；要再存一份请先重新 preview。',
      'COACH_NOTE_PREVIEW_REQUIRED',
    )
  }

  const limit = Number.isInteger(config?.noteMaxPerSession) && config.noteMaxPerSession > 0
    ? config.noteMaxPerSession
    : DEFAULT_NOTE_MAX_PER_SESSION
  const savedCount = (Array.isArray(state.notes) ? state.notes : [])
    .filter((note) => note?.status === 'saved').length
  if (savedCount >= limit) {
    throw new CoachError(
      `本次会话已经保存 ${savedCount} 份记录，达到上限 ${limit}（Config.noteMaxPerSession）。`
        + '继续写请先删掉旧文件并由用户调大配置；不要为了绕上限改标题。',
      'COACH_NOTE_BUDGET',
    )
  }
}

/** 追加一条 notes 记录，并压到硬上限内。 */
function appendNote(state, entry) {
  const notes = [...(Array.isArray(state.notes) ? state.notes : []), entry]
  return {
    ...state,
    notes: notes.slice(-MAX_NOTE_ENTRIES),
  }
}

/**
 * 应用一次 `coach_note` 工具结果。
 *
 * - `preview`：只记一条预览，不写文件；
 * - `save`：先过 `assertNoteSaveable`，再记保存记录；
 * - `already-saved`：幂等，不追加。
 * @param {object} state 当前状态。
 * @param {object} input 工具结果 meta（或历史参数回落）。
 * @param {number} at 结果事件序号。
 * @param {object} config 插件配置。
 * @returns {object} 新状态。
 */
export function applyNote(state, input, at, config = {}) {
  assertNotePhase(state)
  const mode = input?.mode
  const title = typeof input?.title === 'string' ? input.title.trim() : ''
  if (title === '') {
    throw new CoachError('coach_note 的记录标题不能为空。', 'COACH_NOTE_FIELD')
  }

  if (input?.status === 'already-saved') return state

  if (mode === 'preview') {
    return appendNote(state, {
      title,
      status: 'preview',
      at: typeof at === 'number' ? at : 0,
      images: 0,
      bytes: 0,
      redactions: 0,
    })
  }
  if (mode === 'save') {
    assertNoteSaveable(state, title, config)
    return appendNote(state, {
      title,
      status: 'saved',
      path: typeof input?.path === 'string' ? input.path : '',
      at: typeof at === 'number' ? at : 0,
      images: Number.isInteger(input?.images) && input.images > 0 ? input.images : 0,
      bytes: Number.isInteger(input?.bytes) && input.bytes > 0 ? input.bytes : 0,
      redactions: Number.isInteger(input?.redactions) && input.redactions > 0 ? input.redactions : 0,
    })
  }
  throw new CoachError(`coach_note 的 mode 必须是 "preview" 或 "save"，收到 ${JSON.stringify(mode)}。`, 'COACH_NOTE_FIELD')
}
