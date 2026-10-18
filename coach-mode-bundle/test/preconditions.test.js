/**
 * SPEC 第 5.2 节的四条确定性前置条件 —— **本切片的核心测试**。
 *
 * 这四条必须是代码里的 if：模型违反只会拿到失败的工具结果，拿不到成功返回。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { initialState } from '../core/machine.js'
import { applyPlan } from '../core/plan.js'
import { applyAdvance, applyCheck, applyVerify } from '../core/verify.js'
import { applyUserFeedback, isNoInfoFeedback } from '../core/skip.js'
import { applySkip } from '../core/skip.js'

/** 造一个单步计划，指定该步的证据类型。 */
function planWith(evidence, extra = {}) {
  const check = evidence === 'file' || evidence === 'command'
    ? { kind: evidence === 'file' ? 'path_exists' : 'command', target: 'C:/work/.git' }
    : null
  return applyPlan(initialState(), {
    toolName: 'Git',
    toolAvailable: true,
    userLevel: '从未用过',
    originalGoal: '学会提交代码',
    currentGoal: '学会提交代码',
    goalMode: 'learn',
    difficulty: '低',
    plan: [{
      section: '基础',
      steps: [{
        goal: '建立仓库',
        action: '执行 git init',
        expected: '出现 .git',
        standard: '目标目录下存在 .git',
        evidence,
        check,
        skipped: false,
        skipReason: null,
        failedAttempts: 0,
        ...extra,
      }],
    }],
  }, 10)
}

test('5.2(1) evidence=file 且没有 coach_check 证据 → coach_verify 直接失败', () => {
  const state = planWith('file')
  assert.throws(
    () => applyVerify(state, { verdict: '通过', reason: '用户说做完了' }, 11),
    (error) => {
      assert.equal(error.code, 'COACH_VERIFY_NO_CHECK')
      assert.match(error.message, /必须先用 coach_check 采集证据/)
      return true
    },
  )
})

test('5.2(1) evidence=command 且没有 coach_check 证据 → coach_verify 直接失败', () => {
  const state = planWith('command')
  assert.throws(
    () => applyVerify(state, { verdict: '不通过', reason: '跑不通' }, 11),
    (error) => {
      assert.equal(error.code, 'COACH_VERIFY_NO_CHECK')
      return true
    },
  )
})

test('5.2(1) 采集证据之后 coach_verify 才受理', () => {
  let state = planWith('file')
  state = applyCheck(state, { kind: 'path_exists', target: 'C:/work/.git', ok: true, detail: '存在' }, 11)
  state = applyVerify(state, { verdict: '通过', evidenceRef: 'C:/work/.git', reason: '存在 .git' }, 12)
  assert.equal(state.phase, 'NEXT_STEP')
})

test('5.2(2) evidence=none 只能判「无法判断」', () => {
  const state = planWith('none')
  for (const verdict of ['通过', '不通过']) {
    assert.throws(
      () => applyVerify(state, { verdict, reason: '我猜的' }, 11),
      (error) => {
        assert.equal(error.code, 'COACH_VERIFY_EVIDENCE_NONE')
        return true
      },
    )
  }
  const degraded = applyVerify(state, { verdict: '无法判断', reason: '无法核查' }, 11)
  assert.equal(degraded.phase, 'DEGRADED')
})

test('5.2(3) evidence=user_artifact 判「通过」必须给出工质', () => {
  const state = planWith('user_artifact')
  assert.throws(
    () => applyVerify(state, { verdict: '通过', reason: '用户说做完了' }, 11),
    (error) => {
      assert.equal(error.code, 'COACH_VERIFY_NO_ARTIFACT')
      return true
    },
  )
  const accepted = applyVerify(state, {
    verdict: '通过',
    evidenceRef: '截图 2026-01-01.png',
    reason: '截图里有 .git',
  }, 11)
  assert.equal(accepted.phase, 'NEXT_STEP')
})

test('5.2(3) user_artifact 判「无法判断」时不需要工质', () => {
  const state = planWith('user_artifact')
  const next = applyVerify(state, { verdict: '无法判断', reason: '用户只说了「有隐藏文件夹」' }, 11)
  assert.equal(next.phase, 'DEGRADED')
})

