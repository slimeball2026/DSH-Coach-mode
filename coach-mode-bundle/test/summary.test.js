/**
 * v0.4.0 进度摘要：完成/跳过/剩余计数、回退失效、COMPLETE、无计划。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { initialState } from '../core/machine.js'
import { applyPlan } from '../core/plan.js'
import { applyAdvance, applyVerify } from '../core/verify.js'
import { applySkip } from '../core/skip.js'
import { applyBack } from '../core/back.js'
import { progressStats, progressSummary } from '../core/summary.js'

/** 三步计划。 */
function planned() {
  const steps = ['第一步', '第二步', '第三步'].map((goal) => ({
    goal,
    action: `做「${goal}」`,
    expected: '有结果',
    standard: '结果符合预期',
    evidence: 'user_artifact',
    check: null,
    skipped: false,
    skipReason: null,
    failedAttempts: 0,
  }))
  return applyPlan(initialState(), {
    toolName: 'Git',
    toolAvailable: true,
    userLevel: '从未用过',
    originalGoal: '学会提交代码',
    currentGoal: '学会提交代码',
    goalMode: 'learn',
    difficulty: '低',
    plan: [{ section: '基础', steps }],
  }, 10)
}

test('v0.4.0 摘要：没有计划时不显示', () => {
  assert.equal(progressSummary(initialState()), '')
  assert.equal(progressStats(initialState()), undefined)
})

test('v0.4.0 摘要：刚开始时 0/N', () => {
  const stats = progressStats(planned())
  assert.equal(stats.total, 3)
  assert.equal(stats.done, 0)
  assert.equal(stats.remaining, 3)
  assert.match(progressSummary(planned()), /已完成 0\/3 步.*剩余 3/)
})

test('v0.4.0 摘要：通过 + 跳过都计入完成', () => {
  let state = planned()
  state = applyVerify(state, { verdict: '通过', evidenceRef: '截图1.png', reason: '完成' }, 11)
  state = applyAdvance(state)
  state = applySkip(state, { reason: '先跳过' }, 12)
  const stats = progressStats(state)
  assert.equal(stats.passed, 1)
  assert.equal(stats.skipped, 1)
  assert.equal(stats.done, 2)
  assert.equal(stats.remaining, 1)
  const text = progressSummary(state)
  assert.match(text, /已完成 2\/3 步（其中跳过 1），剩余 1/)
  assert.match(text, /当前第 1\/1 板块/)
})

test('v0.4.0 摘要：回退后旧「通过」不再计入完成', () => {
  let state = planned()
  state = applyVerify(state, { verdict: '通过', evidenceRef: '截图1.png', reason: '完成' }, 11)
  state = applyAdvance(state)
  state = applyVerify(state, { verdict: '通过', evidenceRef: '截图2.png', reason: '完成' }, 12)
  state = applyAdvance(state)
  assert.equal(progressStats(state).passed, 2)

  state = applyBack(state, { stepKey: '0:0', reason: '重做' }, 20)
  const stats = progressStats(state)
  assert.equal(stats.passed, 0, '回退前的两步通过都作废')
  assert.equal(stats.remaining, 3)
})

test('v0.4.0 摘要：COMPLETE 显示全部完成与跳过数', () => {
  let state = planned()
  state = applySkip(state, { reason: '跳过' }, 11)
  state = applyAdvance(state)
  state = applyVerify(state, { verdict: '通过', evidenceRef: '截图2.png', reason: '完成' }, 12)
  state = applyAdvance(state)
  state = applyVerify(state, { verdict: '通过', evidenceRef: '截图3.png', reason: '完成' }, 13)
  state = applyAdvance(state)
  assert.equal(state.phase, 'COMPLETE')
  const text = progressSummary(state)
  assert.match(text, /全部 3 步完成（其中跳过 1）/)
})

test('v0.4.0 摘要：包含本步失败与检索次数', () => {
  let state = planned()
  state.plan[0].steps[0].failedAttempts = 2
  state = {
    ...state,
    research: [{ query: 'a', at: 11 }, { query: 'b', at: 12 }],
  }
  const text = progressSummary(state)
  assert.match(text, /本步失败 2/)
  assert.match(text, /检索 2 次/)
})
