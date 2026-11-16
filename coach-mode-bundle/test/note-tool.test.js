/**
 * `coach_note` 适配层：预览不写盘、保存只创建、路径/权限/图片上限（SPEC-档3 §4/§5）。
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { initialState } from '../core/machine.js'
import { applyPlan, normalizeSections } from '../core/plan.js'
import { applyUserFeedback } from '../core/skip.js'
import { applyNote } from '../core/note-state.js'
import { resolveCoachConfig } from '../config.js'
import { createNoteTool } from '../tools/coach-note.js'

const CWD = '/work'
const TITLE = 'Git 学习记录'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const EXEC = { signal: undefined, agent: { session: { header: { cwd: CWD, id: 'sess-12345678' } } } }

function planned() {
  const plan = normalizeSections([{
    section: '基础',
    steps: [{
      goal: '初始化仓库',
      action: 'git init',
      expected: '出现 .git',
      standard: '有 .git',
      evidence: 'user_artifact',
    }],
  }], { maxPlanSteps: 12 })
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

/** 状态里带一张用户截图。 */
function withUserImage(state) {
  return applyUserFeedback(state, '截图我发你了', 12, {
    hasMedia: true,
    artifacts: [{
      id: 'att-1',
      kind: 'image',
      at: 12,
      ref: { attachmentId: 'att-1', mediaType: 'image/png', bytes: PNG.length, width: 1, height: 1 },
    }],
  })
}

/** 预览 + 用户确认后的状态。 */
function readyState(config = {}) {
  let state = withUserImage(planned())
  state = applyNote(state, { mode: 'preview', title: TITLE }, 20, config)
  state = applyUserFeedback(state, '好，保存吧', 21, {})
  return state
}

/** 假 fs：只实现 resolve/contains/writeText。 */
function fakeFs({ failFirstWrite = false, failTextWrite = false, textFailureCode = 'GENERIC' } = {}) {
  const writes = []
  const deletions = []
  const existing = new Set()
  let writesAttempted = 0
  let textWritesAttempted = 0
  return {
    writes,
    deletions,
    resolve: async (target, opts = {}) => {
      const base = opts.cwd ?? CWD
      const absolute = path.isAbsolute(target) ? target : path.join(base, target)
      return { targetKey: path.normalize(absolute), displayPath: target }
    },
    contains: (parent, child) => child.targetKey === parent.targetKey
      || child.targetKey.startsWith(`${parent.targetKey}${path.sep}`),
    writeText: async (target, content, intent, signal, policy) => {
      writesAttempted += 1
      if (failFirstWrite && writesAttempted === 1) {
        throw Object.assign(new Error('already exists'), { code: 'FS_NOT_OBSERVED' })
      }
      if (existing.has(target.targetKey)) {
        throw Object.assign(new Error('already exists'), { code: 'FS_NOT_OBSERVED' })
      }
      if (failTextWrite && target.targetKey.endsWith('-text.md') && textWritesAttempted === 0) {
        textWritesAttempted += 1
        const error = new Error('text write failed')
        if (textFailureCode === 'FS_NOT_OBSERVED') error.code = 'FS_NOT_OBSERVED'
        throw error
      }
      existing.add(target.targetKey)
      writes.push({ target: target.targetKey, content, intent, policy })
      return { operation: 'create' }
    },
    deleteFile: async (target) => {
      deletions.push(target.targetKey)
      existing.delete(target.targetKey)
    },
  }
}

function makeTool(state, options = {}) {
  const fs = options.fs ?? fakeFs()
  const reads = []
  const attachments = options.attachments ?? {
    readImage: async (ref) => {
      reads.push(ref)
      return { ref, data: PNG }
    },
  }
  const policy = options.policy ?? { resolve: () => ({ mode: 'workspace-write' }) }
  const config = resolveCoachConfig(options.config ?? {})
  const tool = createNoteTool({
    config,
    projection: { stateForExec: () => state },
    ctx: {
      get: (name) => {
        if (name === 'fs') return fs
        if (name === 'attachments') return attachments
        if (name === 'sandboxPolicy') return policy
        return undefined
      },
    },
  })
  return { tool, fs, reads, config }
}