test('5.2(4) 没有「通过」或「跳过」记录时 coach_advance 直接失败', () => {
  const state = planWith('user_artifact')
  // 阶段不对的调用先被阶段闸挡掉。
  assert.throws(() => applyAdvance(state), /不能在「等待反馈」阶段调用/)

  // 直接造一个"已到 NEXT_STEP 但本步没有通过/跳过记录"的状态，验证最后一道闸本身。
  const forged = { ...state, phase: 'NEXT_STEP' }
  assert.throws(() => applyAdvance(forged), (error) => {
    assert.equal(error.code, 'COACH_ADVANCE_NOT_VERIFIED')
    assert.match(error.message, /「通过」或「跳过」记录/)
    return true
  })

  // 走完核查、拿到「通过」记录之后才放行。
  let passed = applyVerify(state, { verdict: '通过', evidenceRef: '截图.png', reason: '截图里有' }, 11)
  passed = applyAdvance(passed)
  assert.equal(passed.phase, 'COMPLETE')

  // 跳过同样构成推进依据。
  let skipped = applySkip(state, { reason: '用户要求' }, 11)
  assert.equal(skipped.phase, 'NEXT_STEP')
  skipped = applyAdvance(skipped)
  assert.equal(skipped.phase, 'COMPLETE')
})

test('第 6 节：同一步的重复核查必须引用新的 coach_check 证据', () => {
  let state = planWith('file')
  state = applyCheck(state, { kind: 'path_exists', target: 'C:/work/.git', ok: false, detail: '不存在' }, 11)
  state = applyVerify(state, { verdict: '不通过', reason: '没看到 .git' }, 12)
  assert.equal(state.phase, 'WAIT_FEEDBACK')

  // 没有新的 coach_check，直接第二次判定 → 拒绝（防止凭记忆重复判）
  assert.throws(
    () => applyVerify(state, { verdict: '不通过', reason: '还是不行' }, 13),
    (error) => {
      assert.equal(error.code, 'COACH_VERIFY_STALE_EVIDENCE')
      return true
    },
  )

  // 采集新证据之后就放行
  state = applyCheck(state, { kind: 'path_exists', target: 'C:/work/.git', ok: true, detail: '存在' }, 14)
  state = applyVerify(state, { verdict: '通过', evidenceRef: 'C:/work/.git', reason: '这次有了' }, 15)
  assert.equal(state.phase, 'NEXT_STEP')
})

test('coach_check 的 stepKey 必须等于当前步骤', () => {
  const state = planWith('file')
  assert.throws(
    () => applyCheck(state, { stepKey: '9:9', kind: 'path_exists', target: 'x', ok: true, detail: '存在' }, 11),
    (error) => {
      assert.equal(error.code, 'COACH_CHECK_STEP_MISMATCH')
      return true
    },
  )
})

test('coach_verify 的 verdict 只接受三个取值', () => {
  const state = planWith('user_artifact')
  assert.throws(
    () => applyVerify(state, { verdict: '差不多算通过', reason: '含糊' }, 11),
    (error) => {
      assert.equal(error.code, 'COACH_VERIFY_VERDICT')
      return true
    },
  )
})

test('计划校验：evidence 为 file 的步骤缺少 check 时拒绝', async () => {
  const { normalizePlanInput } = await import('../core/plan.js')
  assert.throws(
    () => normalizePlanInput({
      toolName: 'Git',
      toolAvailable: 'yes',
      originalGoal: '学会提交代码',
      sections: [{
        section: '基础',
        steps: [{
          goal: '建立仓库',
          action: 'git init',
          expected: '出现 .git',
          standard: '存在 .git',
          evidence: 'file',
        }],
      }],
    }, { maxPlanSteps: 12 }),
    (error) => {
      assert.equal(error.code, 'COACH_PLAN_NO_CHECK')
      return true
    },
  )
})

test('计划校验：步骤总数超过 maxPlanSteps 时拒绝', async () => {
  const { normalizePlanInput } = await import('../core/plan.js')
  const steps = Array.from({ length: 4 }, (_unused, index) => ({
    goal: `第 ${index} 步`,
    action: '做点什么',
    expected: '有结果',
    standard: '看得到结果',
    evidence: 'user_artifact',
  }))
  assert.throws(
    () => normalizePlanInput({
      toolName: 'Git',
      toolAvailable: 'yes',
      originalGoal: '学会提交代码',
      sections: [{ section: '基础', steps }],
    }, { maxPlanSteps: 3 }),
    (error) => {
      assert.equal(error.code, 'COACH_PLAN_TOO_LARGE')
      return true
    },
  )
})

