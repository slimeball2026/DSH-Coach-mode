/**
 * 工具形状回归（v0.3.4 事故后补）：
 *
 * 宿主在写 `request/header` 时会对工具 schema 做**无损 JSON 快照**；
 * 对象里只要有一个 `undefined`（例如漏写 `description`），整轮请求就会失败：
 * `session event "request/header" carries non-JSON-serializable data`。
 *
 * 这里的断言刻意按宿主规则写：plain object、无 undefined/function、数字有限、数组无空槽。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveCoachConfig } from '../config.js'
import { createProjection } from '../projection.js'
import { createPlanTool } from '../tools/coach-plan.js'
import { createCheckTool } from '../tools/coach-check.js'
import { createVerifyTool } from '../tools/coach-verify.js'
import { createAdvanceTool } from '../tools/coach-advance.js'
import { createSkipTool } from '../tools/coach-skip.js'
import { createResearchTool } from '../tools/coach-research.js'
import { createBackTool } from '../tools/coach-back.js'
import { createPauseTool } from '../tools/coach-pause.js'

/** 八个工具的工厂（顺序与 index.js 一致）。 */
const FACTORIES = [
  ['coach_plan', createPlanTool],
  ['coach_check', createCheckTool],
  ['coach_verify', createVerifyTool],
  ['coach_advance', createAdvanceTool],
  ['coach_skip', createSkipTool],
  ['coach_research', createResearchTool],
  ['coach_back', createBackTool],
  ['coach_pause', createPauseTool],
]

/** 递归断言一个值能被宿主无损序列化。 */
function assertLossless(value, path, seen = new Set()) {
  if (value === null) return
  const type = typeof value
  if (type === 'string' || type === 'boolean') return
  if (type === 'number') {
    assert.ok(Number.isFinite(value), `${path} 不是有限数字：${value}`)
    return
  }
  assert.equal(type, 'object', `${path} 不是 JSON 值（${type}）`)
  assert.ok(!seen.has(value), `${path} 出现循环引用`)
  seen.add(value)

  if (Array.isArray(value)) {
    assert.equal(Object.getPrototypeOf(value), Array.prototype, `${path} 不是普通数组`)
    assert.equal(Reflect.ownKeys(value).length, value.length + 1, `${path} 有额外属性或空槽`)
    for (let index = 0; index < value.length; index += 1) {
      assert.ok(Object.hasOwn(value, index), `${path}[${index}] 是空槽`)
      assertLossless(value[index], `${path}[${index}]`, seen)
    }
  } else {
    assert.equal(Object.getPrototypeOf(value), Object.prototype, `${path} 不是 plain object`)
    for (const key of Object.keys(value)) {
      assertLossless(value[key], `${path}.${key}`, seen)
    }
  }
  seen.delete(value)
}

test('八个工具都有 name/description，且模型可见 schema 是无损 JSON（v0.3.4 回归）', () => {
  const config = resolveCoachConfig({})
  const projection = createProjection(config)
  const tools = FACTORIES.map(([, create]) => create({ config, projection, ctx: {} }))

  assert.equal(tools.length, 8)
  assert.deepEqual(tools.map((tool) => tool.name), FACTORIES.map(([name]) => name))

  for (const tool of tools) {
    assert.equal(typeof tool.name, 'string')
    assert.ok(tool.name.trim() !== '', '工具缺 name')
    assert.equal(typeof tool.description, 'string', `${tool.name} 缺 description（会让 request/header 失败）`)
    assert.ok(tool.description.trim() !== '', `${tool.name} 的 description 不能为空`)
    assert.equal(typeof tool.execute, 'function', `${tool.name} 缺 execute`)

    assertLossless(tool.parameters, `${tool.name}.parameters`)
    assertLossless(tool.output.schema, `${tool.name}.output.schema`)
    assert.equal(typeof tool.output.render, 'function', `${tool.name} 缺 output.render`)
  }
})
