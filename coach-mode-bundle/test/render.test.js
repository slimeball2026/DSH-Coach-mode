/**
 * 状态块渲染：必需字段齐全、【跳过提醒】只在有跳过时出现、空证据提示"尚未采集"。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { initialState } from '../core/machine.js'
import { renderStateBlock } from '../core/render.js'
import { applyPlan, normalizePlanInput } from '../core/plan.js'
import { applyAdvance, applyCheck, applyVerify } from '../core/verify.js'
import { applyBack } from '../core/back.js'
import { applyPause } from '../core/pause.js'
import { applyResearch } from '../core/research.js'
import { applySkip } from '../core/skip.js'

/** 两步骤计划。 */
function planned() {
  return applyPlan(initialState(), {
    toolName: 'Photoshop',
    toolAvailable: true,
    userLevel: '会基础',
    originalGoal: '学会抠图',
    currentGoal: '学会抠图',
    goalMode: 'learn',
    difficulty: '中',
    plan: [
      {
        section: '选区基础',
        steps: [
          {
            goal: '用快速选择工具选中主体',
            action: '打开图片，用快速选择工具点主体',
            expected: '主体周围出现选区蚂蚁线',
            standard: '选区覆盖主体且没有明显漏选',
            evidence: 'user_artifact',
            check: null,
            skipped: false,
            skipReason: null,
            failedAttempts: 0,
          },
          {
            goal: '输出透明背景 PNG',
            action: '导出为 PNG 并勾选透明度',
            expected: '导出的 PNG 背景透明',
            standard: '文件里背景是透明的',
            evidence: 'file',
            check: { kind: 'path_exists', target: 'C:/out/cut.png' },
            skipped: false,
            skipReason: null,
            failedAttempts: 0,
          },
        ],
      },
    ],
  }, 10)
}

const FACTS = {
  failureThreshold: 3,
  sameMachine: true,
  platform: 'win32',
  cwd: 'C:/work',
}

test('状态块包含 SPEC 第 7 节要求的全部字段', () => {
  const block = renderStateBlock(planned(), FACTS)
  for (const label of [
    '【当前阶段】',
    '【当前板块】',
    '【当前步骤】',
    '【请执行】',
    '【合格标准】',
    '【所需证据】',
    '【本步失败次数】',
    '【核查证据】',
    '【核查结论】',
    '【位置关系】',
  ]) {
    assert.ok(block.includes(label), `状态块缺少 ${label}`)
  }
  assert.match(block, /【当前阶段】等待反馈/)
  assert.match(block, /【当前板块】选区基础（第 1\/1 个板块）/)
  assert.match(block, /【所需证据】用户提供的截图 \/ 文件 \/ 报错原文/)
  assert.match(block, /【本步失败次数】0/)
})

test('空证据时提示"尚未采集"', () => {
  const block = renderStateBlock(planned(), FACTS)
  assert.match(block, /【核查证据】尚未采集/)
})

test('有证据时展示证据摘要', () => {
  let state = planned()
  state = applyCheck(state, { kind: 'path_exists', target: 'C:/out/cut.png', ok: true, detail: '存在（类型 file）' }, 11)
  const block = renderStateBlock(state, FACTS)
  assert.match(block, /path_exists C:\/out\/cut\.png → 成功/)
  assert.ok(!block.includes('【核查证据】尚未采集'))
  // v2.3：证据有了但结论没落盘时，必须点出来（A3 实测：模型只在正文写结论）
  assert.match(block, /【核查结论】已采集证据但\*\*还没有结论\*\*/)
  assert.match(block, /结论必须用 coach_verify 落盘/)
})

test('落盘之后【核查结论】显示结论与工质', () => {
  let state = planned()
  state = applyCheck(state, { kind: 'path_exists', target: 'C:/out/cut.png', ok: true, detail: '存在' }, 11)
  state = applyVerify(state, { verdict: '通过', evidenceRef: 'C:/out/cut.png', reason: '存在' }, 12)
  const block = renderStateBlock(state, FACTS)
  assert.match(block, /【核查结论】通过（seq 12）/)
  assert.match(block, /工质：C:\/out\/cut\.png/)
})

test('过往没有跳过时不出现【跳过提醒】', () => {
  const block = renderStateBlock(planned(), FACTS)
  assert.ok(!block.includes('【跳过提醒】'))
})

