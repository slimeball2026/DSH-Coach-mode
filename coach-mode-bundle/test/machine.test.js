/**
 * 状态机：10 个状态的全部合法转移、非法转移被拒、安装分支恢复原始目标、受控早退。
 * 纯核心单测，零依赖。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CoachError,
  PHASES,
  RESIDENT_PHASES,
  TRANSITIONAL_PHASES,
  initialState,
  isLastStep,
  reachedThreshold,
  restoreOriginalGoal,
} from '../core/machine.js'
import { applyPlan, normalizePlanInput } from '../core/plan.js'
import { applyAdvance, applyCheck, applyVerify } from '../core/verify.js'
import { applySkip } from '../core/skip.js'

/** 两步骤计划：第 1 步 file（需要 coach_check），第 2 步 user_artifact。 */
function basePayload() {
  return {
    toolName: 'Git',
    toolAvailable: true,
    userLevel: '从未用过',
    originalGoal: '学会提交代码',
    currentGoal: '学会提交代码',
    goalMode: 'learn',
    difficulty: '低',
    plan: [{
      section: '基础',
      steps: [
        {
          goal: '建立仓库',
          action: '在目标目录执行 git init',
          expected: '目录里出现 .git',
          standard: '目标目录下存在 .git',
          evidence: 'file',
          check: { kind: 'path_exists', target: 'C:/work/.git' },
          skipped: false,
          skipReason: null,
          failedAttempts: 0,
        },
        {
          goal: '确认工作区干净',
          action: '执行 git status 并截图',
          expected: '没有未跟踪文件',
          standard: '用户截图里没有未跟踪文件',
          evidence: 'user_artifact',
          check: null,
          skipped: false,
          skipReason: null,
          failedAttempts: 0,
        },
      ],
    }],
  }
}

/** 单步计划（user_artifact），用于"走完即终态"的用例。 */
function singleStepPayload() {
  const payload = basePayload()
  return { ...payload, plan: [{ section: '基础', steps: [payload.plan[0].steps[1]] }] }
}

test('11 个状态齐全，过渡态与驻留态划分正确', () => {
  assert.equal(PHASES.length, 11)
  assert.deepEqual(TRANSITIONAL_PHASES, ['PLAN', 'NEXT_STEP', 'RESEARCH'])
  assert.equal(RESIDENT_PHASES.length, 8)
  assert.equal(initialState().phase, 'INIT')
  assert.equal(initialState().stateVersion, 9, 'v0.4.2 的折叠语义版本是 9（research.stepKey + 正文截断）')
  assert.deepEqual(initialState().backs, [])
  assert.deepEqual(initialState().pauses, [])
  assert.deepEqual(initialState().research, [])
})

test('INIT → PLAN（过渡态）→ WAIT_FEEDBACK', () => {
  const accepted = applyPlan(initialState(), basePayload(), 10)
  assert.equal(accepted.phase, 'WAIT_FEEDBACK')
  assert.equal(accepted.sectionIndex, 0)
  assert.equal(accepted.stepIndex, 0)
  assert.equal(accepted.planAcceptedAt, 10)
})

test('INIT → CHECK_TOOL_AVAILABILITY（可用性未知时不落到 WAIT_FEEDBACK）', () => {
  const state = applyPlan(initialState(), { ...basePayload(), toolAvailable: null }, 10)
  assert.equal(state.phase, 'CHECK_TOOL_AVAILABILITY')
  assert.equal(state.planAcceptedAt, null)
})

test('可用性已知但 sections 为空：不接计划、停在原阶段（v0.2.5）', () => {
  const fromInit = applyPlan(initialState(), { ...basePayload(), plan: [] }, 10)
  assert.equal(fromInit.phase, 'INIT')
  assert.equal(fromInit.planAcceptedAt, null)
  assert.equal(fromInit.plan.length, 0)
  assert.equal(fromInit.toolAvailable, true)

  const checking = applyPlan(initialState(), {
    ...basePayload(), toolAvailable: null, plan: [],
  }, 5)
  const fromCheck = applyPlan(checking, { ...basePayload(), plan: [] }, 10)
  assert.equal(fromCheck.phase, 'CHECK_TOOL_AVAILABILITY')
  assert.equal(fromCheck.planAcceptedAt, null)
  assert.equal(fromCheck.toolAvailable, true)
})

