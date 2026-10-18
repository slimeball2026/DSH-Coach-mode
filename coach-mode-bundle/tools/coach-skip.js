/**
 * `coach_skip` —— 强制跳过。
 *
 * 依据 F1~F3 与 SPEC 第 9 节：
 * - 跳过必须说出口：返回的确认文本本身就是工具结果，必然留在对话历史里，不允许静默跳过；
 * - 物理前提（工具可用性）不允许跳过；
 * - 阈值到了插件会主动给出口，但"用户明确要求跳过"永远允许。
 */

import { defineTool } from './define-tool.js'
import { applySkip, skipConfirmation } from '../core/skip.js'

const DESCRIPTION = [
  '明确跳过当前这一步。跳过必须携带原因，并且会留下一条确认文本（不允许静默跳过）。',
  '用户明确要求跳过时直接用它；同一件事反复无效反馈达到阈值后，也应该主动给用户这个出口。',
  '跳过后当前步骤记为未通过核查，后续相关步骤会提醒「之前有一步没通过」。',
  '工具可用性检查这类物理前提不允许跳过——那时候本工具会直接失败。',
].join('')

export function createSkipTool(deps) {
  const { config, projection } = deps
  return defineTool({
    name: 'coach_skip',
    description: DESCRIPTION,
    parameters: {
      reason: {
        type: 'string',
        description: '跳过原因。用户没说就写「用户未说明」，不要凭空编一个理由。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stepKey: { type: 'string', required: true },
          reason: { type: 'string', required: true },
          phase: { type: 'string', required: true },
          confirmation: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.confirmation }],
      presentationMeta: (_args, value) => ({
        coachTool: 'coach_skip',
        stepKey: value.stepKey,
        reason: value.reason,
      }),
    },
    execute: async (args, exec) => {
      const state = projection.stateForExec(exec)
      const next = applySkip(state, { reason: args.reason }, 0)
      const recorded = next.skips[next.skips.length - 1]
      return {
        stepKey: recorded.stepKey,
        reason: recorded.reason,
        phase: next.phase,
        confirmation: skipConfirmation(next, config.failureThreshold)
          + '\n现在调用 coach_advance 进入下一步。',
      }
    },
  })
}
