/**
 * `coach_note` 的状态规则：预览门、用户确认门、回退失效、幂等、预算（SPEC-档3 §7）。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { initialState } from '../core/machine.js'
import { applyPlan, normalizeSections } from '../core/plan.js'
import { applyBack } from '../core/back.js'
import { applyPause } from '../core/pause.js'
import { applyUserFeedback } from '../core/skip.js'
import { applyToolCall } from '../core/reduce.js'
import {
  DEFAULT_NOTE_MAX_PER_SESSION,
  applyNote,
  assertNoteSaveable,
  findAlreadySaved,
} from '../core/note-state.js'

function planned() {
  const plan = normalizeSections([
    {
      section: '基础',
      steps: [
        { goal: '第一步', action: 'a', expected: 'e', standard: 's', evidence: 'user_artifact' },
        { goal: '第二步', action: 'a', expected: 'e', standard: 's', evidence: 'user_artifact' },
      ],
    },
  ], { maxPlanSteps: 12 })
  return applyPlan(initialState(), {
    toolName: 'Git',
    toolAvailable: true,
    userLevel: '会基础',
    originalGoal: '学会提交',
    currentGoal: '学会提交',
    goalMode: 'learn',
    difficulty: '低',
    plan,
  }, 10)
}

const TITLE = 'Git 学习记录'
const CONFIG = { noteMaxPerSession: 2 }

test('v0.5 note 状态：PAUSED 阶段拒绝', () => {
  const paused = applyPause(planned(), { action: 'pause' }, 20)
  assert.throws(
    () => applyNote(paused, { mode: 'preview', title: TITLE }, 21, CONFIG),
    (error) => error.code === 'COACH_NOTE_PHASE',
  )
})

test('v0.5 note 状态：preview 只记预览，不产生 saved', () => {
  const state = applyNote(planned(), { mode: 'preview', title: TITLE }, 20, CONFIG)
  assert.equal(state.notes.length, 1)
  assert.equal(state.notes[0].status, 'preview')
  assert.equal(state.notes[0].at, 20)
})

test('v0.5 note 状态：没有 preview 不能 save', () => {
  const state = planned()
  assert.throws(
    () => applyNote(state, { mode: 'save', title: TITLE, path: 'x.md' }, 20, CONFIG),
    (error) => error.code === 'COACH_NOTE_PREVIEW_REQUIRED',
  )
})

test('v0.5 note 状态：预览后没有用户消息不能 save（同回合也不行）', () => {
  let state = applyNote(planned(), { mode: 'preview', title: TITLE }, 20, CONFIG)
  assert.throws(
    () => assertNoteSaveable(state, TITLE, CONFIG),
    (error) => error.code === 'COACH_NOTE_PREVIEW_REQUIRED',
  )
  assert.throws(
    () => applyNote(state, { mode: 'save', title: TITLE, path: 'x.md' }, 21, CONFIG),
    (error) => error.code === 'COACH_NOTE_PREVIEW_REQUIRED',
  )
})

test('v0.5 note 状态：preview → 用户确认 → save 成功', () => {
  let state = applyNote(planned(), { mode: 'preview', title: TITLE }, 20, CONFIG)
  state = applyUserFeedback(state, '好，保存吧', 21, {})
  state = applyNote(state, {
    mode: 'save',
    title: TITLE,
    path: '.coach/notes/x.md',
    images: 2,
    bytes: 1234,
    redactions: 1,
  }, 22, CONFIG)
  const saved = state.notes.filter((note) => note.status === 'saved')
  assert.equal(saved.length, 1)
  assert.equal(saved[0].path, '.coach/notes/x.md')
  assert.equal(saved[0].images, 2)
  assert.equal(saved[0].bytes, 1234)
  assert.equal(saved[0].redactions, 1)
})

test('v0.5 note 状态：同标题重复保存（用户没再说话）→ 幂等', () => {
  let state = applyNote(planned(), { mode: 'preview', title: TITLE }, 20, CONFIG)
  state = applyUserFeedback(state, '好', 21, {})
  state = applyNote(state, { mode: 'save', title: TITLE, path: 'a.md' }, 22, CONFIG)

  const existing = findAlreadySaved(state, TITLE)
  assert.ok(existing !== undefined)
  assert.equal(existing.path, 'a.md')

  const again = applyNote(state, { mode: 'save', title: TITLE, status: 'already-saved', path: 'a.md' }, 23, CONFIG)
  assert.equal(again, state, 'already-saved 不应追加记录')
})

test('v0.5 note 状态：保存之后要再存一份，必须先重新 preview', () => {
  let state = applyNote(planned(), { mode: 'preview', title: TITLE }, 20, CONFIG)
  state = applyUserFeedback(state, '好', 21, {})
  state = applyNote(state, { mode: 'save', title: TITLE, path: 'a.md' }, 22, CONFIG)

  // 用户又说话了，但没重新预览
  state = applyUserFeedback(state, '再写一份吧', 23, {})
  assert.equal(findAlreadySaved(state, TITLE), undefined)
  assert.throws(
    () => assertNoteSaveable(state, TITLE, CONFIG),
    (error) => error.code === 'COACH_NOTE_PREVIEW_REQUIRED',
  )

  // 重新预览 → 用户再确认 → 可以再存
  state = applyNote(state, { mode: 'preview', title: TITLE }, 24, CONFIG)
  state = applyUserFeedback(state, '可以', 25, {})
  assert.doesNotThrow(() => assertNoteSaveable(state, TITLE, CONFIG))
})

test('v0.5 note 状态：回退会让之前的预览作废', () => {
  let state = planned()
  state = { ...state, stepIndex: 1 }
  state = applyNote(state, { mode: 'preview', title: TITLE }, 20, CONFIG)
  state = applyUserFeedback(state, '好', 21, {})
  state = applyBack(state, { stepKey: '0:0', reason: '重做' }, 22)
  assert.throws(
    () => assertNoteSaveable(state, TITLE, CONFIG),
    (error) => error.code === 'COACH_NOTE_PREVIEW_REQUIRED',
  )
})

test('v0.5 note 状态：保存次数上限', () => {
  const config = { noteMaxPerSession: 1 }
  let state = applyNote(planned(), { mode: 'preview', title: TITLE }, 20, config)
  state = applyUserFeedback(state, '好', 21, {})
  state = applyNote(state, { mode: 'save', title: TITLE, path: 'a.md' }, 22, config)

  state = applyUserFeedback(state, '再来一份', 23, {})
  state = applyNote(state, { mode: 'preview', title: TITLE }, 24, config)
  state = applyUserFeedback(state, '好', 25, {})
  assert.throws(
    () => assertNoteSaveable(state, TITLE, config),
    (error) => error.code === 'COACH_NOTE_BUDGET',
  )
})

test('v0.5 note 状态：默认上限是 5，标题为空报错', () => {
  assert.equal(DEFAULT_NOTE_MAX_PER_SESSION, 5)
  assert.throws(
    () => applyNote(planned(), { mode: 'preview', title: '   ' }, 20, CONFIG),
    (error) => error.code === 'COACH_NOTE_FIELD',
  )
})

test('v0.5 note 折叠：coach_note 的 meta 能写进 notes（重放不写文件）', () => {
  const viaTool = applyToolCall(planned(), {
    name: 'coach_note',
    args: { mode: 'preview', title: TITLE },
    meta: { mode: 'preview', status: 'previewed', title: TITLE },
    at: 20,
  }, CONFIG)
  assert.equal(viaTool.notes.length, 1)
  assert.equal(viaTool.notes[0].status, 'preview')
  assert.equal(viaTool.notes[0].at, 20)
})
