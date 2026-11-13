/**
 * `coach_note` 的渲染核心：会话事实 + 模型解释 → 一份 Markdown 学习记录。
 *
 * 纯核心：无 IO、无时间、无随机。`now` 由适配层传入；图片字节由适配层读好、
 * 以 base64 传进来（宿主 `ctx.fs` 只有 `writeText`，没有二进制写，所以 data URI
 * 是 0.5.0 唯一能内嵌图片的方式）。
 *
 * 事实区（进度表、跳过、回退、检索）只从 `CoachState` 算，模型在入参里**没有**
 * 任何字段能改写它；解释区（复盘、概念、踩坑、下一步）才来自模型。
 */

import {
  CoachError,
  checksFor,
  currentStep,
  effectiveSinceBack,
  verificationsFor,
} from './machine.js'
import { progressStats } from './summary.js'

/** 生成器标识，写进 front matter。 */
export const NOTE_GENERATOR = 'coach-mode 0.5.0'

/** 各类文本上限（字符）。 */
export const NOTE_LIMITS = Object.freeze({
  title: 120,
  summary: 600,
  maxConcepts: 8,
  conceptName: 60,
  conceptExplanation: 600,
  maxPitfalls: 8,
  pitfallField: 600,
  maxNextSteps: 8,
  nextStep: 200,
})

/** 证据类型的中文名。 */
const EVIDENCE_TEXT = Object.freeze({
  file: '文件',
  command: '命令',
  screen: '截图',
  user_artifact: '用户工质',
  none: '无法核查',
})

/** 高置信度密钥模式；只替换，不让记录生成失败。 */
const REDACTION_PATTERNS = Object.freeze([
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
])

/** 截断。 */
function clip(value, budget) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length <= budget ? text : `${text.slice(0, budget - 1)}…`
}

/** Markdown 表格单元格：转义竖线、压掉换行。 */
function cell(value, budget = 80) {
  return clip(value, budget).replace(/\|/g, '\\|')
}

/** YAML 双引号字符串。 */
function yamlString(value) {
  const text = String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
  return `"${text}"`
}

/** 两段式文本：必须是非空字符串。 */
function requiredText(value, field, budget) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CoachError(`coach_note 的 ${field} 必须是非空字符串。`, 'COACH_NOTE_FIELD')
  }
  const text = value.trim()
  if (text.length > budget) {
    throw new CoachError(`coach_note 的 ${field} 超过 ${budget} 字符上限（当前 ${text.length}）。`, 'COACH_NOTE_FIELD')
  }
  assertSafeProse(text, field)
  return text
}

/** 可选文本；空串按未提供处理。 */
function optionalText(value, field, budget) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') {
    throw new CoachError(`coach_note 的 ${field} 必须是字符串。`, 'COACH_NOTE_FIELD')
  }
  if (value.trim() === '') return ''
  if (value.trim().length > budget) {
    throw new CoachError(`coach_note 的 ${field} 超过 ${budget} 字符上限（当前 ${value.trim().length}）。`, 'COACH_NOTE_FIELD')
  }
  assertSafeProse(value.trim(), field)
  return value.trim()
}

/** 解释区只允许普通 Markdown；禁止伪造 HTML / 图片证据。 */
function assertSafeProse(text, field) {
  if (/<(script|iframe|style)\b/i.test(text)) {
    throw new CoachError(`coach_note 的 ${field} 不允许出现 <script> / <iframe> / <style>。`, 'COACH_NOTE_FIELD')
  }
  if (/!\[[^\]]*\]\(/.test(text)) {
    throw new CoachError(`coach_note 的 ${field} 不允许写图片语法；截图只能来自用户消息。`, 'COACH_NOTE_FIELD')
  }
}

/** 数组字段：未提供 → []；非数组/超长 → 报错。 */
function arrayOf(value, field, max, mapItem) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new CoachError(`coach_note 的 ${field} 必须是数组。`, 'COACH_NOTE_FIELD')
  }
  if (value.length > max) {
    throw new CoachError(`coach_note 的 ${field} 最多 ${max} 项（当前 ${value.length}）。`, 'COACH_NOTE_FIELD')
  }
  return value.map((item, index) => mapItem(item, `${field}[${index}]`))
}

