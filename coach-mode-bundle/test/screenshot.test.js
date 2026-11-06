/**
 * v0.4.3 截图软核查（screen 证据 / screenshot 取证）的规则测试。
 *
 * 重点不是"能不能截"，而是"截图不能替用户交作业"：
 * 这四条规则必须是代码里的 if，模型绕不过去。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { initialState } from '../core/machine.js'
import { applyPlan, normalizeSections } from '../core/plan.js'
import { renderStateBlock } from '../core/render.js'
import { applyUserFeedback } from '../core/skip.js'
import { applyCheck, applyVerify, normalizeShot } from '../core/verify.js'
import { applyToolCall } from '../core/reduce.js'
import { resolveCoachConfig } from '../config.js'

/** 造一个"只看界面"的单步计划。 */
function screenPlan(overrides = {}) {
  const plan = normalizeSections([{
    section: '基础',
    steps: [{
      goal: '打开材质属性面板',
      action: '点右侧材质标签',
      expected: '出现材质属性面板',
      standard: '右侧出现材质属性面板',
      evidence: 'screen',
      check: { kind: 'screenshot', target: 'blender' },
      ...overrides,
    }],
  }], { maxPlanSteps: 12 })
  return applyPlan(initialState(), {
    toolName: 'Blender',
    toolAvailable: true,
    userLevel: '会基础',
    originalGoal: '打开材质面板',
    currentGoal: '打开材质面板',
    goalMode: 'learn',
    difficulty: '低',
    plan,
  }, 10)
}

/** 一条成功的截图核查。 */
function shotCheck(at, overrides = {}) {
  return {
    kind: 'screenshot',
    target: 'blender',
    ok: true,
    detail: '窗口「Blender」已截图 800×600',
    shot: {
      id: 'att-shot-1',
      path: 'C:\\work\\.coach\\shots\\shot-1.png',
      width: 800,
      height: 600,
      window: 'Blender',
      process: 'blender',
      pid: 4242,
    },
    at,
    ...overrides,
  }
}

test('v0.4.3 计划：evidence=screen 必须带 check.kind=screenshot', () => {
  assert.throws(
    () => normalizeSections([{
      section: '基础',
      steps: [{
        goal: '打开面板',
        action: '点一下',
        expected: '面板出现',
        standard: '面板在',
        evidence: 'screen',
      }],
    }], { maxPlanSteps: 12 }),
    (error) => {
      assert.equal(error.code, 'COACH_PLAN_NO_CHECK')
      assert.match(error.message, /screenshot/)
      return true
    },
  )
})

test('v0.4.3 计划：证据类型与核查种类必须配对', () => {
  const step = (evidence, check) => ({
    section: '基础',
    steps: [{
      goal: '打开面板',
      action: '点一下',
      expected: '面板出现',
      standard: '面板在',
      evidence,
      check,
    }],
  })
  assert.throws(
    () => normalizeSections([step('screen', { kind: 'path_exists', target: 'C:/work' })], { maxPlanSteps: 12 }),
    (error) => {
      assert.equal(error.code, 'COACH_PLAN_CHECK_MISMATCH')
      return true
    },
  )
  assert.throws(
    () => normalizeSections([step('file', { kind: 'screenshot', target: 'blender' })], { maxPlanSteps: 12 }),
    (error) => {
      assert.equal(error.code, 'COACH_PLAN_CHECK_MISMATCH')
      return true
    },
  )
})

test('v0.4.3 判定：没有任何截图取证 → 不能判「通过」', () => {
  let state = screenPlan()
  state = applyUserFeedback(state, '打开了', 20)
  state = applyCheck(state, { kind: 'read_file', target: 'C:/work/notes.txt', ok: true, detail: '文本' }, 21)
  assert.throws(
    () => applyVerify(state, { verdict: '通过', reason: '应该没问题' }, 22),
    (error) => {
      assert.equal(error.code, 'COACH_VERIFY_NO_SCREEN')
      return true
    },
  )
})

test('v0.4.3 判定：截图必须是用户这次反馈之后抓的', () => {
  let state = screenPlan()
  // 先截图、后反馈：这张图是用户动手之前的画面。
  state = applyCheck(state, {
    kind: 'screenshot', target: 'blender', ok: true, detail: '旧图',
    shot: shotCheck(15).shot,
  }, 15)
  state = applyUserFeedback(state, '打开了', 20)
  assert.throws(
    () => applyVerify(state, { verdict: '通过', reason: '截图里有面板' }, 21),
    (error) => {
      assert.equal(error.code, 'COACH_VERIFY_SCREEN_STALE')
      return true
    },
  )
})

test('v0.4.3 判定：反馈之后抓的截图才放行', () => {
  let state = screenPlan()
  state = applyUserFeedback(state, '打开了', 20)
  state = applyCheck(state, shotCheck(21), 21)
  state = applyVerify(state, { verdict: '通过', reason: '截图里有材质面板' }, 22)
  assert.equal(state.phase, 'NEXT_STEP')
  assert.equal(state.checks.at(-1).shot.window, 'Blender')
})

