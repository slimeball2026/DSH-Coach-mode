/**
 * 检索核心：脱敏、来源归一化、缓存写入与失败降级（v0.3.0）。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { initialState } from '../core/machine.js'
import { applyPlan } from '../core/plan.js'
import { applyResearch, normalizeSources, redactQuery } from '../core/research.js'

/** 造一个带当前步骤的计划状态（evidence=none，避免 check 依赖）。 */
function planned() {
  return applyPlan(initialState(), {
    toolName: 'Git',
    toolAvailable: true,
    userLevel: '从未用过',
    originalGoal: '学会提交代码',
    currentGoal: '学会提交代码',
    goalMode: 'learn',
    difficulty: '低',
    plan: [{
      section: '基础',
      steps: [{
        goal: '建立仓库',
        action: '执行 git init',
        expected: '出现 .git',
        standard: '目标目录下存在 .git',
        evidence: 'none',
        check: null,
        skipped: false,
        skipReason: null,
        failedAttempts: 0,
      }],
    }],
  }, 10)
}

test('脱敏：Windows / UNC / POSIX 路径、附件 id、邮箱', () => {
  const { query, redacted } = redactQuery(
    '看看 C:\\Users\\me\\secret.txt、\\\\server\\share\\x、/home/me/a.txt、'
      + 'a@b.com 和 0123456789abcdef0123456789abcdef',
  )
  assert.equal(redacted, true)
  assert.ok(!query.includes('C:\\Users'))
  assert.ok(!query.includes('a@b.com'))
  assert.ok(!query.includes('0123456789abcdef'))
  assert.ok(query.includes('<path>'))
  assert.ok(query.includes('<email>'))
  assert.ok(query.includes('<attachment>'))

  const posix = redactQuery('看看、/home/me/a.txt')
  assert.equal(posix.redacted, true)
  assert.ok(!posix.query.includes('/home/me/a.txt'))
})

test('脱敏：普通查询与 URL 不被误伤', () => {
  const plain = redactQuery('git --version')
  assert.equal(plain.query, 'git --version')
  assert.equal(plain.redacted, false)

  const url = redactQuery('https://git-scm.com/docs')
  assert.equal(url.query, 'https://git-scm.com/docs')
  assert.equal(url.redacted, false)
})

test('来源归一化：丢弃畸形项、保留合法字段、最多 8 条', () => {
  const sources = normalizeSources([
    { url: 'https://a.example', title: 'A', snippet: 'a' },
    { title: '没有 url' },
    { url: '' },
    ...Array.from({ length: 10 }, (_value, index) => ({ url: `https://b${index}.example` })),
  ])
  assert.equal(sources.length, 8)
  assert.deepEqual(sources[0], { url: 'https://a.example', title: 'A', snippet: 'a' })
})

test('检索成功：进入 RESEARCH 过渡态、写缓存、回到原阶段', () => {
  const state = applyResearch(initialState(), {
    query: 'git 版本',
    redacted: false,
    ok: true,
    sources: [{ url: 'https://git-scm.com', title: 'Git' }],
    truncated: false,
  }, 5)
  assert.equal(state.phase, 'INIT', 'RESEARCH 是过渡态，不应停留')
  assert.equal(state.research.length, 1)
  assert.equal(state.research[0].ok, true)
  assert.equal(state.research[0].sources[0].url, 'https://git-scm.com')
  assert.equal(state.research[0].at, 5)
})

test('检索失败且有当前步骤：保持原阶段，只留失败记录（v0.3.1）', () => {
  const state = applyResearch(planned(), {
    query: 'git 报错',
    ok: false,
    sources: [],
    error: '网络超时',
  }, 11)
  assert.equal(state.phase, 'WAIT_FEEDBACK', '检索失败不应旁路降级当前步骤')
  assert.equal(state.research.length, 1)
  assert.equal(state.research[0].ok, false)
  assert.equal(state.research[0].error, '网络超时')
})

test('检索失败且没有当前步骤：保持原阶段，只留失败记录', () => {
  const state = applyResearch(initialState(), {
    query: 'git 报错',
    ok: false,
    sources: [],
  }, 5)
  assert.equal(state.phase, 'INIT')
  assert.equal(state.research[0].ok, false)
  assert.match(state.research[0].error, /没有查到可靠来源/)
})

test('空 query 与非法阶段被拒', () => {
  assert.throws(() => applyResearch(initialState(), { query: '   ' }, 5), (error) => {
    assert.equal(error.code, 'COACH_RESEARCH_QUERY')
    return true
  })
  assert.throws(() => applyResearch({ ...initialState(), phase: 'COMPLETE' }, { query: 'x' }, 5), (error) => {
    assert.equal(error.code, 'COACH_PHASE')
    return true
  })
})