/**
 * 校验并归一化 `coach_note` 的模型入参。
 *
 * **这里没有任何能改写事实区的字段**：状态、进度、跳过、回退都只能从 state 算。
 * @param {object} raw 模型入参。
 * @param {object} state 当前状态（取默认标题里的工具名）。
 * @returns {object} 归一化载荷。
 */
export function normalizeNoteInput(raw, state) {
  const source = raw ?? {}
  const mode = source.mode
  if (mode !== 'preview' && mode !== 'save') {
    throw new CoachError(`coach_note 的 mode 必须是 "preview" 或 "save"，收到 ${JSON.stringify(mode)}。`, 'COACH_NOTE_FIELD')
  }

  const fallbackTitle = `${state?.toolName ?? '本次学习'} 学习记录`
  const title = source.title === undefined || source.title === null || String(source.title).trim() === ''
    ? clip(fallbackTitle, NOTE_LIMITS.title)
    : requiredText(source.title, 'title', NOTE_LIMITS.title)

  const concepts = arrayOf(source.concepts, 'concepts', NOTE_LIMITS.maxConcepts, (item, where) => ({
    name: requiredText(item?.name, `${where}.name`, NOTE_LIMITS.conceptName),
    explanation: requiredText(item?.explanation, `${where}.explanation`, NOTE_LIMITS.conceptExplanation),
  }))

  const pitfalls = arrayOf(source.pitfalls, 'pitfalls', NOTE_LIMITS.maxPitfalls, (item, where) => ({
    symptom: requiredText(item?.symptom, `${where}.symptom`, NOTE_LIMITS.pitfallField),
    cause: requiredText(item?.cause, `${where}.cause`, NOTE_LIMITS.pitfallField),
    fix: requiredText(item?.fix, `${where}.fix`, NOTE_LIMITS.pitfallField),
  }))

  const nextSteps = arrayOf(source.nextSteps, 'nextSteps', NOTE_LIMITS.maxNextSteps, (item, where) => (
    requiredText(item, where, NOTE_LIMITS.nextStep)
  ))

  return {
    mode,
    title,
    summary: optionalText(source.summary, 'summary', NOTE_LIMITS.summary),
    concepts,
    pitfalls,
    nextSteps,
    includeCoachShots: source.includeCoachShots === true,
  }
}

