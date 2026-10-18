/**
 * 折叠：从会话日志里既有的工具事件推导 CoachState。
 *
 * 两条来源（SPEC 第 4 节、第 16 节 R3/R4）：
 * - `tool/call`     —— 意图：工具名 + 参数；
 * - `tool/result`   —— 结果：`data.meta` 里的结构化事实 + 是否出错。
 *
 * **只吃成功的结果**：`data.error` 存在或 `message.isError === true` 的调用一律跳过，
 * 否则被前置条件拒绝一次的 `coach_verify` 就等于凭空记了一次核查。
 *
 * 不新增任何会话事件类型（交底文档修订 2 仍成立）。
 * 纯核心：无 IO、无时间、无随机。
 */

import {
  COACH_TOOLS,
  CoachError,
  STATE_VERSION,
  initialState,
} from './machine.js'
import { applyPlan, planPayloadFromCall } from './plan.js'
import { applyBack } from './back.js'
import { applyPause } from './pause.js'
import { applyResearch } from './research.js'
import { applySkip, applyUserFeedback } from './skip.js'
import { applyAdvance, applyCheck, applyVerify } from './verify.js'

/**
 * 从原始会话事件里按顺序抽出折叠需要的东西：
 * - `{ kind: 'call' }` —— 一个**成功**的教练工具调用（意图来自 `tool/call`，结果事实来自 `tool/result`）；
 * - `{ kind: 'feedback' }` —— 一条**真人**用户消息（`data.source.kind === 'user'`），
 *   用来按 F2 口径数"零信息反馈"（v2.2 新增）。
 *
 * 为什么读用户消息：F2 的口径是"用户只回『还是不行』这类不含信息的回复也计入"。
 * v2.1 只数 `coach_verify` 判失败，模型不调它就永远不触发阈值（A5 实测），
 * 所以必须把用户这一半也折叠进来。用户消息是既有事件，不新增事件类型。
 *
 * @param {Array<object>} events 会话事件（`{ type, seq, data }`）。
 * @returns {Array<object>} 有序的折叠条目。
 */
export function itemsFromEvents(events) {
  const pending = new Map()
  const items = []
  if (!Array.isArray(events)) return items

  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    const data = event.data ?? {}

    if (event.type === 'user/message') {
      if (data.source?.kind !== 'user') continue
      const text = (data.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
      items.push({ kind: 'feedback', text, at: typeof event.seq === 'number' ? event.seq : null })
      continue
    }

    if (event.type === 'tool/call') {
      if (!COACH_TOOLS.includes(data.name)) continue
      let args = {}
      try {
        args = JSON.parse(typeof data.arguments === 'string' ? data.arguments : '{}')
      } catch {
        args = {}
      }
      pending.set(data.callId, { id: data.callId, name: data.name, args })
      continue
    }

    if (event.type === 'tool/result') {
      const message = data.message ?? {}
      const callId = message.toolCallId ?? message.source?.callId
      if (callId === undefined) continue
      const call = pending.get(callId)
      if (call === undefined) continue
      pending.delete(callId)

      // R4：失败的结果不推进状态。
      if (data.error !== undefined) continue
      if (message.isError === true) continue

      items.push({
        kind: 'call',
        ...call,
        meta: data.meta ?? null,
        at: typeof event.seq === 'number' ? event.seq : null,
      })
    }
  }
  return items
}

/**
 * 只要工具调用（保留给既有调用方与单测）。
 * @param {Array<object>} events 会话事件。
 * @returns {Array<object>}
 */
export function callsFromEvents(events) {
  return itemsFromEvents(events).filter((item) => item.kind === 'call')
}

/** 状态是否是本版本折叠语义的产物。 */
export function isCompatible(state) {
  return state !== null && typeof state === 'object' && state.stateVersion === STATE_VERSION
}

