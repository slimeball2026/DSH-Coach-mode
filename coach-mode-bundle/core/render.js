/**
 * 状态块渲染（纯函数，可单测）。
 *
 * 输出就是每轮注入给模型的【当前阶段】块。渲染只读 `CoachState`，
 * 不做 IO、不取时间、不取随机 —— 平台与工作目录由调用方传入（SPEC 第 7 节）。
 */

import {
  EVIDENCE_LABELS,
  checksFor,
  currentStep,
  effectiveSinceBack,
  lastBackAt,
  latestBack,
  phaseLabel,
  reachedThreshold,
  verificationsFor,
} from './machine.js'
import { openPause } from './pause.js'
import {
  DEFAULT_MAX_RESEARCH_PER_STEP,
  researchCountForStep,
  researchStepKey,
} from './research.js'
import { progressSummary } from './summary.js'
import { supportLine } from './support.js'

/** 环境核查（计划建立之前）记在这个步骤键上。 */
const ENV_PROBE_KEY = 'env'

/** 单条证据摘要的最大长度，避免状态块被长文件内容撑爆。 */
const DETAIL_BUDGET = 80

/**
 * 状态块预算（v0.4.2）：超预算时**按这个顺序**降级，先换短提示、再整行删。
 *
 * 顺序来自 SPEC §14：检索缓存 → 回退记录 / 跳过提醒 → 历史证据。
 * **不在这个表里的行永不裁**：当前阶段/板块/步骤、【请执行】、【合格标准】、
 * 【所需证据】、【核查结论】、错误提示（强制出口/降级/安装分支）都必须留住。
 */
const BUDGET_STUBS = [
  { prefix: '【检索缓存】', stub: '【检索缓存】已省略（状态块超出字符预算）；需要时重新调用 coach_research。' },
  { prefix: '【回退记录】', stub: '【回退记录】有回退，旧结论/证据/跳过一律作废（详情已省略）。' },
  { prefix: '【跳过提醒】', stub: '【跳过提醒】有步骤被跳过，可能影响当前步骤（详情已省略）。' },
  { prefix: '【核查证据】', stub: '【核查证据】历史证据已省略（状态块超出字符预算）；需要时重新 coach_check。' },
  { prefix: '【环境核查】', stub: '【环境核查】历史记录已省略（状态块超出字符预算）。' },
  { prefix: '【可跑命令】', stub: '【可跑命令】列表已省略（状态块超出字符预算）。' },
  { prefix: '【位置关系】', stub: '【位置关系】教练与用户在同一台机器上，可用 coach_check 读取核对。' },
]

/** 状态块的字符数（按行拼起来的长度算，含换行）。 */
function blockLength(lines) {
  let total = 0
  for (const line of lines) total += line.length + 1
  return total
}

/**
 * 按字符预算裁剪状态块。
 *
 * 两轮：先把可裁项换成一行短提示，再整行删——这样只要还有可裁项，
 * 就一定能挤进预算，而且裁的顺序稳定、可复现。
 * 如果裁完可裁项仍然超预算（例如某一步的【请执行】本身就有几千字），
 * **不裁关键行**，宁可超预算——宁可贵，不可丢当前步骤和合格标准。
 *
 * @param {string[]} lines 状态块各行。
 * @param {number} [max] 字符预算；非正整数表示不限制。
 * @returns {string[]}
 */
function applyBudget(lines, max) {
  if (!Number.isInteger(max) || max <= 0) return lines
  const out = [...lines]
  if (blockLength(out) <= max) return out

  for (const { prefix, stub } of BUDGET_STUBS) {
    if (blockLength(out) <= max) return out
    const index = out.findIndex((line) => line.startsWith(prefix))
    if (index === -1) continue
    out[index] = stub
  }
  for (const { prefix } of BUDGET_STUBS) {
    if (blockLength(out) <= max) return out
    const index = out.findIndex((line) => line.startsWith(prefix))
    if (index !== -1) out.splice(index, 1)
  }
  return out
}