/** ASCII slug；中文/符号回落 `note`。 */
export function slugOf(toolName) {
  const ascii = String(toolName ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (ascii === '' ? 'note' : ascii).slice(0, 24)
}

/** `YYYY-MM-DD-HHmm-<slug>.md`（本地时区，`now` 由调用方传入）。 */
export function filenameFor(now, slug) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new CoachError('renderNote 需要调用方传入有效的 now（Date）。', 'COACH_NOTE_TIME')
  }
  const date = now
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}`
  return `${stamp}-${slug}.md`
}

/** 完整版文件名 → 文字版文件名：`foo.md` → `foo-text.md`。 */
export function textFilenameFor(filename) {
  return String(filename).replace(/\.md$/i, '-text.md')
}

/** 某一步在记录里的状态：通过 / 跳过 / 未完成 / 未开始。 */
export function stepStatus(state, sectionIndex, stepIndex) {
  const key = `${sectionIndex}:${stepIndex}`
  const history = effectiveSinceBack(state, verificationsFor(state, key))
  const last = history[history.length - 1]
  if (last !== undefined && last.verdict === '通过') return '通过'
  const skips = effectiveSinceBack(state, state.skips ?? [])
  if (skips.some((skip) => skip.stepKey === key)) return '跳过'

  const current = currentStep(state)
  if (current === undefined) return '未完成'
  const [currentSection, currentStepIndex] = current.key.split(':').map(Number)
  // 当前步算「未完成」（正在做），之前的未通过步骤也算未完成；只有还没轮到的才是未开始。
  const started = sectionIndex < currentSection
    || (sectionIndex === currentSection && stepIndex <= currentStepIndex)
  return started ? '未完成' : '未开始'
}

/**
 * 选择要内嵌的图片描述（不读字节，读由适配层做）。
 *
 * - 用户图片：`at > planAcceptedAt`，取最后 N 张；
 * - 教练截图：`includeCoachShots` 为 true 时，取当前计划内成功的截图，补足 N 张；
 * - 用户图片优先；重复 id 去重。
 * @param {object} state 当前状态。
 * @param {{ maxImages?: number, includeCoachShots?: boolean }} [options] 选项。
 * @returns {Array<object>} `{ source, id, ref, at, window?, method? }`
 */
export function selectNoteImages(state, options = {}) {
  const maxImages = Number.isInteger(options.maxImages) && options.maxImages > 0 ? options.maxImages : 3
  const planAt = typeof state?.planAcceptedAt === 'number' ? state.planAcceptedAt : -1

  const users = (Array.isArray(state?.userArtifacts) ? state.userArtifacts : [])
    .filter((entry) => entry !== null && typeof entry === 'object'
      && typeof entry.id === 'string' && entry.id !== ''
      && entry.ref !== null && typeof entry.ref === 'object'
      && typeof entry.at === 'number' && entry.at > planAt)
    .map((entry) => ({
      source: 'user',
      id: entry.id,
      ref: entry.ref,
      at: entry.at,
    }))
    .slice(-maxImages)

  const taken = new Set(users.map((entry) => entry.id))
  const coaches = []
  if (options.includeCoachShots === true) {
    const remaining = maxImages - users.length
    if (remaining > 0) {
      const shots = (Array.isArray(state?.checks) ? state.checks : [])
        .filter((check) => check?.kind === 'screenshot' && check.ok === true
          && check.shot !== null && typeof check.shot === 'object'
          && typeof check.shot.id === 'string' && check.shot.id !== ''
          && typeof check.at === 'number' && check.at > planAt
          && !taken.has(check.shot.id))
        .map((check) => ({
          source: 'coach',
          id: check.shot.id,
          ref: {
            attachmentId: check.shot.id,
            mediaType: check.shot.mediaType ?? '',
            bytes: check.shot.bytes ?? 0,
            width: check.shot.width ?? 0,
            height: check.shot.height ?? 0,
          },
          at: check.at,
          window: check.shot.window ?? '',
          method: check.shot.method ?? '',
        }))
        .slice(-remaining)
      coaches.push(...shots)
    }
  }
  return [...users, ...coaches]
}

/** 脱敏：只替换高置信度密钥；返回替换后的文本与次数。 */
export function redactSecrets(text) {
  let output = String(text ?? '')
  let count = 0
  for (const pattern of REDACTION_PATTERNS) {
    output = output.replace(pattern, () => {
      count += 1
      return '〔已脱敏〕'
    })
  }
  return { text: output, count }
}

/** 一条步骤行的证据列。 */
function evidenceCell(step) {
  const label = EVIDENCE_TEXT[step?.evidence] ?? String(step?.evidence ?? '')
  if (step?.check === null || step?.check === undefined) return label === '' ? '—' : label
  return `${label} \`${cell(step.check.target, 60)}\``
}

/** front matter。 */
function renderFrontMatter(state, facts, title, redactions) {
  const now = facts.now instanceof Date && Number.isFinite(facts.now.getTime()) ? facts.now : null
  const variant = facts.variant === 'text' ? 'text' : facts.preview === true ? 'preview' : 'full'
  const lines = [
    '---',
    `title: ${yamlString(title)}`,
    `tool: ${yamlString(state.toolName ?? '未知工具')}`,
    `level: ${yamlString(state.userLevel ?? '未知')}`,
    `goal: ${yamlString(state.originalGoal ?? state.currentGoal ?? '')}`,
    `mode: ${yamlString(state.goalMode ?? 'learn')}`,
    `session: ${yamlString(facts.sessionId ?? '')}`,
    `stateVersion: ${Number.isInteger(state.stateVersion) ? state.stateVersion : 0}`,
    `variant: "${variant}"`,
    `generatedAt: ${now === null ? '' : now.toISOString()}`,
    `generator: ${yamlString(facts.generator ?? NOTE_GENERATOR)}`,
  ]
  if (variant === 'full' && typeof facts.textFilename === 'string' && facts.textFilename !== '') {
    lines.push(`agentRead: ${yamlString(facts.textFilename)}`)
  }
  if (variant === 'text' && typeof facts.fullFilename === 'string' && facts.fullFilename !== '') {
    lines.push(`full: ${yamlString(facts.fullFilename)}`)
  }
  lines.push(`redactions: ${redactions}`, '---')
  return lines.join('\n')
}