/**
 * 应用一次成功的教练工具调用。
 * @param {object} state 当前状态。
 * @param {object} call `{ id, name, args, meta, at }`。
 * @param {object} [config] 插件配置。
 * @returns {object} 新状态。
 */
export function applyToolCall(state, call, config) {
  const at = typeof call.at === 'number' ? call.at : 0
  const meta = call.meta !== null && typeof call.meta === 'object' ? call.meta : null
  const args = call.args !== null && typeof call.args === 'object' ? call.args : {}

  switch (call.name) {
    case 'coach_plan':
      return applyPlan(state, planPayloadFromCall(call, config, state), at)

    case 'coach_check':
      return applyCheck(state, meta ?? {
        stepKey: args.stepKey,
        kind: args.kind,
        target: args.target,
        ok: false,
        detail: '（历史记录缺少结构化结果）',
      }, at)

    case 'coach_verify':
      return applyVerify(state, {
        verdict: meta?.verdict ?? args.verdict,
        evidenceRef: meta?.evidenceRef ?? args.evidenceRef,
        reason: meta?.reason ?? args.reason,
      }, at)

    case 'coach_advance':
      return applyAdvance(state)

    case 'coach_skip':
      return applySkip(state, { reason: meta?.reason ?? args.reason }, at)

    case 'coach_research':
      return applyResearch(state, meta ?? {
        query: args.query,
        ok: false,
        error: '（历史记录缺少结构化检索结果）',
      }, at, {
        contentMaxChars: config?.researchContentMaxChars,
      })

    case 'coach_back':
      return applyBack(state, {
        stepKey: meta?.stepKey ?? args.stepKey,
        sectionIndex: meta?.sectionIndex ?? args.sectionIndex,
        stepIndex: meta?.stepIndex ?? args.stepIndex,
        reason: meta?.reason ?? args.reason,
      }, at)

    case 'coach_pause':
      return applyPause(state, {
        action: meta?.action ?? args.action,
        note: meta?.note ?? args.note,
      }, at)

    default:
      return state
  }
}

/**
 * 按顺序折叠一组条目（工具调用 + 用户反馈）。
 * @param {object} state 起始状态。
 * @param {Array<object>} items `itemsFromEvents` 的产物，或纯工具调用列表。
 * @param {object} [config] 插件配置。
 * @returns {object} 折叠结果。
 */
export function foldItems(state, items, config) {
  let current = state
  let cursor = 0
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue
    const at = typeof item.at === 'number' ? item.at : cursor
    cursor = Math.max(cursor, at + 1)

    if (item.kind === 'feedback') {
      try {
        current = applyUserFeedback(current, item.text, at)
      } catch (error) {
        if (!(error instanceof CoachError)) throw error
      }
      continue
    }

    if (!COACH_TOOLS.includes(item.name)) continue
    try {
      current = applyToolCall(current, { ...item, at }, config)
    } catch (error) {
      // 历史调用在当时的规则下成功过；重折叠时若不再成立（例如 Config 收紧），
      // 跳过这一次而不是让整段状态推导崩掉。
      if (!(error instanceof CoachError)) throw error
    }
  }
  return current
}

/**
 * 按顺序折叠一组**工具调用**（不含用户反馈）。保留给既有调用方与单测。
 * @param {object} state 起始状态。
 * @param {Array<object>} calls 调用序列。
 * @param {object} [config] 插件配置。
 * @returns {object} 折叠结果。
 */
export function foldCalls(state, calls, config) {
  return foldItems(state, calls, config)
}

/**
 * 折叠原始会话事件。`stateVersion` 不符时**不复用**旧状态，从空状态重折。
 * @param {object|null} state 缓存的状态。
 * @param {Array<object>} events 会话事件。
 * @param {object} [config] 插件配置。
 * @returns {object} 折叠结果。
 */
export function foldEvents(state, events, config) {
  const base = isCompatible(state) ? state : initialState()
  return foldItems(base, itemsFromEvents(events), config)
}