/** 【用量】一行：本步检索/上限、本会话检索、本步核查次数。 */
function usageLine(state, facts) {
  const key = researchStepKey(state)
  const used = researchCountForStep(state, key)
  const limit = Number.isInteger(facts.maxResearchPerStep) && facts.maxResearchPerStep > 0
    ? facts.maxResearchPerStep
    : DEFAULT_MAX_RESEARCH_PER_STEP
  const total = Array.isArray(state.research) ? state.research.length : 0
  const checks = effectiveSinceBack(state, checksFor(state, key)).length
  return `【用量】本步检索 ${used}/${limit}；本会话检索 ${total}；本步核查 ${checks} 次`
}

/** 截断。 */
function clip(text, budget) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length <= budget ? value : `${value.slice(0, budget - 1)}…`
}

/**
 * 【位置关系】一行 —— F6 的落实：由插件生成的**事实陈述**，不写在人设里。
 * @param {{ sameMachine?: boolean, platform?: string, cwd?: string }} facts 宿主事实。
 */
function environmentLine(facts) {
  const { sameMachine = true, platform = '', cwd = '' } = facts
  if (!sameMachine) {
    return '【位置关系】本次部署的文件读取可能不在用户本机上。用户描述的现象优先请其提供路径或截图，'
      + '不要假设自己读到的就是用户的磁盘。'
  }
  const where = [platform ? `平台 ${platform}` : '', cwd ? `当前工作目录 ${cwd}` : '']
    .filter((part) => part !== '').join('，')
  return `【位置关系】教练与用户运行在同一台机器上${where ? `（${where}）` : ''}。`
    + '用户提到的文件、目录、命令输出，只要在可访问范围内，你可以直接用 coach_check 读取核对；'
    + '不确定是否可访问时先尝试读取，不要先断言「我读不到」。'
}

/** 当前步骤已采集的证据摘要（v0.3.4：回退前的证据不计入）。 */
function checkSummary(state, stepKey) {
  const raw = checksFor(state, stepKey)
  const checks = effectiveSinceBack(state, raw)
  if (checks.length === 0) {
    if (raw.length > 0) {
      return `回退后旧证据不再计入（最近一次回退 seq ${lastBackAt(state)}）；需要核查时重新调用 coach_check`
    }
    return '尚未采集（需要核查时先调用 coach_check）'
  }
  const shown = checks.slice(-3).map((check) => {
    const outcome = check.ok === true ? '成功' : '未通过'
    const detail = clip(check.detail ?? '', DETAIL_BUDGET)
    return `${check.kind} ${clip(check.target ?? '', DETAIL_BUDGET)} → ${outcome}${detail === '' ? '' : `（${detail}）`}`
  })
  const more = checks.length > shown.length ? `（另有 ${checks.length - shown.length} 条较早记录）` : ''
  return `${shown.join('；')}${more}`
}

/**
 * 当前步骤的核查结论摘要。
 *
 * v2.3：实测里模型会在**正文**写一段【核查结果】却不去调 `coach_verify`，
 * 于是状态机看不到结论、也推进不了。这里把"有没有落盘"直接摆到它眼前。
 * v0.3.4：回退之前的结论作废，不能继续显示成"通过"。
 */
function verdictSummary(state, stepKey) {
  const raw = verificationsFor(state, stepKey)
  const verifications = effectiveSinceBack(state, raw)
  const last = verifications[verifications.length - 1]
  if (last !== undefined) {
    return `${last.verdict}（seq ${last.at ?? '?'}）`
      + (last.evidenceRef ? `，工质：${clip(last.evidenceRef, DETAIL_BUDGET)}` : '')
  }
  const checks = effectiveSinceBack(state, checksFor(state, stepKey))
  if (raw.length > 0) {
    if (checks.length > 0) {
      return '已重新采集证据但**还没有结论**——结论必须用 coach_verify 落盘；只在正文里写不算'
    }
    return `回退后旧结论已作废（最近一次回退 seq ${lastBackAt(state)}）；必须重新 coach_check + coach_verify`
  }
  if (checks.length > 0) {
    return '已采集证据但**还没有结论**——结论必须用 coach_verify 落盘；只在正文里写【核查结果】不算，'
      + '插件不会认、也不会推进'
  }
  return '尚无结论（先 coach_check 取证，再 coach_verify 判定）'
}

