/**
 * 联网检索（`coach_research`）的核心：脱敏、结果归一化、写入 `research_cache`。
 *
 * 纯核心：无 IO、无时间、无随机。真正的检索由适配层调用宿主 `ctx.web.search`
 * 完成，这里只处理“查到了什么、怎么记、失败时怎么记”。
 *
 * v0.3.1：检索失败**不再自动改 phase**。早先“有当前步骤就进 DEGRADED”会把
 * 一次与当前步骤无关的检索失败旁路成“本步降级”，A9 实机已复现。现在失败只写
 * `research_cache`，是否降级由模型用 `coach_verify` 判「无法判断」决定。
 *
 * 设计依据：SPEC-档2 第 4 节、Q3 A（检索缓存走日志折叠，不引入 storage）。
 */

import { CoachError, assertPhase, currentStep } from './machine.js'

/** 允许调用 `coach_research` 的阶段；`COMPLETE` / 过渡态不允许。 */
export const RESEARCH_ALLOWED_PHASES = [
  'INIT',
  'CHECK_TOOL_AVAILABILITY',
  'INSTALL_TOOL',
  'WAIT_FEEDBACK',
  'VERIFY_DONE',
  'DEGRADED',
]

/**
 * 没有当前步骤时的检索归属键。
 * 计划未建立时的环境核查也记在 `env` 上（与 `coach_check` 同口径），
 * 这样“本步检索几次”在步骤之间能分开算。
 */
export const ENV_RESEARCH_KEY = 'env'

/** 存进状态的检索正文默认上限（v0.4.2，可由 Config 覆盖）。 */
export const DEFAULT_CONTENT_MAX_CHARS = 2000

/** 本步检索次数的默认上限（v0.4.2，可由 Config 覆盖）。 */
export const DEFAULT_MAX_RESEARCH_PER_STEP = 3

/** 一条检索记录归属哪一步。 */
export function researchStepKey(state) {
  const current = currentStep(state)
  return current === undefined ? ENV_RESEARCH_KEY : current.key
}

/** 某一步已经检索了几次（成功与失败都算，v0.4.2）。 */
export function researchCountForStep(state, stepKey) {
  const list = Array.isArray(state?.research) ? state.research : []
  return list.filter((entry) => entry?.stepKey === stepKey).length
}

/**
 * 检索预算检查（v0.4.2）。**必须在真正调用 `web` 之前做**——
 * 否则“第 4 次被拒”也白烧了一次网络请求。
 *
 * 失败调用也计数：它们在 `research` 里留下一模一样的条目（`ok:false`），
 * 所以这里只数条目、不区分成败。
 *
 * @param {object} state 当前状态。
 * @param {number} [maxPerStep] 本步上限。
 * @returns {{ stepKey: string, used: number, limit: number }}
 */
export function assertResearchBudget(state, maxPerStep = DEFAULT_MAX_RESEARCH_PER_STEP) {
  const limit = Number.isInteger(maxPerStep) && maxPerStep > 0
    ? maxPerStep
    : DEFAULT_MAX_RESEARCH_PER_STEP
  const stepKey = researchStepKey(state)
  const used = researchCountForStep(state, stepKey)
  if (used >= limit) {
    throw new CoachError(
      `本步（${stepKey}）已经检索 ${used} 次，达到上限 ${limit} 次。`
        + '不要重复检索同一件事：改用已有结果、用 coach_check 采集本地证据，'
        + '或让用户提供截图/报错。需要放宽时由使用者改 Config 的 maxResearchPerStep。',
      'COACH_RESEARCH_BUDGET',
    )
  }
  return { stepKey, used, limit }
}

const QUERY_BUDGET = 500
const ERROR_BUDGET = 600
const SOURCE_TITLE_BUDGET = 200
const SOURCE_SNIPPET_BUDGET = 500
const SOURCE_URL_BUDGET = 1000

/** 截断，避免把长结果塞进 meta / 状态块。 */
function clip(value, budget) {
  const text = String(value ?? '').trim()
  return text.length <= budget ? text : `${text.slice(0, budget - 1)}…`
}

/**
 * 确定性地脱敏检索词：本地路径、附件对象 id、邮箱。
 *
 * 这是“保守脱敏”：只替换高置信度的模式，不做语义级 PII 识别。
 * 需要保留原文才能检索时，模型必须先征得用户同意；工具仍会先脱敏。
 *
 * @param {string} text 原始检索词。
 * @returns {{ query: string, redacted: boolean }}
 */