test('CHECK_TOOL_AVAILABILITY → PLAN → WAIT_FEEDBACK', () => {
  const unknown = applyPlan(initialState(), {
    ...basePayload(),
    toolAvailable: null,
    plan: [],
  }, 5)
  assert.equal(unknown.phase, 'CHECK_TOOL_AVAILABILITY')

  const resolved = applyPlan(unknown, basePayload(), 8)
  assert.equal(resolved.phase, 'WAIT_FEEDBACK')
  assert.equal(resolved.planAcceptedAt, 8)
})

test('非法转移被拒：计划已接受后不能再 coach_plan（合格标准不得改写）', () => {
  const state = applyPlan(initialState(), basePayload(), 10)
  assert.throws(() => applyPlan(state, basePayload(), 20), (error) => {
    assert.ok(error instanceof CoachError)
    assert.equal(error.code, 'COACH_PHASE')
    return true
  })
})

test('非法转移被拒：WAIT_FEEDBACK 不能直接 coach_advance', () => {
  const state = applyPlan(initialState(), basePayload(), 10)
  assert.throws(() => applyAdvance(state), /不能在「等待反馈」阶段调用/)
})

test('VERIFY_DONE → NEXT_STEP → WAIT_FEEDBACK（逐步走完两个步骤）', () => {
  let state = applyPlan(initialState(), basePayload(), 10)
  assert.equal(state.phase, 'WAIT_FEEDBACK')

  state = applyCheck(state, { kind: 'path_exists', target: 'C:/work/.git', ok: true, detail: '存在' }, 11)
  assert.equal(state.phase, 'VERIFY_DONE')

  state = applyVerify(state, { verdict: '通过', evidenceRef: 'C:/work/.git', reason: '符合标准' }, 12)
  assert.equal(state.phase, 'NEXT_STEP')
  assert.equal(isLastStep(state), false)

  state = applyAdvance(state)
  assert.equal(state.phase, 'WAIT_FEEDBACK')
  assert.equal(state.stepIndex, 1)

  // 第二步是 user_artifact：判「通过」必须给工质。
  assert.throws(
    () => applyVerify(state, { verdict: '通过', evidenceRef: '', reason: '看起来做了' }, 13),
    /工质/,
  )
  state = applyVerify(state, { verdict: '通过', evidenceRef: '截图 1.png', reason: '截图里有' }, 14)
  assert.equal(state.phase, 'NEXT_STEP')
  assert.equal(isLastStep(state), true)

  state = applyAdvance(state)
  assert.equal(state.phase, 'COMPLETE')
})

test('COMPLETE 是终态：五个工具一律失败', () => {
  let state = applyPlan(initialState(), singleStepPayload(), 10)
  state = applyVerify(state, { verdict: '通过', evidenceRef: '截图.png' }, 11)
  state = applyAdvance(state)
  assert.equal(state.phase, 'COMPLETE')

  assert.throws(() => applyVerify(state, { verdict: '无法判断' }, 12), /已完成/)
  assert.throws(() => applySkip(state, { reason: '不想做了' }, 13), /已完成/)
  assert.throws(() => applyAdvance(state), /已完成/)
  assert.throws(() => applyPlan(state, basePayload(), 14), /已完成/)
})