test('过往有跳过时出现【跳过提醒】并带上原因', () => {
  const skipped = applySkip(planned(), { reason: '用户说先往下走' }, 11)
  const block = renderStateBlock(skipped, FACTS)
  assert.match(block, /【跳过提醒】/)
  assert.match(block, /0:0（用户说先往下走）/)
})

test('达到失败阈值时出现【强制出口】，未达到时不出现', () => {
  const below = { ...planned() }
  below.plan[0].steps[0].failedAttempts = 2
  assert.ok(!renderStateBlock(below, FACTS).includes('【强制出口】'))

  below.plan[0].steps[0].failedAttempts = 3
  const block = renderStateBlock(below, FACTS)
  assert.match(block, /【强制出口】/)
  assert.match(block, /跳过这一步继续 \/ 暂停并保存进度 \/ 换个目标/)
  assert.match(block, /不允许用「我不再回应」/)
})

test('降级态渲染【降级提示】并按 R7 只允许「无法判断」', () => {
  let state = planned()
  state = applyVerify(state, { verdict: '无法判断', reason: '证据不足' }, 11)
  assert.equal(state.phase, 'DEGRADED')
  const block = renderStateBlock(state, FACTS)
  assert.match(block, /【降级提示】/)
  assert.match(block, /不允许因为用户说「做完了」就改判「通过」/)
})

test('终态 COMPLETE 渲染收尾指令', () => {
  const block = renderStateBlock({ ...planned(), phase: 'COMPLETE' }, FACTS)
  assert.match(block, /【当前阶段】已完成/)
  assert.match(block, /总结这次做了什么/)
})

test('可用性未知时渲染「先确认环境」引导，且不展示步骤', () => {
  const state = applyPlan(initialState(), {
    toolName: 'Photoshop',
    toolAvailable: null,
    userLevel: null,
    originalGoal: '学会抠图',
    currentGoal: '学会抠图',
    goalMode: 'learn',
    difficulty: null,
    plan: [],
  }, 10)
  assert.equal(state.phase, 'CHECK_TOOL_AVAILABILITY')
  const block = renderStateBlock(state, FACTS)
  assert.match(block, /【当前阶段】确认环境/)
  // v2.2：这一段必须直接命令模型"立刻调用 coach_plan"，并说明 coach_check 可用（F6）。
  assert.match(block, /立刻调用 coach_plan/)
  assert.match(block, /不要跳过 coach_plan 直接开始教学或核查/)
  assert.match(block, /用 coach_check 采集环境证据/)
  assert.match(block, /命令核查只对白名单/)
  assert.ok(!block.includes('【当前步骤】'))
})

test('可用性已知但 sections 为空：状态块显示可用性与待补计划（v0.2.5）', () => {
  const state = applyPlan(initialState(), {
    toolName: 'Git',
    toolAvailable: true,
    userLevel: null,
    originalGoal: '学会提交代码',
    currentGoal: '学会提交代码',
    goalMode: 'learn',
    difficulty: null,
    plan: [],
  }, 10)
  assert.equal(state.phase, 'INIT')
  const block = renderStateBlock(state, FACTS)
  assert.match(block, /【工具可用性】已确认可以打开并使用/)
  assert.match(block, /【待补计划】/)
  assert.match(block, /必须同时提交 sections/)
  assert.match(block, /先问清用户水平/)
})

test('计划未建立时的环境核查会出现在状态块里（v2.2）', async () => {
  const { applyCheck } = await import('../core/verify.js')
  let state = applyPlan(initialState(), {
    toolName: 'Git',
    toolAvailable: null,
    userLevel: null,
    originalGoal: '学会提交代码',
    currentGoal: '学会提交代码',
    goalMode: 'learn',
    difficulty: null,
    plan: [],
  }, 10)
  state = applyCheck(state, { kind: 'path_exists', target: 'C:/work/.git', ok: true, detail: '存在' }, 11)
  assert.equal(state.phase, 'CHECK_TOOL_AVAILABILITY', '环境核查不应推进阶段')
  const block = renderStateBlock(state, FACTS)
  assert.match(block, /【环境核查】/)
  assert.match(block, /path_exists/)
})