/** 没有生效步骤时的阶段引导。 */
function phaseGuidance(state) {
  switch (state.phase) {
    case 'INIT':
    case 'CHECK_TOOL_AVAILABILITY':
      return [
        '【下一步】现在**只有这几条路**（别的**教练工具**会被拒绝；ask_user_question 等只读/提问工具仍可用）：',
        '  1) 需要看环境时，用 coach_check 采集环境证据（这个阶段允许，记在 env 上，不推进状态）；',
        '  2) 可用性已知（yes / no）时，**必须同时提交 sections**：先问清用户水平'
          + '（从未用过 / 会基础 / 熟练想进阶）和目标，再调用 coach_plan；不要只报可用性。',
        '  3) 只有可用性还未知时，才可以只报 toolAvailable=unknown（sections 留空）；'
          + '随后立刻问用户「能不能打开并使用」，拿到明确答复后**立刻调用 coach_plan**（带 sections）。',
        '【可用性判断】只认三类证据：coach_check 已找到可执行文件或安装目录、用户明确说能打开并使用、'
          + '或用户说已经装好。任一成立就报 toolAvailable="yes"，直接走学习分支；'
          + '不要因为用户一开始说过「没装」就继续走安装分支。',
        '环境核查只查与当前工具相关的路径 / 命令；不要跑无关的白名单命令（查 Blender 时不要跑 git --version）。',
        '**不要跳过 coach_plan 直接开始教学或核查**：'
          + '计划没被接受之前，coach_verify / coach_advance / coach_skip 一律被拒绝。',
        '**计划没被接受前，不要在正文宣布「进入正式教学」**——以状态块的阶段为准。',
        '命令核查只对白名单里的只读命令开放：白名单外的命令才把该步的 evidence 设成 user_artifact，'
          + '让用户把输出贴过来，不要反复试 coach_check(kind="command")。',
      ]
    case 'PLAN':
      return [
        '【下一步】计划尚未生效：调用 coach_plan 提交板块与步骤。'
          + '每一步都必须给 goal / action / expected / standard / evidence；'
          + 'evidence 为 file 或 command 的步骤还必须给 check（kind + target）。',
      ]
    default:
      return []
  }
}

/** 检索缓存摘要（v0.3.0）。 */
function researchSummary(state) {
  const list = Array.isArray(state.research) ? state.research : []
  if (list.length === 0) return ''
  const shown = list.slice(-3).map((entry) => {
    const query = clip(entry.query ?? '', DETAIL_BUDGET)
    if (entry.ok === false) return `${query} → 失败`
    const count = Array.isArray(entry.sources) ? entry.sources.length : 0
    return `${query} → ${count} 个来源`
  })
  const last = list[list.length - 1]
  const head = `【检索缓存】${shown.join('；')}`
  if (last.ok === false) {
    return `${head}；最近一次失败：${clip(last.error ?? '没有查到可靠来源', DETAIL_BUDGET)}。`
      + '不要编造操作步骤；检索失败不等于本步判定失败，是否降级由 coach_verify 决定。'
  }
  return `${head}。检索结果只能补全“怎么做”，不能替代核查结论。`
}

/**
 * 渲染完整的每轮状态块。
 * @param {object} state CoachState。
 * @param {object} [facts] 宿主事实与配置：`{ failureThreshold, sameMachine, platform, cwd, allowCommands }`。
 * @returns {string} 注入文本；无内容时返回空串。
 */
