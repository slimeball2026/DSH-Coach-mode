/**
 * v0.4.2 成本控制：检索按步预算、正文截断、状态块预算与【用量】。
 *
 * 口径见 SPEC §14；实现在 `core/research.js` 与 `core/render.js`。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { initialState } from '../core/machine.js'
import { applyPlan } from '../core/plan.js'
import { applyAdvance, applyCheck, applyVerify } from '../core/verify.js'
import {
  applyResearch,
  assertResearchBudget,
  researchCountForStep,
  researchStepKey,
} from '../core/research.js'
import { renderStateBlock } from '../core/render.js'
import { resolveCoachConfig } from '../config.js'

/** 一步的合法形状（user_artifact，不需要 check）。 */
function stepOf(goal) {
  return {
    goal,
    action: `做「${goal}」`,
    expected: '有结果',
    standard: '结果符合预期',
    evidence: 'user_artifact',
    check: null,
    skipped: false,
    skipReason: null,
    failedAttempts: 0,
  }
}

/** 两板块 × 两步。 */
function planned() {
  return applyPlan(initialState(), {
    toolName: 'Git',
    toolAvailable: true,
    userLevel: '会基础',
    originalGoal: '学会提交代码',
    currentGoal: '学会提交代码',
    goalMode: 'learn',
    difficulty: '低',
    plan: ['基础', '进阶'].map((name) => ({
      section: name,
      steps: [stepOf(`${name}第一步`), stepOf(`${name}第二步`)].map((step, index) => ({
        ...step,
        goal: `${name}第${index + 1}步`,
        action: `做「${name}第${index + 1}步」`,
      })),
    })),
  }, 10)
}

/** 一次成功的检索记录。 */
function researchAt(state, at, query = 'git 版本') {
  return applyResearch(state, {
    query,
    redacted: false,
    ok: true,
    sources: [{ url: 'https://git-scm.com', title: 'Git' }],
    truncated: false,
    content: 'x'.repeat(10),
  }, at, { contentMaxChars: 2000 })
}

test('v0.4.2 检索条目带 stepKey：有当前步骤用 stepKey，没有则记 env', () => {
  const empty = researchAt(initialState(), 5)
  assert.equal(researchStepKey(initialState()), 'env')
  assert.equal(empty.research[0].stepKey, 'env')

  const withStep = researchAt(planned(), 11)
  assert.equal(researchStepKey(planned()), '0:0')
  assert.equal(withStep.research[0].stepKey, '0:0')
  assert.equal(researchCountForStep(withStep, '0:0'), 1)
})

test('v0.4.2 同一步超过上限 → COACH_RESEARCH_BUDGET；换下一步额度重置', () => {
  let state = planned()
  state = researchAt(state, 11)
  state = researchAt(state, 12, '第二次')
  assert.equal(researchCountForStep(state, '0:0'), 2)
  assert.doesNotThrow(() => assertResearchBudget(state, 3))

  state = researchAt(state, 13, '第三次')
  assert.throws(() => assertResearchBudget(state, 3), (error) => {
    assert.equal(error.code, 'COACH_RESEARCH_BUDGET')
    return true
  })

  // 同一步失败调用也计数
  const failed = applyResearch(state, { query: '失败', ok: false, sources: [], error: '超时' }, 14, {})
  assert.equal(researchCountForStep(failed, '0:0'), 4)

  // 换到下一步 → 额度重置
  state = applyVerify(state, { verdict: '通过', evidenceRef: '截图.png', reason: '完成' }, 15)
  state = applyAdvance(state)
  assert.equal(researchStepKey(state), '0:1')
  assert.equal(researchCountForStep(state, '0:1'), 0)
  assert.doesNotThrow(() => assertResearchBudget(state, 3))
})

test('v0.4.2 检索正文按 researchContentMaxChars 截断，来源不受影响', () => {
  const long = 'a'.repeat(5000)
  const state = applyResearch(planned(), {
    query: '长正文',
    ok: true,
    sources: [{ url: 'https://example.com/x', title: 'T' }],
    content: long,
  }, 11, { contentMaxChars: 2000 })
  assert.equal(state.research[0].content.length, 2000)
  assert.equal(state.research[0].sources[0].url, 'https://example.com/x')

  // 不给选项时用默认 2000
  const fallback = applyResearch(planned(), {
    query: '长正文',
    ok: true,
    sources: [{ url: 'https://example.com/y' }],
    content: long,
  }, 11)
  assert.equal(fallback.research[0].content.length, 2000)
})

