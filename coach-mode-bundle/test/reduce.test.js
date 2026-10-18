/**
 * 折叠：从会话事件推导状态、幂等性、`stateVersion` 保护、失败结果不推进状态。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { STATE_VERSION, hasPassedOrSkipped, initialState } from '../core/machine.js'
import {
  applyToolCall,
  callsFromEvents,
  foldCalls,
  foldEvents,
  isCompatible,
} from '../core/reduce.js'

/** 造一个 tool/call 事件。 */
function call(seq, callId, name, args) {
  return {
    type: 'tool/call',
    seq,
    data: { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) },
  }
}

/** 造一个成功的 tool/result 事件。 */
function result(seq, callId, meta, overrides = {}) {
  return {
    type: 'tool/result',
    seq,
    data: {
      turn: 1,
      step: 1,
      message: { role: 'tool', toolCallId: callId, source: { kind: 'tool', callId }, content: [] },
      ...(meta === undefined ? {} : { meta }),
      ...overrides,
    },
  }
}

const PLAN_ARGS = {
  toolName: 'Git',
  toolAvailable: 'yes',
  userLevel: '从未用过',
  originalGoal: '学会提交代码',
  currentGoal: '学会提交代码',
  difficulty: '低',
  sections: [{
    section: '基础',
    steps: [{
      goal: '建立仓库',
      action: '执行 git init',
      expected: '出现 .git',
      standard: '目标目录下存在 .git',
      evidence: 'file',
      check: { kind: 'path_exists', target: 'C:/work/.git' },
    }],
  }],
}

const CONFIG = { maxPlanSteps: 12 }

test('callsFromEvents：只收成功的教练工具调用，按顺序', () => {
  const events = [
    call(0, 'c1', 'coach_plan', PLAN_ARGS),
    result(1, 'c1'),
    call(2, 'c2', 'coach_check', { kind: 'path_exists', target: 'C:/work/.git' }),
    result(3, 'c2', { coachTool: 'coach_check', stepKey: '0:0', kind: 'path_exists', target: 'C:/work/.git', ok: true, detail: '存在' }),
    call(4, 'c3', 'read', { file_path: 'x' }),
    result(5, 'c3'),
  ]
  const calls = callsFromEvents(events)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map((entry) => entry.name), ['coach_plan', 'coach_check'])
  assert.equal(calls[0].at, 1)
  assert.equal(calls[1].at, 3)
  assert.equal(calls[1].meta.ok, true)
})

test('callsFromEvents：失败的结果不推进状态（R4）', () => {
  const withError = {
    type: 'tool/result',
    seq: 3,
    data: {
      turn: 1,
      step: 1,
      message: { role: 'tool', toolCallId: 'c2', source: { kind: 'tool', callId: 'c2' }, content: [], isError: true },
      error: { name: 'CoachError', code: 'COACH_VERIFY_NO_CHECK' },
    },
  }
  const events = [
    call(0, 'c1', 'coach_plan', PLAN_ARGS),
    result(1, 'c1'),
    call(2, 'c2', 'coach_verify', { verdict: '通过' }),
    withError,
  ]
  const calls = callsFromEvents(events)
  assert.deepEqual(calls.map((entry) => entry.name), ['coach_plan'])
})

test('foldEvents：一串调用折叠出预期状态', () => {
  const events = [
    call(0, 'c1', 'coach_plan', PLAN_ARGS),
    result(1, 'c1'),
    call(2, 'c2', 'coach_check', { kind: 'path_exists', target: 'C:/work/.git' }),
    result(3, 'c2', { stepKey: '0:0', kind: 'path_exists', target: 'C:/work/.git', ok: true, detail: '存在' }),
    call(4, 'c3', 'coach_verify', { verdict: '通过', evidenceRef: 'C:/work/.git', reason: '存在 .git' }),
    result(5, 'c3', { verdict: '通过', evidenceRef: 'C:/work/.git', reason: '存在 .git' }),
    call(6, 'c4', 'coach_advance', {}),
    result(7, 'c4'),
  ]
  const state = foldEvents(null, events, CONFIG)
  assert.equal(state.phase, 'COMPLETE')
  assert.equal(state.toolName, 'Git')
  assert.equal(state.checks.length, 1)
  assert.equal(state.checks[0].ok, true)
  assert.equal(state.verifications.length, 1)
  assert.equal(state.verifications[0].verdict, '通过')
})

