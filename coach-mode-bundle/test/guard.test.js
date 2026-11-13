/**
 * 守卫的回归测试：教练模式里 `write` / `edit` / `apply_patch` 必须确定性拒绝。
 *
 * 为什么单独一个文件：v0.4.5 之前只有 `smoke-coach.mjs` 顺手测了 write，
 * 单测里没有覆盖——而这是"不代做"唯一的物理保障。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { GUARDED_TOOLS, coachGuard } from '../guard.js'

test('守卫：三个写入口都被拒，且拒绝理由包含工具名', () => {
  for (const name of ['write', 'edit', 'apply_patch']) {
    const reason = coachGuard({ name, arguments: {} })
    assert.equal(typeof reason, 'string', `${name} 必须被拒绝`)
    assert.ok(reason.includes(name), `拒绝理由要包含工具名：${reason}`)
    assert.ok(reason.includes('不代做'), '拒绝理由要说明这是「不代做」')
  }
})

test('守卫：只读 / 教练工具 / shell 不被这条守卫拦', () => {
  for (const name of ['read', 'read_image', 'coach_check', 'coach_plan', 'bash', 'pwsh']) {
    assert.equal(coachGuard({ name, arguments: {} }), undefined, `${name} 不应被守卫拦`)
  }
})

test('守卫：畸形 execution 不抛错（fail-open 但不崩）', () => {
  assert.equal(coachGuard(undefined), undefined)
  assert.equal(coachGuard({}), undefined)
  assert.equal(coachGuard({ name: 42 }), undefined)
})

test('守卫：apply_patch 在名单里（防 preset 变更后漏掉）', () => {
  assert.deepEqual([...GUARDED_TOOLS].sort(), ['apply_patch', 'edit', 'write'])
})