test('v0.4.2 【用量】数字准确：本步检索 / 本会话检索 / 本步核查', () => {
  let state = planned()
  state = applyCheck(state, { kind: 'path_exists', target: 'C:/tmp', ok: true, detail: '存在' }, 11)
  state = researchAt(state, 12)
  state = researchAt(state, 13, '第二次')

  const block = renderStateBlock(state, { maxResearchPerStep: 3 })
  assert.match(block, /【用量】本步检索 2\/3；本会话检索 2；本步核查 1 次/)

  // 换一步后本步清零、会话累计保留
  state = applyVerify(state, { verdict: '通过', evidenceRef: '截图.png', reason: '完成' }, 14)
  state = applyAdvance(state)
  const next = renderStateBlock(state, { maxResearchPerStep: 3 })
  assert.match(next, /【用量】本步检索 0\/3；本会话检索 2；本步核查 0 次/)
})

test('v0.4.2 状态块超预算按顺序裁剪，关键行永不裁', () => {
  const base = planned()
  // 造一个“多次跳过 + 多次回退 + 多条检索 + 长证据”的状态。
  const state = {
    ...base,
    skips: Array.from({ length: 8 }, (_value, index) => ({
      stepKey: `0:${index}`,
      reason: '这是一段很长的跳过原因，用来把状态块撑过预算。'.repeat(20),
      at: 20 + index,
    })),
    research: Array.from({ length: 3 }, (_value, index) => ({
      stepKey: '0:0',
      query: `检索词${index}`,
      ok: true,
      sources: [{ url: `https://example.com/${index}` }],
      content: 'c'.repeat(100),
      error: '',
      at: 30 + index,
    })),
    checks: Array.from({ length: 3 }, (_value, index) => ({
      stepKey: '0:0',
      kind: 'read_file',
      target: `C:/very/long/path/${index}.md`,
      ok: true,
      detail: '读取成功，内容是一段很长的说明文字'.repeat(6),
      at: 40 + index,
    })),
  }

  const unbudgeted = renderStateBlock(state, {})
  assert.ok(unbudgeted.length > 4000, `未限制时应超过 4000（实际 ${unbudgeted.length}）`)

  const block = renderStateBlock(state, { maxStateBlockChars: 4000 })
  assert.ok(block.length <= 4000, `状态块应 ≤4000，实际 ${block.length}`)
  // 永不裁
  assert.match(block, /【当前步骤】/)
  assert.match(block, /【请执行】/)
  assert.match(block, /【合格标准】/)
  assert.match(block, /【核查结论】/)
  // 第一优先级被换短提示
  assert.match(block, /【检索缓存】已省略/)
})

test('v0.4.2 预算小到装不下关键行时，宁可贵也不丢当前步骤', () => {
  const block = renderStateBlock(planned(), { maxStateBlockChars: 200 })
  assert.match(block, /【当前步骤】/)
  assert.match(block, /【请执行】/)
  assert.match(block, /【合格标准】/)
  assert.match(block, /【核查结论】/)
})

test('v0.4.2 Config 默认值与非法回落', () => {
  const defaults = resolveCoachConfig({})
  assert.equal(defaults.maxResearchPerStep, 3)
  assert.equal(defaults.maxStateBlockChars, 4000)
  assert.equal(defaults.researchContentMaxChars, 2000)

  const custom = resolveCoachConfig({
    maxResearchPerStep: 5,
    maxStateBlockChars: 2000,
    researchContentMaxChars: 800,
  })
  assert.equal(custom.maxResearchPerStep, 5)
  assert.equal(custom.maxStateBlockChars, 2000)
  assert.equal(custom.researchContentMaxChars, 800)

  const broken = resolveCoachConfig({
    maxResearchPerStep: '三',
    maxStateBlockChars: 0,
    researchContentMaxChars: -1,
  })
  assert.equal(broken.maxResearchPerStep, 3)
  assert.equal(broken.maxStateBlockChars, 4000)
  assert.equal(broken.researchContentMaxChars, 2000)
})
