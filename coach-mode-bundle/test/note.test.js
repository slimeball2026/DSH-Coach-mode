/**
 * `coach_note` 渲染核心的规则测试（SPEC-档3 §5/§6）。
 *
 * 重点：事实区由插件算、解释区只来自模型入参；图片只能是用户附件（或显式开启的
 * 教练截图）；预览不展开 base64；密钥要脱敏。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { initialState } from '../core/machine.js'
import { applyPlan, normalizeSections } from '../core/plan.js'
import {
  filenameFor,
  normalizeNoteInput,
  redactSecrets,
  renderNote,
  selectNoteImages,
  slugOf,
  stepStatus,
} from '../core/note.js'

/** 两步计划（user_artifact）。 */
function planned() {
  const plan = normalizeSections([
    {
      section: '基础',
      steps: [
        {
          goal: '初始化仓库',
          action: 'git init',
          expected: '出现 .git',
          standard: '有 .git 目录',
          evidence: 'user_artifact',
        },
        {
          goal: '第一次提交',
          action: 'git add + commit',
          expected: '提交成功',
          standard: 'git log 有一条记录',
          evidence: 'user_artifact',
        },
      ],
    },
    {
      section: '分支',
      steps: [
        {
          goal: '创建分支',
          action: 'git switch -c',
          expected: '切到新分支',
          standard: 'git branch 有它',
          evidence: 'user_artifact',
        },
      ],
    },
  ], { maxPlanSteps: 12 })
  return applyPlan(initialState(), {
    toolName: 'Git',
    toolAvailable: true,
    userLevel: '会基础',
    originalGoal: '学会提交代码',
    currentGoal: '学会提交代码',
    goalMode: 'learn',
    difficulty: '低',
    plan,
  }, 10)
}

const NOW = new Date(2026, 10, 13, 21, 41) // 本地时间 2026-11-13 21:41

const PAYLOAD = {
  mode: 'save',
  title: 'Git 入门 · 学习记录',
  summary: '学会了本地提交与分支。',
  concepts: [{ name: '暂存区', explanation: 'git add 把改动放进暂存区。' }],
  pitfalls: [{
    symptom: 'error: pathspec did not match',
    cause: '文件名写错',
    fix: '先 git status 看真实路径',
  }],
  nextSteps: ['练习合并冲突'],
  includeCoachShots: false,
}

