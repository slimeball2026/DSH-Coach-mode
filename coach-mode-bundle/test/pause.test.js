/**
 * v0.4.0 暂停 / 恢复（`coach_pause`）：
 * 暂停进入 PAUSED、其它工具被拒、恢复回到原阶段、证据不作废；安装分支与 INIT 也能暂停。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CoachError,
  currentStep,
  hasPassedOrSkipped,
  initialState,
} from '../core/machine.js'
import { applyPause, openPause, MAX_PAUSE_NOTE_CHARS } from '../core/pause.js'
import { applyPlan, normalizePlanInput } from '../core/plan.js'
import { applyAdvance, applyCheck, applyVerify } from '../core/verify.js'
import { applyBack } from '../core/back.js'
import { applySkip, applyUserFeedback } from '../core/skip.js'
import { applyResearch } from '../core/research.js'

/** 一个步骤。 */
function step(goal, evidence) {
  return {
    goal,
    action: `做「${goal}」`,
    expected: '有结果',
    standard: '结果符合预期',
    evidence,
    check: evidence === 'file' ? { kind: 'path_exists', target: `C:/work/${goal}` } : null,
    skipped: false,
    skipReason: null,
    failedAttempts: 0,
  }
}

/** 两步计划（默认 user_artifact）。 */
function planned(evidence = 'user_artifact') {
  return applyPlan(initialState(), {
    toolName: 'Git',
    toolAvailable: true,
    userLevel: '从未用过',
    originalGoal: '学会提交代码',
    currentGoal: '学会提交代码',
    goalMode: 'learn',
    difficulty: '低',
    plan: [{ section: '基础', steps: [step('第一步', evidence), step('第二步', evidence)] }],
  }, 10)
}

/** 安装分支计划（单步）。 */
function installPlan() {
  return applyPlan(initialState(), normalizePlanInput({
    toolName: 'Photoshop',
    toolAvailable: 'no',
    userLevel: '从未用过',
    originalGoal: '学会抠图',
    difficulty: '低',
    sections: [{
      section: '安装',
      steps: [step('装上 Photoshop', 'user_artifact')],
    }],
  }, { maxPlanSteps: 12 }), 10)
}

test('v0.4.0 暂停：进入 PAUSED，记录位置与备注', () => {
  const state = planned()
  const paused = applyPause(state, { action: 'pause', note: '今天先到这' }, 20)
  assert.equal(paused.phase, 'PAUSED')
  assert.equal(paused.sectionIndex, 0)
  assert.equal(paused.stepIndex, 0)
  assert.equal(paused.pauses.length, 1)
  assert.equal(paused.pauses[0].fromPhase, 'WAIT_FEEDBACK')
  assert.equal(paused.pauses[0].stepKey, '0:0')
  assert.equal(paused.pauses[0].note, '今天先到这')
  assert.equal(paused.pauses[0].resumedAt, null)
  assert.equal(openPause(paused).index, 0)
})

test('v0.4.0 暂停：PAUSED 期间其它教练工具全部被拒', () => {
  const paused = applyPause(planned(), { action: 'pause' }, 20)
  assert.throws(() => applyCheck(paused, { kind: 'path_exists', target: 'x', ok: true, detail: '' }, 21),
    (error) => error.code === 'COACH_PHASE')
  assert.throws(() => applyVerify(paused, { verdict: '通过', evidenceRef: 'x' }, 22),
    (error) => error.code === 'COACH_PHASE')
  assert.throws(() => applyAdvance(paused), (error) => error.code === 'COACH_PHASE')
  assert.throws(() => applySkip(paused, { reason: '跳过' }, 23), (error) => error.code === 'COACH_PHASE')
  assert.throws(() => applyBack(paused, { stepKey: '0:0' }, 24), (error) => error.code === 'COACH_PHASE')
  assert.throws(() => applyResearch(paused, { query: 'x', ok: true, sources: [] }, 25),
    (error) => error.code === 'COACH_PHASE')
  assert.throws(() => applyPlan(paused, normalizePlanInput({
    toolName: 'Git',
    toolAvailable: 'yes',
    originalGoal: '学会提交代码',
    sections: [{ section: '基础', steps: [step('新计划', 'user_artifact')] }],
  }, { maxPlanSteps: 12 })), (error) => error.code === 'COACH_PHASE')
})

test('v0.4.0 恢复：回到原阶段与步骤，旧证据仍在', () => {
  let state = planned('file')
  state = applyCheck(state, {
    kind: 'path_exists', target: 'C:/work/第一步', ok: true, detail: '存在',
  }, 11)
  assert.equal(state.phase, 'VERIFY_DONE')
  const paused = applyPause(state, { action: 'pause', note: '暂停一下' }, 20)
  assert.equal(paused.phase, 'PAUSED')

  const resumed = applyPause(paused, { action: 'resume' }, 30)
  assert.equal(resumed.phase, 'VERIFY_DONE')
  assert.equal(resumed.sectionIndex, 0)
  assert.equal(resumed.stepIndex, 0)
  assert.equal(resumed.pauses[0].resumedAt, 30)
  assert.equal(openPause(resumed), undefined)
  // 证据没有作废：直接可以判。
  const verified = applyVerify(resumed, { verdict: '通过', evidenceRef: 'C:/work/第一步', reason: '存在' }, 31)
  assert.equal(verified.phase, 'NEXT_STEP')
})

