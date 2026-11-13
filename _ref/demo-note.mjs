#!/usr/bin/env node
/**
 * `coach_note` 的端到端模拟（不接宿主）：造一段教练会话 → preview → 用户确认 → save，
 * 在 `_ref/demo-output/` 下真的写出一份带两张内嵌图片的 Markdown，并复制一份到
 * `_ref/coach-note-demo.md` 方便查看。
 *
 * 用法（仓库任意目录）：node _ref/demo-note.mjs
 */

import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BUNDLE = path.join(HERE, '..', 'coach-mode-bundle')
const DEMO_DIR = path.join(HERE, 'demo-output')
const OUT = path.join(HERE, 'coach-note-demo.md')

const { initialState } = await import(path.join(BUNDLE, 'core/machine.js'))
const { applyPlan, normalizeSections } = await import(path.join(BUNDLE, 'core/plan.js'))
const { applyAdvance, applyCheck, applyVerify } = await import(path.join(BUNDLE, 'core/verify.js'))
const { applyUserFeedback } = await import(path.join(BUNDLE, 'core/skip.js'))
const { applyNote } = await import(path.join(BUNDLE, 'core/note-state.js'))
const { resolveCoachConfig } = await import(path.join(BUNDLE, 'config.js'))
const { createNoteTool } = await import(path.join(BUNDLE, 'tools/coach-note.js'))

const TITLE = 'Git 入门 · 学习记录'
const userPng = readFileSync(path.join(HERE, 'demo-assets', 'user.png'))
const coachPng = readFileSync(path.join(HERE, 'demo-assets', 'coach.png'))

/** 真实落盘的 fs 适配（只实现 coach_note 用到的三个方法）。 */
function demoFs(root) {
  return {
    async resolve(target, opts = {}) {
      const base = opts.cwd ?? root
      const absolute = path.isAbsolute(target) ? target : path.join(base, target)
      return { targetKey: path.normalize(absolute), displayPath: target }
    },
    contains(parent, child) {
      return child.targetKey === parent.targetKey
        || child.targetKey.startsWith(`${parent.targetKey}${path.sep}`)
    },
    async writeText(target, content, intent) {
      await mkdir(path.dirname(target.targetKey), { recursive: true })
      try {
        await writeFile(target.targetKey, content, {
          encoding: 'utf8',
          flag: intent?.kind === 'createIfAbsent' ? 'wx' : 'w',
        })
      } catch (error) {
        if (error.code === 'EEXIST') {
          throw Object.assign(new Error('file already exists'), { code: 'FS_NOT_OBSERVED' })
        }
        throw error
      }
    },
  }
}

/** 假附件服务：按 id 返回 demo 里的两张 PNG。 */
const attachments = {
  async readImage(ref) {
    const id = ref?.attachmentId
    if (id === 'att-user-1') return { ref, data: userPng }
    if (id === 'att-coach-1') return { ref, data: coachPng }
    throw new Error(`unknown attachment: ${id}`)
  },
}

// ── 1. 造一段会话：3 步，第 1 步通过、第 2 步失败一次、第 3 步还没开始 ─────────
const plan = normalizeSections([
  {
    section: '基础',
    steps: [
      {
        goal: '初始化仓库并提交第一版',
        action: 'git init && git add . && git commit',
        expected: 'git log 有一条提交',
        standard: 'git log 第一条是本次提交',
        evidence: 'user_artifact',
      },
      {
        goal: '修改 README 再提交',
        action: '编辑 README 后 commit',
        expected: '第二条提交出现',
        standard: 'git log 有两条记录',
        evidence: 'user_artifact',
      },
    ],
  },
  {
    section: '分支',
    steps: [{
      goal: '创建并切换 feature 分支',
      action: 'git switch -c feature',
      expected: '提示 Switched to a new branch',
      standard: 'git branch 显示 feature 且带 *',
      evidence: 'user_artifact',
    }],
  },
], { maxPlanSteps: 12 })

let state = applyPlan(initialState(), {
  toolName: 'Git',
  toolAvailable: true,
  userLevel: '会基础',
  originalGoal: '学会在本地完成提交与分支操作',
  currentGoal: '学会在本地完成提交与分支操作',
  goalMode: 'learn',
  difficulty: '低',
  plan,
}, 10)