test('v0.5 渲染：front matter、五段结构、状态表、结尾换行', () => {
  let state = planned()
  state = {
    ...state,
    verifications: [
      { stepKey: '0:0', verdict: '通过', at: 12 },
      { stepKey: '0:1', verdict: '通过', at: 15 },
    ],
    skips: [{ stepKey: '1:0', reason: '先跳过', at: 16, failedAttempts: 1 }],
    plan: state.plan.map((section, index) => (index === 1
      ? { ...section, steps: section.steps.map((step) => ({ ...step, failedAttempts: 1 })) }
      : section)),
    sectionIndex: 1,
    stepIndex: 0,
  }
  const { markdown, filename, stats } = renderNote(state, PAYLOAD, { now: NOW, sessionId: 'sess-1234' })

  assert.match(markdown, /^---\ntitle: "Git 入门 · 学习记录"/)
  assert.match(markdown, /session: "sess-1234"/)
  assert.match(markdown, /stateVersion: 12/)
  assert.match(markdown, /## 1\. 目标与结果/)
  assert.match(markdown, /## 2\. 学习路径/)
  assert.match(markdown, /## 3\. 关键概念/)
  assert.match(markdown, /## 4\. 踩过的坑/)
  assert.match(markdown, /## 5\. 证据/)
  assert.match(markdown, /\| 1 \| 基础 · 初始化仓库 \| 通过 \| 用户工质 \| 0 \|/)
  assert.match(markdown, /\| 3 \| 分支 · 创建分支 \| 跳过 \| 用户工质 \| 1 \|/)
  assert.equal(stats.total, 3)
  assert.equal(stats.passed, 2)
  assert.equal(stats.skipped, 1)
  assert.equal(filename, '2026-11-13-2141-git.md')
  assert.ok(markdown.endsWith('\n'))
})

test('v0.5 渲染：概念/踩坑为空时整段省略', () => {
  const state = planned()
  const payload = { ...PAYLOAD, concepts: [], pitfalls: [], nextSteps: [] }
  const { markdown } = renderNote(state, payload, { now: NOW })
  assert.doesNotMatch(markdown, /## 3\. 关键概念/)
  assert.doesNotMatch(markdown, /## 4\. 踩过的坑/)
})

test('v0.5 渲染：预览不展开 base64，只留占位', () => {
  const state = planned()
  const { markdown } = renderNote(state, PAYLOAD, {
    now: NOW,
    preview: true,
    images: [{ source: 'user', at: 15, mediaType: 'image/png' }],
  })
  assert.match(markdown, /保存时内嵌/)
  assert.doesNotMatch(markdown, /data:image/)
})

test('v0.5 渲染：保存时内嵌 data URI，并标注来源', () => {
  const state = planned()
  const { markdown, stats } = renderNote(state, PAYLOAD, {
    now: NOW,
    images: [
      { source: 'user', at: 15, mediaType: 'image/png', dataBase64: 'AAAA' },
      { source: 'coach', at: 19, mediaType: 'image/png', dataBase64: 'BBBB', window: 'Blender', method: 'printwindow' },
    ],
  })
  assert.match(markdown, /!\[用户截图 1\]\(data:image\/png;base64,AAAA\)/)
  assert.match(markdown, /图 2 · 教练截图（窗口「Blender」，printwindow）/)
  assert.equal(stats.images, 2)
})

test('v0.5 渲染：跳过/回退记录如实出现', () => {
  const state = {
    ...planned(),
    backs: [{ stepKey: '0:0', reason: '回头重做', at: 13 }],
    skips: [{ stepKey: '0:0', reason: '用户要求跳过', at: 14, failedAttempts: 3 }],
  }
  const { markdown } = renderNote(state, PAYLOAD, { now: NOW })
  assert.match(markdown, /## 跳过记录（事实）/)
  assert.match(markdown, /0:0：用户要求跳过（失败 3 次）/)
  assert.match(markdown, /## 回退记录（事实）/)
  assert.match(markdown, /回到 0:0：回头重做（seq 13）/)
})

test('v0.5 脱敏：解释区里的密钥被替换并计数，不影响图片段', () => {
  const state = planned()
  const payload = { ...PAYLOAD, summary: '报错里有 sk-abcdefghijklmnopqrstuvwxyz012345' }
  const { markdown, stats } = renderNote(state, payload, {
    now: NOW,
    images: [{ source: 'user', at: 15, mediaType: 'image/png', dataBase64: 'AAAA' }],
  })
  assert.doesNotMatch(markdown, /sk-abcdefghijklmnopqrstuvwxyz012345/)
  assert.match(markdown, /〔已脱敏〕/)
  assert.match(markdown, /redactions: 1/)
  assert.equal(stats.redactions, 1)
  // 图片数据不受脱敏影响（否则会坏图）
  assert.match(markdown, /base64,AAAA/)
})

test('v0.5 入参：字段上限、HTML/图片语法被拒', () => {
  assert.throws(() => normalizeNoteInput({ mode: 'save', summary: 'x'.repeat(601) }, planned()), /summary/)
  assert.throws(
    () => normalizeNoteInput({ mode: 'save', summary: '<script>alert(1)</script>' }, planned()),
    /script/,
  )
  assert.throws(
    () => normalizeNoteInput({ mode: 'save', summary: '看这个 ![x](http://e/x.png)' }, planned()),
    /图片语法/,
  )
  assert.throws(() => normalizeNoteInput({ mode: 'nope' }, planned()), /mode/)
  assert.throws(
    () => normalizeNoteInput({ mode: 'save', pitfalls: [{ symptom: 's', cause: 'c' }] }, planned()),
    /fix/,
  )
})

test('v0.5 入参：默认标题取工具名', () => {
  const payload = normalizeNoteInput({ mode: 'preview' }, planned())
  assert.equal(payload.title, 'Git 学习记录')
})

test('v0.5 图片选择：只取计划之后、用户优先、可补教练截图、按上限截断', () => {
  const state = {
    ...planned(),
    userArtifacts: [
      { id: 'att-early', at: 5, ref: { attachmentId: 'att-early' } },
      { id: 'att-1', at: 15, ref: { attachmentId: 'att-1' } },
      { id: 'att-2', at: 17, ref: { attachmentId: 'att-2' } },
    ],
    checks: [
      { kind: 'screenshot', ok: true, at: 18, shot: { id: 'shot-1', mediaType: 'image/png', bytes: 10 } },
      { kind: 'screenshot', ok: false, at: 19, shot: { id: 'shot-bad', mediaType: 'image/png', bytes: 10 } },
    ],
  }
  // 用户图片优先：上限 2 时只取用户的两张，教练截图被挤掉
  const userFirst = selectNoteImages(state, { maxImages: 2, includeCoachShots: true })
  assert.deepEqual(userFirst.map((item) => item.id), ['att-1', 'att-2'])

  // 上限 3 时补一张成功的教练截图；失败的截图不要
  const withCoach = selectNoteImages(state, { maxImages: 3, includeCoachShots: true })
  assert.deepEqual(withCoach.map((item) => item.id), ['att-1', 'att-2', 'shot-1'])

  const withoutCoach = selectNoteImages(state, { maxImages: 3, includeCoachShots: false })
  assert.deepEqual(withoutCoach.map((item) => item.id), ['att-1', 'att-2'])
})

test('v0.5 工具函数：slug、文件名、状态枚举、脱敏幂等', () => {
  assert.equal(slugOf('Git'), 'git')
  assert.equal(slugOf('Blender 4.2'), 'blender-4-2')
  assert.equal(slugOf('剪辑'), 'note')
  assert.equal(filenameFor(NOW, 'git'), '2026-11-13-2141-git.md')
  assert.equal(stepStatus(planned(), 0, 0), '未完成')
  assert.equal(stepStatus(planned(), 0, 1), '未开始')
  assert.deepEqual(redactSecrets('AKIAABCDEFGHIJKLMNOP'), { text: '〔已脱敏〕', count: 1 })
  assert.deepEqual(redactSecrets('没有密钥'), { text: '没有密钥', count: 0 })
})

test('v0.5 渲染：相同输入逐字节一致', () => {
  const state = planned()
  const first = renderNote(state, PAYLOAD, { now: NOW, sessionId: 's' }).markdown
  const second = renderNote(state, PAYLOAD, { now: NOW, sessionId: 's' }).markdown
  assert.equal(first, second)
})

test('v0.5 渲染：front matter 里的 Windows 路径正确转义', () => {
  const state = { ...planned(), originalGoal: 'C:\\work\\git' }
  const { markdown } = renderNote(state, PAYLOAD, { now: NOW })
  assert.ok(markdown.includes('goal: "C:\\\\work\\\\git"'), '反斜杠必须双写')
})
