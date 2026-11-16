/**
 * `coach_check` 适配层的边界测试：读文件上限与回传长度。
 *
 * 这些是 v0.4.5 补的：宿主 `readText` 是全量读入，模型指到一个大文件就能
 * 把 host 进程内存打爆；以及 readFileMaxChars 被 600 字的通用预算砍半。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { initialState } from '../core/machine.js'
import { applyPlan, normalizeSections } from '../core/plan.js'
import { resolveCoachConfig } from '../config.js'
import { createCheckTool } from '../tools/coach-check.js'

/** 单步 file 计划；check.kind 用 read_file。 */
function filePlan() {
  const plan = normalizeSections([{
    section: '基础',
    steps: [{
      goal: '看配置',
      action: '打开配置',
      expected: '看到内容',
      standard: '配置里包含 remote',
      evidence: 'file',
      check: { kind: 'read_file', target: '/tmp/config.txt' },
    }],
  }], { maxPlanSteps: 12 })
  return applyPlan(initialState(), {
    toolName: 'Git',
    toolAvailable: true,
    userLevel: '会基础',
    originalGoal: '看配置',
    currentGoal: '看配置',
    goalMode: 'learn',
    difficulty: '低',
    plan,
  }, 1)
}

/** 假 fs：只实现 coach_check 用到的四个方法。 */
function fakeFs({ size = 10, text = '' } = {}) {
  let reads = 0
  return {
    reads: () => reads,
    resolve: async (path) => ({ key: path }),
    stat: async () => ({ type: 'file', size }),
    readText: async () => { reads += 1; return text },
    listDir: async () => [],
  }
}

function makeTool(state, fs, extraConfig = {}) {
  return createCheckTool({
    config: resolveCoachConfig(extraConfig),
    projection: { stateForExec: () => state },
    ctx: { get: (name) => (name === 'fs' ? fs : undefined) },
  })
}

const EXEC = { signal: undefined, agent: { session: { header: { cwd: '/tmp' } } } }

test('v0.4.5 read_file：回传长度按 readFileMaxChars，不再被 600 字预算砍半', async () => {
  const state = filePlan()
  const text = `${'a'.repeat(20)}${'b'.repeat(80)}`
  const fs = fakeFs({ size: 100, text })
  const tool = makeTool(state, fs, { readFileMaxChars: 20 })

  const value = await tool.execute({ kind: 'read_file', target: '/tmp/config.txt' }, EXEC)
  assert.equal(value.ok, true)
  assert.ok(value.detail.includes('a'.repeat(20)), '20 个字符必须完整回传')
  assert.ok(!value.detail.includes('b'), '超过 readFileMaxChars 的部分不应回传')
})

test('v0.4.5 read_file：超过 readFileMaxBytes 时不读文件，直接失败', async () => {
  const state = filePlan()
  let reads = 0
  const fs = {
    resolve: async (path) => ({ key: path }),
    stat: async () => ({ type: 'file', size: 2 * 1024 * 1024 }),
    readText: async () => { reads += 1; return 'x' },
    listDir: async () => [],
  }
  const tool = makeTool(state, fs, { readFileMaxBytes: 1024 })

  const value = await tool.execute({ kind: 'read_file', target: '/tmp/config.txt' }, EXEC)
  assert.equal(value.ok, false)
  assert.match(value.detail, /超过 readFileMaxBytes/)
  assert.equal(reads, 0, '超限时不能真的 readText')
})

test('v0.4.5 read_file：上限内正常读取', async () => {
  const state = filePlan()
  const fs = fakeFs({ size: 10, text: 'hello' })
  const tool = makeTool(state, fs, { readFileMaxBytes: 1024 })
  const value = await tool.execute({ kind: 'read_file', target: '/tmp/config.txt' }, EXEC)
  assert.equal(value.ok, true)
  assert.match(value.detail, /hello/)
  assert.equal(fs.reads(), 1)
})