test('安装分支在状态块里保留原始目标（A6）', () => {
  const state = applyPlan(initialState(), normalizePlanInput({
    toolName: 'Photoshop',
    toolAvailable: 'no',
    userLevel: '从未用过',
    originalGoal: '学会抠图',
    goalMode: 'install',
    difficulty: '低',
    sections: [{
      section: '安装',
      steps: [{
        goal: '装上 Photoshop',
        action: '跑安装包',
        expected: '能打开',
        standard: '能打开并新建文档',
        evidence: 'user_artifact',
      }],
    }],
  }, { maxPlanSteps: 12 }), 10)
  assert.equal(state.phase, 'INSTALL_TOOL')
  assert.equal(state.goalMode, 'install')
  assert.equal(state.currentGoal, '安装并跑通 Photoshop')
  const block = renderStateBlock(state, FACTS)
  assert.match(block, /【安装分支】/)
  assert.match(block, /原始目标「学会抠图」已保存在状态里/)
})

test('sameMachine=false 时【位置关系】改写（远端 fs 后端的逃生阀）', () => {
  const block = renderStateBlock(planned(), { ...FACTS, sameMachine: false })
  assert.match(block, /可能不在用户本机上/)
  assert.ok(!block.includes('教练与用户运行在同一台机器上'))
})

test('渲染是纯函数：同样输入逐字节相同，且不随调用次数增长', () => {
  const state = planned()
  const first = renderStateBlock(state, FACTS)
  const second = renderStateBlock(state, FACTS)
  assert.equal(first, second)
  assert.ok(first.length < 4000)
})

test('INIT 阶段显示【可跑命令】并正确区分“教练工具”（v0.3.0 文案补丁）', () => {
  const state = applyPlan(initialState(), {
    toolName: 'Git',
    toolAvailable: true,
    userLevel: null,
    originalGoal: '学会提交代码',
    currentGoal: '学会提交代码',
    goalMode: 'learn',
    difficulty: null,
    plan: [],
  }, 10)
  const block = renderStateBlock(state, {
    ...FACTS,
    allowCommands: ['git --version', 'git status'],
  })
  assert.match(block, /【可跑命令】git --version \/ git status/)
  assert.match(block, /不必先让用户手动跑/)
  assert.match(block, /别的\*\*教练工具\*\*会被拒绝/)
  assert.match(block, /ask_user_question 等只读\/提问工具仍可用/)
  assert.match(block, /不要在正文宣布「进入正式教学」/)
})

test('检索成功时状态块显示【检索缓存】（v0.3.0）', () => {
  const state = applyResearch(planned(), {
    query: 'Photoshop 版本',
    ok: true,
    sources: [{ url: 'https://example.com', title: '官方文档' }],
    truncated: false,
  }, 11)
  const block = renderStateBlock(state, FACTS)
  assert.match(block, /【检索缓存】Photoshop 版本 → 1 个来源/)
  assert.match(block, /不能替代核查结论/)
})

test('INIT 且还没有 toolName 时也显示【可跑命令】（v0.3.1）', () => {
  const block = renderStateBlock(initialState(), {
    ...FACTS,
    allowCommands: ['git --version', 'git status'],
  })
  assert.match(block, /【可跑命令】git --version \/ git status/)
  assert.match(block, /不必先让用户手动跑/)
  assert.ok(!block.includes('【工具可用性】'), '还没 toolName 时不应编造可用性')
})

test('检索失败且有当前步骤时只显示【检索缓存】失败，不自动降级（v0.3.1）', () => {
  const state = applyResearch(planned(), {
    query: 'Photoshop 报错',
    ok: false,
    sources: [],
    error: '网络超时',
  }, 12)
  assert.equal(state.phase, 'WAIT_FEEDBACK')
  const block = renderStateBlock(state, FACTS)
  assert.match(block, /【检索缓存】Photoshop 报错 → 失败/)
  assert.match(block, /网络超时/)
  assert.match(block, /检索失败不等于本步判定失败/)
  assert.ok(!block.includes('【降级提示】'))
})