test('安装分支：goalMode 切为 install、originalGoal 保留，走完后恢复', () => {
  const plan = applyPlan(initialState(), normalizePlanInput({
    toolName: 'Git',
    toolAvailable: 'no',
    userLevel: '从未用过',
    originalGoal: '学会提交代码',
    difficulty: '低',
    sections: [{
      section: '安装',
      steps: [{
        goal: '装上 Git',
        action: '跑安装包',
        expected: '命令行能识别 git',
        standard: 'git --version 有输出',
        evidence: 'user_artifact',
      }],
    }],
  }, { maxPlanSteps: 12 }), 10)

  assert.equal(plan.phase, 'INSTALL_TOOL')
  assert.equal(plan.goalMode, 'install')
  assert.equal(plan.originalGoal, '学会提交代码')
  assert.equal(plan.currentGoal, '安装并跑通 Git')

  let state = applyVerify(plan, { verdict: '通过', evidenceRef: 'git --version 输出' }, 11)
  assert.equal(state.phase, 'NEXT_STEP')

  state = applyAdvance(state)
  assert.equal(state.phase, 'PLAN')
  assert.equal(state.goalMode, 'learn')
  assert.equal(state.currentGoal, '学会提交代码')
  assert.equal(state.originalGoal, '学会提交代码')
  assert.deepEqual(state.plan, [])

  const replanned = applyPlan(state, basePayload(), 20)
  assert.equal(replanned.phase, 'WAIT_FEEDBACK')
})

test('安装分支核查不通过：留在 INSTALL_TOOL，不回到 WAIT_FEEDBACK', () => {
  const plan = applyPlan(initialState(), normalizePlanInput({
    toolName: 'Git',
    toolAvailable: 'no',
    userLevel: '从未用过',
    originalGoal: '学会提交代码',
    difficulty: '低',
    sections: [{
      section: '安装',
      steps: [{
        goal: '装上 Git',
        action: '跑安装包',
        expected: '命令行能识别 git',
        standard: 'git --version 有输出',
        evidence: 'user_artifact',
      }],
    }],
  }, { maxPlanSteps: 12 }), 10)
  assert.equal(plan.phase, 'INSTALL_TOOL')
  const failed = applyVerify(plan, { verdict: '不通过', reason: '没装上' }, 11)
  assert.equal(failed.phase, 'INSTALL_TOOL')
  assert.equal(failed.plan[0].steps[0].failedAttempts, 1)
})

test('restoreOriginalGoal 只在 install 分支生效', () => {
  const learn = applyPlan(initialState(), basePayload(), 10)
  assert.equal(restoreOriginalGoal(learn).goalMode, 'learn')
})

test('强制跳过：WAIT_FEEDBACK → NEXT_STEP，并留下跳过记录', () => {
  let state = applyPlan(initialState(), basePayload(), 10)
  state = applySkip(state, { reason: '用户说先往下走' }, 11)
  assert.equal(state.phase, 'NEXT_STEP')
  assert.equal(state.skips.length, 1)
  assert.equal(state.skips[0].reason, '用户说先往下走')
  assert.equal(state.plan[0].steps[0].skipped, true)

  state = applyAdvance(state)
  assert.equal(state.stepIndex, 1)
  assert.equal(state.phase, 'WAIT_FEEDBACK')
})

test('物理前提不可跳过：INIT / CHECK_TOOL_AVAILABILITY 时 coach_skip 直接失败', () => {
  assert.throws(() => applySkip(initialState(), { reason: '跳过' }, 1), (error) => {
    assert.equal(error.code, 'COACH_SKIP_PREREQUISITE')
    return true
  })

  const checking = applyPlan(initialState(), { ...basePayload(), toolAvailable: null, plan: [] }, 5)
  assert.equal(checking.phase, 'CHECK_TOOL_AVAILABILITY')
  assert.throws(() => applySkip(checking, { reason: '跳过' }, 6), (error) => {
    assert.equal(error.code, 'COACH_SKIP_PREREQUISITE')
    return true
  })
})

test('DEGRADED 可恢复：无法判断且无证据 → DEGRADED，coach_check 重新打开核查', () => {
  // 用 user_artifact 步骤：判「无法判断」且没有任何证据 → 按 SPEC 第 3 节进 DEGRADED。
  const state0 = applyPlan(initialState(), normalizePlanInput({
    toolName: 'Git',
    toolAvailable: 'yes',
    originalGoal: '学会提交代码',
    sections: [{
      section: '基础',
      steps: [{
        goal: '确认工作区干净',
        action: '执行 git status 并截图',
        expected: '没有未跟踪文件',
        standard: '截图里没有未跟踪文件',
        evidence: 'user_artifact',
        check: { kind: 'path_exists', target: 'C:/work/.git' },
      }],
    }],
  }, { maxPlanSteps: 12 }), 10)

  let state = applyVerify(state0, { verdict: '无法判断', reason: '没有证据' }, 11)
  assert.equal(state.phase, 'DEGRADED')

  state = applyCheck(state, { kind: 'path_exists', target: 'C:/work/.git', ok: true, detail: '存在' }, 12)
  assert.equal(state.phase, 'VERIFY_DONE')
})

