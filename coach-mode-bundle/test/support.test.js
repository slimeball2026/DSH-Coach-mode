/**
 * v0.4.1 脚手架递减：初始映射、整板块一次过降级、失败/跳过/回退升级、
 * 板块内只升不降、上下限，以及状态块里的【支撑等级】。
 *
 * 口径以 `core/support.js` 顶部注释为准（与 SPEC §13 对齐）。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { initialState } from '../core/machine.js'
import { applyPlan } from '../core/plan.js'
import { applyAdvance, applyVerify } from '../core/verify.js'
import { applySkip } from '../core/skip.js'
import { applyBack } from '../core/back.js'
import { renderStateBlock } from '../core/render.js'
import {
  DEFAULT_SUPPORT_LEVEL,
  initialSupportLevel,
  supportLevel,
  supportLine,
} from '../core/support.js'

/** 一步的合法形状。 */
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

/** 两板块 × 两步的计划。 */
function planned({ userLevel = '会基础', sectionNames = ['基础', '进阶'] } = {}) {
  return applyPlan(initialState(), {
    toolName: 'Git',
    toolAvailable: true,
    userLevel,
    originalGoal: '学会提交代码',
    currentGoal: '学会提交代码',
    goalMode: 'learn',
    difficulty: '低',
    plan: sectionNames.map((name, index) => ({
      section: name,
      steps: [stepOf(`${name}第一步`), stepOf(`${name}第二步`)].map((step, stepIndex) => ({
        ...step,
        goal: `${name}第${stepIndex + 1}步`,
        action: `做「${name}第${stepIndex + 1}步」`,
      })),
    })),
  }, 10)
}

/** 判通过并推进。 */
function pass(state, at) {
  const verified = applyVerify(state, { verdict: '通过', evidenceRef: `截图-${at}.png`, reason: '完成' }, at)
  return applyAdvance(verified)
}

/** 判不通过（失败次数 +1，停在本步）。 */
function fail(state, at) {
  return applyVerify(state, { verdict: '不通过', reason: '结果不符' }, at)
}

test('v0.4.1 初始映射：从未用过 3 / 会基础 2 / 熟练想进阶 1 / 未知 2', () => {
  assert.equal(initialSupportLevel('从未用过'), 3)
  assert.equal(initialSupportLevel('会基础'), 2)
  assert.equal(initialSupportLevel('熟练想进阶'), 1)
  assert.equal(initialSupportLevel(null), DEFAULT_SUPPORT_LEVEL)
  assert.equal(initialSupportLevel(undefined), DEFAULT_SUPPORT_LEVEL)
  assert.equal(initialSupportLevel('乱填的'), DEFAULT_SUPPORT_LEVEL)
})

test('v0.4.1 没有计划时也返回初始等级，不报错', () => {
  const support = supportLevel(initialState())
  assert.equal(support.level, DEFAULT_SUPPORT_LEVEL)
  assert.equal(support.name, '给要点')
  assert.equal(support.settled, 0)
})

test('v0.4.1 整板块一次过 → 降一级', () => {
  let state = planned({ userLevel: '会基础' })
  assert.equal(supportLevel(state).level, 2, '计划刚建立时还是初始等级')

  state = pass(state, 11) // 0:0
  state = pass(state, 12) // 0:1 → 进入第 2 个板块
  assert.equal(state.sectionIndex, 1)
  const support = supportLevel(state)
  assert.equal(support.level, 1, '上一板块 2 步一次过，降到 1（放手）')
  assert.equal(support.name, '放手')
  assert.equal(support.settled, 1)
})

test('v0.4.1 单步板块不降级（至少 2 步才降）', () => {
  let state = planned({ userLevel: '会基础', sectionNames: ['只有一步', '下一步'] })
  state.plan[0].steps = state.plan[0].steps.slice(0, 1)
  state = pass(state, 11)
  assert.equal(state.sectionIndex, 1)
  assert.equal(supportLevel(state).level, 2, '1 步的板块不足以证明熟练，不降')
})

