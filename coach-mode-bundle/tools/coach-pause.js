/**
 * `coach_pause` —— 暂停 / 恢复（v0.4.0，同会话）。
 *
 * 用户说「先停一下 / 今天到这 / 晚点继续」→ `action:"pause"`；
 * 用户说「继续」→ `action:"resume"`。
 *
 * 暂停期间除 `resume` 外的教练工具全部被拒绝；恢复回到暂停前的阶段与步骤，
 * 不作废任何证据（与 `coach_back` 相反）。
 */

import { defineTool } from './define-tool.js'
import { currentStep, phaseLabel } from '../core/machine.js'
import { applyPause, openPause } from '../core/pause.js'

const DESCRIPTION = [
  '暂停或恢复本次教练会话（只做同会话）。',
  '用户说「先停一下 / 今天到这 / 晚点继续」时用 action:"pause"；用户说「继续」时用 action:"resume"。',
  '暂停会进入「已暂停」：除 resume 外，其它教练工具全部被拒绝；暂停不作废任何证据。',
  '恢复会回到暂停前的步骤和阶段，旧证据仍然有效。',
  '可选 note 写一句暂停备注（停在哪、下次从哪继续），恢复时会回显。',
  '暂停期间不要继续讲课，也不要调用其它教练工具。',
].join('')

export function createPauseTool(deps) {
  const { projection } = deps
  return defineTool({
    name: 'coach_pause',
    description: DESCRIPTION,
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['pause', 'resume'],
        description: 'pause = 暂停；resume = 从暂停恢复。',
      },
      note: {
        type: 'string',
        description: '暂停备注（可选）：停在哪、下次从哪继续。恢复时会回显。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          phase: { type: 'string', required: true },
          fromPhase: { type: 'string' },
          stepKey: { type: 'string' },
          note: { type: 'string' },
          section: { type: 'string' },
          goal: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (value.action === 'pause') {
          const where = value.stepKey === ''
            ? `「${phaseLabel(value.fromPhase)}」阶段`
            : `「${value.section}」的 ${value.stepKey}：${value.goal}`
          return [{
            type: 'text',
            text: `已暂停：${where}。\n`
              + (value.note === '' ? '' : `暂停备注：${value.note}\n`)
              + '现在只等用户说「继续」；暂停期间其它教练工具会被拒绝，'
              + '不要继续讲课，也不要在正文里替用户往下走。',
          }]
        }
        return [{
          type: 'text',
          text: `已恢复：回到「${phaseLabel(value.phase)}」阶段`
            + (value.stepKey === '' ? '' : `，当前步骤 ${value.stepKey}：${value.goal}`)
            + '。\n暂停期间没有作废任何证据；继续按当前步骤走。'
            + (value.note === '' ? '' : `\n上次暂停备注：${value.note}`),
        }]
      },
      presentationMeta: (_args, value) => ({
        coachTool: 'coach_pause',
        action: value.action,
        fromPhase: value.fromPhase,
        stepKey: value.stepKey,
        note: value.note,
      }),
    },
    execute: async (args, exec) => {
      const state = projection.stateForExec(exec)
      const beforePhase = state.phase
      const next = applyPause(state, { action: args.action, note: args.note }, 0)
      const current = currentStep(next)
      const pause = args.action === 'pause'
        ? openPause(next)?.pause
        : next.pauses[next.pauses.length - 1]
      return {
        action: args.action,
        phase: next.phase,
        fromPhase: args.action === 'pause' ? beforePhase : '',
        stepKey: current?.key ?? pause?.stepKey ?? '',
        note: pause?.note ?? '',
        section: current?.section.section ?? '',
        goal: current?.step.goal ?? '',
      }
    },
  })
}