/**
 * v0.5.0：文件开头的 agent 提醒。
 *
 * 这不是防线（真要 `read` 时提醒已经和 base64 一起进了上下文），只是给「只读前几行」
 * 或其它工具一个明确指路；真正的拦截在 `guard.js` 的 `read` 拒绝里。
 */
function renderAgentNotice(facts, variant) {
  if (variant === 'preview') return ''
  const textName = typeof facts.textFilename === 'string' && facts.textFilename !== ''
    ? `\`${facts.textFilename}\``
    : '同目录的 `-text.md`'
  const fullName = typeof facts.fullFilename === 'string' && facts.fullFilename !== ''
    ? `\`${facts.fullFilename}\``
    : '完整版'
  if (variant === 'text') {
    return `> **给 agent**：这是纯文字版，可安全读取。${fullName} 内嵌 base64 图片，**不要用 \`read\` 读取它**；\n`
      + '> 需要看图片时请让用户打开完整版。'
  }
  return `> **给 agent**：本文件内嵌 base64 图片，**不要用 \`read\` 读取**；请改读同目录的 ${textName}（纯文字版）。\n`
    + '> 给人类：图片已内嵌，直接打开即可。'
}

/** 证据段：完整版内嵌 data URI；文字版只指路；预览只留占位。 */
function renderEvidence(images, skippedImages, preview, variant, fullFilename) {
  const lines = ['## 5. 证据']
  if (images.length === 0 && skippedImages.length === 0) {
    lines.push('（本记录没有内嵌图片）')
    return lines.join('\n')
  }
  images.forEach((image, index) => {
    const number = index + 1
    const source = image.source === 'coach'
      ? `教练截图（窗口「${clip(image.window ?? '', 60)}」`
        + `${image.method === 'printwindow' ? '，printwindow' : image.method === 'screen' ? '，screen' : ''}）`
      : `用户提供（seq ${image.at ?? '?'}）`
    lines.push('', `### 图 ${number} · ${source}`)
    if (variant === 'text') {
      const reason = typeof fullFilename === 'string' && fullFilename !== ''
        ? `图片见完整版 \`${fullFilename}\`。`
        : '图片见同目录完整版。'
      lines.push(`> ${reason}`)
    } else if (preview) {
      lines.push(`> 〔图 ${number}：保存时内嵌，预览不展开 base64〕`)
    } else {
      const alt = image.source === 'coach' ? `教练截图 ${number}` : `用户截图 ${number}`
      lines.push(`![${alt}](data:${image.mediaType || 'image/png'};base64,${image.dataBase64})`)
    }
  })
  skippedImages.forEach((image) => {
    lines.push('', `> 〔图片未内嵌：\`${String(image.id ?? '').slice(0, 12)}…\`，原因：${clip(image.reason ?? '读取失败', 80)}〕`)
  })
  return lines.join('\n')
}

/**
 * 渲染完整记录。
 *
 * @param {object} state CoachState。
 * @param {object} payload `normalizeNoteInput` 的产物。
 * @param {object} facts `{ now, generator?, sessionId?, variant?, preview?, images?, skippedImages?,
 *   fullFilename?, textFilename? }`。
 * @returns {{ markdown: string, filename: string, textFilename: string, stats: object }}
 */
