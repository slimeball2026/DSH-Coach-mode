/**
 * `coach_plan` —— 写入板块与步骤（含合格标准与所需证据），并声明工具可用性与目标。
 *
 * 这是唯一能推进 `phase` 到 `PLAN` 的入口，也是"合格标准一次性写入"的落点：
 * 计划一旦被接受，`coach_plan` 在后续阶段一律失败（SPEC 第 6 节）。
 */

import { defineTool } from './define-tool.js'
import {
  CHECK_KINDS,
  DIFFICULTIES,
  EVIDENCES,
  USER_LEVELS,
  isInstallBranch,
  phaseLabel,
} from '../core/machine.js'
import { applyPlan, normalizePlanInput } from '../core/plan.js'

const DESCRIPTION = [
  '写入本次学习的板块与可执行步骤，并声明工具可用性与目标。',
  '这是教练模式的唯一计划入口：提交前必须先确认「用户能不能打开并使用这个工具」。',
  '每一步都必须给出 goal / action / expected / standard（合格标准）/ evidence（所需证据类型）；',
  'evidence 为 file 或 command 的步骤还必须给出 check（kind + target），否则插件无法取证。',
  '工具可用性已知（yes / no）时，必须在同一次调用里提交 sections；只有可用性未知时才可省略（只报可用性）。',
  '计划一旦被接受就不能再改写。',
  '例外（v0.3.3）：当前阶段是「安装工具」时，如果工具其实已经可用（coach_check 找到可执行文件/安装目录，',
  '或用户说已经装好并能打开），用 toolAvailable="yes" 重新调用本工具即可退出安装分支：',
  '插件会清空安装计划、把当前目标回到 originalGoal，然后按本次提交的 sections 直接进入学习分支；',
  'sections 留空则回到「拆解计划」等你补学习计划。toolAvailable 报 no / unknown 会被拒绝。',
].join('')

