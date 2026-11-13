/**
 * 守卫的回归测试：教练模式里 `write` / `edit` / `apply_patch` 必须确定性拒绝。
 *
 * 为什么单独一个文件：v0.4.5 之前只有 `smoke-coach.mjs` 顺手测了 write，
 * 单测里没有覆盖——而这是"不代做"唯一的物理保障。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { GUARDED_TOOLS, coachGuard, createCoachGuard, textNotePathOf } from '../guard.js'

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

test('v0.5 守卫：read 完整记录被拒，并指向文字版；文字版放行', () => {
  const guard = createCoachGuard({ notesDir: '.coach/notes' })
  const agent = { session: { header: { cwd: '/work' } } }
  const deny = guard({
    name: 'read',
    arguments: { file_path: '.coach/notes/2026-11-13-2141-git.md' },
    agent,
  })
  assert.equal(typeof deny, 'string')
  assert.match(deny, /2026-11-13-2141-git-text\.md/)
  assert.match(deny, /base64/)
  assert.match(deny, /不要/)

  // 文字版放行
  assert.equal(guard({
    name: 'read',
    arguments: { file_path: '.coach/notes/2026-11-13-2141-git-text.md' },
    agent,
  }), undefined)

  // 记录目录之外放行
  assert.equal(guard({ name: 'read', arguments: { file_path: 'src/main.js' }, agent }), undefined)
  // 绝对路径同样拦
  assert.ok(typeof guard({
    name: 'read',
    arguments: { file_path: '/work/.coach/notes/a.md' },
    agent,
  }) === 'string')
})

test('v0.5 守卫：notesDir 可配置', () => {
  const guard = createCoachGuard({ notesDir: 'docs/notes' })
  const agent = { session: { header: { cwd: '/work' } } }
  assert.ok(typeof guard({ name: 'read', arguments: { file_path: 'docs/notes/a.md' }, agent }) === 'string')
  assert.equal(guard({ name: 'read', arguments: { file_path: '.coach/notes/a.md' }, agent }), undefined)
})

test('v0.5 守卫：textNotePathOf 保留后缀', () => {
  assert.match(textNotePathOf('/work/.coach/notes/foo.md'), /foo-text\.md$/)
  assert.match(textNotePathOf('/work/.coach/notes/foo-2.md'), /foo-2-text\.md$/)
})