test('失败阈值：不通过会累加 failedAttempts 并停在原步骤', () => {
  let state = applyPlan(initialState(), basePayload(), 10)
  state = applyCheck(state, { kind: 'path_exists', target: 'C:/work/.git', ok: false, detail: '不存在' }, 11)
  state = applyVerify(state, { verdict: '不通过', reason: '没看到 .git' }, 12)
  assert.equal(state.phase, 'WAIT_FEEDBACK')
  assert.equal(state.stepIndex, 0)
  assert.equal(state.plan[0].steps[0].failedAttempts, 1)
  assert.equal(reachedThreshold(state, 3), false)
})

test('失败阈值：达到阈值后状态可判定为"必须给出口"', () => {
  let state = applyPlan(initialState(), basePayload(), 10)
  let at = 11
  for (let attempt = 0; attempt < 3; attempt += 1) {
    state = applyCheck(state, { kind: 'path_exists', target: 'C:/work/.git', ok: false, detail: '不存在' }, at)
    at += 1
    state = applyVerify(state, { verdict: '不通过', reason: '还是不行' }, at)
    at += 1
  }
  assert.equal(state.plan[0].steps[0].failedAttempts, 3)
  assert.equal(reachedThreshold(state, 3), true)
})

// ─────────────────────────────────────────────────────────────────────────────
// v0.3.3：安装分支的受控早退（方案 A）
// ─────────────────────────────────────────────────────────────────────────────

/** 归一化前的安装计划入参。 */
function installInput() {
  return {
    toolName: 'Photoshop',
    toolAvailable: 'no',
    userLevel: '从未用过',
    originalGoal: '学会抠图',
    difficulty: '低',
    sections: [{
      section: '安装',
      steps: [{
        goal: '下载安装包',
        action: '从官网下载安装包',
        expected: '安装包在下载目录',
        standard: '安装包可执行',
        evidence: 'user_artifact',
      }],
    }],
  }
}

/** 进入安装分支（单步）。 */
function installState() {
  return applyPlan(initialState(), normalizePlanInput(installInput(), { maxPlanSteps: 12 }), 10)
}

/** 早退后提交的学习计划入参。 */
function learnInput(overrides = {}) {
  return {
    toolName: 'Photoshop',
    toolAvailable: 'yes',
    goalMode: 'learn',
    originalGoal: '学会抠图',
    difficulty: '低',
    sections: [{
      section: '选区基础',
      steps: [{
        goal: '用快速选择工具选中主体',
        action: '打开图片，用快速选择工具点主体',
        expected: '出现选区蚂蚁线',
        standard: '选区覆盖主体',
        evidence: 'user_artifact',
      }],
    }],
    ...overrides,
  }
}

test('v0.3.3 受控早退：安装分支里 coach_plan(yes + sections) → 学习分支，原目标保留', () => {
  const install = installState()
  const payload = normalizePlanInput(learnInput(), { maxPlanSteps: 12 }, install)
  const exited = applyPlan(install, payload, 20)
  assert.equal(exited.phase, 'WAIT_FEEDBACK')
  assert.equal(exited.planAcceptedAt, 20)
  assert.equal(exited.goalMode, 'learn')
  assert.equal(exited.originalGoal, '学会抠图')
  assert.equal(exited.currentGoal, '学会抠图')
  assert.equal(exited.sectionIndex, 0)
  assert.equal(exited.stepIndex, 0)
  assert.equal(exited.plan[0].section, '选区基础')
})

