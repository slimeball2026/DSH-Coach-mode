/**
 * `coach_advance` —— 进入下一步。
 *
 * SPEC 第 5.2 节第 4 条：上一步必须已存在「通过」或「跳过」记录，否则失败。
 * 这是"不能跳过核查"的最后一道闸。
 */

import { defineTool } from './define-tool.js'
import { currentStep } from '../core/machine.js'
import { applyAdvance } from '../core/verify.js'

const DESCRIPTION = [
  '进入下一步。只在当前步骤已经「通过核查」或「被跳过」之后才允许调用。',
  '核查通过不会自动推进——必须显式调用本工具；这是防止模型自行宣布进入下一步的最后一道闸。',
  '最后一步之后调用本工具会结束本次目标（安装分支会先把原始目标还原回来）。',
].join('')

export function createAdvanceTool(deps) {
  const { projection } = deps
  return defineTool({
    name: 'coach_advance',
    description: DESCRIPTION,
    parameters: {
      note: {
        type: 'string',
        description: '可选：一句过渡说明，例如「第 1 步通过，进入第 2 步」。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          phase: { type: 'string', required: true },
          sectionIndex: { type: 'integer', required: true },
          stepIndex: { type: 'integer', required: true },
          section: { type: 'string', required: true },
          goal: { type: 'string', required: true },
        },
      },
      render: (_args, value) => {
        if (value.phase === 'COMPLETE') {
          return [{
            type: 'text',
            text: '本次目标的全部步骤已经走完，当前阶段：已完成。\n'
              + '请收尾：总结这次做了什么、复盘关键点、列出所有被跳过的步骤（如有）、给出下一步学习建议。',
          }]
        }
        if (value.phase === 'PLAN') {
          return [{
            type: 'text',
            text: '安装阶段已经走完，原始目标已还原到当前目标。\n'
              + '现在为原目标重新拆解计划并调用 coach_plan（每步仍要给 standard 与 evidence）。',
          }]
        }
        return [{
          type: 'text',
          text: `已进入【${value.section}】的第 ${value.stepIndex + 1} 步：${value.goal}。\n`
            + '现在只把这一步发给用户，用固定格式，不要预告后面的步骤。用户反馈后进入核查。',
        }]
      },
    },
    execute: async (_args, exec) => {
      const state = projection.stateForExec(exec)
      const next = applyAdvance(state)
      const current = currentStep(next)
      if (next.phase === 'COMPLETE' || current === undefined) {
        // 终态，或安装分支收尾回到 PLAN（此时没有生效步骤）。
        return {
          phase: next.phase,
          sectionIndex: next.sectionIndex,
          stepIndex: next.stepIndex,
          section: '',
          goal: '',
        }
      }
      return {
        phase: next.phase,
        sectionIndex: next.sectionIndex,
        stepIndex: next.stepIndex,
        section: current.section.section,
        goal: current.step.goal,
      }
    },
  })
}