test('计划校验：工具不可用却声明 learn 模式被拒', async () => {
  const { normalizePlanInput } = await import('../core/plan.js')
  assert.throws(
    () => normalizePlanInput({
      toolName: 'Git',
      toolAvailable: 'no',
      goalMode: 'learn',
      originalGoal: '学会提交代码',
    }, { maxPlanSteps: 12 }),
    /install/,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// v2.2：A2 / A5 实机失败后补的三条
// ─────────────────────────────────────────────────────────────────────────────

test('计划未建立时 coach_check 允许做环境核查，且不推进阶段（F6 / A2）', () => {
  const checking = applyPlan(initialState(), {
    toolName: 'Git',
    toolAvailable: null,
    userLevel: null,
    originalGoal: '学会提交代码',
    currentGoal: '学会提交代码',
    goalMode: 'learn',
    difficulty: null,
    plan: [],
  }, 10)
  assert.equal(checking.phase, 'CHECK_TOOL_AVAILABILITY')

  const after = applyCheck(checking, {
    kind: 'list_dir',
    target: 'C:\\Users\\me\\Desktop\\test',
    ok: true,
    detail: '共 3 个条目',
  }, 11)

  assert.equal(after.phase, 'CHECK_TOOL_AVAILABILITY', '环境核查不能推进阶段')
  assert.equal(after.checks.length, 1)
  assert.equal(after.checks[0].stepKey, 'env')
  assert.equal(after.verifications.length, 0)
})

test('环境核查不能冒用真实步骤键', () => {
  assert.throws(
    () => applyCheck(initialState(), { stepKey: '0:0', kind: 'path_exists', target: 'x', ok: true, detail: '' }, 5),
    (error) => {
      assert.equal(error.code, 'COACH_CHECK_STEP_MISMATCH')
      return true
    },
  )
})

test('coach_check 的 kind 必须在允许集合里（v0.2.5）', () => {
  assert.throws(
    () => applyCheck(planWith('file'), { kind: 'none', target: 'x', ok: true, detail: '' }, 5),
    (error) => {
      assert.equal(error.code, 'COACH_CHECK_KIND')
      return true
    },
  )
})

test('零信息反馈的判定刻意保守', () => {
  for (const text of ['不行', '还是不行', ' 还是不行。', '不 行', '没反应', '还是没好']) {
    assert.equal(isNoInfoFeedback(text), true, `「${text}」应当算零信息`)
  }
  for (const text of [
    '不行，报错是 not a git repository',
    '我跑了 git init，出来一堆字',
    '能打开',
    '做完了',
    '我不知道在哪，就在我桌面上那个 test 文件夹里，你去帮我看看吧',
  ]) {
    assert.equal(isNoInfoFeedback(text), false, `「${text}」不该算零信息`)
  }
})

test('连续 3 次零信息反馈会累加到阈值（F2 / A5）', () => {
  let state = planWith('user_artifact')
  assert.equal(state.phase, 'WAIT_FEEDBACK')

  state = applyUserFeedback(state, '不行', 11)
  state = applyUserFeedback(state, '还是不行', 12)
  assert.equal(state.plan[0].steps[0].failedAttempts, 2)

  state = applyUserFeedback(state, '还是不行', 13)
  assert.equal(state.plan[0].steps[0].failedAttempts, 3)
  assert.equal(state.phase, 'WAIT_FEEDBACK', '只计数，不改变阶段')
})

test('一轮无效反馈只计一次：用户说「不行」+ 随后的 coach_verify 不重复加（F2 口径）', () => {
  let state = planWith('user_artifact')
  state = applyUserFeedback(state, '不行', 11)
  assert.equal(state.plan[0].steps[0].failedAttempts, 1)

  // 模型随后判「无法判断」——这一轮已经记过了，不该再加一次。
  state = applyVerify(state, { verdict: '无法判断', reason: '没有任何证据' }, 12)
  assert.equal(state.plan[0].steps[0].failedAttempts, 1, '一轮只应计一次')

  // 下一轮再给零信息反馈，才继续累加。
  state = applyUserFeedback(state, '还是不行', 13)
  assert.equal(state.plan[0].steps[0].failedAttempts, 2)
})

test('有信息的反馈不会累加失败次数', () => {
  let state = planWith('user_artifact')
  state = applyUserFeedback(state, '不行，报错是 not a git repository', 11)
  assert.equal(state.plan[0].steps[0].failedAttempts, 0)
  assert.equal(state.pendingNoInfoAt, null)
})
