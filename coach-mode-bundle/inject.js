/**
 * 每轮状态块注入。
 *
 * 机制定稿（SPEC 第 7 节、第 13 节 #1b、决策 D9）：`ctx.systemPrompt.context()`。
 *
 * 为什么不是 `section()`：
 * 1. 运行时上下文按**每次模型请求重新装配**，语义是"本快照取代上一份快照"，
 *    因此天然满足"每轮都有、不随轮次累积"（SPEC 第 7 节硬性要求 1、2）；
 * 2. 它不进入历史消息，也不改系统提示词前缀，对 KV 缓存最友好；
 * 3. `text` 回调拿到的 `AssembleContext` 里有 `agent`（`assembleContextFor` 保证），
 *    所以能按会话渲染。
 */

import { renderStateBlock } from './core/render.js'

/** 运行时上下文的注册名。 */
export const STATE_CONTEXT_NAME = 'coach:state'

/** 排序位置：紧跟在 sandbox(110) / approval(115) / delegation(120) 之后。 */
export const STATE_CONTEXT_ORDER = 130

/**
 * 注册状态块上下文。
 * @param {object} ctx 插件上下文（preset 作用域）。
 * @param {object} deps `{ config, projection, facts }`。
 * @returns {() => void} disposer。
 */
export function registerStateBlock(ctx, deps) {
  const { config, projection, facts } = deps
  return ctx.effect(() => ctx.systemPrompt.context({
    name: STATE_CONTEXT_NAME,
    order: STATE_CONTEXT_ORDER,
    text: (assemble) => {
      const session = assemble?.agent?.session
      if (session === undefined || session === null) return ''
      const state = projection.stateFor(session)
      return renderStateBlock(state, {
        failureThreshold: config.failureThreshold,
        sameMachine: config.sameMachine,
        platform: facts.platform,
        cwd: session.header?.cwd ?? facts.cwd,
        allowCommands: config.allowCommands,
        // v0.4.2 成本控制：预算与上限都由 Config 给，渲染层不写死。
        maxResearchPerStep: config.maxResearchPerStep,
        maxStateBlockChars: config.maxStateBlockChars,
      })
    },
  }), 'coach-mode.systemPrompt.context()')
}