export function createPlanTool(deps) {
  const { config, projection } = deps
  return defineTool({
    name: 'coach_plan',
    description: DESCRIPTION,
    parameters: {
      toolName: {
        type: 'string',
        required: true,
        description: '用户想学的工具，例如 Photoshop / Git / Blender。',
      },
      toolAvailable: {
        type: 'string',
        required: true,
        enum: ['yes', 'no', 'unknown'],
        description: '工具现在能不能打开并使用：yes / no / unknown。unknown 时状态会停在「确认环境」，不能开始教学。',
      },
      userLevel: {
        type: 'string',
        enum: USER_LEVELS,
        description: '用户当前水平。',
      },
      originalGoal: {
        type: 'string',
        required: true,
        description: '用户最初想完成的目标。安装分支必须靠它把目标还原回来。',
      },
      currentGoal: {
        type: 'string',
        description: '当前目标。安装分支下是「装好并跑通」，留空时会自动填。',
      },
      goalMode: {
        type: 'string',
        enum: ['learn', 'install'],
        description: 'learn = 正式教学；install = 临时把「装好并跑通」当成学习目标。',
      },
      difficulty: {
        type: 'string',
        enum: DIFFICULTIES,
        description: '完成难度评估：低 / 中 / 高。',
      },
      sections: {
        type: 'array',
        description: '板块与步骤。只有工具可用性未知时才可以省略（只报可用性）；可用性已知时必须提交。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            section: { type: 'string', required: true, description: '板块名。' },
            steps: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  goal: { type: 'string', required: true, description: '本步目标。' },
                  action: { type: 'string', required: true, description: '请执行的具体操作。' },
                  expected: { type: 'string', required: true, description: '预期结果。' },
                  standard: { type: 'string', required: true, description: '合格标准：怎样算这一步做对了。' },
                  evidence: {
                    type: 'string',
                    required: true,
                    enum: EVIDENCES,
                    description: '本步所需证据类型：file / command / user_artifact / none。',
                  },
                  check: {
                    type: 'object',
                    additionalProperties: false,
                    description: '供 coach_check 执行的核查定义；evidence 为 file / command 时必需。',
                    properties: {
                      kind: { type: 'string', required: true, enum: CHECK_KINDS, description: '核查种类。' },
                      target: { type: 'string', required: true, description: '路径或只读命令。' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          accepted: { type: 'boolean', required: true },
          phase: { type: 'string', required: true },
          totalSteps: { type: 'integer', required: true },
          needsAvailability: { type: 'boolean' },
          needsSections: { type: 'boolean' },
          exitedInstallBranch: { type: 'boolean' },
          originalGoal: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (value.exitedInstallBranch) {
          if (value.accepted) {
            return [{
              type: 'text',
              text: `已退出安装分支：原目标「${value.originalGoal}」保留，安装计划已清空，现在进入学习分支（共 ${value.totalSteps} 步）。\n`
                + '状态块里不再有【安装分支】；安装阶段的核查结论已经作废，从新计划的第 1 步重新开始。\n'
                + '不要回到安装确认。现在只把当前这一步发给用户，用固定格式'
                + '（【当前板块】【本步目标】【请执行】【预期结果】【请反馈】【合格标准】），不要预告后面的步骤。',
            }]
          }
          return [{
            type: 'text',
            text: `已退出安装分支：原目标「${value.originalGoal}」保留，安装计划已清空。\n`
              + '当前在「拆解计划」阶段，但还没有学习计划的步骤；请立刻调用一次 coach_plan，提交 sections'
              + '（按用户水平和原目标拆的学习板块与步骤）。\n'
              + '不要回到安装确认，也不要只报可用性。',
          }]
        }
        if (value.needsSections) {
          return [{
            type: 'text',
            text: '工具和目标已记下，可用性也确认了；但计划还没有步骤，所以还没有生效。\n'
              + '先问清用户水平和目标，再调用一次 coach_plan，把 sections（板块与步骤）一起提交。\n'
              + '不要只报可用性——那不会让计划生效，也不会有「当前步骤」。',
          }]
        }
        if (value.needsAvailability) {
          return [{
            type: 'text',
            text: '工具和目标已记下，但工具可用性还是「未知」——物理前提没确认，不能开始教学。\n'
              + '先问用户：「你现在能打开并使用这个工具吗？」\n'
              + '拿到明确答复后，再调用一次 coach_plan，把 toolAvailable 报成 yes 或 no，并提交 sections。',
          }]
        }
        if (value.phase === 'CHECK_TOOL_AVAILABILITY') {
          return [{
            type: 'text',
            text: '计划已记下，但工具可用性还是「未知」——物理前提没确认，不能开始教学。\n'
              + '先问用户：「你现在能打开并使用这个工具吗？」\n'
              + '拿到明确答复后，再调用一次 coach_plan，把 toolAvailable 报成 yes 或 no。',
          }]
        }
        return [{
          type: 'text',
          text: `计划已写入并生效：共 ${value.totalSteps} 步。\n`
            + `当前阶段：${phaseLabel(value.phase)}。\n`
            + '现在只把当前这一步发给用户，用固定格式（【当前板块】【本步目标】【请执行】【预期结果】【请反馈】【合格标准】），'
            + '不要预告后面的步骤。用户反馈后进入核查。',
        }]
      },
    },
    execute: async (args, exec) => {
      const state = projection.stateForExec(exec)
      const exitedInstallBranch = isInstallBranch(state)
      const payload = normalizePlanInput(args, config, state)
      const next = applyPlan(state, payload, 0)
      const totalSteps = payload.plan.reduce((count, section) => count + section.steps.length, 0)
      const accepted = next.planAcceptedAt !== null
      const needsAvailability = !exitedInstallBranch
        && payload.plan.length === 0 && payload.toolAvailable === null
      const needsSections = !exitedInstallBranch
        && payload.plan.length === 0
        && (payload.toolAvailable === true || payload.toolAvailable === false)
      return {
        accepted,
        phase: next.phase,
        totalSteps,
        needsAvailability,
        needsSections,
        exitedInstallBranch,
        originalGoal: next.originalGoal ?? '',
      }
    },
  })
}