test('v0.4.3 判定：最近一次截图失败 → 不允许判通过（不能拿旧图顶替）', () => {
  let state = screenPlan()
  state = applyUserFeedback(state, '打开了', 20)
  state = applyCheck(state, shotCheck(21), 21)
  state = applyCheck(state, {
    kind: 'screenshot', target: 'blender', ok: false, detail: '窗口最小化，抓不到画面',
  }, 23)
  assert.throws(
    () => applyVerify(state, { verdict: '通过', reason: '前一张看着像' }, 24),
    (error) => {
      assert.equal(error.code, 'COACH_VERIFY_SCREEN_FAILED')
      return true
    },
  )
})

test('v0.4.3 漏洞修复：自截的截图不能冒充用户工质', () => {
  const state = applyPlan(initialState(), {
    toolName: 'Blender',
    toolAvailable: true,
    userLevel: '会基础',
    originalGoal: '看面板',
    goalMode: 'learn',
    difficulty: '低',
    plan: [{
      section: '基础',
      steps: [{
        goal: '打开面板',
        action: '点一下',
        expected: '面板出现',
        standard: '面板在',
        evidence: 'user_artifact',
      }],
    }],
  }, 10)
  let next = applyCheck(state, shotCheck(11), 11)
  assert.throws(
    () => applyVerify(next, {
      verdict: '通过',
      evidenceRef: 'C:\\work\\.coach\\shots\\shot-1.png',
      reason: '截图里有',
    }, 12),
    (error) => {
      assert.equal(error.code, 'COACH_VERIFY_SELF_EVIDENCE')
      return true
    },
  )
  // 用户自己发的截图照常受理。
  next = applyVerify(next, { verdict: '通过', evidenceRef: '用户截图 2026-11-06.png', reason: '面板在' }, 13)
  assert.equal(next.phase, 'NEXT_STEP')
})

test('v0.4.3 折叠：presentationMeta 里的 shot 会进状态，重启后能重算', () => {
  let state = screenPlan()
  state = applyUserFeedback(state, '打开了', 20)
  state = applyToolCall(state, {
    id: 'c1',
    name: 'coach_check',
    args: { kind: 'screenshot', target: 'blender' },
    meta: {
      coachTool: 'coach_check',
      stepKey: '0:0',
      kind: 'screenshot',
      target: 'blender',
      ok: true,
      detail: '已截图 800×600',
      shot: shotCheck(21).shot,
    },
    at: 21,
  })
  const recorded = state.checks.at(-1)
  assert.equal(recorded.kind, 'screenshot')
  assert.equal(recorded.shot.id, 'att-shot-1')
  assert.equal(recorded.shot.pid, 4242)
})

test('v0.4.3 渲染：这一步给出【截图取证】和已存证摘要', () => {
  let state = screenPlan()
  state = applyUserFeedback(state, '打开了', 20)
  state = applyCheck(state, shotCheck(21), 21)
  const block = renderStateBlock(state, { screenshotEnabled: true, screenshotMaxPerStep: 2 })
  assert.match(block, /【截图取证】/)
  assert.match(block, /coach_check\(kind="screenshot", target="blender"\)/)
  assert.match(block, /截图「Blender」 800×600 → 已存证/)
  assert.doesNotMatch(block, /【可跑命令】/)
})

test('v0.4.3 渲染：计划建立前提示【可截图】怎么用', () => {
  const block = renderStateBlock(initialState(), { screenshotEnabled: true, screenshotMaxPerStep: 2 })
  assert.match(block, /【可截图】/)
  assert.match(block, /同一步最多 2 张/)
})

test('v0.4.3 渲染：没开截图时不显示【可截图】（避免模型去试被拒的功能）', () => {
  const block = renderStateBlock(screenPlan(), {})
  assert.doesNotMatch(block, /【可截图】/)
})

test('v0.4.3 配置：截图默认关闭，只有显式 true 才开；非法值回落', () => {
  const defaults = resolveCoachConfig({})
  assert.equal(defaults.screenshotEnabled, false)
  assert.equal(defaults.screenshotMaxPerStep, 2)
  assert.equal(defaults.screenshotMaxWidth, 1600)
  assert.equal(defaults.screenshotMaxHeight, 1000)

  assert.equal(resolveCoachConfig({ screenshotEnabled: 'true' }).screenshotEnabled, false)
  assert.equal(resolveCoachConfig({ screenshotEnabled: true }).screenshotEnabled, true)
  assert.equal(resolveCoachConfig({ screenshotMaxPerStep: 0 }).screenshotMaxPerStep, 2)
  assert.equal(defaults.screenshotKeepFiles, true)
  assert.equal(defaults.screenshotMaxBytes, 8388608)
  assert.deepEqual(defaults.screenshotBlockTitles, ['deepseek harness'])
  assert.deepEqual(
    resolveCoachConfig({ screenshotBlockProcesses: ['DeepSeek Harness'] }).screenshotBlockProcesses,
    ['deepseek harness'],
  )
})

test('v0.4.3 normalizeShot：缺 id 的一律丢弃，尺寸只收正整数', () => {
  assert.equal(normalizeShot(null), null)
  assert.equal(normalizeShot({ path: 'x.png' }), null)
  assert.deepEqual(normalizeShot({ id: 'att-1', width: -3, height: 'x', pid: 0 }), {
    id: 'att-1',
    path: '',
    width: 0,
    height: 0,
    window: '',
    process: '',
    pid: null,
  })
})
