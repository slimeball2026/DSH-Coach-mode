/**
 * `coach_back` —— 回到之前的某一步重新做（v0.3.4，Q4 A：只做同会话）。
 *
 * 这是**回退**，不是推进：目标必须早于当前步骤。回退只追加 `backs`，不改写历史；
 * 回退之前的证据/结论/跳过由 `core/machine.js` 的 `effectiveSinceBack` 判定为失效。
 */

import { defineTool } from './define-tool.js'
import { currentStep } from '../core/machine.js'
import { applyBack } from '../core/back.js'

const DESCRIPTION = [
  '回到计划里更早的某一步重新做。',
  '只在用户明确要求「回到第 N 步」「刚才那步重做」时使用；只能往回退，不能往前跳（往前用 coach_advance）。',
  '可以给 stepKey（形如 "1:0"）或 sectionIndex + stepIndex；都不给时回到上一步。',
  '回退之后，这次回退之前的【核查证据】【核查结论】【跳过记录】全部作废：',
  '必须重新 coach_check + coach_verify，或重新 coach_skip；不要用本工具绕过核查。',
  '只做同会话：换会话请重新开始，或手动粘贴摘要。',
].join('')

export function createBackTool(deps) {
  const { projection } = deps
  return defineTool({
    name: 'coach_back',
    description: DESCRIPTION,
    parameters: {
      stepKey: {
        type: 'string',
        description: '回退目标，形如 "1:0"（板块序号:步骤序号）。与 sectionIndex/stepIndex 二选一；都不给时回到上一步。',
      },
      sectionIndex: {
        type: 'integer',
        description: '回退目标的板块序号（从 0 开始）。必须与 stepIndex 一起给。',
      },
      stepIndex: {
        type: 'integer',
        description: '回退目标的步骤序号（从 0 开始）。必须与 sectionIndex 一起给。',
      },
      reason: {
        type: 'string',
        description: '为什么要回退（用户原话或原因），会写进回退记录。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          phase: { type: 'string', required: true },
          stepKey: { type: 'string', required: true },
          sectionIndex: { type: 'integer', required: true },
          stepIndex: { type: 'integer', required: true },
          section: { type: 'string', required: true },
          goal: { type: 'string', required: true },
          reason: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已回退到「${value.section}」的 ${value.stepKey}：${value.goal}。\n`
          + `阶段：${value.phase === 'WAIT_FEEDBACK' ? '等待反馈' : value.phase}。\n`
          + '这次回退之前的【核查证据】【核查结论】【跳过记录】不再计入；'
          + '必须重新 coach_check + coach_verify，或重新 coach_skip。\n'
          + '只把这一步重新发给用户，不要预告后面的步骤，也不要假装之前的结论还有效。',
      }],
      presentationMeta: (_args, value) => ({
        coachTool: 'coach_back',
        stepKey: value.stepKey,
        sectionIndex: value.sectionIndex,
        stepIndex: value.stepIndex,
        reason: value.reason,
      }),
    },
    execute: async (args, exec) => {
      const state = projection.stateForExec(exec)
      const next = applyBack(state, {
        stepKey: args.stepKey,
        sectionIndex: args.sectionIndex,
        stepIndex: args.stepIndex,
        reason: args.reason,
      }, 0)
      const current = currentStep(next)
      return {
        phase: next.phase,
        stepKey: current?.key ?? '',
        sectionIndex: next.sectionIndex,
        stepIndex: next.stepIndex,
        section: current?.section.section ?? '',
        goal: current?.step.goal ?? '',
        reason: typeof args.reason === 'string' ? args.reason.trim() : '',
      }
    },
  })
}