test('折叠是确定且幂等的：同样输入得到同样输出，不再追加调用则不改变状态', () => {
  const calls = [
    { id: 'c1', name: 'coach_plan', args: PLAN_ARGS, meta: null, at: 1 },
    { id: 'c2', name: 'coach_check', args: { kind: 'path_exists', target: 'C:/work/.git' }, meta: { kind: 'path_exists', target: 'C:/work/.git', ok: true, detail: '存在', stepKey: '0:0' }, at: 3 },
  ]
  const first = foldCalls(initialState(), calls, CONFIG)
  const second = foldCalls(initialState(), calls, CONFIG)
  assert.deepEqual(first, second)

  const again = foldCalls(first, [], CONFIG)
  assert.deepEqual(again, first)
})

test('stateVersion 不符时拒绝复用旧状态，从空状态重折', () => {
  const stale = { ...initialState(), stateVersion: 999, phase: 'COMPLETE' }
  assert.equal(isCompatible(stale), false)
  const state = foldEvents(stale, [], CONFIG)
  assert.equal(state.phase, 'INIT')
  assert.equal(state.stateVersion, STATE_VERSION)
})

test('coach_plan 优先用 meta 里的计划（历史计划不受后来 Config 变化影响）', () => {
  const metaPlan = [{
    section: '来自 meta',
    steps: [{
      goal: '一步', action: '做', expected: '结果', standard: '标准',
      evidence: 'user_artifact', check: null, skipped: false, skipReason: null, failedAttempts: 0,
    }],
  }]
  const state = applyToolCall(initialState(), {
    id: 'c1',
    name: 'coach_plan',
    args: {},
    meta: {
      toolName: 'Git',
      toolAvailable: true,
      userLevel: '会基础',
      originalGoal: '学会提交代码',
      currentGoal: '学会提交代码',
      goalMode: 'learn',
      difficulty: '低',
      plan: metaPlan,
    },
    at: 1,
  }, { maxPlanSteps: 1 })
  assert.equal(state.phase, 'WAIT_FEEDBACK')
  assert.equal(state.plan[0].section, '来自 meta')
})

test('coach_skip 的跳过原因来自 meta', () => {
  const events = [
    call(0, 'c1', 'coach_plan', PLAN_ARGS),
    result(1, 'c1'),
    call(2, 'c2', 'coach_skip', { reason: '' }),
    result(3, 'c2', { stepKey: '0:0', reason: '用户未说明' }),
  ]
  const state = foldEvents(null, events, CONFIG)
  assert.equal(state.phase, 'NEXT_STEP')
  assert.equal(state.skips.length, 1)
  assert.equal(state.skips[0].reason, '用户未说明')
})

test('coach_verify 判定为「不通过」时状态停在原步骤并累加失败次数', () => {
  const events = [
    call(0, 'c1', 'coach_plan', PLAN_ARGS),
    result(1, 'c1'),
    call(2, 'c2', 'coach_check', { kind: 'path_exists', target: 'C:/work/.git' }),
    result(3, 'c2', { kind: 'path_exists', target: 'C:/work/.git', ok: false, detail: '不存在', stepKey: '0:0' }),
    call(4, 'c3', 'coach_verify', { verdict: '不通过', reason: '没看到 .git' }),
    result(5, 'c3', { verdict: '不通过', reason: '没看到 .git', evidenceRef: '' }),
  ]
  const state = foldEvents(null, events, CONFIG)
  assert.equal(state.phase, 'WAIT_FEEDBACK')
  assert.equal(state.stepIndex, 0)
  assert.equal(state.plan[0].steps[0].failedAttempts, 1)
})

test('折叠 coach_research：成功写缓存并回到原阶段', () => {
  const events = [
    call(0, 'c1', 'coach_plan', PLAN_ARGS),
    result(1, 'c1'),
    call(2, 'c2', 'coach_research', { query: 'git 版本' }),
    result(3, 'c2', {
      coachTool: 'coach_research',
      query: 'git 版本',
      redacted: false,
      ok: true,
      sources: [{ url: 'https://git-scm.com', title: 'Git' }],
      truncated: false,
    }),
  ]
  const state = foldEvents(null, events, CONFIG)
  assert.equal(state.phase, 'WAIT_FEEDBACK')
  assert.equal(state.research.length, 1)
  assert.equal(state.research[0].sources[0].url, 'https://git-scm.com')
})

test('折叠 coach_research：失败且有当前步骤时保持原阶段（v0.3.1）', () => {
  const events = [
    call(0, 'c1', 'coach_plan', PLAN_ARGS),
    result(1, 'c1'),
    call(2, 'c2', 'coach_research', { query: 'git 报错' }),
    result(3, 'c2', {
      coachTool: 'coach_research',
      query: 'git 报错',
      redacted: false,
      ok: false,
      sources: [],
      error: '网络超时',
    }),
  ]
  const state = foldEvents(null, events, CONFIG)
  assert.equal(state.phase, 'WAIT_FEEDBACK')
  assert.equal(state.research.length, 1)
  assert.equal(state.research[0].error, '网络超时')
})