export function renderNote(state, payload, facts = {}) {
  const stats = progressStats(state) ?? {
    total: 0,
    passed: 0,
    skipped: 0,
    done: 0,
    remaining: 0,
    research: 0,
    failed: 0,
  }
  const titleRedacted = redactSecrets(payload.title)
  const title = titleRedacted.text
  const images = Array.isArray(facts.images) ? facts.images : []
  const skippedImages = Array.isArray(facts.skippedImages) ? facts.skippedImages : []
  const preview = facts.preview === true
  const variant = preview ? 'preview' : facts.variant === 'text' ? 'text' : 'full'

  const body = []
  body.push(`# ${title}`)
  body.push('')
  const notice = renderAgentNotice(facts, variant)
  if (notice !== '') {
    body.push(notice)
    body.push('')
  }
  body.push(variant === 'text'
    ? '> 事实区由插件从会话日志计算，解释区由模型撰写。本文件是纯文字版；完整版含截图。'
    : variant === 'preview'
      ? '> 预览：保存后才会生成完整版（含图）与文字版（零 base64）。'
      : '> 事实区由插件从会话日志计算，解释区由模型撰写。含屏幕截图，请勿提交到公共仓库。')
  body.push('')
  body.push('## 1. 目标与结果')
  body.push(`- 原始目标：${clip(state.originalGoal ?? state.currentGoal ?? '（未记录）', 400)}`)
  body.push(`- 结果：共 ${stats.total} 步，通过 ${stats.passed} / 跳过 ${stats.skipped} / 未完成 ${stats.remaining}`)
  body.push(`- 检索：${stats.research} 次`)
  if (payload.summary !== '') body.push(`- 复盘：${payload.summary}`)
  if (payload.nextSteps.length > 0) {
    body.push('- 下一步建议：')
    for (const step of payload.nextSteps) body.push(`  - ${step}`)
  }
  body.push('')

  body.push('## 2. 学习路径')
  body.push('| # | 板块 · 步骤 | 状态 | 证据 | 失败 |')
  body.push('|---|---|---|---|---|')
  let number = 0
  for (let sectionIndex = 0; sectionIndex < state.plan.length; sectionIndex += 1) {
    const section = state.plan[sectionIndex]
    const steps = Array.isArray(section?.steps) ? section.steps : []
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
      const step = steps[stepIndex]
      number += 1
      body.push(`| ${number} | ${cell(section?.section ?? '', 40)} · ${cell(step?.goal ?? '', 80)} `
        + `| ${stepStatus(state, sectionIndex, stepIndex)} | ${evidenceCell(step)} | ${step?.failedAttempts ?? 0} |`)
    }
  }
  if (number === 0) body.push('| — | （计划还没有步骤） | — | — | — |')
  body.push('')

  if (payload.concepts.length > 0) {
    body.push('## 3. 关键概念')
    for (const concept of payload.concepts) {
      body.push('', `### ${concept.name}`, concept.explanation)
    }
    body.push('')
  }

  if (payload.pitfalls.length > 0) {
    body.push('## 4. 踩过的坑')
    for (const pitfall of payload.pitfalls) {
      body.push('', `### ${pitfall.symptom}`, `- 原因：${pitfall.cause}`, `- 解决：${pitfall.fix}`)
    }
    body.push('')
  }

  const backList = (Array.isArray(state.backs) ? state.backs : [])
    .filter((entry) => typeof entry?.at === 'number')
  if (backList.length > 0) {
    body.push('## 回退记录（事实）')
    for (const back of backList) {
      body.push(`- 回到 ${back.stepKey}${back.reason ? `：${clip(back.reason, 120)}` : ''}（seq ${back.at}）`)
    }
    body.push('')
  }

  // 回退之前的跳过记录已经作废，只列仍然生效的。
  const skippedList = effectiveSinceBack(state, Array.isArray(state.skips) ? state.skips : [])
  if (skippedList.length > 0) {
    body.push('## 跳过记录（事实）')
    for (const skip of skippedList) {
      body.push(`- ${skip.stepKey}：${clip(skip.reason ?? '用户未说明', 120)}（失败 ${skip.failedAttempts ?? 0} 次）`)
    }
    body.push('')
  }

  const bodyText = body.join('\n').trimEnd()
  const bodyRedacted = redactSecrets(bodyText)
  const redactions = titleRedacted.count + bodyRedacted.count
  const frontMatter = renderFrontMatter(state, facts, title, redactions)
  const evidence = renderEvidence(images, skippedImages, preview, variant, facts.fullFilename)
  const markdown = `${frontMatter}\n\n${bodyRedacted.text}\n\n${evidence}\n`
  const filename = filenameFor(facts.now, slugOf(state.toolName))

  return {
    markdown,
    filename,
    textFilename: textFilenameFor(filename),
    stats: {
      total: stats.total,
      passed: stats.passed,
      skipped: stats.skipped,
      remaining: stats.remaining,
      images: images.length,
      imagesSkipped: skippedImages.length,
      redactions,
    },
  }
}
