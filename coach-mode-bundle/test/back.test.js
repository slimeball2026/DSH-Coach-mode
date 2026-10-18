/**
 * v0.3.4 回退（`coach_back`）：目标解析、只能往回退、旧结论/证据失效、重核后恢复推进。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CoachError,
  currentStep,
  hasPassedOrSkipped,
  initialState,
  lastBackAt,
} from '../core/machine.js'
import { applyBack, resolveBackTarget } from '../core/back.js'
import { applyPlan } from '../core/plan.js'
import { applyAdvance, applyCheck, applyVerify } from '../core/verify.js'
import { applySkip } from '../core/skip.js'

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

/** 三步计划（默认 user_artifact，便于不取证直接判）。 */
function planned(steps = [step('第一步', 'user_artifact'), step('第二步', 'user_artifact'), step('第三步', 'user_artifact')]) {
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

/** 把状态推进到指定步骤（每步先判通过再 advance）。 */
function advanceTo(state, targetStepIndex) {
  let current = state
  let at = 20
  while (current.stepIndex < targetStepIndex) {
    current = applyVerify(current, {
      verdict: '通过',
      evidenceRef: `第 ${current.stepIndex + 1} 步截图.png`,
      reason: '按标准完成',
    }, at)
    at += 1
    current = applyAdvance(current)
    at += 1
  }
  return { state: current, at }
}

test('v0.3.4：从第 3 步回退到第 2 步，只追加 backs，阶段回等待反馈', () => {
  const { state, at } = advanceTo(planned(), 2)
  assert.equal(state.phase, 'WAIT_FEEDBACK')
  assert.equal(state.stepIndex, 2)
  assert.equal(state.verifications.length, 2)

  const back = applyBack(state, { stepKey: '0:1', reason: '刚才那步没做对' }, at)
  assert.equal(back.phase, 'WAIT_FEEDBACK')
  assert.equal(back.sectionIndex, 0)
  assert.equal(back.stepIndex, 1)
  assert.equal(back.backs.length, 1)
  assert.equal(back.backs[0].stepKey, '0:1')
  assert.equal(back.backs[0].reason, '刚才那步没做对')
  assert.equal(back.backs[0].at, at)
  assert.equal(lastBackAt(back), at)
  // 历史不改写：旧的结论仍在，只是不再计入。
  assert.equal(back.verifications.length, 2)
  assert.equal(currentStep(back).key, '0:1')
})

test('v0.3.4：回退后旧「通过」不再算数，必须重核才能推进（A11）', () => {
  const { state, at } = advanceTo(planned(), 2)
  const back = applyBack(state, { stepKey: '0:1' }, at)

  assert.equal(hasPassedOrSkipped(back, '0:1'), false, '回退前的通过必须失效')
  assert.throws(() => applyAdvance(back), /不能在「等待反馈」阶段调用|还没有通过核查/)

  // 重新判通过（user_artifact 需要工质）之后才恢复 NEXT_STEP。
  const reverified = applyVerify(back, {
    verdict: '通过',
    evidenceRef: '重新做的截图.png',
    reason: '这次符合标准',
  }, at + 1)
  assert.equal(reverified.phase, 'NEXT_STEP')
  assert.equal(hasPassedOrSkipped(reverified, '0:1'), true)

  const advanced = applyAdvance(reverified)
  assert.equal(advanced.stepIndex, 2)
  // 第 3 步的旧通过也被这次回退作废（比回退更早），需要重核。
  assert.equal(hasPassedOrSkipped(advanced, '0:2'), false)
})

test('v0.3.4：省略目标时回到上一步', () => {
  const { state, at } = advanceTo(planned(), 2)
  const back = applyBack(state, {}, at)
  assert.equal(back.stepIndex, 1)
  assert.equal(back.backs[0].stepKey, '0:1')
})

test('v0.3.4：在第一步回退会被拒绝', () => {
  const state = planned()
  assert.throws(() => applyBack(state, {}, 20), (error) => {
    assert.equal(error.code, 'COACH_BACK_TARGET')
    return true
  })
})

test('v0.3.4：不能往前跳，目标必须早于当前步骤', () => {
  const { state, at } = advanceTo(planned(), 1)
  assert.throws(() => applyBack(state, { stepKey: '0:2' }, at), (error) => {
    assert.equal(error.code, 'COACH_BACK_FORWARD')
    return true
  })
  assert.throws(() => applyBack(state, { stepKey: '0:1' }, at), (error) => {
    assert.equal(error.code, 'COACH_BACK_FORWARD')
    return true
  })
})

test('v0.3.4：目标不存在 / 参数畸形被拒', () => {
  const { state, at } = advanceTo(planned(), 2)
  for (const input of [
    { stepKey: '9:9' },
    { stepKey: 'abc' },
    { sectionIndex: 0 },
    { sectionIndex: -1, stepIndex: 0 },
  ]) {
    assert.throws(() => applyBack(state, input, at), (error) => {
      assert.equal(error.code, 'COACH_BACK_TARGET')
      return true
    })
  }
})

test('v0.3.4：INIT / PLAN 阶段不允许回退', () => {
  for (const state of [
    initialState(),
    { ...initialState(), phase: 'PLAN' },
    { ...initialState(), phase: 'CHECK_TOOL_AVAILABILITY' },
  ]) {
    assert.throws(() => applyBack(state, { stepKey: '0:0' }, 1), (error) => {
      assert.equal(error.code, 'COACH_PHASE')
      return true
    })
  }
})

test('v0.3.4：COMPLETE 后仍可回退', () => {
  const { state, at } = advanceTo(planned(), 2)
  const completed = applyAdvance(applyVerify(state, {
    verdict: '通过', evidenceRef: '第三步截图.png', reason: '完成',
  }, at))
  assert.equal(completed.phase, 'COMPLETE')
  const back = applyBack(completed, { stepKey: '0:0', reason: '想复习第一步' }, at + 1)
  assert.equal(back.phase, 'WAIT_FEEDBACK')
  assert.equal(back.stepIndex, 0)
  assert.equal(hasPassedOrSkipped(back, '0:0'), false)
})

test('v0.3.4：回退后旧 coach_check 证据不计入，必须重新取证', () => {
  const state = planned([
    step('建立仓库', 'file'),
    step('暂存文件', 'user_artifact'),
  ])
  let current = applyCheck(state, {
    kind: 'path_exists', target: 'C:/work/建立仓库', ok: true, detail: '存在',
  }, 11)
  current = applyVerify(current, { verdict: '通过', evidenceRef: 'C:/work/建立仓库', reason: '存在' }, 12)
  current = applyAdvance(current)
  assert.equal(current.stepIndex, 1)

  current = applyBack(current, { stepKey: '0:0', reason: '重新来' }, 30)
  assert.throws(
    () => applyVerify(current, { verdict: '通过', evidenceRef: 'C:/work/建立仓库', reason: '旧证据' }, 31),
    (error) => {
      assert.equal(error.code, 'COACH_VERIFY_NO_CHECK')
      assert.match(error.message, /回退/)
      return true
    },
  )

  // 回退之后重新取证，才允许判。
  current = applyCheck(current, {
    kind: 'path_exists', target: 'C:/work/建立仓库', ok: true, detail: '重新确认存在',
  }, 32)
  current = applyVerify(current, { verdict: '通过', evidenceRef: 'C:/work/建立仓库', reason: '新证据' }, 33)
  assert.equal(current.phase, 'NEXT_STEP')
})

test('v0.3.4：回退后旧跳过记录也失效，需要重新 coach_skip', () => {
  const { state, at } = advanceTo(planned(), 1)
  const skipped = applySkip(state, { reason: '先跳过' }, at)
  assert.equal(skipped.phase, 'NEXT_STEP')
  const advanced = applyAdvance(skipped)
  assert.equal(advanced.stepIndex, 2)

  const back = applyBack(advanced, { stepKey: '0:1' }, at + 1)
  assert.equal(hasPassedOrSkipped(back, '0:1'), false, '回退前的跳过必须失效')
  const skippedAgain = applySkip(back, { reason: '还是跳过' }, at + 2)
  assert.equal(skippedAgain.phase, 'NEXT_STEP')
  assert.equal(hasPassedOrSkipped(skippedAgain, '0:1'), true)
})

test('v0.3.4：回退保留 failedAttempts，供阈值参考', () => {
  const base = planned()
  base.plan[0].steps[1].failedAttempts = 2
  const { state, at } = advanceTo(base, 2)
  const back = applyBack(state, { stepKey: '0:1' }, at)
  assert.equal(back.plan[0].steps[1].failedAttempts, 2)
})

test('v0.3.4：resolveBackTarget 支持 stepKey 与 sectionIndex+stepIndex', () => {
  const { state } = advanceTo(planned(), 2)
  assert.equal(resolveBackTarget(state, { stepKey: '0:0' }).key, '0:0')
  assert.equal(resolveBackTarget(state, { sectionIndex: 0, stepIndex: 1 }).key, '0:1')
  assert.equal(resolveBackTarget(state, {}).key, '0:1')
})

test('v0.3.4：CoachError 类型稳定', () => {
  assert.throws(() => applyBack(initialState(), {}, 1), (error) => {
    assert.ok(error instanceof CoachError)
    return true
  })
})