test('折叠 v0.3.3 早退：安装分支 → 学习分支（省略 originalGoal 也能从状态回落）', () => {
  const installArgs = {
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
  const exitArgs = {
    toolName: 'Photoshop',
    toolAvailable: 'yes',
    goalMode: 'learn',
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
  }
  const events = [
    call(0, 'c1', 'coach_plan', installArgs),
    result(1, 'c1'),
    call(2, 'c2', 'coach_plan', exitArgs),
    result(3, 'c2'),
  ]
  const state = foldEvents(null, events, CONFIG)
  assert.equal(state.phase, 'WAIT_FEEDBACK')
  assert.equal(state.goalMode, 'learn')
  assert.equal(state.originalGoal, '学会抠图')
  assert.equal(state.currentGoal, '学会抠图')
  assert.equal(state.plan[0].section, '选区基础')
  assert.equal(state.planAcceptedAt, 3)
})

test('折叠 v0.3.4 回退：只追加 backs，回退前的「通过」不再算数', () => {
  const twoStepArgs = {
    toolName: 'Git',
    toolAvailable: 'yes',
    userLevel: '从未用过',
    originalGoal: '学会提交代码',
    difficulty: '低',
    sections: [{
      section: '基础',
      steps: [
        { goal: '建立仓库', action: 'git init', expected: '有 .git', standard: '存在 .git', evidence: 'user_artifact' },
        { goal: '暂存文件', action: 'git add', expected: '进入暂存区', standard: '状态里显示 staged', evidence: 'user_artifact' },
      ],
    }],
  }
  const events = [
    call(0, 'c1', 'coach_plan', twoStepArgs),
    result(1, 'c1'),
    call(2, 'c2', 'coach_verify', { verdict: '通过', evidenceRef: '截图1.png', reason: '完成' }),
    result(3, 'c2', { verdict: '通过', evidenceRef: '截图1.png', reason: '完成' }),
    call(4, 'c3', 'coach_advance', {}),
    result(5, 'c3'),
    call(6, 'c4', 'coach_back', { stepKey: '0:0', reason: '重做第一步' }),
    result(7, 'c4', { coachTool: 'coach_back', stepKey: '0:0', reason: '重做第一步' }),
  ]
  const state = foldEvents(null, events, CONFIG)
  assert.equal(state.phase, 'WAIT_FEEDBACK')
  assert.equal(state.stepIndex, 0)
  assert.equal(state.backs.length, 1)
  assert.equal(state.backs[0].stepKey, '0:0')
  assert.equal(state.backs[0].at, 7)
  // 历史仍保留，但不再计入最后一道闸。
  assert.equal(state.verifications.length, 1)
  assert.equal(hasPassedOrSkipped(state, '0:0'), false)
})

test('折叠 v0.4.0 暂停/恢复：PAUSED 可重折，resume 回到原阶段', () => {
  const planArgs = {
    toolName: 'Git',
    toolAvailable: 'yes',
    userLevel: '从未用过',
    originalGoal: '学会提交代码',
    difficulty: '低',
    sections: [{
      section: '基础',
      steps: [{
        goal: '建立仓库',
        action: 'git init',
        expected: '有 .git',
        standard: '存在 .git',
        evidence: 'user_artifact',
      }],
    }],
  }
  const events = [
    call(0, 'c1', 'coach_plan', planArgs),
    result(1, 'c1'),
    call(2, 'c2', 'coach_pause', { action: 'pause', note: '今天先到这' }),
    result(3, 'c2', { coachTool: 'coach_pause', action: 'pause', fromPhase: 'WAIT_FEEDBACK', stepKey: '0:0', note: '今天先到这' }),
  ]
  const paused = foldEvents(null, events, CONFIG)
  assert.equal(paused.phase, 'PAUSED')
  assert.equal(paused.pauses.length, 1)
  assert.equal(paused.pauses[0].fromPhase, 'WAIT_FEEDBACK')
  assert.equal(paused.pauses[0].note, '今天先到这')

  const resumed = foldEvents(null, [
    ...events,
    call(4, 'c3', 'coach_pause', { action: 'resume' }),
    result(5, 'c3', { coachTool: 'coach_pause', action: 'resume', fromPhase: '', stepKey: '0:0', note: '今天先到这' }),
  ], CONFIG)
  assert.equal(resumed.phase, 'WAIT_FEEDBACK')
  assert.equal(resumed.pauses[0].resumedAt, 5)
})