test('v0.4.0 恢复：暂停前的「通过」仍然有效（不作废）', () => {
  let state = planned()
  state = applyVerify(state, { verdict: '通过', evidenceRef: '截图.png', reason: '完成' }, 11)
  state = applyAdvance(state)
  assert.equal(state.stepIndex, 1)
  assert.equal(hasPassedOrSkipped(state, '0:0'), true)

  const paused = applyPause(state, { action: 'pause' }, 20)
  const resumed = applyPause(paused, { action: 'resume' }, 30)
  assert.equal(hasPassedOrSkipped(resumed, '0:0'), true, '暂停不该让旧结论失效')
})

test('v0.4.0：没有暂停时 resume 被拒；重复 pause 被拒；非法 action 被拒', () => {
  assert.throws(() => applyPause(planned(), { action: 'resume' }, 20), (error) => error.code === 'COACH_PHASE')
  const paused = applyPause(planned(), { action: 'pause' }, 20)
  assert.throws(() => applyPause(paused, { action: 'pause' }, 21), (error) => error.code === 'COACH_PHASE')
  assert.throws(() => applyPause(planned(), { action: 'foo' }, 20), (error) => error.code === 'COACH_PAUSE_ACTION')
})

test('v0.4.0：安装分支里暂停，恢复后仍在 INSTALL_TOOL，目标与计划不丢', () => {
  const install = installPlan()
  assert.equal(install.phase, 'INSTALL_TOOL')
  const paused = applyPause(install, { action: 'pause', note: '先装一半' }, 20)
  assert.equal(paused.phase, 'PAUSED')
  const resumed = applyPause(paused, { action: 'resume' }, 30)
  assert.equal(resumed.phase, 'INSTALL_TOOL')
  assert.equal(resumed.goalMode, 'install')
  assert.equal(resumed.originalGoal, '学会抠图')
  assert.equal(resumed.plan.length, 1)
})

test('v0.4.0：PAUSED 里不能借 coach_plan 的安装分支早退绕过 resume', () => {
  const install = installPlan()
  const paused = applyPause(install, { action: 'pause' }, 20)
  const exitPayload = normalizePlanInput({
    toolName: 'Photoshop',
    toolAvailable: 'yes',
    goalMode: 'learn',
    originalGoal: '学会抠图',
    sections: [{ section: '选区', steps: [step('选中主体', 'user_artifact')] }],
  }, { maxPlanSteps: 12 }, paused)
  assert.throws(() => applyPlan(paused, exitPayload, 30), (error) => error.code === 'COACH_PHASE')
})

test('v0.4.0：INIT 也能暂停，恢复回到 INIT', () => {
  const paused = applyPause(initialState(), { action: 'pause' }, 5)
  assert.equal(paused.phase, 'PAUSED')
  assert.equal(paused.pauses[0].stepKey, null)
  assert.equal(currentStep(paused), undefined)
  const resumed = applyPause(paused, { action: 'resume' }, 6)
  assert.equal(resumed.phase, 'INIT')
})

test('v0.4.0：COMPLETE / PLAN 不允许暂停', () => {
  let done = planned()
  done = applyVerify(done, { verdict: '通过', evidenceRef: '截图1.png', reason: '完成' }, 11)
  done = applyAdvance(done)
  done = applyVerify(done, { verdict: '通过', evidenceRef: '截图2.png', reason: '完成' }, 12)
  done = applyAdvance(done)
  assert.equal(done.phase, 'COMPLETE')
  assert.throws(() => applyPause(done, { action: 'pause' }, 20), (error) => error.code === 'COACH_PHASE')
  assert.throws(() => applyPause({ ...initialState(), phase: 'PLAN' }, { action: 'pause' }, 20),
    (error) => error.code === 'COACH_PHASE')
})

test('v0.4.0：暂停备注超长会被截断', () => {
  const paused = applyPause(planned(), { action: 'pause', note: 'x'.repeat(300) }, 20)
  assert.ok(paused.pauses[0].note.length <= MAX_PAUSE_NOTE_CHARS)
})

test('v0.4.0：多次暂停/恢复，记录都保留且各自关闭', () => {
  let state = planned()
  state = applyPause(state, { action: 'pause', note: '第一次' }, 20)
  state = applyPause(state, { action: 'resume' }, 21)
  state = applyPause(state, { action: 'pause', note: '第二次' }, 22)
  state = applyPause(state, { action: 'resume' }, 23)
  assert.equal(state.pauses.length, 2)
  assert.equal(state.pauses[0].resumedAt, 21)
  assert.equal(state.pauses[1].resumedAt, 23)
  assert.equal(openPause(state), undefined)
})

test('v0.4.0：PAUSED 期间用户的零信息回复不累计失败次数', () => {
  const paused = applyPause(planned(), { action: 'pause' }, 20)
  const after = applyUserFeedback(paused, '不行', 21)
  assert.equal(after.plan[0].steps[0].failedAttempts, 0)
  assert.equal(after.phase, 'PAUSED')
})

test('v0.4.0：CoachError 类型稳定', () => {
  assert.throws(() => applyPause(initialState(), { action: 'resume' }, 1), (error) => {
    assert.ok(error instanceof CoachError)
    return true
  })
})