export function redactQuery(text) {
  const original = String(text ?? '')
  let query = original

  // Windows 盘符路径（不吞空格/中文标点/邮箱，避免把整句话都替换掉）。
  query = query.replace(
    /[A-Za-z]:\\(?:[^\\\s"'<>|，。、；：,;:@]+\\)*[^\\\s"'<>|，。、；：,;:@]*/g,
    '<path>',
  )
  // UNC 路径 \\server\share\...；按反斜杠分段，避免把后面的中文标点/邮箱一起吞掉。
  query = query.replace(
    /\\\\[^\s"'<>|\\，。、；：,;:/@]+(?:\\[^\s"'<>|\\，。、；：,;:/@]+)+/g,
    '<path>',
  )
  // 常见 POSIX 绝对路径前缀；不匹配 URL 里的 ://。允许中文逗号/顿号等分隔符。
  query = query.replace(
    /(^|[\s，。、；：,;:（(])(\/(?:Users|home|tmp|var|opt|mnt|Volumes|private)\/[^\s"'<>|，。、；：,;:@]+)/g,
    (_match, lead) => `${lead}<path>`,
  )
  // 附件对象 id（32 位以上 hex）。
  query = query.replace(/\b[0-9a-f]{32,}\b/gi, '<attachment>')
  // 邮箱。
  query = query.replace(/\b[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+\b/g, '<email>')

  return { query: clip(query, QUERY_BUDGET), redacted: query !== original }
}

/** 归一化一条来源；畸形项直接丢弃。 */
function normalizeSource(source) {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return undefined
  const url = typeof source.url === 'string' ? clip(source.url, SOURCE_URL_BUDGET) : ''
  if (url === '') return undefined
  const normalized = { url }
  if (typeof source.title === 'string' && source.title.trim() !== '') {
    normalized.title = clip(source.title, SOURCE_TITLE_BUDGET)
  }
  if (typeof source.snippet === 'string' && source.snippet.trim() !== '') {
    normalized.snippet = clip(source.snippet, SOURCE_SNIPPET_BUDGET)
  }
  if (typeof source.publishedAt === 'string' && source.publishedAt.trim() !== '') {
    normalized.publishedAt = clip(source.publishedAt, 100)
  }
  return normalized
}

/**
 * 归一化宿主 `ctx.web.search` 的 sources。最多保留 8 条。
 * @param {unknown} sources
 * @returns {Array<{ url: string, title?: string, snippet?: string, publishedAt?: string }>}
 */
export function normalizeSources(sources) {
  if (!Array.isArray(sources)) return []
  const normalized = []
  for (const source of sources) {
    const item = normalizeSource(source)
    if (item === undefined) continue
    normalized.push(item)
    if (normalized.length >= 8) break
  }
  return normalized
}

/**
 * 记录一次检索（`coach_research`）。
 *
 * - 成功：进入 `RESEARCH` 过渡态，记录缓存，回到调用前的阶段；
 * - 失败：无论有没有当前步骤，都**保持原阶段**，缓存里留一条 `ok:false` 记录。
 *   v0.3.1 起不再自动进 `DEGRADED`——检索失败不等于本步判定失败。
 *
 * v0.4.2：条目带 `stepKey`（预算按步分账），正文按 `contentMaxChars` 截断。
 * 截断**只影响存进状态的正文**；工具那次回传给模型的文本由 `render` 决定，不受影响。
 *
 * @param {object} state 当前状态。
 * @param {object} observation `{ query, redacted?, ok?, sources?, truncated?, content?, error? }`。
 * @param {number} at 该结果事件序号。
 * @param {{ contentMaxChars?: number }} [options] 折叠选项（来自 Config）。
 * @returns {object} 新状态。
 */
export function applyResearch(state, observation, at, options = {}) {
  assertPhase(state, RESEARCH_ALLOWED_PHASES, 'coach_research')

  const rawQuery = typeof observation?.query === 'string' ? observation.query.trim() : ''
  if (rawQuery === '') {
    throw new CoachError('coach_research 的 query 必须是非空字符串。', 'COACH_RESEARCH_QUERY')
  }

  const contentMax = Number.isInteger(options?.contentMaxChars) && options.contentMaxChars > 0
    ? options.contentMaxChars
    : DEFAULT_CONTENT_MAX_CHARS
  const sources = normalizeSources(observation?.sources)
  const failed = observation?.ok === false || sources.length === 0
  const error = typeof observation?.error === 'string' && observation.error.trim() !== ''
    ? clip(observation.error, ERROR_BUDGET)
    : failed
      ? '没有查到可靠来源'
      : ''
  const entry = {
    stepKey: researchStepKey(state),
    query: clip(rawQuery, QUERY_BUDGET),
    redacted: observation?.redacted === true,
    ok: !failed,
    sources,
    truncated: observation?.truncated === true,
    content: typeof observation?.content === 'string'
      ? clip(observation.content, contentMax)
      : '',
    error,
    at: typeof at === 'number' ? at : 0,
  }

  const previous = Array.isArray(state.research) ? state.research : []
  const entered = {
    ...state,
    phase: 'RESEARCH',
    research: [...previous, entry],
  }
  const basePhase = state.phase
  return { ...entered, phase: basePhase }
}