test('v0.5 note 工具：preview 不写盘、不读图', async () => {
  const state = withUserImage(planned())
  const { tool, fs, reads } = makeTool(state)
  const value = await tool.execute({ mode: 'preview', title: TITLE }, EXEC)
  assert.equal(value.status, 'previewed')
  assert.equal(value.path, '')
  assert.equal(fs.writes.length, 0)
  assert.equal(reads.length, 0)
  assert.match(value.markdown, /## 2\. 学习路径/)
  assert.match(value.markdown, /保存时内嵌/)
  assert.doesNotMatch(value.markdown, /data:image/)
})

test('v0.5 note 工具：没有预览时 save 被拒，且不写盘', async () => {
  const { tool, fs } = makeTool(withUserImage(planned()))
  await assert.rejects(
    tool.execute({ mode: 'save', title: TITLE }, EXEC),
    (error) => error.code === 'COACH_NOTE_PREVIEW_REQUIRED',
  )
  assert.equal(fs.writes.length, 0)
})

test('v0.5 note 工具：preview → 用户确认 → save 写盘并内嵌用户截图', async () => {
  const state = readyState()
  const { tool, fs, reads } = makeTool(state)
  const value = await tool.execute({ mode: 'save', title: TITLE }, EXEC)
  assert.equal(value.status, 'saved')
  assert.ok(value.path.startsWith('.coach/notes/'))
  assert.ok(value.path.endsWith('.md'))
  assert.ok(value.textPath.endsWith('-text.md'))
  assert.equal(fs.writes.length, 2)
  const full = fs.writes.find((entry) => entry.target === path.join(CWD, value.path))
  const text = fs.writes.find((entry) => entry.target === path.join(CWD, value.textPath))
  assert.ok(full !== undefined && text !== undefined)
  assert.equal(full.intent.kind, 'createIfAbsent')
  assert.match(full.content, /!\[用户截图 1\]\(data:image\/png;base64,/)
  assert.match(full.content, /variant: "full"/)
  assert.match(full.content, /agentRead: "-text\.md"|agentRead: ".*-text\.md"/)
  assert.match(full.content, /不要用 `read` 读取/)
  assert.doesNotMatch(text.content, /data:image/)
  assert.match(text.content, /variant: "text"/)
  assert.match(text.content, /图片见完整版/)
  assert.match(text.content, /不要用 `read` 读取它/)
  assert.equal(value.facts.images.included, 1)
  assert.equal(reads.length, 1)
  // 事实区确实来自 state
  assert.match(full.content, /## 2\. 学习路径/)
})

test('v0.5 note 工具：只读会话直接拒绝', async () => {
  const { tool, fs } = makeTool(readyState(), {
    policy: { resolve: () => ({ mode: 'read-only' }) },
  })
  await assert.rejects(
    tool.execute({ mode: 'save', title: TITLE }, EXEC),
    (error) => error.code === 'COACH_NOTE_READONLY',
  )
  assert.equal(fs.writes.length, 0)
})

test('v0.5 note 工具：notesDir 越界被拒', async () => {
  const { tool, fs } = makeTool(readyState(), { config: { notesDir: '../escape' } })
  await assert.rejects(
    tool.execute({ mode: 'save', title: TITLE }, EXEC),
    (error) => error.code === 'COACH_NOTE_PATH',
  )
  assert.equal(fs.writes.length, 0)
})

test('v0.5 note 工具：文件名撞车时加后缀，绝不覆盖', async () => {
  const { tool, fs } = makeTool(readyState(), { fs: fakeFs({ failFirstWrite: true }) })
  const value = await tool.execute({ mode: 'save', title: TITLE }, EXEC)
  assert.equal(value.status, 'saved')
  assert.match(value.path, /-2\.md$/)
  assert.match(value.textPath, /-2-text\.md$/)
  assert.equal(fs.writes.length, 2)
})

test('v0.5 note 工具：文字版撞名（FS_NOT_OBSERVED）会回滚完整版并换后缀重试', async () => {
  const fs = fakeFs({ failTextWrite: true, textFailureCode: 'FS_NOT_OBSERVED' })
  const { tool } = makeTool(readyState(), { fs })
  const value = await tool.execute({ mode: 'save', title: TITLE }, EXEC)
  assert.equal(value.status, 'saved')
  assert.match(value.path, /-2\.md$/)
  assert.match(value.textPath, /-2-text\.md$/)
  assert.ok(fs.deletions.some((entry) => entry.endsWith('.md') && !entry.endsWith('-text.md')))
  // 第一次的完整版写下了又被回滚；最终留下的是 -2 的两个文件。
  assert.equal(fs.writes.length, 3)
  assert.ok(fs.writes.some((entry) => entry.target.endsWith('-2.md')))
  assert.ok(fs.writes.some((entry) => entry.target.endsWith('-2-text.md')))
})

test('v0.5 note 工具：文字版写失败（非撞名）会回滚完整版并报错，不留半份记录', async () => {
  const fs = fakeFs({ failTextWrite: true })
  const { tool } = makeTool(readyState(), { fs })
  await assert.rejects(
    tool.execute({ mode: 'save', title: TITLE }, EXEC),
    (error) => error.code === 'COACH_NOTE_PATH',
  )
  assert.ok(fs.deletions.some((entry) => entry.endsWith('.md') && !entry.endsWith('-text.md')))
  assert.equal(fs.writes.filter((entry) => entry.target.endsWith('-text.md')).length, 0)
})

test('v0.5 note 工具：includeCoachShots 才把教练截图放进去', async () => {
  let state = readyState()
  state = {
    ...state,
    checks: [{
      kind: 'screenshot',
      target: 'blender',
      ok: true,
      at: 14,
      shot: {
        id: 'shot-1',
        width: 10,
        height: 10,
        window: 'Blender',
        process: 'blender',
        pid: 42,
        method: 'printwindow',
        mediaType: 'image/png',
        bytes: PNG.length,
      },
    }],
  }

  const without = makeTool(state)
  const first = await without.tool.execute({ mode: 'save', title: TITLE }, EXEC)
  assert.equal(first.facts.images.included, 1, '默认只内嵌用户图')
  assert.doesNotMatch(without.fs.writes[0].content, /教练截图/)

  const withShots = makeTool(state)
  const second = await withShots.tool.execute({
    mode: 'save',
    title: TITLE,
    includeCoachShots: true,
  }, EXEC)
  assert.equal(second.facts.images.included, 2)
  assert.match(withShots.fs.writes[0].content, /教练截图/)
  assert.match(withShots.fs.writes[0].content, /printwindow/)
})

test('v0.5 note 工具：already-saved 幂等，不再写第二个文件', async () => {
  let state = readyState()
  state = applyNote(state, { mode: 'save', title: TITLE, path: 'a.md', bytes: 10 }, 22, {})
  const { tool, fs } = makeTool(state)
  const value = await tool.execute({ mode: 'save', title: TITLE }, EXEC)
  assert.equal(value.status, 'already-saved')
  assert.equal(value.path, 'a.md')
  assert.equal(fs.writes.length, 0)
})

test('v0.5 note 工具：preview 正文按 notePreviewMaxChars 截断', async () => {
  const { tool } = makeTool(withUserImage(planned()), { config: { notePreviewMaxChars: 120 } })
  const value = await tool.execute({ mode: 'preview', title: TITLE }, EXEC)
  assert.ok(value.markdown.length <= 120, `预览长度 ${value.markdown.length}`)
  assert.ok(value.markdown.endsWith('…'))
})
