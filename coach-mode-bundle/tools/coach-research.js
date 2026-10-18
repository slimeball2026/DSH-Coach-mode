/**
 * `coach_research` —— 联网检索补全信息。
 *
 * 适配层只负责调用宿主 `ctx.get('web').search`；脱敏、结果归一化和缓存写入
 * 全部在 `core/research.js`（纯函数）。检索结果写进 `tool/result.data.meta`，
 * 由折叠进 `CoachState.research`，仍然坚持“日志是唯一真源”。
 *
 * 检索失败不编造：返回 `ok:false`（成功的工具结果 + 结构化失败事实）。
 * v0.3.1 起失败只写 `research_cache`，不自动改 phase；是否降级由模型用
 * `coach_verify` 判「无法判断」决定。
 */

import { defineTool } from './define-tool.js'
import { CoachError, assertPhase } from '../core/machine.js'
import {
  DEFAULT_CONTENT_MAX_CHARS,
  RESEARCH_ALLOWED_PHASES,
  applyResearch,
  assertResearchBudget,
  normalizeSources,
  redactQuery,
} from '../core/research.js'

const DEFAULT_MAX_RESULTS = 5
const MAX_RESULTS = 8

const DESCRIPTION = [
  '联网检索补全工具的操作细节、界面、参数或报错原因。',
  '只在你不确定、且需要官方文档/最新信息时用；不要用它替代核查结论。',
  '查询会自动脱敏（本地路径、附件 id、邮箱）；结果会记录到检索缓存。',
  '每步最多检索 3 次（Config 可改），第 4 次会被直接拒绝；失败也计数。',
  '检索失败就明确说“没查到”，不要编造步骤。',
].join('')

/** 截断，保持回传文本可读。 */
function clip(text, budget) {
  const value = String(text ?? '').trim()
  return value.length <= budget ? value : `${value.slice(0, budget - 1)}…`
}

/** 把 maxResults 夹到 1..8。 */
function normalizeMaxResults(value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) return DEFAULT_MAX_RESULTS
  return Math.min(number, MAX_RESULTS)
}

export function createResearchTool(deps) {
  const { projection, ctx, config } = deps
  const contentMaxChars = Number.isInteger(config?.researchContentMaxChars)
    && config.researchContentMaxChars > 0
    ? config.researchContentMaxChars
    : DEFAULT_CONTENT_MAX_CHARS
  return defineTool({
    name: 'coach_research',
    description: DESCRIPTION,
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: '要检索的内容。可以包含用户描述的现象；插件会自动脱敏本地路径/附件 id/邮箱。',
      },
      maxResults: {
        type: 'integer',
        description: '最多返回多少条来源，默认 5，最大 8。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          query: { type: 'string', required: true },
          redacted: { type: 'boolean', required: true },
          sources: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                url: { type: 'string', required: true },
                title: { type: 'string' },
                snippet: { type: 'string' },
                publishedAt: { type: 'string' },
              },
            },
          },
          truncated: { type: 'boolean' },
          content: { type: 'string' },
          error: { type: 'string' },
          stepKey: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (value.ok !== true) {
          return [{
            type: 'text',
            text: `检索失败：${value.error || '没有查到可靠来源'}。\n`
              + '不要编造操作步骤。检索失败不会自动让本步降级；请让用户提供截图/报错，'
              + '或改用 coach_check 采集本地证据，必要时再用 coach_verify 判「无法判断」。',
          }]
        }
        const head = `已检索「${value.query}」${value.redacted ? '（检索词已自动脱敏）' : ''}，`
          + `找到 ${value.sources.length} 个来源：`
        const sources = value.sources.map((source) => {
          const title = source.title ?? source.url
          const date = source.publishedAt ? `（${source.publishedAt}）` : ''
          return `- [来源] ${title}${date} — ${source.url}`
        })
        const body = value.content ? `\n检索摘要：${clip(value.content, 1200)}` : ''
        return [{
          type: 'text',
          text: `${head}\n${sources.join('\n')}${body}\n`
            + '引用时必须标【来源】【时效】【可信度】；检索结果只能补全“怎么做”，不能替代核查结论。'
            + (value.redacted ? '\n注意：检索词已自动脱敏。' : ''),
        }]
      },
      presentationMeta: (_args, value) => ({
        coachTool: 'coach_research',
        // v0.4.2：stepKey 进 meta，折叠时按步分账（预算与【用量】都靠它）。
        stepKey: value.stepKey ?? '',
        query: value.query,
        redacted: value.redacted,
        ok: value.ok,
        sources: value.sources,
        truncated: value.truncated === true,
        content: clip(value.content ?? '', contentMaxChars),
        error: value.error ?? '',
      }),
    },
    execute: async (args, exec) => {
      const state = projection.stateForExec(exec)
      // 先校验阶段，避免在 COMPLETE 等不允许的阶段白跑一次网络请求。
      assertPhase(state, RESEARCH_ALLOWED_PHASES, 'coach_research')
      const rawQuery = typeof args.query === 'string' ? args.query.trim() : ''
      if (rawQuery === '') {
        throw new CoachError('coach_research 的 query 必须是非空字符串。', 'COACH_RESEARCH_QUERY')
      }

      // v0.4.2：预算必须在真正联网之前查——否则“第 4 次被拒”也白烧一次请求。
      const { stepKey } = assertResearchBudget(state, config.maxResearchPerStep)

      const { query, redacted } = redactQuery(rawQuery)
      const maxResults = normalizeMaxResults(args.maxResults)
      const web = ctx.get('web')
      if (web === undefined || typeof web.search !== 'function') {
        throw new CoachError(
          '宿主的 web 服务不可用，无法做联网检索。',
          'COACH_RESEARCH_NO_WEB',
        )
      }

      let observation
      try {
        const result = await web.search({ query, maxResults }, exec?.signal)
        const sources = normalizeSources(result?.sources)
        observation = {
          stepKey,
          query,
          redacted,
          ok: sources.length > 0,
          sources,
          truncated: result?.truncated === true,
          content: typeof result?.content === 'string' ? result.content : '',
          error: sources.length === 0 ? '没有查到可靠来源' : '',
        }
      } catch (error) {
        observation = {
          stepKey,
          query,
          redacted,
          ok: false,
          sources: [],
          truncated: false,
          content: '',
          error: error instanceof Error ? error.message : String(error),
        }
      }

      // 先校验阶段/写入缓存，再把结构化事实返回给宿主。
      // 正文截断只影响“存进状态”的那份；`render` 回传给模型的文本不受影响。
      applyResearch(state, observation, 0, { contentMaxChars })
      return observation
    },
  })
}
