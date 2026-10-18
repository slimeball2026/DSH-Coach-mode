/**
 * `coach_verify` —— 提交核查结论。
 *
 * 这里不写规则，只把 SPEC 第 5.2 节的四条前置条件交给 `core/verify.js` 的纯函数执行；
 * 被拒绝时抛错，模型拿不到成功返回。
 */

import { defineTool } from './define-tool.js'
import { VERDICTS, phaseLabel } from '../core/machine.js'
import { applyVerify } from '../core/verify.js'

const DESCRIPTION = [
  '提交一步的核查结论：通过 / 不通过 / 无法判断。',
  '判定只能依据状态块里的【合格标准】【所需证据】和已采集的【核查证据】。',
  'evidence 为 file / command 的步骤必须先 coach_check 拿到证据，否则本工具直接失败；',
  'evidence 为 none 的步骤只能判「无法判断」；evidence 为 user_artifact 时判「通过」必须给出工质（evidenceRef）。',
  '同一步重复核查必须引用新的 coach_check 证据，不能凭记忆重复判。',
].join('')

export function createVerifyTool(deps) {
  const { projection } = deps
  return defineTool({
    name: 'coach_verify',
    description: DESCRIPTION,
    parameters: {
      verdict: {
        type: 'string',
        required: true,
        enum: VERDICTS,
        description: '核查结论：通过 / 不通过 / 无法判断。证据不足时一律「无法判断」，不允许因为用户说「做完了」就判「通过」。',
      },
      evidenceRef: {
        type: 'string',
        description: '支撑本次结论的工质引用：用户提供的截图 / 文件路径 / 报错原文，或本次 coach_check 的 target。',
      },
      reason: {
        type: 'string',
        description: '为什么这样判：对照【合格标准】逐条说明。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          verdict: { type: 'string', required: true },
          phase: { type: 'string', required: true },
          stepKey: { type: 'string', required: true },
          evidenceRef: { type: 'string', required: true },
          reason: { type: 'string', required: true },
        },
      },
      render: (_args, value) => {
        const head = `核查结论已记录：${value.verdict}（步骤 ${value.stepKey}）。当前阶段：${phaseLabel(value.phase)}。`
        if (value.verdict === '通过') {
          return [{
            type: 'text',
            text: `${head}\n`
              + '下一步：调用 coach_advance 进入下一步（这是最后一道闸，必须显式推进）。\n'
              + '回复用户时用固定格式：【核查结果】【原因】【建议】【下一步】。',
          }]
        }
        if (value.verdict === '不通过') {
          return [{
            type: 'text',
            text: `${head}\n`
              + '仍在原步骤：不要替用户改，也不要猜。指出最可能的出错处，让用户自己改，然后等新反馈。\n'
              + '回复用户时用固定格式：【核查结果】【原因】【建议】【下一步】。',
          }]
        }
        return [{
          type: 'text',
          text: `${head}\n`
            + '无法判断时不要假装通过：让用户做一个小自检并把结果发回来，或先用 coach_check 采集新证据再重新判定。\n'
            + '回复用户时用固定格式：【核查结果】【原因】【建议】【下一步】。',
        }]
      },
      presentationMeta: (_args, value) => ({
        coachTool: 'coach_verify',
        verdict: value.verdict,
        evidenceRef: value.evidenceRef,
        reason: value.reason,
      }),
    },
    execute: async (args, exec) => {
      const state = projection.stateForExec(exec)
      const next = applyVerify(state, {
        verdict: args.verdict,
        evidenceRef: args.evidenceRef,
        reason: args.reason,
      }, 0)
      const recorded = next.verifications[next.verifications.length - 1]
      return {
        verdict: recorded.verdict,
        phase: next.phase,
        stepKey: recorded.stepKey,
        evidenceRef: recorded.evidenceRef,
        reason: recorded.reason,
      }
    },
  })
}