test('v0.4.1 板块内有跳过 → 升一级', () => {
  let state = planned({ userLevel: '会基础' })
  state = pass(state, 11) // 0:0 通过
  state = applySkip(state, { reason: '先跳过' }, 12) // 0:1 跳过 → NEXT_STEP
  state = applyAdvance(state)
  assert.equal(state.sectionIndex, 1)
  assert.equal(supportLevel(state).level, 3, '有跳过不能算一次过，升到 3')
})

test('v0.4.1 板块内有回退 → 升一级，且不会把已挣到的降级抹掉', () => {
  let state = planned({ userLevel: '熟练想进阶' }) // 初始 1
  state = pass(state, 11)
  state = pass(state, 12) // 进入第 2 板块，level 本来保持 1
  assert.equal(supportLevel(state).level, 1)

  state = applyBack(state, { stepKey: '0:1', reason: '重做' }, 20)
  assert.equal(state.sectionIndex, 0)
  const support = supportLevel(state)
  assert.equal(support.level, 2, '回退是“重做”不是“失忆”：按板块结算 + 升一级，而不是回到初始 1')
  assert.match(support.reason, /回退/)
})

test('v0.4.1 当前步失败到 2 次 → 立即升一级（板块内只升不降）', () => {
  let state = planned({ userLevel: '会基础' })
  state = fail(state, 11)
  state = fail(state, 12)
  assert.equal(state.plan[0].steps[0].failedAttempts, 2)
  assert.equal(supportLevel(state).level, 3, '失败 2 次立即升到 3')

  state = pass(state, 13) // 补做通过，进入 0:1
  assert.equal(supportLevel(state).level, 2, '本板块还有失败记录，不会因此降级')
})

test('v0.4.1 上下限：新手不会超过 3，熟练者不会低于 1', () => {
  let novice = planned({ userLevel: '从未用过' })
  novice = applySkip(novice, { reason: '跳过' }, 11)
  novice = applyAdvance(novice)
  assert.equal(supportLevel(novice).level, 3, '下限 3 封顶')

  let skilled = planned({ userLevel: '熟练想进阶' })
  skilled = pass(skilled, 11)
  skilled = pass(skilled, 12)
  assert.equal(supportLevel(skilled).level, 1, '已经是 1，不再往下降')

  skilled = pass(skilled, 13)
  skilled = pass(skilled, 14)
  assert.equal(skilled.phase, 'COMPLETE')
  assert.equal(supportLevel(skilled).level, 1, '完成后仍是 1')
})

test('v0.4.1 依据描述结果：被上下限夹住时不谎报「降 1 / 升 1」（A14 回归）', () => {
  // 熟练（初始 1）整板块一次过：降级被下限夹住，等级没变。
  let skilled = planned({ userLevel: '熟练想进阶' })
  skilled = pass(skilled, 11)
  skilled = pass(skilled, 12)
  const demote = supportLevel(skilled)
  assert.equal(demote.level, 1, '已经在下限，等级不变')
  assert.match(demote.reason, /已在下限 1，不再降/)
  assert.doesNotMatch(demote.reason, /降 1/)

  // 新手（初始 3）整板块都跳过：升级被上限夹住，等级没变。
  let novice = planned({ userLevel: '从未用过' })
  novice = applySkip(novice, { reason: '跳过 1' }, 11)
  novice = applyAdvance(novice)
  novice = applySkip(novice, { reason: '跳过 2' }, 12)
  novice = applyAdvance(novice)
  const promote = supportLevel(novice)
  assert.equal(promote.level, 3, '已经在上限，等级不变')
  assert.match(promote.reason, /已在上限 3，不再升/)
  assert.doesNotMatch(promote.reason, /升 1/)
})

test('v0.4.1 状态块带【支撑等级】，且【合格标准】原文不变', () => {
  const state = planned({ userLevel: '会基础' })
  const block = renderStateBlock(state)
  assert.match(block, /【支撑等级】2（给要点）/)
  assert.match(block, /核查标准不变/)
  assert.match(block, /【合格标准】结果符合预期/, '等级只调讲多细，合格标准照原文给')

  const line = supportLine(state)
  assert.match(line, /^【支撑等级】2（给要点）：/)
  assert.match(line, /依据：初始「会基础」/)
})