// 用户发了一张提交成功的截图
state = applyUserFeedback(state, '截图我发你了，第一条提交已经出来了', 12, {
  hasMedia: true,
  artifacts: [{
    id: 'att-user-1',
    kind: 'image',
    at: 12,
    ref: {
      attachmentId: 'att-user-1',
      mediaType: 'image/png',
      bytes: userPng.length,
      width: 96,
      height: 64,
    },
  }],
})

// 第 1 步判通过并推进
state = applyVerify(state, { verdict: '通过', evidenceRef: 'att-user-1', reason: '截图里有提交记录' }, 13)
state = applyAdvance(state, 14)

// 第 2 步失败一次
state = applyVerify(state, { verdict: '不通过', evidenceRef: '', reason: '报错 pathspec 不匹配' }, 15)

// 插件自己截了一张 Git Bash 的图（模拟）
state = applyCheck(state, {
  kind: 'screenshot',
  target: 'git-bash',
  ok: true,
  detail: '窗口「Git Bash」已截图 96×64',
  shot: {
    id: 'att-coach-1',
    path: '',
    width: 96,
    height: 64,
    window: 'Git Bash',
    process: 'git-bash',
    pid: 4242,
    method: 'printwindow',
    mediaType: 'image/png',
    bytes: coachPng.length,
  },
}, 16)

const config = resolveCoachConfig({ screenshotEnabled: true })
await rm(path.join(DEMO_DIR, '.coach'), { recursive: true, force: true })
await mkdir(DEMO_DIR, { recursive: true })

const tool = createNoteTool({
  config,
  projection: { stateForExec: () => state },
  ctx: {
    get: (name) => {
      if (name === 'fs') return demoFs(DEMO_DIR)
      if (name === 'attachments') return attachments
      if (name === 'sandboxPolicy') return { resolve: () => ({ mode: 'workspace-write' }) }
      return undefined
    },
  },
})

const exec = {
  signal: undefined,
  agent: { session: { header: { cwd: DEMO_DIR, id: '3f2a9c1e-demo-0001' } } },
}

const payload = {
  title: TITLE,
  summary: '完成了第一次提交，正在处理 README 提交时报的 pathspec 错误。',
  concepts: [
    { name: '暂存区', explanation: '`git add` 把工作区改动放进暂存区，`git commit` 只提交暂存区里的内容。' },
    { name: '分支指针', explanation: '`HEAD` 指向当前分支；`git switch -c` 会新建分支并把 HEAD 移过去。' },
  ],
  pitfalls: [
    {
      symptom: '`error: pathspec \'README.md\' did not match any file(s) known to git`',
      cause: '文件名拼写不一致，或者 README 还没保存到磁盘。',
      fix: '先 `git status` 看真实文件名，再 `git add <正确路径>`。',
    },
  ],
  nextSteps: ['修好 README 的提交，再练习一次分支切换。'],
  includeCoachShots: true,
}

// ── 2. preview：不写盘 ──────────────────────────────────────────────────────
const preview = await tool.execute({ mode: 'preview', ...payload }, exec)
if (preview.status !== 'previewed') throw new Error(`preview failed: ${preview.status}`)
console.log(`preview ok: ${preview.facts.total} 步 / ${preview.markdown.length} 字符，未写盘`)

// 把 preview 记进状态（真实会话里这一步由日志折叠完成）
state = applyNote(state, { mode: 'preview', title: TITLE }, 20, config)

// ── 3. 用户确认后 save ─────────────────────────────────────────────────────
state = applyUserFeedback(state, '可以，保存吧', 21, {})

const saved = await tool.execute({ mode: 'save', ...payload }, exec)
if (saved.status !== 'saved') throw new Error(`save failed: ${saved.status}`)
console.log(`saved: ${saved.path}（${saved.bytes} 字节，图片 ${saved.facts.images.included} 张）`)

// ── 4. 校验产物并复制一份到固定路径 ────────────────────────────────────────
const writtenPath = path.join(DEMO_DIR, saved.path)
const markdown = await readFile(writtenPath, 'utf8')
const images = (markdown.match(/data:image\/png;base64,/g) ?? []).length
if (images !== 2) throw new Error(`expected 2 embedded images, got ${images}`)
if (!markdown.includes('## 5. 证据')) throw new Error('missing evidence section')

await copyFile(writtenPath, OUT)
const info = await stat(OUT)
console.log(`copied: ${OUT}（${info.size} 字节）`)
console.log('--- 产物结构 ---')
for (const line of markdown.split('\n')) {
  if (line.startsWith('#') || line.startsWith('| 1 ') || line.startsWith('### 图')) console.log(line)
}
