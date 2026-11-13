/**
 * `coach_note` —— 把本次教练会话整理成一份 Markdown 学习记录（SPEC-档3）。
 *
 * 能力被刻意压窄：
 * - 只能写 `<工作区>/<notesDir>/`，路径由插件算，入参里没有路径字段；
 * - 只 `createIfAbsent`，永不覆盖；
 * - 必须先把会话的 `sandboxPolicy` 传给 `writeText`，只读会话直接拒绝；
 * - 写盘只在这个适配层发生；`core/note-state.js` 只记元数据，重放不会重复写。
 *
 * 图片：只收用户消息里的附件；插件自己截的图要 `includeCoachShots: true` 才纳入。
 * 宿主 `ctx.fs` 没有二进制写，所以图片以 data URI 内嵌进 Markdown。
 */

import path from 'node:path'

import { defineTool } from './define-tool.js'
import { CoachError } from '../core/machine.js'
import {
  NOTE_GENERATOR,
  normalizeNoteInput,
  renderNote,
  selectNoteImages,
} from '../core/note.js'
import {
  applyNote,
  assertNotePhase,
  assertNoteSaveable,
  findAlreadySaved,
} from '../core/note-state.js'

/** 文件名冲突时最多尝试几个后缀。 */
const MAX_NAME_ATTEMPTS = 10

const DESCRIPTION = [
  '把本次学习整理成一份 Markdown 记录（含进度、证据、踩坑与用户提供的截图）。',
  '两步走：先 mode="preview" 生成预览给用户看，用户确认后再 mode="save" 落盘；',
  '没有预览、或预览之后用户没说话，save 会被拒绝。',
  '只能写到工作区的 notesDir（默认 .coach/notes/），只创建不覆盖；路径由插件算。',
  '图片只内嵌用户消息里的附件；includeCoachShots=true 才会把插件自己截的成功截图也放进去。',
  '记录里的事实区（进度/跳过/回退）由插件计算，模型只能写复盘、概念、踩坑、下一步。',
].join('')

/** 会话工作目录。 */
function cwdOf(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd()
}

/** 会话 id 的短形式（写进 front matter）。 */
function sessionIdOf(exec) {
  const id = exec?.agent?.session?.header?.id
  return typeof id === 'string' && id !== '' ? id.slice(0, 8) : ''
}

/** notesDir 必须是相对路径、不能含 `..`。 */
function assertNotesDir(value) {
  const dir = typeof value === 'string' && value.trim() !== '' ? value.trim() : '.coach/notes'
  const normalized = dir.replace(/\\/g, '/')
  if (path.posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)) {
    throw new CoachError(`notesDir 必须是工作区内的相对路径，收到 ${JSON.stringify(dir)}。`, 'COACH_NOTE_PATH')
  }
  if (normalized.split('/').includes('..')) {
    throw new CoachError(`notesDir 不能包含 ".."，收到 ${JSON.stringify(dir)}。`, 'COACH_NOTE_PATH')
  }
  return normalized
}