export function renderStateBlock(state, facts = {}) {
  const failureThreshold = facts.failureThreshold ?? 3
  const allowCommands = Array.isArray(facts.allowCommands) ? facts.allowCommands : []
  const maxStateBlockChars = facts.maxStateBlockChars
  const environment = environmentLine(facts)
  const lines = [`【当前阶段】${phaseLabel(state.phase)}`]

  if (state.toolName !== null && state.toolName !== undefined && state.toolName !== '') {
    lines.push(`【学习工具】${state.toolName}`)
  }

  // v0.2.5：计划还没建立时，把"可用性已知/未知"和"还缺 sections"直接摆出来，
  // 避免模型把"已报可用性"误当成"计划已成立"，反复调用空计划。
  const setupPhase = state.phase === 'INIT' || state.phase === 'CHECK_TOOL_AVAILABILITY'
  if (setupPhase) {
    const hasTool = state.toolName !== null && state.toolName !== undefined && state.toolName !== ''
    if (hasTool) {
      const availability = state.toolAvailable === true
        ? '已确认可以打开并使用'
        : state.toolAvailable === false
          ? '已确认不能打开 / 未安装'
          : '尚未确认'
      lines.push(`【工具可用性】${availability}`)
      if ((state.toolAvailable === true || state.toolAvailable === false)
        && Array.isArray(state.plan) && state.plan.length === 0) {
        lines.push('【待补计划】可用性已经记录，但计划还没有步骤；先问清用户水平和目标，'
          + '再调用 coach_plan 提交 sections。')
      }
    }
    // v0.3.1：命令白名单在计划建立前也要显示——第一次“确认环境”就可能用到。
    if (allowCommands.length > 0) {
      lines.push(`【可跑命令】${allowCommands.join(' / ')}`
        + '（可直接用 coach_check(kind="command") 跑，不必先让用户手动跑）')
    }
  }

  if (state.phase === 'PAUSED') {
    const open = openPause(state)
    const pause = open?.pause
    const current = currentStep(state)
    const position = current === undefined
      ? `「${phaseLabel(pause?.fromPhase ?? 'INIT')}」阶段（计划尚未建立）`
      : `「${current.section.section}」（第 ${state.sectionIndex + 1}/${state.plan.length} 个板块）`
        + `第 ${state.stepIndex + 1}/${current.section.steps.length} 步：${current.step.goal}`
    lines.push(`【暂停位置】${position}`)
    if (pause !== undefined && pause.note !== '') {
      lines.push(`【暂停备注】${clip(pause.note, DETAIL_BUDGET)}`)
    }
    const summary = progressSummary(state)
    if (summary !== '') lines.push(summary)
    lines.push('说「继续」后调用 coach_pause({action:"resume"})；'
      + '暂停期间其它教练工具会被拒绝，不要继续讲课。')
    lines.push(environment)
    return applyBudget(lines, maxStateBlockChars).join('\n')
  }

  if (state.phase === 'COMPLETE') {
    const summary = progressSummary(state)
    if (summary !== '') lines.push(summary)
    lines.push('本次目标的全部步骤已经走完。请收尾：总结这次做了什么、复盘关键点、'
      + '列出所有被跳过的步骤（如有）、给出下一步学习建议。')
    lines.push(environment)
    return applyBudget(lines, maxStateBlockChars).join('\n')
  }

  const current = currentStep(state)

  if (current === undefined) {
    lines.push(...phaseGuidance(state))
    if (state.goalMode === 'install' && state.originalGoal) {
      lines.push(`【安装分支】当前在「安装并跑通 ${state.toolName ?? '工具'}」阶段；`
        + `原始目标「${state.originalGoal}」已保存在状态里，安装完成后会回到它。`)
    }
    const envChecks = checksFor(state, ENV_PROBE_KEY)
    if (envChecks.length > 0) {
      lines.push(`【环境核查】已采集 ${envChecks.length} 条：`
        + envChecks.slice(-3).map((check) => `${check.kind} ${clip(check.target ?? '', DETAIL_BUDGET)} → `
          + `${check.ok === true ? '成功' : '未通过'}（${clip(check.detail ?? '', DETAIL_BUDGET)}）`).join('；'))
    }
    const research = researchSummary(state)
    if (research !== '') lines.push(research)
    lines.push(environment)
    return applyBudget(lines, maxStateBlockChars).join('\n')
  }

  const { section, step, key } = current
  const failedAttempts = step.failedAttempts ?? 0

  lines.push(`【当前板块】${section.section}（第 ${state.sectionIndex + 1}/${state.plan.length} 个板块）`)
  lines.push(`【当前步骤】${step.goal}（第 ${state.stepIndex + 1}/${section.steps.length} 步）`)
  const summary = progressSummary(state)
  if (summary !== '') lines.push(summary)
  // v0.4.1：支撑等级只影响【请执行】讲多细，不影响【合格标准】与证据要求。
  // 放在【请执行】之前，让模型先读到“当前该讲多细”再写正文。
  lines.push(supportLine(state))
  lines.push(`【请执行】${step.action}`)
  lines.push(`【合格标准】${step.standard}`)
  lines.push(`【所需证据】${EVIDENCE_LABELS[step.evidence] ?? step.evidence}`)
  lines.push(`【本步失败次数】${failedAttempts}`)
  // v0.4.2：用量与预算。数字由状态算，模型不能改；超预算时这一行不裁。
  lines.push(usageLine(state, facts))
  lines.push(`【核查证据】${checkSummary(state, key)}`)
  lines.push(`【核查结论】${verdictSummary(state, key)}`)

  const back = latestBack(state)
  if (back !== undefined) {
    lines.push(`【回退记录】最近一次回退到「${back.stepKey}」`
      + `${typeof back.at === 'number' ? `（seq ${back.at}）` : ''}`
      + `${back.reason ? `，原因：${clip(back.reason, DETAIL_BUDGET)}` : ''}；`
      + '该次回退之前的结论、证据、跳过记录不再计入。')
  }

  const research = researchSummary(state)
  if (research !== '') lines.push(research)

  if (state.goalMode === 'install' && state.originalGoal) {
    lines.push(`【安装分支】当前在「安装并跑通 ${state.toolName ?? '工具'}」阶段；`
      + `原始目标「${state.originalGoal}」已保存在状态里，安装完成后会回到它。`)
  }

  if (state.goalMode === 'install') {
    lines.push('【安装分支·可早退】如果工具其实已经可用（coach_check 已找到可执行文件 / 安装目录，'
      + '或用户说已经装好并能打开），不要继续走安装确认：直接调用 '
      + 'coach_plan({ toolAvailable:"yes", goalMode:"learn", originalGoal:"<原目标>", sections:[…] }) '
      + '重新提交学习计划。插件会清空安装计划、保留原目标；sections 留空也可以，'
      + '状态会回到「拆解计划」等你补学习计划。')
  }

  lines.push(environment)

  if (state.phase === 'DEGRADED') {
    lines.push('【降级提示】本步已降级：证据不足，无法判断。'
      + '请让用户自检并把结果发过来，或用 coach_check 采集新证据后重新 coach_verify。'
      + '不允许因为用户说「做完了」就改判「通过」。')
  }

  if (reachedThreshold(state, failureThreshold)) {
    lines.push(`【强制出口】本步已在失败阈值上（${failedAttempts}/${failureThreshold}）。`
      + '必须给用户一个明确的出口，三选一：跳过这一步继续 / 暂停并保存进度 / 换个目标。'
      + '不允许无限期重复追问同一件事，也不允许用「我不再回应」这类方式停摆。'
      + '要跳过就显式调用 coach_skip 并说明原因，跳过必须说出口。')
  }

  const activeSkips = effectiveSinceBack(state, state.skips)
  if (activeSkips.length > 0) {
    const skipped = activeSkips
      .map((skip) => `${skip.stepKey}（${skip.reason}）`)
      .join('、')
    lines.push(`【跳过提醒】以下步骤之前被跳过，可能影响当前步骤：${skipped}。`
      + '如果当前步骤因为这些跳过而失败，优先回溯到被跳过的那一步，而不是继续往下推。')
  }

  return applyBudget(lines, maxStateBlockChars).join('\n')
}
