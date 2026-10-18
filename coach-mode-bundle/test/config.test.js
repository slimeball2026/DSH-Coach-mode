/**
 * 配置归一化：Q5 B 的默认只读命令白名单。
 *
 * 本文件不碰宿主，只是纯函数；`--test-isolation=none` 下与其余测试同进程跑。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_ALLOW_COMMANDS, resolveCoachConfig } from '../config.js'

test('默认 allowCommands 是只读白名单，不是空数组', () => {
  const config = resolveCoachConfig({})
  assert.ok(config.allowCommands.includes('git --version'))
  assert.ok(config.allowCommands.includes('git status'))
  assert.ok(!config.allowCommands.includes('rm -rf /'))
  assert.equal(config.allowCommands.length, DEFAULT_ALLOW_COMMANDS.length)
})

test('默认白名单返回副本，调用方改它不会污染下一次', () => {
  const first = resolveCoachConfig({})
  first.allowCommands.push('git push')
  const second = resolveCoachConfig({})
  assert.ok(!second.allowCommands.includes('git push'))
})

test('显式 allowCommands: [] 仍然可以关闭命令核查', () => {
  assert.deepEqual(resolveCoachConfig({ allowCommands: [] }).allowCommands, [])
})

test('allowCommands 不是数组时回落默认白名单', () => {
  const config = resolveCoachConfig({ allowCommands: 'git status' })
  assert.ok(config.allowCommands.includes('git --version'))
})
