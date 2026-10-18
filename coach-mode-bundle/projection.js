/**
 * 按需折叠会话日志 → CoachState。
 *
 * 决策 D4：**不注册 `ctx.sessionProjections` 单元**。每次访问重新从 live 会话的事件里折叠，
 * 折叠结果按"已折到哪个 seq"缓存；seq 没变就直接返回缓存。
 * 一次会话的教练工具调用量级很小，这个代价可以忽略。
 *
 * 用 live `Session` 的同步 `snapshotEvents()` 而不是 `ctx.sessionQuery.readSession()`
 * —— 因为 `systemPrompt` 的 text 回调是同步的（SPEC 第 13 节 #3）。
 */

import { initialState } from './core/machine.js'
import { foldItems, itemsFromEvents } from './core/reduce.js'

/** live 会话当前的日志序号；取不到就当作 0。 */
function seqOf(session) {
  const seq = session?.seq
  return typeof seq === 'number' ? seq : 0
}

/**
 * 创建按会话缓存的状态投影器。
 * @param {object} config 插件配置（折叠 `coach_plan` 的容量上限要用）。
 * @returns {{ stateFor: (session: object) => object, stateForExec: (exec: object) => object }}
 */
export function createProjection(config) {
  /** @type {WeakMap<object, { asOfSeq: number, state: object }>} */
  const cache = new WeakMap()

  const stateFor = (session) => {
    if (session === null || session === undefined
      || typeof session.snapshotEvents !== 'function') {
      return initialState()
    }
    const asOfSeq = seqOf(session)
    const cached = cache.get(session)
    if (cached !== undefined && cached.asOfSeq === asOfSeq) return cached.state

    let events = []
    try {
      events = session.snapshotEvents(0, asOfSeq) ?? []
    } catch {
      events = []
    }
    const state = foldItems(initialState(), itemsFromEvents(events), config)
    cache.set(session, { asOfSeq, state })
    return state
  }

  const stateForExec = (exec) => {
    const session = exec?.agent?.session
    if (session === undefined || session === null) {
      throw new Error('教练工具必须由会话内的 agent 调用：拿不到 session，无法推导教练状态。')
    }
    return stateFor(session)
  }

  return { stateFor, stateForExec }
}