/** 读一张附件；失败返回 `{ ok:false, reason }`。 */
async function readImage(attachments, item, exec, config) {
  try {
    const stored = await attachments.readImage(item.ref, exec?.signal)
    const data = stored?.data
    if (data === undefined || data === null || typeof data.length !== 'number' || data.length === 0) {
      return { ok: false, reason: '读取为空' }
    }
    if (data.length > config.noteImageMaxBytes) {
      return { ok: false, reason: `超过单张上限 ${config.noteImageMaxBytes} 字节` }
    }
    const mediaType = typeof stored?.ref?.mediaType === 'string' && stored.ref.mediaType.startsWith('image/')
      ? stored.ref.mediaType
      : (typeof item.ref?.mediaType === 'string' && item.ref.mediaType.startsWith('image/')
        ? item.ref.mediaType
        : 'image/png')
    return {
      ok: true,
      data,
      mediaType,
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

export function createNoteTool(deps) {
  const { config, projection, ctx } = deps

  return defineTool({
    name: 'coach_note',
    description: DESCRIPTION,
    parameters: {
      mode: {
        type: 'string',
        required: true,
        enum: ['preview', 'save'],
        description: 'preview = 只生成预览给用户看；save = 落盘（必须先 preview、且用户确认过）。',
      },
      title: {
        type: 'string',
        description: '记录标题，默认「<工具名> 学习记录」。preview 与 save 必须用同一个标题。',
      },
      summary: { type: 'string', description: '这次学会了什么（1–3 句，≤600 字符）。' },
      concepts: {
        type: 'array',
        description: '关键概念，最多 8 条。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true, description: '概念名（≤60 字符）。' },
            explanation: { type: 'string', required: true, description: '解释（≤600 字符）。' },
          },
        },
      },
      pitfalls: {
        type: 'array',
        description: '踩过的坑，最多 8 条。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            symptom: { type: 'string', required: true, description: '现象 / 报错（≤600 字符）。' },
            cause: { type: 'string', required: true, description: '原因（≤600 字符）。' },
            fix: { type: 'string', required: true, description: '怎么解决的（≤600 字符）。' },
          },
        },
      },
      nextSteps: {
        type: 'array',
        description: '下一步建议，最多 8 条，每条 ≤200 字符。',
        items: { type: 'string' },
      },
      includeCoachShots: {
        type: 'boolean',
        description: '是否把插件自己成功截的图也内嵌进记录（默认 false，只收用户附件）。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string', required: true },
          status: { type: 'string', required: true },
          title: { type: 'string', required: true },
          path: { type: 'string', required: true },
          markdown: { type: 'string' },
          bytes: { type: 'number', required: true },
          facts: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              total: { type: 'number', required: true },
              passed: { type: 'number', required: true },
              skipped: { type: 'number', required: true },
              remaining: { type: 'number', required: true },
              images: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  included: { type: 'number', required: true },
                  skipped: { type: 'number', required: true },
                },
              },
              redactions: { type: 'number', required: true },
            },
          },
        },
      },
      render: (_args, value) => {
        if (value.status === 'previewed') {
          return [{
            type: 'text',
            text: `预览已生成（**未保存**）：${value.title}\n\n${value.markdown ?? ''}\n\n`
              + '把这份预览给用户看，问「确认保存吗？」；用户明确同意后再调用 '
              + 'coach_note(mode:"save", title: 同一个标题)。不要声称已经保存。',
          }]
        }
        if (value.status === 'already-saved') {
          return [{
            type: 'text',
            text: `这份记录已经保存过：${value.path}（没有重复写）。\n`
              + '直接告诉用户文件位置即可，不要写第二个文件。',
          }]
        }
        return [{
          type: 'text',
          text: `已保存：${value.path}（${value.bytes} 字节，内嵌 ${value.facts.images.included} 张图，`
            + `跳过 ${value.facts.images.skipped} 张，脱敏 ${value.facts.redactions} 处）。\n`
            + '文件只创建不覆盖；回复用户时给出这个路径，并说明这是 Learn 记录而不是可交付成果。',
        }]
      },
      presentationMeta: (_args, value) => ({
        coachTool: 'coach_note',
        mode: value.mode,
        status: value.status,
        title: value.title,
        path: value.path,
        images: value.facts.images.included,
        bytes: value.bytes,
        redactions: value.facts.redactions,
      }),
    },
    execute: async (args, exec) => {
      const state = projection.stateForExec(exec)
      const payload = normalizeNoteInput(args, state)
      assertNotePhase(state)

      const selected = selectNoteImages(state, {
        maxImages: config.noteMaxImages,
        includeCoachShots: payload.includeCoachShots === true,
      })

      if (payload.mode === 'preview') {
        // 预览不读图片字节，只留占位——否则 base64 会把预览撑爆。
        const rendered = renderNote(state, payload, {
          now: new Date(),
          generator: NOTE_GENERATOR,
          sessionId: sessionIdOf(exec),
          preview: true,
          images: selected.map((item) => ({
            source: item.source,
            at: item.at,
            window: item.window,
            method: item.method,
            mediaType: item.ref?.mediaType ?? 'image/png',
          })),
          skippedImages: [],
        })
        const previewLimit = Number.isInteger(config.notePreviewMaxChars) && config.notePreviewMaxChars > 0
          ? config.notePreviewMaxChars
          : 16000
        const markdown = rendered.markdown.length <= previewLimit
          ? rendered.markdown
          : `${rendered.markdown.slice(0, previewLimit - 1)}…`
        return {
          mode: 'preview',
          status: 'previewed',
          title: payload.title,
          path: '',
          markdown,
          bytes: 0,
          facts: {
            total: rendered.stats.total,
            passed: rendered.stats.passed,
            skipped: rendered.stats.skipped,
            remaining: rendered.stats.remaining,
            images: { included: 0, skipped: 0 },
            redactions: rendered.stats.redactions,
          },
        }
      }

      const existing = findAlreadySaved(state, payload.title)
      if (existing !== undefined) {
        return {
          mode: 'save',
          status: 'already-saved',
          title: payload.title,
          path: existing.path ?? '',
          bytes: existing.bytes ?? 0,
          facts: {
            total: 0,
            passed: 0,
            skipped: 0,
            remaining: 0,
            images: { included: existing.images ?? 0, skipped: 0 },
            redactions: existing.redactions ?? 0,
          },
        }
      }

      assertNoteSaveable(state, payload.title, config)

      const fs = ctx.get('fs')
      const attachments = ctx.get('attachments')
      if (fs === undefined) {
        throw new CoachError('宿主的 fs 服务不可用，无法写记录。', 'COACH_NOTE_NO_FS')
      }
      if (selected.length > 0 && attachments === undefined) {
        throw new CoachError(
          '宿主没有挂载附件服务（ctx.attachments），无法把截图读进记录。'
            + '可以不加 includeCoachShots 重试，或把截图的文字描述写进复盘。',
          'COACH_NOTE_NO_ATTACH',
        )
      }

      const cwd = cwdOf(exec)
      const workspace = await fs.resolve(cwd)
      const notesDir = assertNotesDir(config.notesDir)
      const root = await fs.resolve(notesDir, { cwd })
      if (typeof fs.contains === 'function' && !fs.contains(workspace, root)) {
        throw new CoachError('notesDir 解析后不在工作区内，拒绝写入。', 'COACH_NOTE_PATH')
      }

      const policy = ctx.get('sandboxPolicy')?.resolve({ session: exec?.agent?.session })
      if (policy?.mode === 'read-only') {
        throw new CoachError(
          '当前会话是只读模式（sandboxPolicy.mode = read-only），不能写学习记录。'
            + '可以先在对话里给出 Markdown，由用户自己保存。',
          'COACH_NOTE_READONLY',
        )
      }

      // 读图：单张/总量上限，失败或超限都留占位符，不静默丢，也不让整份记录失败。
      const images = []
      const skippedImages = []
      let totalImageBytes = 0
      for (const item of selected) {
        if (totalImageBytes >= config.noteMaxTotalImageBytes) {
          skippedImages.push({ id: item.id, reason: '超过单次记录图片总量上限' })
          continue
        }
        if (attachments === undefined) {
          skippedImages.push({ id: item.id, reason: '宿主没有附件服务' })
          continue
        }
        const read = await readImage(attachments, item, exec, config)
        if (read.ok !== true) {
          skippedImages.push({ id: item.id, reason: read.reason })
          continue
        }
        if (totalImageBytes + read.data.length > config.noteMaxTotalImageBytes) {
          skippedImages.push({ id: item.id, reason: '超过单次记录图片总量上限' })
          continue
        }
        totalImageBytes += read.data.length
        images.push({
          source: item.source,
          at: item.at,
          window: item.window,
          method: item.method,
          mediaType: read.mediaType,
          dataBase64: Buffer.from(read.data).toString('base64'),
        })
      }

      const rendered = renderNote(state, payload, {
        now: new Date(),
        generator: NOTE_GENERATOR,
        sessionId: sessionIdOf(exec),
        preview: false,
        images,
        skippedImages,
      })
      const bytes = Buffer.byteLength(rendered.markdown, 'utf8')
      if (bytes > config.noteMaxBytes) {
        throw new CoachError(
          `记录有 ${bytes} 字节，超过 noteMaxBytes（${config.noteMaxBytes}）。`
            + '请减少图片或缩短解释区；不要静默截断事实。',
          'COACH_NOTE_TOO_LARGE',
        )
      }

      // 文件名冲突：createIfAbsent 会报 FS_NOT_OBSERVED；依次试 -2…-10，绝不覆盖。
      const baseName = rendered.filename
      const stem = baseName.replace(/\.md$/i, '')
      let written
      let lastError
      for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
        const name = attempt === 0 ? baseName : `${stem}-${attempt + 1}.md`
        const target = await fs.resolve(path.join(notesDir, name), { cwd })
        if (typeof fs.contains === 'function' && !fs.contains(root, target)) {
          throw new CoachError('记录路径解析后不在 notesDir 内，拒绝写入。', 'COACH_NOTE_PATH')
        }
        try {
          await fs.writeText(target, rendered.markdown, { kind: 'createIfAbsent' }, exec?.signal, policy)
          written = { name, target }
          break
        } catch (error) {
          lastError = error
          if (error?.code !== 'FS_NOT_OBSERVED') break
        }
      }
      if (written === undefined) {
        throw new CoachError(
          `写记录失败：${lastError instanceof Error ? lastError.message : String(lastError ?? '未知错误')}。`
            + '可以先在对话里给出 Markdown，由用户自己保存。',
          'COACH_NOTE_PATH',
        )
      }

      // 用我们构造的相对路径，而不是后端的 targetKey（远端后端不保证它是文件路径）。
      const relativePath = path.posix.join(notesDir, written.name)
      return {
        mode: 'save',
        status: 'saved',
        title: payload.title,
        path: relativePath,
        bytes,
        facts: {
          total: rendered.stats.total,
          passed: rendered.stats.passed,
          skipped: rendered.stats.skipped,
          remaining: rendered.stats.remaining,
          images: { included: images.length, skipped: skippedImages.length },
          redactions: rendered.stats.redactions,
        },
      }
    },
  })
}