test('INSTALL_TOOL 状态块给出受控早退入口（v0.3.3）', () => {
  const state = applyPlan(initialState(), normalizePlanInput({
    toolName: 'Photoshop',
    toolAvailable: 'no',
    userLevel: '从未用过',
    originalGoal: '学会抠图',
    goalMode: 'install',
    difficulty: '低',
    sections: [{
      section: '安装',
      steps: [{
        goal: '装上 Photoshop',
        action: '跑安装包',
        expected: '能打开',
        standard: '能打开并新建文档',
        evidence: 'user_artifact',
      }],
    }],
  }, { maxPlanSteps: 12 }), 10)
  assert.equal(state.phase, 'INSTALL_TOOL')
  const block = renderStateBlock(state, FACTS)
  assert.match(block, /【安装分支·可早退】/)
  assert.ok(block.includes('coach_plan({ toolAvailable:"yes", goalMode:"learn"'))
  assert.match(block, /清空安装计划、保留原目标/)
})

test('INIT 引导写明可用性证据与环境核查范围（v0.3.3）', () => {
  const block = renderStateBlock(initialState(), FACTS)
  assert.match(block, /【可用性判断】/)
  assert.match(block, /不要跑无关的白名单命令/)
})

test('v0.3.4 回退后：状态块显示【回退记录】，旧结论不再显示成「通过」', () => {
  let state = planned()
  state = applyVerify(state, { verdict: '通过', evidenceRef: '选区.png', reason: '选中了' }, 12)
  state = applyAdvance(state)
  assert.equal(state.stepIndex, 1)
  state = applyBack(state, { stepKey: '0:0', reason: '选区做得不对，重来' }, 20)

  const block = renderStateBlock(state, FACTS)
  assert.match(block, /【回退记录】最近一次回退到「0:0」/)
  assert.match(block, /选区做得不对/)
  assert.match(block, /回退后旧结论已作废/)
  assert.ok(!block.includes('【核查结论】通过'), '回退前的通过不能再显示')
})

test('v0.3.4 回退后：旧 coach_check 证据不再计入', () => {
  let state = applyPlan(initialState(), {
    toolName: 'Photoshop',
    toolAvailable: true,
    userLevel: '会基础',
    originalGoal: '学会抠图',
    currentGoal: '学会抠图',
    goalMode: 'learn',
    difficulty: '中',
    plan: [{
      section: '选区基础',
      steps: [
        {
          goal: '导出透明 PNG',
          action: '导出 PNG',
          expected: '背景透明',
          standard: '文件背景透明',
          evidence: 'file',
          check: { kind: 'path_exists', target: 'C:/out/cut.png' },
          skipped: false,
          skipReason: null,
          failedAttempts: 0,
        },
        {
          goal: '裁剪',
          action: '裁剪图片',
          expected: '尺寸变小',
          standard: '尺寸符合要求',
          evidence: 'user_artifact',
          check: null,
          skipped: false,
          skipReason: null,
          failedAttempts: 0,
        },
      ],
    }],
  }, 10)
  state = applyCheck(state, {
    kind: 'path_exists', target: 'C:/out/cut.png', ok: true, detail: '存在',
  }, 11)
  state = applyVerify(state, { verdict: '通过', evidenceRef: 'C:/out/cut.png', reason: '存在' }, 12)
  state = applyAdvance(state)
  state = applyBack(state, { stepKey: '0:0', reason: '重新导出' }, 20)

  const block = renderStateBlock(state, FACTS)
  assert.match(block, /回退后旧证据不再计入/)
  assert.match(block, /回退后旧结论已作废/)
})

test('v0.4.0 正常步骤块显示【进度摘要】', () => {
  const block = renderStateBlock(planned(), FACTS)
  assert.match(block, /【进度摘要】已完成 0\/2 步/)
})

test('v0.4.0 PAUSED 块只显示暂停信息，不显示执行步骤', () => {
  const paused = applyPause(planned(), { action: 'pause', note: '今天先到这' }, 20)
  const block = renderStateBlock(paused, FACTS)
  assert.match(block, /【当前阶段】已暂停/)
  assert.match(block, /【暂停位置】.*选区基础/)
  assert.match(block, /【暂停备注】今天先到这/)
  assert.match(block, /【进度摘要】/)
  assert.match(block, /coach_pause\(\{action:"resume"\}\)/)
  assert.ok(!block.includes('【请执行】'), '暂停时不要继续给执行步骤')
  assert.ok(!block.includes('【合格标准】'))
  assert.ok(!block.includes('【核查结论】'))
})