test('v0.3.3 受控早退：sections 留空 → PLAN，等待补学习计划', () => {
  const install = installState()
  const payload = normalizePlanInput(learnInput({ sections: undefined }), { maxPlanSteps: 12 }, install)
  const exited = applyPlan(install, payload, 20)
  assert.equal(exited.phase, 'PLAN')
  assert.equal(exited.planAcceptedAt, null)
  assert.deepEqual(exited.plan, [])
  assert.equal(exited.goalMode, 'learn')
  assert.equal(exited.currentGoal, '学会抠图')
  assert.equal(exited.originalGoal, '学会抠图')
})

test('v0.3.3 受控早退：toolAvailable 报 no / unknown 一律拒绝，仍在安装分支', () => {
  const cases = [
    { availability: 'no', goalMode: 'install' },
    { availability: 'unknown', goalMode: 'learn' },
  ]
  for (const { availability, goalMode } of cases) {
    const install = installState()
    const payload = normalizePlanInput(
      learnInput({ toolAvailable: availability, goalMode }),
      { maxPlanSteps: 12 },
      install,
    )
    assert.throws(() => applyPlan(install, payload, 20), (error) => {
      assert.ok(error instanceof CoachError)
      assert.equal(error.code, 'COACH_PLAN_INSTALL_EXIT')
      assert.match(error.message, /安装分支/)
      return true
    })
  }
})

test('v0.3.3 受控早退：清空旧安装步骤的结论与跳过，避免新计划 0:0 误用', () => {
  const base = installInput()
  const twoStep = normalizePlanInput({
    ...base,
    sections: [{
      section: '安装',
      steps: [base.sections[0].steps[0], {
        goal: '启动并新建文档',
        action: '启动 Photoshop 新建文档',
        expected: '出现空白画布',
        standard: '能新建空白文档',
        evidence: 'user_artifact',
      }],
    }],
  }, { maxPlanSteps: 12 })
  let install = applyPlan(initialState(), twoStep, 10)
  install = applyVerify(install, { verdict: '通过', evidenceRef: '下载截图.png', reason: '安装包在' }, 11)
  install = applyAdvance(install)
  assert.equal(install.phase, 'INSTALL_TOOL')
  assert.equal(install.stepIndex, 1)
  assert.equal(install.verifications.length, 1)

  const exited = applyPlan(install, normalizePlanInput(learnInput(), { maxPlanSteps: 12 }, install), 20)
  assert.deepEqual(exited.verifications, [])
  assert.deepEqual(exited.skips, [])
  assert.deepEqual(exited.checks, [])
})

test('v0.3.3 受控早退保留环境核查（env），只清步骤级证据', () => {
  let state = applyPlan(initialState(), normalizePlanInput({
    toolName: 'Photoshop',
    toolAvailable: 'unknown',
    originalGoal: '学会抠图',
  }, { maxPlanSteps: 12 }), 5)
  assert.equal(state.phase, 'CHECK_TOOL_AVAILABILITY')
  state = applyCheck(state, { kind: 'path_exists', target: 'D:/PS', ok: true, detail: '存在' }, 6)

  state = applyPlan(state, normalizePlanInput(installInput(), { maxPlanSteps: 12 }, state), 10)
  assert.equal(state.phase, 'INSTALL_TOOL')
  const exited = applyPlan(state, normalizePlanInput(
    learnInput({ sections: undefined }), { maxPlanSteps: 12 }, state,
  ), 20)
  assert.equal(exited.phase, 'PLAN')
  assert.equal(exited.checks.length, 1)
  assert.equal(exited.checks[0].stepKey, 'env')
})

test('v0.3.3 安装分支正常走完也清空步骤级证据（与早退对齐）', () => {
  const install = installState()
  const passed = applyVerify(install, { verdict: '通过', evidenceRef: '安装完成截图.png', reason: '能打开' }, 11)
  const restored = applyAdvance(passed)
  assert.equal(restored.phase, 'PLAN')
  assert.equal(restored.goalMode, 'learn')
  assert.equal(restored.currentGoal, '学会抠图')
  assert.deepEqual(restored.verifications, [])
  assert.deepEqual(restored.checks, [])
})
